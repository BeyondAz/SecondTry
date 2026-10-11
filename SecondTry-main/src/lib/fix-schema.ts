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
    functionName: z.string().regex(/^[A-Za-z_]\w*$/).max(100).optional(),
    errorMessage: z.string().max(3_000).optional(),
    exampleArguments: z.string().max(3_000).optional(),
    expectedResult: z.string().max(3_000).optional(),
    executionOutput: z.string().max(8_000).optional(),
    practiceType: practiceTypeSchema.optional(),
  })
  .strict();

export const fixResultSchema = z.discriminatedUnion("needsClarification", [
  z
    .object({
      needsClarification: z.literal(true),
      question: z.string().trim().min(1),
      correctedCode: z.null(),
      summary: z.null(),
      explanations: z.array(z.string()),
      concept: z.null(),
      practiceType: z.null(),
      exampleTests: z.array(suggestedExampleTestSchema).max(25).optional(),
    })
    .strict(),
  z
    .object({
      needsClarification: z.literal(false),
      question: z.null(),
      correctedCode: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      explanations: z.array(z.string().trim().min(1)).min(1),
      concept: z.string().trim().min(1).nullable(),
      practiceType: practiceTypeSchema,
      exampleTests: z.array(suggestedExampleTestSchema).max(25).optional(),
    })
    .strict(),
]);

export type FixRequest = z.infer<typeof fixRequestSchema>;
export type FixResult = z.infer<typeof fixResultSchema>;
