/**
 * Idempotency keys for creating Stripe objects from the app. Two taps, two tabs or a retry inside
 * Stripe's 24 hours send the same key, so Stripe answers with the object it already made instead
 * of a second one. The request's own body is part of the key: Stripe refuses a key reused with
 * different parameters, so a renamed client a minute later gets a fresh key rather than an error.
 */
export function customerIdempotencyKey(kind: "client" | "member", id: string, body: string): string {
  return `jf-customer:${kind}:${id}:${fnv1a(body)}`;
}

/** FNV-1a, 32-bit, as 8 hex digits: a stable fingerprint, not a security hash. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
