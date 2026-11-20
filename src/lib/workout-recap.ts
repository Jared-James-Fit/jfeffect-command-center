/**
 * A Crew workout post's recap, the last swipe of the post (Nov 20 2026): the
 * workout's numbers once each, what it earned, and its exercises with their
 * best sets, read from the post's own stats (in the feed already) and its
 * exercises (community_post, loaded once the recap is near). Pure, tested.
 */
import {
  SCOPE_WORD,
  formatWorkoutDuration,
  headlinePr,
  monthWorkoutLine,
  type CommunityExercise,
  type WorkoutShareStats,
} from "@/lib/community";
import { dualTotal, recordedUnit } from "@/lib/dual-weight";

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

/** The recap's compact labels: "Sets" for "Working sets", the rest as they are. */
export function shortStatLabel(label: string): string {
  return /^working sets?$/i.test(label) ? "Sets" : label;
}

export type RecapHighlight = { kind: "pr" | "month"; text: string };

/**
 * What the workout earned, at most two short lines: the headline PR (the one
 * a workout leads with, headlinePr: "All-time PR · Competition Squat"), and
 * which workout of the month it was. Every other record is marked on its
 * exercise's row, so it isn't repeated here.
 */
export function recapHighlights(s: WorkoutShareStats): RecapHighlight[] {
  const out: RecapHighlight[] = [];
  const pr = headlinePr(s);
  if (pr) out.push({ kind: "pr", text: `${SCOPE_WORD[pr.scope]} · ${pr.exercise_name}` });
  const month = monthWorkoutLine(s);
  if (month) out.push({ kind: "month", text: month });
  return out;
}

/**
 * How many exercise rows fit the recap's list (`height` px, every row
 * `rowHeight` px) without scrolling: a vertical swipe on the post is always
 * the feed's, so the list never scrolls on its own. The rest are counted on
 * the button that opens the full workout.
 */
export function recapFit(
  height: number,
  rowHeight: number,
  total: number,
): { shown: number; hidden: number } {
  if (!(total > 0)) return { shown: 0, hidden: 0 };
  if (!(height > 0) || !(rowHeight > 0)) return { shown: total, hidden: 0 };
  const shown = Math.max(1, Math.min(total, Math.floor((height + 0.5) / rowHeight)));
  return { shown, hidden: total - shown };
}

/** The recap's way into the full workout: "All 9 exercises" when some didn't fit, else "Full workout". */
export function recapButtonLabel(total: number, hidden: number): string {
  return hidden > 0 ? `All ${total} exercises` : "Full workout";
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
