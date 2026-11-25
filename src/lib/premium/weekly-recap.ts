/**
 * Cleo's weekly training recap (Premium, T01): 2 to 4 stat cards from the
 * week's logged workouts, with last week beside them when there was one.
 * Deterministic and pure (tested in premium.test.ts): every number is a sum or
 * a count of what was logged, a card shows only when its number is real (above
 * zero, one unit), and fewer than two cards means no recap that week, never a
 * padded one.
 */
export type WeekWorkout = {
  completed_at: string;
  actual_duration_min: number | null;
  logged_sets_count: number | null;
  session_weight_total: number | null;
  session_weight_unit: string | null;
};

export type RecapCard = { key: "workouts" | "time" | "sets" | "lifted"; value: string; label: string; sub: string | null };
export type WeeklyRecap = { title: string; body: string; cards: RecapCard[] };

type Totals = { workouts: number; minutes: number; sets: number; lifted: number | null; unit: "lb" | "kg" | null };

export function weekTotals(rows: readonly WeekWorkout[]): Totals {
  const done = rows.filter((r) => !!r.completed_at);
  const units = new Set(done.filter((r) => Number(r.session_weight_total) > 0).map((r) => (String(r.session_weight_unit ?? "").toLowerCase() === "kg" ? "kg" : "lb")));
  const oneUnit = units.size === 1 ? ([...units][0] as "lb" | "kg") : null;
  return {
    workouts: done.length,
    minutes: Math.round(done.reduce((s, r) => s + Math.max(0, Number(r.actual_duration_min) || 0), 0)),
    sets: done.reduce((s, r) => s + Math.max(0, Number(r.logged_sets_count) || 0), 0),
    // mixed units are never added together
    lifted: oneUnit ? Math.round(done.reduce((s, r) => s + Math.max(0, Number(r.session_weight_total) || 0), 0)) : null,
    unit: oneUnit,
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");
function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
function versus(now: number, before: number | null | undefined, one: string, many = `${one}s`): string | null {
  if (before == null || before <= 0) return null;
  const d = now - before;
  if (d === 0) return `Same as last week`;
  const word = Math.abs(d) === 1 ? one : many;
  const amount = one === "lb" || one === "kg" ? (d > 0 ? "more" : "less") : d > 0 ? "more" : "fewer";
  return `${fmt(Math.abs(d))} ${word} ${amount} than last week`;
}

/** The recap for a week, or null when there's too little to say honestly. */
export function weeklyRecap(thisWeek: readonly WeekWorkout[], lastWeek: readonly WeekWorkout[] | null): WeeklyRecap | null {
  const t = weekTotals(thisWeek);
  if (t.workouts === 0) return null;
  const p = lastWeek ? weekTotals(lastWeek) : null;
  const cards: RecapCard[] = [];
  cards.push({ key: "workouts", value: fmt(t.workouts), label: t.workouts === 1 ? "workout" : "workouts", sub: versus(t.workouts, p?.workouts, "workout") });
  if (t.minutes > 0) cards.push({ key: "time", value: hours(t.minutes), label: "training", sub: null });
  if (t.sets > 0) cards.push({ key: "sets", value: fmt(t.sets), label: "sets logged", sub: versus(t.sets, p?.sets, "set") });
  if (t.lifted && t.unit) {
    const same = p && p.unit === t.unit ? p.lifted : null;
    cards.push({ key: "lifted", value: `${fmt(t.lifted)} ${t.unit}`, label: "lifted", sub: versus(t.lifted, same, t.unit, t.unit) });
  }
  if (cards.length < 2) return null;
  const up = p && p.workouts > 0 && t.workouts > p.workouts;
  const body = up
    ? `${t.workouts} workouts, up from ${p!.workouts}. Keep that going.`
    : t.workouts >= 3
      ? `${t.workouts} workouts this week. That's consistency.`
      : `${t.workouts} ${t.workouts === 1 ? "workout" : "workouts"} in. Next week, one more.`;
  return { title: "Your week", body, cards: cards.slice(0, 4) };
}

/** Monday (YYYY-MM-DD) of the ISO week a local date falls in. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
