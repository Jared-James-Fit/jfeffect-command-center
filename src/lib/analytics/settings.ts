/**
 * Per-client analytics settings.
 *
 * Source of truth: public.client_analytics_settings (1 row per client, created lazily).
 * Coaches and admins can edit; clients can read but not write.
 */
import { supabase } from "@/integrations/supabase/client";
import type { E1RMFormula } from "./e1rm";

export interface MuscleVolumeTarget {
  /** Minimum effective volume (sets/week). */
  mev?: number;
  /** Maximum adaptive volume (sets/week). */
  mav?: number;
  /** Maximum recoverable volume (sets/week). */
  mrv?: number;
}

export interface ClientAnalyticsSettings {
  client_id: string;
  e1rm_formula: E1RMFormula;
  working_set_rpe_min: number;
  muscle_volume_targets: Record<string, MuscleVolumeTarget>;
  share_signals: boolean;
  notes: string | null;
}

export const DEFAULT_ANALYTICS_SETTINGS: Omit<ClientAnalyticsSettings, "client_id"> = {
  e1rm_formula: "epley",
  working_set_rpe_min: 6,
  muscle_volume_targets: {},
  share_signals: false,
  notes: null,
};

/** Read settings for a client; returns defaults if no row exists yet. */
export async function getClientAnalyticsSettings(
  clientId: string,
): Promise<ClientAnalyticsSettings> {
  const { data, error } = await supabase
    .from("client_analytics_settings")
    .select("client_id, e1rm_formula, working_set_rpe_min, muscle_volume_targets, share_signals, notes")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  if (!data) return { client_id: clientId, ...DEFAULT_ANALYTICS_SETTINGS };
  return {
    client_id: data.client_id,
    e1rm_formula: (data.e1rm_formula as E1RMFormula) ?? "epley",
    working_set_rpe_min: Number(data.working_set_rpe_min ?? 6),
    muscle_volume_targets:
      (data.muscle_volume_targets as Record<string, MuscleVolumeTarget>) ?? {},
    share_signals: !!data.share_signals,
    notes: data.notes ?? null,
  };
}

/** Upsert settings; coach/admin only (enforced by RLS). */
export async function upsertClientAnalyticsSettings(
  clientId: string,
  patch: Partial<Omit<ClientAnalyticsSettings, "client_id">>,
): Promise<ClientAnalyticsSettings> {
  const current = await getClientAnalyticsSettings(clientId);
  const next = { ...current, ...patch, client_id: clientId };
  const { data, error } = await supabase
    .from("client_analytics_settings")
    .upsert(
      {
        client_id: clientId,
        e1rm_formula: next.e1rm_formula,
        working_set_rpe_min: next.working_set_rpe_min,
        muscle_volume_targets: next.muscle_volume_targets,
        share_signals: next.share_signals,
        notes: next.notes,
      },
      { onConflict: "client_id" },
    )
    .select("client_id, e1rm_formula, working_set_rpe_min, muscle_volume_targets, share_signals, notes")
    .single();
  if (error) throw error;
  return {
    client_id: data.client_id,
    e1rm_formula: data.e1rm_formula as E1RMFormula,
    working_set_rpe_min: Number(data.working_set_rpe_min),
    muscle_volume_targets:
      (data.muscle_volume_targets as Record<string, MuscleVolumeTarget>) ?? {},
    share_signals: !!data.share_signals,
    notes: data.notes ?? null,
  };
}

/**
 * Classify a per-muscle weekly set count against the client's targets.
 * Returns null when no target exists for that muscle.
 */
export function classifyVolume(
  sets: number,
  target: MuscleVolumeTarget | undefined,
): "below_mev" | "in_range" | "above_mrv" | "near_mrv" | null {
  if (!target) return null;
  const { mev, mav, mrv } = target;
  if (mev != null && sets < mev) return "below_mev";
  if (mrv != null && sets > mrv) return "above_mrv";
  if (mrv != null && mav != null && sets >= mav && sets <= mrv) return "near_mrv";
  return "in_range";
}