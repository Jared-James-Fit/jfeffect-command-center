import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  client_id: z.string().uuid().nullable().optional(),
  workout_id: z.string().nullable().optional(),
  page_route: z.string().nullable().optional(),
  failed_action: z.string().nullable().optional(),
  connection_status: z.string().nullable().optional(),
  sync_error_message: z.string().nullable().optional(),
  device_info: z.record(z.any()).nullable().optional(),
  attempts: z.number().int().nullable().optional(),
});

/**
 * Report that a workout write has failed to sync after multiple retries.
 * Idempotent within 10 minutes per (client, route, failed_action) so flaky
 * connections don't spam coaches.
 */
export const reportWorkoutSyncStuck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let clientRow: any = null;
    if (data.client_id) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("id, full_name, first_name, assigned_coach_id")
        .eq("id", data.client_id)
        .maybeSingle();
      clientRow = c;
    } else {
      const { data: c } = await supabase
        .from("clients")
        .select("id, full_name, first_name, assigned_coach_id")
        .eq("user_id", userId)
        .maybeSingle();
      clientRow = c;
    }
    const coachId = clientRow?.assigned_coach_id ?? null;

    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("support_alerts")
      .select("id")
      .eq("client_id", clientRow?.id ?? null)
      .eq("error_type", "workout_sync_stuck")
      .eq("page_route", data.page_route ?? "")
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    if (recent?.id) {
      return { ok: true, alertId: recent.id, deduped: true };
    }

    const details = {
      failed_action: data.failed_action ?? null,
      connection_status: data.connection_status ?? null,
      attempts: data.attempts ?? null,
      timestamp: new Date().toISOString(),
    };

    const { data: inserted, error } = await supabaseAdmin
      .from("support_alerts")
      .insert({
        client_id: clientRow?.id ?? null,
        coach_id: coachId,
        workout_id: data.workout_id ?? null,
        page_route: data.page_route ?? null,
        error_type: "workout_sync_stuck",
        error_message: data.sync_error_message ?? null,
        device_info: data.device_info ?? null,
        details,
        status: "open",
        notified_via: ["in_app"],
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, alertId: inserted.id, deduped: false };
  });