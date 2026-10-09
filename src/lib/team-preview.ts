import { useSyncExternalStore } from "react";

/**
 * "View as" for a team member's workspace (today: the finance login).
 *
 * The owner stays signed in as themselves; the app just shows the team
 * member's nav, bar and pages, and every change is switched off:
 *   - database calls from the browser go out as reads only (src/lib/admin-view.ts);
 *   - server functions get PREVIEW_HEADER and the server refuses anything
 *     that isn't a read (src/start.ts, isPreviewSafeFn).
 * The header only ever takes rights away, so a browser can't use it to gain any.
 * This is a guard against slips, not a security boundary: the owner may make
 * every one of these changes anyway.
 * Kept per tab (sessionStorage): closing the tab ends the preview.
 */

export type TeamPreview = { role: "finance"; name: string; userId: string };

export const PREVIEW_HEADER = "x-jf-preview";
export const PREVIEW_MESSAGE = "Preview: changes are off while you're viewing as a team member.";

const KEY = "jfeffect.teamPreview";
const EVT = "jf:team-preview";

function read(): TeamPreview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.role === "finance" && typeof v.name === "string" && typeof v.userId === "string" ? v : null;
  } catch {
    return null;
  }
}

let cached: TeamPreview | null | undefined;
let cachedRaw: string | null | undefined;

/** The active preview, if any (stable object between changes, for React). */
export function getTeamPreview(): TeamPreview | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = read();
  }
  return cached ?? null;
}

export function startTeamPreview(p: TeamPreview) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {}
}

export function stopTeamPreview() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {}
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useTeamPreview(): TeamPreview | null {
  return useSyncExternalStore(subscribe, getTeamPreview, () => null);
}

/**
 * Server functions a preview may call: reads, by name. Anything else (save,
 * record, send, create, delete, sync, upload...) is refused while previewing.
 * A read with an unusual name is just unavailable in the preview, never unsafe.
 */
const READ_NAME = /^(get|list|load|fetch|search|count|read|lookup|find|check|resolve|preview|describe|summari[sz]e|my|has|can|is)([A-Z0-9_]|$)/;
const WRITE_HINT = /(OrCreate|Ensure|Upsert|Save|Update|Create|Delete|Remove|Send|Record|Mark|Sync|Upload|Invite|Archive|Restore|Toggle|Approve|Reject|Claim|Grant|Revoke|Reset|Set[A-Z])/;

// Read-named functions that still change something (token rotation, cleanup).
const WRITES_DESPITE_NAME = new Set(["getSetupLink", "getCoachSetupLink", "getMemberInstallLink", "getAtHomeBackupSessionState", "getMyCalendarFeed"]);

export function isPreviewSafeFn(name: string | undefined | null): boolean {
  if (!name || WRITES_DESPITE_NAME.has(name) || !READ_NAME.test(name)) return false;
  // "getOrCreateX", "getUploadUrl": a read-sounding name that still writes.
  return !WRITE_HINT.test(name.replace(/^[a-z]+/, ""));
}
