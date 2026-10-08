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
  | "direct_message"
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
  direct_message: "messages",
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

/** "Jared James" → "Jared". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** How a client sees their coach on a lockscreen: "Coach Jared", else "Your coach". */
export function coachLabel(rawName?: string | null): string {
  const safe = safeDisplayName(rawName, "");
  return safe ? `Coach ${firstName(safe)}` : "Your coach";
}

export type AttachmentLike = { type?: string | null; kind?: string | null } | null | undefined;

/**
 * What a chat message *is*, never what it says: "sent you a photo",
 * "sent you a check-in", "sent you a message". Safe for a lockscreen because
 * it only reads attachment kinds/types, not bodies, names or answers.
 * `toYou` = 1:1 ("sent you a photo"); false for groups ("sent a photo").
 */
export function messageAction(attachments: AttachmentLike[] | null | undefined, toYou: boolean): string {
  const you = toYou ? " you" : "";
  const atts = (attachments ?? []).filter(Boolean) as Array<{ type?: string | null; kind?: string | null }>;
  const kinds = new Set(atts.map((a) => a.kind).filter(Boolean));
  if (kinds.has("checkin_submission")) return "submitted a check-in";
  if (kinds.has("checkin_request")) return `sent${you} a check-in`;
  if (kinds.has("form_request")) return `sent${you} a form to fill out`;
  if (kinds.has("signature_request")) return `sent${you} something to sign`;
  if (kinds.has("payment_request")) return `sent${you} a payment request`;
  if (kinds.has("recipe_share")) return `shared a recipe`;
  if (kinds.has("community_post")) return `sent${you} a post`;
  if (kinds.has("gif")) return `sent${you} a GIF`;
  if (kinds.has("sound")) return `sent${you} a sound`;
  // Auto-detected links ride along with ordinary text, so they don't count.
  const media = atts.filter((a) => a.type && a.type !== "link" && a.type !== "youtube" && a.type !== "drive" && a.type !== "sheets");
  const count = (t: string) => media.filter((a) => a.type === t).length;
  const photos = count("image");
  const videos = count("video");
  if (photos && videos) return `sent${you} ${photos + videos} photos and videos`;
  if (photos) return photos > 1 ? `sent${you} ${photos} photos` : `sent${you} a photo`;
  if (videos) return videos > 1 ? `sent${you} ${videos} videos` : `sent${you} a video`;
  if (count("audio")) return `sent${you} a voice message`;
  if (media.length) return media.length > 1 ? `sent${you} ${media.length} files` : `sent${you} a file`;
  return `sent${you} a message`;
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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
    case "direct_message":
      // Member-to-member chats live with the client's group chats ("Chats").
      return `/portal/messages?tab=groups${ids.groupId ? `#group=${ids.groupId}` : ""}`;
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
  direct_message: { staff: "Sent you a message.", client: "Sent you a message." },
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
  direct_message: "Message",
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
  /** Message/group kinds: the message's attachments, to say what was sent (never what it says). */
  attachments?: AttachmentLike[] | null;
  /** direct_message: still a message request (the recipient hasn't accepted). */
  request?: boolean;
}): NormalizedNotification {
  const { kind, role, recipientUserId, sourceId } = input;
  const staff = isStaff(role);
  const name = input.displayName ? safeDisplayName(input.displayName, TITLE[kind]) : null;
  const context = input.contextLabel ? safeDisplayName(input.contextLabel, "") : "";

  let title = TITLE[kind];
  let body = staff ? SUMMARY[kind].staff : SUMMARY[kind].client;
  if (kind === "message") {
    // Chat-app convention: who it's from is the title, what they sent is the body.
    // Staff see the client's name; clients see "Coach Jared".
    title = name ?? (staff ? "New message" : "Your coach");
    body = capitalize(messageAction(input.attachments, true)) + ".";
  } else if (kind === "direct_message") {
    // A request says who and why, never what: "Dwayne replied to your post."
    // Once they're chatting it reads like any 1:1 message.
    const atts = (input.attachments ?? []).filter(Boolean) as Array<{ kind?: string | null }>;
    const who = name ? firstName(name) : "Someone";
    if (input.request) {
      title = "Message request";
      body = atts.some((a) => a.kind === "community_post") ? `${who} replied to your post.` : `${who} wants to send you a message.`;
    } else {
      title = name ?? "New message";
      body = capitalize(messageAction(input.attachments, true)) + ".";
    }
  } else if (kind === "group_message") {
    // Group name on top (that's what you'd open), sender + action below.
    title = context || "Group chat";
    body = `${name ? firstName(name) : "Someone"} ${messageAction(input.attachments, false)}.`;
  } else if (name && context) title = `${name} · ${context}`;
  else if (name) title = `${name} · ${TITLE[kind]}`;
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
