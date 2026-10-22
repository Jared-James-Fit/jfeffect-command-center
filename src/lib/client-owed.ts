/**
 * What a client owes, before tax: what's left on their sales plus the
 * renewal their training has started. A session package renews in its own
 * size: training past it means the client is on their next one (Marc: another
 * 16 for $640 + tax), never a per-session tab. Clients who train first and pay
 * in installments ("financing") show up here instead of looking paid up.
 *
 * Pure: callers pass the rows they already loaded.
 */
import { resolvePaymentDisplay, type PurchaseInput } from "@/lib/payment-display";

type Sale = PurchaseInput & {
  id?: string;
  archived_at?: string | null;
  created_at?: string | null;
  sessions_purchased?: number | null;
};

const SETTLED = new Set(["paid", "paid in full", "completed"]);
const CLOSED = new Set(["cancelled", "refunded", "voided", "draft", "expired"]);

/** What's left to pay on one sale, in cents before tax. */
export function saleOwedCents(sale: Sale): number {
  if (sale.archived_at) return 0;
  const status = String(sale.payment_status ?? "").trim().toLowerCase();
  if (SETTLED.has(status) || CLOSED.has(status)) return 0;
  const d = resolvePaymentDisplay(sale);
  // A subscription that renews until cancelled is billed period by period;
  // only a set number of payments leaves a balance still to come.
  if (status === "active subscription" && !d.installmentPlan) return 0;
  return Math.round(d.amountOutstanding * 100);
}

/** The client's most recent session package with a price: what they renew. */
export function latestPackage(sales: Sale[]): { sale: Sale; priceCents: number; size: number } | null {
  const time = (s: Sale) => new Date(s.purchased_at ?? s.created_at ?? 0).getTime() || 0;
  const latest = sales
    .filter((s) => !s.archived_at && Number(s.sessions_purchased ?? 0) > 0)
    .map((s) => ({ sale: s, priceCents: Math.round(resolvePaymentDisplay(s).contractTotal * 100), size: Number(s.sessions_purchased) }))
    .filter((x) => x.priceCents > 0)
    .sort((a, b) => time(b.sale) - time(a.sale))[0];
  return latest ?? null;
}

/** Price of one session on the client's most recent package with a price. */
export function sessionPriceCents(sales: Sale[]): number | null {
  const p = latestPackage(sales);
  return p ? Math.round(p.priceCents / p.size) : null;
}

export type PackageRenewal = {
  /** The package being renewed: the client's latest priced session package. */
  fromSaleId: string | null;
  name: string;
  /** Sessions in one package. */
  size: number;
  /** One package's price, before tax. */
  priceCents: number;
  /** Packages the sessions already trained need: owed now. */
  count: number;
  /** Sessions trained past what was bought. */
  trained: number;
  /** Booked past what was bought: inside the renewals owed, and past even those. */
  bookedIn: number;
  bookedAfter: number;
};

/**
 * The renewal a client's training has started. Trained sessions past their
 * packages fill whole renewals of the latest package (10 past a 16-pack = one
 * renewal owed, its other 6 sessions still to come); booked ones fill what
 * those renewals have left, and any past that wait for the next renewal,
 * owed once the first of them is trained. Null without a priced package.
 */
export function packageRenewal(sales: Sale[], trained: number, booked = 0): PackageRenewal | null {
  const t = Math.max(0, Math.floor(trained || 0));
  const b = Math.max(0, Math.floor(booked || 0));
  if (t + b === 0) return null;
  const pkg = latestPackage(sales);
  if (!pkg) return null;
  const count = Math.ceil(t / pkg.size);
  const bookedIn = Math.min(b, count * pkg.size - t);
  return {
    fromSaleId: (pkg.sale as { id?: string }).id ?? null,
    name: pkg.sale.offer_name ?? "Session package",
    size: pkg.size,
    priceCents: pkg.priceCents,
    count,
    trained: t,
    bookedIn,
    bookedAfter: b - bookedIn,
  };
}

export type ClientOwed = {
  /** Left on sales, before tax. */
  salesCents: number;
  /** Sessions trained beyond what was bought. */
  unbilledSessions: number;
  /** The renewal those sessions started (null without a priced package). */
  renewal: PackageRenewal | null;
  /** Renewals owed × the package price (0 without a package). */
  renewalCents: number;
  totalCents: number;
  /** Any sale in the total was taxed, so GST applies on top. */
  taxed: boolean;
};

export function clientOwed(sales: Sale[], overdrawnSessions: number, bookedPast = 0): ClientOwed {
  const salesCents = sales.reduce((sum, s) => sum + saleOwedCents(s), 0);
  const unbilledSessions = Math.max(0, Math.floor(overdrawnSessions || 0));
  const renewal = packageRenewal(sales, unbilledSessions, bookedPast);
  const renewalCents = renewal ? renewal.count * renewal.priceCents : 0;
  return {
    salesCents,
    unbilledSessions,
    renewal,
    renewalCents,
    totalCents: salesCents + renewalCents,
    taxed: sales.some((s) => !s.archived_at && Number(s.amount_tax_paid_cents ?? 0) > 0),
  };
}
