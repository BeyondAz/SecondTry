"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import MyPractice from "@/app/MyPractice";
import {
  createPythonRun,
  isPythonExampleCases,
  isPythonTestCases,
  type ExampleExpectationSource,
  type PythonExampleCase,
  type PythonResponse,
  type PythonRun,
  type PythonValue,
} from "@/lib/pythonRunner";
import {
  getExercise,
  getLessonForConcept,
  lessons,
  type Exercise,
  type Lesson,
} from "@/lib/lessons";
import { fixResultSchema, type FixRequest, type FixResult } from "@/lib/fix-schema";
import {
  initializePracticeSession,
  type PracticeSessionStatus,
} from "@/lib/practice-client";
import {
  MISTAKE_PATTERN_STORAGE_KEY,
  appendMistakePatternEvent,
  parseMistakePatternEvents,
  serializeMistakePatternEvents,
} from "@/lib/mistake-pattern-storage";
import type {
  PracticeConcept,
  PracticeRecommendation,
} from "@/lib/practice-recommendations";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const starterCode = `# Welcome to Pyspace
name = "world"
print(f"Hello, {name}!")
`;

const workspaceExamples = [
  {
    label: "Average",
    code: `def average(numbers):
    return sum(numbers) / len(number)

scores = [82, 91, 76]
print(f"The average score is {average(scores):.1f}")`,
    intendedBehavior: "Calculate the average of the scores.",
    errorMessage: "This example raises a NameError instead of printing 83.0.",
    exampleArguments: "[[82, 91, 76]]",
    expectedResult: "83.0",
  },
  {
    label: "Running total",
    code: `def sum_prices(prices):
    total = 0
    for price in prices:
        total = price
    return total

print(sum_prices([4, 2, 3]))`,
    intendedBehavior: "Add every price and print the total, 9.",
    errorMessage: "This example prints 3 because each loop replaces the total.",
    exampleArguments: "[[4, 2, 3]]",
    expectedResult: "9",
  },
  {
    label: "Range endpoint",
    code: `def sum_to(limit):
    total = 0
    for number in range(1, limit):
        total += number
    return total

print(sum_to(4))`,
    intendedBehavior: "Add every number from 1 through 4 and print 10.",
    errorMessage: "This example prints 6 because the range stops before 4.",
    exampleArguments: "[4]",
    expectedResult: "10",
  },
] as const;

function canonicalize(value: PythonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function valueLabel(value: PythonValue | undefined): string {
  return value === undefined ? "no result" : JSON.stringify(value);
}

type PracticeSavePayload = {
  attemptId: string;
  sessionId: string | null;
  exerciseId: string;
  hintsUsed: number;
  outcome: "passed" | "failed" | "error" | "timed_out";
  occurredAt: string;
};

type PendingPracticeSave = {
  payload: PracticeSavePayload;
  saving: boolean;
  error: string;
};

type WorkspaceView = "practice" | "playground" | "progress";

function WorkspaceHeader({
  activeView,
  onViewChange,
}: {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}) {
  const views: { id: WorkspaceView; label: string }[] = [
    { id: "playground", label: "Fix code" },
    { id: "practice", label: "Practice" },
    { id: "progress", label: "Progress" },
  ];

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M5 17c6-1 11-5 14-11 1 7-2 13-8 15-3 1-5-1-6-4Z" />
            <path d="M7 19c3-4 6-6 10-8" />
          </svg>
        </span>
        Pyspace
      </Link>
      <nav className="primary-nav" aria-label="Main navigation">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`nav-button ${activeView === view.id ? "nav-button-active" : ""}`}
            aria-current={activeView === view.id ? "page" : undefined}
            onClick={() => onViewChange(view.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {view.id === "practice" ? (
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="m3 10 9-7 9 7v10h-6v-6H9v6H3z" />
                </svg>
              ) : view.id === "playground" ? (
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M4 5h16v14H4zM8 10l3 2-3 2M14 14h3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M4 19V5M4 19h17M8 15v-4M13 15V7M18 15V4" />
                </svg>
              )}
            </span>
            <span className="nav-label">{view.label}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-note">
        <span className="status-dot" />
        Python runs locally in your browser
      </div>
    </header>
  );
}

function PipArtwork({
  className,
  label,
  decorative = false,
}: {
  className: string;
  label: string;
  decorative?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 108"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      shapeRendering="geometricPrecision"
    >
      <g className="pip-body">
        <path
          d="M68 66c-5 10-12 16-22 19-7 2-14-1-15-7-1-6 5-10 11-8 4 1 6 5 4 8"
          fill="none"
          stroke="#153b2e"
          strokeLinecap="round"
          strokeWidth="16"
        />
        <path
          d="M68 66c-5 10-12 16-22 19-7 2-14-1-15-7-1-6 5-10 11-8 4 1 6 5 4 8"
          fill="none"
          stroke="#d5e98c"
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path
          d="M42 78c-2 3-1 6 2 7"
          fill="none"
          stroke="#eff6bd"
          strokeLinecap="round"
          strokeWidth="3"
        />
        <path
          d="M65 61c2 5 5 8 9 11"
          fill="none"
          stroke="#153b2e"
          strokeLinecap="round"
          strokeWidth="15"
        />
        <path
          d="M65 61c2 5 5 8 9 11"
          fill="none"
          stroke="#d5e98c"
          strokeLinecap="round"
          strokeWidth="9"
        />
        <path d="M57 68c3 4 7 7 12 9l-5 7c-5-2-10-6-13-10Z" fill="#f0a63d" />
        <path d="M58 71c3 3 6 5 9 6" fill="none" stroke="#ffe7b6" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="pip-head">
        <path
          d="M49 61c-5-6-7-14-5-22 2-11 12-18 24-18 11 0 19 6 21 15 1 5 5 7 11 7h8c4 0 6 2 6 5s-2 5-6 5H96c-4 8-13 12-24 12-9 0-16-2-23-4Z"
          fill="#153b2e"
          transform="translate(0 2)"
        />
        <path
          d="M49 60c-5-6-7-14-5-22 2-11 12-18 24-18 11 0 19 6 21 15 1 5 5 7 11 7h8c4 0 6 2 6 5s-2 5-6 5H96c-4 8-13 12-24 12-9 0-16-2-23-4Z"
          fill="#d5e98c"
          stroke="#153b2e"
          strokeWidth="1.5"
        />
        <path
          d="M53 54c5 4 11 6 18 6"
          fill="none"
          stroke="#f2f6bd"
          strokeLinecap="round"
          strokeWidth="4"
        />
        <path
          d="M47 37c2-8 8-13 17-14"
          fill="none"
          stroke="#edf4b1"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </g>
      <g className="pip-face">
        <ellipse cx="70" cy="36" rx="4" ry="5" fill="#fffdf2" />
        <ellipse cx="87" cy="38" rx="4" ry="5" fill="#fffdf2" />
        <circle cx="71" cy="37" r="1.8" fill="#183c32" />
        <circle cx="88" cy="39" r="1.8" fill="#183c32" />
        <circle cx="78" cy="47" r="2" fill="#e99b79" opacity=".9" />
        <path
          d="M77 49c3 2 6 2 9 0"
          fill="none"
          stroke="#153b2e"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <circle cx="107" cy="47" r="1.2" fill="#153b2e" />
      </g>
      <g className="pip-accessory" aria-hidden="true">
        <path
          d="M53 21c2-7 8-11 15-11-1 7-5 12-12 14"
          fill="#91c94e"
          stroke="#153b2e"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M55 22c3-4 6-6 10-8" fill="none" stroke="#e9f5ae" strokeWidth="1.5" />
        <path
          d="M55 53c3 3 7 5 11 6"
          fill="none"
          stroke="#f0a63d"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}

type PipMood = "idle" | "thinking" | "encouraging" | "celebrating";

function PipCompanion({
  mood,
  placement,
  isOpen,
  onToggle,
  message,
  hintAvailable,
  canStartChallenge,
  onRequestHint,
  onStartChallenge,
  onClose,
}: {
  mood: PipMood;
  placement: "floating" | "inline";
  isOpen: boolean;
  onToggle: () => void;
  message: string;
  hintAvailable: boolean;
  canStartChallenge: boolean;
  onRequestHint: () => void;
  onStartChallenge: () => void;
  onClose: () => void;
}) {
  const moodLabels: Record<PipMood, string> = {
    idle: "Pip is ready to help",
    thinking: "Pip is thinking",
    encouraging: "Pip is encouraging another try",
    celebrating: "Pip is celebrating your passed tests",
  };

  return (
    <aside
      className={`pip-companion pip-companion-${placement} pip-companion-${mood}`}
      aria-label="Pip, your Python companion"
    >
      <div className="pip-bubble" id="pip-message" hidden={!isOpen}>
        <div className="pip-bubble-heading">
          <span className="pip-status-dot" aria-hidden="true" />
          <strong>Pip</strong>
          <span className="pip-mood-label">{moodLabels[mood]}</span>
          <button
            className="pip-dismiss"
            type="button"
            aria-label="Close Pip’s message"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p>{message}</p>
        {hintAvailable ? (
          <button
            className="pip-hint-button"
            type="button"
            onClick={onRequestHint}
          >
            Show me a hint <span aria-hidden="true">→</span>
          </button>
        ) : canStartChallenge ? (
          <button
            className="pip-hint-button"
            type="button"
            onClick={onStartChallenge}
          >
            Pick a challenge <span aria-hidden="true">→</span>
          </button>
        ) : null}
        {mood === "celebrating" && (
          <span className="pip-confetti" aria-hidden="true">
            ✦
          </span>
        )}
      </div>
      <button
        className="pip-companion-button"
        type="button"
        aria-label={isOpen ? "Hide Pip’s message" : "Open Pip’s message"}
        aria-expanded={isOpen}
        aria-controls="pip-message"
        onClick={onToggle}
      >
        <span className="pip-companion-halo" aria-hidden="true" />
        <PipArtwork
          className="pip-companion-art"
          label=""
          decorative
        />
        <span className="pip-companion-live" aria-hidden="true" />
      </button>
    </aside>
  );
}

function PracticeHome({
  recommendation,
  onStartLesson,
  onStartRecommendation,
}: {
  recommendation: PracticeRecommendation | null;
  onStartLesson: (lesson: Lesson) => void;
  onStartRecommendation: (recommendation: PracticeRecommendation) => void;
}) {
  const firstLesson = lessons[0];
  const exercise = recommendation
    ? getExercise(recommendation.exerciseId)
    : getExercise(firstLesson.guidedExerciseId);

  return (
    <section className="practice-home" aria-labelledby="practice-home-title">
      <section className="featured-challenge" aria-labelledby="practice-home-title">
        <div className="featured-challenge-copy">
          <span className="featured-label">
            {recommendation ? "Your recommended next step" : "A good place to start"}
          </span>
          <span className="recommendation-type">
            {recommendation
              ? recommendation.attemptType === "guided"
                ? "Guided practice"
                : "Independent practice"
              : "Guided practice"}
          </span>
          <h1 id="practice-home-title">Ready to grow your Python skills?</h1>
          <p>
            {recommendation?.reason ??
              "Pip is here to help. Try one small Python challenge and learn as you go."}
          </p>
          <p className="featured-next-up">
            Next up: <strong>{exercise?.title ?? "Choose a Python challenge"}</strong>
          </p>
          <button
            className="button button-primary featured-challenge-action"
            onClick={() => {
              if (recommendation) onStartRecommendation(recommendation);
              else onStartLesson(firstLesson);
            }}
          >
            {recommendation?.attemptType === "independent"
              ? "Continue independent practice"
              : recommendation
                ? "Start guided practice"
                : "Start a guided challenge"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="featured-challenge-art" aria-hidden="true">
          <svg
            className="pip-scene"
            viewBox="0 0 260 220"
          >
            <circle cx="173" cy="108" r="83" fill="#205A43" />
            <circle cx="206" cy="38" r="7" fill="#CDE77A" />
            <circle cx="63" cy="105" r="4" fill="#82C891" />
            <path d="m43 72 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill="#F1B14B" />
            <path d="m223 144 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill="#82C891" />
            <path d="M23 191c30-17 52-17 78-8" fill="none" stroke="#2B694F" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <PipArtwork
            className="pip-scene-character"
            label=""
            decorative
          />
        </div>
      </section>

      <section className="concept-section" aria-labelledby="concept-section-title">
        <div className="concept-section-heading">
          <div>
            <p className="eyebrow">Choose a pattern</p>
            <h2 id="concept-section-title">Three useful things to practice</h2>
          </div>
          <span>Short lessons, real Python</span>
        </div>
        <div className="concept-grid">
          {lessons.map((lesson, index) => (
            <article className={`concept-tile concept-tile-${index + 1}`} key={lesson.id}>
              <span className="concept-tile-number" aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{lesson.title}</h3>
              <p>{lesson.explanation}</p>
              <button
                className="text-button concept-tile-action"
                onClick={() => onStartLesson(lesson)}
              >
                Explore this pattern <span aria-hidden="true">→</span>
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function createNarrationAudio(
  setIsPlaying: (playing: boolean) => void,
  setError: (message: string) => void,
) {
  const audio = new Audio();
  audio.addEventListener("ended", () => setIsPlaying(false));
  audio.addEventListener("error", () => {
    setIsPlaying(false);
    setError("The generated audio could not be played.");
  });
  return audio;
}

function NarrationControls({ text }: { text: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = "";
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  async function playAudio(url: string) {
    const audio =
      audioRef.current ?? createNarrationAudio(setIsPlaying, setError);
    audioRef.current = audio;
    audio.pause();
    audio.setAttribute("src", url);
    audio.load();
    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
      setError("Audio playback was blocked. Try pressing Listen again.");
    }
  }

  async function listen() {
    if (isGenerating || !text.trim()) return;
    setError("");
    if (audioUrl) {
      await playAudio(audioUrl);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Narration could not be generated right now. Please retry.";
        throw new Error(message);
      }

      const url = URL.createObjectURL(await response.blob());
      if (controller.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      audioUrlRef.current = url;
      setAudioUrl(url);
      await playAudio(url);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Narration could not be generated right now. Please retry.",
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsGenerating(false);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    audioRef.current?.pause();
    audioRef.current?.load();
    setIsPlaying(false);
  }

  return (
    <div className="narration-controls" aria-label="Explanation audio controls">
      <button
        className="text-button"
        onClick={() => void listen()}
        disabled={isGenerating || !text.trim()}
      >
        {isGenerating ? "Loading audio…" : "Listen"}
      </button>
      <button
        className="text-button"
        onClick={stop}
        disabled={!isGenerating && !isPlaying}
      >
        Stop
      </button>
      <button
        className="text-button"
        onClick={() => audioUrl && void playAudio(audioUrl)}
        disabled={!audioUrl || isGenerating}
      >
        Replay
      </button>
      <span className="narration-status" aria-live="polite">
        {error || (isPlaying ? "Playing explanation" : "")}
      </span>
    </div>
  );
}

type ExampleOutcome = {
  actual: PythonValue | null;
  hasResult: boolean;
  error: string | null;
};

type ExampleSideResult = {
  status: string;
  outcomes: ExampleOutcome[];
};

type ExampleVerification = {
  cases: PythonExampleCase[];
  original: ExampleSideResult;
  corrected: ExampleSideResult;
};

function stableJson(value: PythonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function makeExampleSideResult(
  response: PythonResponse,
  cases: PythonExampleCase[],
): ExampleSideResult {
  const outcomes = cases.map((testCase, index) => {
    const hasResult = index < response.results.length;
    return {
      actual: hasResult ? response.results[index] : null,
      hasResult,
      error:
        response.error ??
        response.testErrors[index] ??
        (hasResult ? null : "No result was returned for this case."),
    };
  });

  if (response.timedOut) {
    return {
      status: "Execution timed out",
      outcomes: outcomes.map((outcome) => ({
        ...outcome,
        error: outcome.error ?? "Execution timed out.",
      })),
    };
  }
  if (response.error || outcomes.some((outcome) => outcome.error)) {
    return { status: "Execution error", outcomes };
  }
  if (
    outcomes.some(
      (outcome, index) =>
        !outcome.hasResult ||
        stableJson(outcome.actual) !== stableJson(cases[index].expected),
    )
  ) {
    return { status: "Failed an example test", outcomes };
  }
  return { status: `Passed ${cases.length} example tests`, outcomes };
}

function ExampleCaseResults({
  cases,
  outcomes,
}: {
  cases: PythonExampleCase[];
  outcomes: ExampleOutcome[];
}) {
  return (
    <div className="example-results-scroll">
      <table className="example-results">
        <thead>
          <tr>
            <th>Function</th>
            <th>Arguments</th>
            <th>Expected</th>
            <th>Actual</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((testCase, index) => (
            <tr key={`${testCase.functionName}-${index}`}>
              <td><code>{testCase.functionName}</code></td>
              <td><code>{JSON.stringify(testCase.args)}</code></td>
              <td><code>{JSON.stringify(testCase.expected)}</code></td>
              <td>
                <code>
                  {outcomes[index]?.hasResult
                    ? JSON.stringify(outcomes[index].actual)
                    : "—"}
                </code>
              </td>
              <td className={outcomes[index]?.error ? "example-error" : ""}>
                {outcomes[index]?.error ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PythonEditor({
  value,
  onChange,
  height = "360px",
}: {
  value: string;
  onChange: (value: string) => void;
  height?: string;
}) {
  return (
    <Editor
      height={height}
      language="python"
      theme="vs-dark"
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      options={{
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        wordWrap: "on",
        ariaLabel: "Python code editor",
      }}
    />
  );
}

export default function Home() {
  const [activeView, setActiveView] = useState<WorkspaceView>("playground");
  const [code, setCode] = useState(starterCode);
  const [testCases, setTestCases] = useState("[]");
  const [exampleCasesText, setExampleCasesText] = useState("[]");
  const [expectationSource, setExpectationSource] =
    useState<ExampleExpectationSource>("user-provided");
  const [reviewedAiExpectations, setReviewedAiExpectations] = useState(false);
  const [exampleCaseError, setExampleCaseError] = useState("");
  const [isVerifyingExamples, setIsVerifyingExamples] = useState(false);
  const [exampleVerification, setExampleVerification] =
    useState<ExampleVerification | null>(null);
  const [intendedBehavior, setIntendedBehavior] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [exampleArguments, setExampleArguments] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [originalFixCode, setOriginalFixCode] = useState("");
  const [fixError, setFixError] = useState("");
  const [isFixing, setIsFixing] = useState(false);
  const [lastFixRequest, setLastFixRequest] = useState<FixRequest | null>(null);
  const [output, setOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [observedError, setObservedError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingPython, setIsLoadingPython] = useState(false);
  const currentRunRef = useRef<PythonRun | null>(null);
  const verificationRunRef = useRef<PythonRun | null>(null);
  const verificationRequestIdRef = useRef(0);
  const activeRunIdRef = useRef("");

  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [recommendedPractice, setRecommendedPractice] =
    useState<PracticeRecommendation | null>(null);
  const [prediction, setPrediction] = useState("");
  const [predictionSubmitted, setPredictionSubmitted] = useState(false);
  const [practiceExercise, setPracticeExercise] = useState<Exercise | null>(null);
  const [practiceCode, setPracticeCode] = useState("");
  const [practiceAttempts, setPracticeAttempts] = useState(0);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [testFeedback, setTestFeedback] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [pipIsOpen, setPipIsOpen] = useState(false);
  const [pipCelebrating, setPipCelebrating] = useState(false);
  const [recommendedExerciseId, setRecommendedExerciseId] = useState<
    string | null
  >(null);
  const [practiceSessionStatus, setPracticeSessionStatus] =
    useState<PracticeSessionStatus>("loading");
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(
    null,
  );
  const [pendingPracticeSaves, setPendingPracticeSaves] = useState<
    PendingPracticeSave[]
  >([]);
  const [mistakePatternEvents, setMistakePatternEvents] = useState<
    PracticeConcept[]
  >([]);
  const [patternTrackingStatus, setPatternTrackingStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [patternTrackingNotice, setPatternTrackingNotice] = useState("");
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const practiceSessionIdRef = useRef<string | null>(null);
  const mistakePatternEventsRef = useRef<PracticeConcept[]>([]);
  const pendingPracticeSavesRef = useRef(
    new Map<string, PendingPracticeSave>(),
  );
  const savingAttemptIdsRef = useRef(new Set<string>());
  const pipCelebrationTimerRef = useRef<number | null>(null);

  function clearPipCelebration() {
    if (pipCelebrationTimerRef.current !== null) {
      window.clearTimeout(pipCelebrationTimerRef.current);
      pipCelebrationTimerRef.current = null;
    }
    setPipCelebrating(false);
  }

  function startPipCelebration() {
    clearPipCelebration();
    setPipCelebrating(true);
    pipCelebrationTimerRef.current = window.setTimeout(() => {
      pipCelebrationTimerRef.current = null;
      setPipCelebrating(false);
    }, 1_800);
  }

  useEffect(
    () => () => {
      if (pipCelebrationTimerRef.current !== null) {
        window.clearTimeout(pipCelebrationTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const parsed = parseMistakePatternEvents(
          window.localStorage.getItem(MISTAKE_PATTERN_STORAGE_KEY),
        );
        mistakePatternEventsRef.current = parsed.events;
        setMistakePatternEvents(parsed.events);
        setPatternTrackingStatus("ready");
        if (parsed.malformed) {
          setPatternTrackingNotice(
            "Saved pattern history could not be read. New repair patterns can still be tracked.",
          );
        }
      } catch {
        setPatternTrackingStatus("unavailable");
        setPatternTrackingNotice(
          "Browser storage is unavailable. Patterns can only be counted until you leave this page.",
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function recordMistakePattern(concept: PracticeConcept) {
    const nextEvents = appendMistakePatternEvent(
      mistakePatternEventsRef.current,
      concept,
    );
    mistakePatternEventsRef.current = nextEvents;
    setMistakePatternEvents(nextEvents);
    try {
      window.localStorage.setItem(
        MISTAKE_PATTERN_STORAGE_KEY,
        serializeMistakePatternEvents(nextEvents),
      );
      setPatternTrackingStatus("ready");
      setPatternTrackingNotice("");
    } catch {
      setPatternTrackingStatus("unavailable");
      setPatternTrackingNotice(
        "Browser storage is unavailable. Patterns can only be counted until you leave this page.",
      );
    }
  }

  const syncPendingPracticeSaves = useCallback(() => {
    setPendingPracticeSaves(
      Array.from(pendingPracticeSavesRef.current.values()),
    );
  }, []);

  const savePendingPracticeAttempt = useCallback(
    async (attemptId: string) => {
      if (savingAttemptIdsRef.current.has(attemptId)) return;
      const pending = pendingPracticeSavesRef.current.get(attemptId);
      if (!pending) return;
      const sessionId =
        pending.payload.sessionId ?? practiceSessionIdRef.current;
      if (!sessionId) {
        pendingPracticeSavesRef.current.set(attemptId, {
          ...pending,
          saving: false,
          error: "Practice history is not connected yet. Retry after reconnecting.",
        });
        syncPendingPracticeSaves();
        return;
      }

      const readyToSave = {
        ...pending,
        payload: { ...pending.payload, sessionId },
        saving: true,
        error: "",
      };
      pendingPracticeSavesRef.current.set(attemptId, readyToSave);
      savingAttemptIdsRef.current.add(attemptId);
      syncPendingPracticeSaves();
      try {
        const response = await fetch("/api/practice/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(readyToSave.payload),
        });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const message =
            body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : "Could not save this practice run.";
          throw new Error(message);
        }
        pendingPracticeSavesRef.current.delete(attemptId);
        setHistoryRefreshVersion((version) => version + 1);
      } catch (error) {
        pendingPracticeSavesRef.current.set(attemptId, {
          ...readyToSave,
          saving: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not save this practice run.",
        });
      } finally {
        savingAttemptIdsRef.current.delete(attemptId);
        syncPendingPracticeSaves();
      }
    },
    [syncPendingPracticeSaves],
  );

  const acceptPracticeSession = useCallback((sessionId: string | null) => {
    if (!sessionId) return;
    practiceSessionIdRef.current = sessionId;
    setPracticeSessionId(sessionId);
    setPracticeSessionStatus("ready");
  }, []);

  useEffect(() => {
    let mounted = true;
    void initializePracticeSession((status) => {
      if (mounted) setPracticeSessionStatus(status);
    }).then((sessionId) => {
      if (!mounted) return;
      if (sessionId) acceptPracticeSession(sessionId);
      else setPracticeSessionStatus("unavailable");
    });
    return () => {
      mounted = false;
      activeRunIdRef.current = "";
      currentRunRef.current?.stop();
    };
  }, [acceptPracticeSession]);

  useEffect(() => {
    if (!practiceSessionId) return;
    for (const [attemptId, pending] of pendingPracticeSavesRef.current) {
      if (!pending.payload.sessionId) {
        void savePendingPracticeAttempt(attemptId);
      }
    }
  }, [practiceSessionId, savePendingPracticeAttempt]);

  function retryPracticeSession() {
    setPracticeSessionStatus("loading");
    void initializePracticeSession(setPracticeSessionStatus).then(
      (sessionId) => {
        if (sessionId) acceptPracticeSession(sessionId);
        else setPracticeSessionStatus("unavailable");
      },
    );
  }

  function retryPendingPracticeSave(attemptId: string) {
    void savePendingPracticeAttempt(attemptId);
  }

  function queuePracticeAttempt(payload: PracticeSavePayload) {
    if (pendingPracticeSavesRef.current.has(payload.attemptId)) return;
    pendingPracticeSavesRef.current.set(payload.attemptId, {
      payload,
      saving: false,
      error: "",
    });
    syncPendingPracticeSaves();
    void savePendingPracticeAttempt(payload.attemptId);
  }

  function clearExampleVerification() {
    verificationRequestIdRef.current += 1;
    const activeRun = verificationRunRef.current;
    verificationRunRef.current = null;
    activeRun?.stop();
    setIsVerifyingExamples(false);
    setExampleVerification(null);
  }

  function clearFixState() {
    clearExampleVerification();
    setExampleCasesText("[]");
    setExpectationSource("user-provided");
    setReviewedAiExpectations(false);
    setExampleCaseError("");
    setFixResult(null);
    setOriginalFixCode("");
    setFixError("");
    setClarificationAnswer("");
    setLastFixRequest(null);
  }

  function updateCode(nextCode: string) {
    setCode(nextCode);
    clearFixState();
  }

  async function runCode() {
    let cases: unknown;
    try {
      cases = JSON.parse(testCases);
    } catch {
      setRunError("Test cases must be valid JSON.");
      return;
    }
    if (!isPythonTestCases(cases)) {
      setRunError(
        "Test cases must be a JSON array of function calls with valid function names and JSON arguments.",
      );
      return;
    }

    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setIsRunning(true);
    setRunError("");
    setOutput("");
    setObservedError("");
    setOutput("Preparing the browser Python runtime…");
    const run = createPythonRun(
      {
        requestId: runId,
        mode: cases.length > 0 ? "tests" : "script",
        code,
        testCases: cases,
      },
      setIsLoadingPython,
    );
    currentRunRef.current = run;
    try {
      const result = await run.promise;
      if (activeRunIdRef.current !== runId) return;
      setOutput(
        result.outputTruncated
          ? `${result.stdout}\n… output truncated …`
          : result.stdout,
      );
      const testError = result.testErrors.find(
        (testError): testError is string => testError !== null,
      );
      const error = result.error ?? (testError ? `Function test error: ${testError}` : "");
      setRunError(error);
      setObservedError(error);
    } finally {
      if (activeRunIdRef.current === runId) {
        currentRunRef.current = null;
        setIsRunning(false);
        setIsLoadingPython(false);
      }
    }
  }

  function stopRun() {
    currentRunRef.current?.stop();
    currentRunRef.current = null;
    activeRunIdRef.current = "";
    setIsRunning(false);
    setIsLoadingPython(false);
    setRunError("Execution stopped.");
  }

  function loadWorkspaceExample(example: (typeof workspaceExamples)[number]) {
    currentRunRef.current?.stop();
    currentRunRef.current = null;
    activeRunIdRef.current = "";
    setIsRunning(false);
    setIsLoadingPython(false);
    updateCode(example.code);
    setTestCases("[]");
    setIntendedBehavior(example.intendedBehavior);
    setExampleArguments(example.exampleArguments);
    setExpectedResult(example.expectedResult);
    setErrorMessage(example.errorMessage);
    setOutput("");
    setRunError("");
    setObservedError("");
  }

  function resetWorkspace() {
    stopRun();
    clearFixState();
    setIsTesting(false);
    setIsRunning(false);
    setIsLoadingPython(false);
    setCode(starterCode);
    setTestCases("[]");
    setIntendedBehavior("");
    setErrorMessage("");
    setExampleArguments("");
    setExpectedResult("");
    setClarificationAnswer("");
    setOutput("");
    setRunError("");
    setObservedError("");
    setSelectedLesson(null);
    setPrediction("");
    setPredictionSubmitted(false);
    setPracticeExercise(null);
    setPracticeCode("");
    setPracticeAttempts(0);
    setHintsRevealed(0);
    setTestFeedback("");
    setTestOutput("");
    setPracticeComplete(false);
    clearPipCelebration();
    setRecommendedExerciseId(null);
    setOutput("");
    setRunError("");
  }

  function downloadCode() {
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/x-python;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "main.py";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function sendFixRequest(values: FixRequest) {
    clearExampleVerification();
    setExampleCasesText("[]");
    setExpectationSource("user-provided");
    setReviewedAiExpectations(false);
    setExampleCaseError("");
    setIsFixing(true);
    setFixError("");
    setFixResult(null);
    setLastFixRequest(values);
    try {
      const response = await fetch("/api/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Gemini could not complete the fix. Please retry.";
        setFixError(message);
        return;
      }
      const result = fixResultSchema.safeParse(body);
      if (!result.success) {
        setFixError("Gemini returned an incomplete correction. Please retry.");
        return;
      }
      if (
        !result.data.needsClarification &&
        result.data.practiceType !== "other"
      ) {
        recordMistakePattern(result.data.practiceType);
      }
      if (!result.data.needsClarification) setOriginalFixCode(values.code);
      setFixResult(result.data);
    } catch {
      setFixError("Could not reach Gemini. Check your connection and retry.");
    } finally {
      setIsFixing(false);
    }
  }

  function requestFix() {
    void sendFixRequest({
      code,
      intendedBehavior,
      executionOutput: [output, runError].filter(Boolean).join("\n"),
      errorMessage: errorMessage || observedError || undefined,
      exampleArguments: exampleArguments || undefined,
      expectedResult: expectedResult || undefined,
    });
  }

  async function verifyExamples() {
    if (
      !originalFixCode ||
      !fixResult ||
      fixResult.needsClarification ||
      isVerifyingExamples
    ) {
      return;
    }
    if (expectationSource === "AI-suggested" && !reviewedAiExpectations) {
      setExampleCaseError(
        "Review the AI-suggested expected values before using them as test targets.",
      );
      return;
    }

    let parsedCases: unknown;
    try {
      parsedCases = JSON.parse(exampleCasesText);
    } catch {
      setExampleCaseError("Example tests must be valid JSON.");
      return;
    }
    if (!isPythonExampleCases(parsedCases)) {
      setExampleCaseError(
        "Enter 1–25 cases with a functionName, positional args array, and JSON expected value.",
      );
      return;
    }

    const cases = parsedCases;
    setExampleCaseError("");
    setExampleVerification(null);
    setIsVerifyingExamples(true);
    const verificationId = verificationRequestIdRef.current + 1;
    verificationRequestIdRef.current = verificationId;

    async function runAgainstExamples(sourceCode: string) {
      const run = createPythonRun(
        {
          requestId: crypto.randomUUID(),
          mode: "examples",
          code: sourceCode,
          testCases: cases.map(({ functionName, args }) => ({
            functionName,
            args,
          })),
        },
        () => {},
      );
      verificationRunRef.current = run;
      try {
        return makeExampleSideResult(await run.promise, cases);
      } finally {
        if (verificationRunRef.current === run) {
          verificationRunRef.current = null;
        }
      }
    }

    try {
      const original = await runAgainstExamples(originalFixCode);
      if (verificationRequestIdRef.current !== verificationId) return;
      const corrected = await runAgainstExamples(fixResult.correctedCode);
      if (verificationRequestIdRef.current !== verificationId) return;
      setExampleVerification({ cases, original, corrected });
    } catch (error) {
      if (verificationRequestIdRef.current === verificationId) {
        setExampleCaseError(
          error instanceof Error
            ? error.message
            : "Python could not run these examples.",
        );
      }
    } finally {
      if (verificationRequestIdRef.current === verificationId) {
        verificationRunRef.current = null;
        setIsVerifyingExamples(false);
      }
    }
  }

  function useAiSuggestedExamples() {
    if (!fixResult || fixResult.needsClarification || !fixResult.exampleTests.length) {
      return;
    }
    setExampleCasesText(JSON.stringify(fixResult.exampleTests, null, 2));
    setExpectationSource("AI-suggested");
    setReviewedAiExpectations(false);
    setExampleCaseError("");
    clearExampleVerification();
  }

  function answerClarification() {
    if (!lastFixRequest || !clarificationAnswer.trim()) return;
    void sendFixRequest({
      ...lastFixRequest,
      followUpAnswer: clarificationAnswer.trim(),
    });
  }

  function openLesson(lesson: Lesson) {
    activeRunIdRef.current = "";
    currentRunRef.current?.stop();
    setActiveView("practice");
    setSelectedLesson(lesson);
    setRecommendedExerciseId(null);
    setPrediction("");
    setPredictionSubmitted(false);
    setPracticeExercise(null);
    setPracticeCode("");
    setPracticeAttempts(0);
    setHintsRevealed(0);
    setTestFeedback("");
    setTestOutput("");
    setPracticeComplete(false);
    clearPipCelebration();
  }

  function startExercise(exercise: Exercise) {
    setPracticeExercise(exercise);
    setRecommendedExerciseId(null);
    setPracticeCode(exercise.starterCode);
    setPracticeAttempts(0);
    setHintsRevealed(0);
    setTestFeedback("");
    setTestOutput("");
    setPracticeComplete(false);
    clearPipCelebration();
  }

  async function runPracticeTests() {
    if (!practiceExercise) return;
    const exercise = practiceExercise;
    clearPipCelebration();
    const runId = crypto.randomUUID();
    const attempt = {
      attemptId: crypto.randomUUID(),
      sessionId: practiceSessionIdRef.current,
      exerciseId: exercise.id,
      hintsUsed: hintsRevealed,
      occurredAt: new Date().toISOString(),
    };
    activeRunIdRef.current = runId;
    setPracticeAttempts((count) => count + 1);
    setIsTesting(true);
    setTestFeedback("Running the exercise tests in your browser…");
    setTestOutput("");
    let outcome: PracticeSavePayload["outcome"] | null = null;
    try {
      const run = createPythonRun(
        {
          requestId: runId,
          mode: "tests",
          code: practiceCode,
          testCases: exercise.tests.map((test) => ({
            functionName: exercise.functionName,
            args: test.args,
          })),
        },
        setIsLoadingPython,
      );
      currentRunRef.current = run;
      const result = await run.promise;
      if (activeRunIdRef.current !== runId) return;
      setTestOutput(
        result.outputTruncated
          ? `${result.stdout}\n… output truncated …`
          : result.stdout,
      );
      if (result.timedOut) {
        outcome = "timed_out";
        setTestFeedback("Python execution timed out. Adjust the code and try again.");
        setPracticeComplete(false);
      } else if (result.error) {
        outcome = "error";
        setTestFeedback(`Python error: ${result.error}`);
        setPracticeComplete(false);
      } else if (result.testErrors.some(Boolean)) {
        outcome = "error";
        const failedError = result.testErrors.find(
          (testError): testError is string => testError !== null,
        );
        setTestFeedback(`Python error: ${failedError ?? "A test could not run."}`);
        setPracticeComplete(false);
      } else {
        const failed = exercise.tests.findIndex(
        (test, index) =>
          index >= result.results.length ||
          canonicalize(test.expected) !== canonicalize(result.results[index]),
        );
        if (failed === -1 && result.results.length === exercise.tests.length) {
          outcome = "passed";
          setPracticeComplete(true);
          startPipCelebration();
          setTestFeedback(
            `All ${exercise.tests.length} tests passed. Your solution handles the listed cases.`,
          );
        } else {
          outcome = "failed";
          const failedIndex = Math.max(failed, 0);
          const test = exercise.tests[failedIndex];
          setPracticeComplete(false);
          setTestFeedback(
            `Test failed: ${test.name}. Expected ${valueLabel(test.expected)}; received ${valueLabel(result.results[failedIndex])}.`,
          );
        }
      }
    } catch {
      if (activeRunIdRef.current !== runId) return;
      outcome = "error";
      setPracticeComplete(false);
      setTestFeedback("Python could not complete this test run. Please retry.");
    } finally {
      if (activeRunIdRef.current === runId) {
        currentRunRef.current = null;
        setIsTesting(false);
        setIsLoadingPython(false);
      }
    }
    if (activeRunIdRef.current === runId && outcome) {
      queuePracticeAttempt({ ...attempt, outcome });
    }
  }

  function closePractice() {
    activeRunIdRef.current = "";
    currentRunRef.current?.stop();
    setIsTesting(false);
    clearPipCelebration();
    setSelectedLesson(null);
    setPracticeExercise(null);
    setRecommendedExerciseId(null);
    setActiveView("practice");
  }

  function openRecommendedPractice(recommendation: PracticeRecommendation) {
    const lesson = getLessonForConcept(recommendation.concept);
    const exercise = getExercise(recommendation.exerciseId);
    if (!lesson || !exercise || exercise.concept !== recommendation.concept) {
      return;
    }
    openLesson(lesson);
    setRecommendedExerciseId(exercise.id);
  }

  function revealNextHint() {
    if (!practiceExercise || practiceComplete) return;
    setHintsRevealed((count) =>
      Math.min(practiceExercise.hints.length, count + 1),
    );
    setPipIsOpen(true);
  }

  const pipMood: PipMood =
    isTesting || isLoadingPython
      ? "thinking"
      : pipCelebrating
        ? "celebrating"
        : practiceExercise && testFeedback && !practiceComplete
          ? "encouraging"
          : "idle";
  const latestHint =
    practiceExercise && hintsRevealed > 0
      ? practiceExercise.hints[hintsRevealed - 1]
      : null;
  const pipMessage =
    pipMood === "thinking"
      ? "Let’s give Python a moment to work through it."
      : pipMood === "celebrating"
        ? "Every test passed! You untangled that one."
        : pipMood === "encouraging"
          ? "A missed test is a clue, not a setback. Want a small nudge?"
          : latestHint
            ? `Hint ${hintsRevealed}: ${latestHint}`
            : practiceExercise
              ? "Try one change at a time. I can share a hint whenever you need it."
              : "Hi, I’m Pip. Pick a pattern to explore, and I’ll be here if it gets tangled.";
  const pipHintAvailable =
    Boolean(practiceExercise) &&
    !practiceComplete &&
    hintsRevealed < (practiceExercise?.hints.length ?? 0);

  return (
    <main className="workspace">
      <WorkspaceHeader
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <section
        className="app-view"
        hidden={activeView !== "practice"}
        aria-label="Practice"
      >
      {selectedLesson ? (
        <section className="practice-view" aria-labelledby="practice-title">
          <button className="text-button practice-back" onClick={closePractice}>
            ← Back to practice
          </button>
          <p className="eyebrow">Pyspace lesson</p>
          <h1 id="practice-title">{selectedLesson.title}</h1>
          <p className="practice-explanation">{selectedLesson.explanation}</p>

          {!predictionSubmitted ? (
            <section className="practice-card" aria-labelledby="prediction-title">
              <p className="eyebrow">First, predict the output</p>
              <h2 id="prediction-title">{selectedLesson.prediction.question}</h2>
              <pre className="practice-example">
                <code>{selectedLesson.prediction.code}</code>
              </pre>
              <label className="field-label" htmlFor="prediction-answer">
                Your prediction
              </label>
              <input
                id="prediction-answer"
                className="text-field"
                value={prediction}
                onChange={(event) => setPrediction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && prediction.trim()) {
                    setPredictionSubmitted(true);
                  }
                }}
              />
              <button
                className="button button-primary"
                disabled={!prediction.trim()}
                onClick={() => setPredictionSubmitted(true)}
              >
                Check my prediction
              </button>
            </section>
          ) : (
            <section className="prediction-result" aria-live="polite">
              <h2>
                {prediction.trim() === selectedLesson.prediction.answer
                  ? "That’s right!"
                  : "Thanks for predicting"}
              </h2>
              <p>
                The output is <code>{selectedLesson.prediction.answer}</code>.{" "}
                {selectedLesson.prediction.explanation}
              </p>
              {!practiceExercise && (
                <button
                  className="button button-primary"
                  onClick={() => {
                    const exercise = getExercise(
                      recommendedExerciseId ?? selectedLesson.guidedExerciseId,
                    );
                    if (exercise) startExercise(exercise);
                  }}
                >
                  {recommendedExerciseId
                    ? "Start recommended practice"
                    : "Start guided repair"}
                </button>
              )}
            </section>
          )}

          {practiceExercise && (
            <section className="practice-card exercise-card">
              <div className="exercise-heading">
                <div>
                  <p className="eyebrow">
                    {practiceExercise.concept.replace("_", " ")} ·{" "}
                    {practiceExercise.id === selectedLesson.guidedExerciseId
                      ? "Guided repair"
                      : "Independent follow-up"}
                  </p>
                  <h2>{practiceExercise.title}</h2>
                </div>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setPracticeCode(practiceExercise.starterCode);
                    setTestFeedback("");
                    setTestOutput("");
                    setPracticeComplete(false);
                  }}
                >
                  Reset code
                </button>
              </div>
              <p>{practiceExercise.instructions}</p>
              <div className="practice-editor">
                <PythonEditor
                  value={practiceCode}
                  onChange={(value) => {
                    setPracticeCode(value);
                    setTestFeedback("");
                    setPracticeComplete(false);
                    clearPipCelebration();
                  }}
                  height="300px"
                />
              </div>
              <div className="practice-actions">
                <button
                  className="button button-primary"
                  onClick={() => void runPracticeTests()}
                  disabled={isTesting || isLoadingPython}
                >
                  {isLoadingPython ? "Loading Python…" : isTesting ? "Running tests…" : "Run tests"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={revealNextHint}
                  disabled={hintsRevealed >= practiceExercise.hints.length}
                >
                  {hintsRevealed >= practiceExercise.hints.length
                    ? "All hints revealed"
                    : `Hint (${hintsRevealed}/${practiceExercise.hints.length})`}
                </button>
                <span className="attempt-count">
                  Test runs: {practiceAttempts}
                </span>
              </div>
              {hintsRevealed > 0 && (
                <ol className="hint-list" aria-label="Revealed hints">
                  {practiceExercise.hints.slice(0, hintsRevealed).map((hint, index) => (
                    <li key={hint}>
                      <strong>Hint {index + 1}.</strong> {hint}
                    </li>
                  ))}
                </ol>
              )}
              {testFeedback && (
                <div
                  className={`test-feedback ${practiceComplete ? "test-success" : "test-failure"}`}
                  aria-live="polite"
                >
                  {testFeedback}
                </div>
              )}
              {testOutput && (
                <pre className="test-output" aria-label="Python output">
                  {testOutput}
                </pre>
              )}
              {practiceComplete && (
                <section className="completion-summary" aria-live="polite">
                  <h3>Exercise complete</h3>
                  <p>
                    You passed all {practiceExercise.tests.length} tests in{" "}
                    {practiceAttempts} test run{practiceAttempts === 1 ? "" : "s"}
                    {hintsRevealed
                      ? ` and revealed ${hintsRevealed} hint${hintsRevealed === 1 ? "" : "s"}.`
                      : " without revealing a hint."}
                  </p>
                  {practiceExercise.followUpExerciseId ? (
                    <button
                      className="button button-primary"
                      onClick={() => {
                        const followUpId = practiceExercise.followUpExerciseId;
                        if (!followUpId) return;
                        const followUp = getExercise(followUpId);
                        if (followUp) startExercise(followUp);
                      }}
                    >
                      Try the independent follow-up
                    </button>
                  ) : (
                    <button className="button button-secondary" onClick={closePractice}>
                      Return to workspace
                    </button>
                  )}
                </section>
              )}
              {pendingPracticeSaves.some(
                (pending) =>
                  pending.payload.exerciseId === practiceExercise.id,
              ) && (
                <section
                  className="pending-save-list"
                  aria-live="polite"
                  aria-label="Practice history saves"
                >
                  {pendingPracticeSaves
                    .filter(
                      (pending) =>
                        pending.payload.exerciseId === practiceExercise.id,
                    )
                    .map((pending) => (
                      <div key={pending.payload.attemptId}>
                        <p>
                          {pending.saving
                            ? "Saving this run to My Practice…"
                            : pending.error ||
                              "This run is not yet saved to My Practice."}
                        </p>
                        {!pending.saving && (
                          <button
                            className="text-button"
                            onClick={() =>
                              retryPendingPracticeSave(
                                pending.payload.attemptId,
                              )
                            }
                          >
                            Retry save
                          </button>
                        )}
                      </div>
                    ))}
                </section>
              )}
            </section>
          )}
        </section>
      ) : (
        <PracticeHome
          recommendation={recommendedPractice}
          onStartLesson={openLesson}
          onStartRecommendation={openRecommendedPractice}
        />
      )}
      </section>

      {activeView === "practice" && (!selectedLesson || !practiceExercise) && (
        <PipCompanion
          mood={pipMood}
          placement="floating"
          isOpen={pipIsOpen}
          onToggle={() => setPipIsOpen((open) => !open)}
          message={pipMessage}
          hintAvailable={pipHintAvailable}
          canStartChallenge={!selectedLesson}
          onRequestHint={revealNextHint}
          onStartChallenge={() => {
            if (recommendedPractice) {
              openRecommendedPractice(recommendedPractice);
            } else {
              openLesson(lessons[0]);
            }
          }}
          onClose={() => setPipIsOpen(false)}
        />
      )}
      {activeView === "practice" && selectedLesson && practiceExercise && (
        <PipCompanion
          mood={pipMood}
          placement="inline"
          isOpen={pipIsOpen}
          onToggle={() => setPipIsOpen((open) => !open)}
          message={pipMessage}
          hintAvailable={pipHintAvailable}
          canStartChallenge={false}
          onRequestHint={revealNextHint}
          onStartChallenge={() => openLesson(lessons[0])}
          onClose={() => setPipIsOpen(false)}
        />
      )}

      {activeView === "playground" && (
        <section className="app-view" aria-label="Playground">
        <>
          <section className="intro playground-intro">
            <p className="eyebrow">Fix code</p>
            <h1>Find the bug. Fix it. Practice the pattern.</h1>
            <p className="intro-copy">
              Run your Python, get a focused correction, then practice a similar problem.
            </p>
          </section>

          <div className="workspace-grid">
            <section className="editor-column panel">
              <div className="panel-heading">
                <span className="file-label">main.py</span>
                <span className="python-badge">Python 3</span>
                <div className="editor-heading-actions">
                  <details className="example-picker">
                    <summary className="button button-secondary example-button">
                      Load a bug example
                    </summary>
                    <div
                      className="example-picker-options"
                      role="group"
                      aria-label="Bug examples"
                    >
                      {workspaceExamples.map((example) => (
                        <button
                          key={example.label}
                          type="button"
                          className="text-button"
                          onClick={() => loadWorkspaceExample(example)}
                        >
                          {example.label}
                        </button>
                      ))}
                    </div>
                  </details>
                  <button
                    className="button button-secondary example-button"
                    onClick={resetWorkspace}
                    title="Reset this page's unsaved editor content and results. Persistent My Practice history is unchanged."
                  >
                    Reset workspace
                  </button>
                </div>
              </div>
              <div className="editor-wrap">
                <PythonEditor value={code} onChange={updateCode} />
              </div>
              <details className="test-case-settings">
                <summary>Optional function tests</summary>
                <p>
                  Provide a JSON array of function calls, each with a functionName and args.
                </p>
                <textarea
                  className="test-case-input"
                  aria-label="Optional function tests"
                  value={testCases}
                  onChange={(event) => setTestCases(event.target.value)}
                  spellCheck={false}
                />
              </details>
              <div className="editor-actions">
                <p className="editor-note">
                  Your code runs locally in your browser.
                  {isLoadingPython && " Loading the Python runtime…"}
                </p>
                <div className="editor-button-group">
                  <button
                    className="button button-secondary"
                    onClick={downloadCode}
                  >
                    Download
                  </button>
                  {isRunning && (
                    <button className="button button-stop" onClick={stopRun}>
                      Stop
                    </button>
                  )}
                  <button
                    id="run-code-button"
                    className="button button-run"
                    onClick={() => void runCode()}
                    disabled={isRunning}
                  >
                    {isRunning ? "Running…" : "▶ Run code"}
                  </button>
                </div>
              </div>
              <section className="output-panel" aria-labelledby="output-title">
                <div className="panel-heading output-heading">
                  <h2 id="output-title">Output</h2>
                  <span>Console</span>
                </div>
                <pre className={`output-content ${runError ? "output-error" : ""}`}>
                  {[output, runError].filter(Boolean).join("\n\n") ||
                    "Run your code to see its output."}
                </pre>
              </section>
            </section>

            <aside className="fix-panel panel">
              <div className="fix-heading">
                <span className="fix-icon">✳</span>
                <div>
                  <p className="eyebrow">Pair programmer</p>
                  <h2>Fix my code</h2>
                </div>
              </div>
              <p className="fix-description">
                Your editor contents are included automatically. Describe what you expected,
                and Gemini will help explain a focused fix.
              </p>
              <label className="field-label" htmlFor="intended-behavior">
                What should this code do? <span className="optional-label">Optional</span>
              </label>
              <textarea
                id="intended-behavior"
                className="text-field behavior-field"
                value={intendedBehavior}
                onChange={(event) => {
                  setIntendedBehavior(event.target.value);
                  clearFixState();
                }}
                placeholder="For example: calculate and display the average score."
                maxLength={3000}
              />
              <details className="fix-context">
                <summary>Add an error or example (optional)</summary>
                <label className="field-label" htmlFor="error-message">
                  Error message
                </label>
                <textarea
                  id="error-message"
                  className="text-field"
                  value={errorMessage || observedError || runError}
                  onChange={(event) => {
                    setErrorMessage(event.target.value);
                    setObservedError("");
                    clearFixState();
                  }}
                  placeholder="A recent Run code error is included automatically."
                  maxLength={3000}
                />
                <label className="field-label field-spaced" htmlFor="example-arguments">
                  Example function arguments (JSON array)
                </label>
                <input
                  id="example-arguments"
                  className="text-field"
                  value={exampleArguments}
                  onChange={(event) => {
                    setExampleArguments(event.target.value);
                    clearFixState();
                  }}
                  placeholder='[ [82, 91, 76] ]'
                />
                <label className="field-label field-spaced" htmlFor="expected-result">
                  Expected result (JSON)
                </label>
                <input
                  id="expected-result"
                  className="text-field"
                  value={expectedResult}
                  onChange={(event) => {
                    setExpectedResult(event.target.value);
                    clearFixState();
                  }}
                  placeholder='"83.0"'
                />
              </details>
              <button
                className="button button-fix"
                onClick={requestFix}
                disabled={isFixing || !code.trim()}
              >
                {isFixing ? "Thinking…" : "✳ Help me fix it"}
              </button>
              {fixError && (
                <div className="error-box" role="alert">
                  <p>{fixError}</p>
                  <button className="text-button" onClick={requestFix}>
                    Retry
                  </button>
                </div>
              )}
              {fixResult?.needsClarification && (
                <div className="clarification-box">
                  <p>{fixResult.question}</p>
                  <label className="field-label" htmlFor="clarification-answer">
                    Your answer
                  </label>
                  <textarea
                    id="clarification-answer"
                    className="text-field"
                    value={clarificationAnswer}
                    onChange={(event) => setClarificationAnswer(event.target.value)}
                    maxLength={3000}
                  />
                  <button
                    className="button button-fix"
                    onClick={answerClarification}
                    disabled={isFixing || !clarificationAnswer.trim()}
                  >
                    {isFixing ? "Thinking…" : "Send answer"}
                  </button>
                </div>
              )}
              {fixResult && !fixResult.needsClarification && (
                <section className="fix-result" aria-live="polite">
                  <div className="result-title-row">
                    <h3>Suggested fix</h3>
                    <button
                      className="text-button"
                      onClick={() =>
                        navigator.clipboard.writeText(fixResult.correctedCode)
                      }
                    >
                      Copy corrected code
                    </button>
                  </div>
                  <p className="result-summary">{fixResult.summary}</p>
                  <pre className="corrected-code">
                    <code>{fixResult.correctedCode}</code>
                  </pre>
                  <details className="code-comparison">
                    <summary>Compare with original code</summary>
                    <div className="comparison-columns">
                      <div>
                        <h4>Original</h4>
                        <pre className="original-code">{originalFixCode}</pre>
                      </div>
                      <div>
                        <h4>Corrected</h4>
                        <pre className="original-code">{fixResult.correctedCode}</pre>
                      </div>
                    </div>
                  </details>
                  <div className="explanation">
                    <div className="explanation-heading">
                      <h4>What changed</h4>
                      <NarrationControls
                        key={`${fixResult.summary}\n${fixResult.explanations.join("\n")}`}
                        text={[fixResult.summary, ...fixResult.explanations].join("\n")}
                      />
                    </div>
                    <ul>
                      {fixResult.explanations.map((explanation) => (
                        <li key={explanation}>{explanation}</li>
                      ))}
                    </ul>
                  </div>
                  <details className="example-tests">
                    <summary>Check examples on both versions (optional)</summary>
                    <p className="example-arguments-hint">
                      These examples run the original and corrected code locally
                      in your browser. Function tests skip top-level expression
                      statements such as demo print calls. They are useful
                      checks, not proof of correctness.
                    </p>
                    <label className="field-label" htmlFor="example-test-cases">
                      Example tests{" "}
                      <span className="optional-label">
                        (JSON array: functionName, args, expected)
                      </span>
                    </label>
                    <textarea
                      id="example-test-cases"
                      className="text-field example-test-input"
                      rows={5}
                      value={exampleCasesText}
                      maxLength={20_000}
                      onChange={(event) => {
                        setExampleCasesText(event.target.value);
                        setExpectationSource("user-provided");
                        setReviewedAiExpectations(false);
                        setExampleCaseError("");
                        clearExampleVerification();
                      }}
                      placeholder='[{"functionName":"average","args":[[82,91,76]],"expected":83.0}]'
                      disabled={isVerifyingExamples}
                    />
                    <p className="expectation-source">
                      Expected values: <strong>{expectationSource}</strong>
                    </p>
                    {fixResult.exampleTests.length > 0 && (
                      <button
                        className="text-button ai-examples-button"
                        onClick={useAiSuggestedExamples}
                        disabled={isVerifyingExamples}
                      >
                        Use {fixResult.exampleTests.length} AI-suggested
                        example{fixResult.exampleTests.length === 1 ? "" : "s"}
                        {" "}(review required)
                      </button>
                    )}
                    {expectationSource === "AI-suggested" && (
                      <label className="review-expectations">
                        <input
                          type="checkbox"
                          checked={reviewedAiExpectations}
                          onChange={(event) => {
                            setReviewedAiExpectations(event.target.checked);
                            clearExampleVerification();
                          }}
                          disabled={isVerifyingExamples}
                        />
                        I reviewed the AI-suggested expected values and want to
                        use them as test targets.
                      </label>
                    )}
                    <button
                      className="button button-secondary verify-examples-button"
                      onClick={() => void verifyExamples()}
                      disabled={
                        isVerifyingExamples ||
                        !originalFixCode ||
                        (expectationSource === "AI-suggested" &&
                          !reviewedAiExpectations)
                      }
                    >
                      {isVerifyingExamples
                        ? "Running original and corrected code…"
                        : "Run examples on both versions"}
                    </button>
                    {exampleCaseError && (
                      <p className="example-case-error" role="alert">
                        {exampleCaseError}
                      </p>
                    )}
                    {exampleVerification && (
                      <div className="example-verification" aria-live="polite">
                        <div className="verification-side">
                          <h4>Original: {exampleVerification.original.status}</h4>
                          <ExampleCaseResults
                            cases={exampleVerification.cases}
                            outcomes={exampleVerification.original.outcomes}
                          />
                        </div>
                        <div className="verification-side">
                          <h4>Corrected: {exampleVerification.corrected.status}</h4>
                          <ExampleCaseResults
                            cases={exampleVerification.cases}
                            outcomes={exampleVerification.corrected.outcomes}
                          />
                        </div>
                      </div>
                    )}
                  </details>
                  <div className="related-practice">
                    <span className="concept-label">Related bug pattern</span>
                    <p>
                      {getLessonForConcept(fixResult.practiceType)?.title ??
                        fixResult.practiceType.replaceAll("_", " ")}
                    </p>
                  </div>
                  {getLessonForConcept(fixResult.practiceType) ? (
                    <button
                      className="button button-secondary practice-link"
                      onClick={() => {
                        const lesson = getLessonForConcept(fixResult.practiceType);
                        if (lesson) openLesson(lesson);
                      }}
                    >
                      Practice this pattern
                    </button>
                  ) : (
                    <p className="practice-unavailable">
                      Targeted practice is not available for this pattern yet. You can still
                      use the correction below.
                    </p>
                  )}
                  <button
                    className="button button-primary apply-button"
                    onClick={() => updateCode(fixResult.correctedCode)}
                  >
                    Use corrected code
                  </button>
                </section>
              )}
            </aside>
          </div>

        </>
        </section>
      )}

      <section
        className="app-view"
        hidden={activeView !== "progress"}
        aria-label="Progress"
      >
        <MyPractice
          sessionStatus={practiceSessionStatus}
          refreshVersion={historyRefreshVersion}
          onRetrySession={retryPracticeSession}
          onOpenRecommendation={openRecommendedPractice}
          onRecommendationChange={setRecommendedPractice}
          mistakePatternEvents={mistakePatternEvents}
          patternTrackingStatus={patternTrackingStatus}
          patternTrackingNotice={patternTrackingNotice}
        />
      </section>
      <footer className="footer">Made for the bugs that teach you something.</footer>
    </main>
  );
}
