"use client";

export type PracticeSessionStatus = "loading" | "ready" | "unavailable";

let sessionId: string | null = null;
let sessionPromise: Promise<string | null> | null = null;

export function getPracticeSessionId() {
  return sessionId;
}

export function initializePracticeSession(
  onStatus: (status: PracticeSessionStatus) => void,
) {
  if (sessionId) {
    onStatus("ready");
    return Promise.resolve(sessionId);
  }
  if (sessionPromise) return sessionPromise;

  onStatus("loading");
  sessionPromise = (async () => {
    try {
      const response = await fetch("/api/practice/session", {
        method: "POST",
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("sessionId" in body) ||
        typeof body.sessionId !== "string"
      ) {
        throw new Error("Practice session unavailable.");
      }
      sessionId = body.sessionId;
      onStatus("ready");
      return sessionId;
    } catch {
      onStatus("unavailable");
      return null;
    } finally {
      if (!sessionId) sessionPromise = null;
    }
  })();
  return sessionPromise;
}
