import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { wallTimeToUtc } from "@/lib/schedule-time";
import { findConflicts, type BusyItem, type SlotConflict } from "@/lib/session-conflicts";
import { PovInput, canViewClient, isPovRequest, resolvePovClientId } from "@/lib/client-pov.server";
import { ownOrLinkedClient } from "@/lib/linked-client.server";

/**
 * Server functions behind the one Schedule (client) and the calendar quick
 * actions (coach): double-booking checks, Google sync kicks, client change
 * requests, last-minute change texts, and the client's calendar feed link.
 */

type Staff = { isAdmin: boolean; coachId: string | null };

async function requireStaff(supabase: any, userId: string): Promise<Staff> {
  const [{ data: roles }, { data: coach }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle(),
  ]);
  const set = new Set(((roles ?? []) as any[]).map((r) => r.role));
  if (set.has("admin")) return { isAdmin: true, coachId: coach?.id ?? null };
  if (set.has("coach")) return { isAdmin: false, coachId: coach?.id ?? null };
  throw new Error("Only coaches can manage the schedule.");
}

// ---- Double-booking check ----------------------------------------------------

const ConflictInput = z.object({
  timezone: z.string().min(1).max(64),
  slots: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^\d{2}:\d{2}/),
        end: z.string().regex(/^\d{2}:\d{2}/),
      }),
    )
    .min(1)
    .max(60),
  excludeSessionIds: z.array(z.string().uuid()).max(60).optional(),
});

export type ConflictCheckResult = {
  conflicts: SlotConflict[];
  /** False when Google couldn't be checked (not connected or unreachable). */
  googleChecked: boolean;
};

export const checkSessionConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConflictInput.parse(d))
  .handler(async ({ data, context }): Promise<ConflictCheckResult> => {
    const { supabase, userId } = context as any;
    const staff = await requireStaff(supabase, userId);

    const slots = data.slots
      .map((s) => ({
        key: s.key,
        start: wallTimeToUtc(s.date, s.start.slice(0, 5), data.timezone).getTime(),
        end: wallTimeToUtc(s.date, s.end.slice(0, 5), data.timezone).getTime(),
      }))
      .filter((s) => s.end > s.start);
    if (!slots.length) return { conflicts: [], googleChecked: true };
    const minISO = new Date(Math.min(...slots.map((s) => s.start))).toISOString();
    const maxISO = new Date(Math.max(...slots.map((s) => s.end))).toISOString();
    const exclude = new Set(data.excludeSessionIds ?? []);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listGoogleBusy } = await import("@/lib/pt-session-gcal.server");
    const [ptRes, apptRes, google] = await Promise.all([
      // One trainer's floor: every scheduled session counts, whoever the client is.
      supabaseAdmin
        .from("pt_sessions")
        .select("id, title, starts_at, ends_at, client:clients(full_name, assigned_coach_id)")
        .eq("status", "Scheduled")
        .lt("starts_at", maxISO)
        .gt("ends_at", minISO),
      supabaseAdmin
        .from("appointments")
        .select("id, title, appointment_type, starts_at, ends_at, external_name, client:clients(full_name)")
        .eq("status", "Scheduled")
        .lt("starts_at", maxISO)
        .gt("ends_at", minISO),
      listGoogleBusy(staff.coachId, minISO, maxISO),
    ]);

    const busy: BusyItem[] = [];
    for (const p of (ptRes.data ?? []) as any[]) {
      if (exclude.has(p.id)) continue;
      const mine = staff.isAdmin || (staff.coachId && p.client?.assigned_coach_id === staff.coachId);
      busy.push({
        source: "app",
        id: p.id,
        title: mine ? `${p.client?.full_name ?? "Client"} · ${p.title || "Session"}` : "Another session",
        start: new Date(p.starts_at).getTime(),
        end: new Date(p.ends_at).getTime(),
      });
    }
    for (const a of (apptRes.data ?? []) as any[]) {
      busy.push({
        source: "app",
        id: a.id,
        title: `${a.client?.full_name ?? a.external_name ?? "Call"} · ${a.title || a.appointment_type || "Appointment"}`,
        start: new Date(a.starts_at).getTime(),
        end: new Date(a.ends_at).getTime(),
      });
    }
    busy.push(...google.items);
    return { conflicts: findConflicts(slots, busy), googleChecked: google.checked };
  });

// ---- Google sync -------------------------------------------------------------

/** Push just-saved sessions to Google now instead of waiting for the 5-minute tick. */
export const kickScheduleSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await requireStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncPtSessionsToGoogle } = await import("@/lib/pt-session-gcal.server");
    return await syncPtSessionsToGoogle(supabaseAdmin as any, 16);
  });

/** Sync health for the Google Calendar settings card. */
export const getScheduleSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await requireStaff(supabase, userId);
    const { supabaseAdmin: typedAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = typedAdmin as any; // generated types predate the sync columns
    const nowISO = new Date().toISOString();
    const [synced, waiting, failing, last] = await Promise.all([
      supabaseAdmin.from("pt_sessions").select("id", { count: "exact", head: true }).not("google_event_id", "is", null).gt("ends_at", nowISO),
      supabaseAdmin.from("pt_sessions").select("id", { count: "exact", head: true }).eq("gcal_dirty", true).lt("gcal_attempts", 5),
      supabaseAdmin.from("pt_sessions").select("id, gcal_error").eq("gcal_dirty", true).gte("gcal_attempts", 5).limit(5),
      supabaseAdmin.from("pt_sessions").select("gcal_synced_at").not("gcal_synced_at", "is", null).order("gcal_synced_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      upcomingSynced: synced.count ?? 0,
      waiting: waiting.count ?? 0,
      failing: ((failing.data ?? []) as any[]).map((r) => r.gcal_error as string | null),
      lastSyncedAt: ((last.data as any)?.gcal_synced_at as string | null) ?? null,
    };
  });

/** Retry sessions that stopped syncing after repeated errors. */
export const retryFailedScheduleSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await requireStaff(supabase, userId);
    const { supabaseAdmin: typedAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = typedAdmin as any; // generated types predate the sync columns
    await supabaseAdmin.from("pt_sessions").update({ gcal_attempts: 0 }).eq("gcal_dirty", true).gte("gcal_attempts", 5);
    const { syncPtSessionsToGoogle } = await import("@/lib/pt-session-gcal.server");
    return await syncPtSessionsToGoogle(supabaseAdmin as any, 16);
  });

// ---- Last-minute change text -------------------------------------------------

export const textClientSessionChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        kind: z.enum(["moved", "cancelled"]),
        previousStartsAt: z.string().datetime({ offset: true }).nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await requireStaff(supabase, userId);
    // RLS: the caller must be able to see this session (admin, or its client's coach).
    const { data: visible } = await supabase.from("pt_sessions").select("id").eq("id", data.sessionId).maybeSingle();
    if (!visible) throw new Error("Session not found or not permitted.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { textSessionChange } = await import("@/lib/pt-session-reminders.server");
    return await textSessionChange(supabaseAdmin as any, data.sessionId, data.kind, new Date(), data.previousStartsAt ?? null);
  });

// ---- Client change requests --------------------------------------------------

async function myClientId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
  if (!data?.id) throw new Error("Only clients can request schedule changes.");
  return data.id as string;
}

export const requestSessionChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        kind: z.enum(["move", "cancel"]),
        preferredTimes: z.string().trim().max(300).optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await myClientId(supabase, userId);
    // RLS returns only this client's own, visible sessions.
    const { data: s } = await supabase
      .from("pt_sessions")
      .select("id, client_id, status, starts_at")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!s || s.client_id !== clientId) throw new Error("Session not found.");
    if (s.status !== "Scheduled") throw new Error("This session can't be changed anymore.");
    if (new Date(s.starts_at).getTime() <= Date.now()) throw new Error("This session has already started.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("pt_session_change_requests" as any)
      .select("id")
      .eq("pt_session_id", s.id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) return { requestId: (existing as any).id as string, alreadyPending: true };

    const { data: created, error } = await supabaseAdmin
      .from("pt_session_change_requests" as any)
      .insert({
        pt_session_id: s.id,
        client_id: clientId,
        kind: data.kind,
        preferred_times: data.preferredTimes || null,
        note: data.note || null,
        requested_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { requestId: (created as any).id as string, alreadyPending: false };
  });

export const withdrawSessionChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ requestId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await myClientId(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("pt_session_change_requests" as any)
      .update({ status: "withdrawn", resolved_at: new Date().toISOString(), resolved_by: userId, resolution: "withdrawn" })
      .eq("id", data.requestId)
      .eq("client_id", clientId)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    return { ok: !!updated?.length };
  });

// ---- Client calendar feed ----------------------------------------------------

function feedUrls(token: string) {
  const origin = (process.env.PUBLIC_APP_URL || process.env.SITE_URL || "https://jfeffect.com").replace(/\/$/, "");
  // Ends in .ics because some calendar apps refuse a link that doesn't; the
  // feed route strips it before the token check.
  const https = `${origin}/api/public/calendar-feed?t=${token}.ics`;
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  const name = encodeURIComponent("JF Effect");
  return {
    httpsUrl: https,
    webcalUrl: webcal,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    // Outlook subscribes from the web: outlook.com accounts, and work / school (Microsoft 365).
    outlookUrl: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${name}`,
    office365Url: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${name}`,
  };
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The subscribe link for your own client calendar. A staff login the owner
 * linked to its person's client account (linked-client.server.ts) gets that
 * account's link, so the same sessions land in their Google Calendar.
 */
export const getMyCalendarFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reset: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const mine = await ownOrLinkedClient(userId);
    if (!mine) throw new Error("Only clients can sync a calendar.");
    const clientId = mine.id;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("clients").select("calendar_feed_token").eq("id", clientId).maybeSingle();
    let token = (c as any)?.calendar_feed_token as string | null;
    if (!token || data.reset) {
      token = newToken();
      const { error } = await supabaseAdmin.from("clients").update({ calendar_feed_token: token } as any).eq("id", clientId);
      if (error) throw new Error(error.message);
    }
    return feedUrls(token);
  });

/**
 * Is this client's phone calendar subscribed? Read-only and POV-aware, so a
 * coach viewing as the client sees the same green check the client sees.
 */
export const getMyCalendarSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = (await resolvePovClientId(supabase, userId, data))
      ?? (isPovRequest(userId, data) ? null : (await ownOrLinkedClient(userId))?.id ?? null);
    if (!clientId) return { isClient: false, lastFetchAt: null as string | null, app: null as string | null, google: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientGoogleStatus } = await import("@/lib/client-gcal.server");
    const [{ data: row }, google] = await Promise.all([
      (supabaseAdmin as any).from("client_calendar_sync").select("last_fetch_at, app").eq("client_id", clientId).maybeSingle(),
      clientGoogleStatus(supabaseAdmin as any, clientId).catch(() => null),
    ]);
    return {
      isClient: true,
      lastFetchAt: (row?.last_fetch_at as string | null) ?? null,
      app: (row?.app as string | null) ?? null,
      google,
    };
  });

/**
 * Connect Google Calendar, step 1: the Google sign-in address for the
 * signed-in client (or the staff login linked to their client account).
 * Google comes back to /api/public/google/oauth/callback.
 */
export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ returnTo: z.string().max(300).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const mine = await ownOrLinkedClient(userId);
    if (!mine) throw new Error("Only clients can connect a calendar.");
    const { clientGoogleReady, clientAuthorizeUrl, oauthOrigin } = await import("@/lib/client-gcal.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Never send anyone to Google's error page: only start when Google has
    // accepted the app's keys (a broken setup alerts the admin instead).
    if (!(await clientGoogleReady(supabaseAdmin as any))) {
      throw new Error("Google sign-in isn't available right now. Use Apple Calendar or copy the link for now.");
    }
    const { signOAuthState } = await import("@/lib/google-cal.server");
    const { safeReturnPath } = await import("@/lib/client-gcal");
    const state = signOAuthState({ kind: "client_cal", client_id: mine.id, user_id: userId, ret: safeReturnPath(data.returnTo) });
    return { url: await clientAuthorizeUrl(oauthOrigin(), state) };
  });

/** Disconnect Google Calendar: removes the JF Effect calendar from their Google account. */
export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const mine = await ownOrLinkedClient(userId);
    if (!mine) throw new Error("Only clients can connect a calendar.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { disconnectClientCalendar } = await import("@/lib/client-gcal.server");
    return disconnectClientCalendar(supabaseAdmin as any, mine.id);
  });

/**
 * Whose calendar a staff home shows: the signed-in person's own client
 * account, or the one the owner linked their staff login to. The owner,
 * previewing a team member, asks for that member's.
 */
export const getMyClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid().nullish() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let target = userId as string;
    if (data.userId && data.userId !== userId) {
      const { data: isAdmin } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      if (!isAdmin) throw new Error("Forbidden");
      target = data.userId;
    }
    return ownOrLinkedClient(target);
  });

// ---- Staff view of a client's calendar sync ---------------------------------

/** One client's sync status for the admin profile. Never returns tokens. */
export const getClientCalendarSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await canViewClient(supabase, userId, data.clientId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientGoogleStatus } = await import("@/lib/client-gcal.server");
    const [google, { data: feed }, { data: c }] = await Promise.all([
      clientGoogleStatus(supabaseAdmin as any, data.clientId).catch(() => null),
      (supabaseAdmin as any).from("client_calendar_sync").select("app, last_fetch_at, fetch_count").eq("client_id", data.clientId).maybeSingle(),
      supabaseAdmin.from("clients").select("calendar_feed_token").eq("id", data.clientId).maybeSingle(),
    ]);
    return {
      google,
      feed: feed
        ? { app: (feed.app as string | null) ?? null, lastFetchAt: (feed.last_fetch_at as string | null) ?? null, fetchCount: Number(feed.fetch_count ?? 0) }
        : null,
      hasFeedToken: !!(c as any)?.calendar_feed_token,
    };
  });

/** Staff-only: the client's existing feed link (never mints a new one). */
export const getClientFeedLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (!(await canViewClient(supabase, userId, data.clientId))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("clients").select("calendar_feed_token").eq("id", data.clientId).maybeSingle();
    const token = (c as any)?.calendar_feed_token as string | null;
    if (!token) throw new Error("This client hasn't opened calendar setup yet, so there's no feed link.");
    return { url: feedUrls(token).httpsUrl };
  });

/** Clients list: Google / Feed / none per client, in one query. */
export const listClientCalendarSyncKinds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientIds: z.array(z.string().uuid()).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const staff = await requireStaff(supabase, userId);
    const out: Record<string, "google" | "feed"> = {};
    let ids = data.clientIds;
    if (!ids.length) return out;
    // Coaches: only the clients their own access can read.
    if (!staff.isAdmin) {
      const { data: visible } = await supabase.from("clients").select("id").in("id", ids);
      ids = ((visible ?? []) as any[]).map((r) => r.id);
      if (!ids.length) return out;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SYNC_FRESH_MS } = await import("@/lib/calendar-sync");
    const [{ data: g }, { data: f }] = await Promise.all([
      (supabaseAdmin as any).from("client_google_calendars").select("client_id, status").in("client_id", ids),
      (supabaseAdmin as any).from("client_calendar_sync").select("client_id, last_fetch_at").in("client_id", ids),
    ]);
    const fresh = Date.now() - SYNC_FRESH_MS;
    for (const r of (f ?? []) as any[]) if (r.last_fetch_at && Date.parse(r.last_fetch_at) >= fresh) out[r.client_id] = "feed";
    for (const r of (g ?? []) as any[]) if (r.status !== "revoked") out[r.client_id] = "google";
    return out;
  });

/** Connected client: push the JF Effect calendar to Google now (once a minute). */
export const syncMyGoogleCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const mine = await ownOrLinkedClient(userId);
    if (!mine) throw new Error("Only clients can sync a calendar.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("client_google_calendars").select("last_synced_at").eq("client_id", mine.id).maybeSingle();
    if (row?.last_synced_at && Date.now() - Date.parse(row.last_synced_at) < 60_000) {
      throw new Error("Synced less than a minute ago. Try again in a moment.");
    }
    const { syncClientCalendar } = await import("@/lib/client-gcal.server");
    return syncClientCalendar(supabaseAdmin as any, mine.id, { force: true });
  });
