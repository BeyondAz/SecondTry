import type { PythonValue } from "@/lib/pythonRunner";

export type PracticeConcept =
  | "accumulator"
  | "early_return"
  | "off_by_one";

export type LessonTest = {
  name: string;
  args: PythonValue[];
  expected: PythonValue;
};

export type Exercise = {
  id: string;
  concept: PracticeConcept;
  title: string;
  instructions: string;
  starterCode: string;
  functionName: string;
  referenceSolution: string;
  tests: LessonTest[];
  hints: [string, string, string];
  followUpExerciseId?: string;
  commonIncorrectAnswers: { label: string; code: string }[];
};

export type Lesson = {
  id: PracticeConcept;
  title: string;
  explanation: string;
  prediction: {
    code: string;
    question: string;
    answer: string;
    explanation: string;
  };
  guidedExerciseId: string;
};

export const exercises: Exercise[] = [
  {
    id: "sum-numbers",
    concept: "accumulator",
    title: "Repair a running total",
    instructions:
      "Fix sum_numbers so it adds every value to total and returns 0 for an empty list. Keep the loop-based approach.",
    starterCode: `def sum_numbers(numbers):
    total = 0
    for number in numbers:
        total = number
    return total`,
    functionName: "sum_numbers",
    referenceSolution: `def sum_numbers(numbers):
    total = 0
    for number in numbers:
        total += number
    return total`,
    tests: [
      { name: "adds every value", args: [[2, 3, 4]], expected: 9 },
      { name: "empty list", args: [[]], expected: 0 },
      { name: "negative values", args: [[-5, 2, -1]], expected: -4 },
      { name: "single value", args: [[-7]], expected: -7 },
    ],
    hints: [
      "The total should keep its previous value as each number is processed.",
      "Compare `total = number` with an update that adds number to total.",
      "Inside the loop, use `total += number`.",
    ],
    followUpExerciseId: "count-positive",
    commonIncorrectAnswers: [
      {
        label: "Overwrite the total each time",
        code: `def sum_numbers(numbers):
    total = 0
    for number in numbers:
        total = number
    return total`,
      },
      {
        label: "Start at one",
        code: `def sum_numbers(numbers):
    total = 1
    for number in numbers:
        total += number
    return total`,
      },
    ],
  },
  {
    id: "count-positive",
    concept: "accumulator",
    title: "Count positive values",
    instructions:
      "Write count_positive to return how many values are greater than zero. Zero and negative values do not count.",
    starterCode: `def count_positive(numbers):
    count = 0
    for number in numbers:
        if number > 0:
            count = 1
    return count`,
    functionName: "count_positive",
    referenceSolution: `def count_positive(numbers):
    count = 0
    for number in numbers:
        if number > 0:
            count += 1
    return count`,
    tests: [
      { name: "mixed values", args: [[3, -1, 0, 2]], expected: 2 },
      { name: "empty list", args: [[]], expected: 0 },
      { name: "no positive values", args: [[-4, 0, -2]], expected: 0 },
      { name: "all positive values", args: [[1, 2, 3]], expected: 3 },
    ],
    hints: [
      "The count needs to grow once for each positive value.",
      "Assigning 1 repeatedly cannot count more than one positive value.",
      "Change `count = 1` to `count += 1`.",
    ],
    commonIncorrectAnswers: [
      {
        label: "Set the count to one",
        code: `def count_positive(numbers):
    count = 0
    for number in numbers:
        if number > 0:
            count = 1
    return count`,
      },
      {
        label: "Count zero as positive",
        code: `def count_positive(numbers):
    count = 0
    for number in numbers:
        if number >= 0:
            count += 1
    return count`,
      },
    ],
  },
  {
    id: "find-first",
    concept: "early_return",
    title: "Return at the first match",
    instructions:
      "Fix find_first so it returns the index of the first matching number, or -1 when the target is absent.",
    starterCode: `def find_first(numbers, target):
    for index, number in enumerate(numbers):
        if number == target:
            return index
        return -1
    return -1`,
    functionName: "find_first",
    referenceSolution: `def find_first(numbers, target):
    for index, number in enumerate(numbers):
        if number == target:
            return index
    return -1`,
    tests: [
      { name: "first element", args: [[7, 4, 7], 7], expected: 0 },
      { name: "middle element", args: [[4, 7, 9], 7], expected: 1 },
      { name: "last element", args: [[4, 7, 9], 9], expected: 2 },
      { name: "not found", args: [[4, 7, 9], 3], expected: -1 },
      { name: "empty list", args: [[], 3], expected: -1 },
    ],
    hints: [
      "A non-matching first item does not prove the target is absent.",
      "Keep checking after a mismatch; return -1 only after the loop ends.",
      "Dedent `return -1` so it is outside the loop.",
    ],
    followUpExerciseId: "contains-target",
    commonIncorrectAnswers: [
      {
        label: "Return not-found inside the loop",
        code: `def find_first(numbers, target):
    for index, number in enumerate(numbers):
        if number == target:
            return index
        return -1
    return -1`,
      },
      {
        label: "Return the last matching index",
        code: `def find_first(numbers, target):
    found = -1
    for index, number in enumerate(numbers):
        if number == target:
            found = index
    return found`,
      },
    ],
  },
  {
    id: "contains-target",
    concept: "early_return",
    title: "Stop once a target is found",
    instructions:
      "Implement contains_target to return True when the target appears in the list and False otherwise. Keep the early return when it is found.",
    starterCode: `def contains_target(values, target):
    for value in values:
        if value == target:
            return True
        return False
    return False`,
    functionName: "contains_target",
    referenceSolution: `def contains_target(values, target):
    for value in values:
        if value == target:
            return True
    return False`,
    tests: [
      { name: "first value matches", args: [[2, 4, 6], 2], expected: true },
      { name: "last value matches", args: [[2, 4, 6], 6], expected: true },
      { name: "target absent", args: [[2, 4, 6], 5], expected: false },
      { name: "empty list", args: [[], 2], expected: false },
    ],
    hints: [
      "A mismatch should continue the search, not decide the final answer.",
      "Return False only after every value has been checked.",
      "Dedent `return False` so it is outside the loop.",
    ],
    commonIncorrectAnswers: [
      {
        label: "Return False after the first mismatch",
        code: `def contains_target(values, target):
    for value in values:
        if value == target:
            return True
        return False
    return False`,
      },
      {
        label: "Never return True for a match",
        code: `def contains_target(values, target):
    for value in values:
        if value == target:
            continue
    return False`,
      },
    ],
  },
  {
    id: "inclusive-range-sum",
    concept: "off_by_one",
    title: "Include both endpoints",
    instructions:
      "Fix sum_inclusive so it adds every integer from start through stop, including both endpoints. If start is greater than stop, return 0.",
    starterCode: `def sum_inclusive(start, stop):
    total = 0
    for value in range(start, stop):
        total += value
    return total`,
    functionName: "sum_inclusive",
    referenceSolution: `def sum_inclusive(start, stop):
    total = 0
    for value in range(start, stop + 1):
        total += value
    return total`,
    tests: [
      { name: "includes final endpoint", args: [2, 5], expected: 14 },
      { name: "single endpoint", args: [4, 4], expected: 4 },
      { name: "negative and positive endpoints", args: [-2, 2], expected: 0 },
      { name: "zero through one", args: [0, 1], expected: 1 },
      { name: "reversed endpoints", args: [3, 1], expected: 0 },
    ],
    hints: [
      "Python's range stop value is excluded.",
      "The loop must reach stop as one of its values.",
      "Use `range(start, stop + 1)`.",
    ],
    followUpExerciseId: "inclusive-square-sum",
    commonIncorrectAnswers: [
      {
        label: "Exclude the stop endpoint",
        code: `def sum_inclusive(start, stop):
    total = 0
    for value in range(start, stop):
        total += value
    return total`,
      },
      {
        label: "Add two to the stop",
        code: `def sum_inclusive(start, stop):
    total = 0
    for value in range(start, stop + 2):
        total += value
    return total`,
      },
    ],
  },
  {
    id: "inclusive-square-sum",
    concept: "off_by_one",
    title: "Square values through the endpoint",
    instructions:
      "Implement sum_squares_inclusive to add the square of each integer from start through stop. Return 0 when start is greater than stop.",
    starterCode: `def sum_squares_inclusive(start, stop):
    total = 0
    for value in range(start, stop):
        total += value * value
    return total`,
    functionName: "sum_squares_inclusive",
    referenceSolution: `def sum_squares_inclusive(start, stop):
    total = 0
    for value in range(start, stop + 1):
        total += value * value
    return total`,
    tests: [
      { name: "includes final endpoint", args: [1, 3], expected: 14 },
      { name: "negative through positive", args: [-1, 1], expected: 2 },
      { name: "single endpoint", args: [2, 2], expected: 4 },
      { name: "reversed endpoints", args: [4, 2], expected: 0 },
    ],
    hints: [
      "The last value produced by range is one less than its stop.",
      "The endpoint's square must be included in the total.",
      "Use `range(start, stop + 1)`.",
    ],
    commonIncorrectAnswers: [
      {
        label: "Exclude the stop endpoint",
        code: `def sum_squares_inclusive(start, stop):
    total = 0
    for value in range(start, stop):
        total += value * value
    return total`,
      },
      {
        label: "Skip the start endpoint",
        code: `def sum_squares_inclusive(start, stop):
    total = 0
    for value in range(start + 1, stop + 1):
        total += value * value
    return total`,
      },
    ],
  },
];

export const lessons: Lesson[] = [
  {
    id: "accumulator",
    title: "Loops & totals",
    explanation:
      "Keep a running total or count as a loop handles each item. Start at the right value, then update the result instead of replacing it.",
    prediction: {
      code: `total = 0
for number in [3, -1, 2]:
    total += number
print(total)`,
      question: "What single number will this code print?",
      answer: "4",
      explanation: "The running total is 0, then 3, then 2, then 4.",
    },
    guidedExerciseId: "sum-numbers",
  },
  {
    id: "early_return",
    title: "Searching & stopping",
    explanation:
      "Keep checking after a mismatch. Return as soon as you find the answer, and use a fallback only after the search is over.",
    prediction: {
      code: `def find_first(values, target):
    for index, value in enumerate(values):
        if value == target:
            return index
    return -1

print(find_first([4, 7, 9], 7))`,
      question: "What index will this code print?",
      answer: "1",
      explanation: "The value 7 is the second item, whose zero-based index is 1.",
    },
    guidedExerciseId: "find-first",
  },
  {
    id: "off_by_one",
    title: "Counting & endpoints",
    explanation:
      "Python ranges include the start but stop before the end. Check the first and last values, especially when a range should include both ends.",
    prediction: {
      code: `for number in range(2, 5):
    print(number)`,
      question: "Which numbers are printed, in order?",
      answer: "2, 3, 4",
      explanation: "range(2, 5) stops before 5, so it produces 2, 3, and 4.",
    },
    guidedExerciseId: "inclusive-range-sum",
  },
];

export function getExercise(id: string): Exercise | undefined {
  return exercises.find((exercise) => exercise.id === id);
}

export function getLessonForConcept(
  concept: string,
): Lesson | undefined {
  return lessons.find((lesson) => lesson.id === concept);
}

export function getExerciseAttemptType(
  exerciseId: string,
): "guided" | "independent" | undefined {
  if (lessons.some((lesson) => lesson.guidedExerciseId === exerciseId)) {
    return "guided";
  }
  if (
    exercises.some((exercise) => exercise.followUpExerciseId === exerciseId)
  ) {
    return "independent";
  }
  return undefined;
}
