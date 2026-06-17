/**
 * Water-intake domain logic. All values stored in mL (base unit).
 * Display conversion happens in TS. No server roundtrip required —
 * RLS on `progress_water_*` enforces access.
 */
import { supabase } from "@/integrations/supabase/client";

export type WaterTarget = {
  user_id: string;
  suggested_ml: number;
  active_ml: number;
  target_source: "default" | "auto" | "user" | "coach" | "admin";
  mode: "auto" | "custom";
  calc_bodyweight_kg: number | null;
  calc_formula_version: number;
  last_recalculated_at: string | null;
  set_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WaterEntry = {
  id: string;
  user_id: string;
  amount_ml: number;
  entry_at: string;
  entry_date: string;
  source: "quick_add" | "custom" | "check_in" | "admin" | "imported";
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_TARGET_ML = 3000;
export const MIN_AUTO_TARGET_ML = 2000;
export const MAX_AUTO_TARGET_ML = 5000;
export const ML_PER_KG = 35;
export const LB_TO_KG = 0.45359237;
export const FL_OZ_TO_ML = 29.5735;

/** Clamp + round to nearest 100mL. Default 3000 if no input. */
export function suggestTargetMl(bodyweightKg: number | null | undefined): number {
  if (!bodyweightKg || bodyweightKg <= 0) return DEFAULT_TARGET_ML;
  const raw = bodyweightKg * ML_PER_KG;
  const rounded = Math.round(raw / 100) * 100;
  return Math.max(MIN_AUTO_TARGET_ML, Math.min(MAX_AUTO_TARGET_ML, rounded));
}

export function mlToL(ml: number): number {
  return ml / 1000;
}

export function mlToOz(ml: number): number {
  return ml / FL_OZ_TO_ML;
}

export function formatWater(ml: number, unit: "ml" | "L" | "oz" = "L"): string {
  if (unit === "ml") return `${Math.round(ml)} mL`;
  if (unit === "oz") return `${mlToOz(ml).toFixed(1)} oz`;
  return `${mlToL(ml).toFixed(ml % 1000 === 0 ? 1 : 1)} L`;
}

export function todayLocalISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get current water target row, or null if not yet set. */
export async function getWaterTarget(userId: string): Promise<WaterTarget | null> {
  const { data, error } = await supabase
    .from("progress_water_targets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as WaterTarget | null) ?? null;
}

/** Ensure a target row exists. If none, write the default 3.0 L row. */
export async function ensureWaterTarget(userId: string): Promise<WaterTarget> {
  const existing = await getWaterTarget(userId);
  if (existing) return existing;
  const { data, error } = await supabase
    .from("progress_water_targets")
    .upsert(
      {
        user_id: userId,
        suggested_ml: DEFAULT_TARGET_ML,
        active_ml: DEFAULT_TARGET_ML,
        target_source: "default",
        mode: "auto",
      } as never,
      { onConflict: "user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as WaterTarget;
}

/** Persist a custom target (mode='custom'). source = who set it. */
export async function setCustomWaterTarget(args: {
  userId: string;
  activeMl: number;
  source: "user" | "coach" | "admin";
  setByUserId: string;
}): Promise<WaterTarget> {
  const active = Math.max(500, Math.min(8000, Math.round(args.activeMl / 50) * 50));
  const { data, error } = await supabase
    .from("progress_water_targets")
    .upsert(
      {
        user_id: args.userId,
        active_ml: active,
        // suggested stays as the auto value; keep current if present, else use default
        suggested_ml: active,
        target_source: args.source,
        mode: "custom",
        set_by_user_id: args.setByUserId,
      } as never,
      { onConflict: "user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as WaterTarget;
}

/** Switch back to automatic suggestion (will get refreshed when bodyweight changes). */
export async function useAutoWaterTarget(args: {
  userId: string;
  setByUserId: string;
  bodyweightKg: number | null;
}): Promise<WaterTarget> {
  const suggested = suggestTargetMl(args.bodyweightKg);
  const { data, error } = await supabase
    .from("progress_water_targets")
    .upsert(
      {
        user_id: args.userId,
        suggested_ml: suggested,
        active_ml: suggested,
        target_source: args.bodyweightKg ? "auto" : "default",
        mode: "auto",
        calc_bodyweight_kg: args.bodyweightKg,
        last_recalculated_at: new Date().toISOString(),
        set_by_user_id: args.setByUserId,
      } as never,
      { onConflict: "user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as WaterTarget;
}

/** List entries for a single local-date (UTC date matches generated column). */
export async function listWaterForDate(userId: string, dateISO: string): Promise<WaterEntry[]> {
  const { data, error } = await supabase
    .from("progress_water_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("entry_date", dateISO)
    .order("entry_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WaterEntry[];
}

/** Recent history grouped by day, newest first. Limit `days` calendar days. */
export async function listWaterHistory(
  userId: string,
  days = 30,
): Promise<{ date: string; total_ml: number; entries: number }[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("progress_water_entries")
    .select("entry_date, amount_ml")
    .eq("user_id", userId)
    .gte("entry_date", sinceISO)
    .order("entry_date", { ascending: false });
  if (error) throw error;
  const map = new Map<string, { total: number; n: number }>();
  for (const r of (data ?? []) as { entry_date: string; amount_ml: number }[]) {
    const cur = map.get(r.entry_date) ?? { total: 0, n: 0 };
    cur.total += r.amount_ml;
    cur.n += 1;
    map.set(r.entry_date, cur);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, v]) => ({ date, total_ml: v.total, entries: v.n }));
}

export async function addWaterEntry(args: {
  userId: string;
  amountMl: number;
  source?: WaterEntry["source"];
  createdByUserId: string;
  note?: string | null;
  entryAt?: string;
}): Promise<WaterEntry> {
  const amount = Math.max(1, Math.min(5000, Math.round(args.amountMl)));
  const { data, error } = await supabase
    .from("progress_water_entries")
    .insert({
      user_id: args.userId,
      amount_ml: amount,
      source: args.source ?? "quick_add",
      note: args.note ?? null,
      created_by: args.createdByUserId,
      ...(args.entryAt ? { entry_at: args.entryAt } : {}),
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data as WaterEntry;
}

export async function deleteWaterEntry(id: string): Promise<void> {
  const { error } = await supabase.from("progress_water_entries").delete().eq("id", id);
  if (error) throw error;
}

export async function updateWaterEntry(
  id: string,
  patch: Partial<Pick<WaterEntry, "amount_ml" | "entry_at" | "note">>,
): Promise<void> {
  const { error } = await supabase
    .from("progress_water_entries")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

/** Quick-add chip presets. */
export const QUICK_ADD_ML = [250, 500, 750, 1000] as const;

/** Convert oz input → ml. */
export function ozToMl(oz: number): number {
  return Math.round(oz * FL_OZ_TO_ML);
}

/** Convert L input → ml. */
export function lToMl(l: number): number {
  return Math.round(l * 1000);
}

/** Compute today's total + remaining for display. */
export function summarizeToday(entries: WaterEntry[], targetMl: number) {
  const total = entries.reduce((s, e) => s + e.amount_ml, 0);
  const remaining = Math.max(0, targetMl - total);
  const pct = targetMl > 0 ? Math.min(100, Math.round((total / targetMl) * 100)) : 0;
  const reached = total >= targetMl;
  return { total, remaining, pct, reached };
}