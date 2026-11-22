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
  | "nutrition_submitted"
  | "nutrition_plan_ready"
  | "lift_video_uploaded"
  | "client_lift_comment"
  | "agreement_signed"
  | "birthday_post_ready"
  | "birthday_post_reminder"
  | "chat_reported"
  | "session_requested"
  | "lead_ready"
  | "program_gaps_due"
  | "health_updated"
  | "weight_review_ready"
  | "roadmap_review_ready"
  | "support_message"
  | "account_deactivated"
  | "account_deactivation_scheduled"
  | "account_reactivated"
  | "account_deletion_requested"
  | "account_deletion_withdrawn"
  // → client
  | "agreement_requested"
  | "checkin_requested"
  | "nutrition_requested"
  | "checkin_reviewed"
  | "lift_reviewed"
  | "nutrition_targets_updated"
  | "community_coach_recognition"
  | "session_request_answered"
  | "session_booked"
  | "support_reply"
  | "roadmap_checkin_due"
  | "roadmap_update_ready";

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
  url: (clientId: string, sourceId?: string, target?: string) => string;
  /** Minutes in which repeats for the same client collapse into one push. */
  rateMinutes: number;
};

export const APP_EVENTS: Record<AppEvent, EventSpec> = {
  // Birthday posts (birthday-posts.server.ts): the draft is ready the evening
  // before, and a nudge on the day if it's still waiting. Opens the review.
  birthday_post_ready: {
    to: "staff", category: "wins",
    title: (n) => `🎂 ${n}'s birthday post is ready`,
    body: () => "It goes out on its own at 8am on their birthday. Tap to read or edit it.",
    url: (id) => `/admin#birthday=${id}`, rateMinutes: 60,
  },
  birthday_post_reminder: {
    to: "staff", category: "wins",
    title: (n) => `🎂 It's ${n}'s birthday today`,
    body: () => "Their post is still waiting. Tap to review and post it.",
    url: (id) => `/admin#birthday=${id}`, rateMinutes: 60,
  },
  // A client reported a member-to-member chat. The chat is waiting in their
  // coach chat as an internal note; this opens it.
  chat_reported: {
    to: "staff", category: "messages",
    title: (n) => `🚩 ${n} reported a chat`,
    body: () => "Tap to see what was said. They've blocked the other person.",
    url: (id) => `/admin/messages?client=${id}`, rateMinutes: 60,
  },
  // A JF member wrote to Support (member-support.functions.ts). Their Support
  // chat is a row in the coach's 1:1 Chats; this opens it. Content-free, and a
  // burst of messages is one push.
  support_message: {
    to: "staff", category: "messages",
    title: (n) => `💬 ${n} wrote to Support`,
    body: () => "Tap to read it and reply.",
    url: (_id, _src, thread) => (thread ? `/admin/communication?tab=messages&support=${thread}` : "/admin/communication?tab=messages"),
    rateMinutes: 10,
  },
  // The coach answered a member's Support chat. Opens their Support screen.
  support_reply: {
    to: "client", category: "messages",
    title: () => "💬 JF Effect Support",
    // `n` is whoever answered ("Coach Jared"), so they know a person read it.
    body: (n) => `${n} replied to your message. Tap to read it.`,
    url: () => "/portal/support", rateMinutes: 10,
  },
  // A client asked for a session from their Schedule; the request card is in their chat.
  session_requested: {
    to: "staff", category: "messages",
    title: (n) => `📅 ${n} requested a session`,
    body: () => "Tap to approve it or suggest another time.",
    url: (id) => `/admin/messages?client=${id}`, rateMinutes: 60,
  },
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
  // A new coaching application, once its AI read and text are written
  // (coaching-leads.server.ts). Opens the lead with the text to copy.
  lead_ready: {
    to: "staff", category: "coaching_apps",
    title: (n) => `New coaching application: ${n}`,
    body: () => "Your read on them and a text to send are ready. Tap to copy it.",
    url: (_id, applicationId) => (applicationId ? `/admin/leads?id=${applicationId}` : "/admin/leads"), rateMinutes: 60,
  },
  // A workout in the next few days is missing what the client needs to follow
  // it (program-gaps.ts: no RPE / RIR / weight, a max a % reads): the morning
  // program-gaps-tick, at most once a client a day. Opens Missing program data.
  program_gaps_due: {
    to: "staff", category: "workouts",
    title: (n) => `${n}'s program is missing something`,
    body: () => "A workout in the next few days can't be followed yet. Tap to fill it in.",
    url: (id) => `/admin/program-gaps?client=${id}`, rateMinutes: 20 * 60,
  },
  // Account lifecycle (lifecycle.server.ts): who changed, never what they owe
  // (the figures are in the staff-only note in their chat and on their page).
  account_deactivated: {
    to: "staff", category: "messages",
    title: (n) => `${n}'s account is deactivated`,
    body: () => "Tap to see what it means for their billing and sessions.",
    url: (id) => `/admin/clients/${id}`, rateMinutes: 60,
  },
  account_deactivation_scheduled: {
    to: "staff", category: "messages",
    title: (n) => `${n}'s account deactivates soon`,
    body: () => "It happens when the month they've paid for runs out. Tap to see it.",
    url: (id) => `/admin/clients/${id}`, rateMinutes: 60,
  },
  account_reactivated: {
    to: "staff", category: "messages",
    title: (n) => `${n}'s account is active again`,
    body: () => "Nothing restarted or was charged. Tap to see where they stand.",
    url: (id) => `/admin/clients/${id}`, rateMinutes: 60,
  },
  account_deletion_requested: {
    to: "staff", category: "messages",
    title: (n) => `${n}'s account is in Recently deleted`,
    body: () => "It's deleted for good in 30 days unless it's restored. Tap to see it.",
    url: (id) => `/admin/clients/${id}`, rateMinutes: 60,
  },
  account_deletion_withdrawn: {
    to: "staff", category: "messages",
    title: (n) => `${n} restored their account`,
    body: () => "They took back their deletion request. Tap to see it.",
    url: (id) => `/admin/clients/${id}`, rateMinutes: 60,
  },
  // A client added or changed an injury, condition, medication or supplement in their app.
  // A weekly check-in's weight-management read wants the coach: a nutrition or
  // cardio change to approve, digestion to look into, or a target to rethink
  // (weight-management/reviews.server.ts). Content-free; opens the card.
  weight_review_ready: {
    to: "staff", category: "check_ins",
    title: (n) => `${n}'s weight plan needs a look`,
    body: () => "Their check-in is in and there's a recommendation waiting for your OK. Tap to review it.",
    url: (id) => `/admin/clients/${id}?tab=nutrition#weight`, rateMinutes: 12 * 60,
  },
  // A nutrition roadmap wants the coach: a reforecast or adjustment to approve, or a real
  // risk (nutrition-roadmap/evaluate.server.ts: at most every 3 days, never a first draft).
  roadmap_review_ready: {
    to: "staff", category: "check_ins",
    title: (n) => `${n}'s nutrition roadmap needs a look`,
    body: () => "There's a change to approve or something worth checking. Tap to review it.",
    url: (id) => `/admin/clients/${id}?tab=nutrition#roadmap`, rateMinutes: 3 * 24 * 60,
  },
  health_updated: {
    to: "staff", category: "check_ins",
    title: (n) => `${n} updated their health info`,
    body: () => "An injury, condition, medication or supplement changed. Tap to see it.",
    url: (id) => `/admin/clients/${id}#health`, rateMinutes: 60,
  },
  nutrition_submitted: {
    to: "staff", category: "check_ins",
    title: (n) => `Nutrition update from ${n}`,
    body: () => "Their answers are in. Their targets and meal plan are being written.",
    url: (id) => `/admin/clients/${id}?tab=nutrition`, rateMinutes: 10,
  },
  nutrition_plan_ready: {
    to: "staff", category: "check_ins",
    title: (n) => `Nutrition plan ready: ${n}`,
    body: () => "Their targets and meal plan are ready to review and apply.",
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
    url: () => "/portal/messages", rateMinutes: 60,
  },
  lift_reviewed: {
    to: "client", category: "lift_reviews",
    title: () => "Lift feedback",
    body: (coach) => `${coach} reviewed your lift. Tap to watch.`,
    url: () => "/portal/lift-videos", rateMinutes: 60,
  },
  // A self-coached athlete's roadmap check-in is due (one push, then the card on Nutrition).
  roadmap_checkin_due: {
    to: "client", category: "check_ins",
    title: () => "Nutrition check-in",
    body: (from) => `${from}: a quick nutrition check-in, under a minute. Tap to do it.`,
    url: () => "/portal/nutrition-targets#roadmap", rateMinutes: 2 * 24 * 60,
  },
  // A self-coached athlete's roadmap has an update for them to accept or decline.
  roadmap_update_ready: {
    to: "client", category: "check_ins",
    title: () => "Your nutrition roadmap",
    body: (from) => `${from}: there's an update to your roadmap for you to look at. Tap to see it.`,
    url: () => "/portal/nutrition-targets#roadmap", rateMinutes: 24 * 60,
  },
  nutrition_targets_updated: {
    to: "client", category: "check_ins",
    title: () => "Your nutrition plan",
    body: (coach) => `${coach} sent your updated plan. Tap to see it.`,
    url: () => "/portal/nutrition-targets", rateMinutes: 360,
  },
  // The coach reacted to / commented on a workout the athlete chose to share.
  // Crew activity (everyone else's reactions, comments, replies) goes out
  // from community-push.server.ts, which skips what this already covers.
  session_request_answered: {
    to: "client", category: "messages",
    title: () => "Your session request",
    body: (coach) => `${coach} answered your session request. Tap to see it.`,
    url: () => "/portal/messages", rateMinutes: 60,
  },
  // The coach booked a session for them (session-booked.server.ts); the card is in their chat.
  session_booked: {
    to: "client", category: "messages",
    title: () => "📅 You're booked in",
    body: (coach) => `${coach} booked your session. Tap for the details.`,
    url: () => "/portal/messages", rateMinutes: 60,
  },
  community_coach_recognition: {
    to: "client", category: "lift_reviews",
    title: () => "Props from your coach",
    body: (n) => `${n} saw your training.`,
    url: () => "/portal/community#feed", rateMinutes: 180,
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
  const { data: c } = await admin.from("clients").select("assigned_coach_id, service_tier").eq("id", clientId).maybeSingle();
  if ((c as any)?.assigned_coach_id) {
    const { data: coach } = await admin.from("coaches").select("full_name").eq("id", (c as any).assigned_coach_id).maybeSingle();
    if ((coach as any)?.full_name) return coachLabel((coach as any).full_name);
  }
  // a self-coached member has no coach: the app speaks for itself
  if ((c as any)?.service_tier === "self_serve") return "JF Effect";
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
  input: { clientId: string; sourceId: string; actorUserId?: string | null; /** What the push opens, when it isn't the client (a support thread). */ target?: string },
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
          url: spec.url(input.clientId, input.sourceId, input.target),
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
