/**
 * Cleo's pre-call brief (pure, tested in coaching-sessions.test.ts): the
 * sourced prep (prepare.ts) handed to the model with an id per line, and what
 * comes back checked before the coach sees it. A focus point must cite lines
 * that exist; nothing may carry a number the prep doesn't hold; a question is
 * a question. The brief only organizes what's on file, so it never adds a fact.
 */
import { numbersIn, ungroundedNumbers } from "@/lib/competition/grounding";
import type { Agenda, PrepItem, SectionKey, SessionPrep } from "./prepare";

export type BriefQuestion = { text: string; why: string; section: SectionKey };
export type SessionBrief = {
  summary: string;
  focus: Array<{ text: string; refs: string[] }>;
  questions: BriefQuestion[];
  listenFor: string[];
  avoid: string[];
  /** what code took out, and why (the coach can see it was checked) */
  dropped: string[];
};

export type PrepLine = { id: string; section: SectionKey | "missing"; source: PrepItem["source"]; text: string };

const SECTIONS: SectionKey[] = ["going_well", "improve", "athletes_corner", "game_plan", "alignment"];

/** The prep as numbered lines (P1, P2…), the agenda's sections first, then what's missing. */
export function prepLines(agenda: Agenda | null | undefined, prep: SessionPrep | null | undefined): PrepLine[] {
  const out: PrepLine[] = [];
  let n = 0;
  for (const s of agenda?.sections ?? [])
    for (const i of s.items) out.push({ id: `P${++n}`, section: s.key, source: i.source, text: i.text });
  for (const m of prep?.missing ?? []) out.push({ id: `P${++n}`, section: "missing", source: m.source, text: m.text });
  return out;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** The model's answer as JSON (a fenced block or the first object in it), else null. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const t = String(text ?? "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Read and check the brief: refs that exist, numbers the prep holds, questions that are questions. */
export function checkBrief(text: string, lines: PrepLine[], extra: unknown = null): SessionBrief | null {
  const raw = parseJsonObject(text);
  if (!raw) return null;
  const ids = new Set(lines.map((l) => l.id));
  const allowed = numbersIn([lines.map((l) => l.text), extra]);
  const dropped: string[] = [];
  const clean = (s: string, what: string) => {
    const bad = ungroundedNumbers(s, allowed);
    if (bad.length) {
      dropped.push(`${what}: a number that isn't on file (${bad.join(", ")})`);
      return null;
    }
    return s;
  };
  const summary = clean(clip(raw.summary, 600), "Summary") ?? "";
  const focus = list(raw.focus)
    .map((f: any) => ({ text: clip(f?.text, 300), refs: list(f?.refs).map(String).filter((r) => ids.has(r)) }))
    .filter((f) => {
      if (!f.text) return false;
      if (!f.refs.length) {
        dropped.push(`Focus "${f.text.slice(0, 60)}": it didn't point at anything on file`);
        return false;
      }
      return clean(f.text, "A focus point") != null;
    })
    .slice(0, 3);
  const questions = list(raw.questions)
    .map((q: any) => ({
      text: clip(q?.text, 240),
      why: clip(q?.why, 240),
      section: (SECTIONS.includes(q?.section) ? q.section : "athletes_corner") as SectionKey,
    }))
    .filter((q) => q.text.endsWith("?") && clean(`${q.text} ${q.why}`, "A question") != null)
    .slice(0, 6);
  const listenFor = list(raw.listen_for ?? raw.listenFor)
    .map((s) => clip(s, 200))
    .filter((s) => s && clean(s, "Listen for") != null)
    .slice(0, 4);
  const avoid = list(raw.avoid)
    .map((s) => clip(s, 200))
    .filter((s) => s && clean(s, "Avoid") != null)
    .slice(0, 3);
  if (!summary && !focus.length && !questions.length) return null;
  return { summary, focus, questions, listenFor, avoid, dropped };
}
