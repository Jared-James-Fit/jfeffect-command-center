// Server-only: personal booking links. When the coach sends a booking link to
// a specific client, the link carries a signed token naming that client, so
// the client books as themselves (their sessions, their calendar) without
// signing in. Only staff can mint one; it can't be forged or edited, and it
// expires.
import { createHmac, timingSafeEqual } from "crypto";

const PREFIX = "booking-invite:v1:";
const DEFAULT_DAYS = 45;

function secret(): string {
  const s = process.env.BOOKING_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Booking links can't be signed: no server secret configured.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret())
    .update(PREFIX + payload)
    .digest("hex")
    .slice(0, 32);
}

/** "<clientId>.<expires unix s>.<sig>" */
export function signBookingInvite(clientId: string, days = DEFAULT_DAYS, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + days * 86_400;
  const payload = `${clientId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** The client a valid, unexpired invite names; null for anything else. */
export function verifyBookingInvite(
  token: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!token || typeof token !== "string" || token.length > 120) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [clientId, expRaw, sig] = parts;
  if (
    !/^[0-9a-f-]{36}$/i.test(clientId) ||
    !/^\d{9,11}$/.test(expRaw) ||
    !/^[0-9a-f]{32}$/.test(sig)
  )
    return null;
  if (Number(expRaw) * 1000 < now) return null;
  let expected: string;
  try {
    expected = sign(`${clientId}.${expRaw}`);
  } catch {
    return null;
  }
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? clientId : null;
}
