"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fixResultSchema } from "@/lib/fix-schema";
import type { FixResult } from "@/lib/fix-schema";
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

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const starterCode = `# Welcome to Pyspace
name = "world"
print(f"Hello, {name}!")
`;

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

  const playAudio = async (url: string) => {
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
  };

  const listen = async () => {
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
        const payload: unknown = await response.json().catch(() => null);
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Narration could not be generated right now. Please try again.";
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
            : "Narration could not be generated right now. Please try again.",
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsGenerating(false);
      }
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    audioRef.current?.pause();
    audioRef.current?.load();
    setIsPlaying(false);
  };

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

type FixRequest = {
  code: string;
  intendedBehavior: string;
  functionName?: string;
  errorMessage?: string;
  exampleArguments?: string;
  expectedResult?: string;
  followUpAnswer?: string;
};

type DiffLine = {
  kind: "added" | "removed" | "context";
  text: string;
};

type ExampleSideResult = {
  status: string;
  outcomes: { actual: PythonValue | null; error: string | null }[];
};

type ExampleVerification = {
  cases: PythonExampleCase[];
  original: ExampleSideResult;
  corrected: ExampleSideResult;
};

function stableJson(value: PythonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function makeExampleSideResult(
  response: PythonResponse,
  cases: PythonExampleCase[],
): ExampleSideResult {
  const outcomes = cases.map((testCase, index) => ({
    actual: response.results[index] ?? null,
    error:
      response.error ??
      response.testErrors[index] ??
      (response.results[index] === undefined
        ? "No result was returned for this case."
        : null),
  }));

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
        stableJson(outcome.actual) !== stableJson(cases[index].expected),
    )
  ) {
    return { status: "Failed an example test", outcomes };
  }
  return {
    status: `Passed ${cases.length} example tests`,
    outcomes,
  };
}

function ExampleCaseResults({
  cases,
  results,
}: {
  cases: PythonExampleCase[];
  results: ExampleSideResult["outcomes"];
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
            <th>Execution error</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((testCase, index) => (
            <tr key={`${testCase.functionName}-${index}`}>
              <td><code>{testCase.functionName}</code></td>
              <td><code>{JSON.stringify(testCase.args)}</code></td>
              <td><code>{JSON.stringify(testCase.expected)}</code></td>
              <td><code>{JSON.stringify(results[index]?.actual ?? null)}</code></td>
              <td className={results[index]?.error ? "example-error" : ""}>
                {results[index]?.error ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildCodeDiff(original: string, corrected: string): DiffLine[] {
  const oldLines = original.split("\n");
  const newLines = corrected.split("\n");
  if (oldLines.length > 300 || newLines.length > 300) {
    return [
      ...oldLines.map((text) => ({ kind: "removed" as const, text })),
      ...newLines.map((text) => ({ kind: "added" as const, text })),
    ];
  }

  const lengths = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint16Array(newLines.length + 1),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lengths[oldIndex + 1][newIndex + 1] + 1
          : Math.max(
              lengths[oldIndex + 1][newIndex],
              lengths[oldIndex][newIndex + 1],
            );
    }
  }

  const diff: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      diff.push({ kind: "context", text: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      oldIndex < oldLines.length &&
      (newIndex === newLines.length ||
        lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1])
    ) {
      diff.push({ kind: "removed", text: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      diff.push({ kind: "added", text: newLines[newIndex] });
      newIndex += 1;
    }
  }
  return diff;
}

export default function Home() {
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
  const [functionName, setFunctionName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [exampleArguments, setExampleArguments] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [originalFixCode, setOriginalFixCode] = useState<string | null>(null);
  const [fixError, setFixError] = useState("");
  const [isFixing, setIsFixing] = useState(false);
  const [lastFixRequest, setLastFixRequest] = useState<FixRequest | null>(null);
  const [output, setOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingPython, setIsLoadingPython] = useState(false);
  const pythonRunRef = useRef<PythonRun | null>(null);
  const verificationRunRef = useRef<PythonRun | null>(null);
  const correctionAbortRef = useRef<AbortController | null>(null);
  const verificationRequestIdRef = useRef(0);
  const correctionRequestIdRef = useRef(0);
  const editorRef = useRef<{ focus: () => void } | null>(null);

  const clearExampleVerification = () => {
    verificationRequestIdRef.current += 1;
    const activeRun = verificationRunRef.current;
    verificationRunRef.current = null;
    activeRun?.stop();
    setIsVerifyingExamples(false);
    setExampleVerification(null);
  };

  const invalidateCorrection = () => {
    correctionRequestIdRef.current += 1;
    correctionAbortRef.current?.abort();
    correctionAbortRef.current = null;
    setIsFixing(false);
    setFixError("");
    setFixResult(null);
    setOriginalFixCode(null);
    setLastFixRequest(null);
    setClarificationAnswer("");
    clearExampleVerification();
  };

  const clearExecutionResult = () => {
    const activeRun = pythonRunRef.current;
    pythonRunRef.current = null;
    activeRun?.stop();
    setIsLoadingPython(false);
    setIsRunning(false);
    setOutput("");
    setRunError("");
  };

  const updateCode = (value: string) => {
    if (value === code) return;
    setCode(value);
    setExampleVerification(null);
    clearExecutionResult();
    invalidateCorrection();
  };

  const updateTestCases = (value: string) => {
    if (value === testCases) return;
    setTestCases(value);
    clearExecutionResult();
  };

  const runCode = useCallback(async () => {
    setOutput("");
    setRunError("");
    let activeRun: PythonRun | null = null;

    try {
      const parsedTestCases: unknown = JSON.parse(testCases);
      if (!isPythonTestCases(parsedTestCases)) {
        throw new Error(
          "Tests must be a JSON array of up to 25 cases with a functionName and basic-type args.",
        );
      }

      setIsRunning(true);
      activeRun = createPythonRun(
        {
          requestId: crypto.randomUUID(),
          mode: parsedTestCases.length > 0 ? "tests" : "script",
          code,
          testCases: parsedTestCases,
        },
        setIsLoadingPython,
      );
      pythonRunRef.current = activeRun;
      const response = await activeRun.promise;
      if (pythonRunRef.current !== activeRun) return;
      const resultsOutput =
        response.results.length > 0
          ? `Results:\n${response.results.map((result) => JSON.stringify(result)).join("\n")}`
          : "";
      setOutput(
        [
          response.stdout,
          resultsOutput,
          ...response.testErrors.flatMap((error, index) =>
            error ? [`Test ${index + 1} error: ${error}`] : [],
          ),
          response.outputTruncated
            ? "[Output truncated at 20,000 characters.]"
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );

      if (response.error) setRunError(response.error);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Python could not be run.",
      );
    } finally {
      if (!activeRun || pythonRunRef.current === activeRun) {
        setIsLoadingPython(false);
        setIsRunning(false);
        pythonRunRef.current = null;
      }
    }
  }, [code, testCases]);

  const requestFix = useCallback(async (request: FixRequest) => {
    const requestId = correctionRequestIdRef.current + 1;
    correctionRequestIdRef.current = requestId;
    const controller = new AbortController();
    correctionAbortRef.current?.abort();
    correctionAbortRef.current = controller;
    setIsFixing(true);
    setFixError("");
    setLastFixRequest(request);

    try {
      const response = await fetch("/api/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? data.error
            : undefined;
        throw new Error(
          typeof message === "string" && message
            ? message
            : "The fix request failed. Please try again.",
        );
      }

      const parsedResult = fixResultSchema.safeParse(data);
      if (!parsedResult.success) {
        throw new Error("Gemini returned an unexpected response. Please retry.");
      }

      if (correctionRequestIdRef.current !== requestId) return;
      setOriginalFixCode(request.code);
      setFixResult(parsedResult.data);
      setClarificationAnswer("");
    } catch (error) {
      if (correctionRequestIdRef.current !== requestId) return;
      setFixError(
        error instanceof Error
          ? error.message
          : "The fix request failed. Please try again.",
      );
    } finally {
      if (correctionRequestIdRef.current === requestId) {
        correctionAbortRef.current = null;
        setIsFixing(false);
      }
    }
  }, []);

  const verifyExamples = async () => {
    if (!originalFixCode || !fixResult?.correctedCode || isVerifyingExamples) {
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
    const verificationRequestId = verificationRequestIdRef.current + 1;
    verificationRequestIdRef.current = verificationRequestId;

    const runCodeAgainstExamples = async (sourceCode: string) => {
      try {
        const run = createPythonRun(
          {
            requestId: crypto.randomUUID(),
            mode: "tests",
            code: sourceCode,
            testCases: cases.map(({ functionName, args }) => ({
              functionName,
              args,
            })),
          },
          () => {},
        );
        verificationRunRef.current = run;
        return makeExampleSideResult(await run.promise, cases);
      } catch (error) {
        return {
          status: "Execution error",
          outcomes: cases.map(() => ({
            actual: null,
            error:
              error instanceof Error
                ? error.message
                : "Python could not be run.",
          })),
        } satisfies ExampleSideResult;
      } finally {
        verificationRunRef.current = null;
      }
    };

    try {
      const original = await runCodeAgainstExamples(originalFixCode);
      if (verificationRequestIdRef.current !== verificationRequestId) return;
      const corrected = await runCodeAgainstExamples(fixResult.correctedCode);
      if (verificationRequestIdRef.current !== verificationRequestId) return;
      setExampleVerification({ cases, original, corrected });
    } finally {
      if (verificationRequestIdRef.current === verificationRequestId) {
        verificationRunRef.current = null;
        setIsVerifyingExamples(false);
      }
    }
  };

  const useAiSuggestedExamples = () => {
    if (!fixResult?.exampleTests?.length) return;
    setExampleCasesText(JSON.stringify(fixResult.exampleTests, null, 2));
    setExpectationSource("AI-suggested");
    setReviewedAiExpectations(false);
    setExampleCaseError("");
    setExampleVerification(null);
  };

  const handleFix = () => {
    if (!code.trim() || code.length > 20_000) {
      setFixError("Enter nonblank code with no more than 20,000 characters.");
      return;
    }
    if (!intendedBehavior.trim() || intendedBehavior.length > 3_000) {
      setFixError(
        "Describe the intended behavior in 3,000 characters or fewer.",
      );
      return;
    }
    if (
      fixResult?.needsClarification &&
      (!clarificationAnswer.trim() || clarificationAnswer.length > 3_000)
    ) {
      setFixError(
        "Enter a clarification answer in 3,000 characters or fewer.",
      );
      return;
    }

    let normalizedArguments: string | undefined;
    if (
      (exampleArguments.trim() || expectedResult.trim()) &&
      !/^[A-Za-z_]\w*$/.test(functionName)
    ) {
      setFixError(
        "Confirm the function name before submitting example arguments or an expected result.",
      );
      return;
    }
    if (exampleArguments.trim()) {
      try {
        const parsed: unknown = JSON.parse(exampleArguments);
        if (!Array.isArray(parsed)) {
          throw new Error("Arguments must be a JSON array.");
        }
        normalizedArguments = JSON.stringify(parsed);
      } catch {
        setFixError("Example arguments must be a valid JSON array.");
        return;
      }
    }

    let normalizedExpectedResult: string | undefined;
    if (expectedResult.trim()) {
      try {
        normalizedExpectedResult = JSON.stringify(JSON.parse(expectedResult));
      } catch {
        setFixError("Expected result must be valid JSON.");
        return;
      }
    }

    void requestFix({
      code,
      intendedBehavior,
      ...(functionName.trim() ? { functionName: functionName.trim() } : {}),
      ...(errorMessage.trim() ? { errorMessage: errorMessage.trim() } : {}),
      ...(normalizedArguments !== undefined
        ? { exampleArguments: normalizedArguments }
        : {}),
      ...(normalizedExpectedResult !== undefined
        ? { expectedResult: normalizedExpectedResult }
        : {}),
      ...(fixResult?.needsClarification && clarificationAnswer.trim()
        ? { followUpAnswer: clarificationAnswer.trim() }
        : {}),
    });
  };

  const loadExample = () => {
    cancelCode();
    invalidateCorrection();
    setCode(`def sum_numbers(numbers):
    total = 0
    for number in numbers:
        total = number
    return total
`);
    setTestCases("[]");
    const accumulatorCases: PythonExampleCase[] = [
      {
        functionName: "sum_numbers",
        args: [[2, 3, 4]],
        expected: 9,
      },
      {
        functionName: "sum_numbers",
        args: [[]],
        expected: 0,
      },
      {
        functionName: "sum_numbers",
        args: [[-2, 5]],
        expected: 3,
      },
    ];
    setExampleCasesText(JSON.stringify(accumulatorCases, null, 2));
    setExpectationSource("reviewed exercise");
    setReviewedAiExpectations(false);
    setExampleCaseError("");
    setExampleVerification(null);
    setIntendedBehavior(
      "Return the sum of all numbers in the list, adding each number to the running total.",
    );
    setErrorMessage("");
    setFunctionName("sum_numbers");
    setExampleArguments("[[2, 3, 4]]");
    setExpectedResult("9");
    setClarificationAnswer("");
    setFixResult(null);
    setOriginalFixCode(null);
    setFixError("");
    setOutput("");
    setRunError("");
  };

  const clearLocalSessionData = () => {
    cancelCode();
    correctionAbortRef.current?.abort();
    correctionAbortRef.current = null;
    correctionRequestIdRef.current += 1;
    setIsFixing(false);
    clearExampleVerification();
    setCode(starterCode);
    setTestCases("[]");
    setExampleCasesText("[]");
    setExpectationSource("user-provided");
    setReviewedAiExpectations(false);
    setExampleCaseError("");
    setIntendedBehavior("");
    setFunctionName("");
    setErrorMessage("");
    setExampleArguments("");
    setExpectedResult("");
    setClarificationAnswer("");
    setFixResult(null);
    setOriginalFixCode(null);
    setFixError("");
    setLastFixRequest(null);
    setOutput("");
    setRunError("");
  };

  const stopCode = () => pythonRunRef.current?.stop();

  const cancelCode = () => {
    const activeRun = pythonRunRef.current;
    pythonRunRef.current = null;
    activeRun?.stop();
    setIsLoadingPython(false);
    setIsRunning(false);
  };

  const diffLines =
    originalFixCode !== null && fixResult?.correctedCode
      ? buildCodeDiff(originalFixCode, fixResult.correctedCode)
      : [];

  const downloadCode = () => {
    const file = new Blob([code], { type: "text/x-python;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "main.py";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyCorrectedCode = async () => {
    if (!fixResult?.correctedCode) return;

    try {
      await navigator.clipboard.writeText(fixResult.correctedCode);
    } catch {
      setFixError("Could not copy the corrected code. Please copy it manually.");
    }
  };

  return (
    <main className="workspace">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Pyspace home">
          <span className="brand-mark" aria-hidden="true">
            {"</>"}
          </span>
          <span>pyspace</span>
        </Link>
        <div className="topbar-note">
          <span className="status-dot" />
          Python playground
        </div>
        <button className="button button-secondary example-button" onClick={loadExample}>
          Load example
        </button>
        <button
          className="button button-secondary clear-session-button"
          onClick={clearLocalSessionData}
          title="Resets the current page's unsaved editor content, inputs, and results. It does not delete downloaded files or server-side records."
        >
          Clear local session data
        </button>
      </header>

      <section className="intro">
        <p className="eyebrow">A little space to figure it out</p>
        <h1>Write Python. Make it work.</h1>
        <p className="intro-copy">
          Try an idea, run it in your browser, or ask for a thoughtful fix when
          you get stuck.
        </p>
      </section>

      <section className="workspace-grid" aria-label="Python workspace">
        <div className="editor-column">
          <section className="panel editor-panel" aria-label="Python code editor">
            <div className="panel-heading">
              <div className="file-label">
                <span className="python-badge">Py</span>
                <span>main.py</span>
              </div>
              <span className="panel-hint">
                Python 3 · {code.length.toLocaleString()}/20k chars
              </span>
            </div>
            <div className="editor-wrap">
              <Editor
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                height="390px"
                language="python"
                theme="vs-dark"
                value={code}
                onChange={(value) => updateCode(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: "var(--font-geist-mono), monospace",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  readOnly: isFixing,
                  tabSize: 4,
                  padding: { top: 18, bottom: 18 },
                }}
              />
            </div>
            <details className="test-case-settings">
              <summary>Function tests (optional)</summary>
              <p>
                Call functions with JSON basic types. Each case needs a
                functionName and args; kwargs is optional.
              </p>
              <textarea
                className="text-field test-case-input"
                aria-label="Function test cases in JSON"
                rows={4}
                value={testCases}
                onChange={(event) => updateTestCases(event.target.value)}
                placeholder={'[{"functionName":"add","args":[2,3]}]'}
                disabled={isRunning}
              />
            </details>
            <div className="editor-actions">
              <p className="editor-note">Your code runs locally in your browser.</p>
              <div className="editor-button-group">
                <button
                  className="button button-secondary"
                  onClick={downloadCode}
                  disabled={!code}
                >
                  Download
                </button>
                {isRunning ? (
                  <button className="button button-stop" onClick={stopCode}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="button button-run"
                    onClick={() => void runCode()}
                    disabled={!code.trim()}
                  >
                    <span aria-hidden="true">▶</span>
                    Run code
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="panel output-panel" aria-labelledby="output-title">
            <div className="panel-heading output-heading">
              <h2 id="output-title">Output</h2>
              <span className="panel-hint">Console</span>
            </div>
            <pre
              className={`output-content${runError ? " output-error" : ""}`}
              aria-live="polite"
            >
              {output}
              {runError && `${output ? "\n" : ""}${runError}`}
              {!output && !runError &&
                (isRunning
                  ? isLoadingPython
                    ? "Loading Python…"
                    : "Running Python…"
                  : "Run your code to see the output.")}
            </pre>
          </section>
        </div>

        <aside className="panel fix-panel" aria-labelledby="fix-title">
          <div className="fix-heading">
            <span className="fix-icon" aria-hidden="true">✳</span>
            <div>
              <p className="eyebrow">Pair programmer</p>
              <h2 id="fix-title">Fix my code</h2>
            </div>
          </div>
          <p className="fix-description">
            Your editor contents are included automatically. Describe what you
            expected, and Gemini will help explain a focused fix.
          </p>
          <p className="supported-scope">
            Best for short, self-contained Python functions. External packages,
            databases, interactive input, and user files are outside the
            supported execution scope.
          </p>

          <label className="field-label" htmlFor="intended-behavior">
            What should the code do? <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="intended-behavior"
            className="text-field"
            rows={4}
            value={intendedBehavior}
            maxLength={3_000}
            required
            aria-required="true"
            onChange={(event) => {
              invalidateCorrection();
              setIntendedBehavior(event.target.value);
            }}
            placeholder="Describe the expected result or the problem you noticed…"
            disabled={isFixing}
          />
          <p className="field-limit">{intendedBehavior.length}/3,000 characters</p>

          <label className="field-label" htmlFor="error-message">
            Error message <span className="optional-label">(optional)</span>
          </label>
          <textarea
            id="error-message"
            className="text-field"
            rows={2}
            value={errorMessage}
            maxLength={3_000}
            onChange={(event) => {
              invalidateCorrection();
              setErrorMessage(event.target.value);
            }}
            placeholder="Paste the error or traceback, if any…"
            disabled={isFixing}
          />

          <label className="field-label field-spaced" htmlFor="function-name">
            Function name{" "}
            <span className="optional-label">(optional)</span>
          </label>
          <input
            id="function-name"
            className="text-field"
            value={functionName}
            maxLength={100}
            onChange={(event) => {
              invalidateCorrection();
              setFunctionName(event.target.value);
            }}
            placeholder="sum_numbers"
            disabled={isFixing}
          />

          <label className="field-label field-spaced" htmlFor="example-arguments">
            Positional arguments{" "}
            <span className="optional-label">(optional JSON array)</span>
          </label>
          <p className="example-arguments-hint">
            This array is spread into the function call. <code>[[2,3,4]]</code>{" "}
            means one positional argument: the list <code>[2,3,4]</code>.
          </p>
          <textarea
            id="example-arguments"
            className="text-field"
            rows={2}
            value={exampleArguments}
            maxLength={3_000}
            onChange={(event) => {
              invalidateCorrection();
              setExampleArguments(event.target.value);
            }}
            placeholder="[[2, 3, 4]]"
            disabled={isFixing}
          />

          <label className="field-label field-spaced" htmlFor="expected-result">
            Expected result{" "}
            <span className="optional-label">(optional JSON value)</span>
          </label>
          <textarea
            id="expected-result"
            className="text-field"
            rows={2}
            value={expectedResult}
            maxLength={3_000}
            onChange={(event) => {
              invalidateCorrection();
              setExpectedResult(event.target.value);
            }}
            placeholder="9, null, false, 0, …"
            disabled={isFixing}
          />

          <label className="field-label field-spaced" htmlFor="example-test-cases">
            Example-test cases{" "}
            <span className="optional-label">(JSON array, optional)</span>
          </label>
          <p className="example-arguments-hint">
            Each case has a functionName, positional args array, and expected
            JSON value. For example:{" "}
            <code>
              {`[{"functionName":"sum_numbers","args":[[2,3,4]],"expected":9}]`}
            </code>
          </p>
          <textarea
            id="example-test-cases"
            className="text-field example-test-input"
            rows={5}
            value={exampleCasesText}
            onChange={(event) => {
              setExampleCasesText(event.target.value);
              setExpectationSource("user-provided");
              setReviewedAiExpectations(false);
              setExampleCaseError("");
              clearExampleVerification();
            }}
            placeholder="[]"
            disabled={isVerifyingExamples}
          />
          <p className="expectation-source">
            Expected values: <strong>{expectationSource}</strong>
          </p>
          <p className="example-not-executed">
            Original:{" "}
            {exampleVerification?.original.status ??
              (isVerifyingExamples ? "Running…" : "Not executed")}
            {" · "}
            Corrected:{" "}
            {exampleVerification?.corrected.status ??
              (isVerifyingExamples ? "Running…" : "Not executed")}
          </p>
          {fixResult?.exampleTests && fixResult.exampleTests.length > 0 && (
            <button
              className="text-button ai-examples-button"
              onClick={useAiSuggestedExamples}
              disabled={isVerifyingExamples}
            >
              Use {fixResult.exampleTests.length} AI-suggested example
              {fixResult.exampleTests.length === 1 ? "" : "s"} (review required)
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
              I reviewed these AI-suggested expected values and want to use
              them as test targets.
            </label>
          )}
          <button
            className="button button-secondary verify-examples-button"
            onClick={() => void verifyExamples()}
            disabled={
              isVerifyingExamples ||
              !fixResult?.correctedCode ||
              !originalFixCode ||
              (expectationSource === "AI-suggested" &&
                !reviewedAiExpectations)
            }
          >
            {isVerifyingExamples
              ? "Running original and corrected code…"
              : "Run examples on original and corrected code"}
          </button>
          {exampleCaseError && (
            <p className="example-case-error" role="alert">
              {exampleCaseError}
            </p>
          )}
          {exampleVerification && (
            <div className="example-verification" aria-live="polite">
              <p className="example-caveat">
                Example tests are useful checks, but they do not prove complete
                correctness.
              </p>
              <div className="verification-side">
                <h4>Original: {exampleVerification.original.status}</h4>
                <ExampleCaseResults
                  cases={exampleVerification.cases}
                  results={exampleVerification.original.outcomes}
                />
              </div>
              <div className="verification-side">
                <h4>Corrected: {exampleVerification.corrected.status}</h4>
                <ExampleCaseResults
                  cases={exampleVerification.cases}
                  results={exampleVerification.corrected.outcomes}
                />
              </div>
            </div>
          )}

          {fixResult?.needsClarification && (
            <div className="clarification-box" role="status">
              <p>{fixResult.question}</p>
              <p className="clarification-hint">
                Your current code and description are already included. Add only
                the missing detail here.
              </p>
              <label className="field-label" htmlFor="clarification-answer">
                Your answer
              </label>
              <textarea
                id="clarification-answer"
                className="text-field"
                rows={3}
                value={clarificationAnswer}
                maxLength={3_000}
                required
                aria-required="true"
                onChange={(event) => setClarificationAnswer(event.target.value)}
                placeholder="Add a little more detail…"
                disabled={isFixing}
              />
            </div>
          )}

          <button
            className="button button-fix"
            onClick={handleFix}
            disabled={
              isFixing ||
              !code.trim() ||
              code.length > 20_000 ||
              !intendedBehavior.trim() ||
              intendedBehavior.length > 3_000 ||
              (fixResult?.needsClarification &&
                (!clarificationAnswer.trim() ||
                  clarificationAnswer.length > 3_000))
            }
          >
            {isFixing ? (
              <>
                <span className="spinner" />
                Looking closely…
              </>
            ) : fixResult?.needsClarification ? (
              "Send answer"
            ) : (
              "Help me fix it"
            )}
          </button>

          {fixError && (
            <div className="error-box" role="alert">
              <p>{fixError}</p>
              {lastFixRequest && (
                <button
                  className="text-button"
                  onClick={() => void requestFix(lastFixRequest)}
                  disabled={isFixing}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {fixResult && !fixResult.needsClarification && (
            <div className="fix-result" aria-live="polite">
              <div className="result-title-row">
                <h3>Suggested correction — not executed</h3>
                <button
                  className="text-button"
                  onClick={() => void copyCorrectedCode()}
                >
                  Copy corrected code
                </button>
              </div>
              {fixResult.summary && <p className="result-summary">{fixResult.summary}</p>}
              {fixResult.correctedCode && (
                <pre className="corrected-code">
                  <code>{fixResult.correctedCode}</code>
                </pre>
              )}
              {originalFixCode !== null && fixResult.correctedCode && (
                <details className="code-comparison">
                  <summary>Highlighted diff from submitted code</summary>
                  <pre className="code-diff" aria-label="Highlighted code diff">
                    {diffLines.map((line, index) => (
                      <span
                        className={`diff-line diff-${line.kind}`}
                        key={`${index}-${line.kind}`}
                      >
                        <span className="diff-marker" aria-hidden="true">
                          {line.kind === "added"
                            ? "+"
                            : line.kind === "removed"
                              ? "−"
                              : " "}
                        </span>
                        {line.text || " "}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                </details>
              )}
              {fixResult.explanations.length > 0 && (
                <div className="explanation">
                  <div className="explanation-heading">
                    <h4>What changed</h4>
                    <NarrationControls
                      key={[
                        fixResult.summary,
                        ...fixResult.explanations,
                        fixResult.concept ?? "",
                      ].join("\n")}
                      text={[
                        fixResult.summary,
                        ...fixResult.explanations,
                        fixResult.concept,
                      ]
                        .filter((part): part is string => Boolean(part?.trim()))
                        .join("\n")}
                    />
                  </div>
                  <ul>
                    {fixResult.explanations.map((explanation, index) => (
                      <li key={`${index}-${explanation}`}>{explanation}</li>
                    ))}
                  </ul>
                </div>
              )}
              {fixResult.concept && (
                <div className="concept-card">
                  <span className="concept-label">Python concept</span>
                  <p>{fixResult.concept}</p>
                </div>
              )}
              <div className="concept-card">
                <span className="concept-label">Practice pattern</span>
                <p>{fixResult.practiceType.replaceAll("_", " ")}</p>
              </div>
              <button
                className="button button-secondary apply-button"
                onClick={() => {
                  if (fixResult.correctedCode) {
                    updateCode(fixResult.correctedCode);
                  }
                }}
                disabled={!fixResult.correctedCode}
              >
                Use corrected code
              </button>
              {originalFixCode !== null && (
                <button
                  className="text-button edit-submission-button"
                  onClick={() => {
                    updateCode(originalFixCode);
                    editorRef.current?.focus();
                  }}
                >
                  Edit submission
                </button>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="footer">
        <span>Made for the bugs that teach you something.</span>
        <span>Code stays in your browser unless you ask for a fix.</span>
      </footer>
    </main>
  );
}
