// Server-only: the "important things" push events (coach + client essentials,
// wins). Load inside handlers only. Every event here is:
//   - content-free on the lockscreen (no answers, numbers or plan text)
//   - deduped per event + recipient
//   - rate limited per client/event so bursts collapse into one alert
//   - "normal" priority → held during quiet hours and counted against the
//     daily cap in sendWebPushToUser.
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeDisplayName } from "@/lib/push/notification-payload";
import type { PushCategory } from "@/lib/push/push.server";

export type AppEvent =
  // → coach / admins
  | "checkin_submitted"
  | "form_submitted"
  | "nutrition_plan_ready"
  | "lift_video_uploaded"
  | "client_lift_comment"
  // → client
  | "checkin_requested"
  | "nutrition_requested"
  | "checkin_reviewed"
  | "lift_reviewed"
  | "nutrition_targets_updated";

type EventSpec = {
  to: "staff" | "client";
  category: PushCategory;
  title: (name: string | null) => string;
  body: string;
  url: (clientId: string) => string;
  /** Minutes in which repeats for the same client collapse into one push. */
  rateMinutes: number;
};

export const APP_EVENTS: Record<AppEvent, EventSpec> = {
  checkin_submitted: {
    to: "staff", category: "check_ins",
    title: (n) => (n ? `${n} · Check-In` : "Check-In"),
    body: "Submitted a check-in — ready for your review.",
    url: (id) => `/admin/clients/${id}?tab=documents`, rateMinutes: 60,
  },
  form_submitted: {
    to: "staff", category: "check_ins",
    title: (n) => (n ? `${n} · Form` : "Form Submitted"),
    body: "Submitted a form.",
    url: (id) => `/admin/clients/${id}?tab=documents`, rateMinutes: 60,
  },
  nutrition_plan_ready: {
    to: "staff", category: "check_ins",
    title: (n) => (n ? `${n} · Nutrition Plan` : "Nutrition Plan"),
    body: "New AI targets + meal plan are ready to review and apply.",
    url: (id) => `/admin/clients/${id}?tab=nutrition`, rateMinutes: 60,
  },
  lift_video_uploaded: {
    to: "staff", category: "lift_reviews",
    title: (n) => (n ? `${n} · Lift Video` : "Lift Video"),
    body: "New lift video to review.",
    url: () => "/admin/lift-videos", rateMinutes: 120,
  },
  client_lift_comment: {
    to: "staff", category: "lift_reviews",
    title: (n) => (n ? `${n} · Lift Video` : "Lift Video"),
    body: "Replied on a lift video.",
    url: () => "/admin/lift-videos", rateMinutes: 60,
  },
  checkin_requested: {
    to: "client", category: "check_ins",
    title: () => "Check-In Ready",
    body: "Your coach sent you a check-in. Takes a few minutes.",
    url: () => "/portal/messages", rateMinutes: 360,
  },
  nutrition_requested: {
    to: "client", category: "check_ins",
    title: () => "Nutrition Update",
    body: "Your coach wants a quick nutrition update to build your next plan.",
    url: () => "/portal/messages", rateMinutes: 360,
  },
  checkin_reviewed: {
    to: "client", category: "check_ins",
    title: () => "Coach Feedback",
    body: "Your coach reviewed your check-in.",
    url: () => "/portal/check-in", rateMinutes: 60,
  },
  lift_reviewed: {
    to: "client", category: "lift_reviews",
    title: () => "Coach Feedback",
    body: "Your coach left feedback on your lift.",
    url: () => "/portal/lift-videos", rateMinutes: 60,
  },
  nutrition_targets_updated: {
    to: "client", category: "check_ins",
    title: () => "New Nutrition Plan",
    body: "Your nutrition targets were updated. Tap to see your plan.",
    url: () => "/portal/nutrition-targets", rateMinutes: 360,
  },
};

/** Assigned coach + every admin, minus whoever triggered the event. */
export async function staffUserIdsForClient(admin: SupabaseClient, clientId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: client } = await admin.from("clients").select("assigned_coach_id").eq("id", clientId).maybeSingle();
  if ((client as any)?.assigned_coach_id) {
    const { data: coach } = await admin.from("coaches").select("user_id").eq("id", (client as any).assigned_coach_id).maybeSingle();
    if ((coach as any)?.user_id) ids.add((coach as any).user_id);
  }
  const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  (admins ?? []).forEach((a: any) => a.user_id && ids.add(a.user_id));
  return [...ids];
}

/**
 * Fire one app event. `sourceId` makes it idempotent (same event never
 * pushes twice to the same person). Never throws — a push must not break
 * the action that triggered it.
 */
export async function notifyAppEvent(
  admin: SupabaseClient,
  event: AppEvent,
  input: { clientId: string; sourceId: string; actorUserId?: string | null },
) {
  try {
    const spec = APP_EVENTS[event];
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { data: c } = await admin
      .from("clients")
      .select("user_id, first_name, preferred_name, full_name")
      .eq("id", input.clientId)
      .maybeSingle();
    if (!c) return { sent: 0 };

    let recipients: string[];
    let name: string | null = null;
    if (spec.to === "staff") {
      recipients = await staffUserIdsForClient(admin, input.clientId);
      const raw = (c as any).preferred_name || (c as any).first_name || (c as any).full_name || "";
      name = raw ? safeDisplayName(raw, "") || null : null;
    } else {
      recipients = (c as any).user_id ? [(c as any).user_id] : [];
    }
    recipients = recipients.filter((u) => u && u !== input.actorUserId);

    let sent = 0;
    for (const uid of recipients) {
      const r = await sendWebPushToUser(
        admin,
        uid,
        {
          title: spec.title(name),
          body: spec.body,
          url: spec.url(input.clientId),
          tag: `${event}:${input.clientId}`,
          data: { kind: event, clientId: input.clientId, sourceId: input.sourceId },
        },
        {
          category: spec.category,
          eventKey: `${event}:${input.sourceId}:${uid}`,
          rateKey: `${event}:${input.clientId}`,
          rateWindowMinutes: spec.rateMinutes,
          priority: "normal",
        },
      );
      sent += r.sent;
    }
    return { sent };
  } catch (e) {
    console.warn("[push] app event failed", event, e);
    return { sent: 0 };
  }
}
