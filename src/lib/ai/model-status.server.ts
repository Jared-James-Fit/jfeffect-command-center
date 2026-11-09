/**
 * The last live model check, kept for the admin AI panel (app_settings
 * `ai_models_check`, written only by the server).
 */
import type { ModelCheck } from "./model-check.server";

export const MODEL_CHECK_KEY = "ai_models_check";

export async function saveModelCheck(result: ModelCheck): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const value = JSON.stringify(result);
  const { data } = await db.from("app_settings").select("id").eq("key", MODEL_CHECK_KEY).maybeSingle();
  if (data?.id) await db.from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("id", data.id);
  else await db.from("app_settings").insert({ key: MODEL_CHECK_KEY, value });
}
