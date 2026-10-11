import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  checkPaidRequestLimit,
  paidRequestLimitResponse,
} from "../src/lib/paidRequestLimit.ts";

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  redisUrl: process.env.UPSTASH_REDIS_REST_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  fetch: globalThis.fetch,
};

after(() => {
  if (originalEnvironment.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalEnvironment.nodeEnv;
  }
  if (originalEnvironment.redisUrl === undefined) {
    delete process.env.UPSTASH_REDIS_REST_URL;
  } else {
    process.env.UPSTASH_REDIS_REST_URL = originalEnvironment.redisUrl;
  }
  if (originalEnvironment.redisToken === undefined) {
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  } else {
    process.env.UPSTASH_REDIS_REST_TOKEN = originalEnvironment.redisToken;
  }
  globalThis.fetch = originalEnvironment.fetch;
});

function requestFrom(address, path = "/api/fix") {
  return new Request(`https://pyspace.example${path}`, {
    headers: { "x-real-ip": address },
  });
}

test("enforces one shared hourly budget and returns retry guidance", async () => {
  process.env.NODE_ENV = "test";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const request = requestFrom(`192.0.2.${1 + Math.floor(Math.random() * 250)}`);

  for (let count = 0; count < 10; count += 1) {
    const path = count % 2 === 0 ? "/api/fix" : "/api/speak";
    assert.deepEqual(
      await checkPaidRequestLimit(requestFrom(request.headers.get("x-real-ip"), path)),
      { allowed: true },
    );
  }

  const limited = await checkPaidRequestLimit(request);
  assert.equal(limited.allowed, false);
  if (limited.allowed || "unavailable" in limited) {
    assert.fail("The eleventh request should be rate limited.");
  }
  const response = paidRequestLimitResponse(limited);
  assert.equal(response?.status, 429);
  assert.ok(Number(response?.headers.get("Retry-After")) > 0);
  if (!response) assert.fail("A limited request should receive a response.");
  assert.match(await response.text(), /inputs are still here/);
});

test("keeps visitor counters separate", async () => {
  process.env.NODE_ENV = "test";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const firstVisitor = requestFrom(
    `198.51.100.${1 + Math.floor(Math.random() * 250)}`,
  );
  const secondVisitor = requestFrom(
    `203.0.113.${1 + Math.floor(Math.random() * 250)}`,
  );

  for (let count = 0; count < 10; count += 1) {
    assert.deepEqual(await checkPaidRequestLimit(firstVisitor), { allowed: true });
  }
  assert.equal(
    paidRequestLimitResponse(await checkPaidRequestLimit(firstVisitor))?.status,
    429,
  );
  assert.deepEqual(await checkPaidRequestLimit(secondVisitor), { allowed: true });
});

test("fails closed in production without the shared counter", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const result = await checkPaidRequestLimit(requestFrom("203.0.113.10"));
  assert.deepEqual(result, { allowed: false, unavailable: true });
  assert.equal(paidRequestLimitResponse(result)?.status, 503);
});

test("uses an atomic shared Redis counter", async () => {
  process.env.NODE_ENV = "production";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "unit-test-token";
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://redis.example.test/pipeline");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer unit-test-token");
    const commands = JSON.parse(String(init?.body));
    assert.equal(commands[0][0], "EVAL");
    count += 1;
    return new Response(JSON.stringify([{ result: count }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const request = requestFrom("192.0.2.250");
    for (let current = 0; current < 10; current += 1) {
      assert.deepEqual(await checkPaidRequestLimit(request), { allowed: true });
    }
    const limited = await checkPaidRequestLimit(request);
    assert.equal(limited.allowed, false);
    assert.equal(count, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
