import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeShareUrl } from "@/lib/payment-share-link";
import { paymentRequestAttachment } from "@/lib/payment-request-message";
import { saleProducts, saleQuote, sessionSaleMessage, sessionWhen, type SaleProduct } from "@/lib/session-sale";

/**
 * Selling sessions with a booking (session-sale.ts): the products a session can
 * be sold as, and the sale itself — booked first, then sold, then a Stripe link
 * in the client's chat. The session stays booked whatever happens to the sale.
 */

const SHARE_ORIGIN = "https://jfeffect.com";

async function staffRoles(supabase: any, userId: string): Promise<{ isAdmin: boolean }> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = new Set(((data ?? []) as any[]).map((r) => r.role));
  if (roles.has("admin")) return { isAdmin: true };
  if (roles.has("coach")) return { isAdmin: false };
  throw new Error("Only coaches can sell sessions.");
}

const PRODUCT_FIELDS = "id, name, price_cents, currency, sessions_included, stripe_price_id, stripe_product_id, mode, payment_structure, status, active, archived, is_one_off";

/** Products a coach can sell with a booking (coaching_products is admin-only, so it's read here). */
export const listSessionSaleProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await staffRoles(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("coaching_products").select(PRODUCT_FIELDS);
    if (error) throw new Error(error.message);
    return { products: saleProducts(data ?? []) as SaleProduct[] };
  });

/**
 * A one-time Stripe price for an amount on the Personal Training product: an
 * existing one when it's there (so $30 is made once, not per sale), else a new
 * one. Exclusive tax, like every product: Stripe Tax adds GST at checkout.
 */
async function oneTimePrice(stripeProductId: string, cents: number, currency: string): Promise<string> {
  const { stripeFetch, formEncode } = await import("@/lib/stripe.server");
  const cur = currency.toLowerCase();
  const list = await stripeFetch(
    `/prices?product=${encodeURIComponent(stripeProductId)}&active=true&type=one_time&currency=${cur}&limit=100`,
  );
  const found = ((list?.data ?? []) as any[]).find(
    (p) => p.unit_amount === cents && p.currency === cur && (p.tax_behavior ?? "exclusive") === "exclusive" && !p.recurring,
  );
  if (found?.id) return found.id as string;
  const price = await stripeFetch("/prices", {
    method: "POST",
    idempotencyKey: `jf-session-price:${stripeProductId}:${cur}:${cents}`,
    body: formEncode({
      product: stripeProductId,
      unit_amount: cents,
      currency: cur,
      tax_behavior: "exclusive",
      nickname: `Sold with a booking · $${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`,
      "metadata[source]": "booking_sale",
    }),
  });
  return price.id as string;
}

/** The Stripe product a typed price is charged as: the single-session product's, else any session product's. */
async function sessionStripeProduct(admin: any): Promise<string> {
  const { data } = await admin
    .from("coaching_products")
    .select("stripe_product_id, sessions_included, product_type, active, archived, status")
    .not("stripe_product_id", "is", null)
    .gt("sessions_included", 0);
  const rows = ((data ?? []) as any[]).filter((p) => p.active !== false && !p.archived && p.status === "Active");
  const pick = rows.find((p) => p.sessions_included === 1) ?? rows.find((p) => /personal training/i.test(p.product_type ?? "")) ?? rows[0];
  if (pick?.stripe_product_id) return pick.stripe_product_id as string;
  // No session product in Stripe yet: one for typed prices, found again by its tag next time.
  const { stripeFetch, formEncode } = await import("@/lib/stripe.server");
  const found = await stripeFetch(`/products/search?query=${encodeURIComponent("metadata['jf_kind']:'session_sale'")}`);
  if (found?.data?.[0]?.id) return found.data[0].id as string;
  const created = await stripeFetch("/products", {
    method: "POST",
    idempotencyKey: "jf-session-sale-product",
    body: formEncode({ name: "Personal Training", "metadata[jf_kind]": "session_sale" }),
  });
  return created.id as string;
}

const SellInput = z.object({
  clientId: z.string().uuid(),
  sessionIds: z.array(z.string().uuid()).min(1).max(60),
  productId: z.string().uuid().nullable().optional(),
  /** A typed price per session, in cents (when no product is picked). */
  customCents: z.number().int().min(50).max(1_000_000).nullable().optional(),
  origin: z.string().url(),
  sendInChat: z.boolean().default(true),
});

/**
 * Sells the sessions just booked (or one already on the calendar): one sale
 * holding their credits (sell_booked_sessions), its Stripe checkout and short
 * /pay link, and — unless the coach said not to — the payment card in the
 * client's chat. Prices come from the product or the typed price, never from
 * the phone's own total. A sale whose link fails still exists (Billing can
 * share it); a retry for the same sessions reuses it.
 */
export const sellSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SellInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await staffRoles(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error: sErr } = await supabase
      .from("pt_sessions")
      .select("id, client_id, title, session_date, start_time")
      .in("id", data.sessionIds)
      .order("session_date", { ascending: true })
      .order("start_time", { ascending: true });
    if (sErr) throw new Error(sErr.message);
    const sessions = (rows ?? []) as Array<{ id: string; client_id: string; title: string | null; session_date: string; start_time: string }>;
    if (sessions.length !== data.sessionIds.length || sessions.some((s) => s.client_id !== data.clientId)) {
      throw new Error("Those sessions aren't this client's.");
    }
    const first = sessions[0];
    const title = first.title || "1:1 Training";

    let products: SaleProduct[] = [];
    let product: any = null;
    if (data.productId) {
      const { data: p } = await supabaseAdmin.from("coaching_products").select(PRODUCT_FIELDS).eq("id", data.productId).maybeSingle();
      products = saleProducts(p ? [p] : []);
      if (!products.length) throw new Error("That product can't be sold with a session (it needs a one-time Stripe price and sessions).");
      product = p;
    }
    const quote = saleQuote({ productId: data.productId ?? null, customCents: data.customCents ?? null }, sessions.length, products, title);
    if (!quote) throw new Error("Pick a product or type a price.");
    const currency = String(product?.currency ?? "CAD").toUpperCase();

    // The Stripe price: the product's own when it's sold once, else one for this exact amount.
    const stripeProductId: string = product?.stripe_product_id || (await sessionStripeProduct(supabaseAdmin));
    const stripePriceId = product && quote.quantity === 1 && product.stripe_price_id
      ? (product.stripe_price_id as string)
      : await oneTimePrice(stripeProductId, quote.totalCents, currency);

    const { data: saleId, error: saleErr } = await supabase.rpc("sell_booked_sessions", {
      _client_id: data.clientId,
      _session_ids: sessions.map((s) => s.id),
      _offer_id: product?.id ?? null,
      _offer_name: product ? (quote.quantity > 1 ? `${product.name} × ${quote.quantity}` : product.name) : quote.name,
      _sessions: quote.sessions,
      _price_cents: quote.totalCents,
      _currency: currency,
      _stripe_product_id: stripeProductId,
      _stripe_price_id: stripePriceId,
    });
    if (saleErr) throw new Error(saleErr.message);
    const purchaseId = saleId as string;

    // Checkout + the short link. A failure here keeps the sale (Billing can share it).
    let url: string | null = null;
    let linkError: string | null = null;
    try {
      const { mintShareLinkForPurchase } = await import("@/lib/payment-share.server");
      let share = await mintShareLinkForPurchase(supabase, userId, purchaseId, SHARE_ORIGIN);
      if (share.kind !== "none" && (share.needsFreshCheckout || !share.shareUrl)) {
        const { createAssignmentCheckout } = await import("@/lib/stripe-checkout.functions");
        await createAssignmentCheckout(supabase, userId, { purchaseRecordId: purchaseId, origin: data.origin, discountCodeId: null }, { updateSource: "booking_sale" });
        for (const wait of [0, 250, 600]) {
          if (wait) await new Promise((r) => setTimeout(r, wait));
          share = await mintShareLinkForPurchase(supabase, userId, purchaseId, SHARE_ORIGIN);
          if (!share.needsFreshCheckout && share.shareUrl) break;
        }
      }
      url = sanitizeShareUrl(share.shareUrl);
      if (!url) linkError = share.reason ?? "The payment link isn't ready yet.";
    } catch (e: any) {
      linkError = e?.message ?? "Stripe couldn't make the link.";
    }

    let messageId: string | null = null;
    if (url && data.sendInChat) {
      const { data: sale } = await supabase
        .from("purchase_records")
        .select("id, client_id, offer_name, full_payable_amount, currency, payment_structure, payment_status")
        .eq("id", purchaseId)
        .maybeSingle();
      const { data: existing } = await supabase
        .from("messages")
        .select("id")
        .eq("client_id", data.clientId)
        .contains("attachments", [{ kind: "payment_request", purchase_id: purchaseId }])
        .limit(1);
      if (sale && !(existing ?? []).length) {
        const { data: client } = await supabase
          .from("clients").select("preferred_name, first_name, full_name").eq("id", data.clientId).maybeSingle();
        const body = sessionSaleMessage({
          first: client?.preferred_name || client?.first_name || client?.full_name || null,
          title,
          when: sessionWhen(first.session_date, first.start_time),
          booked: sessions.length,
          sessions: quote.sessions,
          productName: product?.name ?? null,
          totalCents: quote.totalCents,
          currency,
          url,
        });
        const { data: msg, error: mErr } = await supabase
          .from("messages")
          .insert({
            client_id: data.clientId,
            sender_id: userId,
            sender_role: "admin",
            body,
            attachments: [paymentRequestAttachment(sale, url)],
            message_type: "Payment",
            read_by_admin_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (mErr) linkError = `The link is made, but it couldn't go in the chat: ${mErr.message}`;
        else messageId = msg.id as string;
      }
    }

    return { purchaseId, url, messageId, linkError, totalCents: quote.totalCents, sessions: quote.sessions };
  });
