import { supabase } from "@/integrations/supabase/client";
import type { WeightUnit } from "@/lib/weight-lifted";

/** The signed-in client's unit + whether they've ever chosen it (the setup prompt reads this). */
export const weightUnitSetupKey = (userId: string | null | undefined) => ["weight-unit-setup", userId ?? null] as const;

/**
 * Saves a client's default weight unit (clients.preferred_weight_unit) and
 * stamps weight_unit_confirmed_at, so an explicit "lb" is told apart from the
 * column's lb default and the setup prompt stops asking.
 */
export async function saveWeightUnitChoice(match: { clientId: string } | { userId: string }, unit: WeightUnit): Promise<void> {
  const write = (patch: Record<string, unknown>) => {
    const q = supabase.from("clients").update(patch as never);
    return "clientId" in match ? q.eq("id", match.clientId) : q.eq("user_id", match.userId);
  };
  const { error } = await write({ preferred_weight_unit: unit, weight_unit_confirmed_at: new Date().toISOString() });
  if (!error) return;
  // The app can ship before the column's migration lands; the unit itself must still save.
  if (error.code === "PGRST204" || /weight_unit_confirmed_at/.test(error.message ?? "")) {
    const retry = await write({ preferred_weight_unit: unit });
    if (retry.error) throw retry.error;
    return;
  }
  throw error;
}
