import { NextResponse } from "next/server";
import {
  LEARNER_COOKIE_MAX_AGE_SECONDS,
  LEARNER_COOKIE_NAME,
  assertSameOriginRequest,
  createLearnerSession,
} from "@/lib/practice-store";
import {
  assertEmptyPracticeBody,
  practiceErrorResponse,
} from "@/lib/practice-api";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    await assertEmptyPracticeBody(request);
    const session = await createLearnerSession(request);
    const response = NextResponse.json(
      { sessionId: session.sessionId },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Vary: "Cookie",
        },
      },
    );
    if (session.cookieToken) {
      response.cookies.set(LEARNER_COOKIE_NAME, session.cookieToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: LEARNER_COOKIE_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
