import { createPracticePool } from "./practice-db-config.mjs";

const pool = createPracticePool();
if (!pool) {
  console.error("DATABASE_URL is required to check practice tables.");
  process.exitCode = 1;
} else {
  try {
    const result = await pool.query(
      `SELECT
         to_regclass('second_try.learners') IS NOT NULL AS learners,
         to_regclass('second_try.practice_sessions') IS NOT NULL AS practice_sessions,
         to_regclass('second_try.attempts') IS NOT NULL AS attempts,
         EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'second_try'
             AND table_name = 'attempts'
             AND column_name = 'occurred_at'
         ) AS occurrence_column,
         to_regclass('second_try.attempts_learner_occurrence_idx') IS NOT NULL AS occurrence_index,
         to_regclass('second_try.attempts_learner_concept_occurrence_idx') IS NOT NULL AS concept_occurrence_index`,
    );
    const tables = result.rows[0];
    const baseApplied =
      tables.learners && tables.practice_sessions && tables.attempts;
    const applied =
      baseApplied &&
      tables.occurrence_column &&
      tables.occurrence_index &&
      tables.concept_occurrence_index;
    console.log(
      applied
        ? "Practice history migrations 001 and 002 are applied."
        : baseApplied
          ? "Practice history migration 002 is not applied; run npm run db:migrate:practice after reviewing the schema."
          : "Practice history base schema is incomplete or not applied; review before migration.",
    );
    if (!applied) process.exitCode = 2;
  } catch {
    console.error("Could not check practice tables; connection details withheld.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
