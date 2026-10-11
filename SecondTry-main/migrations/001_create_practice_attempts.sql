CREATE TABLE IF NOT EXISTS practice_attempts (
  attempt_id UUID PRIMARY KEY,
  learner_id UUID NOT NULL,
  session_id UUID NOT NULL,
  exercise_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  passed BOOLEAN NOT NULL,
  hints_used INTEGER NOT NULL CHECK (hints_used >= 0 AND hints_used <= 100),
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('guided', 'independent')),
  CHECK (length(exercise_id) BETWEEN 1 AND 100),
  CHECK (length(concept) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS practice_attempts_learner_recent_idx
  ON practice_attempts (learner_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS practice_attempts_learner_exercise_idx
  ON practice_attempts (learner_id, exercise_id, attempted_at DESC);
