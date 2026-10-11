"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getExercise, getLessonForConcept } from "@/lib/lessons";
import type {
  PracticeRecommendation,
  PracticeOutcome,
  PracticeAttemptType,
  PracticeConcept,
} from "@/lib/practice-recommendations";
import type { PracticeSessionStatus } from "@/lib/practice-client";

type HistoryAttempt = {
  attemptId: string;
  exerciseId: string;
  concept: PracticeConcept;
  createdAt: string;
  occurredAt: string;
  passed: boolean;
  hintsUsed: number;
  attemptType: PracticeAttemptType;
  outcome: PracticeOutcome;
};

type HistoryData = {
  attempts: HistoryAttempt[];
  summary: {
    testRuns: number;
    failedIndependentRuns: number;
    independentPassesWithoutHints: number;
  };
  recommendation: PracticeRecommendation | null;
};

const concepts: PracticeConcept[] = [
  "accumulator",
  "early_return",
  "off_by_one",
];

const outcomeLabels: Record<PracticeOutcome, string> = {
  passed: "Passed",
  failed: "Needs another try",
  error: "Python error",
  timed_out: "Timed out",
};

function isHistoryData(value: unknown): value is HistoryData {
  if (!value || typeof value !== "object") return false;
  const history = value as Record<string, unknown>;
  return (
    Array.isArray(history.attempts) &&
    typeof history.summary === "object" &&
    history.summary !== null &&
    typeof history.recommendation !== "undefined"
  );
}

function attemptTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 60 * 60_000) {
    return `${Math.floor(elapsed / 60_000)}m ago`;
  }
  if (elapsed < 24 * 60 * 60_000) {
    return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export default function MyPractice({
  sessionStatus,
  refreshVersion,
  onRetrySession,
  onOpenRecommendation,
}: {
  sessionStatus: PracticeSessionStatus;
  refreshVersion: number;
  onRetrySession: () => void;
  onOpenRecommendation: (recommendation: PracticeRecommendation) => void;
}) {
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const loadHistory = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/practice/history", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isHistoryData(body)) {
        throw new Error(
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Could not load your practice history.",
        );
      }
      if (version === requestVersion.current) setHistory(body);
    } catch (caught) {
      if (version === requestVersion.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your practice history.",
        );
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "ready") {
      requestVersion.current += 1;
      return;
    }
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [loadHistory, refreshVersion, sessionStatus]);

  const recentAttempts = history?.attempts ?? [];

  return (
    <section className="my-practice" aria-labelledby="my-practice-title">
      <div className="my-practice-heading">
        <div>
          <p className="eyebrow">Your learning space</p>
          <h2 id="my-practice-title">My Practice</h2>
          <p className="practice-heading-copy">
            See what you have worked on and choose a useful next step.
          </p>
        </div>
        {sessionStatus === "ready" && (
          <button
            className="text-button history-refresh"
            onClick={() => void loadHistory()}
            disabled={loading}
          >
            <span aria-hidden="true">{loading ? "◌" : "↻"}</span>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {sessionStatus === "loading" && (
        <div className="history-state" role="status">
          <span className="history-state-icon" aria-hidden="true">◌</span>
          <div>
            <strong>Connecting your practice history</strong>
            <p>Your Python workspace is ready while this loads.</p>
          </div>
        </div>
      )}
      {sessionStatus === "unavailable" && (
        <div className="history-error" role="status">
          <div>
            <strong>History is temporarily unavailable</strong>
            <p>Your lessons and Python practice still work. Saved history will show here when the connection is restored.</p>
          </div>
          <button className="button button-secondary" onClick={onRetrySession}>
            Try again
          </button>
        </div>
      )}
      {sessionStatus === "ready" && loading && (
        <div className="history-state" role="status">
          <span className="history-state-icon" aria-hidden="true">◌</span>
          <div>
            <strong>Loading your recent practice</strong>
            <p>This should only take a moment.</p>
          </div>
        </div>
      )}
      {sessionStatus === "ready" && !loading && error && (
        <div className="history-error" role="alert">
          <div>
            <strong>We couldn’t load your history</strong>
            <p>{error}</p>
          </div>
          <button className="button button-secondary" onClick={() => void loadHistory()}>
            Retry
          </button>
        </div>
      )}
      {sessionStatus === "ready" && !loading && !error && history && (
        <>
          <div className="practice-stats" aria-label="Practice summary">
            <article className="practice-stat practice-stat-primary">
              <span className="practice-stat-icon" aria-hidden="true">↗</span>
              <div>
                <strong>{history.summary.testRuns}</strong>
                <span>test runs so far</span>
              </div>
            </article>
            <article className="practice-stat">
              <span className="practice-stat-icon practice-stat-icon-green" aria-hidden="true">✓</span>
              <div>
                <strong>{history.summary.independentPassesWithoutHints}</strong>
                <span>independent passes, no hints</span>
              </div>
            </article>
            <article className="practice-stat">
              <span className="practice-stat-icon practice-stat-icon-amber" aria-hidden="true">↻</span>
              <div>
                <strong>{history.summary.failedIndependentRuns}</strong>
                <span>independent runs that hit a snag</span>
              </div>
            </article>
          </div>

          <div className="practice-dashboard-grid">
            <section className="practice-trail" aria-labelledby="practice-trail-title">
              <div className="practice-section-heading">
                <div>
                  <h3 id="practice-trail-title">Your learning trail</h3>
                  <p>Recent runs across the three practice patterns</p>
                </div>
                <span className="trail-window">Last {recentAttempts.length} runs</span>
              </div>
              {recentAttempts.length === 0 ? (
                <div className="trail-empty">
                  <span aria-hidden="true">✳</span>
                  <div>
                    <strong>Your story starts with one run</strong>
                    <p>Choose a suggested exercise to record your first step here.</p>
                  </div>
                </div>
              ) : (
                <div className="concept-trails">
                  {concepts.map((concept) => {
                    const lesson = getLessonForConcept(concept);
                    const attempts = recentAttempts
                      .filter((attempt) => attempt.concept === concept)
                      .slice(0, 12)
                      .reverse();
                    const latest = attempts[attempts.length - 1];
                    return (
                      <div className="concept-trail" key={concept}>
                        <div className="concept-trail-heading">
                          <div>
                            <strong>{lesson?.title ?? concept.replace("_", " ")}</strong>
                            <span>
                              {attempts.length === 0
                                ? "Not tried yet"
                                : `${attempts.length} recent ${attempts.length === 1 ? "run" : "runs"}`}
                            </span>
                          </div>
                          {latest && (
                            <span className={`trail-latest trail-latest-${latest.outcome}`}>
                              {outcomeLabels[latest.outcome]}
                            </span>
                          )}
                        </div>
                        {attempts.length > 0 ? (
                          <div
                            className="trail-dots"
                            role="img"
                            aria-label={`${attempts.length} runs; latest ${latest ? outcomeLabels[latest.outcome].toLowerCase() : ""}`}
                          >
                            {attempts.map((attempt) => (
                              <span
                                key={attempt.attemptId}
                                className={`trail-dot trail-dot-${attempt.outcome}`}
                                title={`${outcomeLabels[attempt.outcome]} · ${attemptTime(attempt.occurredAt)}`}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="trail-unstarted" aria-hidden="true">
                            Start with a guided lesson
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="trail-footnote">
                Each mark is one browser-reported test run—not a score or mastery rating.
              </p>
            </section>

            <section className="recommendation-card" aria-labelledby="next-practice-title">
              <div className="recommendation-sparkle" aria-hidden="true">✳</div>
              <p className="eyebrow">A good next step</p>
              {history.recommendation ? (
                <>
                  <span className="recommendation-type">
                    {history.recommendation.attemptType === "guided"
                      ? "Guided practice"
                      : "Independent practice"}
                  </span>
                  <h3 id="next-practice-title">
                    {getExercise(history.recommendation.exerciseId)?.title ??
                      "Recommended exercise"}
                  </h3>
                  <p>{history.recommendation.reason}</p>
                  <button
                    className="button button-primary recommendation-action"
                    onClick={() => onOpenRecommendation(history.recommendation!)}
                  >
                    {history.recommendation.attemptType === "guided"
                      ? "Start guided practice"
                      : "Try it independently"}
                    <span aria-hidden="true">→</span>
                  </button>
                </>
              ) : (
                <>
                  <h3 id="next-practice-title">You’re all caught up</h3>
                  <p>
                    Nothing needs a retry right now. Unassisted independent
                    passes become eligible for a revisit after 24 hours.
                  </p>
                  <span className="recommendation-resting">Come back when you’re ready</span>
                </>
              )}
            </section>
          </div>

          <section className="history-list" aria-labelledby="recent-runs-title">
            <div className="practice-section-heading history-list-heading">
              <div>
                <h3 id="recent-runs-title">Recent runs</h3>
                <p>What happened in your latest practice sessions</p>
              </div>
              <span className="history-limit">Showing up to 50</span>
            </div>
            {recentAttempts.length === 0 ? (
              <p className="history-message">
                No saved runs yet. Your completed lesson tests will appear here.
              </p>
            ) : (
              <ul>
                {recentAttempts.map((attempt) => (
                  <li key={attempt.attemptId}>
                    <span
                      className={`outcome-icon outcome-icon-${attempt.outcome}`}
                      aria-hidden="true"
                    >
                      {attempt.outcome === "passed" ? "✓" : attempt.outcome === "failed" ? "↻" : "!"}
                    </span>
                    <div className="history-attempt-detail">
                      <strong>
                        {getExercise(attempt.exerciseId)?.title ?? "Reviewed exercise"}
                      </strong>
                      <span>
                        {getLessonForConcept(attempt.concept)?.title ??
                          attempt.concept.replace("_", " ")}
                        <span aria-hidden="true"> · </span>
                        {attempt.attemptType === "guided" ? "Guided" : "Independent"}
                        <span aria-hidden="true"> · </span>
                        {outcomeLabels[attempt.outcome]}
                        {attempt.hintsUsed > 0 &&
                          ` · ${attempt.hintsUsed} ${attempt.hintsUsed === 1 ? "hint" : "hints"}`}
                      </span>
                    </div>
                    <time dateTime={attempt.occurredAt} title={attemptTime(attempt.occurredAt)}>
                      {attemptTime(attempt.occurredAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="practice-data-note">
            These are practice events reported by your browser. They’re useful
            for reflection, but aren’t verified assessments.
          </p>
        </>
      )}
    </section>
  );
}
