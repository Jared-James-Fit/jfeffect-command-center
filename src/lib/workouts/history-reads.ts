/**
 * The small reads that go with a page of logged sets, by id, never one request
 * over everything: the dates of the scheduled instances the sets were logged
 * in (where a moved workout went, trainedOn), and each exercise card's label,
 * notes and planned sets (what its sets were for, historyRoles). Each is a few
 * `.in()` requests of at most 150 ids, every page read.
 */
import { supabase } from "@/integrations/supabase/client";
import { chunk, fetchAllPages } from "@/lib/supabase-paginate";

const sb = supabase as any;

async function byIds<T>(ids: Iterable<string | null | undefined>, read: (part: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const unique = [...new Set([...ids].filter((x): x is string => !!x))];
  if (!unique.length) return [];
  const parts = await Promise.all(chunk(unique, 150).map((part) => fetchAllPages<T>((from, to) => read(part, from, to))));
  return parts.flat();
}

/** scheduled_workout_id → its date ("2026-09-16"), for the instances given. */
export async function instanceDates(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const rows = await byIds<{ id: string; scheduled_date: string | null }>(ids, (part, from, to) =>
    sb.from("pl_scheduled_workouts").select("id, scheduled_date").in("id", part).order("id").range(from, to));
  const out = new Map<string, string>();
  for (const r of rows) if (r.scheduled_date) out.set(r.id, String(r.scheduled_date).slice(0, 10));
  return out;
}

export type RowMeta = { id: string; sets: number | null; purpose_label: string | null; notes: string | null };

/** pl_exercise_rows id → its planned sets, label and notes (what its sets were for). */
export async function rowMeta(ids: Iterable<string | null | undefined>): Promise<Map<string, RowMeta>> {
  const rows = await byIds<RowMeta>(ids, (part, from, to) =>
    sb.from("pl_exercise_rows").select("id, sets, purpose_label, notes").in("id", part).order("id").range(from, to));
  return new Map(rows.map((r) => [r.id, r]));
}

export type HistoryWarmup = {
  id: string;
  row_id: string;
  scheduled_workout_id: string | null;
  load: number;
  unit: "kg" | "lb";
  reps: number;
  rpe: number | null;
  created_at: string | null;
};

/** The warm-ups logged on these exercise cards (pl_warmup_sets: never working sets). */
export async function warmupsFor(rowIds: Iterable<string | null | undefined>, clientId: string): Promise<HistoryWarmup[]> {
  return byIds<HistoryWarmup>(rowIds, (part, from, to) =>
    sb.from("pl_warmup_sets")
      .select("id, row_id, scheduled_workout_id, load, unit, reps, rpe, created_at")
      .eq("client_id", clientId)
      .in("row_id", part)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to));
}
