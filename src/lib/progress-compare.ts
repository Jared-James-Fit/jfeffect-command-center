/**
 * Comparing progress photos fairly: the check-in nearest to "N weeks before
 * the latest" (never a later one), and what the scale and the tape said
 * around each date (a 7-day average of weigh-ins, the waist reading within a
 * few days), so a photo is read next to the numbers, not on its own. Lighting,
 * pose and distance change how a photo looks more than a week of dieting
 * does; the numbers keep that honest. Pure, tested.
 */

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

export const COMPARE_WEEKS = [1, 2, 4, 6, 8, 12] as const;

export type Dated = { id: string; date: string };

/** The latest check-in, and the one nearest `weeks` before it (at or before that day when there's one within half the gap). */
export function pickComparison<T extends Dated>(subs: T[], weeks: number): { before: T; after: T } | null {
  const sorted = subs.filter((s) => s.date).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const after = sorted[sorted.length - 1];
  const want = dayNum(after.date) - weeks * 7;
  const earlier = sorted.slice(0, -1);
  let best = earlier[0];
  for (const s of earlier) if (Math.abs(dayNum(s.date) - want) < Math.abs(dayNum(best.date) - want)) best = s;
  return { before: best, after };
}

/**
 * Which quick picks have a check-in near them (within about a third of the
 * gap, at least 3 days), each offered once: two picks landing on the same
 * check-in keep the one it's closest to.
 */
export function availableWeeks<T extends Dated>(subs: T[]): number[] {
  const best = new Map<string, { w: number; off: number }>();
  for (const w of COMPARE_WEEKS) {
    const pick = pickComparison(subs, w);
    if (!pick) continue;
    const off = Math.abs(dayNum(pick.after.date) - dayNum(pick.before.date) - w * 7);
    if (off > Math.max(3, w * 7 * 0.35)) continue;
    const prev = best.get(pick.before.id);
    if (!prev || off < prev.off) best.set(pick.before.id, { w, off });
  }
  return [...best.values()].map((b) => b.w).sort((a, b) => a - b);
}

/** The average of the weigh-ins in the 7 days ending on `date`, in the unit given (rows already in it). */
export function weightAround(rows: Array<{ date: string; value: number }>, date: string): { value: number; n: number } | null {
  const d = dayNum(date);
  const xs = rows.filter((r) => dayNum(r.date) <= d && dayNum(r.date) > d - 7 && r.value > 0);
  if (!xs.length) return null;
  return { value: Math.round((xs.reduce((a, r) => a + r.value, 0) / xs.length) * 10) / 10, n: xs.length };
}

/** The waist reading nearest the date, within `days`. */
export function waistAround(rows: Array<{ date: string; waist: number | null; unit: string }>, date: string, days = 4): { value: number; unit: string; date: string } | null {
  const d = dayNum(date);
  let best: { value: number; unit: string; date: string; gap: number } | null = null;
  for (const r of rows) {
    if (r.waist == null || !(r.waist > 0)) continue;
    const gap = Math.abs(dayNum(r.date) - d);
    if (gap <= days && (!best || gap < best.gap)) best = { value: r.waist, unit: r.unit, date: r.date, gap };
  }
  return best ? { value: best.value, unit: best.unit, date: best.date } : null;
}

/** "−3.2 lb", "+1.0 cm" between two readings. */
export function changeText(a: number | null | undefined, b: number | null | undefined, unit: string): string | null {
  if (a == null || b == null) return null;
  const d = Math.round((b - a) * 10) / 10;
  if (d === 0) return `no change`;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} ${unit}`;
}
