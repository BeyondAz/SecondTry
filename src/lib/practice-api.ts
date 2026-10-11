import "server-only";

import { NextResponse } from "next/server";
import { PracticeDatabaseUnavailableError } from "@/lib/db";
import { PracticeRequestError } from "@/lib/practice-store";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};
const MAX_REQUEST_BYTES = 4_096;

export function practiceJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: PRIVATE_HEADERS,
  });
}

export async function parsePracticeJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new PracticeRequestError("Request body is too large.", 413);
  }
  if (!request.body) {
    throw new PracticeRequestError("Request body must be valid JSON.", 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new PracticeRequestError("Request body is too large.", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PracticeRequestError("Request body must be valid JSON.", 400);
  }
}

export async function assertEmptyPracticeBody(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 0) {
    throw new PracticeRequestError("Request body must be empty.", 400);
  }
  if (!request.body) return;
  const reader = request.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value?.byteLength) {
      await reader.cancel();
      throw new PracticeRequestError("Request body must be empty.", 400);
    }
  }
}

export function practiceErrorResponse(error: unknown) {
  if (error instanceof PracticeRequestError) {
    return practiceJson({ error: error.message }, error.status);
  }
  if (error instanceof PracticeDatabaseUnavailableError) {
    return practiceJson(
      {
        error: "Practice history is temporarily unavailable. Local practice still works.",
        code: "PRACTICE_HISTORY_UNAVAILABLE",
      },
      503,
    );
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    console.error("Practice history database request failed; details withheld.");
    return practiceJson(
      {
        error: "Practice history is temporarily unavailable. Local practice still works.",
        code: "PRACTICE_HISTORY_UNAVAILABLE",
      },
      503,
    );
  }
  console.error("Practice history request failed; details withheld.");
  return practiceJson(
    {
      error: "Practice history is temporarily unavailable. Local practice still works.",
      code: "PRACTICE_HISTORY_UNAVAILABLE",
    },
    503,
  );
}
