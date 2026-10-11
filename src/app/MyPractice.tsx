"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getExercise, getLessonForConcept, lessons } from "@/lib/lessons";
import type {
  PracticeRecommendation,
  PracticeOutcome,
  PracticeAttemptType,
  PracticeConcept,
  MistakePattern,
} from "@/lib/practice-recommendations";
import { getCommonMistakePatterns } from "@/lib/practice-recommendations";
import type { PracticeSessionStatus } from "@/lib/practice-client";

type HistoryAttempt = {
  attemptId: string;
  exerciseId: string;
  concept: PracticeConcept;
  createdAt: string;
  occurredAt: string;
  passed: boolean;
  hintsUsed: number;
  attemptType: PracticeAttemptType;
  outcome: PracticeOutcome;
};

type HistoryData = {
  attempts: HistoryAttempt[];
  summary: {
    testRuns: number;
    failedIndependentRuns: number;
    independentPassesWithoutHints: number;
  };
  recommendation: PracticeRecommendation | null;
};

const outcomeLabels: Record<PracticeOutcome, string> = {
  passed: "Passed",
  failed: "Needs another try",
  error: "Python error",
  timed_out: "Timed out",
};

function isHistoryData(value: unknown): value is HistoryData {
  if (!value || typeof value !== "object") return false;
  const history = value as Record<string, unknown>;
  return (
    Array.isArray(history.attempts) &&
    typeof history.summary === "object" &&
    history.summary !== null &&
    typeof history.recommendation !== "undefined"
  );
}

function attemptTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 60 * 60_000) {
    return `${Math.floor(elapsed / 60_000)}m ago`;
  }
  if (elapsed < 24 * 60 * 60_000) {
    return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export default function MyPractice({
  sessionStatus,
  refreshVersion,
  onRetrySession,
  onOpenRecommendation,
  onRecommendationChange,
  mistakePatternEvents,
  patternTrackingStatus,
  patternTrackingNotice,
}: {
  sessionStatus: PracticeSessionStatus;
  refreshVersion: number;
  onRetrySession: () => void;
  onOpenRecommendation: (recommendation: PracticeRecommendation) => void;
  onRecommendationChange: (
    recommendation: PracticeRecommendation | null,
  ) => void;
  mistakePatternEvents: readonly MistakePattern[];
  patternTrackingStatus: "loading" | "ready" | "unavailable";
  patternTrackingNotice: string;
}) {
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const loadHistory = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/practice/history", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isHistoryData(body)) {
        throw new Error(
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Could not load your practice history.",
        );
      }
      if (version === requestVersion.current) {
        setHistory(body);
        onRecommendationChange(body.recommendation);
      }
    } catch (caught) {
      if (version === requestVersion.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your practice history.",
        );
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [onRecommendationChange]);

  useEffect(() => {
    if (sessionStatus !== "ready") {
      requestVersion.current += 1;
      return;
    }
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [loadHistory, refreshVersion, sessionStatus]);

  const recentAttempts = history?.attempts ?? [];
  const commonPatterns = getCommonMistakePatterns(
    mistakePatternEvents,
    lessons.map(({ id, guidedExerciseId }) => ({
      concept: id,
      guidedExerciseId,
    })),
  );
  const maxPatternCount = commonPatterns[0]?.fixCount ?? 0;

  return (
    <section className="my-practice" aria-labelledby="my-practice-title">
      <div className="my-practice-heading">
        <div>
          <p className="eyebrow">Your learning space</p>
          <h2 id="my-practice-title">My Practice</h2>
          <p className="practice-heading-copy">
            See what you have worked on and choose a useful next step.
          </p>
        </div>
        {sessionStatus === "ready" && (
          <button
            className="text-button history-refresh"
            onClick={() => void loadHistory()}
            disabled={loading}
          >
            <span aria-hidden="true">{loading ? "◌" : "↻"}</span>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      <section className="common-patterns-card" aria-labelledby="common-patterns-title">
        <p className="eyebrow">Practice from your fixes</p>
        <h3 id="common-patterns-title">Frequent fix patterns</h3>
        <p className="common-patterns-intro">
          Bar lengths compare how often a correction matched each pattern.
        </p>
        {patternTrackingNotice && (
          <p className="pattern-tracking-notice" role="status">
            {patternTrackingNotice}
          </p>
        )}
        {patternTrackingStatus === "loading" ? (
          <p className="common-patterns-empty">
            Loading fix patterns saved in this browser…
          </p>
        ) : commonPatterns.length === 0 ? (
          <p className="common-patterns-empty">
            No fix patterns yet. When a correction matches a practice pattern, it will appear here.
          </p>
        ) : (
          <ul className="common-pattern-list">
            {commonPatterns.map((pattern) => {
              const concept = pattern.concept;
              const lesson = concept === "other" ? null : getLessonForConcept(concept);
              const title = lesson?.title ?? "Other corrections";
              const exerciseId = pattern.guidedExerciseId;
              return (
                <li className="common-pattern" key={pattern.concept}>
                  <div className="common-pattern-copy">
                    <strong>{title}</strong>
                    <span>{lesson?.explanation ?? "Syntax, naming, types, and other fixes outside the guided practice patterns."}</span>
                    <progress
                      className="pattern-meter"
                      value={pattern.fixCount}
                      max={maxPatternCount}
                      aria-label={`${title} fix pattern frequency`}
                      aria-valuetext={`${pattern.fixCount} of ${mistakePatternEvents.length} recent classified corrections`}
                    />
                    <small>
                      {pattern.fixCount} of {mistakePatternEvents.length} recent{" "}
                      {mistakePatternEvents.length === 1
                        ? "classified correction"
                        : "classified corrections"}
                    </small>
                  </div>
                  {concept !== "other" && exerciseId && <button
                    className="button button-secondary common-pattern-action"
                    onClick={() =>
                      onOpenRecommendation({
                        concept,
                        exerciseId,
                        attemptType: "guided",
                        reason: "Practice this pattern with a guided exercise.",
                      })
                    }
                  >
                    Practice this pattern
                  </button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="practice-data-note">
        Patterns are AI-classified from Playground corrections and stored in
        this browser only. The latest 50 corrections are counted, including
        other corrections outside the guided practice patterns.
      </p>

      {sessionStatus === "loading" && (
        <div className="history-state" role="status">
          <span className="history-state-icon" aria-hidden="true">◌</span>
          <div>
            <strong>Connecting your practice history</strong>
            <p>Your Python workspace is ready while this loads.</p>
          </div>
        </div>
      )}
      {sessionStatus === "unavailable" && (
        <div className="history-error" role="status">
          <div>
            <strong>History is temporarily unavailable</strong>
            <p>Your lessons and Python practice still work. Saved history will show here when the connection is restored.</p>
          </div>
          <button className="button button-secondary" onClick={onRetrySession}>
            Try again
          </button>
        </div>
      )}
      {sessionStatus === "ready" && loading && (
        <div className="history-state" role="status">
          <span className="history-state-icon" aria-hidden="true">◌</span>
          <div>
            <strong>Loading your recent practice</strong>
            <p>This should only take a moment.</p>
          </div>
        </div>
      )}
      {sessionStatus === "ready" && !loading && error && (
        <div className="history-error" role="alert">
          <div>
            <strong>We couldn’t load your history</strong>
            <p>{error}</p>
          </div>
          <button className="button button-secondary" onClick={() => void loadHistory()}>
            Retry
          </button>
        </div>
      )}
      {sessionStatus === "ready" && !loading && !error && history && (
        <>
          <section className="recommendation-card" aria-labelledby="next-practice-title">
            <p className="eyebrow">Next practice</p>
            {history.recommendation ? (
              <>
                <span className="recommendation-type">
                  {history.recommendation.attemptType === "guided"
                    ? "Guided practice"
                    : "Independent practice"}
                </span>
                <h3 id="next-practice-title">
                  {getExercise(history.recommendation.exerciseId)?.title ??
                    "Recommended exercise"}
                </h3>
                <p>{history.recommendation.reason}</p>
                <button
                  className="button button-primary recommendation-action"
                  onClick={() => onOpenRecommendation(history.recommendation!)}
                >
                  {history.recommendation.attemptType === "guided"
                    ? "Start guided practice"
                    : "Try it independently"}
                  <span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <>
                <h3 id="next-practice-title">No retry needed right now</h3>
                <p>
                  Pick a pattern to review or return when you’re ready for another challenge.
                </p>
              </>
            )}
          </section>

          <details className="history-disclosure">
            <summary>
              Recent practice runs
              <span>Showing up to {recentAttempts.length} of the latest 50</span>
            </summary>
            <section className="history-list" aria-label="Recent practice runs">
              {recentAttempts.length === 0 ? (
                <p className="history-message">
                  No saved runs yet. Your completed lesson tests will appear here.
                </p>
              ) : (
                <ul>
                  {recentAttempts.map((attempt) => (
                    <li key={attempt.attemptId}>
                      <span
                        className={`outcome-icon outcome-icon-${attempt.outcome}`}
                        aria-hidden="true"
                      >
                        {attempt.outcome === "passed" ? "✓" : attempt.outcome === "failed" ? "↻" : "!"}
                      </span>
                      <div className="history-attempt-detail">
                        <strong>
                          {getExercise(attempt.exerciseId)?.title ?? "Reviewed exercise"}
                        </strong>
                        <span>
                          {getLessonForConcept(attempt.concept)?.title ??
                            attempt.concept.replace("_", " ")}
                          <span aria-hidden="true"> · </span>
                          {attempt.attemptType === "guided" ? "Guided" : "Independent"}
                          <span aria-hidden="true"> · </span>
                          {outcomeLabels[attempt.outcome]}
                          {attempt.hintsUsed > 0 &&
                            ` · ${attempt.hintsUsed} ${attempt.hintsUsed === 1 ? "hint" : "hints"}`}
                        </span>
                      </div>
                      <time dateTime={attempt.occurredAt} title={attemptTime(attempt.occurredAt)}>
                        {attemptTime(attempt.occurredAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </details>
        </>
      )}
    </section>
  );
}
