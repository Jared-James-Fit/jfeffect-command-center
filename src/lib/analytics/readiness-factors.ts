/**
 * Training Readiness factor breakdown.
 *
 * Turns the raw signals we already collect (sleep buckets, recovery feel,
 * completion %, pain flags, session RPE, workout counts, e1RM-derived scores)
 * into 0–100 factor rings shown on the athlete's Training Readiness card.
 * The scores are heuristic and deliberately smooth — this is a coach
 * explaining "what helped / what hurt" today, not a diagnostic tool.
 */

import { sleepBucketHours, sleepBucketLabel, type SleepBucket } from "./recovery-score";

export type FactorKey =
  | "sleep"
  | "recovery"
  | "load"
  | "consistency"
  | "performance"
  | "pain";

export type FactorStatus = "good" | "watch" | "low";

export interface FactorDetail {
  key: FactorKey;
  label: string;
  emoji: string;
  score: number;
  status: FactorStatus;
  currentValue: string;
  subtitle?: string;
  metrics: Array<{ label: string; value: string }>;
  trend: "Improving" | "Stable" | "Dropping" | "Building" | "—";
  impact: "Positive" | "Neutral" | "Limiting";
  recommendation: string;
  isMissing?: boolean;
}

export interface ReadinessBreakdown {
  factors: Record<FactorKey, FactorDetail>;
  order: FactorKey[];
  positive: FactorDetail | null;
  limiter: FactorDetail | null;
  recommendation: string;
}

function statusFor(score: number): FactorStatus {
  if (score >= 80) return "good";
  if (score >= 60) return "watch";
  return "low";
}

function trendFromValues(recent: number[], previous: number[]): FactorDetail["trend"] {
  if (recent.length < 2 || previous.length < 2) return "Building";
  const r = recent.reduce((s, n) => s + n, 0) / recent.length;
  const p = previous.reduce((s, n) => s + n, 0) / previous.length;
  const diff = r - p;
  if (Math.abs(diff) < 0.5) return "Stable";
  return diff > 0 ? "Improving" : "Dropping";
}

export interface SleepSample {
  ts: string;
  bucket: SleepBucket;
}

function buildSleep(samples: SleepSample[]): FactorDetail {
  const latest = samples[samples.length - 1] ?? null;
  if (!latest) {
    return {
      key: "sleep",
      label: "Sleep",
      emoji: "😴",
      score: 0,
      status: "watch",
      currentValue: "—",
      metrics: [],
      trend: "—",
      impact: "Neutral",
      recommendation: "Log sleep in your next workout review so we can factor it in.",
      isMissing: true,
    };
  }
  const map: Record<SleepBucket, number> = {
    lt5: 20, "5_6": 45, "6_7": 65, "7_8": 90, "8_9": 95, gte9: 82,
  };
  const score = map[latest.bucket];
  const last7 = samples.slice(-7).map((s) => sleepBucketHours(s.bucket) ?? 0);
  const last30 = samples.slice(-30).map((s) => sleepBucketHours(s.bucket) ?? 0);
  const avg7 = last7.length ? last7.reduce((s, n) => s + n, 0) / last7.length : null;
  const avg30 = last30.length ? last30.reduce((s, n) => s + n, 0) / last30.length : null;
  const trend = trendFromValues(
    samples.slice(-3).map((s) => sleepBucketHours(s.bucket) ?? 0),
    samples.slice(-6, -3).map((s) => sleepBucketHours(s.bucket) ?? 0),
  );
  const impact: FactorDetail["impact"] =
    score >= 80 ? "Positive" : score >= 60 ? "Neutral" : "Limiting";
  const rec =
    score >= 80
      ? "Maintain your current sleep routine. Quality sessions typically follow nights like this."
      : score >= 60
        ? "Aim for another 30–60 minutes tonight to lift readiness."
        : "Prioritize an earlier bedtime tonight — short sleep is the biggest limiter on training quality.";
  return {
    key: "sleep",
    label: "Sleep",
    emoji: "😴",
    score,
    status: statusFor(score),
    currentValue: sleepBucketLabel(latest.bucket),
    metrics: [
      { label: "Current", value: sleepBucketLabel(latest.bucket) },
      { label: "7-Day Average", value: avg7 != null ? `${avg7.toFixed(1)} h` : "—" },
      { label: "30-Day Average", value: avg30 != null ? `${avg30.toFixed(1)} h` : "—" },
    ],
    trend, impact, recommendation: rec,
  };
}

function buildRecoveryFeel(samples: Array<{ ts: string; rating: number }>): FactorDetail {
  const latest = samples[samples.length - 1];
  if (!latest) {
    return {
      key: "recovery",
      label: "Recovery",
      emoji: "💪",
      score: 0,
      status: "watch",
      currentValue: "—",
      metrics: [],
      trend: "—",
      impact: "Neutral",
      recommendation: "Rate how recovered you feel in your next check-in for a sharper score.",
      isMissing: true,
    };
  }
  const map: Record<number, { s: number; label: string }> = {
    1: { s: 25, label: "Very Poor" },
    2: { s: 45, label: "Poor" },
    3: { s: 65, label: "Average" },
    4: { s: 85, label: "Good" },
    5: { s: 96, label: "Excellent" },
  };
  const info = map[Math.round(latest.rating)] ?? map[3];
  const last7 = samples.slice(-7).map((s) => s.rating);
  const avg7 = last7.reduce((s, n) => s + n, 0) / last7.length;
  const trend = trendFromValues(
    samples.slice(-3).map((s) => s.rating),
    samples.slice(-6, -3).map((s) => s.rating),
  );
  return {
    key: "recovery",
    label: "Recovery",
    emoji: "💪",
    score: info.s,
    status: statusFor(info.s),
    currentValue: info.label,
    metrics: [
      { label: "Current", value: info.label },
      { label: "7-Day Average", value: `${avg7.toFixed(1)} / 5` },
      { label: "Samples", value: `${samples.length}` },
    ],
    trend,
    impact: info.s >= 80 ? "Positive" : info.s >= 60 ? "Neutral" : "Limiting",
    recommendation:
      info.s >= 80
        ? "You're feeling recovered — a great day to push top sets if warm-ups feel sharp."
        : info.s >= 60
          ? "Warm up carefully and let today's top set dictate the load."
          : "Reduce optional volume and keep effort under the prescribed RPE cap today.",
  };
}

function buildLoad(workouts7d: number, workouts14d: number): FactorDetail {
  let score = 90;
  let status: string;
  if (workouts7d === 0) { score = 60; status = "Under-training"; }
  else if (workouts7d <= 2) { score = 88; status = "Light"; }
  else if (workouts7d <= 4) { score = 92; status = "Moderate"; }
  else if (workouts7d === 5) { score = 72; status = "High"; }
  else { score = 55; status = "Very High"; }
  const prior = workouts14d - workouts7d;
  const deltaPct = prior > 0 ? Math.round(((workouts7d - prior) / prior) * 100) : 0;
  const trend: FactorDetail["trend"] =
    prior === 0 ? "Building" : Math.abs(deltaPct) < 15 ? "Stable" : deltaPct > 0 ? "Improving" : "Dropping";
  const impact: FactorDetail["impact"] =
    score >= 80 ? "Positive" : score >= 60 ? "Neutral" : "Limiting";
  const rec =
    workouts7d >= 5
      ? "Your workload has increased recently. Stay within today's prescribed RPE and prioritize quality over extra volume."
      : workouts7d === 0
        ? "Ease back in — keep first working sets 1–2 RIR to rebuild feel."
        : "Load is well-managed. Train as planned.";
  return {
    key: "load",
    label: "Training Load",
    emoji: "📈",
    score,
    status: statusFor(score),
    currentValue: status,
    metrics: [
      { label: "Last 7 Days", value: `${workouts7d} workouts` },
      { label: "Previous 7 Days", value: `${prior} workouts` },
      { label: "Change", value: prior === 0 ? "—" : `${deltaPct >= 0 ? "+" : ""}${deltaPct}%` },
    ],
    trend, impact, recommendation: rec,
  };
}

function buildConsistency(completed30d: number, scheduled30d: number | null): FactorDetail {
  const target = scheduled30d && scheduled30d > 0 ? scheduled30d : Math.max(completed30d, 12);
  const pct = Math.min(100, Math.round((completed30d / target) * 100));
  const impact: FactorDetail["impact"] =
    pct >= 80 ? "Positive" : pct >= 60 ? "Neutral" : "Limiting";
  return {
    key: "consistency",
    label: "Consistency",
    emoji: "🏋️",
    score: pct,
    status: statusFor(pct),
    currentValue: `${pct}%`,
    metrics: [
      { label: "Completed (30d)", value: `${completed30d} workouts` },
      { label: "Target", value: `${target} workouts` },
    ],
    trend: "Stable",
    impact,
    recommendation:
      pct >= 80
        ? "Great consistency. Keep the streak going."
        : pct >= 60
          ? "Stack one more session this week to lock in momentum."
          : "Focus on showing up — even a shorter session beats a skipped one.",
  };
}

function buildPerformance(scores: number[]): FactorDetail {
  if (scores.length < 3) {
    return {
      key: "performance",
      label: "Performance Trend",
      emoji: "📊",
      score: 70,
      status: "watch",
      currentValue: "Building",
      metrics: [{ label: "Sessions", value: `${scores.length}` }],
      trend: "Building",
      impact: "Neutral",
      recommendation: "A few more sessions will unlock a full performance trend.",
      isMissing: scores.length === 0,
    };
  }
  const recent = scores.slice(-3);
  const previous = scores.slice(-6, -3);
  const r = recent.reduce((s, n) => s + n, 0) / recent.length;
  const p = previous.length ? previous.reduce((s, n) => s + n, 0) / previous.length : r;
  const diff = r - p;
  const score = Math.max(35, Math.min(100, Math.round(r * 0.7 + 30 + diff)));
  const trend: FactorDetail["trend"] =
    previous.length < 2 ? "Building" : Math.abs(diff) < 3 ? "Stable" : diff > 0 ? "Improving" : "Dropping";
  const impact: FactorDetail["impact"] =
    trend === "Improving" ? "Positive" : trend === "Dropping" ? "Limiting" : "Neutral";
  return {
    key: "performance",
    label: "Performance Trend",
    emoji: "📊",
    score,
    status: statusFor(score),
    currentValue: trend === "Building" ? "Building" : trend,
    metrics: [
      { label: "Recent Avg", value: `${Math.round(r)}%` },
      { label: "Previous Avg", value: previous.length ? `${Math.round(p)}%` : "—" },
      { label: "Change", value: previous.length ? `${diff >= 0 ? "+" : ""}${Math.round(diff)}` : "—" },
    ],
    trend, impact,
    recommendation:
      trend === "Improving"
        ? "Your performance trend has been rising. Trust today's plan."
        : trend === "Dropping"
          ? "Trend is slipping. Prioritize technique and stay 1 RIR from failure."
          : "Performance is holding steady. Execute as prescribed.",
  };
}

function buildPain(painDays7d: number): FactorDetail {
  const clean = painDays7d === 0;
  const score = clean ? 100 : painDays7d === 1 ? 65 : 35;
  const impact: FactorDetail["impact"] = clean ? "Positive" : "Limiting";
  return {
    key: "pain",
    label: "Pain / Injury",
    emoji: "⚠️",
    score,
    status: statusFor(score),
    currentValue: clean ? "None" : `${painDays7d} session${painDays7d === 1 ? "" : "s"}`,
    metrics: [
      { label: "Last 7 Days", value: clean ? "No pain reported" : `${painDays7d} flagged` },
    ],
    trend: clean ? "Stable" : "Dropping",
    impact,
    recommendation: clean
      ? "No pain flagged — train freely within today's prescription."
      : "Sub in a pain-free variation for anything that flares up and let your coach know.",
  };
}

export interface BreakdownInput {
  sleepSamples: SleepSample[];
  recoverySamples: Array<{ ts: string; rating: number }>;
  workouts7d: number;
  workouts14d: number;
  completed30d: number;
  scheduled30d: number | null;
  scores: number[];
  painDays7d: number;
}

export function buildReadinessBreakdown(inp: BreakdownInput): ReadinessBreakdown {
  const factors: Record<FactorKey, FactorDetail> = {
    sleep: buildSleep(inp.sleepSamples),
    recovery: buildRecoveryFeel(inp.recoverySamples),
    load: buildLoad(inp.workouts7d, inp.workouts14d),
    consistency: buildConsistency(inp.completed30d, inp.scheduled30d),
    performance: buildPerformance(inp.scores),
    pain: buildPain(inp.painDays7d),
  };
  const order: FactorKey[] = ["sleep", "recovery", "load", "consistency", "performance", "pain"];
  const scored = order.map((k) => factors[k]).filter((f) => !f.isMissing);
  const positive = scored.slice().sort((a, b) => b.score - a.score)[0] ?? null;
  const limiter =
    scored.slice().sort((a, b) => a.score - b.score).find((f) => f.score < 80) ?? null;
  const rec = pickRecommendation(factors, limiter);
  return { factors, order, positive, limiter, recommendation: rec };
}

function pickRecommendation(
  f: Record<FactorKey, FactorDetail>,
  limiter: FactorDetail | null,
): string {
  if (f.pain.score < 80) return "You flagged pain recently. Sub in a pain-free variation and stay well shy of failure today.";
  if (f.sleep.score < 60) return "Sleep was short. Reduce optional volume, keep top sets at the prescribed RPE, and skip AMRAP finishers.";
  if (f.load.score < 60) return "Training load has spiked. Complete prescribed work and skip unnecessary back-off sets.";
  if (f.recovery.score < 60) return "You're feeling under-recovered. Warm up thoroughly and let the first working set dictate the day.";
  if (!limiter) return "Everything is in a great window. Train as planned and push your top sets if warm-ups feel sharp.";
  return "Train as planned. Stay within today's prescribed RPE and avoid adding unnecessary volume.";
}

export function buildPersonalInsights(
  scores: Array<{ ts: string; score: number }>,
  sleepSamples: SleepSample[],
  completed30d: number,
  scheduled30d: number | null,
): string[] {
  const out: string[] = [];
  const highDays = scores.filter((s) => s.score >= 80).length;
  if (scores.length >= 5 && highDays >= 3) {
    const pct = Math.round((highDays / scores.length) * 100);
    out.push(`💪 You complete ${pct}% of workouts when readiness is above 80%.`);
  }
  if (scores.length >= 9) {
    const recent = scores.slice(-9);
    const first = recent.slice(0, 3).reduce((s, x) => s + x.score, 0) / 3;
    const last = recent.slice(-3).reduce((s, x) => s + x.score, 0) / 3;
    if (last - first >= 5) out.push("📈 Your readiness has improved over the past three weeks.");
    else if (first - last >= 5) out.push("📉 Your readiness has dipped over the past three weeks.");
  }
  if (sleepSamples.length >= 6) {
    const sweet = sleepSamples.filter((s) => s.bucket === "7_8" || s.bucket === "8_9").length;
    const pct = Math.round((sweet / sleepSamples.length) * 100);
    if (pct >= 60) out.push("🏆 Your best sessions usually occur after 7–9 hours of sleep.");
    else if (sleepSamples.filter((s) => s.bucket === "lt5" || s.bucket === "5_6").length >= 3) {
      out.push("⚠️ Short-sleep nights are pulling your readiness down. Protect bedtime this week.");
    }
  }
  if (scheduled30d && scheduled30d > 0) {
    const rate = Math.round((completed30d / scheduled30d) * 100);
    if (rate >= 90) out.push("🔥 You've completed nearly every scheduled workout this month.");
  }
  return out.slice(0, 4);
}
