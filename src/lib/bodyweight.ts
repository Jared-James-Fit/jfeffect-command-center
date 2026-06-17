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
  date: string; // YYYY-MM-DD
  value: number;
  unit: WeightUnit;
  source: "progress_bodyweight" | "progress_metrics" | "clients";
};

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
      .select("logged_date, weight_value, weight_unit")
      .eq("user_id", userId)
      .order("logged_date", { ascending: false })
      .limit(cap),
    clientRow?.id
      ? supabase
          .from("progress_metrics")
          .select("entry_date, bodyweight, bodyweight_unit")
          .eq("client_id", clientRow.id)
          .not("bodyweight", "is", null)
          .order("entry_date", { ascending: false })
          .limit(cap)
      : Promise.resolve({ data: [] as Array<{ entry_date: string; bodyweight: number; bodyweight_unit: string }> } as never),
  ]);

  const points: BodyweightPoint[] = [];

  for (const r of (pb.data ?? []) as Array<{ logged_date: string; weight_value: number; weight_unit: string }>) {
    points.push({
      date: r.logged_date,
      value: Number(r.weight_value),
      unit: (r.weight_unit as WeightUnit) ?? "lb",
      source: "progress_bodyweight",
    });
  }
  for (const r of ((pm as { data: Array<{ entry_date: string; bodyweight: number | null; bodyweight_unit: string | null }> }).data ?? [])) {
    if (r.bodyweight == null) continue;
    points.push({
      date: r.entry_date,
      value: Number(r.bodyweight),
      unit: ((r.bodyweight_unit as WeightUnit) ?? "lb"),
      source: "progress_metrics",
    });
  }

  // Dedupe — prefer progress_bodyweight on a same-day collision
  const byKey = new Map<string, BodyweightPoint>();
  for (const p of points) {
    const existing = byKey.get(p.date);
    if (!existing || (existing.source !== "progress_bodyweight" && p.source === "progress_bodyweight")) {
      byKey.set(p.date, p);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date));
}