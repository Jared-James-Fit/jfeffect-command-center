/**
 * Selling sessions with a booking: the coach books a 1:1 and charges for it in
 * the same tap, with a product they already made (a single session, a pack) or
 * any price they type. The session is booked whether or not it's paid; the
 * sale holds its credit and the client pays by a Stripe link in their chat.
 * Pure helpers (tested). Server: session-sale.functions.ts and
 * sell_booked_sessions (20270117090000_sell_sessions_with_booking.sql); UI:
 * components/schedule/session-sale-picker.tsx, session-payment-line.tsx.
 */

import { clockLabel } from "@/lib/session-requests";

/** A coaching product the coach can sell with a booking (safe fields only). */
export type SaleProduct = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  sessions_included: number;
};

/** What the coach picked: one of their products, or their own price per session. */
export type SalePick = { productId: string | null; customCents: number | null };

export type SaleQuote = {
  /** Sessions the sale holds. */
  sessions: number;
  /** The sale's whole price before tax. */
  totalCents: number;
  /** One session's price (custom), or the product's own price. */
  unitCents: number;
  /** How many of the product (a single session sold for 4 bookings = 4). */
  quantity: number;
  /** "Single Session", "Single Session × 4", "12 Sessions / 4 Weeks", "1:1 Training · 1 session". */
  name: string;
  /** Booked sessions the sale doesn't cover (a single pack product on a 4-week repeat). */
  uncovered: number;
};

/** Stripe's smallest charge in CAD, and a ceiling on a typed price per session. */
export const MIN_SESSION_CENTS = 50;
export const MAX_SESSION_CENTS = 1_000_000;

/** Products a session can be sold as: one-time, holds sessions, priced in Stripe, not made for one client. */
export function saleProducts(rows: any[]): SaleProduct[] {
  return (rows ?? [])
    .filter((p) =>
      p && p.active !== false && !p.archived && (p.status ?? "Active") === "Active" && !p.is_one_off
      && Number(p.sessions_included ?? 0) > 0 && Number(p.price_cents ?? 0) >= MIN_SESSION_CENTS
      && !!p.stripe_price_id && String(p.mode ?? "payment") !== "subscription"
      && !/subscription|installment|bi-?weekly|monthly/i.test(String(p.payment_structure ?? "")))
    .map((p) => ({
      id: String(p.id),
      name: shortProductName(String(p.name ?? "")),
      price_cents: Number(p.price_cents),
      currency: String(p.currency ?? "CAD").toUpperCase(),
      sessions_included: Number(p.sessions_included),
    }))
    .sort((a, b) => a.sessions_included - b.sessions_included || a.price_cents - b.price_cents);
}

/** "Personal Training — Single Session" → "Single Session" (the dialog already says it's training). */
export function shortProductName(name: string): string {
  const cut = name.replace(/^\s*(personal training|1:1 training|pt)\s*[—–-]\s*/i, "").trim();
  return cut || name.trim();
}

/** The product a one-off session sells as by default: one session, else the smallest pack. */
export function defaultSaleProduct(products: SaleProduct[]): SaleProduct | null {
  return products.find((p) => p.sessions_included === 1) ?? products[0] ?? null;
}

/** "$30", "30.50", "$1,200" → cents; anything else (or under $0.50 / over $10,000) → null. */
export function parseDollars(text: string | null | undefined): number | null {
  const clean = String(text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents >= MIN_SESSION_CENTS && cents <= MAX_SESSION_CENTS ? cents : null;
}

/**
 * What the sale is for `count` booked sessions. A single-session product sells
 * once per booking; a pack sells once and holds its own sessions; a typed price
 * is per session.
 */
export function saleQuote(pick: SalePick, count: number, products: SaleProduct[], title = "1:1 Training"): SaleQuote | null {
  const n = Math.max(1, Math.floor(count || 1));
  if (pick.productId) {
    const p = products.find((x) => x.id === pick.productId);
    if (!p) return null;
    const quantity = p.sessions_included === 1 ? n : 1;
    const sessions = p.sessions_included * quantity;
    return {
      sessions,
      totalCents: p.price_cents * quantity,
      unitCents: p.price_cents,
      quantity,
      name: quantity > 1 ? `${p.name} × ${quantity}` : p.name,
      uncovered: Math.max(0, n - sessions),
    };
  }
  const unit = pick.customCents;
  if (!unit || unit < MIN_SESSION_CENTS || unit > MAX_SESSION_CENTS) return null;
  return {
    sessions: n,
    totalCents: unit * n,
    unitCents: unit,
    quantity: 1,
    name: `${(title || "1:1 Training").trim()} · ${n} session${n === 1 ? "" : "s"}`,
    uncovered: 0,
  };
}

export function money(cents: number, currency = "CAD"): string {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency", currency: currency.toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(cents / 100).replace(/^CA\$/, "$").replace(/^US\$/, "$");
  } catch {
    return `$${(cents / 100).toFixed(whole ? 0 : 2)}`;
  }
}

/** The Book button: "Book & send $100 link" / "Book 4 & send $400 link" / "Book & make $100 link". */
export function bookButtonLabel(q: SaleQuote | null, opts: { count: number; send: boolean; currency?: string }): string {
  const n = Math.max(1, opts.count);
  const book = n > 1 ? `Book ${n}` : "Book";
  if (!q) return n > 1 ? `Book ${n} Sessions` : "Book Session";
  return `${book} & ${opts.send ? "send" : "make"} ${money(q.totalCents, opts.currency)} link`;
}

/** "Tue, Nov 10 at 2:00 PM". */
export function sessionWhen(date: string, time: string): string {
  const day = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${clockLabel(time)}`;
}

/**
 * The chat message that carries the payment card. Says what's booked first
 * (that's what the client cares about), then the price and the link.
 */
export function sessionSaleMessage(i: {
  first?: string | null;
  title: string;
  when: string;
  booked: number;
  sessions: number;
  productName?: string | null;
  totalCents: number;
  currency?: string | null;
  url: string;
}): string {
  const first = (i.first ?? "").trim().split(/\s+/)[0];
  const hey = first ? `Hey ${first}! 👋` : "Hey! 👋";
  const title = (i.title || "1:1 Training").trim();
  const booked = i.sessions > i.booked && i.productName
    ? `Your ${i.productName} is set up, and your first session is booked for ${i.when}.`
    : i.booked > 1
      ? `You're booked for ${title}: ${i.booked} sessions starting ${i.when}.`
      : `You're booked for ${title} on ${i.when}.`;
  return [
    `${hey} ${booked}`,
    "",
    `Here's your secure link to pay (${money(i.totalCents, i.currency ?? "CAD")} + applicable tax):`,
    "",
    i.url,
    "",
    "Takes about a minute. See you then! 💪",
  ].join("\n");
}

/**
 * Which sale a session is on, read for the session sheet: paid, waiting on the
 * link, or part paid. `state` is saleMoney's.
 */
export function paymentLineText(state: string, o: { priceText: string; leftText?: string | null; first: string }): { tone: "paid" | "waiting" | "owed" | "ended"; text: string } {
  switch (state) {
    case "paid":
    case "free":
      return { tone: "paid", text: `Paid · ${o.priceText}` };
    case "waiting":
      return { tone: "waiting", text: `Waiting on ${o.first || "them"} to pay · ${o.priceText}` };
    case "left":
    case "past_due":
      return { tone: "owed", text: `${o.leftText ?? o.priceText} left to pay` };
    case "renews":
    case "cancelling":
      return { tone: "paid", text: `On their subscription · ${o.priceText}` };
    default:
      return { tone: "ended", text: "Its sale was cancelled or refunded" };
  }
}
