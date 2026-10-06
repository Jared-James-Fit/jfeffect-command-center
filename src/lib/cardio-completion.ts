/**
 * Cardio completion persistence.
 *
 * supabase-js resolves with `{ error }` instead of throwing, so a bare
 * `await supabase.from(...).upsert(...)` silently "succeeds" when the write is
 * rejected. These helpers always surface the error and return the saved row so
 * the UI only reports success when the row really exists.
 *
 * Update-then-insert is used rather than `upsert(onConflict)` so saving never
 * depends on the shape of the unique index.
 */

export type CardioCompletionRow = {
  id?: string;
  client_id: string;
  cardio_target_id: string;
  completed_date: string;
  completed: boolean;
  skipped: boolean;
  duration_minutes?: number | null;
  cardio_type?: string | null;
  day_type?: string | null;
  rpe?: number | null;
  distance?: number | null;
  distance_unit?: string | null;
  avg_speed?: number | null;
  incline?: number | null;
  calories?: number | null;
  steps?: number | null;
  avg_heart_rate?: number | null;
  completion_target?: string | null;
  notes?: string | null;
};

/** Metrics a skipped row must not carry over from an earlier log. */
export const CARDIO_EMPTY_METRICS = {
  duration_minutes: null,
  rpe: null,
  distance: null,
  distance_unit: null,
  avg_speed: null,
  incline: null,
  calories: null,
  steps: null,
  avg_heart_rate: null,
  completion_target: null,
  notes: null,
} as const;

const UNIQUE_VIOLATION = "23505";

async function updateExisting(db: any, row: CardioCompletionRow) {
  const { client_id, cardio_target_id, completed_date, ...fields } = row;
  const { data, error } = await db
    .from("cardio_completions")
    .update(fields)
    .eq("client_id", client_id)
    .eq("cardio_target_id", cardio_target_id)
    .eq("completed_date", completed_date)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as CardioCompletionRow | null;
}

export async function saveCardioCompletion(db: any, row: CardioCompletionRow): Promise<CardioCompletionRow> {
  const updated = await updateExisting(db, row);
  if (updated) return updated;

  const { data, error } = await db.from("cardio_completions").insert(row).select().single();
  if (!error) return data as CardioCompletionRow;

  // Lost a race with another tab/device that inserted first: update theirs.
  if (error.code === UNIQUE_VIOLATION) {
    const retried = await updateExisting(db, row);
    if (retried) return retried;
  }
  throw error;
}

export async function deleteCardioCompletion(
  db: any,
  key: { client_id: string; cardio_target_id: string; completed_date: string },
): Promise<void> {
  const { error } = await db
    .from("cardio_completions")
    .delete()
    .eq("client_id", key.client_id)
    .eq("cardio_target_id", key.cardio_target_id)
    .eq("completed_date", key.completed_date);
  if (error) throw error;
}
