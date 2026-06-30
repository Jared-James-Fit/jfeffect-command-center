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
  | "coaching_apps";

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
};

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
  },
): Promise<{ sent: number; removed: number; skipped: string | null }> {
  try { configure(); } catch (e) { console.warn("[push] not configured", e); return { sent: 0, removed: 0, skipped: "not_configured" }; }

  // Preference gate
  if (!options?.skipPreferences) {
    const { data: prefs } = await admin
      .from("push_notification_preferences")
      .select("master_enabled, messages, check_ins, lift_reviews, workouts, billing, coaching_apps")
      .eq("user_id", userId).maybeSingle();
    if (prefs && prefs.master_enabled === false) return { sent: 0, removed: 0, skipped: "master_off" };
    if (options?.category && prefs && (prefs as any)[options.category] === false) {
      return { sent: 0, removed: 0, skipped: `category_off:${options.category}` };
    }
  }

  // Dedupe per (user,event)
  if (options?.eventKey) {
    const { error: dErr } = await admin
      .from("push_notification_dedupe")
      .insert({ user_id: userId, event_key: options.eventKey });
    if (dErr && dErr.code === "23505") return { sent: 0, removed: 0, skipped: "dedupe" };
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