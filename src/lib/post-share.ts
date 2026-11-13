/**
 * A post's share sheet (✈️), Instagram's: the people you're most likely to
 * send it to on top (community_share_targets ranks them from who you actually
 * talk to and send posts to), pick one or several, add a message, Send
 * (community_share_post, 20270312090000_share_sheet.sql); underneath, every
 * other way out: Add to story, Copy link, Save, Messages, Share to…,
 * WhatsApp, Snapchat, Messenger, Facebook, X, Threads, Email.
 *
 * Everything here is pure (links, labels, what a send's results say), so the
 * sheet and the tests read one set of rules.
 */
import { SITE_URL } from "@/lib/share-meta";

export type ShareTargetKind = "person" | "group" | "coach" | "client";

/** Someone (or a chat) a post can go to: `key` is what community_share_post takes. */
export type ShareTarget = {
  key: string;
  kind: ShareTargetKind;
  name: string;
  avatar_url: string | null;
  username?: string | null;
  user_id?: string | null;
  group_id?: string | null;
  client_id?: string | null;
  is_coach?: boolean | null;
  /** A group chat's circle: up to two of its members' photos. */
  faces?: (string | null)[] | null;
};

/** At most this many chats in one send (the database refuses more). */
export const SHARE_SEND_MAX = 20;

/**
 * The post's own link, the one Copy link and every app share: it opens the
 * post for anyone in the crew who can see it, and asks anyone else to join
 * or sign in (it never shows the post itself to someone who isn't in).
 */
export function postLink(postId: string): string {
  return `${SITE_URL}/p/${postId}`;
}

/** The words that go with the link: "Dwayne's post on JF Effect", or "My post on JF Effect" for your own. */
export function postShareText(post: { is_mine?: boolean | null; story?: boolean | null; author: { name: string } }): string {
  const what = post.story ? "story" : "post";
  if (post.is_mine) return `My ${what} on JF Effect`;
  const first = (post.author.name || "").trim().split(/\s+/)[0] || "A";
  return `${first}'s ${what} on JF Effect`;
}

export type SharePlatform = "ios" | "android" | "desktop";

/** The apps a post can go out to, besides Copy link, Save and Share to…. */
export type ShareApp = "messages" | "whatsapp" | "snapchat" | "messenger" | "facebook" | "x" | "threads" | "email";

export const SHARE_APP_LABEL: Record<ShareApp, string> = {
  messages: "Messages",
  whatsapp: "WhatsApp",
  snapchat: "Snapchat",
  messenger: "Messenger",
  facebook: "Facebook",
  x: "X",
  threads: "Threads",
  email: "Email",
};

/**
 * Which apps to offer, in Instagram's order. Messages is a phone's (sms:).
 * Messenger has no link a web page can open on an iPhone (Meta's fb-messenger
 * scheme only works on Android), so there it hands the link to the phone's
 * own share sheet, where Messenger is one of the apps; on a computer it's left
 * out unless that sheet exists.
 */
export function shareAppsFor(platform: SharePlatform, canNativeShare: boolean): ShareApp[] {
  const phone = platform !== "desktop";
  return [
    ...(phone ? (["messages"] as const) : []),
    "whatsapp",
    "snapchat",
    ...(platform === "android" || canNativeShare ? (["messenger"] as const) : []),
    "facebook",
    "x",
    "threads",
    "email",
  ];
}

/**
 * The link that opens an app with the post's link in it, or null when the app
 * goes through the phone's share sheet instead (Messenger on an iPhone).
 * Every value is percent-encoded; the formats are each app's documented
 * share link (wa.me, Snapchat's share link, Facebook's sharer, X's and
 * Threads' post intents).
 */
export function shareAppHref(app: ShareApp, link: string, text: string, platform: SharePlatform): string | null {
  const e = encodeURIComponent;
  switch (app) {
    case "messages":
      // "sms:?&body=" is the one form both iPhones and Android read
      return `sms:?&body=${e(`${text} ${link}`)}`;
    case "whatsapp":
      return `https://wa.me/?text=${e(`${text} ${link}`)}`;
    case "snapchat":
      return `https://www.snapchat.com/share?link=${e(link)}`;
    case "messenger":
      return platform === "android" ? `fb-messenger://share/?link=${e(link)}` : null;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${e(link)}`;
    case "x":
      return `https://x.com/intent/post?text=${e(text)}&url=${e(link)}`;
    case "threads":
      return `https://www.threads.com/intent/post?text=${e(text)}&url=${e(link)}`;
    case "email":
      return `mailto:?subject=${e(text)}&body=${e(`${text}\n\n${link}`)}`;
  }
}

/** An app link that leaves for the web (opened in a new tab) rather than a scheme the phone hands to an app. */
export function opensInNewTab(href: string): boolean {
  return /^https:\/\//.test(href);
}

/** Tap a face: in if it's out, out if it's in (never past SHARE_SEND_MAX). */
export function toggleTarget(selected: readonly string[], key: string): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= SHARE_SEND_MAX) return [...selected];
  return [...selected, key];
}

/** Instagram's button: one chat is "Send", several go to each on their own. */
export function sendLabel(count: number): string {
  return count > 1 ? "Send separately" : "Send";
}

/** The small line under a face, only where the name alone doesn't say what it is. */
export function targetSubtitle(t: Pick<ShareTarget, "kind">): string | null {
  if (t.kind === "coach") return "Coach chat";
  if (t.kind === "group") return "Group";
  return null;
}

export type ShareResult = {
  key: string;
  ok: boolean;
  route?: "direct" | "group" | "coach" | "client";
  status?: "request" | "active";
  group_id?: string;
  client_id?: string;
  message_id?: string;
  error?: string;
  /** The same send a moment ago (a double tap): nothing new went out. */
  repeat?: boolean;
};

/** Database messages → words a person would say (direct-chats' friendlyError, plus the share's own). */
export function shareErrorText(message: string | null | undefined): string {
  const m = message ?? "";
  if (/request_daily_limit/.test(m)) return "That's a lot of new people for one day. You can message more tomorrow.";
  if (/request_limit/.test(m)) return "You can send more once they reply.";
  if (/row-level security|violates|42501|Not allowed/i.test(m)) return "That didn't send. Try again in a moment.";
  return m || "That didn't send. Try again.";
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * What a send says when it's done: "Sent to Dwayne", "Request sent to
 * Shaina" (a new 1:1 with someone who doesn't follow you), "Sent to Dwayne,
 * Colten and 2 more", and for any that didn't go, why ("Couldn't send to
 * Dave: They can't see this post").
 */
export function shareOutcome(results: ShareResult[], targets: Pick<ShareTarget, "key" | "name">[]): {
  sent: ShareResult[];
  failed: ShareResult[];
  message: string | null;
  error: string | null;
} {
  const nameOf = (key: string) => {
    const n = targets.find((t) => t.key === key)?.name?.trim() || "them";
    return n.split(/\s+/)[0];
  };
  const sent = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  let message: string | null = null;
  if (sent.length === 1) {
    const r = sent[0];
    message = r.route === "direct" && r.status === "request" ? `Request sent to ${nameOf(r.key)}` : `Sent to ${nameOf(r.key)}`;
  } else if (sent.length > 1) {
    message = `Sent to ${nameList(sent.map((r) => nameOf(r.key)))}`;
  }
  let error: string | null = null;
  if (failed.length === 1) error = `Couldn't send to ${nameOf(failed[0].key)}: ${shareErrorText(failed[0].error)}`;
  else if (failed.length > 1) {
    const reasons = [...new Set(failed.map((f) => shareErrorText(f.error)))];
    error = `Couldn't send to ${nameList(failed.map((f) => nameOf(f.key)))}${reasons.length === 1 ? `: ${reasons[0]}` : ""}`;
  }
  return { sent, failed, message, error };
}

/** Faces matching what's typed, while the server's search catches up (name or @username, word starts first). */
export function filterTargets<T extends Pick<ShareTarget, "name" | "username">>(list: readonly T[], query: string): T[] {
  const q = query.trim().replace(/^@+/, "").toLowerCase();
  if (!q) return [...list];
  const rank = (t: T) => {
    const name = (t.name ?? "").toLowerCase();
    const user = (t.username ?? "").toLowerCase();
    if (user.startsWith(q)) return 0;
    if (name.startsWith(q)) return 1;
    if (` ${name}`.includes(` ${q}`)) return 2;
    if (name.includes(q) || user.includes(q)) return 3;
    return -1;
  };
  return list
    .map((t, i) => ({ t, i, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/** The ranked faces, then anyone the search found that isn't already there (each key once). */
export function mergeTargets(first: readonly ShareTarget[], more: readonly ShareTarget[]): ShareTarget[] {
  const seen = new Set(first.map((t) => t.key));
  return [...first, ...more.filter((t) => !seen.has(t.key) && seen.add(t.key))];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where a post's link (/p/<id>) lands someone who's signed in: their own
 * Crew page with the post open (`#post=<id>`), the staff Crew page for a
 * coach (or the client one in a dual account's client view). A link that
 * isn't a post id just lands on Crew.
 */
export function postLinkTarget(postId: string, role: string | null | undefined, view: "client" | "staff" | null): { to: string; hash?: string } {
  const staff = (role === "admin" || role === "coach") && view !== "client";
  const to = staff ? "/admin/community" : "/portal/community";
  return UUID.test(postId) ? { to, hash: `post=${postId.toLowerCase()}` } : { to };
}
