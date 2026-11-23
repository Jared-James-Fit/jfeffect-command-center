/**
 * Two-step sign-in in the browser (two-step.ts): what this device can do,
 * what it remembers, and the words for what went wrong.
 *
 * Remembered on this device (localStorage, never a secret on its own):
 *   - the trusted-device token, per login ("Don't ask again on this device",
 *     30 days). Useless without the password: it only skips the second step
 *     of a sign-in that already passed the first. Kept across sign-out, which
 *     is the point; forgotten when the server says it no longer works.
 *   - which sessions were confirmed here, so a team login's app opens at once
 *     while the server is asked again in the background. Only ever skips a
 *     screen: the server and the database decide.
 */
import { isNative } from "@/platform";
import { phoneLayoutNow } from "@/lib/portrait-only";
import { deviceName, FASTER_OFFER_SNOOZE_DAYS, passkeyLabel, passkeyWord } from "@/lib/two-step";

const TRUST_KEY = "jf-2step-device:";
const CONFIRMED_KEY = "jf-2step-confirmed";

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ── Trusted device ──────────────────────────────────────────────────────────
export type TrustToken = { id: string; token: string; until: string };

export function readTrust(userId: string | null | undefined): TrustToken | null {
  if (!userId) return null;
  try {
    const raw = ls()?.getItem(TRUST_KEY + userId);
    const t = raw ? (JSON.parse(raw) as TrustToken) : null;
    if (!t?.token || !t.until || Date.parse(t.until) <= Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

export function saveTrust(userId: string, t: TrustToken | null | undefined): void {
  if (!t) return;
  try {
    ls()?.setItem(TRUST_KEY + userId, JSON.stringify(t));
  } catch {
    /* storage full or off: they'll be asked next time */
  }
}

export function clearTrust(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    ls()?.removeItem(TRUST_KEY + userId);
  } catch {
    /* nothing to do */
  }
}

/** Ticked to start on a phone or the installed app (personal), not on a computer (maybe shared). */
export function trustByDefault(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const standalone =
      (navigator as any).standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches;
    return isNative() || standalone || phoneLayoutNow();
  } catch {
    return false;
  }
}

// ── Sessions confirmed here ─────────────────────────────────────────────────
function confirmedList(): string[] {
  try {
    const raw = ls()?.getItem(CONFIRMED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function wasConfirmedHere(sessionId: string | null | undefined): boolean {
  return !!sessionId && confirmedList().includes(sessionId);
}

export function rememberConfirmed(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  try {
    const next = [sessionId, ...confirmedList().filter((x) => x !== sessionId)].slice(0, 5);
    ls()?.setItem(CONFIRMED_KEY, JSON.stringify(next));
  } catch {
    /* fine: the gate asks the server instead */
  }
}

export function forgetConfirmed(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  try {
    ls()?.setItem(CONFIRMED_KEY, JSON.stringify(confirmedList().filter((x) => x !== sessionId)));
  } catch {
    /* nothing to do */
  }
}

// ── "Not now" on the faster-way offer ───────────────────────────────────────
const OFFER_KEY = "jf-2step-offer-snooze:";

export function fasterOfferSnoozed(userId: string | null | undefined): boolean {
  if (!userId) return true;
  try {
    const until = Number(ls()?.getItem(OFFER_KEY + userId) ?? 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function snoozeFasterOffer(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    ls()?.setItem(OFFER_KEY + userId, String(Date.now() + FASTER_OFFER_SNOOZE_DAYS * 86_400_000));
  } catch {
    /* they'll be offered it again next time */
  }
}

// ── Passkeys here ───────────────────────────────────────────────────────────
function ua(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}
function touchMac(): boolean {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * Whether this browser can use a passkey at all. Not in the iPhone or Android
 * app: their web views need the app to be tied to jfeffect.com first, so the
 * app offers a text or the authenticator instead.
 */
export function passkeysPossibleHere(): boolean {
  if (typeof window === "undefined" || isNative()) return false;
  return typeof (window as any).PublicKeyCredential === "function" && !!navigator.credentials;
}

/** Whether this device has Face ID / Touch ID / Windows Hello / a screen lock to make one with. */
export async function platformPasskeyReady(): Promise<boolean> {
  if (!passkeysPossibleHere()) return false;
  try {
    const PKC = (window as any).PublicKeyCredential;
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
    // Some browsers never answer; never hold the screen for it.
    return await Promise.race([
      PKC.isUserVerifyingPlatformAuthenticatorAvailable() as Promise<boolean>,
      new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
    ]);
  } catch {
    return false;
  }
}

/** "Face ID", "Touch ID", "Windows Hello"… for this device. */
export function passkeyWordHere(): string {
  return passkeyWord(ua(), { touch: touchMac() });
}

/** A heading for it: "Face ID", "Touch ID", "Windows Hello", else "Passkey". */
export function passkeyTitleHere(): string {
  const w = passkeyWordHere();
  return w.startsWith("your ") ? "Passkey" : w;
}

/** "Face ID · iPhone", the name a passkey made here is saved with. */
export function passkeyLabelHere(): string {
  return passkeyLabel(ua(), { touch: touchMac() });
}

/** "iPhone", "Mac"… the name this device is trusted under. */
export function deviceNameHere(): string {
  return deviceName(ua(), { touch: touchMac() });
}

/** Words for a passkey the browser refused or the person cancelled. */
export function passkeyErrorText(e: unknown, word = passkeyWordHere()): string {
  const name = (e as any)?.name ?? "";
  if (name === "NotAllowedError" || name === "AbortError")
    return `${word} was cancelled or timed out. Try again, or use another way.`;
  if (name === "InvalidStateError") return "This device already has a passkey for your login.";
  if (name === "SecurityError") return "Passkeys don't work on this address. Use another way.";
  if (name === "NotSupportedError") return "This device can't make a passkey. Use another way.";
  return (e as any)?.message || "That didn't work. Try again, or use another way.";
}

// ── Reading a texted code on Android (WebOTP) ───────────────────────────────
/**
 * On Android Chrome, the code arrives in the box by itself (the text ends with
 * "@jfeffect.com #123456"). An iPhone offers it above the keyboard instead
 * (autocomplete="one-time-code"). Null when there's no WebOTP or it's stopped.
 */
export async function listenForSmsCode(signal: AbortSignal): Promise<string | null> {
  if (typeof window === "undefined" || !("OTPCredential" in window) || !navigator.credentials)
    return null;
  try {
    const cred: any = await navigator.credentials.get({
      otp: { transport: ["sms"] },
      signal,
    } as any);
    const code = String(cred?.code ?? "").replace(/\D/g, "");
    return code.length === 6 ? code : null;
  } catch {
    return null;
  }
}
