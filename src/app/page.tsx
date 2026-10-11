"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import MyPractice from "@/app/MyPractice";
import {
  createPythonRun,
  isPythonTestCases,
  type PythonRun,
  type PythonValue,
} from "@/lib/pythonRunner";
import {
  exercises,
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
import type { PracticeRecommendation } from "@/lib/practice-recommendations";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const starterCode = `# Welcome to Pyspace
name = "world"
print(f"Hello, {name}!")
`;

const averageExampleCode = `def average(numbers):
    return sum(numbers) / len(number)

scores = [82, 91, 76]
print(f"The average score is {average(scores):.1f}")
`;

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

function WorkspaceHeader() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark">Py</span>
        Pyspace
      </Link>
      <div className="topbar-note">
        <span className="status-dot" />
        Python runs locally in your browser
      </div>
    </header>
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
  const [code, setCode] = useState(starterCode);
  const [testCases, setTestCases] = useState("[]");
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
  const activeRunIdRef = useRef("");

  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
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
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const practiceSessionIdRef = useRef<string | null>(null);
  const pendingPracticeSavesRef = useRef(
    new Map<string, PendingPracticeSave>(),
  );
  const savingAttemptIdsRef = useRef(new Set<string>());

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

  function clearFixState() {
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
      { requestId: runId, code, testCases: cases },
      setIsLoadingPython,
    );
    currentRunRef.current = run;
    try {
      const result = await run.promise;
      if (activeRunIdRef.current !== runId) return;
      setOutput(result.stdout);
      setRunError(result.error ?? "");
      setObservedError(result.error ?? "");
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

  function loadAverageExample() {
    updateCode(averageExampleCode);
    setIntendedBehavior("Calculate and display the average score.");
    setExampleArguments("[[82, 91, 76]]");
    setExpectedResult("83.0");
    setErrorMessage("");
    setObservedError("");
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
  }

  async function runPracticeTests() {
    if (!practiceExercise) return;
    const exercise = practiceExercise;
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
      setTestOutput(result.stdout);
      if (result.timedOut) {
        outcome = "timed_out";
        setTestFeedback("Python execution timed out. Adjust the code and try again.");
        setPracticeComplete(false);
      } else if (result.error) {
        outcome = "error";
        setTestFeedback(`Python error: ${result.error}`);
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
    setSelectedLesson(null);
    setPracticeExercise(null);
    setRecommendedExerciseId(null);
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

  return (
    <main className="workspace">
      <WorkspaceHeader />
      {selectedLesson ? (
        <section className="practice-view" aria-labelledby="practice-title">
          <button className="text-button practice-back" onClick={closePractice}>
            ← Back to workspace
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
                  onClick={() =>
                    setHintsRevealed((count) =>
                      Math.min(practiceExercise.hints.length, count + 1),
                    )
                  }
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
        <>
          <section className="intro">
            <p className="eyebrow">Learn by doing</p>
            <h1>Try an idea, run it in your browser</h1>
            <p className="intro-copy">
              Experiment with Python, then ask for a thoughtful fix when you get stuck.
            </p>
          </section>

          <div className="workspace-grid">
            <section className="editor-column panel">
              <div className="panel-heading">
                <span className="file-label">Pymain.py</span>
                <span className="python-badge">Python 3</span>
                <button
                  className="button button-secondary example-button"
                  onClick={loadAverageExample}
                >
                  Load average example
                </button>
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
                    <h4>What changed</h4>
                    <ul>
                      {fixResult.explanations.map((explanation) => (
                        <li key={explanation}>{explanation}</li>
                      ))}
                    </ul>
                  </div>
                  {fixResult.concept && (
                    <div className="concept-card">
                      <span className="concept-label">Python concept</span>
                      <p>{fixResult.concept}</p>
                    </div>
                  )}
                  <p className="practice-pattern">
                    Practice pattern: <strong>{fixResult.practiceType.replace("_", " ")}</strong>
                  </p>
                  {getLessonForConcept(fixResult.practiceType) ? (
                    <button
                      className="text-button practice-link"
                      onClick={() => {
                        const lesson = getLessonForConcept(fixResult.practiceType);
                        if (lesson) openLesson(lesson);
                      }}
                    >
                      Practice this mistake
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

          <MyPractice
            sessionStatus={practiceSessionStatus}
            refreshVersion={historyRefreshVersion}
            onRetrySession={retryPracticeSession}
            onOpenRecommendation={openRecommendedPractice}
          />

          <section className="lesson-library" aria-labelledby="lessons-title">
            <p className="eyebrow">Practice the patterns</p>
            <h2 id="lessons-title">Lessons that make bugs teach you something</h2>
            <div className="lesson-grid">
              {lessons.map((lesson) => (
                <article className="lesson-tile" key={lesson.id}>
                  <h3>{lesson.title}</h3>
                  <p>{lesson.explanation}</p>
                  <button className="text-button" onClick={() => openLesson(lesson)}>
                    Start lesson
                  </button>
                </article>
              ))}
            </div>
            <p className="exercise-count">
              {exercises.length} reviewed exercises with boundary-focused tests
            </p>
          </section>
          <footer className="footer">Made for the bugs that teach you something.</footer>
        </>
      )}
    </main>
  );
}
