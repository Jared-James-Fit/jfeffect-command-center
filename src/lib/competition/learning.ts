/**
 * What JF Effect has learned about how this athlete competes (pure, tested):
 * their attempt habits, training-to-platform conversion, how past forecasts
 * compared with what they lifted, and their warm-up habits. Each pattern says
 * how much evidence is behind it: "proven" from three or more meets,
 * "preliminary" from one or two. The more meets they do in the app, the more
 * of the strategy is theirs instead of a default.
 */
import { attemptStats } from "./meet-stats";
import type { ConversionPoint } from "./forecast";
import type { Lift, MeetRecord } from "./types";
import type { WarmupHistory } from "./warmups";

export type Evidence = "proven" | "preliminary";

export type Pattern = { key: string; text: string; evidence: Evidence; basis: string };

export type ForecastCheck = {
  meetDate: string;
  lift: Lift | "total";
  predicted: number;
  actual: number;
};

export type CompetitionProfile = {
  meets: number;
  patterns: Pattern[];
  /** mean absolute forecast error on totals, as a share (null: no debriefs yet) */
  forecastError: number | null;
  /** the forecast tends to run high (+) or low (−) on totals */
  forecastBias: number | null;
};

const ev = (n: number): Evidence => (n >= 3 ? "proven" : "preliminary");

export function competitionProfile(input: {
  meets: MeetRecord[];
  conversion: ConversionPoint[];
  checks: ForecastCheck[];
  warmups: Partial<Record<Lift, WarmupHistory>>;
}): CompetitionProfile {
  const s = attemptStats(input.meets);
  const patterns: Pattern[] = [];
  const n = s.meetsWithAttempts;
  if (n >= 1) {
    if (s.openerPct.all != null)
      patterns.push({
        key: "opener",
        text: `Opens at about ${Math.round(s.openerPct.all * 100)}% of what they make`,
        evidence: ev(n),
        basis: `${n} meet${n === 1 ? "" : "s"} with attempts`,
      });
    const s3 = s.success[2];
    if (s3 != null)
      patterns.push({
        key: "thirds",
        text: `Makes ${Math.round(s3 * 100)}% of third attempts`,
        evidence: ev(n),
        basis: `${s.taken[2]} third attempts`,
      });
    if (s.jumpKg.second != null && s.jumpKg.third != null)
      patterns.push({
        key: "jumps",
        text: `Typical jumps: ${s.jumpKg.second} kg to the second, ${s.jumpKg.third} kg to the third`,
        evidence: ev(n),
        basis: "Made attempts only",
      });
    const misses = (Object.entries(s.missesByLift) as [Lift, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (misses.length && misses[0][1] >= 2)
      patterns.push({
        key: "misses",
        text: `Most misses on the ${misses[0][0]} (${misses[0][1]})`,
        evidence: ev(n),
        basis: "Missed attempts across their meets",
      });
    if (s.bombOuts)
      patterns.push({
        key: "bombs",
        text: `No total at ${s.bombOuts} of ${s.meets} meets: openers stay conservative`,
        evidence: ev(s.meets),
        basis: "Meets with no total",
      });
    if (s.leavesWeight)
      patterns.push({
        key: "leaves",
        text: "Makes nearly every third with a small jump: likely leaves weight on the platform",
        evidence: ev(n),
        basis: "Third-attempt jumps and success",
      });
  }
  for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
    const pts = input.conversion.filter((c) => c.lift === lift);
    if (!pts.length) continue;
    const r = pts.map((p) => p.meetKg / p.trainingKg).sort((a, b) => a - b);
    const med = r[Math.floor(r.length / 2)];
    const words =
      med >= 1.02
        ? "lifts more on the platform than training suggests"
        : med <= 0.98
          ? "lifts less on the platform than training suggests"
          : "lifts about what training suggests";
    patterns.push({
      key: `conversion:${lift}`,
      text: `${lift[0].toUpperCase()}${lift.slice(1)}: ${words} (${Math.round(med * 1000) / 10}%)`,
      evidence: ev(pts.length),
      basis: `${pts.length} meet${pts.length === 1 ? "" : "s"} against the training line 3 weeks before`,
    });
  }
  for (const [lift, w] of Object.entries(input.warmups) as [Lift, WarmupHistory][]) {
    if (!w || w.sessions < 3 || w.lastPct == null) continue;
    patterns.push({
      key: `warmup:${lift}`,
      text: `${lift[0].toUpperCase()}${lift.slice(1)}: last warm-up about ${Math.round(w.lastPct * 100)}% of the first working set, ${w.medianSets} sets`,
      evidence: w.sessions >= 6 ? "proven" : "preliminary",
      basis: `${w.sessions} sessions with logged warm-ups`,
    });
  }
  const totals = input.checks.filter((c) => c.lift === "total" && c.actual > 0);
  const forecastError = totals.length
    ? Math.round(
        (totals.reduce((t, c) => t + Math.abs(c.predicted - c.actual) / c.actual, 0) /
          totals.length) *
          1000,
      ) / 1000
    : null;
  const forecastBias = totals.length
    ? Math.round(
        (totals.reduce((t, c) => t + (c.predicted - c.actual) / c.actual, 0) / totals.length) *
          1000,
      ) / 1000
    : null;
  if (forecastBias != null && Math.abs(forecastBias) >= 0.02) {
    patterns.push({
      key: "forecast",
      text: `Past forecasts ran ${forecastBias > 0 ? "high" : "low"} by about ${Math.round(Math.abs(forecastBias) * 100)}%`,
      evidence: ev(totals.length),
      basis: `${totals.length} debriefed meet${totals.length === 1 ? "" : "s"}`,
    });
  }
  return { meets: s.meets, patterns, forecastError, forecastBias };
}
