/**
 * A generated block read week by week: each exercise's prescription for a
 * given week (its base with that week's changes), and the notes the athlete
 * reads (cue, progression rule, swap options). Shared by the audit, the
 * draft's preview and the rows written to the program. Pure.
 */
import type { BuiltBlock, BuiltExercise } from "./generator-schemas";
import { supersetGroup } from "./session-time";
import { withoutFixedLoads } from "./loading";
import { cleanGeneratedNote } from "@/lib/workouts/coach-notes";

export type WeekRx = { sets: number; reps: string; rpe: string | null; rir: string | null; percentage: number | null; percentage_of?: "training_max" | "e1rm" | "1rm" | "top_set" | null; notes: string | null };

export function rxForWeek(ex: BuiltExercise, week: number): WeekRx {
  const o = (ex.weeks ?? []).find((w) => w.week === week) ?? ({} as Partial<WeekRx>);
  const pick = <T,>(a: T | null | undefined, b: T | null | undefined): T | null => (a ?? b ?? null) as T | null;
  return {
    sets: (o.sets ?? ex.sets) as number,
    reps: (o.reps ?? ex.reps) as string,
    rpe: pick(o.rpe, ex.rpe),
    rir: pick(o.rir, ex.rir),
    percentage: pick(o.percentage, ex.percentage),
    percentage_of: pick(o.percentage_of, ex.percentage_of),
    notes: pick(o.notes, ex.notes),
  };
}

/**
 * A block's week references in its own weeks (1 … weeks). A model building block 2 of a 6 + 6 program
 * sometimes counts on from the program's first week (its phases and changes as weeks 7–12), which the
 * draft would then drop (no week 7 in a 6-week block), leaving every week the base prescription. When
 * every reference past the block sits inside the block's place in the program (offset + 1 … offset +
 * weeks) and none is in its own range, they're moved back by the offset; anything else is left as written
 * for the audit to name. Returns the block (a copy when moved) and how far it moved.
 */
export function withLocalWeeks<B extends Pick<BuiltBlock, "weeks" | "week_phases" | "days">>(block: B, offset: number): { block: B; shifted: number } {
  const refs = [...(block.week_phases ?? []).map((p) => p.week), ...block.days.flatMap((d) => d.exercises.flatMap((e) => (e.weeks ?? []).map((w) => w.week)))];
  const own = (w: number) => w >= 1 && w <= block.weeks;
  if (!offset || !refs.length || refs.every(own)) return { block, shifted: 0 };
  if (!refs.every((w) => w > offset && w <= offset + block.weeks)) return { block, shifted: 0 };
  const shift = <T extends { week: number }>(xs: T[] | undefined | null) => (xs ?? []).map((x) => ({ ...x, week: x.week - offset }));
  return {
    block: {
      ...block,
      week_phases: shift(block.week_phases),
      days: block.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => (e.weeks?.length ? { ...e, weeks: shift(e.weeks) } : e)) })),
    } as B,
    shifted: offset,
  };
}

/** Every block of a program in its own weeks (`withLocalWeeks`, each block's offset the weeks before it). */
export function programInLocalWeeks<P extends { blocks: Array<Pick<BuiltBlock, "weeks" | "week_phases" | "days">> }>(program: P): { program: P; moved: number[] } {
  let offset = 0;
  const moved: number[] = [];
  const blocks = program.blocks.map((b, i) => {
    const r = withLocalWeeks(b, offset);
    offset += b.weeks;
    if (r.shifted) moved.push(i);
    return r.block;
  });
  return { program: moved.length ? { ...program, blocks } : program, moved };
}

/** "Superset with …" for an exercise paired with others in its day (same letter: "A1" with "A2"), else null. */
export function supersetNote(ex: BuiltExercise, day: readonly BuiltExercise[] | null | undefined): string | null {
  const g = supersetGroup(ex.superset);
  if (!g || !day) return null;
  const partners = day.filter((o) => o !== ex && supersetGroup(o.superset) === g).map((o) => o.exercise_name);
  return partners.length ? `Superset with ${partners.join(" and ")}: one set of each, then rest.` : null;
}

/** What the athlete reads under an exercise: its superset partner, the week's note, the progression rule and swap options (never a fixed weight: withoutFixedLoads). */
export function athleteNotes(ex: BuiltExercise, week: number, day?: readonly BuiltExercise[] | null): string | null {
  const rx = rxForWeek(ex, week);
  const progression = withoutFixedLoads(ex.progression);
  const parts = [supersetNote(ex, day), withoutFixedLoads(rx.notes), progression ? `Progress: ${progression}` : null, ex.substitutions?.length ? `Swap if needed: ${ex.substitutions.map((s) => s.exercise_name).join(" or ")}` : null].filter(Boolean) as string[];
  // Only what the athlete can use today: no method-only progression line, no
  // "Week 1: …" carried onto week 3, no reasoning meant for the coach (coach-notes.ts).
  const text = cleanGeneratedNote(parts.join(" · "), week);
  return text ? text.slice(0, 900) : null;
}

export function fmtRx(rx: WeekRx): string {
  return `${rx.sets}×${rx.reps}${rx.rpe ? ` @${rx.rpe}` : rx.rir ? ` ${rx.rir} RIR` : ""}${rx.percentage != null ? ` ${rx.percentage}%` : ""}`;
}

export function blockWeeks(b: BuiltBlock): number[] {
  return Array.from({ length: b.weeks }, (_, i) => i + 1);
}
