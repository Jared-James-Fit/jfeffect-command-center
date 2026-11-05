import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { bodyweightUnitKey } from "@/lib/use-bodyweight-unit";
import type { WeightUnit } from "@/lib/weight-lifted";

/** The signed-in client's unit + whether they've ever chosen it (the setup prompt reads this). */
export const weightUnitSetupKey = (userId: string | null | undefined) => ["weight-unit-setup", userId ?? null] as const;

export type WeightUnitSetupRow = {
  id: string;
  preferred_weight_unit: string | null;
  weight_unit_confirmed_at: string | null;
};

/** The "Pounds or kilograms?" prompt and the member setup wizard read the same row. */
export function weightUnitSetupQuery(userId: string | null | undefined) {
  return {
    queryKey: weightUnitSetupKey(userId),
    queryFn: async (): Promise<WeightUnitSetupRow | null> => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, preferred_weight_unit, weight_unit_confirmed_at")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data as WeightUnitSetupRow | null;
    },
  };
}

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

/**
 * An answer to "Pounds or kilograms?" (the prompt, or the last step of member
 * setup): saves it, lets bodyweight follow when it has no unit of its own yet,
 * and refreshes what reads it (everything, when the unit actually changed).
 */
export async function applyWeightUnitChoice(
  qc: QueryClient,
  userId: string,
  row: Pick<WeightUnitSetupRow, "id" | "preferred_weight_unit">,
  unit: WeightUnit,
): Promise<void> {
  await saveWeightUnitChoice({ clientId: row.id }, unit);
  await supabase
    .from("bodyweight_unit_prefs")
    .upsert({ user_id: userId, unit, updated_at: new Date().toISOString() }, { onConflict: "user_id", ignoreDuplicates: true });
  if (unit !== row.preferred_weight_unit) {
    // Workouts, maxes, analytics and the Crew all read the unit.
    void qc.invalidateQueries();
  } else {
    void qc.invalidateQueries({ queryKey: weightUnitSetupKey(userId) });
    void qc.invalidateQueries({ queryKey: bodyweightUnitKey(userId) });
    void qc.invalidateQueries({ queryKey: ["my-client-account"] });
  }
}
