/**
 * Per-lift session analytics: the numbers a strength coach reads off a
 * training log. Pure functions over the loaded sets of ONE exercise (as built
 * by buildExerciseHistory), all loads in lb.
 *
 * A session is one calendar day of that exercise. Charting one point per
 * session (its best set) instead of one per set keeps back-off sets from
 * drawing a fake "drop" after every top set.
 */

export type LiftSetInput = {
  id: string;
  row_id?: string | null;
  date: string;
  load: number;
  reps: number;
  est_1rm: number;
  rpe?: string | number | null;
  rir?: string | number | null;
  velocity_mps?: number | null;
  set_index?: number | null;
};

export type Effort = { value: number; source: "RPE" | "RIR"; raw: number };

export type LiftSession<T extends LiftSetInput = LiftSetInput> = {
  /** Local calendar day, yyyy-MM-dd. Unique per session. */
  key: string;
  /** ISO timestamp of the session's first set. */
  date: string;
  /** In the order they were performed: exercise row, then set number. */
  sets: T[];
  /** Best estimated-1RM set (ties → heavier load). */
  top: T;
  /** Heaviest load (ties → more reps). */
  heaviest: T;
  e1rm: number;
  tonnage: number;
  setCount: number;
  reps: number;
  /** Mean effort on the RPE scale over sets that logged RPE or RIR. */
  avgEffort: number | null;
  effortSource: "RPE" | "RIR" | "mixed" | null;
  /** Mean concentric velocity of the heaviest set that logged one. */
  velocity: number | null;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** RPE as logged, or RIR mapped onto the RPE scale (RIR 2 = RPE 8). */
export function setEffort(s: Pick<LiftSetInput, "rpe" | "rir">): Effort | null {
  const rpe = num(s.rpe);
  if (rpe != null && rpe > 0) return { value: Math.min(10, rpe), source: "RPE", raw: rpe };
  const rir = num(s.rir);
  if (rir != null && rir >= 0) return { value: Math.max(0, 10 - rir), source: "RIR", raw: rir };
  return null;
}

export function fmtEffort(e: Effort): string {
  return e.source === "RIR" ? `${trim(e.raw)} RIR` : `RPE ${trim(e.raw)}`;
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function groupLiftSessions<T extends LiftSetInput>(points: T[]): LiftSession<T>[] {
  const byDay = new Map<string, T[]>();
  for (const p of points) {
    if (!p.date || !(p.load > 0) || !(p.reps > 0)) continue;
    const k = dayKey(p.date);
    const arr = byDay.get(k);
    if (arr) arr.push(p);
    else byDay.set(k, [p]);
  }

  const sessions: LiftSession<T>[] = [];
  for (const [key, raw] of byDay) {
    // Sets of one row can be saved together out of order, so order by when
    // each exercise row was first logged, then by set number. Rows saved at
    // the same moment put the heavier one first (top set before back-offs).
    const rowStart = new Map<string, number>();
    const rowMax = new Map<string, number>();
    for (const s of raw) {
      const r = s.row_id ?? "";
      const t = new Date(s.date).getTime();
      rowStart.set(r, Math.min(rowStart.get(r) ?? Infinity, t));
      rowMax.set(r, Math.max(rowMax.get(r) ?? 0, s.load));
    }
    const sets = [...raw].sort(
      (a, b) =>
        rowStart.get(a.row_id ?? "")! - rowStart.get(b.row_id ?? "")! ||
        rowMax.get(b.row_id ?? "")! - rowMax.get(a.row_id ?? "")! ||
        (a.row_id ?? "").localeCompare(b.row_id ?? "") ||
        (a.set_index ?? 0) - (b.set_index ?? 0) ||
        new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    let top = sets[0];
    let heaviest = sets[0];
    let tonnage = 0;
    let reps = 0;
    let effortSum = 0;
    let effortN = 0;
    const sources = new Set<"RPE" | "RIR">();
    let velocity: number | null = null;
    let velocityLoad = -1;
    for (const s of sets) {
      if (s.est_1rm > top.est_1rm || (s.est_1rm === top.est_1rm && s.load > top.load)) top = s;
      if (s.load > heaviest.load || (s.load === heaviest.load && s.reps > heaviest.reps))
        heaviest = s;
      tonnage += s.load * s.reps;
      reps += s.reps;
      const e = setEffort(s);
      if (e) {
        effortSum += e.value;
        effortN += 1;
        sources.add(e.source);
      }
      const v = num(s.velocity_mps);
      if (v != null && v > 0 && s.load > velocityLoad) {
        velocity = v;
        velocityLoad = s.load;
      }
    }

    sessions.push({
      key,
      date: sets.reduce((min, s) => (s.date < min ? s.date : min), sets[0].date),
      sets,
      top,
      heaviest,
      e1rm: top.est_1rm,
      tonnage,
      setCount: sets.length,
      reps,
      avgEffort: effortN ? Math.round((effortSum / effortN) * 10) / 10 : null,
      effortSource: sources.size === 2 ? "mixed" : sources.size === 1 ? [...sources][0] : null,
      velocity,
    });
  }
  return sessions.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Coach shorthand for a session: identical sets collapse to load×reps×sets.
 * `495×5 @4 · 315×5×2 @6`. `formatLoad` converts lb to the display unit.
 */
export function sessionNotation(sets: LiftSetInput[], formatLoad: (lb: number) => string): string {
  const groups: { load: number; reps: number; count: number; efforts: Effort[] }[] = [];
  for (const s of sets) {
    const g = groups.find((x) => Math.abs(x.load - s.load) < 0.05 && x.reps === s.reps);
    const e = setEffort(s);
    if (g) {
      g.count += 1;
      if (e) g.efforts.push(e);
    } else {
      groups.push({ load: s.load, reps: s.reps, count: 1, efforts: e ? [e] : [] });
    }
  }
  return groups
    .map((g) => {
      const base = `${formatLoad(g.load)}×${g.reps}${g.count > 1 ? `×${g.count}` : ""}`;
      if (!g.efforts.length) return base;
      const rir = g.efforts.every((e) => e.source === "RIR");
      const vals = g.efforts.map((e) => e.raw);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const range = lo === hi ? trim(lo) : `${trim(lo)}–${trim(hi)}`;
      return rir ? `${base} ${range} RIR` : `${base} @${range}`;
    })
    .join(" · ");
}

/**
 * Best load lifted for each exact rep count (1–12). A rep max is dropped when
 * a heavier-or-equal load was done for more reps, since it says nothing new.
 */
export function repMaxes(
  points: LiftSetInput[],
  maxReps = 12,
): { reps: number; load: number; date: string }[] {
  const best = new Map<number, { reps: number; load: number; date: string }>();
  for (const p of points) {
    if (!(p.load > 0) || !(p.reps >= 1) || p.reps > maxReps || !p.date) continue;
    const cur = best.get(p.reps);
    if (!cur || p.load > cur.load || (p.load === cur.load && p.date < cur.date)) {
      best.set(p.reps, { reps: p.reps, load: p.load, date: p.date });
    }
  }
  const all = [...best.values()].sort((a, b) => a.reps - b.reps);
  return all.filter((r) => !all.some((o) => o.reps > r.reps && o.load >= r.load));
}

/**
 * e1RM trend in lb per week: least-squares slope over session e1RMs, which
 * rides through heavy/light-day noise better than first-vs-last. Needs 3+
 * sessions spanning 2+ weeks, else null.
 */
export function e1rmTrendPerWeek(sessions: Pick<LiftSession, "date" | "e1rm">[]): number | null {
  const pts = sessions.filter((s) => s.e1rm > 0);
  if (pts.length < 3) return null;
  const t0 = new Date(pts[0].date).getTime();
  const xs = pts.map((s) => (new Date(s.date).getTime() - t0) / 86_400_000);
  if (xs[xs.length - 1] - xs[0] < 14) return null;
  const ys = pts.map((s) => s.e1rm);
  const xBar = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yBar = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ssX = xs.reduce((a, x) => a + (x - xBar) ** 2, 0);
  if (ssX === 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - xBar) * (ys[i] - yBar), 0) / ssX;
  return slope * 7;
}

export type EffortChange = {
  load: number;
  reps: number;
  from: Effort & { date: string };
  to: Effort & { date: string };
  /** Positive = felt harder, negative = felt easier (RPE scale). */
  delta: number;
};

/**
 * Same load and reps, different effort: the cleanest strength signal in a
 * log. Compares the first and latest session that repeated a load×reps with
 * effort logged (hardest set of it per session). Picks the heaviest such
 * pairing that moved by at least 1 RPE.
 */
export function sameLoadEffortChange(sessions: LiftSession[]): EffortChange | null {
  const byPair = new Map<
    string,
    { load: number; reps: number; hits: (Effort & { date: string })[] }
  >();
  for (const s of sessions) {
    const hardest = new Map<string, Effort & { date: string }>();
    for (const set of s.sets) {
      const e = setEffort(set);
      if (!e) continue;
      const load = Math.round(set.load * 2) / 2;
      const k = `${load}|${set.reps}`;
      const cur = hardest.get(k);
      if (!cur || e.value > cur.value) hardest.set(k, { ...e, date: s.date });
      if (!byPair.has(k)) byPair.set(k, { load, reps: set.reps, hits: [] });
    }
    for (const [k, e] of hardest) byPair.get(k)!.hits.push(e);
  }

  let best: EffortChange | null = null;
  for (const p of byPair.values()) {
    if (p.hits.length < 2) continue;
    const from = p.hits[0];
    const to = p.hits[p.hits.length - 1];
    const delta = Math.round((to.value - from.value) * 10) / 10;
    if (Math.abs(delta) < 1) continue;
    if (
      !best ||
      p.load > best.load ||
      (p.load === best.load && Math.abs(delta) > Math.abs(best.delta))
    ) {
      best = { load: p.load, reps: p.reps, from, to, delta };
    }
  }
  return best;
}
