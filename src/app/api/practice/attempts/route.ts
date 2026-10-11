import { z } from "zod";
import {
  assertSameOriginRequest,
  savePracticeAttempt,
} from "@/lib/practice-store";
import {
  parsePracticeJson,
  practiceErrorResponse,
  practiceJson,
} from "@/lib/practice-api";

const attemptRequestSchema = z
  .object({
    attemptId: z.string().uuid(),
    sessionId: z.string().uuid(),
    exerciseId: z.string().min(1).max(100),
    hintsUsed: z.number().int().min(0).max(3),
    outcome: z.enum(["passed", "failed", "error", "timed_out"]),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = attemptRequestSchema.safeParse(
      await parsePracticeJson(request),
    );
    if (!parsed.success) {
      return practiceJson({ error: "Practice attempt data is invalid." }, 400);
    }
    if (Date.parse(parsed.data.occurredAt) > Date.now() + 5 * 60 * 1_000) {
      return practiceJson(
        { error: "Practice attempt time cannot be more than five minutes in the future." },
        400,
      );
    }
    parsed.data.occurredAt = new Date(parsed.data.occurredAt).toISOString();
    const attempt = await savePracticeAttempt(request, parsed.data);
    return practiceJson(attempt);
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
