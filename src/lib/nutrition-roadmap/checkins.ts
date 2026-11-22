/**
 * When the athlete should check in, decided by what the plan actually needs
 * to know, never a fixed every-7-days. Passive monitoring (every weigh-in,
 * every logged day) runs all the time and never asks them anything; a
 * check-in is only scheduled when a person's answer would change a decision.
 *
 * Starting points (constants below, refined by the data): a new or uncertain
 * baseline is reassessed about a week after there's enough data to read;
 * stable progress with reliable tracking every 10–14 days; a milestone, a
 * close competition or inconsistent progress every 3–7 days; a health or
 * recovery warning within a couple of days. A coach's own cadence wins over
 * all of it except a health flag. The date and the reason are kept.
 *
 * The questions are short and conditional: everything already on file
 * (weigh-ins, the plan, last answers) is never asked again, and the follow-ups
 * appear only when something needs telling apart: poor adherence, tracking
 * that's off, a normal fluctuation, under-recovery, or a prescription that
 * genuinely needs changing. Pure.
 */
import { addDays, daysBetween, fmtDay } from "@/lib/weight-management/units";
import type { Block, CheckinAsk, CheckinSchedule, Progress, RoadmapPlan, Safety } from "@/lib/nutrition-roadmap/types";

export const CHECKIN_DAYS = {
  baseline: 7,
  stable: 14,
  stableUnsure: 10,
  close: 5,
  eventClose: 3,
  safety: 2,
  /** Never ask twice in this many days. */
  minGap: 3,
};

export type ScheduleInput = {
  today: string;
  plan: RoadmapPlan;
  progress: Progress;
  safety: Safety;
  /** Their last check-in (roadmap check-in, or the weekly check-in for a coached athlete). */
  lastCheckin: string | null;
  /** The first weigh-in on file (the baseline counts from there). */
  firstWeighIn: string | null;
  /** The targets last changed. */
  targetsChangedOn: string | null;
  /** A coach's set cadence, days. */
  everyDays: number | null;
  sex: "M" | "F" | null;
  /** The last time the cycle question was answered. */
  cycleAskedOn: string | null;
  /** A latest weigh-in well off the trend. */
  fluctuation: "above" | "below" | null;
  adherence: number | null;
  lowerLifts: "up" | "steady" | "down" | null;
};

const currentOf = (blocks: Block[], today: string) => blocks.find((b) => b.start <= today && b.end >= today) ?? null;
const DEFICIT: Block["kind"][] = ["fat_loss", "pl_prep", "contest_prep", "recomp"];

export function scheduleCheckin(x: ScheduleInput): CheckinSchedule {
  const block = currentOf(x.plan.blocks, x.today);
  const nextBlock = x.plan.blocks.find((b) => b.start > x.today) ?? null;
  const goalDate = x.plan.goal?.date ?? null;
  const daysToEvent = goalDate && (x.plan.goal?.kind === "weight_class" || x.plan.goal?.kind === "contest_prep") ? daysBetween(x.today, goalDate) : null;
  // a milestone is a new block (or the goal) close by; the two-weekly checkpoints are routine
  const milestoneSoon = (!!nextBlock && daysBetween(x.today, nextBlock.start) <= 14) || (!!goalDate && goalDate >= x.today && daysBetween(x.today, goalDate) <= 14);
  const s = x.progress.status;

  let cadence: number;
  let reason: string;
  let kind: CheckinSchedule["kind"] = "quick";
  const refer = x.safety.flags.find((f) => f.severity === "refer");

  if (refer || s === "needs_attention") {
    cadence = CHECKIN_DAYS.safety;
    reason = refer ? "A health flag: a quick follow-up in 2 days, and a professional's look before the plan goes further." : "Something needs attention: a follow-up in 2 days rather than waiting.";
    kind = refer ? "professional" : "quick";
  } else if (x.everyDays) {
    cadence = x.everyDays;
    reason = `Your coach set check-ins every ${x.everyDays} days.`;
  } else if (s === "insufficient_data" || block?.kind === "baseline") {
    cadence = CHECKIN_DAYS.baseline;
    reason = block?.kind === "baseline" ? "Baseline: a first full look once there's a week of data to read." : "Not enough weigh-ins yet: a week from now, once there's enough to read a trend.";
  } else if (daysToEvent != null && daysToEvent >= 0 && daysToEvent <= 14) {
    cadence = CHECKIN_DAYS.eventClose;
    reason = `Competition in ${daysToEvent} day${daysToEvent === 1 ? "" : "s"}: a quick look every 3 days.`;
  } else if ((daysToEvent != null && daysToEvent <= 28) || s === "behind" || s === "ahead" || milestoneSoon || x.fluctuation) {
    cadence = CHECKIN_DAYS.close;
    reason =
      s === "behind"
        ? "Behind plan: a closer look in 5 days, before anything changes."
        : s === "ahead"
          ? "Ahead of plan: a closer look in 5 days to make sure training is holding."
          : daysToEvent != null && daysToEvent <= 28
            ? `Competition in ${Math.round(daysToEvent / 7)} weeks: every 5 days.`
            : x.fluctuation
              ? "A weigh-in well off the trend: another look in 5 days to see if it settles."
              : `A milestone is close${nextBlock ? ` (${nextBlock.title} starts ${fmtDay(nextBlock.start, x.today)})` : ""}: every 5 days.`;
  } else if (x.progress.reliability.weighIns14 >= 8 && (x.adherence == null || x.adherence >= 4)) {
    cadence = x.adherence == null ? CHECKIN_DAYS.stableUnsure : CHECKIN_DAYS.stable;
    reason = x.adherence == null ? "On track: every 10 days while the data builds up." : "On track with reliable data: every 2 weeks is enough to see real change.";
  } else {
    cadence = CHECKIN_DAYS.stableUnsure;
    reason = "On track: every 10 days.";
  }

  // when: from the last one, never in the past, never twice in a few days (a health flag excepted)
  const firstUsable = x.firstWeighIn ? addDays(x.firstWeighIn, CHECKIN_DAYS.baseline) : addDays(x.today, CHECKIN_DAYS.baseline);
  let on: string;
  if (x.lastCheckin) on = addDays(x.lastCheckin, cadence);
  else if (s === "insufficient_data") on = firstUsable > x.today ? firstUsable : addDays(x.today, cadence);
  else if (refer) on = addDays(x.today, cadence);
  else {
    // the first one on a new roadmap comes sooner, then the cadence takes over
    const first = Math.min(cadence, 7);
    on = addDays(x.today, first);
    if (first < cadence) reason = `First check-in on the roadmap in ${first} days, then ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }
  if (on < x.today) on = x.today;
  if (x.lastCheckin && !refer && daysBetween(x.lastCheckin, on) < CHECKIN_DAYS.minGap) on = addDays(x.lastCheckin, CHECKIN_DAYS.minGap);
  if (refer && daysBetween(x.today, on) > CHECKIN_DAYS.safety) on = addDays(x.today, CHECKIN_DAYS.safety);

  // a full reassessment when one could change the plan
  const changedLong = !x.targetsChangedOn || daysBetween(x.targetsChangedOn, on) >= 14;
  if (kind !== "professional" && changedLong && (s === "behind" || s === "ahead" || (nextBlock && daysBetween(on, nextBlock.start) <= 7) || block?.kind === "baseline")) kind = "full";

  // only what needs telling apart
  const asks: CheckinAsk[] = [];
  if (s === "behind" || s === "needs_attention") {
    if (x.adherence != null && x.adherence < 4) asks.push("barriers");
    else asks.push("tracking");
  }
  if (x.adherence != null && x.adherence < 4 && !asks.includes("barriers")) asks.push("barriers");
  if (x.fluctuation === "above" || (s === "behind" && x.adherence != null && x.adherence >= 4)) asks.push("confounders");
  if (x.sex === "F" && block && DEFICIT.includes(block.kind) && (!x.cycleAskedOn || daysBetween(x.cycleAskedOn, on) >= 28)) asks.push("cycle");
  if (x.lowerLifts === "down") asks.push("training");
  return { on, kind, reason, asks: [...new Set(asks)], cadenceDays: cadence };
}
