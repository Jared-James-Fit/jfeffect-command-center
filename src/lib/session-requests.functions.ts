import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_PENDING_REQUESTS, REPLACE_WINDOW_DAYS, clockLabel, isRequestableDate, oneTapApprovable, requestMessageBody,
  requestTypeLabel, requestWhen,
  type SessionRequest,
} from "@/lib/session-requests";
import { DEFAULT_TZ, minutesBetweenHM, wallTimeToUtc } from "@/lib/schedule-time";

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
  /** "Instead of" one of their booked sessions: approving moves it. */
  replacesSessionId: z.string().uuid().nullable().optional(),
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
    let replaces: string | null = null;
    if (data.replacesSessionId) {
      const { data: s } = await db
        .from("pt_sessions").select("id, client_id, status, session_date")
        .eq("id", data.replacesSessionId).maybeSingle();
      const near = !!s && Math.abs(Date.parse(s.session_date) - Date.parse(data.date)) <= REPLACE_WINDOW_DAYS * 86400000;
      if (!s || s.client_id !== client.id || s.status !== "Scheduled" || !near) {
        throw new Error("That session can't be swapped from here. Tap it in your calendar to change its time.");
      }
      replaces = s.id;
    }
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
        replaces_session_id: replaces,
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
  z.object({
    action: z.literal("approve"),
    requestId: z.string().uuid(),
    /** Booked by hand in the booking dialog ("More options"): just link it. */
    ptSessionId: z.string().uuid().optional(),
    /** One tap: move this booked session to the asked-for time (its credit follows). Null = book an extra one. */
    replaceSessionId: z.string().uuid().nullable().optional(),
    /** The start, when the client said "any time". */
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
  z.object({ action: z.literal("decline"), requestId: z.string().uuid(), reason: z.string().trim().max(500).optional() }),
]);

/** "Thu, Oct 29 at 5:30 PM". */
function atLabel(date: string, time: string): string {
  return `${new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${clockLabel(time)}`;
}

function endAfter(startHM: string, minutes: number): string {
  const [h, m] = startHM.split(":").map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) throw new Error("That would run past midnight. Pick an earlier time.");
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function assertUpcoming(date: string, start: string, tz: string) {
  if (wallTimeToUtc(date, start, tz).getTime() <= Date.now()) {
    throw new Error("That time has already passed. Decline it, or book another time from their calendar.");
  }
}

const SESSION_COPY = "title, session_type, custom_type, location, booking_card_id, timezone, visible_to_client, reminders_enabled, client_visible_notes, send_confirmation_email, uses_credit, wants_meet";

/**
 * What an approved request books when it's an extra session: the client's own usual
 * session (their latest one that uses a credit: same type, place and booking type), or
 * the in-app call type for a call. Booked as staff, so the database holds a credit from
 * their package (or puts it on their next one, packageRenewal) like any booking.
 */
async function sessionFromRequest(db: any, req: SessionRequest, client: any, start: string) {
  const tz = req.timezone || client?.timezone || DEFAULT_TZ;
  const end = endAfter(start, req.duration_minutes);
  let base: Record<string, any> | null = null;
  if (req.request_type === "call") {
    const { data: card } = await db
      .from("booking_cards").select("*")
      .eq("is_active", true).in("location_mode", ["video", "phone"])
      .order("show_in_app", { ascending: false }).order("sort_order", { ascending: true })
      .limit(1).maybeSingle();
    base = card
      ? {
          title: card.name, session_type: card.session_type, custom_type: card.custom_type, location: card.location || "Phone / Video",
          booking_card_id: card.id, visible_to_client: card.visible_to_client, reminders_enabled: card.reminders_enabled,
          client_visible_notes: card.client_visible_notes, send_confirmation_email: card.send_confirmation_email,
          uses_credit: card.uses_credit, wants_meet: card.location_mode === "video",
        }
      : { title: "Coaching call", session_type: "Consultation", location: "Phone / Video", uses_credit: false, wants_meet: true };
  } else {
    const { data: last } = await db
      .from("pt_sessions").select(SESSION_COPY)
      .eq("client_id", req.client_id).eq("uses_credit", true)
      .order("session_date", { ascending: false }).order("start_time", { ascending: false })
      .limit(1).maybeSingle();
    if (last) {
      base = { ...last, wants_meet: !!last.wants_meet };
    } else {
      const { data: card } = await db
        .from("booking_cards").select("*")
        .eq("is_active", true).eq("uses_credit", true).eq("location_mode", "in_person")
        .order("sort_order", { ascending: true }).limit(1).maybeSingle();
      base = card
        ? {
            title: card.name, session_type: card.session_type, custom_type: card.custom_type,
            location: client?.default_session_location || card.location || "Iron Image Gym", booking_card_id: card.id,
            visible_to_client: card.visible_to_client, reminders_enabled: card.reminders_enabled,
            client_visible_notes: card.client_visible_notes, send_confirmation_email: card.send_confirmation_email, uses_credit: true,
          }
        : { title: "1:1 Training", session_type: "Personal Training Session", location: client?.default_session_location || "Iron Image Gym", uses_credit: true };
    }
    if (req.request_type === "assessment") {
      base = { ...base, title: "Assessment", session_type: "Assessment Session", custom_type: null, booking_card_id: null, uses_credit: true };
    }
  }
  return { ...base, timezone: tz, start_time: start, end_time: end, session_date: req.preferred_date, client_id: req.client_id, status: "Scheduled" };
}

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
    let sessionId: string | null = null;
    let replaced: string | null = null;
    let outcome: "moved" | "booked" | "linked" | "declined" = "declined";
    if (data.action === "approve" && data.ptSessionId) {
      // Booked in the dialog already.
      const { data: s } = await db
        .from("pt_sessions").select("id, client_id, title, session_date, start_time, location")
        .eq("id", data.ptSessionId).maybeSingle();
      if (!s || s.client_id !== req.client_id) throw new Error("That session isn't for this client.");
      sessionId = s.id;
      outcome = "linked";
      body = `✅ Booked: ${s.title || requestTypeLabel(req.request_type)} · ${atLabel(s.session_date, s.start_time)}${s.location ? ` · ${s.location}` : ""}. It's in your calendar.`;
    } else if (data.action === "approve") {
      const start = (req.preferred_time ? String(req.preferred_time).slice(0, 5) : "") || data.startTime || "";
      if (!start) throw new Error("Pick a time first.");
      const { data: client } = await db
        .from("clients").select("id, timezone, default_session_location").eq("id", req.client_id).maybeSingle();

      if (data.replaceSessionId) {
        const { data: s } = await db
          .from("pt_sessions").select("id, client_id, title, session_type, session_date, start_time, end_time, status, timezone")
          .eq("id", data.replaceSessionId).maybeSingle();
        if (!s || s.client_id !== req.client_id) throw new Error("That session isn't for this client.");
        if (s.status !== "Scheduled") throw new Error("That session isn't booked anymore. Approve it as an extra session instead.");
        const tz = s.timezone || DEFAULT_TZ;
        const len = minutesBetweenHM(String(s.start_time).slice(0, 5), String(s.end_time).slice(0, 5));
        const end = endAfter(start, len > 0 ? len : req.duration_minutes);
        assertUpcoming(req.preferred_date, start, tz);
        // Same row, new time: its credit, Google event and reminders move with it (pt_sessions triggers).
        const { data: moved, error } = await db
          .from("pt_sessions")
          .update({ session_date: req.preferred_date, start_time: start, end_time: end })
          .eq("id", s.id).eq("status", "Scheduled")
          .select("id");
        if (error) throw new Error(error.message);
        if (!moved?.length) throw new Error("That session just changed. Refresh and try again.");
        sessionId = s.id;
        replaced = s.id;
        outcome = "moved";
        body = `✅ Moved: your ${s.title || "session"} from ${atLabel(s.session_date, String(s.start_time))} to ${atLabel(req.preferred_date, start)}. It's in your calendar.`;
      } else {
        if (!oneTapApprovable(req.request_type)) throw new Error("Book this one from More options so you can say what it is.");
        const tz = req.timezone || client?.timezone || DEFAULT_TZ;
        assertUpcoming(req.preferred_date, start, tz);
        // Already booked then (approved twice, or booked by hand): link it, never a second one.
        const { data: same } = await db
          .from("pt_sessions").select("id, title, location")
          .eq("client_id", req.client_id).eq("session_date", req.preferred_date).eq("start_time", start)
          .eq("status", "Scheduled").limit(1).maybeSingle();
        let row = same;
        if (!row) {
          const insert = await sessionFromRequest(db, req as SessionRequest, client, start);
          const { data: created, error } = await db.from("pt_sessions").insert(insert).select("id, title, location").single();
          if (error) throw new Error(error.message);
          row = created;
        }
        sessionId = row.id;
        outcome = same ? "linked" : "booked";
        body = `✅ Booked: ${row.title || requestTypeLabel(req.request_type)} · ${atLabel(req.preferred_date, start)}${row.location ? ` · ${row.location}` : ""}. It's in your calendar.`;
      }
    } else {
      body = `Couldn't book ${requestTypeLabel(req.request_type)} for ${requestWhen(req)}.${data.reason ? ` ${data.reason}` : ""} Send a new request with another time that works.`;
    }

    const { data: updated, error } = await db
      .from("session_requests")
      .update({
        status: data.action === "approve" ? "approved" : "declined",
        pt_session_id: sessionId,
        ...(data.action === "approve" ? { replaces_session_id: replaced } : {}),
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
    return { ok: true, outcome, ptSessionId: sessionId };
  });
