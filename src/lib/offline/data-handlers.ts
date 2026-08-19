/**
 * Cross-feature offline write handlers. Imported for side effects from
 * `src/routes/__root.tsx` so the durable queue can drain pending non-workout
 * writes (bodyweight, water, supplement ticks, etc.) on app boot — even if
 * the user reloads before reaching the page that originated the write.
 *
 * Handlers reuse the same `workout-offline-queue` storage to keep one queue,
 * one banner, one retry loop. The `handlerKey` is the contract between
 * `enqueueOfflineWrite(...)` callers in feature modules and this file.
 */
import { registerQueueHandler } from "@/lib/workout-offline-queue";
import { supabase } from "@/integrations/supabase/client";

let registered = false;

export function registerOfflineDataHandlers() {
  if (registered) return;
  registered = true;

  // ---- Bodyweight ---------------------------------------------------------
  // Canonical replay uses the same per-user/date RPC as connected saves, so a
  // durable queued insert can be retried safely without creating a duplicate.
  registerQueueHandler("bodyweight_save", async (p: any) => {
    const { error } = await supabase.rpc("save_progress_bodyweight", {
      p_user_id: p.user_id,
      p_weight_value: p.weight_value,
      p_weight_unit: p.weight_unit,
      p_logged_date: p.logged_date,
      p_note: p.note ?? null,
      p_entry_id: null,
    } as never);
    if (error) throw error;
  });

  // ---- Water --------------------------------------------------------------
  registerQueueHandler("water_insert", async (p: any) => {
    const { error } = await supabase.from("progress_water_entries").insert({
      user_id: p.user_id,
      amount_ml: p.amount_ml,
      source: p.source ?? "quick_add",
      note: p.note ?? null,
      created_by: p.created_by,
      ...(p.entry_at ? { entry_at: p.entry_at } : {}),
    } as never);
    if (error) throw error;
  });
}

// Auto-register on module load (idempotent).
registerOfflineDataHandlers();