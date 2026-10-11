export type ReviewedExercise = {
  id: string;
  title: string;
  concept: string;
};

export const reviewedExercises: readonly ReviewedExercise[] = [
  {
    id: "accumulator-sum",
    title: "Sum numbers with an accumulator",
    concept: "accumulator",
  },
];

export function getReviewedExercise(
  exerciseId: string,
): ReviewedExercise | undefined {
  return reviewedExercises.find((exercise) => exercise.id === exerciseId);
}
