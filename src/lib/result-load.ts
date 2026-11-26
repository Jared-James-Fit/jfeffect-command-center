/**
 * A logged result's load in LB. Prefers the pre-computed normalized column;
 * falls back to converting whichever raw value + unit was logged. This is
 * what stops kg-logged sets from being summed as lb (or vice versa).
 */
export function resultLoadLb(r: {
  normalized_lb?: number | string | null;
  normalized_kg?: number | string | null;
  entered_value?: number | string | null;
  entered_unit?: string | null;
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
}): number {
  if (r.normalized_lb != null) return Number(r.normalized_lb) || 0;
  if (r.normalized_kg != null) return (Number(r.normalized_kg) || 0) * 2.2046226;
  const n = Number(r.entered_value ?? r.actual_load) || 0;
  return (r.entered_unit ?? r.actual_load_unit ?? "lb") === "kg" ? n * 2.2046226 : n;
}
