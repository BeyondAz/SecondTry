import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createPracticePool } from "./practice-db-config.mjs";
import {
  createPaidRequestLimiter,
  hashClientAddress,
} from "../src/lib/paidRequestLimitCore.ts";

const pool = createPracticePool({ max: 6 });
if (!pool) {
  console.error(
    "DATABASE_URL is required; configure the authorized Tiger Data connection before this live test.",
  );
  process.exitCode = 1;
} else {
  const hashes = new Set();
  const makeRequest = (address, path = "/api/fix") =>
    new Request(`https://example.test${path}`, {
      headers: { "x-real-ip": address },
    });
  const makeAddress = () => {
    const address = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    hashes.add(hashClientAddress(address));
    return address;
  };
  const limiter = createPaidRequestLimiter({
    databaseConfigured: () => true,
    nodeEnvironment: () => "production",
    query: async (sql, values) => {
      const client = await pool.connect();
      try {
        return await client.query(sql, [...values]);
      } finally {
        client.release();
      }
    },
  });

  try {
    const schema = await pool.query(
      "SELECT to_regclass('second_try.paid_request_counters') IS NOT NULL AS available",
    );
    assert.equal(
      schema.rows[0].available,
      true,
      "Migration 003 is not applied; run npm run db:migrate:practice first.",
    );

    const sequentialAddress = makeAddress();
    for (let count = 1; count <= 10; count += 1) {
      const response = await limiter(makeRequest(sequentialAddress));
      assert.deepEqual(response, { allowed: true }, `request ${count} should pass`);
    }
    const eleventh = await limiter(makeRequest(sequentialAddress, "/api/speak"));
    assert.equal(eleventh.allowed, false);
    if (!eleventh.allowed && !("unavailable" in eleventh)) {
      assert.ok(eleventh.retryAfterSeconds >= 1);
      assert.ok(eleventh.retryAfterSeconds <= 3600);
    }

    const fixSpeakAddress = makeAddress();
    for (let count = 0; count < 5; count += 1) {
      assert.deepEqual(
        await limiter(makeRequest(fixSpeakAddress, "/api/fix")),
        { allowed: true },
      );
      assert.deepEqual(
        await limiter(makeRequest(fixSpeakAddress, "/api/speak")),
        { allowed: true },
      );
    }
    assert.equal(
      (await limiter(makeRequest(fixSpeakAddress))).allowed,
      false,
      "fix and speak must share one ten-request quota",
    );

    const separateVisitor = makeAddress();
    assert.deepEqual(await limiter(makeRequest(separateVisitor)), {
      allowed: true,
    });

    const concurrentAddress = makeAddress();
    const concurrent = await Promise.all(
      Array.from({ length: 24 }, () => limiter(makeRequest(concurrentAddress))),
    );
    assert.equal(
      concurrent.filter((result) => result.allowed).length,
      10,
      "concurrent requests across pool clients must admit exactly ten",
    );
    assert.equal(
      concurrent.filter(
        (result) => !result.allowed && !("unavailable" in result),
      ).length,
      14,
    );
    assert.ok(
      concurrent.every((result) => !("unavailable" in result)),
      "concurrent database updates must not fail",
    );

    const rolloverAddress = makeAddress();
    const rolloverHash = hashClientAddress(rolloverAddress);
    await pool.query(
      `INSERT INTO second_try.paid_request_counters
         (address_hash, window_start, request_count, expires_at)
       SELECT
         $1,
         date_trunc('hour', statement_timestamp() AT TIME ZONE 'UTC')
           AT TIME ZONE 'UTC' - INTERVAL '1 hour',
         10,
         date_trunc('hour', statement_timestamp() AT TIME ZONE 'UTC')
           AT TIME ZONE 'UTC' + INTERVAL '1 hour'
       ON CONFLICT (address_hash, window_start)
       DO UPDATE SET request_count = EXCLUDED.request_count,
                     expires_at = EXCLUDED.expires_at`,
      [rolloverHash],
    );
    assert.deepEqual(
      await limiter(makeRequest(rolloverAddress)),
      { allowed: true },
      "the previous UTC hour must not consume the current hour's quota",
    );

    console.log(
      "Paid-request limiter live checks passed: hourly quota, shared endpoints, visitor isolation, concurrency, retry timing, and UTC rollover.",
    );
  } catch {
    console.error(
      "Paid-request limiter live checks failed; database details withheld.",
    );
    process.exitCode = 1;
  } finally {
    if (hashes.size > 0) {
      try {
        await pool.query(
          `DELETE FROM second_try.paid_request_counters
           WHERE address_hash = ANY($1::char(64)[])`,
          [[...hashes]],
        );
      } catch {
        console.error(
          "Could not clean isolated paid-request test counters; they will expire automatically.",
        );
        process.exitCode = 1;
      }
    }
    await pool.end();
  }
}
