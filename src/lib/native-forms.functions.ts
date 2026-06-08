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

const ReplaceAssignmentsSchema = z.object({
  formId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).max(5000),
});

const ReplaceClientAssignmentsSchema = z.object({
  clientId: z.string().uuid(),
  formIds: z.array(z.string().uuid()).max(1000),
});

const FormAccessSchema = z.object({
  formId: z.string().uuid(),
  visibility: z.enum(["selected", "all_active_clients"]).optional(),
  autoAssignNewClients: z.boolean().optional(),
});

const FormSchema = z.object({ formId: z.string().uuid() });
const DeleteFormsSchema = z.object({ formIds: z.array(z.string().uuid()).min(1).max(500) });

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
      const coachId = access.coachId;
      if (!coachId) throw new Error("You do not have permission to clear assignments.");
      const { data: coachClients, error: clientsError } = await access.supabaseAdmin
        .from("clients")
        .select("id")
        .eq("assigned_coach_id", coachId)
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

export const replaceNativeFormAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReplaceAssignmentsSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const clientIds = Array.from(new Set(data.clientIds));
      const access = await getAssignmentAccess(context.userId, clientIds);

      if (access.isAdmin) {
        const { error: deleteError } = await access.supabaseAdmin
          .from("nf_assignments")
          .delete()
          .eq("form_id", data.formId);
        if (deleteError) throw new Error(deleteError.message);
      } else {
        const coachId = access.coachId;
        if (!coachId) throw new Error("You do not have permission to save assignments.");
        const { data: coachClients, error: clientsError } = await access.supabaseAdmin
          .from("clients")
          .select("id")
          .eq("assigned_coach_id", coachId)
          .eq("archived", false);
        if (clientsError) throw new Error(clientsError.message);
        const coachClientIds = (coachClients ?? []).map((client: any) => client.id);
        if (coachClientIds.length > 0) {
          const { error: deleteError } = await access.supabaseAdmin
            .from("nf_assignments")
            .delete()
            .eq("form_id", data.formId)
            .in("client_id", coachClientIds);
          if (deleteError) throw new Error(deleteError.message);
        }
      }

      if (clientIds.length > 0) {
        const rows = clientIds.map((clientId) => ({ form_id: data.formId, client_id: clientId }));
        const { error: insertError } = await access.supabaseAdmin
          .from("nf_assignments")
          .upsert(rows, { onConflict: "form_id,client_id" });
        if (insertError) throw new Error(insertError.message);
      }

      return { ok: true, count: clientIds.length, error: null as string | null };
    } catch (error: any) {
      return { ok: false, count: 0, error: error?.message ?? "Assignments could not be saved." };
    }
  });

export const replaceClientNativeFormAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReplaceClientAssignmentsSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const formIds = Array.from(new Set(data.formIds));
      const access = await getAssignmentAccess(context.userId, [data.clientId]);

      const { error: deleteError } = await access.supabaseAdmin
        .from("nf_assignments")
        .delete()
        .eq("client_id", data.clientId);
      if (deleteError) throw new Error(deleteError.message);

      if (formIds.length > 0) {
        const rows = formIds.map((formId) => ({ form_id: formId, client_id: data.clientId }));
        const { error: insertError } = await access.supabaseAdmin
          .from("nf_assignments")
          .upsert(rows, { onConflict: "form_id,client_id" });
        if (insertError) throw new Error(insertError.message);
      }

      return { ok: true, count: formIds.length, error: null as string | null };
    } catch (error: any) {
      return { ok: false, count: 0, error: error?.message ?? "Client form assignments could not be saved." };
    }
  });

export const updateNativeFormAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FormAccessSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: adminRole, error: roleError } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (roleError) throw new Error(roleError.message);
      if (!adminRole) throw new Error("Only admins can change form access settings.");

      const patch: Record<string, unknown> = {};
      if (data.visibility) patch.visibility = data.visibility;
      if (typeof data.autoAssignNewClients === "boolean") {
        patch.auto_assign_new_clients = data.autoAssignNewClients;
      }
      if (Object.keys(patch).length === 0) return { ok: true, error: null as string | null };

      const { error } = await supabaseAdmin.from("nf_forms").update(patch).eq("id", data.formId);
      if (error) throw new Error(error.message);
      return { ok: true, error: null as string | null };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? "Form access settings could not be saved." };
    }
  });

export const deleteNativeForms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteFormsSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: adminRole, error: roleError } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (roleError) throw new Error(roleError.message);
      if (!adminRole) throw new Error("Only admins can delete forms.");

      const formIds = Array.from(new Set(data.formIds));
      const { error } = await supabaseAdmin.from("nf_forms").delete().in("id", formIds);
      if (error) throw new Error(error.message);
      return { ok: true, count: formIds.length, error: null as string | null };
    } catch (error: any) {
      return { ok: false, count: 0, error: error?.message ?? "Forms could not be deleted." };
    }
  });