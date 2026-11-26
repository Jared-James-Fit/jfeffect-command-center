/**
 * A specialist's Performance tab: only what a game day coach needs to know
 * about the competition lifts (docs/COACHING_PLATFORM.md §7). Every number is
 * the analytics engine's own (lift-strength.ts: the estimated max line, meets
 * as lifted), so the specialist and the athlete never read different
 * strength; nothing is made up for a missing value, and every number says
 * whether it was measured, lifted at a meet, or estimated. Pure.
 */
import {
  COMP_LIFTS,
  compLiftOfResult,
  meetsFromRows,
  type CompLift,
} from "@/lib/analytics/competition-strength";
import { liftStrengths, localDay, type LiftStrength } from "@/lib/analytics/lift-strength";
import type { EnvelopeState } from "@/lib/analytics/strength-estimate";

const LB_PER_KG = 2.2046226218;
const DAY = 86_400_000;

/** Older than this, an estimate isn't "now". */
export const CURRENT_DAYS = 42;

export type PerfSet = {
  date: string;
  load: number; // lb, as getClientResults gives it
  reps: number;
  rpe: string | number | null;
  rir: string | number | null;
  velocity_mps: number | null;
  velocity_quality?: string | null;
  counts_load?: boolean;
  is_competition_lift?: boolean;
  competition_lift_type?: string | null;
  est_1rm?: number;
};

export type MeetRow = {
  meet_date: string | null;
  meet_name: string | null;
  federation: string | null;
  place: string | null;
  weight_class_kg: string | number | null;
  squat_kg: string | number | null;
  bench_kg: string | number | null;
  deadlift_kg: string | number | null;
  total_kg: string | number | null;
  bodyweight_kg?: string | number | null;
  attempts?: unknown;
};

export type UpcomingMeet = {
  name: string;
  date: string;
  federation: string | null;
  weightClass: string | null;
  location: string | null;
};

export type LiftView = {
  lift: CompLift;
  /** the estimate today, when there's a recent one */
  now: { lb: number; day: string; state: EnvelopeState } | null;
  /** meets, as lifted */
  meets: Array<{ day: string; lb: number; name: string | null }>;
};

export type PerformanceView = {
  /** the analytics engine's own read, for the same chart the athlete sees (StrengthTrendChart) */
  strength: Record<CompLift, LiftStrength>;
  lifts: Record<CompLift, LiftView>;
  /** squat + bench + deadlift estimates, only when all three are current */
  estimatedTotal: { lb: number; kg: number } | null;
  heavySingles: Array<{
    day: string;
    lift: CompLift;
    lb: number;
    rpe: string | null;
    mps: number | null;
  }>;
  /** weight against effort, rated sets of 1–5 reps on the competition lifts */
  rpePoints: Record<CompLift, Array<{ day: string; lb: number; reps: number; rpe: number }>>;
  /** measured bar speed on the competition lifts */
  velocity: Record<CompLift, Array<{ day: string; lb: number; reps: number; mps: number }>>;
  /** load–velocity line from the measured sets, when there's enough to draw one */
  loadVelocity: Record<
    CompLift,
    { slope: number; intercept: number; n: number; fromLb: number; toLb: number } | null
  >;
  meets: Array<{
    date: string;
    name: string | null;
    federation: string | null;
    place: string | null;
    weightClass: string | null;
    totalKg: number | null;
    best: Record<CompLift, number | null>;
    attempts: Record<CompLift, Array<{ kg: number; made: boolean }>> | null;
  }>;
  upcoming: (UpcomingMeet & { daysOut: number }) | null;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

function effort(rpe: unknown): number | null {
  const n = num(typeof rpe === "string" ? rpe.replace(/[^\d.]/g, "") : rpe);
  return n != null && n >= 4 && n <= 10 ? n : null;
}

function parseAttempts(a: unknown): PerformanceView["meets"][number]["attempts"] {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const read = (k: string) =>
    (Array.isArray(o[k]) ? (o[k] as unknown[]) : [])
      .map((x) => num(x))
      .filter((x): x is number => x != null && x !== 0)
      .map((x) => ({ kg: Math.abs(x), made: x > 0 }));
  const out = { squat: read("s"), bench: read("b"), deadlift: read("d") };
  return out.squat.length || out.bench.length || out.deadlift.length ? out : null;
}

/** Ordinary least squares of bar speed on load, only when it's worth drawing. */
export function loadVelocityFit(
  points: Array<{ lb: number; mps: number }>,
): PerformanceView["loadVelocity"][CompLift] {
  if (points.length < 5) return null;
  const xs = points.map((p) => p.lb);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  // a line through one weight says nothing: the loads must span at least 10% and 20 lb
  if (hi - lo < Math.max(20, lo * 0.1)) return null;
  const n = points.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = points.reduce((s, p) => s + p.mps, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.lb - mx) * (p.mps - my);
    sxx += (p.lb - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  // a heavier bar never moves faster; a fit that says so is noise
  if (!(slope < 0)) return null;
  return { slope, intercept: my - slope * mx, n, fromLb: lo, toLb: hi };
}

export function buildPerformanceView(input: {
  results: PerfSet[];
  meetRows: MeetRow[];
  upcoming: UpcomingMeet | null;
  today: string;
}): PerformanceView {
  const today = input.today;
  const meets = meetsFromRows(input.meetRows);
  const strengths = liftStrengths(input.results, meets, today);
  const yearAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 365 * DAY).toISOString().slice(0, 10);
  const recentCutoff = new Date(Date.parse(`${today}T12:00:00Z`) - CURRENT_DAYS * DAY)
    .toISOString()
    .slice(0, 10);

  const lifts = {} as Record<CompLift, LiftView>;
  for (const lift of COMP_LIFTS) {
    const s = strengths[lift];
    const env = s.envelope.filter((p) => p.day <= today);
    const last = env[env.length - 1] ?? null;
    const usable = last && last.day >= recentCutoff && last.state !== "stale" ? last : null;
    lifts[lift] = {
      lift,
      now: usable
        ? { lb: Math.round(usable.value * 10) / 10, day: usable.day, state: usable.state }
        : null,
      meets: s.meets.filter((m) => m.day >= yearAgo),
    };
  }

  const nows = COMP_LIFTS.map((l) => lifts[l].now);
  const estimatedTotal = nows.every((n) => n)
    ? (() => {
        const lb = nows.reduce((s, n) => s + n!.lb, 0);
        return { lb: Math.round(lb * 10) / 10, kg: Math.round((lb / LB_PER_KG) * 10) / 10 };
      })()
    : null;

  const comp = (input.results ?? [])
    .map((r) => ({ r, lift: compLiftOfResult(r) }))
    .filter(
      (x): x is { r: PerfSet; lift: CompLift } =>
        !!x.lift && !!x.r.date && x.r.counts_load !== false && Number(x.r.load) > 0,
    );

  const heavySingles = comp
    .filter((x) => Number(x.r.reps) === 1)
    .map((x) => ({
      day: localDay(x.r.date),
      lift: x.lift,
      lb: Math.round(Number(x.r.load) * 10) / 10,
      rpe: x.r.rpe == null || x.r.rpe === "" ? null : String(x.r.rpe),
      mps:
        x.r.velocity_mps != null && Number(x.r.velocity_mps) > 0 ? Number(x.r.velocity_mps) : null,
    }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.lb - a.lb)
    .slice(0, 40);

  const halfYear = new Date(Date.parse(`${today}T12:00:00Z`) - 182 * DAY)
    .toISOString()
    .slice(0, 10);
  const rpePoints = { squat: [], bench: [], deadlift: [] } as PerformanceView["rpePoints"];
  const velocity = { squat: [], bench: [], deadlift: [] } as PerformanceView["velocity"];
  for (const { r, lift } of comp) {
    const day = localDay(r.date);
    const reps = Number(r.reps) || 0;
    const lb = Math.round(Number(r.load) * 10) / 10;
    const e = effort(r.rpe);
    if (e != null && reps >= 1 && reps <= 5 && day >= halfYear)
      rpePoints[lift].push({ day, lb, reps, rpe: e });
    const v = r.velocity_mps != null ? Number(r.velocity_mps) : null;
    if (v != null && v > 0 && v < 3)
      velocity[lift].push({ day, lb, reps, mps: Math.round(v * 100) / 100 });
  }
  const loadVelocity = {
    squat: loadVelocityFit(velocity.squat),
    bench: loadVelocityFit(velocity.bench),
    deadlift: loadVelocityFit(velocity.deadlift),
  };

  const meetList = (input.meetRows ?? [])
    .filter((m) => m.meet_date)
    .map((m) => ({
      date: String(m.meet_date).slice(0, 10),
      name: m.meet_name ?? null,
      federation: m.federation ?? null,
      place: m.place ?? null,
      weightClass:
        m.weight_class_kg == null || m.weight_class_kg === "" ? null : String(m.weight_class_kg),
      totalKg: num(m.total_kg),
      best: { squat: num(m.squat_kg), bench: num(m.bench_kg), deadlift: num(m.deadlift_kg) },
      attempts: parseAttempts(m.attempts),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const upcoming =
    input.upcoming && input.upcoming.date >= today
      ? {
          ...input.upcoming,
          daysOut: Math.round(
            (Date.parse(`${input.upcoming.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
              DAY,
          ),
        }
      : null;

  return {
    strength: strengths,
    lifts,
    estimatedTotal,
    heavySingles,
    rpePoints,
    velocity,
    loadVelocity,
    meets: meetList,
    upcoming,
  };
}

/** "Estimated", "Held (no hard sets lately)", "Lifted at a meet"… in plain words. */
export function stateWords(state: EnvelopeState): string {
  switch (state) {
    case "measured":
      return "From a hard set";
    case "raised":
      return "Raised by a lighter set";
    case "held":
      return "Held: no hard set lately";
    case "stale":
      return "Out of date";
    default:
      return "At least this";
  }
}
