import { z } from "zod";

export const practiceTypeSchema = z.enum([
  "accumulator",
  "early_return",
  "off_by_one",
  "other",
]);

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
    })
    .strict(),
]);

export type FixRequest = z.infer<typeof fixRequestSchema>;
export type FixResult = z.infer<typeof fixResultSchema>;
