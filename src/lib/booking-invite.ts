/**
 * Personal booking links, the rules every side reads (pure, tested in
 * booking-invite.test.ts; the server half is booking-invite.server.ts).
 *
 * A link the coach sends one client is jfeffect.com/b/<token>: 32 random
 * characters that name nobody. The server keeps only a hash of the token and
 * resolves it to the client, the booking type and the length he picked, so the
 * client opens it anywhere (the chat, a text, an email, signed out, private
 * browsing) and just picks a time.
 */

/** How long a personal link works. */
export const INVITE_DAYS = 30;

/** A new link's token: 24 random bytes, base64url (32 characters). */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** A link minted before Nov 20 2026: "<client uuid>.<expiry>.<hmac>" (read until it runs out, never minted). */
export const LEGACY_INVITE_RE = /^[0-9a-f-]{36}\.\d{9,11}\.[0-9a-f]{32}$/i;

export function isInviteToken(t: unknown): t is string {
  return typeof t === "string" && INVITE_TOKEN_RE.test(t);
}

export function invitePath(token: string): string {
  return `/b/${token}`;
}

/** The token in a link the app made (`/b/<token>`, absolute or not); null for anything else. */
export function tokenFromInviteUrl(url: string | null | undefined): string | null {
  const m = String(url ?? "").match(/\/b\/([A-Za-z0-9_-]{32})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Where a link stands:
 *   ok       books as its client
 *   booked   its booking still stands (booked, done or counted as missed): it shows that booking
 *   expired  past its date
 *   revoked  the coach cancelled it, or the client is no longer active
 *   invalid  no such link
 */
export type InviteState = "ok" | "booked" | "expired" | "revoked" | "invalid";

/** Session statuses that keep a link's booking standing (Cancelled / Rescheduled free it again). */
export const STANDING_SESSION_STATUSES = ["Scheduled", "Completed", "Missed"] as const;

export function inviteState(
  row: {
    expires_at: string;
    revoked_at: string | null;
    booked_session_id: string | null;
  } | null,
  o: { clientActive: boolean; bookedStatus: string | null; now?: Date },
): InviteState {
  if (!row) return "invalid";
  if (row.revoked_at || !o.clientActive) return "revoked";
  if (new Date(row.expires_at).getTime() <= (o.now ?? new Date()).getTime()) return "expired";
  if (
    row.booked_session_id &&
    o.bookedStatus &&
    (STANDING_SESSION_STATUSES as readonly string[]).includes(o.bookedStatus)
  ) {
    return "booked";
  }
  return "ok";
}

/** What the booking page says for a link it can't book with. */
export function inviteStateMessage(
  state: InviteState,
  coachFirst: string,
): { title: string; body: string } | null {
  const coach = coachFirst || "your coach";
  switch (state) {
    case "expired":
      return {
        title: "This booking link has expired",
        body: `Ask ${coach} for a new one, or sign in to book.`,
      };
    case "revoked":
      return {
        title: "This booking link isn't active anymore",
        body: `Ask ${coach} for a new one, or sign in to book.`,
      };
    case "invalid":
      return {
        title: "This booking link doesn't work",
        body: `Check you have the whole link, or ask ${coach} for a new one.`,
      };
    default:
      return null;
  }
}

/**
 * Who a booking is for, decided on the server from what it can prove:
 *   - a link that works books as its client;
 *   - someone signed in as a client who isn't the link's client books as
 *     themselves: the link is ignored and nothing about its client is shown
 *     (a forwarded link never books on someone else's account while they're
 *     signed in as themselves);
 *   - staff (the coach testing his own link, a dual account) never turn a
 *     client's link into their own booking: the link decides;
 *   - the link's own client signed in books as themselves either way, so a
 *     link that ran out never blocks them.
 */
export type BookingIdentity = {
  /** The client the booking is for; null = the public (an appointment, never credits). */
  clientId: string | null;
  /** client_app = signed in as them; booking_page = the link alone (or nobody). */
  via: "client_app" | "booking_page";
  /** The link is what's booking: its length is used and the booking is kept on it. */
  inviteApplies: boolean;
  /** The link's state to show instead of times (it can't book and nobody signed in can). */
  blockedBy: InviteState | null;
};

export function pickBookingIdentity(o: {
  invite: { state: InviteState; clientId: string | null } | null;
  signedIn: { clientId: string | null; staff: boolean } | null;
}): BookingIdentity {
  const me = o.signedIn?.clientId ?? null;
  const staff = !!o.signedIn?.staff;
  const inv = o.invite;
  if (!inv)
    return {
      clientId: me,
      via: me ? "client_app" : "booking_page",
      inviteApplies: false,
      blockedBy: null,
    };
  // Signed in as a client (not staff): their own account always wins.
  if (me && !staff) {
    const same = inv.clientId === me;
    return {
      clientId: me,
      via: "client_app",
      inviteApplies: same && (inv.state === "ok" || inv.state === "booked"),
      blockedBy: same && inv.state === "booked" ? "booked" : null,
    };
  }
  if (inv.state === "ok")
    return { clientId: inv.clientId, via: "booking_page", inviteApplies: true, blockedBy: null };
  if (inv.state === "booked")
    return {
      clientId: inv.clientId,
      via: "booking_page",
      inviteApplies: true,
      blockedBy: "booked",
    };
  return { clientId: null, via: "booking_page", inviteApplies: false, blockedBy: inv.state };
}

/** The coach's card line for a link nobody has booked from yet. */
export function inviteWaitingLine(o: {
  revokedAt: string | null;
  expiresAt: string | null;
  firstOpenedAt: string | null;
  now?: Date;
}): string {
  if (o.revokedAt) return "Link cancelled";
  if (o.expiresAt && new Date(o.expiresAt).getTime() <= (o.now ?? new Date()).getTime())
    return "Link expired";
  return o.firstOpenedAt ? "Opened, no time picked yet" : "Waiting for them to pick a time";
}
