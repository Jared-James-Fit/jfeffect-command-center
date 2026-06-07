import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const deactivateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string().uuid(),
      reason: z.string().max(200).optional(),
      note: z.string().max(2000).optional(),
      disablePortalAccess: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("clients").update({
      status: "Deactivated",
      deactivated_at: new Date().toISOString(),
      deactivated_by: userId,
      deactivation_reason: data.reason ?? null,
      deactivation_note: data.note ?? null,
      portal_access_disabled: data.disablePortalAccess,
    }).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("client_activity_log").insert({
      client_id: data.clientId,
      actor_user_id: userId,
      actor_role: "admin",
      action: "client_deactivated",
      details: { reason: data.reason ?? null, note: data.note ?? null, portal_disabled: data.disablePortalAccess },
    });
    return { ok: true };
  });

export const reactivateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string().uuid(),
      restorePortalAccess: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {
      status: "Active",
      archived: false,
      deactivated_at: null,
      deactivated_by: null,
      deactivation_reason: null,
      deactivation_note: null,
    };
    if (data.restorePortalAccess) patch.portal_access_disabled = false;
    const { error } = await supabaseAdmin.from("clients").update(patch).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("client_activity_log").insert({
      client_id: data.clientId,
      actor_user_id: userId,
      actor_role: "admin",
      action: "client_reactivated",
      details: { restored_portal_access: data.restorePortalAccess },
    });
    return { ok: true };
  });

export const DEACTIVATION_REASONS = [
  "Coaching ended",
  "Payment stopped",
  "Paused coaching",
  "Client requested cancellation",
  "Inactive client",
  "Test client",
  "Other",
] as const;