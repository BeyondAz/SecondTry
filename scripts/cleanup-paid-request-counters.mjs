import { createPracticePool } from "./practice-db-config.mjs";

const pool = createPracticePool();
if (!pool) {
  console.error("DATABASE_URL is required to clean expired paid-request counters.");
  process.exitCode = 1;
} else {
  try {
    let totalDeleted = 0;
    const maxBatches = 10;
    const batchSize = 500;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const result = await pool.query(
        `WITH expired AS (
           SELECT ctid
           FROM second_try.paid_request_counters
           WHERE expires_at <= statement_timestamp()
           ORDER BY expires_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM second_try.paid_request_counters AS counters
         USING expired
         WHERE counters.ctid = expired.ctid`,
        [batchSize],
      );
      totalDeleted += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) < batchSize) break;
    }

    console.log(`Expired paid-request counter rows removed: ${totalDeleted}.`);
  } catch {
    console.error("Paid-request counter cleanup failed; connection details withheld.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
