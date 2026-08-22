/**
 * payment-share-link.ts
 *
 * Pure, dependency-free helpers for deciding WHICH Stripe URL is the correct
 * shareable payment link, and for guaranteeing the copied string is byte-exact
 * and safe to paste into iMessage / SMS / email / WhatsApp / Safari.
 *
 * Nothing here talks to Stripe or the database — it is deterministic logic so
 * it can be covered by regression tests.
 */

export type PaymentShareKind =
  | "payment_link" // canonical reusable Stripe Payment Link (buy.stripe.com/...)
  | "hosted_invoice" // Stripe hosted invoice page
  | "checkout_session" // client-specific Checkout Session (temporary)
  | "none"; // nothing to share (already paid / nothing configured)

export type PaymentShareStrategy =
  | { kind: "payment_link"; url: string }
  | { kind: "hosted_invoice"; url: string }
  | { kind: "checkout_session"; reuseUrl: string | null }
  | { kind: "none"; reason: string };

/** Characters that break links when pasted from a rich-text/clipboard source. */
const INVISIBLE_RE = /[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2028\u2029\uFEFF]/g;

/**
 * Normalise a URL for sharing WITHOUT mutating its meaning.
 *
 * - trims surrounding whitespace / newlines / invisible characters
 * - strips wrapping angle brackets or quotes that some copy paths add
 * - preserves query string AND `#` fragment exactly
 * - never re-encodes or re-builds the URL
 *
 * Returns null when the value is not a usable https URL.
 */
export function sanitizeShareUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.replace(INVISIBLE_RE, "").trim();
  if (!value) return null;
  // Unwrap <https://...> or "https://..." / 'https://...'
  while (
    (value.startsWith("<") && value.endsWith(">")) ||
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  // Markdown link form [label](url)
  const md = /^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/.exec(value);
  if (md) value = md[1];
  if (!/^https:\/\/\S+$/i.test(value)) return null;
  if (/\s/.test(value)) return null;
  try {
    // Validation only — we return the ORIGINAL string so nothing is re-encoded.
    // eslint-disable-next-line no-new
    new URL(value);
  } catch {
    return null;
  }
  return value;
}

export function isStripePaymentLinkUrl(url: string | null | undefined): boolean {
  const v = sanitizeShareUrl(url);
  if (!v) return false;
  try {
    const host = new URL(v).hostname.toLowerCase();
    return host === "buy.stripe.com" || host.endsWith(".buy.stripe.com");
  } catch {
    return false;
  }
}

export function isStripeCheckoutSessionUrl(url: string | null | undefined): boolean {
  const v = sanitizeShareUrl(url);
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.hostname.toLowerCase().endsWith("checkout.stripe.com");
  } catch {
    return false;
  }
}

export function isStripeHostedInvoiceUrl(url: string | null | undefined): boolean {
  const v = sanitizeShareUrl(url);
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.hostname.toLowerCase().endsWith("stripe.com") && /\/invoice\//.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * A Checkout Session URL is only safe to share while the session is still
 * `open` and has not passed its `expires_at`. Stripe renders
 * "Something went wrong" for expired/completed sessions.
 */
export function isCheckoutSessionShareable(
  session: { status?: string | null; url?: string | null; expires_at?: number | null } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!session) return false;
  if (!sanitizeShareUrl(session.url ?? null)) return false;
  if ((session.status ?? "open") !== "open") return false;
  if (typeof session.expires_at === "number") {
    // Treat sessions expiring within 5 minutes as stale.
    if (session.expires_at * 1000 - nowMs <= 5 * 60_000) return false;
  }
  return true;
}

export type ShareStrategyInput = {
  paymentStatus?: string | null;
  /** Reusable Stripe Payment Link stored on the product/offer. */
  productPaymentLinkUrl?: string | null;
  /** Hosted invoice page for an outstanding Stripe invoice. */
  hostedInvoiceUrl?: string | null;
  /** URL currently stored on the purchase record (may be stale). */
  storedUrl?: string | null;
  /** Live Stripe session snapshot for storedCheckoutSessionId, if fetched. */
  existingSession?: { status?: string | null; url?: string | null; expires_at?: number | null } | null;
  /** True when the purchase needs client-specific checkout (discount, custom amount, etc). */
  requiresClientSpecificCheckout?: boolean;
  nowMs?: number;
};

const SETTLED_STATUSES = new Set(["paid", "active subscription", "refunded", "cancelled", "canceled"]);

/**
 * Decide the canonical share strategy. Never returns a stale Checkout Session
 * URL: when a session is required it either reuses a verified-open session or
 * signals that a fresh one must be created server-side.
 */
export function choosePaymentShareStrategy(input: ShareStrategyInput): PaymentShareStrategy {
  const status = (input.paymentStatus ?? "").trim().toLowerCase();
  if (SETTLED_STATUSES.has(status)) {
    return { kind: "none", reason: "This purchase is already settled — no payment link is needed." };
  }

  const invoice = sanitizeShareUrl(input.hostedInvoiceUrl ?? null);
  if (invoice && isStripeHostedInvoiceUrl(invoice)) {
    return { kind: "hosted_invoice", url: invoice };
  }

  if (!input.requiresClientSpecificCheckout) {
    const link = sanitizeShareUrl(input.productPaymentLinkUrl ?? null);
    if (link && isStripePaymentLinkUrl(link)) {
      return { kind: "payment_link", url: link };
    }
    const stored = sanitizeShareUrl(input.storedUrl ?? null);
    if (stored && isStripePaymentLinkUrl(stored)) {
      return { kind: "payment_link", url: stored };
    }
  }

  const reusable = isCheckoutSessionShareable(input.existingSession ?? null, input.nowMs ?? Date.now())
    ? sanitizeShareUrl(input.existingSession?.url ?? null)
    : null;
  return { kind: "checkout_session", reuseUrl: reusable };
}

export function shareKindLabel(kind: PaymentShareKind): string {
  switch (kind) {
    case "payment_link":
      return "Reusable payment link";
    case "hosted_invoice":
      return "Stripe invoice";
    case "checkout_session":
      return "Client-specific checkout link";
    default:
      return "No link";
  }
}
