/**
 * A write to a meeting that depends on what's already on it (its plan, its
 * live notes, its outcome, its recording): the patch is worked out from the
 * row as it is, and written only if nobody wrote the row since it was read
 * (its `updated_at`, which the table's trigger moves on every write); else the
 * row is read again and the patch worked out again. So two quick taps, a tap
 * during a refresh and Cleo's phrasing landing mid-edit never undo each other.
 */
type Db = any;
type Row = Record<string, any> & { id: string; updated_at: string };

export class MeetingBusy extends Error {
  constructor() {
    super("This meeting is being changed somewhere else. Try again.");
  }
}

export async function writeFresh(
  sb: Db,
  id: string,
  compute: (row: Row) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>,
  opts: { first?: Row | null; tries?: number } = {},
): Promise<{ row: Row; wrote: boolean } | null> {
  let row: Row | null = opts.first ?? null;
  const tries = opts.tries ?? 5;
  for (let t = 0; t < tries; t++) {
    if (!row) {
      const { data, error } = await sb
        .from("coaching_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      row = data as Row;
    }
    const patch = await compute(row);
    if (!patch || !Object.keys(patch).length) return { row, wrote: false };
    const { data: updated, error } = await sb
      .from("coaching_sessions")
      .update(patch)
      .eq("id", id)
      .eq("updated_at", row.updated_at)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (updated) return { row: updated as Row, wrote: true };
    row = null; // someone wrote first: read it again
  }
  throw new MeetingBusy();
}
