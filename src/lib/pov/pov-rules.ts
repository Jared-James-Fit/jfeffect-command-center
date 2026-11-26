/**
 * Account view ("view as") rules, pure. A staff member opens an account through a session the
 * server starts (admin_pov_start: who may, why, until when); it's view-only until they switch
 * edits on, and every page opened and every change made is kept on the session.
 *
 * View-only is enforced twice: the server refuses any server call that isn't a read while the
 * view says view-only (src/start.ts, the same read rule as a team preview), and the browser stops
 * direct database writes before they leave (pov-fetch-guard.ts). The staff member's own sign-in
 * is used throughout: nobody's password, never their credentials. A guard against slips, not a
 * boundary against the staff member: what they may change, they may change from the admin screens.
 */

export const POV_SESSION_HEADER = "x-jf-pov-session";
export const POV_MODE_HEADER = "x-jf-pov-mode";
export const POV_VIEW_ONLY_MESSAGE = "View only. Switch on edits in the bar at the top to change anything in this account.";

/** How long a view stays open without activity, and at most (the server's numbers). */
export const POV_IDLE_MS = 30 * 60_000;
export const POV_MAX_MS = 4 * 60 * 60_000;
/** How often the open view reports in (and learns if it ended). */
export const POV_TOUCH_MS = 60_000;

export type PovMode = "view" | "edit";
export type PovSession = {
  id: string;
  mode: PovMode;
  expiresAt: string;
  maxUntil: string;
  editUntil: string | null;
};

export type PovStartStatus = "ok" | "reason_required" | "confirm" | "no_two_step" | "not_found" | "ended";

/** One-tap reasons (any reason can be typed instead). */
export const POV_REASONS = [
  "Support request",
  "Check their program",
  "Log a session",
  "Review their nutrition",
  "Fix their data",
  "Check their billing or plan",
] as const;

/** The reason when the coach opens today's workout to log a session (it starts with edits on). */
export const LOGGING_REASON = "Log a session";

/** Server calls that run the view itself: never refused, never recorded as a change. */
export const POV_OWN_FNS = new Set(["startPovSessionFn", "setPovModeFn", "touchPovFn", "endPovFn", "povLogFn"]);

export type RequestKind = { kind: "read" | "write"; target: string | null };

const WRITE_VERBS = new Set([
  "set", "save", "add", "create", "update", "delete", "remove", "react", "like", "unlike", "follow", "unfollow",
  "send", "post", "mark", "record", "log", "start", "finish", "complete", "claim", "toggle", "upsert", "insert",
  "apply", "assign", "archive", "restore", "move", "swap", "trash", "answer", "vote", "share", "repost", "block",
  "report", "submit", "accept", "decline", "join", "leave", "hide", "pin", "unpin", "edit", "rename", "publish",
  "dismiss", "ensure", "attach", "link", "unlink", "cancel", "book", "request", "respond", "approve", "reject",
  "grant", "revoke", "reset", "reorder", "clear", "merge", "use", "redeem", "write", "upload", "tick", "touch",
]);

/**
 * Is a database or storage request a write? `url` is the full request URL to the database.
 * Tables: anything but GET / HEAD writes. RPCs: GET reads; a POST writes when a word in its name
 * says so (community_react, workout_view_set); others read (community_feed_ranked). Storage:
 * uploads, moves and deletes write; signing a link or listing reads. Sign-in never counts.
 */
export function classifyDbRequest(url: string, method: string): RequestKind | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD" || m === "OPTIONS";
  if (path.startsWith("/auth/v1/") || path.startsWith("/realtime/")) return null;
  if (path.startsWith("/rest/v1/rpc/")) {
    const fn = decodeURIComponent(path.slice("/rest/v1/rpc/".length)).split("?")[0];
    if (read) return { kind: "read", target: `rpc:${fn}` };
    const words = fn.toLowerCase().split(/[_\W]+/);
    return { kind: words.some((w) => WRITE_VERBS.has(w)) ? "write" : "read", target: `rpc:${fn}` };
  }
  if (path.startsWith("/rest/v1/")) {
    const table = path.slice("/rest/v1/".length).split("/")[0];
    return { kind: read ? "read" : "write", target: table || null };
  }
  if (path.startsWith("/storage/v1/")) {
    if (read) return { kind: "read", target: "storage" };
    if (/^\/storage\/v1\/object\/(sign|list)\b/.test(path) || /^\/storage\/v1\/object\/upload\/sign\b/.test(path)) {
      return { kind: "read", target: "storage" };
    }
    return { kind: "write", target: `storage:${path.split("/")[4] ?? ""}` };
  }
  if (path.startsWith("/functions/v1/")) return { kind: read ? "read" : "write", target: `fn:${path.split("/")[3] ?? ""}` };
  return null;
}

/** Time left in words: "28 min", "Under a minute". */
export function timeLeft(untilIso: string | null | undefined, now = Date.now()): string {
  if (!untilIso) return "";
  const ms = Date.parse(untilIso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "Ended";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

/** Normalise a path for the access record: ids and tokens out, like analytics (no query string). */
export function povPath(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{4}-\d{2}-\d{2}\b/g, "/:date")
    .slice(0, 200);
}

/** What the start call's status means for the person starting it. */
export function startStatusWords(status: PovStartStatus): string | null {
  switch (status) {
    case "reason_required":
      return "Say why you're opening their account.";
    case "confirm":
      return "Confirm it's you to switch on edits in a member's account.";
    case "no_two_step":
      return "Set up two-step sign-in (Account → Two-step sign-in) to edit inside someone's account.";
    case "not_found":
      return "That account no longer exists.";
    case "ended":
      return "This account view has ended.";
    default:
      return null;
  }
}
