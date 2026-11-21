/**
 * A Crew workout post's recap, the last swipe of the post (Nov 20 2026,
 * compact Nov 21 2026): what the workout was, its key lifts with their best
 * sets and real PRs, read from the post's own stats (in the feed already) and
 * its exercises (community_post, loaded once the recap is near); every set
 * lives in the post's sheet (Workout | Comments). Pure, tested.
 */
import {
  SCOPE_WORD,
  formatWorkoutDuration,
  headlinePr,
  type CommunityExercise,
  type RecordScope,
  type WorkoutSetEntry,
  type WorkoutShareStats,
} from "@/lib/community";
import {
  dualTotal,
  kgIn,
  otherUnit,
  recordedLoad,
  recordedUnit,
  weightNumber,
  type WeightUnit,
} from "@/lib/dual-weight";
import { formatClockSeconds } from "@/lib/duration";

export type SummaryStat = { label: string; value: string; sub?: string; pr?: boolean };

/**
 * A workout's numbers, once each: Time · Working sets · Volume · PRs. The
 * volume in the unit most of its weights were typed in, the other unit as
 * `sub` (the same for every viewer); the PR count marked so it reads amber.
 */
export function summaryStats(s: WorkoutShareStats, unit: "kg" | "lb"): SummaryStat[] {
  const out: SummaryStat[] = [];
  const dur = formatWorkoutDuration(s.duration_min);
  if (dur) out.push({ label: "Time", value: dur });
  if (s.working_sets > 0)
    out.push({
      label: s.working_sets === 1 ? "Working set" : "Working sets",
      value: String(s.working_sets),
    });
  if (s.tonnage_kg > 0) {
    const t = dualTotal(s.tonnage_kg, recordedUnit(s.unit, unit));
    out.push({ label: "Volume", value: t.primary, sub: t.secondary });
  }
  if (s.pr_count > 0)
    out.push({ label: s.pr_count === 1 ? "PR" : "PRs", value: String(s.pr_count), pr: true });
  return out;
}

/** "Thu, Nov 19": the day it was trained. */
export function recapDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** A post's slide index that is its recap: right after its own photos and clips. */
export function recapIndex(slideCount: number): number {
  return Math.max(0, slideCount);
}

/** The exercises worth a row: anything with a set, in the order they were trained. */
export function recapExercises(list: CommunityExercise[] | null | undefined): CommunityExercise[] {
  return (list ?? []).filter(
    (e) =>
      (e.sets ?? 0) > 0 ||
      (e.best_reps ?? 0) > 0 ||
      (e.max_reps ?? 0) > 0 ||
      (e.max_seconds ?? 0) > 0,
  );
}

/**
 * The recap's line under the workout's name: "2h 13m · 10 sets". The day is the post's own line (its author line
 * says "Nov 16"), so it isn't said twice.
 */
export function recapMeta(s: Pick<WorkoutShareStats, "duration_min" | "working_sets">): string {
  const parts = [
    formatWorkoutDuration(s.duration_min),
    s.working_sets > 0 ? `${s.working_sets} ${s.working_sets === 1 ? "set" : "sets"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * A best set split for the slide's type: the load as the big number and the reps after it, smaller ("455 lb" ·
 * "× 1"); a set with no load is one piece ("12 reps", "1:15").
 */
export function splitBestSet(text: string): { big: string; small: string | null } {
  const m = /^(.*\S)\s(×\s?\d+)$/.exec(text.trim());
  if (!m || /^\d+ reps?$/.test(text.trim())) return { big: text.trim(), small: null };
  return { big: m[1], small: m[2] };
}

/** At most this many lifts on the recap: it's a glance, every set is one tap away. */
export const RECAP_MAX_LIFTS = 4;

const SCOPE_RANK: Record<RecordScope, number> = { atpr: 3, program_pr: 2, block_pr: 1 };
const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The lifts the recap shows, at most `max`, in the order they were trained:
 * the workout's headline PR first to make the cut (headlinePr), then any
 * other record, then the rest in training order (a session's first lifts are
 * its main ones). Each with its index in the workout.
 */
export function recapKeyLifts(
  list: CommunityExercise[],
  s: Pick<WorkoutShareStats, "prs" | "top_lift"> | null | undefined,
  max = RECAP_MAX_LIFTS,
): { exercise: CommunityExercise; index: number }[] {
  const head = headlinePr(s);
  const rank = (e: CommunityExercise) =>
    head && same(e.name, head.exercise_name) && e.pr ? 10 : e.pr ? SCOPE_RANK[e.pr] : 0;
  const picked = list
    .map((exercise, index) => ({ exercise, index }))
    .sort((a, b) => rank(b.exercise) - rank(a.exercise) || a.index - b.index)
    .slice(0, Math.max(0, max));
  return picked.sort((a, b) => a.index - b.index);
}

/**
 * An exercise's record as the recap says it: the workout's headline PR loud
 * (amber, the trophy), any other record quiet (it's real, it just doesn't
 * headline: an accessory's rep best, a block best). Null with no record.
 */
export function recapPr(
  e: CommunityExercise,
  s: Pick<WorkoutShareStats, "prs" | "top_lift"> | null | undefined,
): { label: string; loud: boolean } | null {
  if (!e.pr) return null;
  const head = headlinePr(s);
  return { label: SCOPE_WORD[e.pr], loud: !!head && same(e.name, head.exercise_name) };
}

/** The recap's way to every set (the post's sheet): "All 9 exercises" when some aren't on it, else "Every set". */
export function recapMoreLabel(total: number, shown: number): string {
  return total > shown ? `All ${total} exercises` : "Every set";
}

/** The sheet's line over the exercises: "6 exercises · 17,902 lb lifted" with the other unit apart. */
export function workoutTotals(
  s: Pick<WorkoutShareStats, "tonnage_kg" | "unit">,
  exercises: number,
  unit: WeightUnit,
): { text: string; other: string | null } {
  const head = `${exercises} ${exercises === 1 ? "exercise" : "exercises"}`;
  if (!(s.tonnage_kg > 0)) return { text: head, other: null };
  const t = dualTotal(s.tonnage_kg, recordedUnit(s.unit, unit));
  return { text: `${head} · ${t.primary} lifted`, other: t.secondary };
}

/**
 * One set's load as it was logged: "455 lb", "BW + 25 lb", "−20 kg" (assisted); the number as typed in its own
 * unit, the other unit from the kg mirror (dual-weight's rule). Null with none (reps, a hold, a hidden weight).
 */
export function setLoad(
  set: WorkoutSetEntry,
  unit: WeightUnit,
): { main: string; other: string | null } | null {
  const kg = typeof set.kg === "number" && set.kg > 0 ? set.kg : null;
  const typed = typeof set.v === "number" && set.v > 0 ? set.v : null;
  const known = set.u === "kg" || set.u === "lb";
  let main: string | null = null;
  let other: string | null = null;
  if (typed != null && known) {
    const u = set.u as WeightUnit;
    main = `${weightNumber(typed, 2)} ${u}`;
    const asKg = kg ?? (u === "kg" ? typed : typed / 2.2046226218);
    other = `${weightNumber(kgIn(asKg, otherUnit(u)), 1)} ${otherUnit(u)}`;
  } else if (kg != null) {
    const d = recordedLoad(kg, set.u, unit);
    main = d.primary;
    other = d.secondary;
  }
  if (set.lt === "bodyweight") return main ? { main: `BW + ${main}`, other } : null;
  if (set.lt === "assisted")
    return main ? { main: `−${main}`, other: other ? `−${other}` : null } : null;
  return main ? { main, other } : null;
}

/** One set as a line: "455 lb × 1", "BW × 12", "10:00", "20 kg · 0:45". Its RPE apart. */
export function setText(
  set: WorkoutSetEntry,
  unit: WeightUnit,
): { main: string; other: string | null; rpe: string | null } {
  const load = setLoad(set, unit);
  const reps = typeof set.reps === "number" && set.reps > 0 ? set.reps : null;
  const secs = typeof set.secs === "number" && set.secs > 0 ? set.secs : null;
  const rpe = typeof set.rpe === "number" && set.rpe > 0 ? `@ ${weightNumber(set.rpe, 1)}` : null;
  let main: string;
  if (reps != null) {
    const what = load?.main ?? (set.lt === "bodyweight" ? "BW" : null);
    main = what ? `${what} × ${reps}` : `${reps} ${reps === 1 ? "rep" : "reps"}`;
  } else if (secs != null) {
    main = load ? `${load.main} · ${formatClockSeconds(secs)}` : formatClockSeconds(secs);
  } else {
    main = load?.main ?? "Logged";
  }
  return { main, other: load?.other ?? null, rpe };
}

export type SetRow = {
  label: string;
  count: number;
  main: string;
  other: string | null;
  rpe: string | null;
};

/**
 * An exercise's sets as rows, identical sets in a row said once with their
 * numbers ("2–4 · 375 lb × 4 @ 6"), so a 5 × 5 is one line and a top set and
 * its back-offs read apart. Empty when the read has no sets (an older read).
 */
export function exerciseSetRows(e: CommunityExercise, unit: WeightUnit): SetRow[] {
  const out: SetRow[] = [];
  let n = 0;
  for (const set of e.set_list ?? []) {
    n += 1;
    const t = setText(set, unit);
    const last = out[out.length - 1];
    if (last && last.main === t.main && last.rpe === t.rpe && last.other === t.other) {
      last.count += 1;
      last.label = `${n - last.count + 1}–${n}`;
      continue;
    }
    out.push({ label: String(n), count: 1, ...t });
  }
  return out;
}
