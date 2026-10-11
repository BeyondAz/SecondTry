-- Replace the UUID placeholder with the learner_id from the Tiger SQL Editor
-- or application diagnostics. These read-only queries never aggregate across learners.

-- Recent browser-reported practice events for one learner.
SELECT
  occurred_at,
  created_at,
  concept,
  exercise_id,
  attempt_type,
  outcome,
  hints_used
FROM second_try.attempts
WHERE learner_id = 'REPLACE_WITH_LEARNER_UUID'::uuid
ORDER BY occurred_at DESC, attempt_id DESC
LIMIT 50;

-- Latest outcome by concept and attempt type for recommendations.
SELECT DISTINCT ON (concept, attempt_type)
  concept,
  attempt_type,
  exercise_id,
  outcome,
  hints_used,
  occurred_at,
  created_at AS recorded_at
FROM second_try.attempts
WHERE learner_id = 'REPLACE_WITH_LEARNER_UUID'::uuid
ORDER BY concept, attempt_type, occurred_at DESC, attempt_id DESC;

-- Daily event counts for one learner. These are events, not distinct learners
-- or verified assessments.
SELECT
  date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS utc_day,
  attempt_type,
  outcome,
  COUNT(*) AS test_runs
FROM second_try.attempts
WHERE learner_id = 'REPLACE_WITH_LEARNER_UUID'::uuid
GROUP BY utc_day, attempt_type, outcome
ORDER BY utc_day DESC, attempt_type, outcome;
