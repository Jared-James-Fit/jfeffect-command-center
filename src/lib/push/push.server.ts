// Server-only Web Push helpers. Never import this from client code or
// from the top level of a `.functions.ts` file — load inside handlers.
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PushCategory =
  | "messages"
  | "check_ins"
  | "lift_reviews"
  | "workouts"
  | "billing"
  | "coaching_apps"
  | "wins"
  | "reminders"
  | "community";

export type PushPayload = {
  title: string;
  body: string;
  /** Deep-link target inside the app (relative URL). */
  url?: string;
  /** Collapse key so repeated notifications replace the previous one. */
  tag?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  /** App-icon badge count where supported. */
  badgeCount?: number;
  /** Deliver without sound/vibration (used for messages during quiet hours). */
  silent?: boolean;
};

const DEFAULT_TZ = "America/Winnipeg";

/** Local hour (0–23) in an IANA time zone. */
export function localHour(tz: string, at = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
  } catch {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
  }
}

/** Local calendar date (YYYY-MM-DD) in an IANA time zone. */
export function localDate(tz: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(at);
  }
}

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** When quiet hours end (approx., to the hour) — for holding non-urgent pushes. */
export function quietEndsAt(tz: string, end: number, at = new Date()): Date {
  const h = localHour(tz, at);
  const hours = (end - h + 24) % 24 || 24;
  const d = new Date(at.getTime() + hours * 3_600_000);
  d.setUTCMinutes(5, 0, 0);
  return d;
}

async function userTimezone(admin: SupabaseClient, userId: string, pref?: string | null): Promise<string> {
  if (pref) return pref;
  const { data: c } = await admin.from("clients").select("timezone").eq("user_id", userId).maybeSingle();
  return (c as any)?.timezone || DEFAULT_TZ;
}

/** Max non-urgent pushes per user per local day — keeps it from feeling spammy. */
const DAILY_CAP = 6;

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:notifications@jfeffect.com";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
}

/** Best-effort send; never throws. Returns counts. Cleans up dead subs. */
export async function sendWebPushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload,
  options?: {
    category?: PushCategory;
    /** Unique-per-event key. If supplied, we'll only fire once per (user,event). */
    eventKey?: string;
    /** Skip the user-preferences check (e.g. test notifications). */
    skipPreferences?: boolean;
    /**
     * "urgent" (messages): always delivered, silently during quiet hours.
     * "normal" (default for everything else): held until quiet hours end and
     * counted against the daily cap.
     */
    priority?: "urgent" | "normal";
    /** Rate limit: at most one push per (rateKey) per window. */
    rateKey?: string;
    rateWindowMinutes?: number;
    /** Internal: delivering a held push from the queue. */
    fromQueue?: boolean;
  },
): Promise<{ sent: number; removed: number; skipped: string | null }> {
  try { configure(); } catch (e) { console.warn("[push] not configured", e); return { sent: 0, removed: 0, skipped: "not_configured" }; }

  const priority = options?.priority ?? (options?.category === "messages" ? "urgent" : "normal");
  let prefs: any = null;

  // Preference gate
  if (!options?.skipPreferences) {
    const { data } = await admin
      .from("push_notification_preferences")
      .select("*")
      .eq("user_id", userId).maybeSingle();
    prefs = data;
    if (prefs && prefs.master_enabled === false) return { sent: 0, removed: 0, skipped: "master_off" };
    if (options?.category && prefs && (prefs as any)[options.category] === false) {
      return { sent: 0, removed: 0, skipped: `category_off:${options.category}` };
    }
  }

  // Rate limit (bucketed key → one per window).
  if (options?.rateKey && !options.fromQueue) {
    const windowMs = (options.rateWindowMinutes ?? 60) * 60_000;
    const bucket = Math.floor(Date.now() / windowMs);
    const { error: rErr } = await admin
      .from("push_notification_dedupe")
      .insert({ user_id: userId, event_key: `rate:${options.rateKey}:${bucket}` });
    if (rErr && rErr.code === "23505") return { sent: 0, removed: 0, skipped: "rate_limited" };
  }

  // Dedupe per (user,event)
  if (options?.eventKey && !options.fromQueue) {
    const { error: dErr } = await admin
      .from("push_notification_dedupe")
      .insert({ user_id: userId, event_key: options.eventKey });
    if (dErr && dErr.code === "23505") return { sent: 0, removed: 0, skipped: "dedupe" };
  }

  if (!options?.skipPreferences && !options?.fromQueue) {
    const tz = await userTimezone(admin, userId, prefs?.timezone);
    const quietOn = prefs?.quiet_hours_enabled ?? true;
    const qs = prefs?.quiet_start ?? 22;
    const qe = prefs?.quiet_end ?? 7;
    const quiet = quietOn && inQuietHours(localHour(tz), qs, qe);

    if (priority === "normal") {
      // Daily cap of non-urgent pushes.
      const day = localDate(tz);
      let slot = false;
      for (let n = 1; n <= DAILY_CAP && !slot; n++) {
        const { error } = await admin.from("push_notification_dedupe").insert({ user_id: userId, event_key: `cap:${day}:${n}` });
        if (!error) slot = true;
        else if (error.code !== "23505") slot = true; // don't block on unexpected errors
      }
      if (!slot) return { sent: 0, removed: 0, skipped: "daily_cap" };

      if (quiet) {
        await admin.from("push_notification_queue").insert({
          user_id: userId,
          payload,
          category: options?.category ?? null,
          event_key: options?.eventKey ?? null,
          deliver_after: quietEndsAt(tz, qe).toISOString(),
        });
        return { sent: 0, removed: 0, skipped: "queued_quiet_hours" };
      }
    } else if (quiet) {
      payload = { ...payload, silent: true };
    }
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("user_id", userId).eq("enabled", true);
  if (!subs || subs.length === 0) return { sent: 0, removed: 0, skipped: "no_subs" };

  const body = JSON.stringify(payload);
  let sent = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } },
        body,
        { TTL: 60 * 60 * 24 }, // 24h
      );
      sent++;
      await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString(), failure_count: 0, last_error: null }).eq("id", s.id);
    } catch (err: any) {
      const code = err?.statusCode ?? 0;
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      } else {
        await admin.from("push_subscriptions").update({
          failure_count: ((s as any).failure_count ?? 0) + 1,
          last_error: String(err?.body ?? err?.message ?? code).slice(0, 500),
        }).eq("id", s.id);
      }
      console.warn(`[push] send failed (${code})`, err?.body ?? err?.message);
    }
  }));
  return { sent, removed, skipped: null };
}

/** Convenience: resolve current user's id from a client_id (if a client) and push. */
export async function sendPushToClient(
  admin: SupabaseClient,
  clientId: string,
  payload: PushPayload,
  options?: { category?: PushCategory; eventKey?: string },
) {
  const { data: c } = await admin.from("clients").select("user_id").eq("id", clientId).maybeSingle();
  if (!c?.user_id) return { sent: 0, removed: 0, skipped: "no_user_for_client" };
  return sendWebPushToUser(admin, c.user_id, payload, options);
}

/** Deliver pushes held during quiet hours. Called from the hourly tick. */
export async function deliverQueuedPushes(admin: SupabaseClient, limit = 300) {
  const { data: due } = await admin
    .from("push_notification_queue")
    .select("id, user_id, payload, category")
    .is("sent_at", null)
    .lte("deliver_after", new Date().toISOString())
    .order("deliver_after")
    .limit(limit);
  let sent = 0;
  for (const row of (due ?? []) as any[]) {
    await admin.from("push_notification_queue").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
    const r = await sendWebPushToUser(admin, row.user_id, row.payload, { category: row.category ?? undefined, fromQueue: true });
    if (r.sent > 0) sent++;
  }
  return { due: due?.length ?? 0, sent };
}
