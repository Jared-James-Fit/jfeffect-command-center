/**
 * Where they are against the roadmap: their level with the noise taken out
 * (the least-squares line through recent weigh-ins, trajectory.ts) against
 * the planned path today, the rate it takes from here, and where their trend
 * lands on the date. Ahead, on track, behind, insufficient data or needs
 * attention, in plain words with the uncertainty said, never falsely
 * reassuring and never shaming. One weigh-in never moves the status: a
 * morning well off the line is named as water, glycogen, sodium or gut
 * content (and, for those who have one, often the menstrual cycle).
 * Pure.
 */
import type { Assessment } from "@/lib/weight-management/assessment";
import { daysBetween, fmtDay, fmtRate, fmtWeight, round, type WeightUnit } from "@/lib/weight-management/units";
import { expectedAt } from "@/lib/nutrition-roadmap/blocks";
import type { Block, Progress, ProgressStatus, RoadmapPlan, Safety } from "@/lib/nutrition-roadmap/types";

export type ProgressInput = {
  today: string;
  unit: WeightUnit;
  plan: RoadmapPlan;
  assessment: Assessment;
  safety: Safety;
  sex: "M" | "F" | null;
  /** Roadmap check-ins due and not done (self-coached). */
  missedCheckins: number;
};

const currentOf = (blocks: Block[], today: string) => blocks.find((b) => b.start <= today && b.end >= today) ?? null;

export function readProgress(x: ProgressInput): Progress {
  const a = x.assessment;
  const t = a.trajectory;
  const u = x.unit;
  const W = (kg: number) => fmtWeight(Math.abs(kg), u);
  const weighIns14 = t.weighInsLast14;
  const adherence = a.checkins.adherence;
  const reliability = {
    weighIns14,
    adherence,
    label:
      weighIns14 >= 8 && (adherence == null || adherence >= 4)
        ? "Reliable data"
        : weighIns14 >= 4
          ? "Enough to read a trend"
          : "Too few weigh-ins to judge",
  };
  const block = currentOf(x.plan.blocks, x.today);
  const goal = x.plan.goal;
  const weeksToGoal = goal?.date ? round(Math.max(0, daysBetween(x.today, goal.date)) / 7, 1) : null;
  const level = t.current?.kg ?? null;
  const expected = expectedAt(x.plan.blocks, x.today, x.plan.madeOn);
  const deviation = level != null && expected != null ? round(level - expected, 2) : null;
  const trendRate = t.trend ? (t.trend.clear ? t.trend.kgPerWeek : 0) : null;
  const blockTarget = block?.weight?.targetKg ?? null;
  const daysLeft = block ? Math.max(1, daysBetween(x.today, block.end) + 1) : null;
  const requiredKgPerWeek = level != null && blockTarget != null && daysLeft != null && block && block.rate.kgPerWeek !== 0 ? round(((blockTarget - level) / daysLeft) * 7, 3) : null;
  const projected = t.projected ? { date: t.projected.date, kg: t.projected.kg, lowKg: t.projected.lowKg, highKg: t.projected.highKg } : null;
  const base = { deviationKg: deviation, expectedKg: expected != null ? round(expected, 2) : null, currentKg: level, requiredKgPerWeek, currentKgPerWeek: trendRate, projected, reliability, weeksToGoal };

  const make = (status: ProgressStatus, headline: string, detail: string): Progress => ({ status, headline, detail, ...base });

  // health and safety come before any read of the scale
  const refer = x.safety.flags.find((f) => f.severity === "refer");
  if (refer) return make("needs_attention", "A health flag comes first", refer.text);
  const rec = a.recommendation;
  if (rec.limiting === "safety") return make("needs_attention", rec.headline, rec.reasons.slice(-1).join(" "));
  const caution = x.safety.flags.find((f) => f.key === "reds_energy" || f.key === "under_rmr");
  if (caution) return make("needs_attention", "Energy looks too low for their training", caution.text);

  if (!t.latest || t.status === "not_enough_data" || !t.trend || t.stale) {
    const since = t.latest ? ` The last weigh-in was ${fmtDay(t.latest.date, x.today)}.` : "";
    return make("insufficient_data", "Not enough weigh-ins to judge", `The status needs 4+ weigh-ins over 10+ days.${since} No change is made on too little data.`);
  }
  if (x.missedCheckins >= 2) return make("needs_attention", "Check-ins missed", `${x.missedCheckins} check-ins in a row weren't done. The plan holds as it is until there's a fresh one.`);

  const fluct = t.fluctuation
    ? ` The latest weigh-in is ${W(t.fluctuation.deltaKg)} ${t.fluctuation.direction} the trend: water, glycogen, sodium or gut content${x.sex === "F" ? " (the menstrual cycle often moves it too)" : ""}, not fat.`
    : "";
  const adh = adherence == null ? "" : adherence >= 4 ? ` Intake has been consistent (${adherence}/5).` : ` Intake has been inconsistent (${adherence}/5), which comes before any change to the numbers.`;

  if (deviation == null || !block) {
    return make("on_track", "Following the plan", `Trend ${fmtRate(t.trend.kgPerWeek, u)}.${fluct}`);
  }

  // which way is "toward the goal" for this block
  const toward = block.rate.kgPerWeek < 0 ? -1 : block.rate.kgPerWeek > 0 ? 1 : 0;
  const band = Math.max(level! * 0.006, (t.trend.noiseKg || 0.4) * 1.5);
  if (toward === 0) {
    // a hold: around the block's weight
    if (Math.abs(deviation) <= Math.max(band, level! * 0.01)) return make("on_track", "Holding where planned", `Within ${W(Math.max(band, level! * 0.01))} of the planned weight.${fluct}${adh}`);
    const dir = deviation > 0 ? "above" : "below";
    return make("behind", `Drifting ${dir} the planned weight`, `${W(deviation)} ${dir} plan with a trend of ${fmtRate(t.trend.kgPerWeek, u)}.${adh}${fluct}`);
  }

  // lighter than planned while losing (heavier while gaining) is ahead
  const ahead = Math.sign(deviation) === toward;
  const off = Math.abs(deviation) > band;
  // wrong way, clearly: worth a look whatever the band says
  if (t.trend.clear && Math.sign(t.trend.kgPerWeek) === -toward && Math.abs(deviation) > band * 0.5) {
    return make(
      "needs_attention",
      `Moving the wrong way: ${fmtRate(t.trend.kgPerWeek, u)}`,
      `The block plans ${fmtRate(block.rate.kgPerWeek, u)}; the trend over ${t.trend.spanDays} days is ${fmtRate(t.trend.kgPerWeek, u)}.${adh}${fluct}`,
    );
  }
  if (!off) {
    return make("on_track", "On track", `${deviation === 0 ? "Right on" : `${W(deviation)} ${(deviation > 0) === (toward < 0) ? "behind" : "ahead of"}`} the planned path, inside its normal range. No changes needed.${fluct}`);
  }
  if (ahead) {
    const fast = trendRate != null && Math.abs(trendRate) > Math.abs(block.rate.kgPerWeek) * 1.5;
    if (fast && toward > 0) return make("ahead", "Ahead of plan: gaining faster than needed", `${W(deviation)} ahead of the planned path at ${fmtRate(trendRate!, u)}. Faster than planned puts on more fat for the same muscle.${fluct}`);
    return make("ahead", fast ? "Ahead of plan, and moving fast" : "Ahead of plan", `${W(deviation)} ahead of the planned path.${fast ? " Watch training and recovery: faster than planned isn't better if strength drops." : " Training holding means there's no need to change anything."}${fluct}`);
  }
  const catching = requiredKgPerWeek != null && trendRate != null && Math.sign(trendRate) === toward && Math.abs(trendRate) >= Math.abs(requiredKgPerWeek);
  return make(
    "behind",
    `${W(deviation)} behind the planned path`,
    `${catching ? `The trend (${fmtRate(trendRate!, u)}) is fast enough to close it without a change.` : `From here it takes ${fmtRate(requiredKgPerWeek ?? block.rate.kgPerWeek, u)} to reach the block's target; the trend is ${fmtRate(t.trend.kgPerWeek, u)}.`}${adh}${fluct}`,
  );
}
