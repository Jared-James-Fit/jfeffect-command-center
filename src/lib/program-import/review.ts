/**
 * An imported program as a builder draft (the same plan every program in the
 * app is, program-plan.ts), and what the person should look at before
 * saving it: the flags, each pointing at the week, day and exercise it's
 * about. Nothing is invented on the way: a missing number stays missing (the
 * builder won't save until it's filled), an exercise with no library match
 * waits for a pick, notes and progression in words stay words, and anything
 * that had to be cut to fit the app (over 24 weeks, 7 days, 20 exercises) is
 * said. Pure.
 */
import type { SearchableExercise } from "@/lib/exercise-search";
import {
  MAX_BLOCKS,
  linkTopSets,
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_WEEKS,
  makeKey,
  type PlanBlock,
  type PlanDay,
  type PlanExercise,
  type ProgramPlan,
} from "@/lib/program-plan";
import { groundingFlags } from "./ai";
import { nameKey, type NameMatch } from "./match";
import type { ImportedExercise, ImportedProgram, ImportFlag, ImportMethod } from "./types";

export type ImportDraft = {
  title: string;
  description: string;
  plan: ProgramPlan;
  flags: ImportFlag[];
  /** Weeks in the plan (a program that writes one week can be run for more). */
  weeks: number;
  /** The program wrote a single week (offer to run it for several). */
  oneWeek: boolean;
};

const DESC_MAX = 1000;
const NOTE_MAX = 200;

/** An exercise's notes as the plan keeps them: the group, the velocity target, then its own words (200 characters). */
export function exerciseNote(e: ImportedExercise): { text: string | null; cut: boolean } {
  const parts = [
    e.group ? (/^[a-h]\d$/i.test(e.group) ? `Superset ${e.group}` : e.group) : null,
    e.velocity ? `Target ${e.velocity}` : null,
    e.notes,
  ].filter(Boolean) as string[];
  const text = parts.join(". ").replace(/\.\./g, ".");
  if (!text) return { text: null, cut: false };
  return text.length > NOTE_MAX ? { text: `${text.slice(0, NOTE_MAX - 1).trimEnd()}…`, cut: true } : { text, cut: false };
}

/** The program's own words for the description: its notes, its progression, its weeks' and days' notes (repeats said once). */
export function importDescription(p: ImportedProgram): { text: string; cut: boolean } {
  const lines: string[] = [];
  if (p.notes) lines.push(p.notes.trim());
  if (p.progression.length) lines.push(`Progression: ${p.progression.join(" ")}`);
  const seen = new Set<string>();
  let g = 0;
  for (const b of p.blocks) {
    for (const w of b.weeks) {
      g++;
      if (w.notes && !seen.has(w.notes)) {
        seen.add(w.notes);
        lines.push(`${w.label ?? `Week ${g}`}: ${w.notes}`);
      }
      for (const d of w.days) {
        if (d.notes && !seen.has(d.notes)) {
          seen.add(d.notes);
          lines.push(`${d.title ?? "A day"}: ${d.notes}`);
        }
      }
    }
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > DESC_MAX ? { text: `${text.slice(0, DESC_MAX - 1).trimEnd()}…`, cut: true } : { text, cut: false };
}

/** A day's title as the plan keeps it (40 characters), from the file, else "Day N". */
const dayTitle = (t: string | null, i: number) => (t?.trim() ? t.trim().slice(0, 40) : `Day ${i + 1}`);

/**
 * The draft the builder opens on, and its flags. `matches` is the library
 * match per exercise name (match.ts); `source` the text the file was read
 * from (an AI read is checked against it; null for a PDF or a photo).
 */
export function toDraft<T extends SearchableExercise & { muscle_group?: string | null; equipment?: string | null }>(
  p: ImportedProgram,
  opts: { matches: Map<string, NameMatch<T>>; source: string | null; method: ImportMethod; fileName?: string | null },
): ImportDraft {
  const flags: ImportFlag[] = [];
  const blocksIn = p.blocks.filter((b) => b.weeks.length);

  // blocks: at most 8 (the rest of the weeks join the last one)
  let blocks = blocksIn;
  if (blocks.length > MAX_BLOCKS) {
    const head = blocks.slice(0, MAX_BLOCKS - 1);
    const tail = blocks.slice(MAX_BLOCKS - 1);
    blocks = [...head, { name: tail[0].name, weeks: tail.flatMap((b) => b.weeks) }];
    flags.push({ level: "info", code: "blocks_merged", text: `The app keeps up to ${MAX_BLOCKS} blocks: blocks ${MAX_BLOCKS} on were put together.` });
  }

  const totalIn = blocks.reduce((n, b) => n + b.weeks.length, 0);
  if (totalIn > MAX_WEEKS) {
    flags.push({ level: "check", code: "weeks_cut", text: `Your program has ${totalIn} weeks; the app runs up to ${MAX_WEEKS}. Weeks ${MAX_WEEKS + 1} to ${totalIn} weren't brought in. Import them as a second program.` });
  }

  // a note about an exercise is made once however many weeks repeat it ("… (in 8 places)")
  const repeated = new Map<string, { flag: ImportFlag; base: string; n: number }>();
  const once = (level: ImportFlag["level"], code: string, key: string, base: string, where: string, at: ImportFlag["at"]) => {
    const k = `${code}|${key}|${base}`;
    const hit = repeated.get(k);
    if (hit) {
      hit.n++;
      hit.flag.text = `${hit.base} (in ${hit.n} places)`;
      return;
    }
    const flag: ImportFlag = { level, code, text: `${base} (${where})`, at };
    repeated.set(k, { flag, base, n: 1 });
    flags.push(flag);
  };

  const out: PlanBlock[] = [];
  let g = 0;
  for (const [bi, b] of blocks.entries()) {
    const weeks: PlanBlock["weeks"] = [];
    // the same day and the same exercise share a key in every week of a block, so the
    // builder's "all weeks" edits reach them all (program-plan.ts finds them by key)
    const dayKeys = new Map<number, string>();
    const exKeys = new Map<string, string>();
    for (const w of b.weeks) {
      if (g >= MAX_WEEKS) break;
      const wi = weeks.length;
      g++;
      if (w.deload) flags.push({ level: "info", code: "deload", text: `${w.label ?? `Week ${g}`} is a deload week${w.notes ? `: ${w.notes}` : ""}.`, at: { b: out.length, w: wi, d: 0 } });
      if (w.days.length > MAX_DAYS)
        flags.push({ level: "check", code: "days_cut", text: `Week ${g} has ${w.days.length} days; the app keeps ${MAX_DAYS} a week. The last ${w.days.length - MAX_DAYS} weren't brought in.`, at: { b: out.length, w: wi, d: 0 } });
      const days: PlanDay[] = [];
      for (const [di, d] of w.days.slice(0, MAX_DAYS).entries()) {
        const at = (e?: number) => ({ b: out.length, w: wi, d: di, ...(e != null ? { e } : {}) });
        const seen = new Map<string, number>();
        const keyFor = (name: string) => {
          const n = (seen.get(nameKey(name)) ?? 0) + 1;
          seen.set(nameKey(name), n);
          const k = `${di}:${nameKey(name)}:${n}`;
          if (!exKeys.has(k)) exKeys.set(k, makeKey());
          return exKeys.get(k)!;
        };
        if (d.exercises.length > MAX_EXERCISES)
          flags.push({ level: "check", code: "exercises_cut", text: `${dayTitle(d.title, di)} (week ${g}) has ${d.exercises.length} exercises; the app keeps ${MAX_EXERCISES} a day. The rest weren't brought in.`, at: at() });
        const exercises: PlanExercise[] = d.exercises.slice(0, MAX_EXERCISES).map((e, ei) => {
          const m = opts.matches.get(nameKey(e.name));
          const lib = m?.exercise ?? null;
          const where = `${dayTitle(d.title, di)}${totalIn > 1 ? `, week ${g}` : ""}`;
          const nk = nameKey(e.name);
          if (!lib) once("fix", "unmatched", nk, `Pick the library exercise for "${e.name}"`, where, at(ei));
          else if (m?.status === "close") once("check", "close_match", nk, `"${e.name}" was matched to ${lib.name}`, where, at(ei));
          if (e.sets == null) once("fix", "no_sets", nk, `${e.name}: the file doesn't say how many sets`, where, at(ei));
          else if (e.sets > 20) once("fix", "too_many_sets", nk, `${e.name}: ${e.sets} sets; the app takes up to 20`, where, at(ei));
          if (!e.reps) once("fix", "no_reps", nk, `${e.name}: the file doesn't say how many reps`, where, at(ei));
          if (e.load != null && !e.unit) once("check", "no_unit", nk, `${e.name}: ${e.load} has no unit in the file; it's set to ${p.unit ?? "lb"}`, where, at(ei));
          if (e.unsure) once("check", "unsure", nk, `${e.name}: ${e.unsure}`, where, at(ei));
          if (opts.method === "ai") for (const t of groundingFlags(e, opts.source)) once("check", "not_in_file", nk, `${e.name}: ${t}`, where, at(ei));
          const note = exerciseNote(e);
          if (note.cut) once("info", "note_cut", nk, `${e.name}: its note was shortened to fit`, where, at(ei));
          return {
            key: keyFor(e.name),
            exercise_id: lib?.id ?? "",
            name: lib?.name ?? e.name,
            muscle_group: lib?.muscle_group ?? null,
            equipment: lib?.equipment ?? null,
            sets: e.sets != null && e.sets <= 20 ? e.sets : 0,
            reps: e.reps ?? "",
            rpe: e.rpe,
            rir: e.rpe ? null : e.rir,
            load: e.pct != null ? null : e.load,
            unit: e.pct != null || e.load == null ? null : (e.unit ?? p.unit ?? "lb"),
            pct: e.pct,
            pct_of: e.pct != null ? e.pct_of ?? "1rm" : null,
            rest_seconds: e.rest_seconds,
            tempo: e.tempo,
            notes: note.text,
            // the file's own name, when the library's differs (shown while reviewing)
            source_name: lib && nameKey(lib.name) !== nameKey(e.name) ? e.name : !lib ? e.name : null,
          } as PlanExercise;
        });
        if (!dayKeys.has(di)) dayKeys.set(di, makeKey());
        days.push({ key: dayKeys.get(di)!, title: dayTitle(d.title, di), focus: null, exercises });
      }
      if (days.length) weeks.push({ key: makeKey(), days });
    }
    if (weeks.length) out.push({ key: makeKey(), name: (b.name ?? `Block ${bi + 1}`).slice(0, 40), weeks });
  }

  for (const i of p.issues) flags.push({ level: "check", code: "issue", text: i.where ? `${i.where}: ${i.text}` : i.text });
  if (p.progression.length)
    flags.push({ level: "check", code: "progression", text: `Your program says how to progress: "${p.progression.join(" ").slice(0, 240)}". It's kept in the program's notes; the numbers weren't changed. Use Progress across weeks on an exercise to write it in.` });
  const desc = importDescription(p);
  if (desc.cut) flags.push({ level: "info", code: "description_cut", text: "The program's notes were shortened to fit (1,000 characters)." });
  if (opts.method === "ai" && !opts.source)
    flags.push({ level: "check", code: "read_from_image", text: "This was read from a PDF or a photo: check the numbers against it before you save." });

  const weeksTotal = out.reduce((n, b) => n + b.weeks.length, 0);
  const title = (p.title ?? opts.fileName?.replace(/\.[^.]+$/, "") ?? "Imported program").trim().slice(0, 80);
  return {
    title: title.length >= 2 ? title : "Imported program",
    description: desc.text,
    // a top set and its back-offs read as one exercise (set groups), as the builder makes them
    plan: linkTopSets({ v: 1, blocks: out.length ? out : [] }),
    flags: sortFlags(flags),
    weeks: weeksTotal,
    oneWeek: weeksTotal === 1,
  };
}

const LEVEL: Record<ImportFlag["level"], number> = { fix: 0, check: 1, info: 2 };
export function sortFlags(f: ImportFlag[]): ImportFlag[] {
  return [...f].sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}

/** Every distinct exercise name in a program (what gets matched). */
export function importNames(p: ImportedProgram): string[] {
  const seen = new Map<string, string>();
  for (const b of p.blocks) for (const w of b.weeks) for (const d of w.days) for (const e of d.exercises) {
    const k = nameKey(e.name);
    if (k && !seen.has(k)) seen.set(k, e.name);
  }
  return [...seen.values()];
}

/** How many exercises / weeks / days a week the program has, for the review's header. */
export function importSummary(p: ImportedProgram) {
  const weeks = p.blocks.reduce((n, b) => n + b.weeks.length, 0);
  const days = Math.max(0, ...p.blocks.flatMap((b) => b.weeks.map((w) => w.days.length)));
  const exercises = p.blocks.reduce((n, b) => n + b.weeks.reduce((m, w) => m + w.days.reduce((k, d) => k + d.exercises.length, 0), 0), 0);
  return { weeks, days, exercises };
}

/**
 * The person picked the library exercise for a name the file used: every
 * exercise with that name, in every week and day, becomes it (prescriptions
 * kept). Returns a new plan.
 */
export function resolveName(
  plan: ProgramPlan,
  sourceName: string,
  ex: { id: string; name: string; muscle_group?: string | null; equipment?: string | null },
): ProgramPlan {
  const k = nameKey(sourceName);
  return {
    ...plan,
    blocks: plan.blocks.map((b) => ({
      ...b,
      weeks: b.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => ({
          ...d,
          exercises: d.exercises.map((e) =>
            nameKey(e.source_name ?? e.name ?? "") === k
              ? { ...e, exercise_id: ex.id, name: ex.name, muscle_group: ex.muscle_group ?? null, equipment: ex.equipment ?? null, source_name: sourceName }
              : e,
          ),
        })),
      })),
    })),
  };
}

/** The file's names still waiting for a library pick, with how many exercises each covers. */
export function unmatchedNames(plan: ProgramPlan): Array<{ name: string; count: number; at: FlagAtPlan }> {
  const out = new Map<string, { name: string; count: number; at: FlagAtPlan }>();
  plan.blocks.forEach((b, bi) =>
    b.weeks.forEach((w, wi) =>
      w.days.forEach((d, di) =>
        d.exercises.forEach((e, ei) => {
          if (e.exercise_id) return;
          const name = e.source_name ?? e.name ?? "Exercise";
          const k = nameKey(name);
          const hit = out.get(k);
          if (hit) hit.count++;
          else out.set(k, { name, count: 1, at: { b: bi, w: wi, d: di, e: ei } });
        }),
      ),
    ),
  );
  return [...out.values()];
}
type FlagAtPlan = { b: number; w: number; d: number; e?: number };

/** Run a one-week program for `n` weeks: the week copied (keys shared, so edits reach every week). */
export function repeatWeeks(plan: ProgramPlan, n: number): ProgramPlan {
  const first = plan.blocks[0]?.weeks[0];
  if (!first) return plan;
  const count = Math.max(1, Math.min(MAX_WEEKS, Math.round(n)));
  const copy = () => ({ key: makeKey(), days: first.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })) });
  return { ...plan, blocks: [{ ...plan.blocks[0], weeks: [first, ...Array.from({ length: count - 1 }, copy)] }] };
}
