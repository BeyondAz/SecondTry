"use client";

import { useEffect, useRef, useState } from "react";
import type { ErrorLesson } from "@/lib/fix-schema";

export default function ErrorLessonCard({ lesson, onComplete }: {
  lesson: ErrorLesson;
  onComplete: () => void;
}) {
  const lessonRef = useRef<HTMLElement>(null);
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "retry" | null>(null);
  const check = lesson.checks[step];

  useEffect(() => {
    if (!started) return;
    lessonRef.current?.closest(".tutor-screen")?.scrollIntoView({ block: "start", behavior: "instant" });
    lessonRef.current?.focus({ preventScroll: true });
  }, [started, step]);

  function advance() {
    if (feedback !== "correct") return;
    if (step === lesson.checks.length - 1) {
      onComplete();
      return;
    }
    setStep(step + 1);
    setChoice(null);
    setFeedback(null);
  }

  return (
    <section ref={lessonRef} tabIndex={-1} className="error-lesson" aria-labelledby="error-lesson-title">
      <p className="eyebrow">Your error → your lesson</p>
      <h3 id="error-lesson-title">{lesson.title}</h3>
      {!started && <>
      <div className="lesson-diagnosis"><strong>What’s happening in your code</strong><p>{lesson.diagnosis}</p></div>
      <p className="lesson-teaching">{lesson.explanation}</p>
      <h4>A small example to explore</h4>
      <pre className="lesson-example"><code>{lesson.exampleCode}</code></pre>
      <p className="lesson-teaching">{lesson.exampleExplanation}</p>
      </>}
      {!started ? (
        <>
          <p className="lesson-lock-note">Complete {lesson.checks.length} short checks to unlock your corrected code. Take as many tries as you need.</p>
          <button className="button button-primary" onClick={() => setStarted(true)}>Let’s work through it →</button>
        </>
      ) : (
        <div className="lesson-check">
          <details className="lesson-review">
            <summary>Need a refresher? Review the lesson</summary>
            <p className="lesson-teaching">{lesson.explanation}</p>
            <pre className="lesson-example"><code>{lesson.exampleCode}</code></pre>
            <p className="lesson-teaching">{lesson.exampleExplanation}</p>
          </details>
          <div className="lesson-check-heading"><span>Check {step + 1} of {lesson.checks.length}</span><span>{feedback === "correct" ? step + 1 : step} completed</span></div>
          <progress value={feedback === "correct" ? step + 1 : step} max={lesson.checks.length} aria-label="Lesson checks completed" />
          <fieldset disabled={feedback === "correct"}>
            <legend>{check.question}</legend>
            {check.options.map((option, index) => (
              <label className={`lesson-option ${choice === index ? "lesson-option-selected" : ""}`} key={`${step}-${index}`}>
                <input type="radio" name={`lesson-check-${step}`} checked={choice === index}
                  onChange={() => { setChoice(index); setFeedback(null); }} />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>
          <div aria-live="polite">
            {feedback === "retry" && <p className="lesson-feedback lesson-feedback-retry">Give it another try. {check.hint}</p>}
            {feedback === "correct" && <p className="lesson-feedback">That’s right. {check.explanation}</p>}
          </div>
          {feedback === "correct" ? (
            <button className="button button-primary" onClick={advance}>
              {step === lesson.checks.length - 1 ? "Finish lesson & reveal my fix" : "Next check →"}
            </button>
          ) : (
            <button className="button button-primary" disabled={choice === null}
              onClick={() => setFeedback(choice === check.correctIndex ? "correct" : "retry")}>Check my understanding</button>
          )}
        </div>
      )}
    </section>
  );
}
