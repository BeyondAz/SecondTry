import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

const MAX_REQUESTS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_LOCAL_ENTRIES = 10_000;
const REDIS_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return count
`;
const redisResponseSchema = z
  .array(z.object({ result: z.number().int().positive() }).strict())
  .length(1);

type LocalCounter = {
  count: number;
  expiresAt: number;
};

export type PaidRequestLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }
  | { allowed: false; unavailable: true };

const localCounters = new Map<string, LocalCounter>();

function getClientAddress(request: Request): string | null {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  const trustedAddress = forwardedFor.split(",").at(-1)?.trim();
  return trustedAddress && isIP(trustedAddress) ? trustedAddress : null;
}

function createCounterKey(address: string, now: number): string {
  const addressHash = createHash("sha256").update(address).digest("hex");
  const windowNumber = Math.floor(now / WINDOW_MS);
  return `pyspace:paid:${windowNumber}:${addressHash}`;
}

function checkLocalLimit(key: string, now: number): PaidRequestLimitResult {
  for (const [entryKey, counter] of localCounters) {
    if (counter.expiresAt <= now) localCounters.delete(entryKey);
  }
  if (!localCounters.has(key) && localCounters.size >= MAX_LOCAL_ENTRIES) {
    return { allowed: false, unavailable: true };
  }

  const current = localCounters.get(key);
  const counter = {
    count: (current?.count ?? 0) + 1,
    expiresAt: current?.expiresAt ?? now + WINDOW_MS - (now % WINDOW_MS),
  };
  localCounters.set(key, counter);

  if (counter.count <= MAX_REQUESTS_PER_HOUR) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((counter.expiresAt - now) / 1000)),
  };
}

async function checkSharedLimit(
  key: string,
  now: number,
): Promise<PaidRequestLimitResult> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return process.env.NODE_ENV === "production"
      ? { allowed: false, unavailable: true }
      : checkLocalLimit(key, now);
  }

  const parsedUrl = new URL(redisUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Shared request counter must use HTTPS.");
  }

  const response = await fetch(
    `${parsedUrl.toString().replace(/\/+$/, "")}/pipeline`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["EVAL", REDIS_SCRIPT, "1", key, String(WINDOW_MS * 2)],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Shared request counter returned HTTP ${response.status}.`);
  }

  const parsedPayload = redisResponseSchema.safeParse(await response.json());
  if (!parsedPayload.success) {
    throw new Error("Shared request counter returned an invalid response.");
  }

  const count = parsedPayload.data[0].result;
  if (count <= MAX_REQUESTS_PER_HOUR) return { allowed: true };
  const nextWindow = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((nextWindow - now) / 1000)),
  };
}

export async function checkPaidRequestLimit(
  request: Request,
): Promise<PaidRequestLimitResult> {
  const address = getClientAddress(request);
  if (!address) return { allowed: false, unavailable: true };
  const now = Date.now();
  return checkSharedLimit(createCounterKey(address, now), now);
}

export function paidRequestLimitResponse(
  result: PaidRequestLimitResult,
): Response | null {
  if (result.allowed) return null;
  if ("unavailable" in result) {
    return Response.json(
      { error: "Paid features are temporarily unavailable. Please try again later." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return Response.json(
    {
      error:
        "The shared limit of 10 correction and narration requests per hour has been reached. Your code and inputs are still here; please try again after the limit resets.",
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}
