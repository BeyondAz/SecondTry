import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaidRequestLimiter,
  hashClientAddress,
  PAID_REQUEST_COUNTER_SQL,
  paidRequestLimitResponse,
  withPaidRequestLimit,
  type PaidRequestLimitResult,
} from "./paidRequestLimitCore.ts";

const ADDRESS = "203.0.113.42";

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/fix", { headers });
}

function configuredLimiter(
  query: (sql: string, values: readonly unknown[]) => Promise<{
    rows: {
      request_count: number;
      window_start: string;
      retry_after_seconds: number;
    }[];
  }>,
) {
  return createPaidRequestLimiter({
    databaseConfigured: () => true,
    nodeEnvironment: () => "production",
    query,
  });
}

test("uses an atomic counter keyed only by the SHA-256 address hash", async () => {
  let observedValues: readonly unknown[] = [];
  const limiter = configuredLimiter(async (sql, values) => {
    assert.equal(sql, PAID_REQUEST_COUNTER_SQL);
    observedValues = values;
    return {
      rows: [
        {
          request_count: 1,
          window_start: "2026-01-01T00:00:00Z",
          retry_after_seconds: 3600,
        },
      ],
    };
  });

  assert.deepEqual(
    await limiter(request({ "x-real-ip": ADDRESS })),
    { allowed: true },
  );
  assert.deepEqual(observedValues, [hashClientAddress(ADDRESS)]);
  assert.notEqual(observedValues[0], ADDRESS);
  assert.match(PAID_REQUEST_COUNTER_SQL, /ON CONFLICT[\s\S]*DO UPDATE/);
  assert.match(PAID_REQUEST_COUNTER_SQL, /statement_timestamp\(\)/);
  assert.match(PAID_REQUEST_COUNTER_SQL, /LEAST\([\s\S]*11/);
});

test("uses one shared ten-request quota and isolates visitors", async () => {
  const counts = new Map<string, number>();
  const limiter = configuredLimiter(async (_sql, [addressHash]) => {
    const key = String(addressHash);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return {
      rows: [
        {
          request_count: Math.min(count, 11),
          window_start: "2026-01-01T00:00:00Z",
          retry_after_seconds: 42,
        },
      ],
    };
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.deepEqual(
      await limiter(request({ "x-real-ip": ADDRESS })),
      { allowed: true },
    );
  }
  assert.deepEqual(
    await limiter(request({ "x-real-ip": ADDRESS })),
    { allowed: false, retryAfterSeconds: 42 },
  );
  assert.deepEqual(
    await limiter(request({ "x-real-ip": "203.0.113.43" })),
    { allowed: true },
  );
});

test("uses the trusted address header and refuses invalid or missing addresses", async () => {
  const hashes: unknown[] = [];
  let queryCount = 0;
  const limiter = configuredLimiter(async (_sql, values) => {
    queryCount += 1;
    hashes.push(values[0]);
    return {
      rows: [
        {
          request_count: 1,
          window_start: "2026-01-01T00:00:00Z",
          retry_after_seconds: 3600,
        },
      ],
    };
  });

  await limiter(
    request({
      "x-real-ip": ADDRESS,
      "x-forwarded-for": "203.0.113.10, 203.0.113.11",
    }),
  );
  await limiter(
    request({ "x-forwarded-for": "203.0.113.10, 203.0.113.11" }),
  );
  assert.deepEqual(hashes, [
    hashClientAddress(ADDRESS),
    hashClientAddress("203.0.113.11"),
  ]);
  assert.deepEqual(
    await limiter(request({ "x-real-ip": "not-an-ip" })),
    { allowed: false, unavailable: true },
  );
  assert.equal(queryCount, 2);
});

test("uses memory only for unconfigured non-production environments", async () => {
  const local = createPaidRequestLimiter({
    databaseConfigured: () => false,
    nodeEnvironment: () => "development",
    query: async () => {
      throw new Error("must not query");
    },
    now: () => Date.UTC(2026, 0, 1, 0, 15),
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.deepEqual(
      await local(request({ "x-real-ip": ADDRESS })),
      { allowed: true },
    );
  }
  assert.deepEqual(
    await local(request({ "x-real-ip": ADDRESS })),
    { allowed: false, retryAfterSeconds: 2700 },
  );

  const production = createPaidRequestLimiter({
    databaseConfigured: () => false,
    nodeEnvironment: () => "production",
    query: async () => ({ rows: [] }),
  });
  assert.deepEqual(
    await production(request({ "x-real-ip": ADDRESS })),
    { allowed: false, unavailable: true },
  );
});

test("fails closed for missing counters, invalid results, and database failures", async () => {
  for (const failure of [
    { code: "42P01" },
    { code: "57014" },
    { code: "08006" },
  ]) {
    const limiter = configuredLimiter(async () => {
      throw failure;
    });
    assert.deepEqual(
      await limiter(request({ "x-real-ip": ADDRESS })),
      { allowed: false, unavailable: true },
    );
  }
  const malformed = configuredLimiter(async () => ({ rows: [] }));
  assert.deepEqual(
    await malformed(request({ "x-real-ip": ADDRESS })),
    { allowed: false, unavailable: true },
  );
});

test("returns no-store 503 and 429 responses with database retry time", () => {
  const unavailable = paidRequestLimitResponse({
    allowed: false,
    unavailable: true,
  });
  assert.equal(unavailable?.status, 503);
  assert.equal(unavailable?.headers.get("Cache-Control"), "private, no-store");
  const limited = paidRequestLimitResponse({
    allowed: false,
    retryAfterSeconds: 73,
  });
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("Retry-After"), "73");
  assert.equal(limited?.headers.get("Cache-Control"), "private, no-store");
});

test("never invokes a provider callback after a limit or unavailable result", async () => {
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return Response.json({ ok: true });
  };
  const fixedCheck = (result: PaidRequestLimitResult) =>
    async () => result;

  for (const result of [
    { allowed: false, retryAfterSeconds: 30 },
    { allowed: false, unavailable: true },
  ] as const) {
    const response = await withPaidRequestLimit(
      request(),
      provider,
      fixedCheck(result),
    );
    assert.ok(response instanceof Response);
    assert.equal(response.status, result.retryAfterSeconds ? 429 : 503);
  }
  assert.equal(providerCalls, 0);

  const thrown = await withPaidRequestLimit(
    request(),
    provider,
    async () => {
      throw new Error("connection string and bound values must not be logged");
    },
  );
  assert.ok(thrown instanceof Response);
  assert.equal(thrown.status, 503);
  assert.equal(providerCalls, 0);
});

test("invokes a provider only after an admitted request", async () => {
  let providerCalls = 0;
  const response = await withPaidRequestLimit(
    request(),
    async () => {
      providerCalls += 1;
      return Response.json({ ok: true });
    },
    async () => ({ allowed: true }),
  );
  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
});
