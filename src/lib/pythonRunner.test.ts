import assert from "node:assert/strict";
import { test } from "node:test";
import { fixResultSchema } from "./fix-schema.ts";
import {
  isPythonExampleCases,
  isPythonTestCases,
} from "./pythonRunner.ts";

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
