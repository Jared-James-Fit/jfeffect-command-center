import { supabase } from "@/integrations/supabase/client";

export type { WUnit } from "@/lib/workout-unit-resolution";
export { resolveExerciseUnit, modeUnit } from "@/lib/workout-unit-resolution";
import type { WUnit } from "@/lib/workout-unit-resolution";

const sb = supabase as any;

// Resolution rules live in workout-unit-resolution.ts (pure, tested).

/** Upsert a single client/exercise unit preference. */
export async function saveExerciseUnitPref(
  clientId: string,
  exerciseId: string,
  unit: WUnit,
): Promise<void> {
  await sb
    .from("client_exercise_unit_prefs")
    .upsert({ client_id: clientId, exercise_id: exerciseId, unit }, { onConflict: "client_id,exercise_id" });
}