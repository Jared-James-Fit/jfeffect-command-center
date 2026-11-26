/**
 * The strength read in words, for every AI that plans or changes training
 * (Generate Next Program's brief, Adjust program, Cleo) and the coach's views,
 * so they all reason from the same kept-apart numbers (pure, tested). Each line
 * names which metric it is; nothing here is a new number.
 */
import { COMP_LIFTS, COMP_LIFT_LABEL } from "@/lib/analytics/competition-strength";
import { LB_PER_KG } from "./rules";
import type { CurrentStrength, LiftIntel, StrengthIntel } from "./profile";
import { notPlannable } from "./planning";

type Unit = "kg" | "lb";
type MaxLike = {
  lift: string;
  one_rm?: number | null;
  training_max?: number | null;
  estimated_1rm?: number | null;
  unit?: string | null;
  block_id?: string | null;
  active?: boolean | null;
};

const fmt = (lb: number, unit: Unit) => {
  const v = unit === "kg" ? Math.round((lb / LB_PER_KG) * 2) / 2 : Math.round(lb);
  return `${v} ${unit}`;
};

function currentWords(c: CurrentStrength, unit: Unit): string {
  const floor = c.state === "floor";
  const basis =
    c.basis.kind === "meet"
      ? `from ${c.basis.name ?? "a meet"} (${c.basis.day}), read as training-day strength`
      : `from ${fmt(c.basis.load, unit)} × ${c.basis.reps}${c.basis.effort != null ? ` @ RPE ${c.basis.effort}` : ""} (${c.basis.day})`;
  return `${floor ? "at least " : ""}${fmt(c.value, unit)}, ${c.word} confidence, ${basis}, last updated ${c.lastUpdate}${floor ? " (only lighter sets so far: a lower bound)" : ""}`;
}

function liftLine(l: LiftIntel, unit: Unit, today: string, maxes: MaxLike[]): string | null {
  if (!l.sessions.length && !l.meets.length) return null;
  const parts: string[] = [];
  if (l.competitionPR) parts.push(`competition PR ${fmt(l.competitionPR.value, unit)} (${l.competitionPR.day})`);
  if (l.trainingPR) parts.push(`best in training ${fmt(l.trainingPR.load, unit)} × ${l.trainingPR.reps} (${l.trainingPR.day})`);
  if (l.peakE1rm) parts.push(`peak estimate ${fmt(l.peakE1rm.value, unit)} (${l.peakE1rm.day})`);
  const why = notPlannable(l.current, today, l.otherStyle?.current?.value ?? null);
  parts.push(
    l.current
      ? `current estimate ${currentWords(l.current, unit)}${why ? ` [not used for % loads: ${why}]` : ""}`
      : "no current estimate",
  );
  const own = maxes.filter(
    (m) => m.active !== false && new RegExp(`\\b${l.lift === "bench" ? "bench" : l.lift === "squat" ? "squat" : "dead\\s*lift"}`, "i").test(m.lift),
  );
  for (const m of own) {
    const u = m.unit === "lb" ? "lb" : "kg";
    const v = [m.training_max ? `TM ${m.training_max} ${u}` : null, m.one_rm ? `1RM ${m.one_rm} ${u}` : null, m.estimated_1rm ? `e1RM ${m.estimated_1rm} ${u}` : null].filter(Boolean);
    if (v.length) parts.push(`coach's reference "${m.lift}"${m.block_id ? " (locked to a block)" : ""}: ${v.join(", ")}`);
  }
  const stance = l.style
    ? ` (${l.style}${l.otherStyle ? `; ${l.otherStyle.style} history kept apart${l.otherStyle.current ? `, ${fmt(l.otherStyle.current.value, unit)}` : ""}` : ""})`
    : "";
  const cal = l.calibration;
  const learned = [
    cal.premiumMeets ? `meets run ${Math.round((cal.premium - 1) * 1000) / 10}% over training (${cal.premiumMeets} meets)` : null,
    cal.repPairs >= 3 && Math.abs(cal.repFactor - 1) >= 0.01 ? `sets of 4+ read ×${cal.repFactor} against their singles (${cal.repPairs} comparisons)` : null,
    cal.backoffRatio != null ? `hard back-offs read ${Math.round((1 - cal.backoffRatio) * 100)}% under the day's top set` : null,
    cal.consistency < 0.9 ? "their RPE ratings scatter more than most (estimates from them count less)" : null,
  ].filter(Boolean);
  return `- ${COMP_LIFT_LABEL[l.lift]}${stance}: ${parts.join("; ")}.${learned.length ? ` Learned: ${learned.join("; ")}.` : ""}`;
}

/** Per lift, the kept-apart numbers and what the engine has learned about this athlete. */
export function strengthText(intel: StrengthIntel, unit: Unit, maxes: MaxLike[] = []): string {
  const lines = COMP_LIFTS.map((lift) => liftLine(intel.lifts[lift], unit, intel.today, maxes)).filter(Boolean) as string[];
  const vars = intel.variations
    .filter((v) => v.current && v.sessions.length >= 2)
    .slice(0, 8)
    .map(
      (v) =>
        `- ${v.name}: own estimate ${fmt(v.current!.value, unit)} (${v.current!.word} confidence)${v.ratio ? `, runs about ${Math.round(v.ratio.value * 100)}% of their competition ${v.family} (${v.ratio.pairs} comparisons)` : ""}`,
    );
  if (!lines.length && !vars.length) return "";
  return [
    ...lines,
    ...(vars.length ? ["Variations (each its own lift):", ...vars] : []),
    STRENGTH_RULES_TEXT,
  ].join("\n");
}

/** What a model must do with these numbers. */
export const STRENGTH_RULES_TEXT =
  "Rules: these are different numbers and never stand in for each other. A % of Est. 1RM reads the current estimate; a % of a competition PR reads the PR; a % of a 1RM or TM reads the coach's reference. A peaked meet is not a training-day max. Where an estimate isn't used for % loads (low confidence, one session, a lower bound only), prescribe by RPE or RIR, never invent a max. A variation never gets a universal ratio to its competition lift; use its own estimate, or a learned ratio only when one is listed.";
