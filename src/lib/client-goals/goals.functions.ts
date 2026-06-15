import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const clientIdInput = z.object({ clientId: z.string().uuid() });

async function assertCoachOrAdmin(ctx: any, clientId: string) {
  // admin or coach role, or assigned coach for this client.
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId, _role: "admin",
  });
  if (isAdmin) return;
  const { data: isCoach } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId, _role: "coach",
  });
  if (isCoach) return;
  const { data: isAssigned } = await ctx.supabase.rpc("is_assigned_coach_for_client", {
    _client_id: clientId,
  });
  if (isAssigned) return;
  throw new Error("Forbidden");
}

/** Mark the client's Goals & Setup as reviewed by the current coach/admin. */
export const markGoalsReviewedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => clientIdInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context, data.clientId);
    const { error } = await context.supabase
      .from("client_goals_setup")
      .update({
        last_reviewed_at: new Date().toISOString(),
        last_reviewed_by: context.userId,
      } as any)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Coach/admin asks the client to update their Goals & Setup. */
export const requestGoalsUpdateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      clientId: z.string().uuid(),
      message: z.string().trim().max(500).optional().nullable(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertCoachOrAdmin(context, data.clientId);
    // Make sure a row exists so the banner condition works in the portal.
    await context.supabase
      .from("client_goals_setup")
      .upsert(
        {
          client_id: data.clientId,
          update_requested_at: new Date().toISOString(),
          update_requested_by: context.userId,
          update_request_message: data.message ?? null,
        } as any,
        { onConflict: "client_id" },
      );
    return { ok: true };
  });

/** Clear the "update requested" flag once the client acknowledges it. */
export const clearGoalsUpdateRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => clientIdInput.parse(data))
  .handler(async ({ data, context }) => {
    // Either the client owner or the coach/admin can clear it.
    const { error } = await context.supabase
      .from("client_goals_setup")
      .update({
        update_requested_at: null,
        update_requested_by: null,
        update_request_message: null,
      } as any)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });