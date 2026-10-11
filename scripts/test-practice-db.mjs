import assert from "node:assert/strict";

const baseUrl = process.env.PRACTICE_TEST_BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;

async function send(path, { method = "GET", cookie, body } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(method === "POST" ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach the configured local Pyspace server.");
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Pyspace returned an invalid response.");
  }
  return { response, data };
}

async function createLearner() {
  const { response, data } = await send("/api/practice/session", {
    method: "POST",
  });
  assert.equal(response.status, 200, "session initialization must succeed");
  assert.match(data.sessionId, /^[0-9a-f-]{36}$/i, "session ID must be a UUID");
  const setCookie = response.headers.getSetCookie().find((value) =>
    value.startsWith("second_try_learner="),
  );
  assert.ok(setCookie, "new learner must receive an HttpOnly cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /;\s*Domain=/i);
  return {
    cookie: setCookie.split(";", 1)[0],
    sessionId: data.sessionId,
  };
}

async function save(cookie, payload, expectedStatus = 200) {
  const { response, data } = await send("/api/practice/attempts", {
    method: "POST",
    cookie,
    body: payload,
  });
  assert.equal(
    response.status,
    expectedStatus,
    `attempt endpoint should return ${expectedStatus}; response details omitted`,
  );
  return data;
}

const owner = await createLearner();
const otherOwner = await createLearner();
const failedEvent = {
  attemptId: crypto.randomUUID(),
  sessionId: owner.sessionId,
  exerciseId: "count-positive",
  hintsUsed: 1,
  outcome: "failed",
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
};

const original = await save(owner.cookie, failedEvent);
assert.equal(original.idempotentReplay, false);
const replay = await save(owner.cookie, failedEvent);
assert.equal(replay.idempotentReplay, true);
assert.equal(replay.createdAt, original.createdAt);
assert.equal(replay.occurredAt, original.occurredAt);

const concurrentEvent = {
  ...failedEvent,
  attemptId: crypto.randomUUID(),
  outcome: "error",
  occurredAt: new Date(Date.now() - 30_000).toISOString(),
};
const concurrent = await Promise.all([
  save(owner.cookie, concurrentEvent),
  save(owner.cookie, concurrentEvent),
]);
assert.equal(concurrent.filter((item) => !item.idempotentReplay).length, 1);
assert.equal(concurrent.filter((item) => item.idempotentReplay).length, 1);
assert.equal(concurrent[0].createdAt, concurrent[1].createdAt);
assert.equal(concurrent[0].occurredAt, concurrent[1].occurredAt);

await save(
  owner.cookie,
  { ...failedEvent, outcome: "passed" },
  409,
);
await save(
  owner.cookie,
  { ...failedEvent, occurredAt: new Date(Date.parse(failedEvent.occurredAt) + 1).toISOString() },
  409,
);
await save(
  owner.cookie,
  { ...failedEvent, attemptId: crypto.randomUUID(), occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() },
  400,
);
await save(
  owner.cookie,
  { ...failedEvent, attemptId: crypto.randomUUID(), exerciseId: "unknown" },
  400,
);
await save(
  owner.cookie,
  { ...failedEvent, attemptId: crypto.randomUUID(), hintsUsed: 4 },
  400,
);
await save(
  owner.cookie,
  { ...failedEvent, attemptId: crypto.randomUUID(), sessionId: otherOwner.sessionId },
  403,
);

const afterRefresh = await send("/api/practice/history", {
  cookie: owner.cookie,
});
assert.equal(afterRefresh.response.status, 200);
assert.ok(
  afterRefresh.data.attempts.some(
    (attempt) => attempt.attemptId === failedEvent.attemptId,
  ),
  "history must survive a separate request using the same learner cookie",
);
assert.equal(afterRefresh.data.recommendation.concept, "accumulator");
assert.equal(afterRefresh.data.summary.failedIndependentRuns, 2);

const unassistedPass = {
  ...failedEvent,
  attemptId: crypto.randomUUID(),
  hintsUsed: 0,
  outcome: "passed",
  occurredAt: new Date().toISOString(),
};
await save(owner.cookie, unassistedPass);
const delayedFailure = {
  ...failedEvent,
  attemptId: crypto.randomUUID(),
  occurredAt: new Date(Date.now() - 2 * 60_000).toISOString(),
};
const delayedFailureReplay = await save(owner.cookie, delayedFailure);
assert.equal(delayedFailureReplay.idempotentReplay, false);
const repeatedDelayedFailure = await save(owner.cookie, delayedFailure);
assert.equal(repeatedDelayedFailure.idempotentReplay, true);
assert.equal(delayedFailureReplay.occurredAt, delayedFailure.occurredAt);
await save(
  owner.cookie,
  { ...delayedFailure, occurredAt: new Date(Date.parse(delayedFailure.occurredAt) + 1).toISOString() },
  409,
);
const resolved = await send("/api/practice/history", {
  cookie: owner.cookie,
});
assert.equal(resolved.response.status, 200);
assert.notEqual(resolved.data.recommendation.concept, "accumulator");

const guidedFailureLearner = await createLearner();
const sharedGuidedOccurrence = new Date(Date.now() - 60_000).toISOString();
for (const [exerciseId, outcome] of [
  ["sum-numbers", "failed"],
  ["find-first", "error"],
  ["inclusive-range-sum", "timed_out"],
]) {
  await save(guidedFailureLearner.cookie, {
    attemptId: crypto.randomUUID(),
    sessionId: guidedFailureLearner.sessionId,
    exerciseId,
    hintsUsed: 0,
    outcome,
    occurredAt: sharedGuidedOccurrence,
  });
}
const guidedFailureRecommendation = await send("/api/practice/history", {
  cookie: guidedFailureLearner.cookie,
});
assert.equal(guidedFailureRecommendation.response.status, 200);
assert.equal(
  guidedFailureRecommendation.data.recommendation.attemptType,
  "guided",
);
assert.equal(
  guidedFailureRecommendation.data.recommendation.exerciseId,
  "sum-numbers",
);

const guidedLearner = await createLearner();
await save(guidedLearner.cookie, {
  attemptId: crypto.randomUUID(),
  sessionId: guidedLearner.sessionId,
  exerciseId: "sum-numbers",
  hintsUsed: 0,
  outcome: "passed",
  occurredAt: new Date().toISOString(),
});
const guidedRecommendation = await send("/api/practice/history", {
  cookie: guidedLearner.cookie,
});
assert.equal(guidedRecommendation.response.status, 200);
assert.equal(
  guidedRecommendation.data.recommendation.exerciseId,
  "count-positive",
);

const separated = await send("/api/practice/history", {
  cookie: otherOwner.cookie,
});
assert.equal(separated.response.status, 200);
assert.equal(separated.data.attempts.length, 0);

console.log(
  "Practice DB integration passed: isolated learners, refresh persistence, occurrence-ordered delayed retries, concurrent/idempotent/conflicting retries, validation, authorization, and guided/independent recommendations.",
);
