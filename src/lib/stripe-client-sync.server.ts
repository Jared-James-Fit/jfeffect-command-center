// Server-only: one client's Stripe, read beside the app's own sales and
// payment rows. Read-only against Stripe and the app.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeKeyForMode, stripeFetch, type StripeMode } from "@/lib/stripe.server";
import { invoicePaymentIntentId, invoiceSubscriptionId } from "@/lib/stripe-invoice-refs";

type Admin = SupabaseClient<any, any, any>;

const iso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);
const idOf = (v: any): string | null => (typeof v === "string" ? v : v?.id ?? null);

/** Every page of a Stripe list (capped, so one bad customer can't run forever). */
async function listAll(path: string, apiKey: string, max = 500): Promise<any[]> {
  const out: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10 && out.length < max; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res: any = await stripeFetch(`${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`, { apiKey });
    const rows: any[] = res?.data ?? [];
    out.push(...rows);
    if (!res?.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return out;
}

/** The client's Stripe customers: every id the app has seen for them, plus any customer with their email. */
export async function clientStripeCustomers(db: Admin, clientId: string, apiKey: string): Promise<{ ids: string[]; emails: string[] }> {
  const [client, sales, ledger] = await Promise.all([
    db.from("clients").select("email").eq("id", clientId).maybeSingle(),
    db.from("purchase_records").select("stripe_customer_id").eq("client_id", clientId),
    db.from("payment_ledger").select("stripe_customer_id").eq("client_id", clientId),
  ]);
  const ids = new Set<string>();
  for (const r of [...((sales.data ?? []) as any[]), ...((ledger.data ?? []) as any[])]) if (r.stripe_customer_id) ids.add(r.stripe_customer_id);
  const emails: string[] = [];
  const email = String((client.data as any)?.email ?? "").trim().toLowerCase();
  if (email) {
    emails.push(email);
    const found = await listAll(`/customers?email=${encodeURIComponent(email)}`, apiKey, 50);
    for (const c of found) ids.add(c.id);
  }
  return { ids: [...ids], emails };
}

/**
 * Every sale on a Stripe subscription that hasn't ended: its status, next
 * charge date and whether it's set to stop, as Stripe has them now (the
 * webhook keeps these current; this catches an event that never arrived).
 */
export async function refreshSubscriptions(db: Admin, mode: StripeMode): Promise<{ checked: number; changed: number; errors: string[] }> {
  const apiKey = getStripeKeyForMode(mode);
  if (!apiKey) throw new Error(`No Stripe ${mode} key is configured.`);
  const { data: sales, error } = await db
    .from("purchase_records")
    .select("id, stripe_subscription_id, stripe_subscription_status, next_billing_date, cancel_at_period_end, stripe_mode")
    .not("stripe_subscription_id", "is", null)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  const out = { checked: 0, changed: 0, errors: [] as string[] };
  for (const s of (sales ?? []) as any[]) {
    if (s.stripe_mode && s.stripe_mode !== mode) continue;
    if (["canceled", "incomplete_expired"].includes(String(s.stripe_subscription_status ?? ""))) continue;
    try {
      const sub: any = await stripeFetch(`/subscriptions/${s.stripe_subscription_id}`, { apiKey });
      out.checked += 1;
      const status = sub?.status ?? null;
      const periodEnd = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
      const live = status === "active" || status === "trialing";
      const next = live && !sub?.cancel_at_period_end && periodEnd ? new Date(periodEnd * 1000).toISOString().slice(0, 10) : null;
      const patch = {
        stripe_subscription_status: status,
        next_billing_date: next,
        cancel_at_period_end: !!sub?.cancel_at_period_end,
      };
      if (
        patch.stripe_subscription_status !== s.stripe_subscription_status ||
        String(patch.next_billing_date ?? "") !== String(s.next_billing_date ?? "").slice(0, 10) ||
        patch.cancel_at_period_end !== !!s.cancel_at_period_end
      ) {
        const { error: upErr } = await db.from("purchase_records").update(patch).eq("id", s.id);
        if (upErr) out.errors.push(`${s.id}: ${upErr.message}`);
        else out.changed += 1;
      }
    } catch (e: any) {
      out.errors.push(`${s.stripe_subscription_id}: ${e?.message ?? e}`);
    }
  }
  return out;
}

export async function auditClientStripe(db: Admin, clientId: string, mode: StripeMode) {
  const apiKey = getStripeKeyForMode(mode);
  if (!apiKey) throw new Error(`No Stripe ${mode} key is configured.`);
  const { ids, emails } = await clientStripeCustomers(db, clientId, apiKey);

  const customers: any[] = [];
  for (const cus of ids) {
    const [subs, invoices, charges, sessions] = await Promise.all([
      listAll(`/subscriptions?customer=${cus}&status=all`, apiKey),
      listAll(`/invoices?customer=${cus}`, apiKey),
      listAll(`/charges?customer=${cus}`, apiKey),
      listAll(`/checkout/sessions?customer=${cus}`, apiKey),
    ]);
    customers.push({
      id: cus,
      subscriptions: subs.map((s) => ({
        id: s.id,
        status: s.status,
        created: iso(s.created),
        start_date: iso(s.start_date),
        current_period_end: iso(s.current_period_end ?? s.items?.data?.[0]?.current_period_end),
        cancel_at: iso(s.cancel_at),
        canceled_at: iso(s.canceled_at),
        ended_at: iso(s.ended_at),
        cancel_at_period_end: !!s.cancel_at_period_end,
        schedule: idOf(s.schedule),
        metadata: s.metadata ?? {},
        items: (s.items?.data ?? []).map((i: any) => ({
          price: i.price?.id ?? null,
          product: idOf(i.price?.product),
          unit_amount: i.price?.unit_amount ?? null,
          interval: i.price?.recurring?.interval ?? null,
          interval_count: i.price?.recurring?.interval_count ?? null,
          quantity: i.quantity ?? 1,
        })),
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number ?? null,
        status: i.status,
        created: iso(i.created),
        paid_at: iso(i.status_transitions?.paid_at),
        due_date: iso(i.due_date),
        amount_due: i.amount_due,
        amount_paid: i.amount_paid,
        amount_remaining: i.amount_remaining,
        total: i.total,
        tax: i.tax ?? (i.total_taxes ?? []).reduce((t: number, x: any) => t + Number(x.amount ?? 0), 0),
        subscription: invoiceSubscriptionId(i),
        payment_intent: invoicePaymentIntentId(i),
        attempt_count: i.attempt_count ?? null,
        next_payment_attempt: iso(i.next_payment_attempt),
        billing_reason: i.billing_reason ?? null,
        lines: (i.lines?.data ?? []).map((l: any) => ({
          description: l.description ?? null,
          amount: l.amount,
          period_start: iso(l.period?.start),
          period_end: iso(l.period?.end),
        })),
      })),
      charges: charges.map((c) => ({
        id: c.id,
        created: iso(c.created),
        amount: c.amount,
        amount_refunded: c.amount_refunded,
        status: c.status,
        paid: c.paid,
        invoice: idOf(c.invoice),
        payment_intent: idOf(c.payment_intent),
        description: c.description ?? null,
        failure: c.failure_message ?? null,
        metadata: c.metadata ?? {},
      })),
      checkout_sessions: sessions.map((s) => ({
        id: s.id,
        created: iso(s.created),
        status: s.status,
        payment_status: s.payment_status,
        mode: s.mode,
        amount_total: s.amount_total,
        subscription: idOf(s.subscription),
        payment_intent: idOf(s.payment_intent),
        metadata: s.metadata ?? {},
      })),
    });
  }

  const [sales, ledger] = await Promise.all([
    db.from("purchase_records")
      .select("id, offer_name, short_description, sessions_purchased, payment_status, contract_value_cents, amount_paid_cents, amount_tax_paid_cents, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, stripe_checkout_session_id, stripe_payment_intent_id, stripe_price_id, next_billing_date, term_start_date, term_end_date, archived_at, purchased_at")
      .eq("client_id", clientId),
    db.from("payment_ledger")
      .select("id, purchase_id, txn_type, amount_minor, tax_minor, voided, transaction_date, source, external_reference, stripe_invoice_id, stripe_charge_id, stripe_payment_intent_id, stripe_subscription_id")
      .eq("client_id", clientId),
  ]);
  return { mode, emails, customers, app: { sales: sales.data ?? [], ledger: ledger.data ?? [] } };
}
