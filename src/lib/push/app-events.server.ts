// Server-only: the "important things" push events (coach + client essentials,
// wins). Load inside handlers only. Every event here is:
//   - content-free on the lockscreen (no answers, numbers or plan text)
//   - deduped per event + recipient
//   - rate limited per client/event so bursts collapse into one alert
//   - "normal" priority → held during quiet hours and counted against the
//     daily cap in sendWebPushToUser.
import type { SupabaseClient } from "@supabase/supabase-js";
import { coachLabel, safeDisplayName } from "@/lib/push/notification-payload";
import type { PushCategory } from "@/lib/push/push.server";

export type AppEvent =
  // → coach / admins
  | "checkin_submitted"
  | "form_submitted"
  | "nutrition_plan_ready"
  | "lift_video_uploaded"
  | "client_lift_comment"
  | "agreement_signed"
  // → client
  | "agreement_requested"
  | "checkin_requested"
  | "nutrition_requested"
  | "checkin_reviewed"
  | "lift_reviewed"
  | "nutrition_targets_updated";

type EventSpec = {
  to: "staff" | "client";
  category: PushCategory;
  /**
   * Lockscreen copy. `name` is the client's full name for staff pushes and
   * "Coach Jared" / "Your coach" for client pushes. The title alone should
   * tell you what this is and who it's about.
   */
  title: (name: string) => string;
  body: (name: string) => string;
  url: (clientId: string) => string;
  /** Minutes in which repeats for the same client collapse into one push. */
  rateMinutes: number;
};

export const APP_EVENTS: Record<AppEvent, EventSpec> = {
  checkin_submitted: {
    to: "staff", category: "check_ins",
    title: (n) => `Check-in from ${n}`,
    body: () => "Submitted and ready for your review.",
    url: (id) => `/admin/clients/${id}?tab=documents`, rateMinutes: 60,
  },
  form_submitted: {
    to: "staff", category: "check_ins",
    title: (n) => `Form from ${n}`,
    body: () => "Submitted a form. Tap to view.",
    url: (id) => `/admin/clients/${id}?tab=documents`, rateMinutes: 60,
  },
  nutrition_plan_ready: {
    to: "staff", category: "check_ins",
    title: (n) => `Nutrition plan ready: ${n}`,
    body: () => "AI targets and meal plan are ready to review and apply.",
    url: (id) => `/admin/clients/${id}?tab=nutrition`, rateMinutes: 60,
  },
  lift_video_uploaded: {
    to: "staff", category: "lift_reviews",
    title: (n) => `Lift video from ${n}`,
    body: () => "New lift to review.",
    url: () => "/admin/lift-videos", rateMinutes: 120,
  },
  client_lift_comment: {
    to: "staff", category: "lift_reviews",
    title: (n) => `${n} replied on a lift`,
    body: () => "Tap to read the reply.",
    url: () => "/admin/lift-videos", rateMinutes: 60,
  },
  agreement_signed: {
    to: "staff", category: "billing",
    title: (n) => `${n} signed their agreement`,
    body: () => "Coaching Agreement signed. Tap to view the signed copy.",
    url: (id) => `/admin/clients/${id}?tab=documents`, rateMinutes: 60,
  },
  agreement_requested: {
    to: "client", category: "reminders",
    title: () => "Your Coaching Agreement",
    body: (coach) => `${coach} sent your agreement to sign. It takes about 2 minutes.`,
    url: () => "/portal/agreements?sign=1", rateMinutes: 60,
  },
  checkin_requested: {
    to: "client", category: "check_ins",
    title: () => "Check-in time",
    body: (coach) => `${coach} sent your check-in. It only takes a few minutes.`,
    url: () => "/portal/messages", rateMinutes: 360,
  },
  nutrition_requested: {
    to: "client", category: "check_ins",
    title: () => "Nutrition update needed",
    body: (coach) => `${coach} needs a quick update to build your next plan.`,
    url: () => "/portal/messages", rateMinutes: 360,
  },
  checkin_reviewed: {
    to: "client", category: "check_ins",
    title: () => "Check-in reviewed",
    body: (coach) => `${coach} left feedback on your check-in.`,
    url: () => "/portal/check-in", rateMinutes: 60,
  },
  lift_reviewed: {
    to: "client", category: "lift_reviews",
    title: () => "Lift feedback",
    body: (coach) => `${coach} reviewed your lift. Tap to watch.`,
    url: () => "/portal/lift-videos", rateMinutes: 60,
  },
  nutrition_targets_updated: {
    to: "client", category: "check_ins",
    title: () => "New nutrition targets",
    body: (coach) => `${coach} updated your targets. Tap to see your plan.`,
    url: () => "/portal/nutrition-targets", rateMinutes: 360,
  },
};

/**
 * Who the client should see as the sender: whoever acted (when it was a
 * coach/admin), else their assigned coach, else "Your coach".
 */
async function coachNameForClient(admin: SupabaseClient, clientId: string, actorUserId?: string | null): Promise<string> {
  if (actorUserId) {
    const [{ data: coach }, { data: prof }] = await Promise.all([
      admin.from("coaches").select("full_name").eq("user_id", actorUserId).maybeSingle(),
      admin.from("profiles").select("full_name").eq("id", actorUserId).maybeSingle(),
    ]);
    const n = (coach as any)?.full_name || (prof as any)?.full_name;
    if (n) return coachLabel(n);
  }
  const { data: c } = await admin.from("clients").select("assigned_coach_id").eq("id", clientId).maybeSingle();
  if ((c as any)?.assigned_coach_id) {
    const { data: coach } = await admin.from("coaches").select("full_name").eq("id", (c as any).assigned_coach_id).maybeSingle();
    if ((coach as any)?.full_name) return coachLabel((coach as any).full_name);
  }
  return "Your coach";
}

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
      .select("user_id, first_name, last_name, preferred_name, full_name")
      .eq("id", input.clientId)
      .maybeSingle();
    if (!c) return { sent: 0 };

    let recipients: string[];
    let name: string;
    if (spec.to === "staff") {
      recipients = await staffUserIdsForClient(admin, input.clientId);
      // Full name, not first: a coach with two Jennifers needs to know which one.
      const raw = (c as any).full_name
        || [(c as any).first_name, (c as any).last_name].filter(Boolean).join(" ")
        || (c as any).preferred_name || "";
      name = safeDisplayName(raw, "A client");
    } else {
      recipients = (c as any).user_id ? [(c as any).user_id] : [];
      name = await coachNameForClient(admin, input.clientId, input.actorUserId);
    }
    recipients = recipients.filter((u) => u && u !== input.actorUserId);

    let sent = 0;
    for (const uid of recipients) {
      const r = await sendWebPushToUser(
        admin,
        uid,
        {
          title: spec.title(name),
          body: spec.body(name),
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
