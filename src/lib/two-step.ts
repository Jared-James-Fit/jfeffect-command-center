/**
 * Two-step sign-in by text message, passkey or trusted device, beside the
 * authenticator app (mfa-rules.ts, 20270512090000_two_step_sms_passkeys.sql).
 *
 * After their password a team login confirms it's them one of three ways:
 *   passkey  Face ID / Touch ID / the device's lock (webauthn.ts)
 *   sms      a 6-digit code texted to a phone number they confirmed
 *   totp     the authenticator app's code (Supabase's own, as before)
 * and can tick "Don't ask again on this device" for 30 days. A session
 * confirmed any of these ways counts everywhere aal2 does: the app's gate, the
 * server's guard and the database's role checks.
 *
 * Pure: the rules, the words, the code format. No Supabase, no React.
 */
import { normalizePhone } from "@/lib/sms-policy";

export type TwoStepKind = "passkey" | "sms" | "totp";

/** A way to confirm, as the app shows it (never a phone number in full or a key). */
export type TwoStepMethod = {
  id: string;
  kind: TwoStepKind;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
};

export const CODE_DIGITS = 6;
export const CODE_TTL_S = 600;
export const RESEND_AFTER_S = 30;
export const TRIES_PER_CODE = 5;
export const TRUST_DAYS = 30;
export const MAX_PHONES = 3;
export const MAX_PASSKEYS = 10;

/** Team roles (everyone but a client or a member): who has two-step sign-in at all. */
export function isTeamRole(role: string | null | undefined): boolean {
  return !!role && role !== "client" && role !== "member";
}

// ── Codes ───────────────────────────────────────────────────────────────────
/**
 * A 6-digit code from random 32-bit words, without the slight lean a plain
 * modulo gives the low numbers (words over the last full million are skipped).
 */
export function codeFromRandom(words: ArrayLike<number>): string | null {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] >>> 0;
    if (w < limit) return String(w % 1_000_000).padStart(CODE_DIGITS, "0");
  }
  return null;
}

export function newSmsCode(): string {
  for (;;) {
    const code = codeFromRandom(crypto.getRandomValues(new Uint32Array(4)));
    if (code) return code;
  }
}

/** What someone typed, as 6 digits, or null. */
export function normalizeSmsCode(input: string | null | undefined): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits.length === CODE_DIGITS ? digits : null;
}

/** The code's hash: tied to the login and the session it was sent for. */
export async function smsCodeHash(
  userId: string,
  sessionId: string,
  code: string,
): Promise<string> {
  const data = new TextEncoder().encode(`jf-2step:${userId}:${sessionId}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The text. One segment, the code first (it's what the lock screen shows),
 * and the domain-bound last line ("@jfeffect.com #123456") so an iPhone and
 * Android offer it only on jfeffect.com, never on a look-alike site.
 */
export function smsCodeText(code: string, purpose: "sign_in" | "add_phone"): string {
  const what = purpose === "add_phone" ? "to add this phone to two-step sign-in" : "to sign in";
  return `${code} is your JF Effect code ${what}. It expires in 10 minutes. Never share it.\n\n@jfeffect.com #${code}`;
}

// ── Phones ──────────────────────────────────────────────────────────────────
/** A phone two-step can text: North American (+1), as the SMS sender allows. */
export function twoStepPhone(raw: string | null | undefined): string | null {
  const e164 = normalizePhone(raw);
  return e164 && /^\+1\d{10}$/.test(e164) ? e164 : null;
}

/** "(•••) •••-4821": enough to know which phone, never the number. */
export function maskPhone(e164: string | null | undefined): string {
  const digits = String(e164 ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `(•••) •••-${digits.slice(-4)}` : "your phone";
}

export function smsLabel(e164: string): string {
  return `Text to ${maskPhone(e164)}`;
}

// ── Devices ─────────────────────────────────────────────────────────────────
/** What a device is called on the list: "iPhone", "Mac", "Android phone"… */
export function deviceName(ua: string | null | undefined, opts: { touch?: boolean } = {}): string {
  const s = String(ua ?? "");
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s) || (/Macintosh/i.test(s) && opts.touch)) return "iPad";
  if (/Android/i.test(s)) return /Mobile/i.test(s) ? "Android phone" : "Android tablet";
  if (/Macintosh|Mac OS X/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows PC";
  if (/CrOS/i.test(s)) return "Chromebook";
  if (/Linux/i.test(s)) return "Linux computer";
  return "This device";
}

/** What the device's passkey is called on its own: "Face ID", "Touch ID", "Windows Hello"… */
export function passkeyWord(ua: string | null | undefined, opts: { touch?: boolean } = {}): string {
  const d = deviceName(ua, opts);
  if (d === "iPhone" || d === "iPad") return "Face ID";
  if (d === "Mac") return "Touch ID";
  if (d === "Windows PC") return "Windows Hello";
  if (d.startsWith("Android")) return "your fingerprint or screen lock";
  return "your device's lock";
}

/** The label a passkey is saved with: "Face ID · iPhone". */
export function passkeyLabel(
  ua: string | null | undefined,
  opts: { touch?: boolean } = {},
): string {
  const word = passkeyWord(ua, opts);
  const device = deviceName(ua, opts);
  if (word.startsWith("your")) return `Passkey · ${device}`;
  return `${word} · ${device}`;
}

// ── Which way first ─────────────────────────────────────────────────────────
/**
 * The order to offer a login's ways on this device: the one they chose
 * first, then passkey (one tap), then text, then the authenticator app. A
 * passkey is left out where this device can't use one (the iPhone app).
 */
export function orderMethods(
  methods: TwoStepMethod[],
  preferred: TwoStepKind | null | undefined,
  passkeyHere: boolean,
): TwoStepMethod[] {
  const usable = methods.filter((m) => m.kind !== "passkey" || passkeyHere);
  const rank = (k: TwoStepKind) =>
    k === preferred ? 0 : k === "passkey" ? 1 : k === "sms" ? 2 : 3;
  return [...usable].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")),
  );
}

/** One entry per kind, in order (the gate offers a kind once, then picks within it). */
export function kindsInOrder(methods: TwoStepMethod[]): TwoStepKind[] {
  const out: TwoStepKind[] = [];
  for (const m of methods) if (!out.includes(m.kind)) out.push(m.kind);
  return out;
}

// ── A faster way ────────────────────────────────────────────────────────────
/** Days "Not now" keeps the faster-way offer away on a device. */
export const FASTER_OFFER_SNOOZE_DAYS = 14;

/**
 * Offer Face ID or a text right after confirming, when the login can only
 * confirm here with the authenticator app: no phone, and no passkey this
 * device can use. A login that already has a faster way is never asked.
 */
export function needsFasterWay(methods: TwoStepMethod[], passkeyHere: boolean): boolean {
  if (methods.length === 0) return false;
  if (methods.some((m) => m.kind === "sms")) return false;
  return !(passkeyHere && methods.some((m) => m.kind === "passkey"));
}

/** Removing this one would leave only passkeys, which the iPhone and Android apps can't use. */
export function leavesOnlyPasskeys(methods: TwoStepMethod[], removing: TwoStepMethod): boolean {
  const rest = methods.filter((m) => !(m.kind === removing.kind && m.id === removing.id));
  return rest.length > 0 && rest.every((m) => m.kind === "passkey");
}

// ── The gate ────────────────────────────────────────────────────────────────
export type TwoStepStatus = {
  team: boolean;
  required: boolean;
  /** This session has been confirmed (aal2, or marked by the server). */
  verified: boolean;
  methods: TwoStepMethod[];
  preferred: TwoStepKind | null;
  /** Their phone on file, offered when they add text messages (never anyone else's). */
  suggestedPhone: string | null;
};

export type TwoStepGateStep = "pass" | "check" | "verify" | "enroll";

/**
 * What the app shows a signed-in person:
 *   pass    a client or member with no authenticator; a session already
 *           confirmed (aal2 with an authenticator, or remembered here while
 *           the server is asked again in the background);
 *   check   a team login we don't know about yet: ask the server first;
 *   verify  they have a way and this session hasn't used it;
 *   enroll  their role needs one and they have none.
 * The screen is never the lock: the server and the database refuse an
 * unconfirmed session whatever the screen shows.
 */
export function twoStepGateStep(input: {
  team: boolean;
  required: boolean;
  aal: string | null | undefined;
  verifiedFactors: number;
  rememberedVerified: boolean;
  status: Pick<TwoStepStatus, "verified" | "methods"> | null;
}): TwoStepGateStep {
  if (!input.team && input.verifiedFactors === 0) return "pass";
  if (input.status) {
    if (input.status.methods.length === 0) return input.required ? "enroll" : "pass";
    return input.status.verified ? "pass" : "verify";
  }
  if (input.verifiedFactors > 0 && input.aal === "aal2") return "pass";
  if (input.rememberedVerified) return "pass";
  return "check";
}

// ── Words ───────────────────────────────────────────────────────────────────
export function waitWords(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  const m = Math.ceil(seconds / 60);
  if (m < 60) return m === 1 ? "a minute" : `${m} minutes`;
  const h = Math.ceil(m / 60);
  return h === 1 ? "an hour" : `${h} hours`;
}

export type SendRefusal = "cooldown" | "hourly" | "daily" | "locked" | "blocked" | "failed";

export function sendRefusalText(reason: SendRefusal | string, waitS?: number | null): string {
  switch (reason) {
    case "cooldown":
      return `A code was just sent. You can ask for another in ${waitWords(waitS ?? 30)}.`;
    case "hourly":
      return `That's the most codes for an hour. Try again in ${waitWords(waitS ?? 3600)}, or use another way.`;
    case "daily":
    case "security_daily_cap":
      return "That's the most codes for today. Use another way to confirm.";
    case "locked":
      return `Too many wrong codes. Try again in ${waitWords(waitS ?? 3600)}, or use another way.`;
    case "security_texts_off":
    case "sms_disabled":
    case "not_configured":
    case "no_from_phone":
      return "Texts can't be sent right now. Use another way to confirm.";
    case "country_not_allowed":
      return "Codes can only be texted to a Canadian or US number.";
    default:
      return "The text didn't go. Check the number, try again in a minute, or use another way.";
  }
}

export type CheckRefusal = "none" | "expired" | "wrong" | "used_up" | "locked" | "format";

export function checkRefusalText(
  reason: CheckRefusal | string,
  left?: number | null,
  waitS?: number | null,
): string {
  switch (reason) {
    case "format":
      return "The code is 6 numbers.";
    case "wrong":
      return left && left > 0
        ? `That code didn't work. ${left === 1 ? "One more try" : `${left} more tries`}, then ask for a new one.`
        : "That code didn't work.";
    case "used_up":
      return "Too many wrong tries for that code. Ask for a new one.";
    case "expired":
      return "That code ran out. Ask for a new one.";
    case "locked":
      return `Too many wrong codes. Try again in ${waitWords(waitS ?? 3600)}, or use another way.`;
    default:
      return "Ask for a new code, then type it here.";
  }
}

export const KIND_TITLE: Record<TwoStepKind, string> = {
  passkey: "Face ID or Touch ID",
  sms: "Text message",
  totp: "Authenticator app",
};

export const KIND_BLURB: Record<TwoStepKind, string> = {
  passkey: "Confirm with your face, fingerprint or device lock. The fastest.",
  sms: "We text you a 6-digit code.",
  totp: "A code from an app like Google Authenticator or the iPhone's Passwords app.",
};
