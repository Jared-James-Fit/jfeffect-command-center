/**
 * stripe-sync.functions.ts
 *
 * Admin-only, server-side reconciliation between Stripe and purchase_records.
 *
 * READ-ONLY against Stripe: it lists recent Checkout Sessions and their
 * subscriptions/invoices and writes the result back into the app. It never
 * charges, refunds, retries, cancels, or edits anything in Stripe, and it
 * never changes product prices.
 *
 * Idempotent: every write is an upsert/update keyed on a stable Stripe
 * reference (checkout session id, payment intent id, invoice id), so
 * re-running it produces no duplicates.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeFetch, getStripeKeyForMode, type StripeMode } from "@/lib/stripe.server";
import {
  invoiceSubscriptionId,
  invoicePaymentIntentId,
  invoiceChargeId,
  invoiceTaxMinor,
} from "@/lib/stripe-invoice-refs";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

type SyncEntry = {
  session_id: string;
  purchase_id: string | null;
  client_id: string | null;
  action: "updated" | "no_change" | "skipped" | "unmapped";
  reason?: string;
  amount?: number | null;
  currency?: string | null;
  customer_email?: string | null;
  occurred_at?: string | null;
};

const Input = z.object({
  /** How far back to scan Stripe, in days. */
  days: z.number().int().min(1).max(3650).default(365),
  mode: z.enum(["test", "live"]).default("live"),
});


const OPEN_PAYMENT_STATUSES = new Set([
  "draft",
  "pending",
  "pending payment",
  "payment link sent",
  "not sent",
  "unpaid",
  "partially paid",
  "overdue",
  "failed",
  "payment failed",
]);

async function uniquePurchaseByField(supabase: any, field: string, value: string | null | undefined) {
  if (!value) return null;
  const { data } = await supabase
    .from("purchase_records")
    .select("*")
    .eq(field, value)
    .order("purchased_at", { ascending: false })
    .limit(2);
  return (data ?? []).length === 1 ? data[0] : null;
}

function chooseSinglePlausiblePurchase(rows: any[]) {
  if (rows.length === 1) return rows[0];
  const plausible = rows.filter((r: any) => {
    const status = String(r.payment_status ?? "").trim().toLowerCase();
    return !["cancelled", "refunded", "expired"].includes(status);
  });
  if (plausible.length === 1) return plausible[0];
  const open = plausible.filter((r: any) =>
    OPEN_PAYMENT_STATUSES.has(String(r.payment_status ?? "").trim().toLowerCase()),
  );
  return open.length === 1 ? open[0] : null;
}

async function findPurchaseForStripeObject(
  supabase: any,
  obj: any,
  refs: {
    subscription?: string | null;
    checkout?: string | null;
    paymentIntent?: string | null;
    customer?: string | null;
    email?: string | null;
  },
) {
  const metaId = obj?.metadata?.purchase_record_id || obj?.metadata?.payment_request_id || null;
  if (metaId) {
    const { data } = await supabase.from("purchase_records").select("*").eq("id", metaId).maybeSingle();
    if (data) return data;
  }

  const exact =
    (await uniquePurchaseByField(supabase, "stripe_subscription_id", refs.subscription)) ||
    (await uniquePurchaseByField(supabase, "stripe_checkout_session_id", refs.checkout)) ||
    (await uniquePurchaseByField(supabase, "stripe_payment_intent_id", refs.paymentIntent));
  if (exact) return exact;

  let clientId: string | null = null;
  if (refs.customer) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("stripe_customer_id", refs.customer)
      .maybeSingle();
    clientId = client?.id ?? null;
  }
  if (!clientId && refs.email) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id")
      .ilike("email", refs.email)
      .limit(2);
    if ((clients ?? []).length === 1) clientId = clients![0].id;
  }
  if (!clientId) return null;

  const { data: purchases } = await supabase
    .from("purchase_records")
    .select("*")
    .eq("client_id", clientId)
    .order("purchased_at", { ascending: false })
    .limit(20);
  return chooseSinglePlausiblePurchase(purchases ?? []);
}

async function existingLedgerByStripeRef(
  supabase: any,
  refs: { external?: string | null; paymentIntent?: string | null; charge?: string | null; invoice?: string | null },
) {
  const checks: Array<[string, string | null | undefined]> = [
    ["external_reference", refs.external],
    ["stripe_payment_intent_id", refs.paymentIntent],
    ["stripe_charge_id", refs.charge],
    ["stripe_invoice_id", refs.invoice],
  ];
  for (const [field, value] of checks) {
    if (!value) continue;
    const { data } = await supabase.from("payment_ledger").select("id,purchase_id,client_id,amount_minor").eq(field, value).limit(1);
    if ((data ?? []).length) return data![0];
  }
  return null;
}

export const syncStripePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const apiKey = getStripeKeyForMode(data.mode as StripeMode);
    if (!apiKey) {
      return {
        ok: false,
        error: `No Stripe ${data.mode} key is configured, so there is nothing to sync in ${data.mode} mode.`,
        entries: [] as SyncEntry[],
        counts: { updated: 0, no_change: 0, skipped: 0, unmapped: 0 },
      };
    }

    const createdAfter = Math.floor(Date.now() / 1000) - data.days * 86400;
    const entries: SyncEntry[] = [];

    // Page through recent Checkout Sessions (Stripe max 100 per page).
    let startingAfter: string | null = null;
    const sessions: any[] = [];
    for (let page = 0; page < 5; page++) {
      const qs = new URLSearchParams({
        limit: "100",
        "created[gte]": String(createdAfter),
      });
      if (startingAfter) qs.set("starting_after", startingAfter);
      const res: any = await stripeFetch(`/checkout/sessions?${qs.toString()}`, { apiKey });
      const rows: any[] = res?.data ?? [];
      sessions.push(...rows);
      if (!res?.has_more || rows.length === 0) break;
      startingAfter = rows[rows.length - 1].id;
    }

    for (const s of sessions) {
      const occurredAt = s.created ? new Date(s.created * 1000).toISOString() : null;
      const email = s.customer_details?.email ?? s.customer_email ?? null;
      const base: SyncEntry = {
        session_id: s.id,
        purchase_id: null,
        client_id: null,
        action: "skipped",
        amount: s.amount_total != null ? s.amount_total / 100 : null,
        currency: (s.currency ?? "usd").toUpperCase(),
        customer_email: email,
        occurred_at: occurredAt,
      };

      if (s.metadata?.preview === "true" || s.metadata?.kind === "jf_membership") {
        entries.push({ ...base, reason: "Not a coaching purchase (preview or membership)." });
        continue;
      }
      if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") {
        entries.push({ ...base, reason: `Stripe payment_status = ${s.payment_status}.` });
        continue;
      }

      // 1) Metadata match (authoritative).
      let purchase: any = null;
      const prId = s.metadata?.purchase_record_id || s.metadata?.payment_request_id || null;
      if (prId) {
        const { data: byId } = await supabase
          .from("purchase_records").select("*").eq("id", prId).maybeSingle();
        purchase = byId ?? null;
      }
      // 2) Session id already stored.
      if (!purchase) {
        const { data: bySession } = await supabase
          .from("purchase_records").select("*").eq("stripe_checkout_session_id", s.id).maybeSingle();
        purchase = bySession ?? null;
      }
      // 3) Safe fallback: client by Stripe customer id or email + an awaiting record.
      if (!purchase) {
        let clientId: string | null = null;
        if (s.customer) {
          const { data: c } = await supabase
            .from("clients").select("id").eq("stripe_customer_id", s.customer).maybeSingle();
          clientId = c?.id ?? null;
        }
        if (!clientId && email) {
          const { data: c } = await supabase
            .from("clients").select("id").ilike("email", email).maybeSingle();
          clientId = c?.id ?? null;
        }
        if (clientId) {
          const { data: pending } = await supabase
            .from("purchase_records")
            .select("*")
            .eq("client_id", clientId)
            .in("payment_status", ["Pending Payment", "Payment Link Sent", "Pending", "Unpaid"])
            .order("purchased_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          purchase = pending ?? null;
        }
      }

      if (!purchase) {
        entries.push({
          ...base,
          action: "unmapped",
          reason: "No matching purchase record — no metadata link, no stored session, and no awaiting purchase for this customer.",
        });
        continue;
      }

      const isSub = s.mode === "subscription" && !!s.subscription;
      const patch: Record<string, any> = {
        payment_status: isSub ? "Active Subscription" : "Paid",
        paid_at: purchase.paid_at ?? occurredAt,
        amount_paid: s.amount_total != null ? s.amount_total / 100 : purchase.amount_paid,
        stripe_checkout_session_id: s.id,
        stripe_payment_intent_id: s.payment_intent ?? purchase.stripe_payment_intent_id,
        stripe_subscription_id: s.subscription ?? purchase.stripe_subscription_id,
        stripe_customer_id: s.customer ?? purchase.stripe_customer_id,
        stripe_mode: data.mode,
        service_status: "Active",
        last_payment_update_source: "stripe_sync",
        last_payment_update_at: new Date().toISOString(),
      };

      // Recurring: read (never modify) the subscription for renewal state.
      if (isSub) {
        try {
          const sub: any = await stripeFetch(`/subscriptions/${s.subscription}`, { apiKey });
          patch.is_recurring = true;
          patch.stripe_subscription_status = sub?.status ?? null;
          patch.cancel_at_period_end = !!sub?.cancel_at_period_end;
          patch.next_billing_date =
            sub?.cancel_at_period_end || !sub?.current_period_end
              ? null
              : new Date(sub.current_period_end * 1000).toISOString();
        } catch (e: any) {
          entries.push({ ...base, purchase_id: purchase.id, client_id: purchase.client_id, action: "skipped", reason: `Subscription lookup failed: ${e?.message ?? "unknown"}` });
          continue;
        }
      }

      const unchanged =
        purchase.payment_status === patch.payment_status &&
        purchase.stripe_checkout_session_id === patch.stripe_checkout_session_id &&
        String(purchase.next_billing_date ?? "") === String(patch.next_billing_date ?? "");

      if (!unchanged) {
        const { error: upErr } = await supabase.from("purchase_records").update(patch).eq("id", purchase.id);
        if (upErr) {
          entries.push({ ...base, purchase_id: purchase.id, client_id: purchase.client_id, action: "skipped", reason: upErr.message });
          continue;
        }
      }

      // Ledger row — idempotent on external_reference (the checkout session id).
      if (s.amount_total && s.amount_total > 0) {
        const { data: existing } = await supabase
          .from("payment_ledger").select("id").eq("external_reference", s.id).maybeSingle();
        if (!existing) {
          await supabase.from("payment_ledger").insert({
            client_id: purchase.client_id,
            purchase_id: purchase.id,
            txn_type: "payment",
            method: "stripe",
            amount_minor: s.amount_total,
            currency: (s.currency ?? "usd").toUpperCase(),
            transaction_date: (occurredAt ?? new Date().toISOString()).slice(0, 10),
            received_at: occurredAt,
            external_reference: s.id,
            stripe_checkout_session_id: s.id,
            stripe_payment_intent_id: s.payment_intent ?? null,
            stripe_customer_id: s.customer ?? null,
            stripe_subscription_id: s.subscription ?? null,
            stripe_mode: data.mode,
            source: "stripe_sync",
            internal_note: `Stripe sync — checkout session ${s.id}`,
          });
        }
      }

      entries.push({
        ...base,
        purchase_id: purchase.id,
        client_id: purchase.client_id,
        action: unchanged ? "no_change" : "updated",
      });
    }


    // Backfill paid invoices. Checkout-only reconciliation misses subscription
    // renewals and dashboard-created invoices, which made the Billing page drift
    // from the Stripe account even though the webhook updated the purchase.
    let invoiceStartingAfter: string | null = null;
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ limit: "100", "created[gte]": String(createdAfter) });
      if (invoiceStartingAfter) qs.set("starting_after", invoiceStartingAfter);
      const res: any = await stripeFetch(`/invoices?${qs.toString()}`, { apiKey });
      const rows: any[] = res?.data ?? [];
      for (const i of rows) {
        if (i.status !== "paid" || !(i.amount_paid > 0)) continue;
        const subId = invoiceSubscriptionId(i);
        const piId = invoicePaymentIntentId(i);
        const chargeId = invoiceChargeId(i);
        const occurredAt = new Date((i.status_transitions?.paid_at ?? i.created) * 1000).toISOString();
        const existing = await existingLedgerByStripeRef(supabase, {
          external: i.id, paymentIntent: piId, charge: chargeId, invoice: i.id,
        });
        if (existing) {
          entries.push({
            session_id: i.id,
            purchase_id: existing.purchase_id ?? null,
            client_id: existing.client_id ?? null,
            action: "no_change",
            amount: i.amount_paid / 100,
            currency: (i.currency ?? "usd").toUpperCase(),
            customer_email: i.customer_email ?? null,
            occurred_at: occurredAt,
            reason: "Paid invoice already exists in the ledger.",
          });
          continue;
        }
        const purchase = await findPurchaseForStripeObject(supabase, i, {
          subscription: subId,
          paymentIntent: piId,
          customer: typeof i.customer === "string" ? i.customer : null,
          email: i.customer_email ?? null,
        });
        if (!purchase) {
          entries.push({
            session_id: i.id, purchase_id: null, client_id: null, action: "unmapped",
            amount: i.amount_paid / 100, currency: (i.currency ?? "usd").toUpperCase(),
            customer_email: i.customer_email ?? null, occurred_at: occurredAt,
            reason: "Paid Stripe invoice could not be matched to exactly one JF Effect purchase.",
          });
          continue;
        }
        const { error } = await supabase.from("payment_ledger").insert({
          client_id: purchase.client_id,
          purchase_id: purchase.id,
          txn_type: "payment",
          method: "stripe",
          amount_minor: i.amount_paid,
          tax_minor: invoiceTaxMinor(i),
          currency: (i.currency ?? "usd").toUpperCase(),
          transaction_date: occurredAt.slice(0, 10),
          received_at: occurredAt,
          external_reference: i.id,
          stripe_payment_intent_id: piId,
          stripe_charge_id: chargeId,
          stripe_invoice_id: i.id,
          stripe_customer_id: typeof i.customer === "string" ? i.customer : null,
          stripe_subscription_id: subId,
          stripe_mode: data.mode,
          receipt_url: i.hosted_invoice_url ?? null,
          hosted_invoice_url: i.hosted_invoice_url ?? null,
          invoice_pdf_url: i.invoice_pdf ?? null,
          source: "stripe_sync_invoice",
          internal_note: `Stripe account sync — invoice ${i.id}`,
        });
        entries.push({
          session_id: i.id, purchase_id: purchase.id, client_id: purchase.client_id,
          action: error ? "skipped" : "updated", reason: error?.message,
          amount: i.amount_paid / 100, currency: (i.currency ?? "usd").toUpperCase(),
          customer_email: i.customer_email ?? null, occurred_at: occurredAt,
        });
      }
      if (!res?.has_more || rows.length === 0) break;
      invoiceStartingAfter = rows[rows.length - 1].id;
    }

    // Backfill successful PaymentIntents that were not represented by a paid
    // Checkout Session or invoice. This covers direct/dashboard payments and
    // delayed payment methods whose checkout initially completed as unpaid.
    let piStartingAfter: string | null = null;
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ limit: "100", "created[gte]": String(createdAfter) });
      if (piStartingAfter) qs.set("starting_after", piStartingAfter);
      const res: any = await stripeFetch(`/payment_intents?${qs.toString()}`, { apiKey });
      const rows: any[] = res?.data ?? [];
      for (const pi of rows) {
        if (pi.status !== "succeeded" || !(pi.amount_received > 0)) continue;
        const chargeId = typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : (typeof pi.charges?.data?.[0]?.id === "string" ? pi.charges.data[0].id : null);
        const existing = await existingLedgerByStripeRef(supabase, {
          external: pi.id, paymentIntent: pi.id, charge: chargeId,
        });
        if (existing) continue;

        const purchase = await findPurchaseForStripeObject(supabase, pi, {
          paymentIntent: pi.id,
          customer: typeof pi.customer === "string" ? pi.customer : null,
          email: pi.receipt_email ?? null,
        });
        const occurredAt = new Date((pi.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
        if (!purchase) {
          entries.push({
            session_id: pi.id, purchase_id: null, client_id: null, action: "unmapped",
            amount: pi.amount_received / 100, currency: (pi.currency ?? "usd").toUpperCase(),
            customer_email: pi.receipt_email ?? null, occurred_at: occurredAt,
            reason: "Successful Stripe PaymentIntent could not be matched to exactly one JF Effect purchase.",
          });
          continue;
        }
        const { error } = await supabase.from("payment_ledger").insert({
          client_id: purchase.client_id,
          purchase_id: purchase.id,
          txn_type: "payment",
          method: "stripe",
          amount_minor: pi.amount_received,
          tax_minor: 0,
          currency: (pi.currency ?? "usd").toUpperCase(),
          transaction_date: occurredAt.slice(0, 10),
          received_at: occurredAt,
          external_reference: pi.id,
          stripe_payment_intent_id: pi.id,
          stripe_charge_id: chargeId,
          stripe_customer_id: typeof pi.customer === "string" ? pi.customer : null,
          stripe_mode: data.mode,
          source: "stripe_sync_payment_intent",
          internal_note: `Stripe account sync — PaymentIntent ${pi.id}`,
        });
        entries.push({
          session_id: pi.id, purchase_id: purchase.id, client_id: purchase.client_id,
          action: error ? "skipped" : "updated", reason: error?.message,
          amount: pi.amount_received / 100, currency: (pi.currency ?? "usd").toUpperCase(),
          customer_email: pi.receipt_email ?? null, occurred_at: occurredAt,
        });
      }
      if (!res?.has_more || rows.length === 0) break;
      piStartingAfter = rows[rows.length - 1].id;
    }

    // Backfill refunds as first-class transaction rows so Billing reflects money
    // leaving Stripe too, not only successful payments.
    let refundStartingAfter: string | null = null;
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ limit: "100", "created[gte]": String(createdAfter) });
      if (refundStartingAfter) qs.set("starting_after", refundStartingAfter);
      const res: any = await stripeFetch(`/refunds?${qs.toString()}`, { apiKey });
      const rows: any[] = res?.data ?? [];
      for (const refund of rows) {
        if (!["succeeded", "pending"].includes(refund.status ?? "") || !(refund.amount > 0)) continue;
        const existing = await existingLedgerByStripeRef(supabase, { external: refund.id });
        if (existing) continue;

        let original: any = null;
        if (refund.charge) {
          const { data: byCharge } = await supabase
            .from("payment_ledger")
            .select("id,purchase_id,client_id")
            .eq("stripe_charge_id", refund.charge)
            .eq("voided", false)
            .order("received_at", { ascending: false })
            .limit(1);
          original = byCharge?.[0] ?? null;
        }
        if (!original && refund.payment_intent) {
          const { data: byPi } = await supabase
            .from("payment_ledger")
            .select("id,purchase_id,client_id")
            .eq("stripe_payment_intent_id", refund.payment_intent)
            .eq("voided", false)
            .order("received_at", { ascending: false })
            .limit(1);
          original = byPi?.[0] ?? null;
        }
        if (!original?.client_id) {
          entries.push({
            session_id: refund.id, purchase_id: null, client_id: null, action: "unmapped",
            amount: refund.amount / 100, currency: (refund.currency ?? "usd").toUpperCase(),
            occurred_at: new Date(refund.created * 1000).toISOString(),
            reason: "Stripe refund has no matching payment ledger row yet.",
          });
          continue;
        }
        const occurredAt = new Date(refund.created * 1000).toISOString();
        const { error } = await supabase.from("payment_ledger").insert({
          client_id: original.client_id,
          purchase_id: original.purchase_id,
          txn_type: "refund",
          method: "stripe",
          amount_minor: refund.amount,
          tax_minor: 0,
          currency: (refund.currency ?? "usd").toUpperCase(),
          transaction_date: occurredAt.slice(0, 10),
          received_at: occurredAt,
          external_reference: refund.id,
          reversal_of: original.id,
          stripe_payment_intent_id: refund.payment_intent ?? null,
          stripe_charge_id: refund.charge ?? null,
          stripe_mode: data.mode,
          source: "stripe_sync_refund",
          internal_note: `Stripe account sync — refund ${refund.id}`,
        });
        entries.push({
          session_id: refund.id, purchase_id: original.purchase_id ?? null, client_id: original.client_id,
          action: error ? "skipped" : "updated", reason: error?.message,
          amount: refund.amount / 100, currency: (refund.currency ?? "usd").toUpperCase(),
          occurred_at: occurredAt,
        });
      }
      if (!res?.has_more || rows.length === 0) break;
      refundStartingAfter = rows[rows.length - 1].id;
    }

    const counts = {
      updated: entries.filter((e) => e.action === "updated").length,
      no_change: entries.filter((e) => e.action === "no_change").length,
      skipped: entries.filter((e) => e.action === "skipped").length,
      unmapped: entries.filter((e) => e.action === "unmapped").length,
    };

    return { ok: true, scanned: sessions.length, counts, entries };
  });

/**
 * Reconcile ONE sale against Stripe, on demand.
 *
 * Read-only against Stripe (subscription + latest invoices + checkout session).
 * Writes back the canonical billing state and any missing payment_ledger rows,
 * idempotently keyed on the Stripe invoice / session id. It never charges,
 * refunds, cancels, retries, or edits anything in Stripe.
 */
export const reconcilePurchaseWithStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ purchaseId: z.string().uuid(), mode: z.enum(["test", "live"]).default("live") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const apiKey = getStripeKeyForMode(data.mode as StripeMode);
    if (!apiKey) return { ok: false, error: `No Stripe ${data.mode} key configured.` };

    const { data: purchase } = await supabase
      .from("purchase_records").select("*").eq("id", data.purchaseId).maybeSingle();
    if (!purchase) return { ok: false, error: "Sale not found." };

    const patch: Record<string, any> = {
      last_payment_update_source: "stripe_reconcile",
      last_payment_update_at: new Date().toISOString(),
    };
    let ledgerAdded = 0;
    const notes: string[] = [];

    // Subscription state (authoritative for recurring sales).
    if (purchase.stripe_subscription_id) {
      const sub: any = await stripeFetch(`/subscriptions/${purchase.stripe_subscription_id}`, { apiKey });
      const status = sub?.status ?? null;
      patch.is_recurring = true;
      patch.stripe_subscription_status = status;
      patch.cancel_at_period_end = !!sub?.cancel_at_period_end;
      patch.next_billing_date =
        sub?.cancel_at_period_end || !sub?.current_period_end || !["active", "trialing"].includes(status ?? "")
          ? null
          : new Date(sub.current_period_end * 1000).toISOString().split("T")[0];
      patch.payment_status =
        status === "active" || status === "trialing" ? "Active Subscription"
        : status === "past_due" || status === "unpaid" ? "Overdue"
        : status === "canceled" || status === "incomplete_expired" ? "Cancelled"
        : "Pending Payment";
      patch.service_status =
        status === "active" || status === "trialing" ? "Active"
        : status === "canceled" ? "Cancelled"
        : purchase.service_status;
      notes.push(`Subscription ${purchase.stripe_subscription_id} is ${status}.`);

      // Backfill any paid invoice that never produced a ledger row.
      const inv: any = await stripeFetch(
        `/invoices?subscription=${purchase.stripe_subscription_id}&limit=100`, { apiKey },
      );
      for (const i of (inv?.data ?? []) as any[]) {
        if (i.status !== "paid" || !i.amount_paid) continue;
        const { data: exists } = await supabase
          .from("payment_ledger").select("id").eq("external_reference", i.id).maybeSingle();
        if (exists) continue;
        const at = new Date((i.status_transitions?.paid_at ?? i.created) * 1000).toISOString();
        await supabase.from("payment_ledger").insert({
          client_id: purchase.client_id,
          purchase_id: purchase.id,
          txn_type: "payment",
          method: "stripe",
          amount_minor: i.amount_paid,
          tax_minor: i.tax ?? 0,
          currency: (i.currency ?? "cad").toUpperCase(),
          transaction_date: at.slice(0, 10),
          received_at: at,
          external_reference: i.id,
          stripe_invoice_id: i.id,
          stripe_customer_id: i.customer ?? null,
          stripe_subscription_id: purchase.stripe_subscription_id,
          stripe_mode: data.mode,
          source: "stripe_reconcile",
          internal_note: `Stripe reconcile — invoice ${i.id}`,
        });
        ledgerAdded += 1;
      }
    } else if (purchase.stripe_checkout_session_id) {
      const s: any = await stripeFetch(`/checkout/sessions/${purchase.stripe_checkout_session_id}`, { apiKey });
      notes.push(`Checkout session is ${s?.payment_status}.`);
      if (s?.payment_status === "paid") {
        patch.payment_status = "Paid";
        patch.service_status = "Active";
        patch.paid_at = purchase.paid_at ?? new Date((s.created ?? Date.now() / 1000) * 1000).toISOString();
        const { data: exists } = await supabase
          .from("payment_ledger").select("id").eq("external_reference", s.id).maybeSingle();
        if (!exists && s.amount_total > 0) {
          await supabase.from("payment_ledger").insert({
            client_id: purchase.client_id,
            purchase_id: purchase.id,
            txn_type: "payment",
            method: "stripe",
            amount_minor: s.amount_total,
            tax_minor: s.total_details?.amount_tax ?? 0,
            currency: (s.currency ?? "cad").toUpperCase(),
            transaction_date: new Date(s.created * 1000).toISOString().slice(0, 10),
            received_at: new Date(s.created * 1000).toISOString(),
            external_reference: s.id,
            stripe_checkout_session_id: s.id,
            stripe_payment_intent_id: s.payment_intent ?? null,
            stripe_customer_id: s.customer ?? null,
            stripe_mode: data.mode,
            source: "stripe_reconcile",
            internal_note: `Stripe reconcile — checkout session ${s.id}`,
          });
          ledgerAdded += 1;
        }
      }
    } else {
      return { ok: false, error: "This sale has no Stripe subscription or checkout session to reconcile against." };
    }

    const { error } = await supabase.from("purchase_records").update(patch).eq("id", purchase.id);
    if (error) return { ok: false, error: error.message };

    return { ok: true, ledgerAdded, status: patch.payment_status ?? purchase.payment_status, notes };
  });
