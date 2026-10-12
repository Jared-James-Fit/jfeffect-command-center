import {
  DAY_FACTOR_TRUST_FAMILY,
  DAY_FACTOR_TRUST_SAME,
  dayFactorFrom,
  todayVsUsual,
  type SetSample,
} from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

/**
 * "How is today going?" per exercise card, from every card's logged sets, so
 * suggestions adapt across the workout as sets are logged (load-suggestion.ts,
 * header note 9). Pure: the workout passes each card's history and sets.
 */
export type DayReadRow = {
  rowId: string;
  name: string;
  /** Same key = same exercise (a top set and its back-offs). */
  exerciseKey: string;
  /** Squat / bench / deadlift family, for a variation after the main lift. */
  family: string | null;
  history: PreviousLiftLog[] | null;
  /** This card's completed sets today, in kg, in set order, with when each was done. */
  sets: Array<SetSample & { at: number }>;
};

export type DayRead = {
  /** Applied to this card's suggestion before its own first set (null = as usual). */
  factor: number | null;
  /** The card it comes from, for the "why". */
  fromName: string | null;
  /** This card's own logged sets vs its usual (1.03 = 3% better). */
  own: number | null;
  /** Earlier sets of this exercise on other cards (kg), for a lift with no history of its own. */
  carryKg: SetSample[];
};

export function computeDayReads(rows: DayReadRow[], bodyweightKg?: number | null, now?: Date): Map<string, DayRead> {
  const own = new Map<string, { ratio: number; lastAt: number }>();
  for (const r of rows) {
    if (!r.sets.length || !r.history?.length) continue;
    const ratio = todayVsUsual({ history: r.history, sets: r.sets, unit: "kg", bodyweightKg, now });
    if (ratio != null) own.set(r.rowId, { ratio, lastAt: Math.max(...r.sets.map((s) => s.at)) });
  }
  const latest = (candidates: DayReadRow[]) =>
    candidates
      .filter((o) => own.has(o.rowId))
      .sort((a, b) => own.get(b.rowId)!.lastAt - own.get(a.rowId)!.lastAt)[0] ?? null;

  const out = new Map<string, DayRead>();
  for (const r of rows) {
    const others = rows.filter((o) => o.rowId !== r.rowId);
    const same = latest(others.filter((o) => o.exerciseKey === r.exerciseKey));
    const kin = same ? null : r.family ? latest(others.filter((o) => o.family === r.family)) : null;
    const src = same ?? kin;
    const factor = src ? dayFactorFrom(own.get(src.rowId)!.ratio, same ? DAY_FACTOR_TRUST_SAME : DAY_FACTOR_TRUST_FAMILY) : null;
    const carryKg = others
      .filter((o) => o.exerciseKey === r.exerciseKey)
      .flatMap((o) => o.sets)
      .sort((a, b) => a.at - b.at)
      .map(({ load, reps, rpe }) => ({ load, reps, rpe }));
    out.set(r.rowId, {
      factor,
      fromName: factor != null && src ? src.name : null,
      own: own.get(r.rowId)?.ratio ?? null,
      carryKg,
    });
  }
  return out;
}
