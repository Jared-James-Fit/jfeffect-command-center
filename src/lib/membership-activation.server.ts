// Server-only: the signed links and codes that let an approved applicant in
// (membership-apply.ts). Nothing here can be forged or edited:
//
// - The activation token names one application and expires. On its own it
//   only lets someone ask for a code to be emailed; it never signs anyone in,
//   so a link the coach DMs or texts can't be used on someone else's email.
// - The email proof rides only on the link we email. Opening the email proves
//   the inbox is theirs, so that link sets a password straight away.
// - A code we email proves the same thing for someone who opened a DM'd link.
import { createHash, createHmac, randomInt, timingSafeEqual } from "crypto";

/** How long an activation link works. A new approval or a resend makes a new one. */
export const ACTIVATION_DAYS = 30;
/** How long an emailed code works, how many tries it gets, and how often one can be sent. */
export const CODE_MINUTES = 15;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 45;

const PREFIX = "membership-activate:v1:";
const PROOF = "membership-email-proof:v1:";
const CODE = "membership-code:v1:";

function secret(): string {
  const s = process.env.SETUP_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Activation links can't be signed: no server secret configured.");
  return s;
}

const mac = (purpose: string, payload: string) => createHmac("sha256", secret()).update(purpose + payload).digest("hex").slice(0, 32);

function same(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "<applicationId>.<expires unix s>.<sig>" */
export function signActivation(applicationId: string, days = ACTIVATION_DAYS, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + days * 86_400;
  const payload = `${applicationId}.${exp}`;
  return `${payload}.${mac(PREFIX, payload)}`;
}

/** The application a valid, unexpired token names; null for anything else. */
export function verifyActivation(token: string | null | undefined, now = Date.now()): string | null {
  if (!token || typeof token !== "string" || token.length > 120) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expRaw, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{9,11}$/.test(expRaw) || !/^[0-9a-f]{32}$/.test(sig)) return null;
  if (Number(expRaw) * 1000 < now) return null;
  try {
    return same(sig, mac(PREFIX, `${id}.${expRaw}`)) ? id : null;
  } catch {
    return null;
  }
}

/** The proof that whoever holds it opened the application's email (or typed its code). */
export function emailProof(applicationId: string, email: string): string {
  return mac(PROOF, `${applicationId}:${email.trim().toLowerCase()}`);
}

export function proofOk(applicationId: string, email: string, proof: string | null | undefined): boolean {
  if (!proof || !/^[0-9a-f]{32}$/i.test(proof)) return false;
  try {
    return same(proof, emailProof(applicationId, email));
  } catch {
    return false;
  }
}

/** A 6-digit code (only its hash is kept, `codeHash`). */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function codeHash(applicationId: string, code: string): string {
  return createHash("sha256").update(`${CODE}${secret()}:${applicationId}:${code}`).digest("hex");
}

/** A short, salted hash of the caller's address, for rate limits only (never the address). */
export function ipHash(ip: string | null | undefined): string | null {
  const v = String(ip ?? "").trim();
  if (!v) return null;
  try {
    return createHash("sha256").update(`ip:${secret()}:${v}`).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}
