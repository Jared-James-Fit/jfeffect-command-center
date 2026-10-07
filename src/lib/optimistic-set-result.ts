/**
 * Optimistic set logging: patch the day's cached results the moment a set is
 * saved, so load suggestions (and anything else derived from today's sets)
 * recalculate instantly instead of after the write + refetch round trip.
 * Normalized loads are recomputed exactly like the DB trigger
 * (tg_pl_row_results_sync_units): entered value + unit, lb when unknown.
 */
const LB_PER_KG = 2.2046226218;

export function optimisticNormalizedLoads(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) {
    return { normalized_kg: null, normalized_lb: null, actual_load_kg: null, actual_load_lb: null };
  }
  const v = Number(value);
  const kg = String(unit ?? "lb").toLowerCase() === "kg" ? v : Math.round((v / LB_PER_KG) * 10_000) / 10_000;
  const lb = String(unit ?? "lb").toLowerCase() === "kg" ? Math.round(v * LB_PER_KG * 10_000) / 10_000 : v;
  return { normalized_kg: kg, normalized_lb: lb, actual_load_kg: kg, actual_load_lb: lb };
}

export function applyOptimisticSetResult<T extends Record<string, any>>(
  rows: T[] | undefined,
  payload: Record<string, any>,
  existingId: string | null,
): T[] | undefined {
  if (!Array.isArray(rows)) return rows;
  const patch = {
    ...payload,
    ...optimisticNormalizedLoads(payload.entered_value ?? payload.actual_load, payload.entered_unit ?? payload.actual_load_unit),
  };
  const idx = rows.findIndex((r) =>
    (existingId != null && r.id === existingId) || (r.row_id === payload.row_id && r.set_index === payload.set_index));
  if (idx >= 0) {
    const next = rows.slice();
    next[idx] = { ...rows[idx], ...patch };
    return next;
  }
  return [...rows, { id: `optimistic:${payload.row_id}:${payload.set_index}`, ...patch } as unknown as T];
}
