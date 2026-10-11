import { z } from "zod";

export const saveAttemptSchema = z
  .object({
    attemptId: z.string().uuid(),
    exerciseId: z.string().min(1).max(100),
    concept: z.string().min(1).max(100),
    passed: z.boolean(),
    hintsUsed: z.number().int().min(0).max(100),
    attemptType: z.enum(["guided", "independent"]),
  })
  .strict();

export type SaveAttemptRequest = z.infer<typeof saveAttemptSchema>;

export type PracticeAttempt = {
  attemptId: string;
  sessionId: string;
  exerciseId: string;
  exerciseTitle: string;
  concept: string;
  attemptedAt: string;
  passed: boolean;
  hintsUsed: number;
  attemptType: "guided" | "independent";
};

export type PracticeRecommendation = {
  exerciseId: string;
  exerciseTitle: string;
  concept: string;
  reason: string;
  demonstration: boolean;
};
