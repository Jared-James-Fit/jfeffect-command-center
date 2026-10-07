/**
 * payment-link-regenerate.server.ts
 *
 * Keeps a shared /pay/<token> link alive until the sale is actually paid.
 *
 * A Stripe Checkout Session can live at most 24 hours, so the session behind a
 * link sent to a client expires long before most clients get round to paying.
 * Rather than telling the client the link "expired" (and making the coach
 * resend a new one), the link mints a fresh, unpaid session for the same
 * purchase on demand. Nothing is charged: a session only collects payment
 * details when the client completes it, and the Stripe metadata still ties the
 * payment to this exact purchase record.
 *
 * A link only stops working when the sale is settled, or when it was given an
 * explicit expiry date (purchase_records.payment_link_expires_at).
 */
import { sanitizeShareUrl } from "@/lib/payment-share-link";

const SITE_ORIGIN = "https://jfeffect.com";
/** A concurrent request that is already minting a session holds the claim this long. */
const CLAIM_SECONDS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RegenerateResult =
  | { ok: true; url: string }
  | { ok: false; status: 410 | 503; message: string };

const EXPIRED: RegenerateResult = {
  ok: false,
  status: 410,
  message: "We couldn't open this payment link. Message your coach and they'll sort it out right away.",
};

/** The discount that was applied to the previous session, if any (kept on regeneration). */
export function discountIdFromSession(session: { metadata?: Record<string, string> | null } | null | undefined): string | null {
  const id = session?.metadata?.applied_code_id;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/** True when an explicit expiry date has passed. No date means the link never expires. */
export function isPastExplicitExpiry(expiresAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

export async function regenerateCheckoutForLink(
  supabaseAdmin: any,
  link: { id: string },
  purchase: { id: string; assigned_by?: string | null; stripe_checkout_session_id?: string | null },
  previousSession: { metadata?: Record<string, string> | null } | null,
  deps: {
    stripeGet: (path: string) => Promise<any | null>;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<RegenerateResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Only one request mints a session at a time, so a client tapping the link
  // twice (or a link preview bot) can never leave two live sessions behind.
  const claimCutoff = new Date(Date.now() - CLAIM_SECONDS * 1000).toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("payment_share_links")
    .update({ regen_claimed_at: new Date().toISOString() })
    .eq("id", link.id)
    .or(`regen_claimed_at.is.null,regen_claimed_at.lt.${claimCutoff}`)
    .select("id");

  if (!claimed || claimed.length === 0) {
    // Someone else is minting right now. Wait briefly for their session.
    for (let i = 0; i < 6; i++) {
      await sleep(1000);
      const { data: fresh } = await supabaseAdmin
        .from("purchase_records")
        .select("stripe_checkout_session_id")
        .eq("id", purchase.id)
        .maybeSingle();
      const id = fresh?.stripe_checkout_session_id;
      if (id && id !== purchase.stripe_checkout_session_id) {
        const s = await deps.stripeGet(`/checkout/sessions/${encodeURIComponent(id)}`);
        const url = s && (s.status ?? "open") === "open" ? sanitizeShareUrl(s.url ?? null) : null;
        if (url) return { ok: true, url };
      }
    }
    return {
      ok: false,
      status: 503,
      message: "We're getting your payment link ready. Tap the link again in a few seconds.",
    };
  }

  try {
    const { createAssignmentCheckout } = await import("@/lib/stripe-checkout.functions");
    const created = await createAssignmentCheckout(
      supabaseAdmin,
      purchase.assigned_by ?? null,
      {
        purchaseRecordId: purchase.id,
        // Keep whatever discount the original link carried; never invent one.
        discountCodeId: discountIdFromSession(previousSession),
        origin: SITE_ORIGIN,
      },
      { updateSource: "payment_link_refresh" },
    );
    const url = sanitizeShareUrl(created?.url ?? null);
    if (url) return { ok: true, url };
  } catch (e: any) {
    console.error("[pay-link] could not mint a fresh checkout", {
      purchaseId: purchase.id,
      message: e?.message ?? String(e),
    });
  } finally {
    await supabaseAdmin
      .from("payment_share_links")
      .update({ regen_claimed_at: null })
      .eq("id", link.id);
  }
  return EXPIRED;
}
