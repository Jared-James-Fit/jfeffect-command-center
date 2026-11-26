import { dualLoadText, inputKg, weightNumber } from "@/lib/dual-weight";
import { APPROACHES, APPROACH_LABEL, type ApproachKey, type GoalRow, type Unit } from "./types";
import { scoreAgainst } from "./feasibility";

export function validMeetIncrement(kg: number | null, increment: number): boolean {
  return kg != null && Number.isFinite(kg) && kg > 0 && kg <= 1500 && Number.isFinite(increment) && increment > 0 && Math.abs(kg / increment - Math.round(kg / increment)) < 1e-6;
}
export function nearestMeetTarget(kg: number | null, increment: number): number | null {
  if (kg == null || !Number.isFinite(kg) || kg <= 0 || !Number.isFinite(increment) || increment <= 0) return null;
  const rounded = Number((Math.round(kg / increment) * increment).toFixed(8));
  return validMeetIncrement(rounded, increment) ? rounded : null;
}
export function discussedKg(g: Pick<GoalRow, "client_unit" | "client_value" | "client_value_max">, top = true): number | null {
  const v = top ? g.client_value_max ?? g.client_value : g.client_value;
  return g.client_unit && v != null && Number.isFinite(Number(v)) ? inputKg(Number(v), g.client_unit) : null;
}
export function reviewTarget(g: Pick<GoalRow, "client_unit" | "client_value" | "client_value_max" | "feasibility">, increment: number, mode: "cleo" | "discussed") {
  const f = g.feasibility;
  const option = mode === "cleo" && f?.recommended && f.confidence !== "low" ? f.approaches?.find(a => a.key === f.recommended) : null;
  const kg = nearestMeetTarget(option?.targetKg ?? discussedKg(g), increment);
  return { kg, basis: option ? "Cleo suggested" : "Discussed range", approach: option?.label ?? null, reason: option ? f?.recommendedWhy ?? option.line : null };
}
export function inferredUnitKey(g: Pick<GoalRow, "id" | "version" | "client_unit" | "client_unit_source">): string | null {
  return g.client_unit_source === "inferred" && g.client_unit ? `${g.id}:${g.version}:${g.client_unit}` : null;
}
export function reviewedSourceUnit(g: Pick<GoalRow, "id" | "version" | "client_unit" | "client_unit_source">, confirmed: Record<string, boolean>): Unit | undefined {
  const key = inferredUnitKey(g);
  return key && confirmed[key] ? g.client_unit ?? undefined : undefined;
}

/** Judge the displayed load, never the previously saved goal or the old selected approach. */
export function targetDifficulty(g: Pick<GoalRow, "feasibility" | "client_unit" | "client_value" | "client_value_max">, kg: number | null) {
  const f = g.feasibility;
  const projection = f?.projection;
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return { band: null, label: "No target", summary: "Enter a target", brief: "Enter a valid target to see its difficulty." };
  const options = APPROACHES.map(a => f?.approaches?.find(o => o.key === a.key)?.targetKg);
  if (!projection || !Number.isFinite(projection.expectedKg) || options.some(x => x == null || !Number.isFinite(x)) || options.some((x,i) => i > 0 && Number(x) <= Number(options[i-1]))) {
    return { band: null, label: "Not rated", summary: "Insufficient forecast data", brief: "No usable forecast range yet. Review recent competition-style lifts before judging this target." };
  }
  const anchors = Object.fromEntries(APPROACHES.map((a,i) => [a.key, options[i]])) as Record<ApproachKey, number>;
  const { band } = scoreAgainst(kg, anchors, "up");
  const delta = kg - projection.expectedKg;
  const deltaText = Math.abs(delta) < 0.05 ? "matches the forecast" : `${weightNumber(Math.abs(delta), 1)} kg ${delta > 0 ? "above" : "below"} the ${dualLoadText(projection.expectedKg,"kg")} forecast`;
  const lo = discussedKg(g,false), hi = discussedKg(g);
  const range = lo != null && hi != null ? kg > hi + 0.05 ? "above the discussed range" : kg < lo - 0.05 ? "below the discussed range" : "within the discussed range" : null;
  const advice: Record<ApproachKey,string> = {
    easy:"Leaves the most margin.",
    conservative:"Leaves extra room for meet-day variability.",
    moderate:"Targets roughly expected capacity.",
    high:"Needs better-than-expected meet-day execution.",
    very_aggressive:"Needs a substantially stronger day than projected.",
    extreme:"A reach beyond the normal forecast range.",
  };
  const confidence = f?.confidence === "low" ? "Limited evidence; rating is provisional." : advice[band];
  const summary = (Math.abs(delta) < 0.05 ? "At forecast" : `${dualLoadText(Math.abs(delta), "kg")} ${delta > 0 ? "above" : "below"} forecast`) + (range ? " · " + range.replace("the discussed range", "discussed range") : "") + (f?.confidence === "low" ? " · Low confidence" : "");
  return { band, label: APPROACH_LABEL[band], summary, brief: `${dualLoadText(kg,"kg")} ${deltaText === "matches the forecast" ? deltaText : "is " + deltaText}${range ? " and " + (deltaText === "matches the forecast" ? "is " : "") + range : ""}. ${confidence}` };
}
