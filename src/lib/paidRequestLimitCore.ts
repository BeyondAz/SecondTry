import { createHash } from "node:crypto";
import { isIP } from "node:net";

const MAX_REQUESTS_PER_HOUR = 10;
const MAX_LOCAL_ENTRIES = 10_000;
const LOCAL_WINDOW_MS = 60 * 60 * 1000;

export const PAID_REQUEST_COUNTER_SQL = `
WITH database_clock AS MATERIALIZED (
  SELECT statement_timestamp() AS now
),
request_window AS MATERIALIZED (
  SELECT
    date_trunc('hour', now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS window_start,
    now
  FROM database_clock
),
updated_counter AS (
  INSERT INTO second_try.paid_request_counters
    (address_hash, window_start, request_count, expires_at)
  SELECT
    $1,
    window_start,
    1,
    window_start + INTERVAL '2 hours'
  FROM request_window
  ON CONFLICT (address_hash, window_start)
  DO UPDATE SET
    request_count = LEAST(
      second_try.paid_request_counters.request_count + 1,
      11
    ),
    expires_at = EXCLUDED.expires_at
  RETURNING address_hash, window_start, request_count
)
SELECT
  updated_counter.request_count,
  updated_counter.window_start,
  GREATEST(
    1,
    CEIL(EXTRACT(EPOCH FROM (
      request_window.window_start + INTERVAL '1 hour' - request_window.now
    )))
  )::integer AS retry_after_seconds
FROM updated_counter
JOIN request_window USING (window_start)
`;

export type PaidRequestLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }
  | { allowed: false; unavailable: true };

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

export async function withPaidRequestLimit<T>(
  request: Request,
  perform: () => Promise<T>,
  checkLimit: (
    request: Request,
  ) => Promise<PaidRequestLimitResult>,
): Promise<T | Response> {
  let result: PaidRequestLimitResult;
  try {
    result = await checkLimit(request);
  } catch (error) {
    console.error("Paid request limiter unavailable", {
      category: "unexpected",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    result = { allowed: false, unavailable: true };
  }
  const limited = paidRequestLimitResponse(result);
  if (limited) return limited;
  return perform();
}

export type PaidRequestCounterRow = {
  request_count: number;
  window_start: string | Date;
  retry_after_seconds: number;
};

type QueryResultLike = {
  rows: PaidRequestCounterRow[];
};

export type PaidRequestLimiterDependencies = {
  databaseConfigured: () => boolean;
  nodeEnvironment: () => string | undefined;
  query: (
    sql: string,
    values: readonly unknown[],
  ) => Promise<QueryResultLike>;
  now?: () => number;
  logFailure?: (category: "configuration" | "schema" | "timeout" | "database") => void;
};

type LocalCounter = {
  count: number;
  expiresAt: number;
};

function getClientAddress(request: Request): string | null {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  const trustedAddress = forwardedFor.split(",").at(-1)?.trim();
  return trustedAddress && isIP(trustedAddress) ? trustedAddress : null;
}

export function hashClientAddress(address: string): string {
  return createHash("sha256").update(address).digest("hex");
}

function classifyDatabaseFailure(
  error: unknown,
): "schema" | "timeout" | "database" {
  if (!error || typeof error !== "object") return "database";
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (candidate.code === "42P01" || candidate.code === "3F000") return "schema";
  if (
    candidate.code === "57014" ||
    (typeof candidate.name === "string" && /timeout/i.test(candidate.name)) ||
    (typeof candidate.message === "string" && /timeout/i.test(candidate.message))
  ) {
    return "timeout";
  }
  return "database";
}

export function createPaidRequestLimiter(
  dependencies: PaidRequestLimiterDependencies,
) {
  const localCounters = new Map<string, LocalCounter>();
  const now = dependencies.now ?? Date.now;

  function checkLocalLimit(
    addressHash: string,
    currentTime: number,
  ): PaidRequestLimitResult {
    for (const [entryKey, counter] of localCounters) {
      if (counter.expiresAt <= currentTime) localCounters.delete(entryKey);
    }

    const windowStart = Math.floor(currentTime / LOCAL_WINDOW_MS) * LOCAL_WINDOW_MS;
    const key = `${addressHash}:${windowStart}`;
    if (!localCounters.has(key) && localCounters.size >= MAX_LOCAL_ENTRIES) {
      return { allowed: false, unavailable: true };
    }

    const counter = localCounters.get(key) ?? {
      count: 0,
      expiresAt: windowStart + 2 * LOCAL_WINDOW_MS,
    };
    counter.count = Math.min(counter.count + 1, MAX_REQUESTS_PER_HOUR + 1);
    localCounters.set(key, counter);

    if (counter.count <= MAX_REQUESTS_PER_HOUR) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowStart + LOCAL_WINDOW_MS - currentTime) / 1000),
      ),
    };
  }

  return async function checkPaidRequestLimit(
    request: Request,
  ): Promise<PaidRequestLimitResult> {
    const address = getClientAddress(request);
    if (!address) {
      dependencies.logFailure?.("configuration");
      return { allowed: false, unavailable: true };
    }
    const addressHash = hashClientAddress(address);

    if (!dependencies.databaseConfigured()) {
      if (dependencies.nodeEnvironment() !== "production") {
        return checkLocalLimit(addressHash, now());
      }
      dependencies.logFailure?.("configuration");
      return { allowed: false, unavailable: true };
    }

    try {
      const result = await dependencies.query(PAID_REQUEST_COUNTER_SQL, [
        addressHash,
      ]);
      const row = result.rows[0];
      if (
        !row ||
        !Number.isInteger(row.request_count) ||
        row.request_count < 1 ||
        row.request_count > MAX_REQUESTS_PER_HOUR + 1 ||
        !Number.isInteger(row.retry_after_seconds) ||
        row.retry_after_seconds < 1 ||
        row.retry_after_seconds > 3600
      ) {
        dependencies.logFailure?.("database");
        return { allowed: false, unavailable: true };
      }
      if (row.request_count <= MAX_REQUESTS_PER_HOUR) {
        return { allowed: true };
      }
      return {
        allowed: false,
        retryAfterSeconds: row.retry_after_seconds,
      };
    } catch (error) {
      dependencies.logFailure?.(classifyDatabaseFailure(error));
      return { allowed: false, unavailable: true };
    }
  };
}
