/**
 * What's been talked about so far (pure, tested in meeting-intelligence.test.ts):
 * while a consented recording is being transcribed, each talking point is
 * matched against what's been said, so the coach sees which points sound
 * covered and which important ones haven't come up, quietly, never as an
 * interruption. A match is suggested, never marked: the coach marks a point
 * addressed.
 */
import type { Agenda, SectionKey, TalkingPoint } from "./prepare";
import { normalizeWords } from "./analysis";

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "you",
  "your",
  "they",
  "them",
  "their",
  "that",
  "this",
  "have",
  "has",
  "was",
  "were",
  "are",
  "but",
  "not",
  "all",
  "any",
  "out",
  "get",
  "got",
  "from",
  "what",
  "when",
  "how",
  "its",
  "it's",
  "our",
  "we",
  "i",
  "my",
  "me",
  "of",
  "to",
  "in",
  "on",
  "at",
  "a",
  "an",
  "is",
  "be",
  "so",
  "do",
  "did",
  "about",
  "last",
  "weeks",
  "week",
  "days",
  "day",
  "every",
  "some",
]);
const words = (t: string) =>
  normalizeWords(t)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

/** The share of a point's content words that have been said (stems by their first five letters). */
export function pointCoverage(point: string, spoken: Set<string>): number {
  const w = [...new Set(words(point).map((x) => x.slice(0, 5)))];
  if (!w.length) return 0;
  return w.filter((x) => spoken.has(x)).length / w.length;
}

export type CoverageRead = {
  covered: string[];
  overlooked: Array<{ id: string; text: string; section: SectionKey }>;
};

/**
 * Points that sound covered (60% of their words said), and important open
 * points not heard yet once the meeting is past the stage they belong to
 * (recommendations, actions and clarifications are the ones worth a nudge).
 */
export function coverageRead(
  agenda: Agenda | null,
  transcript: string,
  elapsedMin: number,
): CoverageRead {
  if (!agenda || !transcript.trim()) return { covered: [], overlooked: [] };
  const spoken = new Set(words(transcript).map((x) => x.slice(0, 5)));
  const covered: string[] = [];
  const overlooked: CoverageRead["overlooked"] = [];
  let until = 0;
  for (const s of agenda.sections) {
    until += s.minutes;
    for (const p of s.items as TalkingPoint[]) {
      if (p.status && p.status !== "open") continue;
      const c = pointCoverage(p.text, spoken);
      if (c >= 0.6) covered.push(p.id);
      else if (
        elapsedMin > until &&
        (s.key === "coach" || s.key === "execute" || p.kind === "question" || p.clarify)
      )
        overlooked.push({ id: p.id, text: p.text, section: s.key });
    }
  }
  for (const c of agenda.clarify ?? []) {
    if (c.status && c.status !== "open") continue;
    if (pointCoverage(c.text, spoken) < 0.6 && elapsedMin > agenda.minutes / 2)
      overlooked.push({ id: c.id, text: c.text, section: "evaluate" });
  }
  return { covered, overlooked: overlooked.slice(0, 3) };
}
