import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";
import { createMessengerCheckinRequest } from "@/lib/messenger-checkins.functions";
import {
  classifyKind,
  pickUnfilledFormRequests,
  type OutstandingRequest,
} from "@/lib/form-requests";

const WINDOW_DAYS = 120;

async function adminClient(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Admin, or the coach assigned to this client. */
async function canManageClient(sb: any, userId: string, clientId: string): Promise<boolean> {
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin === true) return true;
  const { data: client } = await sb.from("clients").select("assigned_coach_id").eq("id", clientId).maybeSingle();
  if (!client?.assigned_coach_id) return false;
  const { data: coach } = await sb.from("coaches").select("user_id").eq("id", client.assigned_coach_id).maybeSingle();
  return coach?.user_id === userId;
}

async function isStaff(sb: any, userId: string): Promise<boolean> {
  const [{ data: a }, { data: c }] = await Promise.all([
    sb.rpc("has_role", { _user_id: userId, _role: "admin" }),
    sb.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

/**
 * Remove a request message from the client's chat outright (no "deleted"
 * placeholder), keeping a copy in message_deletions — the same behaviour as the
 * admin silent delete.
 */
async function silentDeleteMessage(sb: any, messageId: string, clientId: string, userId: string) {
  const { data: m } = await sb
    .from("messages")
    .select("id, client_id, sender_id, sender_role, body, attachments, created_at")
    .eq("id", messageId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!m) return null;
  await sb.from("message_deletions").insert({
    message_id: m.id,
    chat: "dm",
    client_id: m.client_id,
    sender_id: m.sender_id,
    sender_role: m.sender_role,
    body: m.body,
    attachments: m.attachments,
    original_created_at: m.created_at,
    deleted_by: userId,
  });
  await sb.from("messages").delete().eq("id", m.id);
  return m as {
    id: string;
    body: string | null;
    attachments: any;
    created_at: string;
  };
}

/** Inbox ordering follows what's actually left in the thread. */
async function refreshConversationOrder(sb: any, clientId: string) {
  const { data: last } = await sb
    .from("messages")
    .select("created_at")
    .eq("client_id", clientId)
    .eq("is_internal_note", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.created_at) {
    await sb
      .from("conversation_state")
      .update({ last_message_at: last.created_at, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
  }
}

const itemSchema = z.object({
  source: z.enum(["checkin", "form"]),
  messageId: z.string().uuid(),
  clientId: z.string().uuid(),
  requestId: z.string().min(1),
  formId: z.string().uuid().nullable(),
});
const actionInput = z.object({ items: z.array(itemSchema).min(1).max(200) });

export type RequestActionResult = { done: number; failed: Array<{ clientId: string; reason: string }> };

/** Everything I've sent that the client hasn't filled in (newest request per client + form type). */
export const listOutstandingFormRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutstandingRequest[]> => {
    // Reads go through the caller's own session so a coach only sees their clients.
    const sb = context.supabase as any;
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const [checkinsRes, formMsgsRes] = await Promise.all([
      sb
        .from("messenger_checkins")
        .select("id, client_id, request_message_id, created_at")
        .eq("status", "pending")
        .eq("task_type", "weekly_checkin")
        .not("request_message_id", "is", null)
        .gte("created_at", since)
        .limit(1000),
      sb
        .from("messages")
        .select("id, client_id, created_at, read_by_client_at, attachments")
        .contains("attachments", [{ kind: "form_request" }])
        .is("deleted_at", null)
        .eq("is_internal_note", false)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    if (checkinsRes.error) throw new Error(checkinsRes.error.message);
    if (formMsgsRes.error) throw new Error(formMsgsRes.error.message);

    const checkins: any[] = checkinsRes.data ?? [];
    const unfilled = pickUnfilledFormRequests<any>(formMsgsRes.data ?? [], await loadSubmissions(sb, formMsgsRes.data ?? []));

    const reqMsgIds = checkins.map((c) => c.request_message_id);
    const clientIds = Array.from(new Set([...checkins.map((c) => c.client_id), ...unfilled.map((u) => u.message.client_id)]));
    const formIds = Array.from(new Set(unfilled.map((u) => u.formId)));

    const [msgRes, clientRes, formRes] = await Promise.all([
      reqMsgIds.length
        ? sb.from("messages").select("id, created_at, read_by_client_at, deleted_at").in("id", reqMsgIds)
        : Promise.resolve({ data: [] }),
      clientIds.length ? sb.from("clients").select("id, full_name").in("id", clientIds) : Promise.resolve({ data: [] }),
      formIds.length ? sb.from("nf_forms").select("id, title, kind, external_url").in("id", formIds) : Promise.resolve({ data: [] }),
    ]);
    const msgById = new Map<string, any>((msgRes.data ?? []).map((m: any) => [m.id, m]));
    const nameById = new Map<string, string>((clientRes.data ?? []).map((c: any) => [c.id, c.full_name || "Client"]));
    const formById = new Map<string, any>((formRes.data ?? []).map((f: any) => [f.id, f]));

    const out: OutstandingRequest[] = [];
    for (const c of checkins) {
      const m = msgById.get(c.request_message_id);
      if (!m || m.deleted_at) continue;
      out.push({
        key: `checkin:${c.id}`,
        source: "checkin",
        kind: "weekly_checkin",
        title: "Weekly Check-In",
        clientId: c.client_id,
        clientName: nameById.get(c.client_id) ?? "Client",
        messageId: c.request_message_id,
        requestId: c.id,
        formId: null,
        formKind: null,
        externalUrl: null,
        sentAt: m.created_at ?? c.created_at,
        readAt: m.read_by_client_at ?? null,
      });
    }
    for (const u of unfilled) {
      const f = formById.get(u.formId);
      out.push({
        key: `form:${u.message.id}`,
        source: "form",
        kind: classifyKind("form", u.formId),
        title: f?.title ?? u.title ?? "Form",
        clientId: u.message.client_id,
        clientName: nameById.get(u.message.client_id) ?? "Client",
        messageId: u.message.id,
        requestId: u.formId,
        formId: u.formId,
        formKind: f?.kind === "external" ? "external" : f ? "native" : null,
        externalUrl: f?.external_url ?? null,
        sentAt: u.message.created_at,
        readAt: u.message.read_by_client_at ?? null,
      });
    }
    return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  });

async function loadSubmissions(sb: any, messages: any[]) {
  const clientIds = Array.from(new Set(messages.map((m) => m.client_id)));
  if (!clientIds.length) return [];
  const { data, error } = await sb
    .from("nf_submissions")
    .select("client_id, form_id, submitted_at")
    .in("client_id", clientIds)
    .not("submitted_at", "is", null)
    .limit(10000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Unsend requests: gone from the client's chat and from the to-do list. A copy is kept in message_deletions. */
export const deleteFormRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionInput.parse(d))
  .handler(async ({ data, context }): Promise<RequestActionResult> => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await adminClient();
    const failed: RequestActionResult["failed"] = [];
    let done = 0;
    const touched = new Set<string>();

    for (const it of data.items) {
      try {
        if (!(await canManageClient(sb, context.userId, it.clientId))) throw new Error("No access to this client");
        const removed = await silentDeleteMessage(sb, it.messageId, it.clientId, context.userId);
        if (!removed) throw new Error("Request message not found");

        if (it.source === "checkin") {
          // Unanswered only: a filled check-in is never deleted from here.
          await sb.from("messenger_checkins").delete().eq("id", it.requestId).eq("client_id", it.clientId).eq("status", "pending");
        } else if (it.formId) {
          // The form is no longer outstanding: drop its unfinished draft and, for a
          // one-off assignment, the assignment itself. Submitted answers are untouched.
          await sb.from("nf_submissions").delete().eq("form_id", it.formId).eq("client_id", it.clientId).eq("status", "in_progress");
          await sb.from("nf_assignments").delete().eq("form_id", it.formId).eq("client_id", it.clientId).eq("recurrence", "none");
        }
        touched.add(it.clientId);
        done++;
      } catch (e: any) {
        failed.push({ clientId: it.clientId, reason: String(e?.message ?? e) });
      }
    }
    for (const clientId of touched) await refreshConversationOrder(sb, clientId);
    return { done, failed };
  });

/** Replace each request with a fresh one at the bottom of the chat and notify the client. */
export const resendFormRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionInput.parse(d))
  .handler(async ({ data, context }): Promise<RequestActionResult> => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await adminClient();
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    const failed: RequestActionResult["failed"] = [];
    let done = 0;
    const touched = new Set<string>();

    for (const it of data.items) {
      try {
        if (!(await canManageClient(sb, context.userId, it.clientId))) throw new Error("No access to this client");

        if (it.source === "checkin") {
          const { data: old } = await sb
            .from("messenger_checkins")
            .select("id, occurrence_id, status")
            .eq("id", it.requestId)
            .eq("client_id", it.clientId)
            .maybeSingle();
          if (!old || old.status !== "pending") throw new Error("Already filled in or removed");
          // Free the occurrence link so the new request can take it over; restore on failure.
          if (old.occurrence_id) await sb.from("messenger_checkins").update({ occurrence_id: null }).eq("id", old.id);
          let created: any;
          try {
            created = await createMessengerCheckinRequest(sb, {
              clientId: it.clientId,
              taskType: "weekly_checkin",
              occurrenceId: old.occurrence_id ?? null,
              senderId: context.userId,
            });
          } catch (e) {
            if (old.occurrence_id) await sb.from("messenger_checkins").update({ occurrence_id: old.occurrence_id }).eq("id", old.id);
            throw e;
          }
          await silentDeleteMessage(sb, it.messageId, it.clientId, context.userId);
          await sb.from("messenger_checkins").delete().eq("id", old.id);
          await notifyAppEvent(sb, "checkin_requested", { clientId: it.clientId, sourceId: created.id, actorUserId: context.userId });
        } else {
          const { data: old } = await sb
            .from("messages")
            .select("id, body, attachments, message_type")
            .eq("id", it.messageId)
            .eq("client_id", it.clientId)
            .maybeSingle();
          if (!old) throw new Error("Request message not found");
          const { error } = await sb.from("messages").insert({
            client_id: it.clientId,
            sender_id: context.userId,
            sender_role: "admin",
            body: old.body,
            attachments: old.attachments,
            message_type: old.message_type ?? "Form",
            is_internal_note: false,
            delivery_status: "sent",
            sent_at: new Date().toISOString(),
            read_by_admin_at: new Date().toISOString(),
          });
          if (error) throw new Error(error.message);
          await silentDeleteMessage(sb, it.messageId, it.clientId, context.userId);
          if (it.formId === NUTRITION_REQUEST_FORM_ID) {
            await notifyAppEvent(sb, "nutrition_requested", {
              clientId: it.clientId,
              sourceId: `${it.formId}:${Date.now()}`,
              actorUserId: context.userId,
            });
          }
        }
        touched.add(it.clientId);
        done++;
      } catch (e: any) {
        failed.push({ clientId: it.clientId, reason: String(e?.message ?? e) });
      }
    }
    for (const clientId of touched) await refreshConversationOrder(sb, clientId);
    return { done, failed };
  });
