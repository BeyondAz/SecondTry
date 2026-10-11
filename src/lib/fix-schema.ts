import { z } from "zod";

export const practiceTypeSchema = z.enum([
  "accumulator",
  "early_return",
  "off_by_one",
  "other",
]);

const suggestedExampleTestSchema = z
  .object({
    functionName: z.string().regex(/^[A-Za-z_]\w*$/).max(100),
    args: z.array(z.json()).max(100),
    expected: z.json(),
  })
  .strict();

export const fixRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(20_000),
    intendedBehavior: z.string().max(3_000).default(""),
    followUpAnswer: z.string().max(3_000).optional(),
    executionOutput: z.string().max(8_000).optional(),
    errorMessage: z.string().max(3_000).optional(),
    exampleArguments: z.string().max(3_000).optional(),
    expectedResult: z.string().max(3_000).optional(),
    practiceType: practiceTypeSchema.optional(),
  })
  .strict();

export const errorLessonSchema = z.object({
  title: z.string().trim().min(1).max(160),
  diagnosis: z.string().trim().min(1).max(2000),
  explanation: z.string().trim().min(1).max(4000),
  exampleCode: z.string().trim().min(1).max(3000),
  exampleExplanation: z.string().trim().min(1).max(2000),
  checks: z.array(z.object({
    question: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(1000)).min(2).max(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().min(1).max(2000),
    hint: z.string().trim().min(1).max(1000),
  }).strict().refine((check) => check.correctIndex < check.options.length, {
    message: "The correct answer must refer to an available option.",
  })).min(2).max(3),
}).strict();

export type ErrorLesson = z.infer<typeof errorLessonSchema>;

export const fixResultSchema = z.discriminatedUnion("needsClarification", [
  z
    .object({
      needsClarification: z.literal(true),
      lesson: z.null(),
      question: z.string().trim().min(1),
      correctedCode: z.null(),
      summary: z.null(),
      explanations: z.array(z.string()),
      concept: z.null(),
      practiceType: z.null(),
      exampleTests: z.array(suggestedExampleTestSchema).max(25).default([]),
    })
    .strict(),
  z
    .object({
      needsClarification: z.literal(false),
      lesson: errorLessonSchema,
      question: z.null(),
      correctedCode: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      explanations: z.array(z.string().trim().min(1)).min(1),
      concept: z.string().trim().min(1).nullable(),
      practiceType: practiceTypeSchema,
      exampleTests: z.array(suggestedExampleTestSchema).max(25).default([]),
    })
    .strict(),
]);

export type FixRequest = z.infer<typeof fixRequestSchema>;
export type FixResult = z.infer<typeof fixResultSchema>;
