/**
 * What a lifter's meets say about how they attempt (pure, tested): openers as
 * a share of what they made that day, how often each attempt goes, how big
 * their jumps are, where the misses are, bomb-outs. The same read serves our
 * athlete (learning.ts) and every competitor (competitor.ts).
 *
 * Patterns are what the attempts show, never a claim about what the lifter
 * meant: "takes thirds 4%+ over the second and makes under half of them" is
 * an observation; "aggressive" is only the label for it, and only with three
 * or more meets of attempts behind it.
 */
import type { AttemptTriple, Lift, MeetRecord } from "./types";

const LIFT_KEY: Record<Lift, "s" | "b" | "d"> = { squat: "s", bench: "b", deadlift: "d" };

export type AttemptStyle = "conservative" | "balanced" | "aggressive" | "inconsistent";

export type AttemptStats = {
  /** full-power meets considered */
  meets: number;
  meetsWithAttempts: number;
  /** made / taken for the 1st, 2nd and 3rd attempts across all lifts */
  success: [number | null, number | null, number | null];
  taken: [number, number, number];
  /** median opener ÷ best made that lift that day */
  openerPct: Record<Lift, number | null> & { all: number | null };
  /** median jump as a share of the previous attempt */
  jumpPct: { second: number | null; third: number | null };
  /** median jump in kg */
  jumpKg: { second: number | null; third: number | null };
  missesByLift: Record<Lift, number>;
  /** meets with no total (a lift with no attempt made, or listed as a DQ) */
  bombOuts: number;
  style: AttemptStyle | null;
  /** what the style reads from, in words */
  styleWhy: string[];
  /** made nearly every third with small jumps: likely leaves weight on the platform */
  leavesWeight: boolean;
};

const median = (xs: number[]): number | null => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const r3 = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 1000);

/** Full power only, equipment matched loosely (Raw / Wraps / classic), newest first. */
export function fullPowerMeets(
  meets: MeetRecord[],
  equipment: "raw" | "any" = "raw",
): MeetRecord[] {
  return meets.filter((m) => {
    if ((m.event ?? "SBD").toUpperCase() !== "SBD") return false;
    if (equipment === "any") return true;
    const e = String(m.equipment ?? "Raw").toLowerCase();
    return e === "" || e === "raw" || e === "classic" || e === "wraps";
  });
}

const isDq = (m: MeetRecord) => /^(dq|dd|nd)$/i.test(String(m.place ?? "").trim());

export function attemptStats(meetsIn: MeetRecord[]): AttemptStats {
  const meets = fullPowerMeets(meetsIn);
  const taken: [number, number, number] = [0, 0, 0];
  const made: [number, number, number] = [0, 0, 0];
  const opener: Record<Lift, number[]> = { squat: [], bench: [], deadlift: [] };
  const jump2: number[] = [];
  const jump3: number[] = [];
  const jump2kg: number[] = [];
  const jump3kg: number[] = [];
  const misses: Record<Lift, number> = { squat: 0, bench: 0, deadlift: 0 };
  let withAttempts = 0;
  let bombs = 0;

  for (const m of meets) {
    const noTotal = isDq(m) || !(m.total && m.total > 0);
    if (noTotal) bombs++;
    if (!m.attempts) continue;
    withAttempts++;
    for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
      const t: AttemptTriple = m.attempts[LIFT_KEY[lift]];
      const madeKg = t.filter((x): x is number => x != null && x > 0);
      const best = madeKg.length ? Math.max(...madeKg) : null;
      t.forEach((x, i) => {
        if (x == null || x === 0) return;
        taken[i]++;
        if (x > 0) made[i]++;
        else misses[lift]++;
      });
      const a1 = t[0] != null ? Math.abs(t[0]!) : null;
      const a2 = t[1] != null ? Math.abs(t[1]!) : null;
      const a3 = t[2] != null ? Math.abs(t[2]!) : null;
      if (a1 && best) opener[lift].push(a1 / best);
      // a jump only after a made attempt (a repeat after a miss isn't a jump)
      if (a1 && a2 && t[0]! > 0 && a2 > a1) {
        jump2.push((a2 - a1) / a1);
        jump2kg.push(a2 - a1);
      }
      if (a2 && a3 && t[1]! > 0 && a3 > a2) {
        jump3.push((a3 - a2) / a2);
        jump3kg.push(a3 - a2);
      }
    }
  }

  const success = taken.map((n, i) =>
    n ? Math.round((made[i] / n) * 100) / 100 : null,
  ) as AttemptStats["success"];
  const allOpeners = [...opener.squat, ...opener.bench, ...opener.deadlift];
  const j3 = median(jump3);
  const s3 = success[2];
  const bombRate = meets.length ? bombs / meets.length : 0;

  let style: AttemptStyle | null = null;
  const why: string[] = [];
  if (withAttempts >= 3) {
    if (bombRate >= 0.2 || (success[0] != null && success[0] < 0.75)) {
      style = "inconsistent";
      if (bombRate >= 0.2) why.push(`No total at ${bombs} of ${meets.length} meets`);
      if (success[0] != null && success[0] < 0.75)
        why.push(`Makes ${Math.round(success[0] * 100)}% of openers`);
    } else if ((s3 != null && s3 < 0.45) || (j3 != null && j3 > 0.04)) {
      style = "aggressive";
      if (s3 != null) why.push(`Makes ${Math.round(s3 * 100)}% of third attempts`);
      if (j3 != null)
        why.push(`Third attempts a median ${Math.round(j3 * 1000) / 10}% over the second`);
    } else if (s3 != null && s3 >= 0.8 && (j3 == null || j3 <= 0.025)) {
      style = "conservative";
      why.push(`Makes ${Math.round(s3 * 100)}% of third attempts`);
      if (j3 != null)
        why.push(`Third attempts a median ${Math.round(j3 * 1000) / 10}% over the second`);
    } else {
      style = "balanced";
      if (s3 != null) why.push(`Makes ${Math.round(s3 * 100)}% of third attempts`);
    }
  }

  return {
    meets: meets.length,
    meetsWithAttempts: withAttempts,
    success,
    taken,
    openerPct: {
      squat: r3(median(opener.squat)),
      bench: r3(median(opener.bench)),
      deadlift: r3(median(opener.deadlift)),
      all: r3(median(allOpeners)),
    },
    jumpPct: { second: r3(median(jump2)), third: r3(j3) },
    jumpKg: { second: median(jump2kg), third: median(jump3kg) },
    missesByLift: misses,
    bombOuts: bombs,
    style,
    styleWhy: why,
    leavesWeight: withAttempts >= 3 && s3 != null && s3 >= 0.85 && j3 != null && j3 <= 0.02,
  };
}

/** A lift's best made attempt at a meet, else its best-3 number. */
export function liftAt(m: MeetRecord, lift: Lift): number | null {
  const v = m[lift];
  if (v != null && v > 0) return v;
  const t = m.attempts?.[LIFT_KEY[lift]];
  const made = ((t ?? []) as Array<number | null>).filter((x): x is number => x != null && x > 0);
  return made.length ? Math.max(...made) : null;
}

/** Least-squares change in total per year over the meets given (≥ 2 dated totals), else null. */
export function totalSlopePerYear(meets: MeetRecord[]): number | null {
  const pts = meets
    .filter((m) => m.total && m.total > 0)
    .map((m) => ({ x: Date.parse(`${m.date}T12:00:00Z`) / (365.25 * 86_400_000), y: m.total! }));
  if (pts.length < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx < 1e-6) return null;
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  return Math.round((sxy / sxx) * 10) / 10;
}
