BEGIN;
CREATE SCHEMA IF NOT EXISTS second_try;
CREATE TABLE IF NOT EXISTS second_try.learners (
  learner_id uuid PRIMARY KEY,
  credential_hash text NOT NULL UNIQUE CHECK (length(credential_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS second_try.practice_sessions (
  session_id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES second_try.learners(learner_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, session_id)
);
CREATE TABLE IF NOT EXISTS second_try.attempts (
  learner_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  session_id uuid NOT NULL,
  exercise_id text NOT NULL CHECK (exercise_id IN ('sum-numbers', 'count-positive', 'find-first', 'contains-target', 'inclusive-range-sum', 'inclusive-square-sum')),
  concept text NOT NULL CHECK (concept IN ('accumulator', 'early_return', 'off_by_one')),
  created_at timestamptz NOT NULL DEFAULT now(),
  passed boolean NOT NULL,
  hints_used smallint NOT NULL CHECK (hints_used BETWEEN 0 AND 3),
  attempt_type text NOT NULL CHECK (attempt_type IN ('guided', 'independent')),
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed', 'error', 'timed_out')),
  PRIMARY KEY (learner_id, attempt_id),
  FOREIGN KEY (learner_id, session_id) REFERENCES second_try.practice_sessions(learner_id, session_id),
  CHECK (passed = (outcome = 'passed')),
  CHECK (
    (exercise_id = 'sum-numbers' AND concept = 'accumulator' AND attempt_type = 'guided') OR
    (exercise_id = 'count-positive' AND concept = 'accumulator' AND attempt_type = 'independent') OR
    (exercise_id = 'find-first' AND concept = 'early_return' AND attempt_type = 'guided') OR
    (exercise_id = 'contains-target' AND concept = 'early_return' AND attempt_type = 'independent') OR
    (exercise_id = 'inclusive-range-sum' AND concept = 'off_by_one' AND attempt_type = 'guided') OR
    (exercise_id = 'inclusive-square-sum' AND concept = 'off_by_one' AND attempt_type = 'independent')
  )
);
CREATE INDEX IF NOT EXISTS attempts_learner_recent_idx ON second_try.attempts (learner_id, created_at DESC, attempt_id);
CREATE INDEX IF NOT EXISTS attempts_learner_concept_recent_idx ON second_try.attempts (learner_id, concept, created_at DESC, attempt_id);
COMMIT;
