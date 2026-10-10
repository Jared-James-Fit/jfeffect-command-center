import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_PENDING_REQUESTS, clockLabel, isRequestableDate, requestMessageBody, requestTypeLabel, requestWhen,
  type SessionRequest,
} from "@/lib/session-requests";

/**
 * Session requests (see session-requests.ts). Clients never write the table themselves:
 * these functions do, with the service role, after checking who's asking.
 */

function todayIn(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** The caller's own client row (requests are made by the client themselves). */
async function myClient(supabase: any, userId: string) {
  const { data } = await supabase.from("clients").select("id, timezone, archived").eq("user_id", userId).maybeSingle();
  if (!data?.id || data.archived) throw new Error("Only clients can request sessions.");
  return data as { id: string; timezone: string | null };
}

/** Admins, or the client's assigned coach. */
async function assertStaffFor(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: any) => r.role === "admin")) return;
  const { data } = await supabase
    .from("clients").select("id, coaches!clients_assigned_coach_id_fkey(user_id)").eq("id", clientId).maybeSingle();
  if ((data as any)?.coaches?.user_id !== userId) throw new Error("Only the client's coach can answer this request.");
}

async function notify(db: any, event: "session_requested" | "session_request_answered", clientId: string, sourceId: string, actor: string) {
  try {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(db, event, { clientId, sourceId, actorUserId: actor });
  } catch {
    /* push is best-effort; the chat card is the source of truth */
  }
}

const RequestInput = z.object({
  requestType: z.enum(["training", "call", "assessment", "other"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  durationMinutes: z.number().int().min(15).max(240),
  altTimes: z.string().trim().max(300).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const requestSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RequestInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const client = await myClient(supabase, userId);
    if (!isRequestableDate(data.date, todayIn(client.timezone))) throw new Error("Pick a date from today onward.");
    if (data.requestType === "other" && !data.note) throw new Error("Tell your coach what it's for.");

    const db = await admin();
    const { count } = await db
      .from("session_requests").select("id", { count: "exact", head: true })
      .eq("client_id", client.id).eq("status", "pending");
    if ((count ?? 0) >= MAX_PENDING_REQUESTS) {
      throw new Error(`You have ${count} requests waiting already. Your coach will get to them soon.`);
    }

    const { data: row, error } = await db
      .from("session_requests")
      .insert({
        client_id: client.id,
        request_type: data.requestType,
        preferred_date: data.date,
        preferred_time: data.time,
        duration_minutes: data.durationMinutes,
        timezone: client.timezone,
        alt_times: data.altTimes || null,
        note: data.note || null,
        requested_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const req = row as SessionRequest;

    // The card in the coach chat, sent as the client (so it shows as "needs a reply").
    const now = new Date().toISOString();
    const { data: msg } = await db
      .from("messages")
      .insert({
        client_id: client.id,
        sender_id: userId,
        sender_role: "client",
        body: requestMessageBody(req),
        attachments: [{ type: "file", url: "", kind: "session_request", session_request_id: req.id }],
        message_type: "Scheduling",
        is_internal_note: false,
        delivery_status: "sent",
        sent_at: now,
        read_by_client_at: now,
      })
      .select("id")
      .maybeSingle();
    if (msg?.id) await db.from("session_requests").update({ message_id: msg.id }).eq("id", req.id);

    await notify(db, "session_requested", client.id, req.id, userId);
    return { id: req.id };
  });

export const withdrawSessionRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const client = await myClient(supabase, userId);
    const db = await admin();
    const { data: updated, error } = await db
      .from("session_requests")
      .update({ status: "withdrawn", resolved_by: userId, resolved_at: new Date().toISOString() })
      .eq("id", data.requestId).eq("client_id", client.id).eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    return { ok: !!updated?.length };
  });

const AnswerInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), requestId: z.string().uuid(), ptSessionId: z.string().uuid() }),
  z.object({ action: z.literal("decline"), requestId: z.string().uuid(), reason: z.string().trim().max(500).optional() }),
]);

export const answerSessionRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnswerInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const db = await admin();
    const { data: req } = await db.from("session_requests").select("*").eq("id", data.requestId).maybeSingle();
    if (!req) throw new Error("Request not found.");
    await assertStaffFor(supabase, userId, req.client_id);
    if (req.status !== "pending") throw new Error(`This request was already ${req.status}.`);

    let body: string;
    if (data.action === "approve") {
      const { data: s } = await db
        .from("pt_sessions").select("id, client_id, title, session_date, start_time, location")
        .eq("id", data.ptSessionId).maybeSingle();
      if (!s || s.client_id !== req.client_id) throw new Error("That session isn't for this client.");
      const when = `${new Date(`${s.session_date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${clockLabel(s.start_time)}`;
      body = `✅ Booked: ${s.title || requestTypeLabel(req.request_type)} · ${when}${s.location ? ` · ${s.location}` : ""}. It's in your Schedule.`;
    } else {
      body = `Couldn't book ${requestTypeLabel(req.request_type)} for ${requestWhen(req)}.${data.reason ? ` ${data.reason}` : ""} Send a new request with another time that works.`;
    }

    const { data: updated, error } = await db
      .from("session_requests")
      .update({
        status: data.action === "approve" ? "approved" : "declined",
        pt_session_id: data.action === "approve" ? data.ptSessionId : null,
        decline_reason: data.action === "decline" ? data.reason || null : null,
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", req.id).eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("This request was just answered.");

    // Automated scheduling note: never earns an extra "unread message" text.
    const now = new Date().toISOString();
    await db.from("messages").insert({
      client_id: req.client_id,
      sender_id: userId,
      sender_role: "admin",
      body,
      message_type: "Scheduling",
      is_automated: true,
      is_internal_note: false,
      delivery_status: "sent",
      sent_at: now,
    });
    await notify(db, "session_request_answered", req.client_id, req.id, userId);
    return { ok: true };
  });
