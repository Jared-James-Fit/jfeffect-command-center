/**
 * Coach workspaces: the words and small rules the screens and the server
 * share (pure, tested in coach-workspace.test.ts). The database decides who
 * may do what (20270510090000_coach_workspaces.sql); this only says it.
 */

/** The consent a client gives when they accept, stored word for word on the relationship. */
export const CLIENT_CONSENT_VERSION = "workspace-client-consent-2026-11-22";

export function clientConsentText(business: string): string {
  const b = business.trim() || "this coach";
  return `I agree to share my training, nutrition and progress records in JF Effect with ${b} and the coaches they assign, including what I logged before today. I can end this any time from my account, and they lose access when I do. Nothing I share is deleted when it ends.`;
}

/** A token is 24 random bytes (192 bits), base64url; only its SHA-256 is stored. */
export const INVITE_TOKEN_BYTES = 24;
export const INVITE_DAYS = 14;

export const inviteLink = (origin: string, token: string) => `${origin.replace(/\/$/, "")}/invite/${token}`;

export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** What an invitation link says before it's accepted. */
export type InvitePeek = {
  state: "open" | "accepted" | "cancelled" | "expired" | "locked" | "unavailable" | "invalid";
  kind?: "client" | "member";
  role?: "admin" | "coach" | null;
  business?: string;
  expires_at?: string;
};

export const PEEK_WORDS: Record<InvitePeek["state"], string> = {
  open: "",
  accepted: "This invitation has already been accepted.",
  cancelled: "This invitation was cancelled. Ask your coach for a new one.",
  expired: "This invitation has run out. Ask your coach for a new one.",
  locked: "This invitation is locked after too many tries from other logins. Ask your coach for a new one.",
  unavailable: "This workspace isn't taking new clients right now.",
  invalid: "This link isn't a valid invitation.",
};

/** Why an accept didn't go through, in words. */
export const ACCEPT_WORDS: Record<string, string> = {
  wrong_login: "This invitation was sent to a different email. Sign in with the email your coach invited (and confirm it), then open the link again.",
  already_athlete: "This account already trains with JF Effect. For now a coach invitation needs an email that isn't on JF Effect yet. Ask your coach to invite a different email, or contact support.",
  on_team: "You're on this coach's team, so you can't also be their client.",
};

export type RosterRow = {
  client_id: string;
  full_name: string | null;
  email: string | null;
  status: "active" | "paused" | "ended";
  assigned_user_id: string | null;
  started_at: string;
};

/** The roster as the coach reads it: active first (newest first), then paused, then ended. */
export function sortRoster(rows: readonly RosterRow[]): RosterRow[] {
  const rank = { active: 0, paused: 1, ended: 2 } as const;
  return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || b.started_at.localeCompare(a.started_at));
}

export const STATUS_WORD: Record<RosterRow["status"], string> = { active: "Active", paused: "Paused (free)", ended: "Ended" };
