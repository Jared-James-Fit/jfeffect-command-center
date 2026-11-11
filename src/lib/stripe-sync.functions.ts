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
import type { AdminTransactionRow } from "@/lib/admin-transactions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeFetch, getStripeKeyForMode, latestChargeForPaymentIntent, type StripeMode } from "@/lib/stripe.server";
import {
  invoiceSubscriptionId,
  invoicePaymentIntentId,
  invoiceChargeId,
  invoiceTaxMinor,
  invoiceIdByPaymentRef,
  invoicePaymentRecordId,
} from "@/lib/stripe-invoice-refs";
import { assertAdminView } from "@/lib/permissions.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}


const Input = z.object({
  /** How far back to scan Stripe, in days. */
  days: z.number().int().min(1).max(3650).default(365),
  mode: z.enum(["test", "live"]).default("live"),
});


export const syncStripePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { runStripeAccountSync } = await import("@/lib/stripe-account-sync.server");
    return runStripeAccountSync(supabase, data);
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

      // Backfill any paid invoice that never produced a ledger row, on the package
      // it pays (a session package's auto-pay pays the oldest owed first).
      const { planPaymentTarget } = await import("@/lib/stripe-plan-payments.server");
      const inv: any = await stripeFetch(
        `/invoices?subscription=${purchase.stripe_subscription_id}&limit=100`, { apiKey },
      );
      const paidInvoices = ((inv?.data ?? []) as any[])
        .filter((i) => i.status === "paid" && i.amount_paid)
        .sort((a, b) => (a.status_transitions?.paid_at ?? a.created) - (b.status_transitions?.paid_at ?? b.created));
      for (const i of paidInvoices) {
        const { data: exists } = await supabase
          .from("payment_ledger").select("id").eq("external_reference", i.id).maybeSingle();
        if (exists) continue;
        const at = new Date((i.status_transitions?.paid_at ?? i.created) * 1000).toISOString();
        const payTo = await planPaymentTarget(supabase, purchase);
        await supabase.from("payment_ledger").insert({
          client_id: payTo.client_id,
          purchase_id: payTo.id,
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


/**
 * Read the live Stripe account directly for the Billing UI.
 *
 * This is intentionally separate from the local ledger. The Stripe account is
 * the source of truth for what actually moved through Stripe; local purchase /
 * ledger data is used only to enrich rows with client and product names when a
 * safe match exists. Unlinked Stripe payments are still returned so they never
 * disappear from Billing just because the app cannot map them to a purchase.
 */
const StripeAccountInput = z.object({
  days: z.number().int().min(1).max(3650).default(90),
  mode: z.enum(["test", "live"]).default("live"),
});

function stripeObjectId(value: any): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function appRowKey(row: AdminTransactionRow): string[] {
  const keys: string[] = [];
  if (row.stripe_charge_id) keys.push(`charge:${row.stripe_charge_id}`);
  if (row.stripe_payment_intent_id) keys.push(`pi:${row.stripe_payment_intent_id}`);
  if (row.stripe_invoice_id) keys.push(`invoice:${row.stripe_invoice_id}`);
  return keys;
}

function syntheticStripePayment(charge: any, mode: StripeMode): AdminTransactionRow {
  const at = new Date((charge.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const customer = stripeObjectId(charge.customer);
  const pi = stripeObjectId(charge.payment_intent);
  const invoice = stripeObjectId(charge.invoice);
  const email = charge.billing_details?.email ?? charge.receipt_email ?? null;
  const name = charge.billing_details?.name ?? null;
  const description =
    charge.metadata?.offer_name ||
    charge.metadata?.product_name ||
    charge.description ||
    charge.statement_descriptor ||
    "Stripe payment";
  return {
    id: `stripe:charge:${charge.id}`,
    source: "stripe",
    occurred_on: at.slice(0, 10),
    occurred_at: at,
    subject_id: customer,
    subject_kind: "stripe",
    subject_name: name || email || "Stripe customer",
    subject_email: email,
    purchase_id: null,
    offer_id: null,
    product_name: description,
    purchase_type: "Stripe payment",
    amount: Number(charge.amount ?? 0) / 100,
    currency: String(charge.currency ?? "usd").toUpperCase(),
    txn_type: "payment",
    method: "stripe",
    status: charge.paid && charge.status === "succeeded" ? "Paid" : "Failed",
    stripe_customer_id: customer,
    stripe_payment_intent_id: pi,
    stripe_charge_id: charge.id ?? null,
    stripe_invoice_id: invoice,
    stripe_checkout_session_id: null,
    stripe_subscription_id: null,
    stripe_product_id: null,
    stripe_price_id: null,
    receipt_url: charge.receipt_url ?? null,
    hosted_invoice_url: null,
    invoice_pdf_url: null,
    stripe_mode: mode,
    admin_notes: "Live Stripe account transaction — not linked to a JF Effect purchase record.",
    voided: false,
  };
}

function syntheticStripeRefund(refund: any, charge: any | null, mode: StripeMode): AdminTransactionRow {
  const at = new Date((refund.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const customer = stripeObjectId(charge?.customer);
  const email = charge?.billing_details?.email ?? charge?.receipt_email ?? null;
  const name = charge?.billing_details?.name ?? null;
  const pi = stripeObjectId(refund.payment_intent) ?? stripeObjectId(charge?.payment_intent);
  return {
    id: `stripe:refund:${refund.id}`,
    source: "stripe",
    occurred_on: at.slice(0, 10),
    occurred_at: at,
    subject_id: customer,
    subject_kind: "stripe",
    subject_name: name || email || "Stripe customer",
    subject_email: email,
    purchase_id: null,
    offer_id: null,
    product_name: charge?.description || "Stripe refund",
    purchase_type: "Stripe refund",
    amount: Number(refund.amount ?? 0) / 100,
    currency: String(refund.currency ?? charge?.currency ?? "usd").toUpperCase(),
    txn_type: "refund",
    method: "stripe",
    status: refund.status === "succeeded" ? "Refunded" : "Pending",
    stripe_customer_id: customer,
    stripe_payment_intent_id: pi,
    stripe_charge_id: stripeObjectId(refund.charge) ?? stripeObjectId(charge),
    stripe_invoice_id: stripeObjectId(charge?.invoice),
    stripe_checkout_session_id: null,
    stripe_subscription_id: null,
    stripe_product_id: null,
    stripe_price_id: null,
    receipt_url: null,
    hosted_invoice_url: null,
    invoice_pdf_url: null,
    stripe_mode: mode,
    admin_notes: "Live Stripe account refund — not linked to a JF Effect ledger row.",
    voided: false,
  };
}

export const listStripeAccountTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StripeAccountInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { db: supabase } = await assertAdminView(context as any);

    const apiKey = getStripeKeyForMode(data.mode as StripeMode);
    if (!apiKey) {
      return {
        ok: false,
        error: `No Stripe ${data.mode} key is configured.`,
        rows: [] as AdminTransactionRow[],
        stripe_count: 0,
        linked_count: 0,
        unlinked_count: 0,
      };
    }

    const createdAfter = Math.floor(Date.now() / 1000) - data.days * 86400;
    const sinceIso = new Date(createdAfter * 1000).toISOString();

    const { data: appRowsRaw, error: appRowsError } = await (supabase as any)
      .from("admin_transactions_v1")
      .select("*")
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .limit(5000);
    if (appRowsError) throw new Error(appRowsError.message);

    // Only active local rows can enrich Stripe. A locally voided duplicate must
    // never hide a real Stripe payment.
    const appRows = ((appRowsRaw ?? []) as AdminTransactionRow[]).filter((r) => !r.voided);
    const appByKey = new Map<string, AdminTransactionRow>();
    for (const row of appRows) {
      for (const key of appRowKey(row)) {
        if (!appByKey.has(key)) appByKey.set(key, row);
      }
    }

    const charges: any[] = [];
    let startingAfter: string | null = null;
    for (let page = 0; page < 100; page++) {
      const qs = new URLSearchParams({ limit: "100", "created[gte]": String(createdAfter) });
      if (startingAfter) qs.set("starting_after", startingAfter);
      const res: any = await stripeFetch(`/charges?${qs.toString()}`, { apiKey });
      const batch: any[] = res?.data ?? [];
      charges.push(...batch);
      if (!res?.has_more || batch.length === 0) break;
      startingAfter = batch[batch.length - 1].id;
    }

    const chargeById = new Map<string, any>();
    for (const c of charges) if (c?.id) chargeById.set(c.id, c);

    // Charges no longer carry `invoice` on newer API versions, so tie
    // subscription charges back to the invoice the app stored via the
    // invoices' own `payments` list. Best-effort: on failure rows still match
    // by charge / PaymentIntent id.
    let invoiceByPaymentRef = new Map<string, string>();
    const paidInvoices: any[] = [];
    try {
      const invoices = paidInvoices;
      let invAfter: string | null = null;
      for (let page = 0; page < 100; page++) {
        const qs = new URLSearchParams({ limit: "100", status: "paid", "created[gte]": String(createdAfter) });
        qs.append("expand[]", "data.payments");
        if (invAfter) qs.set("starting_after", invAfter);
        const res: any = await stripeFetch(`/invoices?${qs.toString()}`, { apiKey });
        const batch: any[] = res?.data ?? [];
        invoices.push(...batch);
        if (!res?.has_more || batch.length === 0) break;
        invAfter = batch[batch.length - 1].id;
      }
      invoiceByPaymentRef = invoiceIdByPaymentRef(invoices);
    } catch (e) {
      console.error("[stripe-sync] invoice index failed", (e as any)?.message ?? e);
    }

    const rows: AdminTransactionRow[] = [];
    const linkedIds = new Set<string>();

    for (const charge of charges) {
      // Stripe lists failed attempts too. Keep them visible because the user
      // asked for the account transaction history, not only successful ledger rows.
      const pi = stripeObjectId(charge.payment_intent);
      const invoice =
        stripeObjectId(charge.invoice) ??
        (pi ? invoiceByPaymentRef.get(`pi:${pi}`) : undefined) ??
        invoiceByPaymentRef.get(`charge:${charge.id}`) ??
        null;
      const matched =
        appByKey.get(`charge:${charge.id}`) ||
        (pi ? appByKey.get(`pi:${pi}`) : undefined) ||
        (invoice ? appByKey.get(`invoice:${invoice}`) : undefined);

      if (matched && (matched.txn_type ?? "").toLowerCase() !== "refund") {
        linkedIds.add(matched.id);
        rows.push({
          ...matched,
          status: charge.paid && charge.status === "succeeded" ? "Paid" : "Failed",
          amount: Number(charge.amount ?? 0) / 100,
          currency: String(charge.currency ?? matched.currency ?? "usd").toUpperCase(),
          stripe_customer_id: stripeObjectId(charge.customer) ?? matched.stripe_customer_id,
          stripe_payment_intent_id: pi ?? matched.stripe_payment_intent_id,
          stripe_charge_id: charge.id ?? matched.stripe_charge_id,
          stripe_invoice_id: invoice ?? matched.stripe_invoice_id,
          receipt_url: charge.receipt_url ?? matched.receipt_url,
          stripe_mode: data.mode,
          voided: false,
        });
      } else {
        rows.push(syntheticStripePayment(charge, data.mode as StripeMode));
      }
    }

    // Invoices settled with a Stripe payment record (marked paid outside Stripe,
    // e.g. an e-transfer) have no charge, so the charge list above never shows
    // them even though they are paid in the Stripe account.
    for (const inv of paidInvoices) {
      if (!(inv.amount_paid > 0) || !invoicePaymentRecordId(inv)) continue;
      const paidAt = new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString();
      const currency = String(inv.currency ?? "usd").toUpperCase();
      const matched = appByKey.get(`invoice:${inv.id}`);
      if (matched) {
        linkedIds.add(matched.id);
        rows.push({
          ...matched,
          status: "Paid",
          amount: inv.amount_paid / 100,
          currency,
          stripe_invoice_id: inv.id,
          hosted_invoice_url: inv.hosted_invoice_url ?? matched.hosted_invoice_url,
          invoice_pdf_url: inv.invoice_pdf ?? matched.invoice_pdf_url,
          stripe_mode: data.mode,
          voided: false,
        });
        continue;
      }
      rows.push({
        id: `stripe:invoice:${inv.id}`,
        source: "stripe",
        occurred_on: paidAt.slice(0, 10),
        occurred_at: paidAt,
        subject_id: stripeObjectId(inv.customer),
        subject_kind: "stripe",
        subject_name: inv.customer_name || inv.customer_email || "Stripe customer",
        subject_email: inv.customer_email ?? null,
        purchase_id: null,
        offer_id: null,
        product_name: inv.lines?.data?.[0]?.description || "Stripe invoice",
        purchase_type: "Paid outside Stripe",
        amount: inv.amount_paid / 100,
        currency,
        txn_type: "payment",
        method: "other",
        status: "Paid",
        stripe_customer_id: stripeObjectId(inv.customer),
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        stripe_invoice_id: inv.id,
        stripe_checkout_session_id: null,
        stripe_subscription_id: invoiceSubscriptionId(inv),
        stripe_product_id: null,
        stripe_price_id: null,
        receipt_url: null,
        hosted_invoice_url: inv.hosted_invoice_url ?? null,
        invoice_pdf_url: inv.invoice_pdf ?? null,
        stripe_mode: data.mode,
        admin_notes: "Stripe invoice marked paid outside Stripe — not linked to a JF Effect purchase record.",
        voided: false,
      });
    }

    const refunds: any[] = [];
    let refundStartingAfter: string | null = null;
    for (let page = 0; page < 100; page++) {
      const qs = new URLSearchParams({ limit: "100", "created[gte]": String(createdAfter) });
      if (refundStartingAfter) qs.set("starting_after", refundStartingAfter);
      const res: any = await stripeFetch(`/refunds?${qs.toString()}`, { apiKey });
      const batch: any[] = res?.data ?? [];
      refunds.push(...batch);
      if (!res?.has_more || batch.length === 0) break;
      refundStartingAfter = batch[batch.length - 1].id;
    }

    const refundAppRows = appRows.filter((r) => ["refund", "partial_refund"].includes((r.txn_type ?? "").toLowerCase()));
    for (const refund of refunds) {
      const chargeId = stripeObjectId(refund.charge);
      const pi = stripeObjectId(refund.payment_intent);
      const at = new Date((refund.created ?? 0) * 1000).toISOString();
      const amount = Number(refund.amount ?? 0) / 100;

      const matched = refundAppRows.find((r) => {
        const sameRef =
          (!!chargeId && r.stripe_charge_id === chargeId) ||
          (!!pi && r.stripe_payment_intent_id === pi);
        const sameAmount = Math.abs(Number(r.amount ?? 0) - amount) < 0.005;
        const sameDay = String(r.occurred_at).slice(0, 10) === at.slice(0, 10);
        return sameRef && sameAmount && sameDay && !linkedIds.has(r.id);
      });

      if (matched) {
        linkedIds.add(matched.id);
        rows.push({
          ...matched,
          status: refund.status === "succeeded" ? "Refunded" : "Pending",
          amount,
          currency: String(refund.currency ?? matched.currency ?? "usd").toUpperCase(),
          stripe_payment_intent_id: pi ?? matched.stripe_payment_intent_id,
          stripe_charge_id: chargeId ?? matched.stripe_charge_id,
          stripe_mode: data.mode,
          voided: false,
        });
      } else {
        rows.push(
          syntheticStripeRefund(
            refund,
            chargeId ? chargeById.get(chargeId) ?? null : null,
            data.mode as StripeMode,
          ),
        );
      }
    }

    // Payments recorded outside Stripe (e-transfer, cash, ...) never create a
    // Stripe charge, so they would otherwise be missing from Billing and from
    // the Paid total. Add the active app rows that were not matched above.
    for (const row of appRows) {
      if (linkedIds.has(row.id)) continue;
      if (String(row.method ?? "").toLowerCase() === "stripe") continue;
      rows.push({ ...row, voided: false });
    }

    rows.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    const unlinkedCount = rows.filter((r) => r.source === "stripe").length;

    return {
      ok: true,
      rows,
      stripe_count: rows.length,
      linked_count: rows.length - unlinkedCount,
      unlinked_count: unlinkedCount,
    };
  });
