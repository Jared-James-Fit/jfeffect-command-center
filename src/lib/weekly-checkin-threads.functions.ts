/**
 * Weekly Check-In Thread / Inbox — server functions
 *
 * Provides:
 *  - Client: list threads, read messages, reply, archive from own view
 *  - Coach/Admin: list all client threads, reply, archive
 *
 * Auto-archive: threads older than `auto_archive_days` (default 90) are
 * hidden from client view. Admin/coach history is preserved.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PovInput, isPovRequest, resolvePovClientId } from "@/lib/client-pov.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AUTO_ARCHIVE_DAYS = 90;

/* ─────────────────────────────────────────────────────────── helpers ── */

async function getMyClientId(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
  return data?.id ?? null;
}

async function getMyMemberId(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
  return data?.id ?? null;
}

async function staffRoleOf(supabase: any, userId: string): Promise<"admin" | "coach" | null> {
  // Roles live in user_roles (profiles has no role column).
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  return roles.includes("admin") ? "admin" : roles.includes("coach") ? "coach" : null;
}

async function assertAdminOrCoach(context: any) {
  const { supabase, userId } = context;
  const role = await staffRoleOf(supabase, userId);
  if (!role) throw new Error("Unauthorized: admin or coach role required.");
  return { role };
}

/**
 * The thread as the caller is allowed to see it (RLS: the client or member
 * who owns it, an admin, or the assigned coach), and whether the caller is
 * its owner. Reply/archive write with the service role, so this is the gate.
 */
async function loadThreadForCaller(context: any, threadId: string) {
  const { supabase, userId } = context;
  const { data: thread, error } = await supabase
    .from("weekly_checkin_threads").select("id, client_id, member_id").eq("id", threadId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!thread) throw new Error("Thread not found");
  const [clientId, memberId] = await Promise.all([getMyClientId(supabase, userId), getMyMemberId(supabase, userId)]);
  const isOwner = (!!thread.client_id && thread.client_id === clientId) || (!!thread.member_id && thread.member_id === memberId);
  return { thread, isOwner, staffRole: isOwner ? null : await staffRoleOf(supabase, userId) };
}

/* ─────────────────────────────────────────────────────── create thread ── */

const CreateThreadInput = z.object({
  submissionId: z.string().uuid(),
  initialMessage: z.string().min(1).max(5000),
});

export const createCheckinThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateThreadInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const supabaseAdmin = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

    const clientId = await getMyClientId(supabase, userId);
    const memberId = await getMyMemberId(supabase, userId);
    if (!clientId && !memberId) throw new Error("No client or member account found.");

    const autoArchiveAt = new Date(Date.now() + AUTO_ARCHIVE_DAYS * 86_400_000).toISOString();

    // Check if thread already exists for this submission
    const { data: existing } = await supabaseAdmin
      .from("weekly_checkin_threads")
      .select("id")
      .eq("submission_id", data.submissionId)
      .maybeSingle();

    let threadId = existing?.id;

    if (!threadId) {
      const { data: thread, error } = await supabaseAdmin
        .from("weekly_checkin_threads")
        .insert({
          submission_id: data.submissionId,
          client_id: clientId,
          member_id: memberId,
          auto_archive_at: autoArchiveAt,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      threadId = thread.id;
    }

    // Add the initial message
    const { error: msgError } = await supabaseAdmin
      .from("weekly_checkin_messages")
      .insert({
        thread_id: threadId,
        sender_user_id: userId,
        sender_role: clientId ? "client" : "admin",
        message_text: data.initialMessage,
      });
    if (msgError) throw new Error(msgError.message);

    return { ok: true, threadId };
  });

/* ─────────────────────────────────────────────────────── list threads ── */

export const listMyCheckinThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data: pov, context }) => {
    const { supabase, userId } = context as any;
    // Coach "View as client": the viewed client's threads only.
    const viewing = isPovRequest(userId, pov);
    const clientId = viewing ? await resolvePovClientId(supabase, userId, pov) : await getMyClientId(supabase, userId);
    const memberId = viewing ? null : await getMyMemberId(supabase, userId);
    if (viewing && !clientId) return { threads: [] };

    let query = supabase
      .from("weekly_checkin_threads")
      .select(`
        id, submission_id, created_at, updated_at, client_archived_at, auto_archive_at,
        weekly_checkin_messages(id, sender_role, message_text, created_at, sender_user_id)
      `)
      .is("admin_archived_at", null)
      .is("client_archived_at", null)
      .order("updated_at", { ascending: false });

    if (clientId) query = query.eq("client_id", clientId);
    else if (memberId) query = query.eq("member_id", memberId);
    else throw new Error("No client or member account found.");

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { threads: data ?? [] };
  });

/* ─────────────────────────────────────────────────────── get thread ── */

const GetThreadInput = z.object({ threadId: z.string().uuid() });

export const getCheckinThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GetThreadInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: thread, error } = await supabase
      .from("weekly_checkin_threads")
      .select(`
        id, submission_id, created_at, updated_at,
        weekly_checkin_messages(id, sender_role, message_text, created_at, sender_user_id, client_deleted_at)
      `)
      .eq("id", data.threadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!thread) throw new Error("Thread not found.");
    return { thread };
  });

/* ─────────────────────────────────────────────────────── reply ── */

const ReplyInput = z.object({
  threadId: z.string().uuid(),
  messageText: z.string().min(1).max(5000),
});

export const replyToCheckinThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReplyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const supabaseAdmin = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

    const { isOwner, staffRole } = await loadThreadForCaller(context, data.threadId);
    if (!isOwner && !staffRole) throw new Error("Not allowed");
    const senderRole = isOwner ? "client" : staffRole;

    const { error } = await supabaseAdmin
      .from("weekly_checkin_messages")
      .insert({
        thread_id: data.threadId,
        sender_user_id: userId,
        sender_role: senderRole,
        message_text: data.messageText,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ─────────────────────────────────────────────────────── archive ── */

const ArchiveInput = z.object({
  threadId: z.string().uuid(),
  archiveFor: z.enum(["client", "admin"]),
});

export const archiveCheckinThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ArchiveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { isOwner, staffRole } = await loadThreadForCaller(context, data.threadId);
    if (data.archiveFor === "client" ? !isOwner : !staffRole) throw new Error("Not allowed");
    const supabaseAdmin = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
    const field = data.archiveFor === "client" ? "client_archived_at" : "admin_archived_at";
    const { error } = await supabaseAdmin
      .from("weekly_checkin_threads")
      .update({ [field]: new Date().toISOString() })
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ─────────────────────────────────────────────── admin: list all client threads ── */

const AdminListThreadsInput = z.object({
  clientId: z.string().uuid().optional(),
  includeArchived: z.boolean().default(false),
});

export const adminListCheckinThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AdminListThreadsInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrCoach(context);
    const { supabase } = context as any;

    let query = supabase
      .from("weekly_checkin_threads")
      .select(`
        id, submission_id, client_id, member_id, created_at, updated_at, admin_archived_at,
        clients(full_name, email),
        weekly_checkin_messages(id, sender_role, message_text, created_at)
      `)
      .order("updated_at", { ascending: false });

    if (data.clientId) query = query.eq("client_id", data.clientId);
    if (!data.includeArchived) query = query.is("admin_archived_at", null);

    const { data: threads, error } = await query;
    if (error) throw new Error(error.message);
    return { threads: threads ?? [] };
  });
