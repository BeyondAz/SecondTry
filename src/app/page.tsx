"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { PyodideInterface } from "pyodide";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/";

const starterCode = `# Welcome to Pyspace
name = "world"
print(f"Hello, {name}!")
`;

const exampleCode = `def average(numbers):
    return sum(numbers) / len(number)

scores = [82, 91, 76]
print(f"The average score is {average(scores):.1f}")
`;

type FixRequest = {
  code: string;
  intendedBehavior: string;
  followUpAnswer?: string;
};

type FixResult = {
  needsClarification: boolean;
  question: string | null;
  correctedCode: string | null;
  summary: string | null;
  explanations: string[];
  concept: string | null;
};

function isFixResult(value: unknown): value is FixResult {
  if (!value || typeof value !== "object") return false;

  const result = value as Record<string, unknown>;
  return (
    typeof result.needsClarification === "boolean" &&
    (typeof result.question === "string" || result.question === null) &&
    (typeof result.correctedCode === "string" ||
      result.correctedCode === null) &&
    (typeof result.summary === "string" || result.summary === null) &&
    Array.isArray(result.explanations) &&
    result.explanations.every((item) => typeof item === "string") &&
    (typeof result.concept === "string" || result.concept === null)
  );
}

export default function Home() {
  const [code, setCode] = useState(starterCode);
  const [intendedBehavior, setIntendedBehavior] = useState("");
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
  const pyodideRef = useRef<PyodideInterface | null>(null);

  const runCode = useCallback(async () => {
    setIsRunning(true);
    setOutput("");
    setRunError("");

    try {
      let pyodide = pyodideRef.current;
      if (!pyodide) {
        setIsLoadingPython(true);
        const pyodideModuleUrl = new URL("pyodide.mjs", PYODIDE_INDEX_URL).href;
        const { loadPyodide } = await import(
          /* webpackIgnore: true */ /* turbopackIgnore: true */ pyodideModuleUrl
        );
        pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
        pyodideRef.current = pyodide;
      }

      if (!pyodide) {
        throw new Error("Python runtime did not initialize.");
      }

      pyodide.setStdout({
        batched: (text) => setOutput((current) => `${current}${text}\n`),
      });
      pyodide.setStderr({
        batched: (text) => setOutput((current) => `${current}${text}\n`),
      });
      await pyodide.runPythonAsync(code);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : "Python could not be run.",
      );
    } finally {
      setIsLoadingPython(false);
      setIsRunning(false);
    }
  }, [code]);

  const requestFix = useCallback(async (request: FixRequest) => {
    setIsFixing(true);
    setFixError("");
    setFixResult(null);
    setLastFixRequest(request);

    try {
      const response = await fetch("/api/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
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

      if (!isFixResult(data)) {
        throw new Error("Gemini returned an unexpected response. Please retry.");
      }

      setOriginalFixCode(request.code);
      setFixResult(data);
      setClarificationAnswer("");
    } catch (error) {
      setFixError(
        error instanceof Error
          ? error.message
          : "The fix request failed. Please try again.",
      );
    } finally {
      setIsFixing(false);
    }
  }, []);

  const handleFix = () => {
    void requestFix({
      code,
      intendedBehavior,
      ...(fixResult?.needsClarification && clarificationAnswer.trim()
        ? { followUpAnswer: clarificationAnswer.trim() }
        : {}),
    });
  };

  const loadExample = () => {
    setCode(exampleCode);
    setIntendedBehavior("Calculate and display the average score.");
    setClarificationAnswer("");
    setFixResult(null);
    setOriginalFixCode(null);
    setFixError("");
    setOutput("");
    setRunError("");
  };

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
        <a className="brand" href="/" aria-label="Pyspace home">
          <span className="brand-mark" aria-hidden="true">
            {"</>"}
          </span>
          <span>pyspace</span>
        </a>
        <div className="topbar-note">
          <span className="status-dot" />
          Python playground
        </div>
        <button className="button button-secondary example-button" onClick={loadExample}>
          Load example
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
              <span className="panel-hint">Python 3</span>
            </div>
            <div className="editor-wrap">
              <Editor
                height="390px"
                language="python"
                theme="vs-dark"
                value={code}
                onChange={(value) => setCode(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: "var(--font-geist-mono), monospace",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  padding: { top: 18, bottom: 18 },
                }}
              />
            </div>
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
                <button
                  className="button button-run"
                  onClick={() => void runCode()}
                  disabled={isRunning || !code.trim()}
                >
                  {isRunning ? (
                    <>
                      <span className="spinner" />
                      {isLoadingPython ? "Starting Python…" : "Running…"}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">▶</span>
                      Run code
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          <section className="panel output-panel" aria-labelledby="output-title">
            <div className="panel-heading output-heading">
              <h2 id="output-title">Output</h2>
              <span className="panel-hint">Console</span>
            </div>
            <pre className={`output-content${runError ? " output-error" : ""}`}>
              {output}
              {runError}
              {!output && !runError &&
                (isRunning ? "Starting the Python runtime…" : "Run your code to see the output.")}
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
            Explain what you expected, and Gemini will help you understand and
            correct the code.
          </p>

          <label className="field-label" htmlFor="intended-behavior">
            What should the code do?
          </label>
          <textarea
            id="intended-behavior"
            className="text-field"
            rows={4}
            value={intendedBehavior}
            onChange={(event) => setIntendedBehavior(event.target.value)}
            placeholder="Describe the expected result or the problem you noticed…"
            disabled={isFixing}
          />

          {fixResult?.needsClarification && (
            <div className="clarification-box" role="status">
              <p>{fixResult.question}</p>
              <label className="field-label" htmlFor="clarification-answer">
                Your answer
              </label>
              <textarea
                id="clarification-answer"
                className="text-field"
                rows={3}
                value={clarificationAnswer}
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
              (fixResult?.needsClarification && !clarificationAnswer.trim())
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
                <h3>Suggested fix</h3>
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
                  <summary>Compare with original code</summary>
                  <pre className="corrected-code original-code">
                    <code>{originalFixCode}</code>
                  </pre>
                </details>
              )}
              {fixResult.explanations.length > 0 && (
                <div className="explanation">
                  <h4>What changed</h4>
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
              <button
                className="button button-secondary apply-button"
                onClick={() => {
                  if (fixResult.correctedCode) {
                    setCode(fixResult.correctedCode);
                    setOutput("");
                    setRunError("");
                  }
                }}
                disabled={!fixResult.correctedCode}
              >
                Use corrected code
              </button>
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
