import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  isPracticeDatabaseConfigured,
  practiceQuery,
  PracticeDatabaseUnavailableError,
  withPracticeTransaction,
} from "@/lib/db";
import {
  exercises,
  getExerciseAttemptType,
  getLessonForConcept,
} from "@/lib/lessons";
import {
  recommendPractice,
  type PracticeAttemptType,
  type PracticeConcept,
  type PracticeOutcome,
  type PracticeRecommendation,
  type RecommendationAttempt,
} from "@/lib/practice-recommendations";

export const LEARNER_COOKIE_NAME = "second_try_learner";
export const LEARNER_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const MAX_COOKIE_HEADER_LENGTH = 8_192;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class PracticeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PracticeRequestError";
  }
}

export class PracticeConflictError extends PracticeRequestError {
  constructor() {
    super("This attempt ID was already used for a different result.", 409);
    this.name = "PracticeConflictError";
  }
}

export type AttemptPayload = {
  attemptId: string;
  sessionId: string;
  exerciseId: string;
  hintsUsed: number;
  outcome: PracticeOutcome;
  occurredAt: string;
};

export type StoredAttempt = AttemptPayload & {
  concept: PracticeConcept;
  attemptType: PracticeAttemptType;
  passed: boolean;
  createdAt: string;
  occurredAt: string;
  idempotentReplay: boolean;
};

export type HistoryResponse = {
  attempts: Omit<StoredAttempt, "sessionId" | "idempotentReplay">[];
  summary: {
    testRuns: number;
    failedIndependentRuns: number;
    independentPassesWithoutHints: number;
  };
  recommendation: PracticeRecommendation | null;
};

function parseCookieToken(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return { token: null, invalid: false };
  if (cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) {
    return { token: null, invalid: true };
  }

  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${LEARNER_COOKIE_NAME}=`));
  if (matches.length === 0) return { token: null, invalid: false };
  if (matches.length !== 1) return { token: null, invalid: true };

  const token = matches[0].slice(LEARNER_COOKIE_NAME.length + 1);
  return TOKEN_PATTERN.test(token)
    ? { token, invalid: false }
    : { token: null, invalid: true };
}

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new PracticeRequestError("Cross-origin requests are not allowed.", 403);
  }
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        throw new PracticeRequestError(
          "Cross-origin requests are not allowed.",
          403,
        );
      }
    } catch (error) {
      if (error instanceof PracticeRequestError) throw error;
      throw new PracticeRequestError("Invalid request origin.", 403);
    }
  }
}

export async function createLearnerSession(request: Request) {
  const parsedCookie = parseCookieToken(request);
  if (parsedCookie.invalid) {
    throw new PracticeRequestError("The learner cookie is invalid.", 400);
  }
  if (!isPracticeDatabaseConfigured()) {
    throw new PracticeDatabaseUnavailableError();
  }

  const token = parsedCookie.token ?? randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sessionId = randomUUID();
  const learnerId = randomUUID();

  const created = await withPracticeTransaction(async (client) => {
    let resolvedLearnerId: string | undefined;
    if (parsedCookie.token) {
      const learner = await client.query<{ learner_id: string }>(
        `SELECT learner_id
         FROM second_try.learners
         WHERE credential_hash = $1`,
        [tokenHash],
      );
      resolvedLearnerId = learner.rows[0]?.learner_id;
      if (!resolvedLearnerId) {
        throw new PracticeRequestError("The learner cookie is invalid.", 400);
      }
    } else {
      const learner = await client.query<{ learner_id: string }>(
        `INSERT INTO second_try.learners (learner_id, credential_hash)
         VALUES ($1, $2)
         RETURNING learner_id`,
        [learnerId, tokenHash],
      );
      resolvedLearnerId = learner.rows[0]?.learner_id;
    }
    if (!resolvedLearnerId) {
      throw new Error("Could not resolve learner.");
    }
    await client.query(
      `INSERT INTO second_try.practice_sessions (session_id, learner_id)
       VALUES ($1, $2)`,
      [sessionId, resolvedLearnerId],
    );
    return resolvedLearnerId;
  });

  return {
    sessionId,
    learnerId: created,
    cookieToken: parsedCookie.token ? null : token,
  };
}

async function getLearnerId(request: Request) {
  const parsedCookie = parseCookieToken(request);
  if (parsedCookie.invalid) {
    throw new PracticeRequestError("The learner cookie is invalid.", 400);
  }
  if (!parsedCookie.token) {
    throw new PracticeRequestError("Practice session is not initialized.", 401);
  }
  const hash = createHash("sha256").update(parsedCookie.token).digest("hex");
  const result = await practiceQuery<{ learner_id: string }>(
    `SELECT learner_id
     FROM second_try.learners
     WHERE credential_hash = $1`,
    [hash],
  );
  const learnerId = result.rows[0]?.learner_id;
  if (!learnerId) {
    throw new PracticeRequestError("Practice session is not initialized.", 401);
  }
  return learnerId;
}

export async function savePracticeAttempt(
  request: Request,
  payload: AttemptPayload,
): Promise<StoredAttempt> {
  const exercise = exercises.find((item) => item.id === payload.exerciseId);
  const attemptType = getExerciseAttemptType(payload.exerciseId);
  if (!exercise || !attemptType) {
    throw new PracticeRequestError("Exercise is not available.", 400);
  }
  if (
    !Number.isInteger(payload.hintsUsed) ||
    payload.hintsUsed < 0 ||
    payload.hintsUsed > exercise.hints.length
  ) {
    throw new PracticeRequestError("Hint count is invalid for this exercise.", 400);
  }

  const learnerId = await getLearnerId(request);
  return withPracticeTransaction(async (client) => {
    const session = await client.query(
      `SELECT 1
       FROM second_try.practice_sessions
       WHERE learner_id = $1 AND session_id = $2`,
      [learnerId, payload.sessionId],
    );
    if (session.rowCount !== 1) {
      throw new PracticeRequestError("Practice session is not authorized.", 403);
    }

    const concept = exercise.concept;
    const passed = payload.outcome === "passed";
    const inserted = await client.query<{
      created_at: Date;
      occurred_at: Date;
    }>(
      `INSERT INTO second_try.attempts
         (learner_id, attempt_id, session_id, exercise_id, concept, passed,
          hints_used, attempt_type, outcome, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (learner_id, attempt_id) DO NOTHING
       RETURNING created_at, occurred_at`,
      [
        learnerId,
        payload.attemptId,
        payload.sessionId,
        payload.exerciseId,
        concept,
        passed,
        payload.hintsUsed,
        attemptType,
        payload.outcome,
        payload.occurredAt,
      ],
    );

    if (inserted.rowCount === 1) {
      return {
        ...payload,
        concept,
        attemptType,
        passed,
        createdAt: inserted.rows[0].created_at.toISOString(),
        occurredAt: inserted.rows[0].occurred_at.toISOString(),
        idempotentReplay: false,
      };
    }

    const existing = await client.query<{
      session_id: string;
      exercise_id: string;
      concept: string;
      passed: boolean;
      hints_used: number;
      attempt_type: string;
      outcome: PracticeOutcome;
      created_at: Date;
      occurred_at: Date;
    }>(
      `SELECT session_id, exercise_id, concept, passed, hints_used,
              attempt_type, outcome, created_at, occurred_at
       FROM second_try.attempts
       WHERE learner_id = $1 AND attempt_id = $2`,
      [learnerId, payload.attemptId],
    );
    const row = existing.rows[0];
    if (
      !row ||
      row.session_id !== payload.sessionId ||
      row.exercise_id !== payload.exerciseId ||
      row.concept !== concept ||
      row.passed !== passed ||
      row.hints_used !== payload.hintsUsed ||
      row.attempt_type !== attemptType ||
      row.outcome !== payload.outcome ||
      row.occurred_at.toISOString() !== new Date(payload.occurredAt).toISOString()
    ) {
      throw new PracticeConflictError();
    }

    return {
      ...payload,
      concept,
      attemptType,
      passed,
      createdAt: row.created_at.toISOString(),
      occurredAt: row.occurred_at.toISOString(),
      idempotentReplay: true,
    };
  });
}

type AttemptRow = {
  attempt_id: string;
  exercise_id: string;
  concept: PracticeConcept;
  created_at: Date;
  occurred_at: Date;
  passed: boolean;
  hints_used: number;
  attempt_type: PracticeAttemptType;
  outcome: PracticeOutcome;
};

function toRecommendationAttempt(row: AttemptRow): RecommendationAttempt {
  return {
    attemptId: row.attempt_id,
    concept: row.concept,
    exerciseId: row.exercise_id,
    attemptType: row.attempt_type,
    outcome: row.outcome,
    hintsUsed: row.hints_used,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export async function getPracticeHistory(
  request: Request,
): Promise<HistoryResponse> {
  const learnerId = await getLearnerId(request);
  const [recent, latest, counts] = await Promise.all([
    practiceQuery<AttemptRow>(
      `SELECT attempt_id, exercise_id, concept, created_at, passed,
              occurred_at, hints_used, attempt_type, outcome
       FROM second_try.attempts
       WHERE learner_id = $1
       ORDER BY occurred_at DESC, attempt_id DESC
       LIMIT 50`,
      [learnerId],
    ),
    practiceQuery<AttemptRow>(
      `SELECT DISTINCT ON (concept, attempt_type)
              attempt_id, exercise_id, concept, created_at, occurred_at,
              passed, hints_used, attempt_type, outcome
       FROM second_try.attempts
       WHERE learner_id = $1
       ORDER BY concept, attempt_type, occurred_at DESC, attempt_id DESC`,
      [learnerId],
    ),
    practiceQuery<{
      test_runs: string;
      failed_independent_runs: string;
      independent_passes_without_hints: string;
    }>(
      `SELECT
         COUNT(*) AS test_runs,
         COUNT(*) FILTER (
           WHERE attempt_type = 'independent'
             AND outcome IN ('failed', 'error', 'timed_out')
         ) AS failed_independent_runs,
         COUNT(*) FILTER (
           WHERE attempt_type = 'independent'
             AND outcome = 'passed'
             AND hints_used = 0
         ) AS independent_passes_without_hints
       FROM second_try.attempts
       WHERE learner_id = $1`,
      [learnerId],
    ),
  ]);

  const exerciseMap = getRecommendationExerciseMap();
  const recommendation = recommendPractice(
    latest.rows.map(toRecommendationAttempt),
    exerciseMap,
  );

  return {
    attempts: recent.rows.map((row) => ({
      attemptId: row.attempt_id,
      exerciseId: row.exercise_id,
      concept: row.concept,
      createdAt: row.created_at.toISOString(),
      occurredAt: row.occurred_at.toISOString(),
      passed: row.passed,
      hintsUsed: row.hints_used,
      attemptType: row.attempt_type,
      outcome: row.outcome,
    })),
    summary: {
      testRuns: Number(counts.rows[0]?.test_runs ?? 0),
      failedIndependentRuns: Number(
        counts.rows[0]?.failed_independent_runs ?? 0,
      ),
      independentPassesWithoutHints: Number(
        counts.rows[0]?.independent_passes_without_hints ?? 0,
      ),
    },
    recommendation,
  };
}

function getRecommendationExerciseMap() {
  return exercises.flatMap((exercise) => {
    if (!exercise.followUpExerciseId) return [];
    const lesson = getLessonForConcept(exercise.concept);
    if (!lesson) return [];
    return [
      {
        concept: exercise.concept,
        guidedExerciseId: lesson.guidedExerciseId,
        independentExerciseId: exercise.followUpExerciseId,
      },
    ];
  });
}
