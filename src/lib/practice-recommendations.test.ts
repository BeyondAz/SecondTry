import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommonMistakePatterns,
  recommendPractice,
  REVISIT_INTERVAL_MS,
  type RecommendationAttempt,
  type RecommendationExercise,
} from "./practice-recommendations.ts";
import {
  appendMistakePatternEvent,
  MAX_MISTAKE_PATTERN_EVENTS,
  parseMistakePatternEvents,
  serializeMistakePatternEvents,
} from "./mistake-pattern-storage.ts";

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

test("common mistake patterns count saved Fix my code classifications and link to guided practice", () => {
  const patterns = getCommonMistakePatterns(
    [
      "off_by_one",
      "accumulator",
      "accumulator",
      "early_return",
    ],
    exercises,
  );

  assert.deepEqual(patterns, [
    {
      concept: "accumulator",
      fixCount: 2,
      guidedExerciseId: "sum-numbers",
    },
    {
      concept: "early_return",
      fixCount: 1,
      guidedExerciseId: "find-first",
    },
    {
      concept: "off_by_one",
      fixCount: 1,
      guidedExerciseId: "inclusive-range-sum",
    },
  ]);
});

test("common mistake pattern ties follow the stable concept order", () => {
  const patterns = getCommonMistakePatterns(
    ["off_by_one", "early_return", "accumulator"],
    exercises,
  );

  assert.deepEqual(
    patterns.map(({ concept }) => concept),
    ["accumulator", "early_return", "off_by_one"],
  );
});

test("corrections outside guided patterns survive storage and appear in frequency metrics", () => {
  const events = appendMistakePatternEvent(["accumulator", "other"], "other");
  const parsed = parseMistakePatternEvents(serializeMistakePatternEvents(events));
  assert.equal(parsed.malformed, false);
  assert.deepEqual(parsed.events, events);
  assert.deepEqual(getCommonMistakePatterns(parsed.events, exercises), [
    { concept: "other", fixCount: 2, guidedExerciseId: null },
    { concept: "accumulator", fixCount: 1, guidedExerciseId: "sum-numbers" },
  ]);
  assert.deepEqual(getCommonMistakePatterns(["other"], exercises), [
    { concept: "other", fixCount: 1, guidedExerciseId: null },
  ]);
});

test("local mistake history accepts versioned data and safely bounds stored events", () => {
  const events: ("accumulator" | "off_by_one")[] = Array.from(
    { length: MAX_MISTAKE_PATTERN_EVENTS + 3 },
    (_, index) => (index % 2 === 0 ? "accumulator" : "off_by_one"),
  );
  const parsed = parseMistakePatternEvents(
    serializeMistakePatternEvents(events),
  );

  assert.equal(parsed.malformed, false);
  assert.deepEqual(
    parsed.events,
    events.slice(-MAX_MISTAKE_PATTERN_EVENTS),
  );
});

test("missing or malformed local mistake history does not break practice", () => {
  assert.deepEqual(parseMistakePatternEvents(null), {
    events: [],
    malformed: false,
  });
  assert.deepEqual(parseMistakePatternEvents("{not-json"), {
    events: [],
    malformed: true,
  });
  assert.deepEqual(
    parseMistakePatternEvents(
      JSON.stringify({ version: 2, events: ["accumulator"] }),
    ),
    { events: [], malformed: true },
  );
  assert.deepEqual(
    parseMistakePatternEvents(
      JSON.stringify({ version: 1, events: ["unknown"] }),
    ),
    { events: [], malformed: true },
  );
});

test("local mistake history keeps only the latest 50 classifications", () => {
  const events = Array.from({ length: MAX_MISTAKE_PATTERN_EVENTS }, () =>
    "accumulator" as const,
  );
  assert.deepEqual(
    appendMistakePatternEvent(events, "off_by_one").slice(0, 2),
    ["accumulator", "accumulator"],
  );
  assert.equal(
    appendMistakePatternEvent(events, "off_by_one").at(-1),
    "off_by_one",
  );
  assert.equal(
    appendMistakePatternEvent(events, "off_by_one").length,
    MAX_MISTAKE_PATTERN_EVENTS,
  );
});
