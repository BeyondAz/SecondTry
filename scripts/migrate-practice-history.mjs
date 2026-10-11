import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPracticePool } from "./practice-db-config.mjs";

const pool = createPracticePool();
if (!pool) {
  console.error("DATABASE_URL is required to apply the practice history migration.");
  process.exitCode = 1;
} else {
  try {
    const result = await pool.query(
      `SELECT
         to_regclass('second_try.learners') IS NOT NULL AS learners,
         to_regclass('second_try.practice_sessions') IS NOT NULL AS practice_sessions,
         to_regclass('second_try.attempts') IS NOT NULL AS attempts`,
    );
    const tables = result.rows[0];
    const presentCount = Object.values(tables).filter(Boolean).length;
    if (presentCount === 0) {
      const baseSql = await readFile(
        resolve("db/migrations/001_practice_history.sql"),
        "utf8",
      );
      await pool.query(baseSql);
    } else if (presentCount !== 3) {
      throw new Error("Practice history base schema is incomplete; inspect it before migration.");
    }

    const occurrenceState = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'second_try'
           AND table_name = 'attempts'
           AND column_name = 'occurred_at'
       ) AS occurrence_column,
       to_regclass('second_try.attempts_learner_occurrence_idx') IS NOT NULL AS occurrence_index,
       to_regclass('second_try.attempts_learner_concept_occurrence_idx') IS NOT NULL AS concept_occurrence_index`,
    );
    const occurrence = occurrenceState.rows[0];
    if (
      occurrence.occurrence_column &&
      occurrence.occurrence_index &&
      occurrence.concept_occurrence_index
    ) {
      console.log("Practice history migrations 001 and 002 are already applied; no changes made.");
    } else {
      const occurrenceSql = await readFile(
        resolve("db/migrations/002_practice_occurrence_order.sql"),
        "utf8",
      );
      await pool.query(occurrenceSql);
      console.log("Practice history migration 002 applied.");
    }
  } catch {
    console.error("Practice history migration failed; connection details withheld.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
