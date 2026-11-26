/**
 * Did the decision work? (Nov 25 2026) Each autopilot decision keeps a
 * snapshot of where things stood (`baseline`) and, on its reassessment date,
 * the same read is taken again and judged: worked, partly, didn't, too early
 * or can't tell. Judged on what the decision was for: a calorie or cardio
 * change on the bodyweight trend's pace against what the goal needs and the
 * lower lifts, a training change on the lower lifts and the work getting
 * done, a hold on staying on track. Correlation, never cause: the outcome
 * says what happened after, not that the change did it. Pure and tested
 * (autopilot.test.ts).
 */
import type { Category, Domain } from "@/lib/autopilot/types";

export type OutcomeSnapshot = {
  date: string;
  /** Bodyweight trend, kg a week (negative = losing); null without a usable trend. */
  kgPerWeek: number | null;
  /** What the goal needs, kg a week. */
  requiredKgPerWeek: number | null;
  status: string | null;
  performance: "up" | "steady" | "down" | null;
  adherence: number | null;
};

export type OutcomeVerdict = "worked" | "partly" | "did_not" | "too_early" | "unclear";
export const OUTCOME_LABEL: Record<OutcomeVerdict, string> = {
  worked: "Worked",
  partly: "Partly",
  did_not: "Didn't work",
  too_early: "Too early",
  unclear: "Can't tell",
};

export type Outcome = { verdict: OutcomeVerdict; text: string; checkedOn: string; after: OutcomeSnapshot };

const ON_TRACK = new Set(["on_track", "ahead", "reached"]);

export function judgeOutcome(x: { category: Category; changed: Domain[]; baseline: OutcomeSnapshot | null; now: OutcomeSnapshot }): Outcome {
  const { baseline: b, now } = x;
  const out = (verdict: OutcomeVerdict, text: string): Outcome => ({ verdict, text, checkedOn: now.date, after: now });
  if (!b) return out("unclear", "No baseline was kept with this decision.");
  const days = Math.round((Date.parse(`${now.date}T12:00:00Z`) - Date.parse(`${b.date}T12:00:00Z`)) / 86_400_000);
  if (days < 7) return out("too_early", `Only ${days} days since the decision.`);

  const bodyweight = x.changed.includes("nutrition") || x.changed.includes("cardio");
  if (bodyweight) {
    if (now.kgPerWeek == null || now.requiredKgPerWeek == null) return out("unclear", "Not enough weigh-ins to read the trend since.");
    const gapBefore = b.kgPerWeek != null && b.requiredKgPerWeek != null ? Math.abs(b.kgPerWeek - b.requiredKgPerWeek) : null;
    const gapNow = Math.abs(now.kgPerWeek - now.requiredKgPerWeek);
    const strengthOk = now.performance !== "down" || b.performance === "down";
    if (ON_TRACK.has(String(now.status)) && strengthOk) return out("worked", `On pace now (${now.kgPerWeek.toFixed(2)} kg a week) with the lifts ${now.performance ?? "unread"}.`);
    if (gapBefore != null && gapNow < gapBefore * 0.7) return out("partly", `Closer to the pace the goal needs (${now.kgPerWeek.toFixed(2)} vs ${now.requiredKgPerWeek.toFixed(2)} kg a week)${strengthOk ? "" : ", but the lower lifts dropped"}.`);
    return out("did_not", `Still off pace (${now.kgPerWeek.toFixed(2)} vs ${now.requiredKgPerWeek.toFixed(2)} kg a week needed).`);
  }
  if (x.changed.includes("training")) {
    if (now.performance === "up" || (now.performance === "steady" && b.performance === "down")) return out("worked", `Lower lifts ${now.performance} since the change.`);
    if (now.performance === "steady") return out("partly", "Lower lifts holding, not yet back up.");
    if (now.performance === "down") return out("did_not", "Lower lifts still down on comparable sets.");
    return out("unclear", "No comparable sets since to judge it.");
  }
  // a hold (Maintain / Extend / Investigate with nothing changed): did they stay on track?
  if (x.category === "maintain" || x.category === "extend") {
    if (now.status && ON_TRACK.has(now.status) && now.performance !== "down") return out("worked", "Still on track.");
    if (now.status === "not_enough_data" && now.performance == null) return out("unclear", "Not enough data since.");
    return out("did_not", `Drifted off track (${now.status ?? "no trend"}${now.performance === "down" ? ", lifts down" : ""}).`);
  }
  return out("unclear", "Nothing changed to judge.");
}
