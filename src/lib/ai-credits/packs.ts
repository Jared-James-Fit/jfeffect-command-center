/**
 * AI credits: what members and clients get each month, what the AI features
 * cost, and the packs sold through Stripe. Pure (UI and server alike).
 *
 * One credit is one quick AI action (an AI food log). The database decides
 * the cost (`ai_credit_cost`, 20270313090000_ai_credits.sql); FEATURE_COSTS
 * mirrors it so the app can say what something costs before it's tapped
 * (the test keeps the two in step).
 *
 * Pricing (Nov 13 2026, CAD before tax; Stripe Tax adds GST at checkout):
 * an AI food log runs on GPT-5 mini at about 300 tokens in and up to ~1,000
 * out with its reasoning, $0.25 / $2.00 per million tokens: about US$0.002,
 * call it C$0.003 at the most. Stripe takes 2.9% + C$0.30 of the total.
 *
 *   pack       price   AI cost (max)   Stripe fee   kept    margin
 *   100        $2.99   $0.30           $0.39        $2.30   77%
 *   300        $6.99   $0.90           $0.51        $5.58   80%
 *   1,000      $14.99  $3.00           $0.76        $11.23  75%
 *
 * Real AI cost so far is a fraction of that (most calls use far fewer
 * tokens), and admins see the measured cost against sales on Settings → AI.
 * Each pack is cheaper per credit than the one before it, and even the
 * biggest is well under what AI food logging apps charge a month.
 */

export type AiFeature = "meal_estimate";

/** Credits per use. Must match `public.ai_credit_cost`. */
export const FEATURE_COSTS: Record<AiFeature, number> = {
  meal_estimate: 1,
};

export const FEATURE_LABEL: Record<AiFeature, { one: string; many: string }> = {
  meal_estimate: { one: "AI food log", many: "AI food logs" },
};

export type CreditPack = {
  key: "p100" | "p300" | "p1000";
  credits: number;
  /** Before tax, in cents (CAD). */
  amountCents: number;
  tag?: string;
};

export const CREDIT_CURRENCY = "cad";

export const CREDIT_PACKS: CreditPack[] = [
  { key: "p100", credits: 100, amountCents: 299 },
  { key: "p300", credits: 300, amountCents: 699, tag: "Most popular" },
  { key: "p1000", credits: 1000, amountCents: 1499, tag: "Best value" },
];

export function packByKey(key: string | null | undefined): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.key === key) ?? null;
}

/** "$6.99" */
export function packPrice(p: Pick<CreditPack, "amountCents">): string {
  return `$${(p.amountCents / 100).toFixed(2)}`;
}

/** "2.3¢ a credit" */
export function perCredit(p: Pick<CreditPack, "amountCents" | "credits">): string {
  const cents = p.amountCents / p.credits;
  return `${cents < 10 ? cents.toFixed(1).replace(/\.0$/, "") : Math.round(cents)}¢ a credit`;
}

/** "1,000" */
export function creditsNumber(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-CA");
}

/** Stripe's lookup key for a pack at its price, so a price change makes a new Stripe price instead of reusing the old one. */
export function packLookupKey(p: CreditPack): string {
  return `jf_ai_credits_${p.credits}_${p.amountCents}_${CREDIT_CURRENCY}`;
}

/** What the database says about a person's credits (`ai_credit_state` / `ai_credit_detail`). */
export type CreditState = {
  tier: "staff" | "coaching" | "member";
  unlimited: boolean;
  allowance: number | null;
  used: number;
  allowance_left: number | null;
  extra: number;
  left: number | null;
  period_start: string;
  resets_on: string;
  costs: Partial<Record<AiFeature, number>>;
};

export type CreditDetail = CreditState & {
  uses_this_month?: Partial<Record<AiFeature, number>>;
  history?: Array<{
    id: string;
    kind: "purchase" | "grant" | "reversal";
    credits: number;
    note: string | null;
    at: string;
  }>;
  purchases?: Array<{
    id: string;
    pack: string;
    credits: number;
    amount_minor: number;
    tax_minor: number;
    total_minor: number;
    currency: string;
    status: string;
    at: string;
  }>;
};

/** Can this person run a feature right now? Unlimited (staff) always can. */
export function canAfford(
  s: Pick<CreditState, "unlimited" | "left"> | null | undefined,
  feature: AiFeature,
): boolean {
  if (!s) return true;
  if (s.unlimited) return true;
  return (s.left ?? 0) >= FEATURE_COSTS[feature];
}

/** "Dec 1" from "2026-12-01", read as a calendar date (never shifted by the phone's zone). */
export function resetDay(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The short line under the number: where the credits come from. */
export function creditsBreakdown(s: CreditState): string {
  if (s.unlimited) return "Unlimited for staff";
  const parts: string[] = [];
  if ((s.allowance ?? 0) > 0)
    parts.push(
      `${creditsNumber(s.allowance_left ?? 0)} of ${creditsNumber(s.allowance ?? 0)} free this month`,
    );
  if (s.extra > 0) parts.push(`${creditsNumber(s.extra)} bought`);
  return parts.join(" · ") || "No credits left this month";
}

/** "Free credits reset Dec 1", or how bought ones work when there's no monthly allowance. */
export function resetLine(s: CreditState): string {
  if (s.unlimited) return "";
  if ((s.allowance ?? 0) > 0)
    return `Free credits reset ${resetDay(s.resets_on)}. Bought credits never expire.`;
  return "Bought credits never expire.";
}

/** The chip beside an AI button: "12 left" (or nothing for staff). */
export function chipLabel(s: CreditState | null | undefined): string | null {
  if (!s || s.unlimited || s.left == null) return null;
  return s.left > 0 ? `${creditsNumber(s.left)} left` : "0 left";
}

/** A return path inside the app, never another site ("/portal/nutrition"); anything else goes to Account. */
export function safeReturnPath(path: string | null | undefined): string {
  const p = String(path ?? "").split("#")[0];
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return "/portal/account";
  return p.slice(0, 300);
}

/** The Stripe success URL: back where they were, with the session for the confirm call. */
export function checkoutReturnUrls(
  origin: string,
  returnPath: string,
): { success: string; cancel: string } {
  const base = new URL(safeReturnPath(returnPath), origin);
  base.searchParams.delete("credits");
  base.searchParams.delete("cs");
  const cancel = new URL(base.toString());
  cancel.searchParams.set("credits", "cancelled");
  base.searchParams.set("credits", "done");
  // Stripe fills in {CHECKOUT_SESSION_ID}; it must stay unencoded.
  return { success: `${base.toString()}&cs={CHECKOUT_SESSION_ID}`, cancel: cancel.toString() };
}
