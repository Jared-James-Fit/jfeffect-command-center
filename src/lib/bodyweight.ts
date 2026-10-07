/**
 * Single read-path for "latest bodyweight" that unions the three legacy/new
 * sources. Writes still go to `progress_bodyweight`.
 *
 * Priority for latest value:
 *   1. Most recent `progress_bodyweight` entry
 *   2. Most recent `progress_metrics.bodyweight` entry
 *   3. `clients.starting_bodyweight` (if present)
 */
import { supabase } from "@/integrations/supabase/client";
import { LB_TO_KG } from "@/lib/water";

export type WeightUnit = "kg" | "lb";

export type BodyweightPoint = {
  id?: string;
  date: string; // YYYY-MM-DD
  value: number;
  unit: WeightUnit;
  note?: string | null;
  source: "progress_bodyweight" | "progress_metrics" | "clients";
};

export const combinedBodyweightQueryKey = (userId: string) =>
  ["combined-bodyweight", userId] as const;

export type CanonicalBodyweightRow = {
  id: string;
  logged_date: string;
  weight_value: number;
  weight_unit: string;
  note: string | null;
};

export type LegacyBodyweightMetricRow = {
  id: string;
  entry_date: string;
  bodyweight: number | null;
  bodyweight_unit: string | null;
  notes: string | null;
};

/**
 * Merges legacy check-in weights with canonical bodyweight rows. A canonical
 * row wins only when both sources contain the same calendar date.
 */
export function mergeBodyweightSeries(
  canonicalRows: CanonicalBodyweightRow[],
  legacyRows: LegacyBodyweightMetricRow[],
): BodyweightPoint[] {
  const byDate = new Map<string, BodyweightPoint>();

  for (const row of legacyRows) {
    if (row.bodyweight == null) continue;
    byDate.set(row.entry_date, {
      id: row.id,
      date: row.entry_date,
      value: Number(row.bodyweight),
      unit: (row.bodyweight_unit as WeightUnit) ?? "lb",
      note: row.notes,
      source: "progress_metrics",
    });
  }

  for (const row of canonicalRows) {
    byDate.set(row.logged_date, {
      id: row.id,
      date: row.logged_date,
      value: Number(row.weight_value),
      unit: (row.weight_unit as WeightUnit) ?? "lb",
      note: row.note,
      source: "progress_bodyweight",
    });
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function toKg(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * LB_TO_KG;
}

export function toLb(value: number, unit: WeightUnit): number {
  return unit === "lb" ? value : value / LB_TO_KG;
}

/** Latest bodyweight in kg, or null if nothing on file. */
export async function getLatestBodyweightKg(userId: string): Promise<number | null> {
  const series = await getCombinedBodyweightSeries(userId, 1);
  if (!series.length) return null;
  const p = series[series.length - 1];
  return toKg(p.value, p.unit);
}

/**
 * Union of all three sources, deduped by (date, source) and sorted ascending.
 * `limit` is an upper bound on each table read (max 200 each).
 */
export async function getCombinedBodyweightSeries(
  userId: string,
  limit = 120,
): Promise<BodyweightPoint[]> {
  const cap = Math.min(200, Math.max(1, limit));

  // Lookup the client row to find client_id for legacy progress_metrics rows.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const [pb, pm] = await Promise.all([
    supabase
      .from("progress_bodyweight")
      .select("id, logged_date, weight_value, weight_unit, note")
      .eq("user_id", userId)
      .order("logged_date", { ascending: false })
      .limit(cap),
    clientRow?.id
      ? supabase
          .from("progress_metrics")
          .select("id, entry_date, bodyweight, bodyweight_unit, notes")
          .eq("client_id", clientRow.id)
          .not("bodyweight", "is", null)
          .order("entry_date", { ascending: false })
          .limit(cap)
      : Promise.resolve({
          data: [] as Array<{ entry_date: string; bodyweight: number; bodyweight_unit: string }>,
        } as never),
  ]);

  return mergeBodyweightSeries(
    (pb.data ?? []) as CanonicalBodyweightRow[],
    (pm as { data: LegacyBodyweightMetricRow[] }).data ?? [],
  );
}

export type BodyweightKgPoint = { date: string; kg: number };

/**
 * A client's bodyweight (kg) for the last `sinceDays`, both sources merged —
 * read by load suggestions to adjust past sets for bodyweight change.
 */
export async function getClientBodyweightKgSeries(clientId: string, sinceDays = 120): Promise<BodyweightKgPoint[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const { data: clientRow } = await supabase.from("clients").select("user_id").eq("id", clientId).maybeSingle();
  const [pb, pm] = await Promise.all([
    clientRow?.user_id
      ? supabase.from("progress_bodyweight").select("id, logged_date, weight_value, weight_unit, note")
          .eq("user_id", clientRow.user_id).gte("logged_date", since).order("logged_date").limit(400)
      : Promise.resolve({ data: [] as CanonicalBodyweightRow[] } as never),
    supabase.from("progress_metrics").select("id, entry_date, bodyweight, bodyweight_unit, notes")
      .eq("client_id", clientId).not("bodyweight", "is", null).gte("entry_date", since).order("entry_date").limit(400),
  ]);
  return mergeBodyweightSeries(
    ((pb as any).data ?? []) as CanonicalBodyweightRow[],
    ((pm as any).data ?? []) as LegacyBodyweightMetricRow[],
  )
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .map((p) => ({ date: p.date, kg: toKg(p.value, p.unit) }));
}

/**
 * Smoothed bodyweight at a moment: the mean of entries in the 7 days up to it
 * (irons out daily water swings), else the latest entry within 30 days, else null.
 */
export function smoothedBodyweightKgAt(series: BodyweightKgPoint[], atMs: number): number | null {
  if (!Number.isFinite(atMs)) return null;
  const DAY = 86_400_000;
  const end = atMs + DAY; // a same-day entry counts
  const inMonth = series.filter((p) => {
    const t = Date.parse(`${p.date}T00:00:00Z`);
    return t < end && t > atMs - 30 * DAY;
  });
  if (!inMonth.length) return null;
  const inWeek = inMonth.filter((p) => Date.parse(`${p.date}T00:00:00Z`) > atMs - 7 * DAY);
  const use = inWeek.length ? inWeek : [inMonth[inMonth.length - 1]];
  return use.reduce((a, p) => a + p.kg, 0) / use.length;
}
