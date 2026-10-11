import assert from "node:assert/strict";
import { test } from "node:test";
import { errorLessonSchema, fixResultSchema } from "./fix-schema.ts";
import {
  isPythonExampleCases,
  isPythonTestCases,
} from "./pythonRunner.ts";

const lesson = {
  title: "Understand return values",
  diagnosis: "The function returns a value different from its intended result.",
  explanation: "A return expression determines the value sent back to the caller.",
  exampleCode: "def triple(item): return item * 3",
  exampleExplanation: "Calling triple(2) returns 6.",
  checks: [
    { question: "What does triple(3) return?", options: ["3", "9"], correctIndex: 1, explanation: "Three times three is nine.", hint: "Follow the multiplication." },
    { question: "Which expression doubles an input?", options: ["item * 2", "item + 1"], correctIndex: 0, explanation: "Multiplication scales the input.", hint: "Doubling means two copies of the same value." },
  ],
};

test("accepts bounded JSON-compatible example cases", () => {
  assert.equal(
    isPythonExampleCases([
      { functionName: "average", args: [[82, 91, 76]], expected: 83 },
      { functionName: "empty", args: [], expected: null },
    ]),
    true,
  );
  assert.equal(
    isPythonExampleCases([
      { functionName: "average", args: [[Number.NaN]], expected: 0 },
    ]),
    false,
  );
});

test("rejects malformed or unexpected example and function-test fields", () => {
  assert.equal(
    isPythonExampleCases([
      { functionName: "bad name", args: [], expected: 1 },
    ]),
    false,
  );
  assert.equal(
    isPythonExampleCases([
      { functionName: "valid", args: [], expected: 1, extra: true },
    ]),
    false,
  );
  assert.equal(
    isPythonTestCases([
      { functionName: "valid", args: [], unexpected: true },
    ]),
    false,
  );
});

test("normalizes absent suggestions and rejects malformed AI-suggested tests", () => {
  const parsed = fixResultSchema.parse({
    needsClarification: false,
    lesson,
    question: null,
    correctedCode: "def double(value): return value * 2",
    summary: "Multiply the input by two.",
    explanations: ["The function returns the doubled value."],
    concept: null,
    practiceType: "other",
  });
  assert.deepEqual(parsed.exampleTests, []);

  const malformed = fixResultSchema.safeParse({
    needsClarification: false,
    lesson,
    question: null,
    correctedCode: "print('ok')",
    summary: "Print a message.",
    explanations: ["The code now prints a message."],
    concept: null,
    practiceType: "other",
    exampleTests: [
      { functionName: "not valid", args: [], expected: "ok" },
    ],
  });
  assert.equal(malformed.success, false);
});

test("requires a complete lesson and valid answer indexes before accepting a fix", () => {
  assert.equal(errorLessonSchema.safeParse({ ...lesson, checks: [] }).success, false);
  assert.equal(errorLessonSchema.safeParse({ ...lesson, checks: lesson.checks.map(check => ({ ...check, correctIndex: 3 })) }).success, false);
  assert.equal(fixResultSchema.safeParse({ needsClarification: false, question: null,
    correctedCode: "print(1)", summary: "Fixed", explanations: ["A fix"], concept: null, practiceType: "other" }).success, false);
});
