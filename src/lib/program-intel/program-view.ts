/**
 * A generated block read week by week: each exercise's prescription for a
 * given week (its base with that week's changes), and the notes the athlete
 * reads (cue, progression rule, swap options). Shared by the audit, the
 * draft's preview and the rows written to the program. Pure.
 */
import type { BuiltBlock, BuiltExercise } from "./generator-schemas";
import { supersetGroup } from "./session-time";

export type WeekRx = { sets: number; reps: string; rpe: string | null; rir: string | null; percentage: number | null; notes: string | null };

export function rxForWeek(ex: BuiltExercise, week: number): WeekRx {
  const o = (ex.weeks ?? []).find((w) => w.week === week) ?? ({} as Partial<WeekRx>);
  const pick = <T,>(a: T | null | undefined, b: T | null | undefined): T | null => (a ?? b ?? null) as T | null;
  return {
    sets: (o.sets ?? ex.sets) as number,
    reps: (o.reps ?? ex.reps) as string,
    rpe: pick(o.rpe, ex.rpe),
    rir: pick(o.rir, ex.rir),
    percentage: pick(o.percentage, ex.percentage),
    notes: pick(o.notes, ex.notes),
  };
}

/** "Superset with …" for an exercise paired with others in its day (same letter: "A1" with "A2"), else null. */
export function supersetNote(ex: BuiltExercise, day: readonly BuiltExercise[] | null | undefined): string | null {
  const g = supersetGroup(ex.superset);
  if (!g || !day) return null;
  const partners = day.filter((o) => o !== ex && supersetGroup(o.superset) === g).map((o) => o.exercise_name);
  return partners.length ? `Superset with ${partners.join(" and ")}: one set of each, then rest.` : null;
}

/** What the athlete reads under an exercise: its superset partner, the week's note, the progression rule and swap options. */
export function athleteNotes(ex: BuiltExercise, week: number, day?: readonly BuiltExercise[] | null): string | null {
  const rx = rxForWeek(ex, week);
  const parts = [supersetNote(ex, day), rx.notes, ex.progression ? `Progress: ${ex.progression}` : null, ex.substitutions?.length ? `Swap if needed: ${ex.substitutions.map((s) => s.exercise_name).join(" or ")}` : null].filter(Boolean) as string[];
  const text = parts.join(" · ").trim();
  return text ? text.slice(0, 900) : null;
}

export function fmtRx(rx: WeekRx): string {
  return `${rx.sets}×${rx.reps}${rx.rpe ? ` @${rx.rpe}` : rx.rir ? ` ${rx.rir} RIR` : ""}${rx.percentage != null ? ` ${rx.percentage}%` : ""}`;
}

export function blockWeeks(b: BuiltBlock): number[] {
  return Array.from({ length: b.weeks }, (_, i) => i + 1);
}
