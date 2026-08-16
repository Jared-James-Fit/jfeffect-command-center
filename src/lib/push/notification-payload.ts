/**
 * Shared, PURE notification payload/identity normalizer.
 *
 * One place that decides, for every push + in-app notification:
 *   - the safe title / summary shown on a lockscreen
 *   - the stable event key used for duplicate protection
 *   - the preference category
 *   - the role-aware deep link
 *
 * Privacy contract (enforced by tests):
 *   - never include raw private message bodies, check-in / payment / legal /
 *     progress / nutrition content, push endpoints, keys, or technical
 *     metadata in `title` / `body`
 *   - identifiers may only travel in `data` (routing) or inside `url`
 */

export type NotificationKind =
  | "message"
  | "group_message"
  | "workout_review"
  | "check_in"
  | "appointment"
  | "agreement"
  | "payment"
  | "program"
  | "generic";

export type NotificationRole = "admin" | "coach" | "client" | null | undefined;

export type PushCategoryKey =
  | "messages" | "check_ins" | "lift_reviews" | "workouts" | "billing" | "coaching_apps";

export const CATEGORY_BY_KIND: Record<NotificationKind, PushCategoryKey> = {
  message: "messages",
  group_message: "messages",
  workout_review: "lift_reviews",
  check_in: "check_ins",
  appointment: "workouts",
  agreement: "workouts",
  payment: "billing",
  program: "workouts",
  generic: "workouts",
};

/** Safe, human display name. Never falls back to an id. */
export function safeDisplayName(raw?: string | null, fallback = "Your coach"): string {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  // Reject anything that looks like a uuid / email / url / endpoint.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) return fallback;
  if (/https?:\/\/|@|\//.test(v)) return fallback;
  return v.length > 60 ? v.slice(0, 57) + "…" : v;
}

function isStaff(role: NotificationRole) {
  return role === "admin" || role === "coach";
}

export type DeepLinkIds = {
  clientId?: string | null;
  groupId?: string | null;
  appointmentId?: string | null;
};

/** Role-aware deep link. Single source of truth for push URLs. */
export function notificationDeepLink(
  kind: NotificationKind,
  role: NotificationRole,
  ids: DeepLinkIds = {},
): string {
  const staff = isStaff(role);
  switch (kind) {
    case "message":
      return staff
        ? `/admin/messages${ids.clientId ? `?client=${ids.clientId}` : ""}`
        : "/portal/messages";
    case "group_message":
      return staff
        ? `/admin/communication?tab=groups${ids.groupId ? `#group=${ids.groupId}` : ""}`
        : `/portal/messages?tab=groups${ids.groupId ? `#group=${ids.groupId}` : ""}`;
    case "workout_review":
      return staff ? "/admin/lift-videos" : "/portal/lift-videos";
    case "check_in":
      return staff && ids.clientId
        ? `/admin/clients/${ids.clientId}?tab=check-ins`
        : "/portal/check-in";
    case "appointment":
      return staff ? "/admin/appointments" : "/portal/appointments";
    case "agreement":
      return staff && ids.clientId
        ? `/admin/clients/${ids.clientId}?tab=agreements`
        : "/portal";
    case "payment":
      return staff ? "/admin/payments" : "/portal/purchases";
    case "program":
      return staff && ids.clientId
        ? `/admin/clients/${ids.clientId}?tab=training`
        : "/portal/workouts";
    default:
      return staff ? "/admin" : "/portal";
  }
}

/** Safe generic summaries — deliberately content-free. */
const SUMMARY: Record<NotificationKind, { staff: string; client: string }> = {
  message: { staff: "Sent you a new message.", client: "You have a new message." },
  group_message: { staff: "New message in a group chat.", client: "New message in a group chat." },
  workout_review: { staff: "New lift video to review.", client: "Your coach reviewed a lift." },
  check_in: { staff: "Submitted a check-in.", client: "A check-in is ready for you." },
  appointment: { staff: "Appointment update.", client: "Appointment update." },
  agreement: { staff: "Agreement update.", client: "An agreement needs your attention." },
  payment: { staff: "Billing update.", client: "Billing update." },
  program: { staff: "Training program update.", client: "Your training plan was updated." },
  generic: { staff: "You have a new update.", client: "You have a new update." },
};

const TITLE: Record<NotificationKind, string> = {
  message: "New Message",
  group_message: "Group Chat",
  workout_review: "Coach Feedback",
  check_in: "Check-In",
  appointment: "Appointment",
  agreement: "Agreement",
  payment: "Billing",
  program: "Training",
  generic: "JF Effect",
};

export type NormalizedNotification = {
  title: string;
  body: string;
  url: string;
  tag: string;
  eventKey: string;
  category: PushCategoryKey;
  data: Record<string, unknown>;
};

export function buildNotificationPayload(input: {
  kind: NotificationKind;
  role: NotificationRole;
  /** Recipient user id — makes the event key unique per user. */
  recipientUserId: string;
  /** The event's own id (message id, review id, …). */
  sourceId: string;
  /** Safe display name of the person/group the event is about. */
  displayName?: string | null;
  /** Optional short, non-private context (e.g. group name). */
  contextLabel?: string | null;
  ids?: DeepLinkIds;
  /** Mark clearly as a user-triggered test. */
  isTest?: boolean;
}): NormalizedNotification {
  const { kind, role, recipientUserId, sourceId } = input;
  const staff = isStaff(role);
  const name = input.displayName ? safeDisplayName(input.displayName, TITLE[kind]) : null;
  const context = input.contextLabel ? safeDisplayName(input.contextLabel, "") : "";

  let title = TITLE[kind];
  if (name && context) title = `${name} · ${context}`;
  else if (name) title = `${name} · ${TITLE[kind]}`;

  const body = staff ? SUMMARY[kind].staff : SUMMARY[kind].client;
  const tagId = input.ids?.groupId ?? input.ids?.clientId ?? sourceId;

  return {
    title: input.isTest ? `Test · ${title}` : title,
    body: input.isTest ? "This is a test notification you requested." : body,
    url: notificationDeepLink(kind, role, input.ids ?? {}),
    tag: `${kind}:${tagId}`,
    eventKey: `${kind}:${sourceId}:${recipientUserId}`,
    category: CATEGORY_BY_KIND[kind],
    data: {
      kind,
      ...(input.ids?.clientId ? { clientId: input.ids.clientId } : {}),
      ...(input.ids?.groupId ? { groupId: input.ids.groupId } : {}),
      sourceId,
    },
  };
}
