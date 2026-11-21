/**
 * How an AI read of a program is read back (its prompt is server only,
 * ai-prompt.server.ts). The AI
 * only copies: every value must be written in the file, nothing is worked
 * out or filled in, progression in words stays words. Code then checks the
 * answer against the file (`groundingFlags`): a name or a number that isn't
 * in the line it says it came from is flagged for the person, never trusted.
 * Pure.
 */
import { effortRange, repsText, restSeconds, unitWord } from "./prescription";
import type { ImportedExercise, ImportedProgram, ImportFlag, WeightUnit } from "./types";
import { expandWeekRanges } from "./weeks";

/* ------------------------------------------------------------------ */
/*  Reading the answer                                                 */
/* ------------------------------------------------------------------ */

export class UnreadableAnswer extends Error {}

/** The JSON in a model's answer (fences and talk around it ignored). */
function jsonIn(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new UnreadableAnswer("No program came back.");
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new UnreadableAnswer("The answer was cut off or wasn't valid.");
  }
}

const str = (v: unknown, max = 400): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const numOr = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function readExercise(raw: any): ImportedExercise | null {
  const name = str(raw?.name, 80);
  if (!name) return null;
  const notes: string[] = [];
  const unsure: string[] = [];
  const note = str(raw?.notes, 300);
  if (note) notes.push(note);
  if (str(raw?.unsure, 200)) unsure.push(str(raw.unsure, 200)!);

  let sets = numOr(raw?.sets);
  if (sets != null && !(Number.isInteger(sets) && sets >= 1 && sets <= 50)) {
    unsure.push(`Sets read as "${raw.sets}"`);
    sets = null;
  }
  let reps: string | null = null;
  const repsRaw = str(raw?.reps, 40);
  if (repsRaw) {
    reps = repsText(repsRaw);
    if (!reps) {
      // kept as written when it fits the plan (20 characters), else said
      if (repsRaw.length <= 20) reps = repsRaw;
      else {
        notes.push(`Reps: ${repsRaw}`);
        unsure.push("Reps were written in words");
      }
    }
  }
  const effort = (k: "rpe" | "rir") => {
    const v = str(raw?.[k], 20);
    if (!v) return null;
    const r = effortRange(v.replace(/^@\s*/, ""), k);
    if (!r) {
      notes.push(`${k.toUpperCase()} ${v}`);
      unsure.push(`${k.toUpperCase()} "${v}" isn't on the app's scale`);
    }
    return r;
  };
  const rpe = effort("rpe");
  const rir = rpe ? null : effort("rir");
  let pct = numOr(raw?.pct);
  if (pct != null && pct > 0 && pct <= 1.5) pct = Math.round(pct * 1000) / 10;
  if (pct != null && !(pct > 0 && pct <= 150)) {
    unsure.push(`A percentage read as ${raw.pct}`);
    pct = null;
  }
  let load = pct != null ? null : numOr(raw?.load);
  if (load != null && !(load > 0 && load <= 1500)) {
    unsure.push(`A weight read as ${raw.load}`);
    load = null;
  }
  const unit: WeightUnit | null = load != null ? unitWord(str(raw?.unit, 10)) : null;
  let rest = numOr(raw?.rest_seconds);
  if (rest == null && str(raw?.rest, 20)) rest = restSeconds(String(raw.rest)).seconds;
  if (rest != null && !(rest > 0 && rest <= 3600)) rest = null;
  return {
    name,
    sets,
    reps,
    load,
    unit,
    pct,
    pct_of: pct != null ? (raw?.pct_of === "top_set" ? "top_set" : "1rm") : null,
    rpe,
    rir,
    tempo: str(raw?.tempo, 12),
    rest_seconds: rest != null ? Math.min(Math.round(rest), 900) : null,
    group: str(raw?.group, 20),
    velocity: str(raw?.velocity, 30),
    notes: notes.length ? notes.join(". ").slice(0, 300) : null,
    src: str(raw?.src, 200),
    unsure: unsure.length ? unsure.join("; ").slice(0, 200) : null,
  };
}

/** The model's answer as a program, every value checked for type and range (nothing taken on trust). */
export function readAiImport(text: string): ImportedProgram {
  const j = jsonIn(text);
  const blocksRaw = Array.isArray(j?.blocks) ? j.blocks : Array.isArray(j?.weeks) ? [{ weeks: j.weeks }] : [];
  const blocks = blocksRaw
    .map((b: any) => ({
      name: str(b?.name, 40),
      weeks: (Array.isArray(b?.weeks) ? b.weeks : [])
        .map((w: any) => ({
          label: str(w?.label, 40),
          deload: w?.deload === true,
          notes: str(w?.notes, 600),
          repeat: Number.isInteger(w?.repeat) && w.repeat >= 2 && w.repeat <= 24 ? w.repeat : null,
          days: (Array.isArray(w?.days) ? w.days : [])
            .map((d: any) => ({
              title: str(d?.title, 40),
              notes: str(d?.notes, 600),
              exercises: (Array.isArray(d?.exercises) ? d.exercises : []).map(readExercise).filter(Boolean) as ImportedExercise[],
            }))
            .filter((d: any) => d.exercises.length),
        }))
        .filter((w: any) => w.days.length),
    }))
    .filter((b: any) => b.weeks.length);
  if (!blocks.length) throw new UnreadableAnswer("No exercises were found in it.");
  return expandWeekRanges({
    title: str(j?.title, 80),
    notes: str(j?.notes, 2000),
    unit: unitWord(str(j?.unit, 10)),
    blocks,
    progression: (Array.isArray(j?.progression) ? j.progression : []).map((p: unknown) => str(p, 400)).filter(Boolean) as string[],
    issues: (Array.isArray(j?.issues) ? j.issues : [])
      .map((i: any) => ({ where: str(i?.where, 80) ?? "", text: str(i?.text, 300) ?? "" }))
      .filter((i: { text: string }) => i.text)
      .slice(0, 30),
  });
}

/* ------------------------------------------------------------------ */
/*  Checking the answer against the file                               */
/* ------------------------------------------------------------------ */

/** Text as compared: lower case, one space, × as x, dashes as "-". */
export function normForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[×✕]/g, "x")
    .replace(/[–—−]/g, "-")
    .replace(/[“”"‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** A number as it could be written ("7.5" also as "7,5"; 120 seconds also as "2" min). */
function writtenForms(n: number): string[] {
  const s = String(n);
  return [s, s.replace(".", ",")];
}

/**
 * Where an AI-read exercise isn't backed by the file (text sources only: a
 * PDF or a photo has no text to check against, so its rows are only flagged
 * when the AI said it was unsure). Positions are filled in by the caller.
 */
export function groundingFlags(e: ImportedExercise, source: string | null): string[] {
  if (!source) return [];
  const doc = normForMatch(source);
  const out: string[] = [];
  const src = e.src ? normForMatch(e.src) : "";
  const srcFound = !!src && (doc.includes(src) || doc.replace(/ \| /g, " ").includes(src.replace(/ \| /g, " ")));
  const nameTokens = normForMatch(e.name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const missingName = nameTokens.filter((t) => !doc.includes(t));
  if (nameTokens.length && missingName.length === nameTokens.length) out.push(`"${e.name}" isn't written in your file`);
  let hay = src;
  if (!srcFound) {
    // no line given (or not word for word): the file's lines that name the exercise are what its numbers must come from
    const lines = source.split("\n").map(normForMatch).filter((l) => nameTokens.length > 0 && nameTokens.every((t) => l.includes(t)));
    if (!lines.length) {
      if (e.src || missingName.length < nameTokens.length) out.push("Couldn't find where this came from in your file to check its numbers");
      return [...new Set(out)];
    }
    hay = lines.join(" ¦ ");
  }
  const has = (n: number) => writtenForms(n).some((f) => new RegExp(`(^|[^0-9.])${f.replace(".", "\\.")}([^0-9]|$)`).test(hay));
  if (e.sets != null && !has(e.sets)) out.push(`${e.sets} sets isn't in the line it came from`);
  for (const n of (e.reps ?? "").match(/\d+/g) ?? []) if (!has(Number(n))) out.push(`${e.reps} reps isn't in the line it came from`);
  if (e.load != null && !has(e.load)) out.push(`${e.load} ${e.unit ?? ""} isn't in the line it came from`.replace(" isn", " isn"));
  if (e.pct != null && !has(e.pct)) out.push(`${e.pct}% isn't in the line it came from`);
  for (const k of ["rpe", "rir"] as const) {
    for (const n of (e[k] ?? "").split("-").filter(Boolean)) if (!has(Number(n))) out.push(`${k.toUpperCase()} ${e[k]} isn't in the line it came from`);
  }
  return [...new Set(out)];
}

/** Every exercise's grounding problems, as flags (positions from the program as read). */
export function programGroundingFlags(p: ImportedProgram, source: string | null): ImportFlag[] {
  const out: ImportFlag[] = [];
  p.blocks.forEach((b, bi) =>
    b.weeks.forEach((w, wi) =>
      w.days.forEach((d, di) =>
        d.exercises.forEach((e, ei) => {
          for (const text of groundingFlags(e, source)) out.push({ level: "check", code: "not_in_file", text: `${e.name}: ${text}`, at: { b: bi, w: wi, d: di, e: ei } });
        }),
      ),
    ),
  );
  return out;
}
