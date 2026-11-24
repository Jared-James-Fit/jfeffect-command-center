import { flatWeeks, sameWeek, type ProgramPlan } from "@/lib/program-plan";
import { nameKey } from "./match";
import type { ImportFlag } from "./types";

/**
 * An import's review in three groups (Nov 24 2026), worked out from the plan
 * as it is now (so a fix moves its item at once) and the read's own notes:
 *
 *   needs    what to fix or look at before saving: names not matched to the
 *            library (blocking), exercises missing sets or reps (blocking),
 *            and checks worth a look (a number not in the file, a load with no
 *            unit, weeks the app couldn't hold). The same problem across weeks
 *            is one item with its weeks.
 *   ready    what came in as written, said plainly, so a good import reads
 *            as good.
 *   optional what could be better but doesn't have to be: names matched under
 *            another library name (to confirm), a one-week program to run
 *            longer, notes about the read.
 */

export type At = { b: number; w: number; d: number; e?: number };

export type NeedItem =
  | { kind: "unmatched"; id: string; name: string; count: number; at: At }
  | {
      kind: "numbers";
      id: string;
      name: string;
      what: "sets" | "reps" | "sets and reps";
      weeks: number[];
      day: string;
      at: At;
    }
  | { kind: "check"; id: string; text: string; at?: At };

export type OptionalItem =
  | { kind: "matched_as"; id: string; fileName: string; libraryName: string; count: number }
  | { kind: "one_week"; id: string }
  | { kind: "note"; id: string; text: string; at?: At };

export type ReviewGroups = {
  summary: {
    weeks: number;
    daysPerWeek: number;
    blocks: number;
    exercises: number;
    names: number;
    matched: number;
  };
  needs: NeedItem[];
  ready: string[];
  optional: OptionalItem[];
  /** Items that stop Save (unmatched names, missing numbers). */
  blocking: number;
};

/** Codes the plan itself answers live (never listed from the read). */
const LIVE_CODES = new Set(["unmatched", "no_sets", "no_reps", "too_many_sets", "close_match"]);
/** Notes about the read that are worth a look before saving. */
const CHECK_CODES = new Set([
  "not_in_file",
  "read_from_image",
  "weeks_cut",
  "days_cut",
  "exercises_cut",
  "unsure",
  "no_unit",
  "issue",
]);

/** "weeks 1–8" from program week numbers. */
export function weekRun(numbers: number[]): string {
  const g = [...new Set(numbers)].sort((a, b) => a - b);
  if (!g.length) return "";
  if (g.length === 1) return `week ${g[0]}`;
  const runs: string[] = [];
  let lo = g[0];
  let prev = g[0];
  for (const n of [...g.slice(1), Infinity]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(lo === prev ? String(lo) : `${lo}–${prev}`);
    lo = prev = n;
  }
  return `weeks ${runs.join(", ")}`;
}

export function reviewGroups(
  plan: ProgramPlan,
  flags: ImportFlag[],
  opts: { oneWeek?: boolean; dismissed?: ReadonlySet<string> } = {},
): ReviewGroups {
  const weeks = flatWeeks(plan);
  const daysPerWeek = Math.max(0, ...weeks.map((w) => w.week.days.length));
  const exerciseIds = new Set<string>();
  const unmatched = new Map<string, { name: string; count: number; at: At }>();
  const matchedAs = new Map<string, { fileName: string; libraryName: string; count: number }>();
  const missing = new Map<
    string,
    { name: string; what: "sets" | "reps" | "sets and reps"; weeks: number[]; day: string; at: At }
  >();
  const names = new Set<string>();
  let entries = 0;
  let notes = 0;
  let rests = 0;
  let groups = 0;

  for (const { b, w, g, week } of weeks) {
    week.days.forEach((d, di) =>
      d.exercises.forEach((e, ei) => {
        entries++;
        const fileName = e.source_name ?? e.name ?? "Exercise";
        names.add(nameKey(fileName));
        if (e.notes) notes++;
        if (e.rest_seconds) rests++;
        if (e.group && e.role === "top") groups++;
        const at = { b, w, d: di, e: ei };
        if (!e.exercise_id) {
          const k = nameKey(fileName);
          const hit = unmatched.get(k);
          if (hit) hit.count++;
          else unmatched.set(k, { name: fileName, count: 1, at });
          return;
        }
        exerciseIds.add(e.exercise_id);
        if (e.source_name && e.name && nameKey(e.source_name) !== nameKey(e.name)) {
          const k = `${nameKey(e.source_name)}>${e.exercise_id}`;
          const hit = matchedAs.get(k);
          if (hit) hit.count++;
          else matchedAs.set(k, { fileName: e.source_name, libraryName: e.name, count: 1 });
        }
        const noSets = !(Number(e.sets) >= 1 && Number(e.sets) <= 20);
        const noReps = !String(e.reps ?? "").trim();
        if (noSets || noReps) {
          const what = noSets && noReps ? "sets and reps" : noSets ? "sets" : "reps";
          const k = `${e.exercise_id}|${d.key}|${what}`;
          const hit = missing.get(k);
          if (hit) hit.weeks.push(g);
          else missing.set(k, { name: e.name ?? fileName, what, weeks: [g], day: d.title, at });
        }
      }),
    );
  }

  const dismissed = opts.dismissed ?? new Set<string>();
  const needs: NeedItem[] = [];
  for (const [k, u] of unmatched) needs.push({ kind: "unmatched", id: `u:${k}`, ...u });
  for (const [k, m] of missing) needs.push({ kind: "numbers", id: `n:${k}`, ...m });
  const blocking = needs.length;

  const optional: OptionalItem[] = [];
  for (const [k, m] of matchedAs) optional.push({ kind: "matched_as", id: `m:${k}`, ...m });
  if (opts.oneWeek && weeks.length === 1) optional.push({ kind: "one_week", id: "one_week" });

  flags.forEach((f, i) => {
    if (LIVE_CODES.has(f.code)) return;
    const id = `f:${f.code}:${i}`;
    if (dismissed.has(id)) return;
    if (f.level !== "info" && CHECK_CODES.has(f.code))
      needs.push({ kind: "check", id, text: f.text, at: f.at });
    else optional.push({ kind: "note", id, text: f.text, at: f.at });
  });

  const matched = names.size - unmatched.size;
  const ready: string[] = [];
  if (names.size) {
    ready.push(
      unmatched.size
        ? `${matched} of ${names.size} exercise names matched to the library`
        : `All ${names.size} exercise names matched to the library`,
    );
  }
  if (!missing.size && entries) ready.push("Sets and reps on every exercise");
  if (weeks.length > 1) {
    const differ = weeks.some((x) => !sameWeek(x.week, weeks[0].week));
    ready.push(
      differ ? `${weeks.length} weeks, each with its own numbers` : `${weeks.length} weeks`,
    );
  }
  if (plan.blocks.length > 1) ready.push(`${plan.blocks.length} blocks kept as written`);
  if (groups) ready.push(`${groups === 1 ? "A top set" : "Top sets"} and back-offs kept together`);
  if (rests || notes)
    ready.push(
      [rests ? "rest times" : null, notes ? "notes" : null]
        .filter(Boolean)
        .join(" and ")
        .replace(/^./, (c) => c.toUpperCase()) + " kept",
    );

  return {
    summary: {
      weeks: weeks.length,
      daysPerWeek,
      blocks: plan.blocks.length,
      exercises: exerciseIds.size,
      names: names.size,
      matched,
    },
    needs,
    ready,
    optional,
    blocking,
  };
}
