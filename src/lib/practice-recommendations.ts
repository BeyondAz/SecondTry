export type PracticeConcept =
  | "accumulator"
  | "early_return"
  | "off_by_one";

export type PracticeAttemptType = "guided" | "independent";

export type MistakePattern = PracticeConcept | "other";

export type PracticeOutcome =
  | "passed"
  | "failed"
  | "error"
  | "timed_out";

export type RecommendationAttempt = {
  attemptId: string;
  concept: PracticeConcept;
  exerciseId: string;
  attemptType: PracticeAttemptType;
  outcome: PracticeOutcome;
  hintsUsed: number;
  occurredAt: string;
};

export type PracticeRecommendation = {
  concept: PracticeConcept;
  exerciseId: string;
  attemptType: PracticeAttemptType;
  reason: string;
};

export type RecommendationExercise = {
  concept: PracticeConcept;
  guidedExerciseId: string;
  independentExerciseId: string;
};

export type CommonMistakePattern = {
  concept: MistakePattern;
  fixCount: number;
  guidedExerciseId: string | null;
};

export const REVISIT_INTERVAL_MS = 24 * 60 * 60 * 1_000;

const PRIORITY = {
  independentFailure: 0,
  independentPassWithHints: 1,
  guidedFailure: 2,
  guidedSuccess: 3,
  independentRevisit: 4,
  untouchedLesson: 5,
} as const;

const CONCEPT_ORDER: PracticeConcept[] = [
  "accumulator",
  "early_return",
  "off_by_one",
];

export function getCommonMistakePatterns(
  recentFixPatterns: readonly MistakePattern[],
  exerciseMap: readonly Pick<
    RecommendationExercise,
    "concept" | "guidedExerciseId"
  >[],
): CommonMistakePattern[] {
  const patternCounts = new Map<MistakePattern, number>();
  for (const concept of recentFixPatterns) {
    patternCounts.set(concept, (patternCounts.get(concept) ?? 0) + 1);
  }

  return Array.from(patternCounts, ([concept, fixCount]) => {
    const exercise = exerciseMap.find((item) => item.concept === concept);
    return exercise || concept === "other"
      ? {
          concept,
          fixCount,
          guidedExerciseId: exercise?.guidedExerciseId ?? null,
        }
      : null;
  })
    .filter((pattern): pattern is CommonMistakePattern => pattern !== null)
    .sort(
      (left, right) =>
        right.fixCount - left.fixCount ||
        [...CONCEPT_ORDER, "other"].indexOf(left.concept) -
          [...CONCEPT_ORDER, "other"].indexOf(right.concept),
    );
}

export function recommendPractice(
  latestAttempts: readonly RecommendationAttempt[],
  exerciseMap: readonly RecommendationExercise[],
  now = new Date(),
): PracticeRecommendation | null {
  const latest = new Map<string, RecommendationAttempt>();
  for (const attempt of latestAttempts) {
    const key = `${attempt.concept}:${attempt.attemptType}`;
    const previous = latest.get(key);
    if (
      !previous ||
      attempt.occurredAt > previous.occurredAt ||
      (attempt.occurredAt === previous.occurredAt &&
        attempt.attemptId > previous.attemptId)
    ) {
      latest.set(key, attempt);
    }
  }

  const candidates: {
    priority: number;
    recency: number;
    concept: PracticeConcept;
    recommendation: PracticeRecommendation;
  }[] = [];

  for (const concept of CONCEPT_ORDER) {
    const exercise = exerciseMap.find((item) => item.concept === concept);
    if (!exercise) continue;
    const independent = latest.get(`${concept}:independent`);
    const guided = latest.get(`${concept}:guided`);
    if (independent) {
      if (independent.outcome !== "passed") {
        candidates.push({
          priority: PRIORITY.independentFailure,
          recency: Date.parse(independent.occurredAt),
          concept,
          recommendation: {
            concept,
            exerciseId: exercise.independentExerciseId,
            attemptType: "independent",
            reason: "Your latest independent run did not pass. Try this exercise again.",
          },
        });
      } else if (independent.hintsUsed > 0) {
        candidates.push({
          priority: PRIORITY.independentPassWithHints,
          recency: Date.parse(independent.occurredAt),
          concept,
          recommendation: {
            concept,
            exerciseId: exercise.independentExerciseId,
            attemptType: "independent",
            reason:
              "Your latest independent run passed with hints. Try it again without hints.",
          },
        });
      } else if (
        now.getTime() - Date.parse(independent.occurredAt) >=
        REVISIT_INTERVAL_MS
      ) {
        candidates.push({
          priority: PRIORITY.independentRevisit,
          recency: Date.parse(independent.occurredAt),
          concept,
          recommendation: {
            concept,
            exerciseId: exercise.independentExerciseId,
            attemptType: "independent",
            reason:
              "It has been at least 24 hours since your unassisted independent pass. Revisit this exercise.",
          },
        });
      }
      continue;
    }

    if (guided && guided.outcome !== "passed") {
      candidates.push({
        priority: PRIORITY.guidedFailure,
        recency: Date.parse(guided.occurredAt),
        concept,
        recommendation: {
          concept,
          exerciseId: exercise.guidedExerciseId,
          attemptType: "guided",
          reason:
            "Your latest guided run did not pass. Try the guided exercise again.",
        },
      });
    } else if (guided?.outcome === "passed") {
      candidates.push({
        priority: PRIORITY.guidedSuccess,
        recency: Date.parse(guided.occurredAt),
        concept,
        recommendation: {
          concept,
          exerciseId: exercise.independentExerciseId,
          attemptType: "independent",
          reason:
            "Your guided exercise passed. Try the independent follow-up next.",
        },
      });
    } else if (!guided) {
      candidates.push({
        priority: PRIORITY.untouchedLesson,
        recency: 0,
        concept,
        recommendation: {
          concept,
          exerciseId: exercise.guidedExerciseId,
          attemptType: "guided",
          reason: "Start this reviewed lesson; you have no recorded runs for it yet.",
        },
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.priority - right.priority ||
      right.recency - left.recency ||
      left.concept.localeCompare(right.concept),
  );
  return candidates[0]?.recommendation ?? null;
}
