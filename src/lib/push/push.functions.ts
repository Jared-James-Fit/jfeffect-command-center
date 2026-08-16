import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Public: returns the VAPID public key so the browser can subscribe. */
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { publicKey: process.env.VAPID_PUBLIC_KEY ?? "" };
});

const SaveInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  deviceName: z.string().max(120).optional(),
  platform: z.string().max(80).optional(),
  userAgent: z.string().max(500).optional(),
});

/** Authenticated: persist a new browser push subscription for the current user. */
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({
        user_id: userId,
        endpoint: data.endpoint,
        p256dh_key: data.p256dh,
        auth_key: data.auth,
        device_name: data.deviceName ?? null,
        platform: data.platform ?? null,
        user_agent: data.userAgent ?? null,
        enabled: true,
        last_used_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Authenticated: remove a subscription by endpoint (logout / disable). */
export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ endpoint: z.string().url() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("push_subscriptions").delete()
      .eq("user_id", userId).eq("endpoint", data.endpoint);
    return { ok: true };
  });

/** Authenticated: read this user's preferences (creates a default row if missing). */
export const getNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    let { data } = await supabase
      .from("push_notification_preferences")
      .select("*").eq("user_id", userId).maybeSingle();
    if (!data) {
      const ins = await supabase
        .from("push_notification_preferences")
        .insert({ user_id: userId })
        .select("*").single();
      data = ins.data ?? null;
    }
    return data;
  });

const PrefsInput = z.object({
  master_enabled: z.boolean().optional(),
  messages: z.boolean().optional(),
  check_ins: z.boolean().optional(),
  lift_reviews: z.boolean().optional(),
  workouts: z.boolean().optional(),
  billing: z.boolean().optional(),
  coaching_apps: z.boolean().optional(),
});

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PrefsInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_notification_preferences")
      .upsert({ user_id: userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyPushDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, device_name, platform, enabled, last_used_at, created_at")
      .eq("user_id", userId)
      .order("last_used_at", { ascending: false, nullsFirst: false });
    return data ?? [];
  });

/** Authenticated: fire a test notification to the user's own devices. */
export const sendTestPushNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const result = await sendWebPushToUser(supabaseAdmin, userId, {
      title: "Test · JF Effect",
      body: "This is a test notification you requested. Notifications are working on this device.",
      url: "/",
      tag: "jf-test",
    }, { skipPreferences: true });
    return result;
  });