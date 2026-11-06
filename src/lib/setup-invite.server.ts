// Server-only: the signed token in a no-email setup link (setup-invite.ts).
// It names one client record, can't be forged or edited, and expires; it only
// ever lets someone ask for the setup email, never sign in.
import { createHmac, timingSafeEqual } from "crypto";
import { SETUP_INVITE_DAYS } from "@/lib/setup-invite";

const PREFIX = "setup-invite:v1:";

function secret(): string {
  const s = process.env.SETUP_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Setup links can't be signed: no server secret configured.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(PREFIX + payload).digest("hex").slice(0, 32);
}

/** "<clientId>.<expires unix s>.<sig>" */
export function signSetupInvite(clientId: string, days = SETUP_INVITE_DAYS, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + days * 86_400;
  const payload = `${clientId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** The client a valid, unexpired setup invite names; null for anything else. */
export function verifySetupInvite(token: string | null | undefined, now = Date.now()): string | null {
  if (!token || typeof token !== "string" || token.length > 120) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [clientId, expRaw, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !/^\d{9,11}$/.test(expRaw) || !/^[0-9a-f]{32}$/.test(sig)) return null;
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
