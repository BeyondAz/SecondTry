import assert from "node:assert/strict";
import test from "node:test";
import {
  recommendPractice,
  REVISIT_INTERVAL_MS,
  type RecommendationAttempt,
  type RecommendationExercise,
} from "./practice-recommendations.ts";

const exercises: RecommendationExercise[] = [
  {
    concept: "accumulator",
    guidedExerciseId: "sum-numbers",
    independentExerciseId: "count-positive",
  },
  {
    concept: "early_return",
    guidedExerciseId: "find-first",
    independentExerciseId: "contains-target",
  },
  {
    concept: "off_by_one",
    guidedExerciseId: "inclusive-range-sum",
    independentExerciseId: "inclusive-square-sum",
  },
];

const now = new Date("2026-10-10T12:00:00.000Z");

function attempt(
  overrides: Partial<RecommendationAttempt> = {},
): RecommendationAttempt {
  return {
    attemptId: "00000000-0000-4000-8000-000000000001",
    concept: "accumulator",
    exerciseId: "count-positive",
    attemptType: "independent",
    outcome: "failed",
    hintsUsed: 0,
    occurredAt: "2026-10-10T10:00:00.000Z",
    ...overrides,
  };
}

test("prioritizes a failed independent exercise", () => {
  assert.deepEqual(
    recommendPractice([attempt()], exercises, now),
    {
      concept: "accumulator",
      exerciseId: "count-positive",
      attemptType: "independent",
      reason: "Your latest independent run did not pass. Try this exercise again.",
    },
  );
});

test("a delayed older independent failure cannot supersede a newer pass", () => {
  const recommendation = recommendPractice(
    [
      attempt({
        attemptId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        outcome: "passed",
        occurredAt: "2026-10-10T11:00:00.000Z",
      }),
      attempt({
        attemptId: "00000000-0000-4000-8000-000000000002",
        outcome: "failed",
        occurredAt: "2026-10-10T09:00:00.000Z",
      }),
    ],
    exercises.slice(0, 1),
    now,
  );
  assert.equal(recommendation, null);
});

test("occurrence-time ties use descending attempt ID as a stable tie-break", () => {
  const recommendation = recommendPractice(
    [
      attempt({
        attemptId: "00000000-0000-4000-8000-000000000001",
        outcome: "failed",
      }),
      attempt({
        attemptId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        outcome: "passed",
      }),
    ],
    exercises.slice(0, 1),
    now,
  );
  assert.equal(recommendation, null);
});

test("a passed independent attempt with hints recommends an unassisted retry", () => {
  const recommendation = recommendPractice(
    [attempt({ outcome: "passed", hintsUsed: 2 })],
    exercises,
    now,
  );
  assert.equal(recommendation?.exerciseId, "count-positive");
  assert.match(recommendation?.reason ?? "", /without hints/);
});

test("a guided success recommends the independent follow-up", () => {
  const recommendation = recommendPractice(
    [
      attempt({
        concept: "early_return",
        exerciseId: "find-first",
        attemptType: "guided",
        outcome: "passed",
        occurredAt: "2026-10-10T11:30:00.000Z",
      }),
    ],
    exercises,
    now,
  );
  assert.equal(recommendation?.concept, "early_return");
  assert.equal(recommendation?.exerciseId, "contains-target");
  assert.equal(recommendation?.attemptType, "independent");
});

test("guided failures across all concepts recommend a guided retry", () => {
  const failures = exercises.map((exercise, index) =>
    attempt({
      attemptId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      concept: exercise.concept,
      exerciseId: exercise.guidedExerciseId,
      attemptType: "guided",
      outcome: "failed",
    }),
  );
  const recommendation = recommendPractice(failures, exercises, now);
  assert.equal(recommendation?.concept, "accumulator");
  assert.equal(recommendation?.exerciseId, "sum-numbers");
  assert.equal(recommendation?.attemptType, "guided");
  assert.match(recommendation?.reason ?? "", /guided run did not pass/);
});

test("guided errors and timeouts also recommend retrying the guided exercise", () => {
  for (const outcome of ["error", "timed_out"] as const) {
    const recommendation = recommendPractice(
      [
        attempt({
          concept: "off_by_one",
          exerciseId: "inclusive-range-sum",
          attemptType: "guided",
          outcome,
        }),
      ],
      exercises,
      now,
    );
    assert.equal(recommendation?.exerciseId, "inclusive-range-sum");
    assert.equal(recommendation?.attemptType, "guided");
  }
});

test("assisted independent passes outrank guided retries", () => {
  const recommendation = recommendPractice(
    [
      attempt({
        outcome: "passed",
        hintsUsed: 1,
        occurredAt: "2026-10-10T09:00:00.000Z",
      }),
      attempt({
        attemptId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        concept: "early_return",
        exerciseId: "find-first",
        attemptType: "guided",
        outcome: "failed",
        occurredAt: "2026-10-10T11:00:00.000Z",
      }),
    ],
    exercises,
    now,
  );
  assert.equal(recommendation?.concept, "accumulator");
  assert.equal(recommendation?.attemptType, "independent");
});

test("guided retries outrank revisits and untouched lessons", () => {
  const recommendation = recommendPractice(
    [
      attempt({
        concept: "accumulator",
        exerciseId: "sum-numbers",
        attemptType: "guided",
        outcome: "error",
      }),
      attempt({
        concept: "off_by_one",
        exerciseId: "inclusive-square-sum",
        attemptType: "independent",
        outcome: "passed",
        occurredAt: new Date(
          now.getTime() - REVISIT_INTERVAL_MS - 1,
        ).toISOString(),
      }),
    ],
    exercises,
    now,
  );
  assert.equal(recommendation?.concept, "accumulator");
  assert.equal(recommendation?.attemptType, "guided");
});

test("an unassisted independent pass is revisited after 24 hours only", () => {
  const pass = attempt({
    outcome: "passed",
    hintsUsed: 0,
    occurredAt: new Date(now.getTime() - REVISIT_INTERVAL_MS + 1).toISOString(),
  });
  assert.equal(recommendPractice([pass], exercises.slice(0, 1), now), null);
  pass.occurredAt = new Date(
    now.getTime() - REVISIT_INTERVAL_MS,
  ).toISOString();
  assert.match(
    recommendPractice([pass], exercises.slice(0, 1), now)?.reason ?? "",
    /24 hours/,
  );
});

test("unattempted lessons are a deterministic fallback when no revisit is due", () => {
  const recommendation = recommendPractice([], exercises, now);
  assert.equal(recommendation?.concept, "accumulator");
  assert.equal(recommendation?.exerciseId, "sum-numbers");
  assert.equal(recommendation?.attemptType, "guided");
});
