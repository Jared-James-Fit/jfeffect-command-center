import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientGoalsSetupSchema } from "@/lib/client-goals/schema";

const clientIdInput = z.object({ clientId: z.string().uuid() });

const saveGoalsSetupInput = z.object({
  clientId: z.string().uuid(),
  patch: clientGoalsSetupSchema.partial().extend({ completed: z.boolean().optional() }),
});

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

async function assertClientOwnerOrCoachOrAdmin(ctx: any, clientId: string) {
  const { data: isOwner } = await ctx.supabase.rpc("is_client_owner", {
    _client_id: clientId,
  });
  if (isOwner) return;
  await assertCoachOrAdmin(ctx, clientId);
}

/** Save a client's Goals & Setup answers after confirming the caller is allowed to edit them. */
export const saveGoalsSetupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => saveGoalsSetupInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertClientOwnerOrCoachOrAdmin(context, data.clientId);

    const { completed, ...patch } = data.patch;
    const body: Record<string, unknown> = {
      client_id: data.clientId,
      ...patch,
    };
    if (completed) body.completed_at = new Date().toISOString();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("client_goals_setup")
      .upsert(body as any, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

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