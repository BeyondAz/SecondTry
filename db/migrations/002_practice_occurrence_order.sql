BEGIN;

ALTER TABLE second_try.attempts
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

UPDATE second_try.attempts
SET occurred_at = created_at
WHERE occurred_at IS NULL;

ALTER TABLE second_try.attempts
  ALTER COLUMN occurred_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS attempts_learner_occurrence_idx
  ON second_try.attempts (learner_id, occurred_at DESC, attempt_id DESC);

CREATE INDEX IF NOT EXISTS attempts_learner_concept_occurrence_idx
  ON second_try.attempts
    (learner_id, concept, attempt_type, occurred_at DESC, attempt_id DESC);

COMMIT;
