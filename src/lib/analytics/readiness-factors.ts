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
  /** One-sentence dummy-proof explanation of the metric. */
  tooltip: string;
  isMissing?: boolean;
}

const TOOLTIPS: Record<FactorKey, string> = {
  sleep: "Sleep before your recent training sessions.",
  recovery: "Your reported recovery from recent workout reviews.",
  load: "Your recent training stress compared with your normal workload.",
  consistency: "How consistently you've completed your scheduled workouts.",
  performance: "How your lifting performance has changed over recent workouts.",
  pain: "Reported pain or injury affecting training.",
};

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
      tooltip: TOOLTIPS.sleep,
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
    trend, impact, recommendation: rec, tooltip: TOOLTIPS.sleep,
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
      tooltip: TOOLTIPS.recovery,
      isMissing: true,
    };
  }
  const map: Record<number, { s: number; label: string }> = {
    1: { s: 20, label: "Very Poor" },
    2: { s: 40, label: "Poor" },
    3: { s: 60, label: "Average" },
    4: { s: 80, label: "Good" },
    5: { s: 100, label: "Excellent" },
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
    tooltip: TOOLTIPS.recovery,
  };
}

export interface LoadWindow {
  /** Working sets counted in the window. */
  sets: number;
  /** Total tonnage in lb. */
  tonnage: number;
  /** Average RPE across logged sets. null when nothing logged. */
  avgRpe: number | null;
  /** Distinct training days in the window. */
  days: number;
}

function buildLoad(current7: LoadWindow, baseline28: LoadWindow): FactorDetail {
  const hasBaseline = baseline28.sets > 0 || baseline28.tonnage > 0;
  // Normalize baseline to a 7-day rate for a fair compare.
  const baseWeeklySets = hasBaseline ? baseline28.sets / 4 : 0;
  const baseWeeklyTon = hasBaseline ? baseline28.tonnage / 4 : 0;
  const setsDelta = current7.sets - baseWeeklySets;
  const tonDeltaPct =
    baseWeeklyTon > 0 ? Math.round(((current7.tonnage - baseWeeklyTon) / baseWeeklyTon) * 100) : 0;
  const rpeDelta =
    baseline28.avgRpe != null && current7.avgRpe != null
      ? Number((current7.avgRpe - baseline28.avgRpe).toFixed(1))
      : null;

  // Bucket relative to baseline tonnage.
  let label:
    | "Much Lower"
    | "Lower"
    | "Normal"
    | "Slightly Elevated"
    | "High"
    | "Very High";
  let score: number;
  if (!hasBaseline || current7.sets === 0) {
    label = "Normal"; score = 75;
  } else if (tonDeltaPct <= -40) { label = "Much Lower"; score = 70; }
  else if (tonDeltaPct <= -15) { label = "Lower"; score = 82; }
  else if (tonDeltaPct < 10) { label = "Normal"; score = 92; }
  else if (tonDeltaPct < 25) { label = "Slightly Elevated"; score = 80; }
  else if (tonDeltaPct < 45) { label = "High"; score = 62; }
  else { label = "Very High"; score = 45; }

  const trend: FactorDetail["trend"] = !hasBaseline
    ? "Building"
    : Math.abs(tonDeltaPct) < 8
      ? "Stable"
      : tonDeltaPct > 0
        ? "Improving"
        : "Dropping";
  const impact: FactorDetail["impact"] =
    score >= 80 ? "Positive" : score >= 60 ? "Neutral" : "Limiting";

  const contribParts: string[] = [];
  if (hasBaseline) {
    if (Math.abs(setsDelta) >= 3) {
      contribParts.push(`${setsDelta > 0 ? "+" : ""}${Math.round(setsDelta)} working sets`);
    }
    if (Math.abs(tonDeltaPct) >= 5) {
      contribParts.push(`${tonDeltaPct > 0 ? "+" : ""}${tonDeltaPct}% tonnage`);
    }
    if (rpeDelta != null && Math.abs(rpeDelta) >= 0.3) {
      contribParts.push(
        `avg RPE ${baseline28.avgRpe!.toFixed(1)} → ${current7.avgRpe!.toFixed(1)}`,
      );
    }
  }
  const contribLine = contribParts.length ? `Main contributors: ${contribParts.join(", ")}.` : "";

  let rec: string;
  if (!hasBaseline) {
    rec = "Building a baseline of your normal workload. Train as planned.";
  } else if (label === "Very High" || label === "High") {
    rec = `Your workload is ${Math.abs(tonDeltaPct)}% above your normal training volume. Stay within today's prescribed RPE and avoid adding extra back-off sets.`;
  } else if (label === "Slightly Elevated") {
    rec = `Workload is slightly above baseline (+${tonDeltaPct}%). Execute prescribed work — skip optional finishers.`;
  } else if (label === "Much Lower" || label === "Lower") {
    rec = `Your workload is ${Math.abs(tonDeltaPct)}% below your baseline. You appear well recovered — a good day to push prescribed top sets if they move well.`;
  } else {
    rec = "Workload is in your normal range. Train as planned.";
  }
  if (contribLine) rec = `${rec} ${contribLine}`.trim();

  return {
    key: "load",
    label: "Training Load",
    emoji: "📈",
    score,
    status: statusFor(score),
    currentValue: label,
    subtitle: hasBaseline
      ? `${tonDeltaPct >= 0 ? "+" : ""}${tonDeltaPct}% vs your normal`
      : undefined,
    metrics: [
      { label: "Last 7 Days", value: `${current7.sets} sets · ${Math.round(current7.tonnage).toLocaleString()} lb` },
      {
        label: "Baseline (28d)",
        value: hasBaseline
          ? `${Math.round(baseWeeklySets)} sets · ${Math.round(baseWeeklyTon).toLocaleString()} lb / wk`
          : "—",
      },
      {
        label: "Avg RPE",
        value:
          current7.avgRpe != null
            ? `${current7.avgRpe.toFixed(1)}${baseline28.avgRpe != null ? ` (base ${baseline28.avgRpe.toFixed(1)})` : ""}`
            : "—",
      },
      {
        label: "vs Normal",
        value: hasBaseline ? `${tonDeltaPct >= 0 ? "+" : ""}${tonDeltaPct}%` : "—",
      },
    ],
    trend,
    impact,
    recommendation: rec,
    tooltip: TOOLTIPS.load,
  };
}

export interface ConsistencyInput {
  scheduled: number;
  completed: number;
  missed: number;
  rescheduled: number;
  streak: number;
  /** Adherence % over the prior comparable window, for trend. */
  previousAdherence: number | null;
}

function buildConsistency(inp: ConsistencyInput): FactorDetail {
  const { scheduled, completed, missed, rescheduled, streak, previousAdherence } = inp;
  const hasSchedule = scheduled > 0;
  // Adherence: completed vs scheduled. Small penalty for reschedules.
  const raw = hasSchedule ? (completed / scheduled) * 100 : completed > 0 ? 100 : 0;
  const penalty = hasSchedule ? Math.min(8, rescheduled * 1.5) : 0;
  const pct = Math.max(0, Math.min(100, Math.round(raw - penalty)));

  let trend: FactorDetail["trend"] = "Stable";
  if (previousAdherence != null) {
    const diff = pct - previousAdherence;
    trend = Math.abs(diff) < 5 ? "Stable" : diff > 0 ? "Improving" : "Dropping";
  } else if (!hasSchedule) {
    trend = "Building";
  }

  const impact: FactorDetail["impact"] =
    pct >= 85 ? "Positive" : pct >= 65 ? "Neutral" : "Limiting";

  let rec: string;
  if (!hasSchedule) {
    rec = "No scheduled workouts detected yet. Once a program is assigned we'll track adherence here.";
  } else if (pct >= 90) {
    rec = "Excellent adherence. Keep completing scheduled sessions.";
  } else if (pct >= 75) {
    rec = missed > 0
      ? `You have missed ${missed} workout${missed === 1 ? "" : "s"} this window. Lock in the remaining sessions to hold your streak.`
      : "Consistency is solid. Stay on plan this week.";
  } else {
    rec = missed > 0
      ? `You have missed ${missed} workout${missed === 1 ? "" : "s"} recently. Prioritize showing up — even a shorter session beats a skipped one.`
      : "Focus on showing up — even a shorter session beats a skipped one.";
  }

  const metrics: FactorDetail["metrics"] = [
    {
      label: "Completed",
      value: hasSchedule
        ? `${completed} / ${scheduled} workouts`
        : `${completed} workouts`,
    },
    { label: "Adherence", value: hasSchedule ? `${pct}%` : "—" },
    { label: "Current Streak", value: `${streak} workout${streak === 1 ? "" : "s"}` },
    { label: "Missed", value: `${missed}` },
  ];

  return {
    key: "consistency",
    label: "Consistency",
    emoji: "🏋️",
    score: pct,
    status: statusFor(pct),
    currentValue: hasSchedule ? `${pct}%` : `${completed} done`,
    subtitle: hasSchedule ? `${completed} of ${scheduled} scheduled` : undefined,
    metrics,
    trend,
    impact,
    recommendation: rec,
    tooltip: TOOLTIPS.consistency,
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
      tooltip: TOOLTIPS.performance,
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
    tooltip: TOOLTIPS.performance,
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
    tooltip: TOOLTIPS.pain,
  };
}

export interface BreakdownInput {
  sleepSamples: SleepSample[];
  recoverySamples: Array<{ ts: string; rating: number }>;
  load: { current7: LoadWindow; baseline28: LoadWindow };
  consistency: ConsistencyInput;
  scores: number[];
  painDays7d: number;
}

export function buildReadinessBreakdown(inp: BreakdownInput): ReadinessBreakdown {
  const factors: Record<FactorKey, FactorDetail> = {
    sleep: buildSleep(inp.sleepSamples),
    recovery: buildRecoveryFeel(inp.recoverySamples),
    load: buildLoad(inp.load.current7, inp.load.baseline28),
    consistency: buildConsistency(inp.consistency),
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
