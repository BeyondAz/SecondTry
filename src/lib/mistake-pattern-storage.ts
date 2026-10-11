import type { PracticeConcept } from "./practice-recommendations.ts";

export const MISTAKE_PATTERN_STORAGE_KEY = "pyspace.fix-patterns.v1";
export const MAX_MISTAKE_PATTERN_EVENTS = 50;

const practiceConcepts: ReadonlySet<string> = new Set<PracticeConcept>([
  "accumulator",
  "early_return",
  "off_by_one",
]);

export type ParsedMistakePatternEvents = {
  events: PracticeConcept[];
  malformed: boolean;
};

export function parseMistakePatternEvents(
  rawValue: string | null,
): ParsedMistakePatternEvents {
  if (rawValue === null) return { events: [], malformed: false };

  try {
    const value: unknown = JSON.parse(rawValue);
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("events" in value) ||
      !Array.isArray(value.events) ||
      !value.events.every(
        (event): event is PracticeConcept =>
          typeof event === "string" &&
          practiceConcepts.has(event),
      )
    ) {
      return { events: [], malformed: true };
    }

    return {
      events: value.events.slice(-MAX_MISTAKE_PATTERN_EVENTS),
      malformed: false,
    };
  } catch {
    return { events: [], malformed: true };
  }
}

export function appendMistakePatternEvent(
  events: readonly PracticeConcept[],
  concept: PracticeConcept,
): PracticeConcept[] {
  return [...events, concept].slice(-MAX_MISTAKE_PATTERN_EVENTS);
}

export function serializeMistakePatternEvents(
  events: readonly PracticeConcept[],
): string {
  return JSON.stringify({
    version: 1,
    events: events.slice(-MAX_MISTAKE_PATTERN_EVENTS),
  });
}
