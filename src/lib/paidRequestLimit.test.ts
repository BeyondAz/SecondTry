import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  checkPaidRequestLimit,
  paidRequestLimitResponse,
} from "./paidRequestLimit.ts";

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  redisUrl: process.env.UPSTASH_REDIS_REST_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  fetch: globalThis.fetch,
};

after(() => {
  setEnvironment("NODE_ENV", originalEnvironment.nodeEnv);
  setEnvironment("UPSTASH_REDIS_REST_URL", originalEnvironment.redisUrl);
  setEnvironment("UPSTASH_REDIS_REST_TOKEN", originalEnvironment.redisToken);
  globalThis.fetch = originalEnvironment.fetch;
});

function setEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requestFrom(
  address: string,
  path = "/api/fix",
): Request {
  return new Request(`https://pyspace.example${path}`, {
    headers: { "x-real-ip": address },
  });
}

function uniqueAddress(prefix: string): string {
  return `${prefix}.${1 + Math.floor(Math.random() * 250)}`;
}

test("shares ten hourly requests and gives retry guidance", async () => {
  setEnvironment("NODE_ENV", "test");
  setEnvironment("UPSTASH_REDIS_REST_URL", undefined);
  setEnvironment("UPSTASH_REDIS_REST_TOKEN", undefined);
  const address = uniqueAddress("192.0.2");

  for (let count = 0; count < 10; count += 1) {
    const path = count % 2 === 0 ? "/api/fix" : "/api/speak";
    assert.deepEqual(
      await checkPaidRequestLimit(requestFrom(address, path)),
      { allowed: true },
    );
  }

  const response = paidRequestLimitResponse(
    await checkPaidRequestLimit(requestFrom(address)),
  );
  assert.equal(response?.status, 429);
  assert.ok(Number(response?.headers.get("Retry-After")) > 0);
  assert.match(await response!.text(), /inputs are still here/);
});

test("keeps visitor counters separate", async () => {
  setEnvironment("NODE_ENV", "test");
  setEnvironment("UPSTASH_REDIS_REST_URL", undefined);
  setEnvironment("UPSTASH_REDIS_REST_TOKEN", undefined);
  const firstVisitor = requestFrom(uniqueAddress("198.51.100"));
  const secondVisitor = requestFrom(uniqueAddress("203.0.113"));

  for (let count = 0; count < 10; count += 1) {
    assert.deepEqual(await checkPaidRequestLimit(firstVisitor), {
      allowed: true,
    });
  }
  assert.equal(
    paidRequestLimitResponse(await checkPaidRequestLimit(firstVisitor))?.status,
    429,
  );
  assert.deepEqual(await checkPaidRequestLimit(secondVisitor), {
    allowed: true,
  });
});

test("fails closed in production without shared counters or a trusted client IP", async () => {
  setEnvironment("NODE_ENV", "production");
  setEnvironment("UPSTASH_REDIS_REST_URL", undefined);
  setEnvironment("UPSTASH_REDIS_REST_TOKEN", undefined);

  const noConfiguration = await checkPaidRequestLimit(
    requestFrom("203.0.113.10"),
  );
  assert.deepEqual(noConfiguration, { allowed: false, unavailable: true });
  assert.equal(paidRequestLimitResponse(noConfiguration)?.status, 503);

  assert.deepEqual(
    await checkPaidRequestLimit(new Request("https://pyspace.example/api/speak")),
    { allowed: false, unavailable: true },
  );
});

test("uses an atomic shared Redis counter without exposing its token", async () => {
  setEnvironment("NODE_ENV", "production");
  setEnvironment("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
  setEnvironment("UPSTASH_REDIS_REST_TOKEN", "unit-test-token");
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

  for (let current = 0; current < 10; current += 1) {
    assert.deepEqual(
      await checkPaidRequestLimit(requestFrom("192.0.2.250")),
      { allowed: true },
    );
  }
  const limited = await checkPaidRequestLimit(requestFrom("192.0.2.250"));
  assert.equal(paidRequestLimitResponse(limited)?.status, 429);
  assert.equal(count, 11);
});
