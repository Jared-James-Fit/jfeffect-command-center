/**
 * A back-off written as a % of today's top set only means something while the
 * top set it points at (`basis_row_id`) is the same exercise. After a swap of
 * either one (Competition Squat back-offs under a Pause Squat top set, or the
 * back-off itself swapped to a leg press) the % would load one lift from
 * another's set, so the card treats that row as a plain RPE prescription.
 */
type RowLike = {
  id?: string | null;
  percentage_basis?: string | null;
  basis_row_id?: string | null;
  exercise_id?: string | null;
  exercise_name_override?: string | null;
  exercises?: { id?: string | null; name?: string | null } | null;
};

function exerciseKey(r: RowLike): string | null {
  const id = r.exercise_id ?? r.exercises?.id ?? null;
  if (id) return `id:${id}`;
  const name = (r.exercise_name_override ?? r.exercises?.name ?? "").trim().toLowerCase();
  return name ? `name:${name}` : null;
}

export function percentDetached(row: RowLike, rows: readonly RowLike[]): boolean {
  if (row.percentage_basis !== "top_set" && row.percentage_basis !== "prev_set") return false;
  if (!row.basis_row_id) return false;
  const source = rows.find((x) => x.id === row.basis_row_id);
  if (!source) return false;
  const a = exerciseKey(row);
  const b = exerciseKey(source);
  return !!a && !!b && a !== b;
}

/** The row as the card should read it: a detached back-off loses its %. */
export function withLivePercent<T extends RowLike>(row: T, rows: readonly RowLike[]): T {
  return percentDetached(row, rows)
    ? { ...row, percentage: null, percentage_basis: null, basis_row_id: null }
    : row;
}
