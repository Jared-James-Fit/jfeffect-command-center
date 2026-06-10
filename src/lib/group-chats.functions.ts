import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ---------------- Create group ---------------- */
const CreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  permission_mode: z.enum(["everyone", "admins_only", "read_only"]).default("everyone"),
  member_user_ids: z.array(z.string().uuid()).default([]),
});

export const createGroupChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateGroupSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: group, error } = await supabase
      .from("chat_groups")
      .insert({
        name: data.name,
        description: data.description ?? null,
        permission_mode: data.permission_mode,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Add creator as admin + the selected members
    const memberRows = [
      { group_id: group.id, user_id: userId, role: "admin", added_by: userId },
      ...data.member_user_ids
        .filter((u) => u !== userId)
        .map((u) => ({ group_id: group.id, user_id: u, role: "member" as const, added_by: userId })),
    ];
    const { error: mErr } = await supabase.from("chat_group_members").insert(memberRows);
    if (mErr) throw new Error(mErr.message);

    return { group_id: group.id };
  });

/* ---------------- Manage group ---------------- */
const UpdateGroupSchema = z.object({
  group_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  permission_mode: z.enum(["everyone", "admins_only", "read_only"]).optional(),
  archived: z.boolean().optional(),
});

export const updateGroupChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateGroupSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.permission_mode !== undefined) patch.permission_mode = data.permission_mode;
    if (data.archived !== undefined) patch.archived = data.archived;
    const { error } = await supabase.from("chat_groups").update(patch).eq("id", data.group_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AddMembersSchema = z.object({
  group_id: z.string().uuid(),
  user_ids: z.array(z.string().uuid()).min(1).max(500),
});

export const addGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddMembersSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const rows = data.user_ids.map((u) => ({
      group_id: data.group_id, user_id: u, role: "member" as const, added_by: userId,
    }));
    const { error } = await supabase.from("chat_group_members").upsert(rows, { onConflict: "group_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { added: rows.length };
  });

const RemoveMemberSchema = z.object({
  group_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export const removeGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RemoveMemberSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { error } = await supabase.from("chat_group_members")
      .delete().eq("group_id", data.group_id).eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Mass message ---------------- */
const MassMessageSchema = z.object({
  mode: z.enum(["individual", "group"]),
  body: z.string().trim().min(1).max(4000),
  // mode=individual:
  audience: z.enum(["selected", "all_active_clients", "app_members", "program_only", "custom"]).optional(),
  client_ids: z.array(z.string().uuid()).optional(),
  custom_filter: z.record(z.any()).optional(),
  // mode=group:
  group_id: z.string().uuid().optional(),
});

export const sendMassMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MassMessageSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Verify role (admin or coach)
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    const { data: coachRow } = await supabase
      .from("coaches").select("id").eq("user_id", userId)
      .eq("archived", false).eq("status", "Active").maybeSingle();
    const isCoach = !!coachRow;
    if (!isAdmin && !isCoach) throw new Error("Forbidden");

    if (data.mode === "group") {
      if (!data.group_id) throw new Error("group_id required");
      const { error } = await supabase.from("group_messages").insert({
        group_id: data.group_id,
        sender_id: userId,
        sender_role: isAdmin ? "admin" : "coach",
        body: data.body,
        attachments: [],
      });
      if (error) throw new Error(error.message);
      await supabase.from("chat_groups").update({ updated_at: new Date().toISOString() }).eq("id", data.group_id);
      const { count } = await supabase.from("chat_group_members")
        .select("user_id", { count: "exact", head: true }).eq("group_id", data.group_id);
      await supabase.from("mass_message_log").insert({
        sent_by: userId, mode: "group", group_id: data.group_id,
        audience_summary: "group", body: data.body, recipient_count: count ?? 0,
      });
      return { sent: 1, recipient_count: count ?? 0 };
    }

    // Individual fan-out
    let clientIds: string[] = [];
    const audience = data.audience ?? "selected";
    if (audience === "selected") {
      clientIds = data.client_ids ?? [];
    } else if (audience === "all_active_clients") {
      const { data: cs } = await supabase.from("clients")
        .select("id").eq("archived", false).eq("status", "Active");
      clientIds = (cs ?? []).map((c: any) => c.id);
    } else if (audience === "custom") {
      // Caller resolves their own filter and passes client_ids
      clientIds = data.client_ids ?? [];
    } else if (audience === "app_members" || audience === "program_only") {
      // app_members are not "clients" — they have no client_id. Fan-out can't go into the
      // 1:1 coach chat for them. Skip with a clear error so the UI can surface it.
      throw new Error("Mass 1:1 to app/program members is not supported (they have no coach chat). Send into a group instead.");
    }

    if (clientIds.length === 0) throw new Error("No recipients matched");

    const rows = clientIds.map((cid) => ({
      client_id: cid,
      sender_id: userId,
      sender_role: "admin",
      body: data.body,
      attachments: [],
      message_type: "General",
      is_internal_note: false,
      read_by_admin_at: new Date().toISOString(),
    }));

    // Insert in chunks of 200 to be safe
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase.from("messages").insert(chunk);
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }

    await supabase.from("mass_message_log").insert({
      sent_by: userId, mode: "individual", audience_summary: audience,
      body: data.body, recipient_count: inserted,
    });

    return { sent: inserted, recipient_count: inserted };
  });