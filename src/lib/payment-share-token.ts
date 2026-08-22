/**
 * payment-share-token.ts
 *
 * Pure helpers for JF Effect short payment share links (`/pay/<token>`).
 *
 * WHY THIS EXISTS
 * Stripe Checkout Session URLs (checkout.stripe.com/c/pay/cs_live_...#fidkd...)
 * are hundreds of characters long and contain a `#` fragment plus percent
 * encoding. Safari accepts the pasted string, but iMessage's link detector
 * splits it: it linkifies only a prefix and leaves the rest as plain text, so
 * the tapped link is a truncated (invalid) Stripe URL. A short https URL with
 * no fragment and no encoded payload is always detected as ONE link.
 *
 * Nothing here talks to Stripe or the database.
 */

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const SHARE_TOKEN_LENGTH = 12;
const TOKEN_RE = new RegExp(`^[${TOKEN_ALPHABET}]{10,32}$`);

/** Random, unguessable, URL-safe token. Carries no data by itself. */
export function generateShareToken(length: number = SHARE_TOKEN_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

export function isValidShareToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Build the canonical short share URL. Always one clean https URL, no fragment. */
export function buildShareUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/pay/${token}`;
}

export function isJfShareUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^\/pay\/[^/]+$/.test(u.pathname) && !u.hash;
  } catch {
    return false;
  }
}

/**
 * A URL is safe to hand to iMessage when it is a single https token with no
 * whitespace, no fragment, and a modest length.
 */
export function isMessageSafeUrl(url: string | null | undefined, maxLength = 120): boolean {
  if (typeof url !== "string" || !url) return false;
  if (/\s/.test(url)) return false;
  if (!/^https:\/\/\S+$/.test(url)) return false;
  if (url.includes("#")) return false;
  if (url.length > maxLength) return false;
  return true;
}

/**
 * Decide whether a resolved payment URL should be wrapped in a JF Effect short
 * link before being shared with a client.
 *
 * - client-specific Checkout Sessions -> ALWAYS wrap (giant + fragment)
 * - reusable buy.stripe.com Payment Links -> never wrap (already share-safe)
 * - hosted invoices -> wrap only when the URL is not message-safe
 */
export function shouldWrapForSharing(kind: string, url: string | null | undefined): boolean {
  if (kind === "checkout_session") return true;
  if (kind === "payment_link") return false;
  if (kind === "hosted_invoice") return !isMessageSafeUrl(url, 120);
  return false;
}
