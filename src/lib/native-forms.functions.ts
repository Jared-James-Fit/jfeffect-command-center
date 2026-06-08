import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AssignmentSchema = z.object({
  formId: z.string().uuid(),
  clientId: z.string().uuid(),
  assigned: z.boolean(),
});

const BulkAssignmentSchema = z.object({
  formId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).max(1000),
});

const FormSchema = z.object({ formId: z.string().uuid() });

async function getAssignmentAccess(userId: string, clientIds: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: adminRole, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) throw new Error(roleError.message);
  if (adminRole) return { supabaseAdmin, isAdmin: true, coachId: null as string | null };

  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("user_id", userId)
    .eq("archived", false)
    .eq("status", "Active")
    .maybeSingle();
  if (coachError) throw new Error(coachError.message);
  if (!coach) throw new Error("You do not have permission to assign forms.");

  const uniqueClientIds = Array.from(new Set(clientIds));
  if (uniqueClientIds.length > 0) {
    const { data: allowedClients, error: clientsError } = await supabaseAdmin
      .from("clients")
      .select("id")
      .in("id", uniqueClientIds)
      .eq("assigned_coach_id", coach.id)
      .eq("archived", false);
    if (clientsError) throw new Error(clientsError.message);
    if ((allowedClients ?? []).length !== uniqueClientIds.length) {
      throw new Error("You can only assign forms to clients assigned to you.");
    }
  }

  return { supabaseAdmin, isAdmin: false, coachId: coach.id as string };
}

export const setNativeFormAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AssignmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await getAssignmentAccess(context.userId, [data.clientId]);

    if (data.assigned) {
      const { error } = await supabaseAdmin
        .from("nf_assignments")
        .upsert({ form_id: data.formId, client_id: data.clientId }, { onConflict: "form_id,client_id" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("nf_assignments")
        .delete()
        .eq("form_id", data.formId)
        .eq("client_id", data.clientId);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const bulkAssignNativeFormToClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BulkAssignmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.clientIds.length === 0) return { ok: true, count: 0 };
    const { supabaseAdmin } = await getAssignmentAccess(context.userId, data.clientIds);
    const rows = Array.from(new Set(data.clientIds)).map((clientId) => ({ form_id: data.formId, client_id: clientId }));
    const { error } = await supabaseAdmin
      .from("nf_assignments")
      .upsert(rows, { onConflict: "form_id,client_id" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

export const clearNativeFormAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FormSchema.parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAssignmentAccess(context.userId, []);
    let query = access.supabaseAdmin.from("nf_assignments").delete().eq("form_id", data.formId);

    if (!access.isAdmin) {
      const { data: coachClients, error: clientsError } = await access.supabaseAdmin
        .from("clients")
        .select("id")
        .eq("assigned_coach_id", access.coachId)
        .eq("archived", false);
      if (clientsError) throw new Error(clientsError.message);
      const clientIds = (coachClients ?? []).map((client: any) => client.id);
      if (clientIds.length === 0) return { ok: true };
      query = query.in("client_id", clientIds);
    }

    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });