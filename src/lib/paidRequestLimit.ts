import "server-only";

import { practiceQuery, isPracticeDatabaseConfigured } from "@/lib/db";
import {
  createPaidRequestLimiter,
  type PaidRequestLimitResult,
} from "@/lib/paidRequestLimitCore";

export {
  paidRequestLimitResponse,
  withPaidRequestLimit,
  type PaidRequestLimitResult,
} from "@/lib/paidRequestLimitCore";

const checkLimit = createPaidRequestLimiter({
  databaseConfigured: isPracticeDatabaseConfigured,
  nodeEnvironment: () => process.env.NODE_ENV,
  query: (sql, values) =>
    practiceQuery(sql, [...values]),
  logFailure: (category) => {
    console.error("Paid request limiter unavailable", { category });
  },
});

export function checkPaidRequestLimit(
  request: Request,
): Promise<PaidRequestLimitResult> {
  return checkLimit(request);
}
