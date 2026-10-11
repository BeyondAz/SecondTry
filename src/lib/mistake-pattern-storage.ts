import type { MistakePattern } from "./practice-recommendations.ts";

export const MISTAKE_PATTERN_STORAGE_KEY = "pyspace.fix-patterns.v1";
export const MAX_MISTAKE_PATTERN_EVENTS = 50;

const practiceConcepts: ReadonlySet<string> = new Set<MistakePattern>([
  "accumulator",
  "early_return",
  "off_by_one",
  "other",
]);

export type ParsedMistakePatternEvents = {
  events: MistakePattern[];
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
        (event): event is MistakePattern =>
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
  events: readonly MistakePattern[],
  concept: MistakePattern,
): MistakePattern[] {
  return [...events, concept].slice(-MAX_MISTAKE_PATTERN_EVENTS);
}

export function serializeMistakePatternEvents(
  events: readonly MistakePattern[],
): string {
  return JSON.stringify({
    version: 1,
    events: events.slice(-MAX_MISTAKE_PATTERN_EVENTS),
  });
}
