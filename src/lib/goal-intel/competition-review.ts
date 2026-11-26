import { inputKg } from "@/lib/dual-weight";
import type { GoalRow, Unit } from "./types";

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
  return { kg, basis: option ? "Cleo suggested" : "Discussed range", reason: option ? f?.recommendedWhy ?? option.line : null };
}
export function inferredUnitKey(g: Pick<GoalRow, "id" | "version" | "client_unit" | "client_unit_source">): string | null {
  return g.client_unit_source === "inferred" && g.client_unit ? `${g.id}:${g.version}:${g.client_unit}` : null;
}
export function reviewedSourceUnit(g: Pick<GoalRow, "id" | "version" | "client_unit" | "client_unit_source">, confirmed: Record<string, boolean>): Unit | undefined {
  const key = inferredUnitKey(g);
  return key && confirmed[key] ? g.client_unit ?? undefined : undefined;
}
