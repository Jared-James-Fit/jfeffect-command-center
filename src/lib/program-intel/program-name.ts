/**
 * What a generated program is called (pure, tested in program-intel-save-and-audit.test.ts).
 *
 * A program is named the way a coach names one: after the meet or goal it builds toward
 * ("Westerns Prep", "Nationals Prep") or what it is for ("Off-Season Strength"), never the
 * generator's own label ("Powerlifting · 12 weeks · 4 days"), which the athlete would read as the
 * name of their program. The strategy names it from the coach's notes and the athlete's goals;
 * a dated meet or goal on file is the fallback; with neither it keeps the plain label, which is
 * never written onto the athlete's program.
 */
import { BRAIN_LABEL, type Brain } from "./types";

export const PROGRAM_NAME_MAX = 60;

/** The label a run falls back to with no name: never shown to the athlete as their program's name. */
export function generatedLabel(brain: Brain, weeks: number, days: number): string {
  return `${BRAIN_LABEL[brain] ?? "Program"} · ${weeks} weeks · ${days} days`;
}

/** True for the fallback label (and the shape every run before Nov 23 2026 was saved with). */
export function isGeneratedLabel(name: string | null | undefined): boolean {
  const t = (name ?? "").trim();
  return !t || /·\s*\d+\s*weeks?\s*·\s*\d+\s*days?$/i.test(t);
}

/**
 * A name the model gave, made safe to show: quotes and trailing stops gone, the athlete's own
 * name off the front ("Dwayne's Westerns Prep" → "Westerns Prep"), nothing that is only a length
 * or a block ("12-Week Program", "Block 1"), at most `PROGRAM_NAME_MAX` characters. Null when
 * nothing usable is left.
 */
export function cleanProgramName(
  raw: string | null | undefined,
  firstName?: string | null,
): string | null {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  t = t.replace(/[.;:,!]+$/g, "").trim();
  const first = (firstName ?? "").trim().split(/\s+/)[0];
  if (first) {
    const esc = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^${esc}(?:['’]s)?(?=[\\s—–:-])\\s*(?:[—–:-]\\s*)?`, "i"), "").trim();
    t = t.replace(new RegExp(`\\s*\\(${esc}\\)$`, "i"), "").trim();
  }
  if (!t || t.length > PROGRAM_NAME_MAX) return null;
  if (isGeneratedLabel(t)) return null;
  // only a length, a block or the word "program": not a name
  if (/^(?:block\s*\d+|program|training program|\d+[\s-]*(?:weeks?|wk)\b.*program)$/i.test(t))
    return null;
  if (!/[a-z]/i.test(t)) return null;
  return t;
}

/** Federation and sanction tags that open a meet's name ("CanPL", "OPA", "CPU"): not part of what people call it. */
const FEDERATION = /^(?:[A-Z][A-Za-z]{0,2}[A-Z][A-Za-z]{0,3}|100%\s*RAW)\b\s*[:–—-]?\s*/;

/**
 * A meet's name as a program name: "CanPL Western Canadian Championships 2027" →
 * "Western Canadian Championships Prep", "2027 Canadian Nationals" → "Canadian Nationals Prep".
 * Null when nothing of the name is left.
 */
export function meetProgramName(meet: string | null | undefined): string | null {
  let t = (meet ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 3 && FEDERATION.test(t); i++) t = t.replace(FEDERATION, "").trim();
  t = t
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim();
  t = t.replace(/\s+prep$/i, "").trim();
  if (!t || !/[a-z]/i.test(t)) return null;
  const name = `${t} Prep`;
  return name.length <= PROGRAM_NAME_MAX ? name : `${t.slice(0, PROGRAM_NAME_MAX - 5).trim()} Prep`;
}

export type ProgramGoal = { kind: "meet" | "goal"; name: string; date: string };

/**
 * The program's name: the strategy's when it gave a usable one, else the meet it builds toward,
 * else a short dated goal ("Total 600 kg"), else the fallback label.
 */
export function programNameFor(x: {
  named?: string | null;
  goal?: ProgramGoal | null;
  firstName?: string | null;
  brain: Brain;
  weeks: number;
  days: number;
}): string {
  const named = cleanProgramName(x.named, x.firstName);
  if (named) return named;
  if (x.goal?.kind === "meet") {
    const meet = meetProgramName(x.goal.name);
    if (meet) return meet;
  }
  if (x.goal?.kind === "goal") {
    const goal = cleanProgramName(x.goal.name, x.firstName);
    if (goal && goal.length <= 40) return goal;
  }
  return generatedLabel(x.brain, x.weeks, x.days);
}

const NOTE_PREFIX =
  /^(?:Draft from|From) Program Intelligence \((.*?)\)\.(?: Not visible to the client until you assign it\.)?\s*/;

/**
 * The note a generated block carries for the coach: "Draft from Program Intelligence (Westerns Prep).
 * Not visible to the client until you assign it." while it's a draft, "From Program Intelligence
 * (Westerns Prep)." once assigned. Whatever follows (the deload rule, the coach's own words) is kept;
 * a note that doesn't start that way is left exactly as it is.
 */
export function programIntelNote(
  note: string | null | undefined,
  name: string | null | undefined,
  draft: boolean,
): string | null {
  if (note == null) return null;
  const m = NOTE_PREFIX.exec(note);
  if (!m) return note;
  const title = (name ?? "").trim() || m[1];
  const rest = note.slice(m[0].length).trim();
  const head = draft
    ? `Draft from Program Intelligence (${title}). Not visible to the client until you assign it.`
    : `From Program Intelligence (${title}).`;
  return rest ? `${head} ${rest}` : head;
}
