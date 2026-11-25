/**
 * Plans (Nov 23 2026): what someone is on, what else they could be on, and
 * exactly what changing would mean. Pure and tested (plan-engine.test.ts); the
 * server (plans.server.ts) feeds it records and Stripe's numbers, the screens
 * (Manage plan, the coach's plan card) show what it returns.
 *
 * One account, three families:
 *   - free: the app, no charge (a self-serve member).
 *   - membership: a paid self-serve plan (coaching_packages.kind 'membership').
 *     Nothing is sold as one until a membership package is active, linked to a
 *     Stripe monthly price and the price matches (catalog `problem`).
 *   - coaching: a monthly coaching package (kind 'subscription').
 * One-time calls are packages too, but never a plan.
 *
 * Prices are never typed here: every number comes from coaching_packages (the
 * advertised price), the Stripe-backed product it's sold with, the client's own
 * enrollment (a contracted price) or Stripe's preview. A package whose Stripe
 * product or price is missing or doesn't match is shown but can't be picked.
 *
 * Who can switch themselves (`managed`):
 *   - "free": a free member (any paid plan starts with a checkout).
 *   - "stripe": a client on a package (an enrollment) paid by one live monthly
 *     Stripe subscription. Up a level happens now with the difference charged
 *     (prorated); down a level or to free happens when the paid month ends.
 *   - "custom": anything else (session packages, a legacy or custom price with
 *     no package, a fixed term, paid another way). Changing it is a request to
 *     the coach, never a second subscription or a guess. One exception: a legacy
 *     coaching subscription (one live monthly Stripe subscription, no fixed term,
 *     no sessions) can be cancelled at the end of its paid month (`cancelable`).
 *
 * Coaching is sold by approval (Nov 24 2026): someone who isn't a coaching client
 * applies (never coached) or asks to come back (coached before), the coach says
 * yes (coaching_purchase_approvals), and only then can they pay for a package
 * (`CoachingAccess`). A grandfathered or custom price is never changed without
 * the client's consent: switching ends it (said first, and they tick that they
 * understand), or the coach offers a switch the client accepts (`offerTerms`).
 */
import { compareVersions } from "@/lib/coaching-agreement/version";

export type PlanFamily = "free" | "membership" | "coaching";
export type PackageKindForPlans = "free" | "membership" | "subscription" | "one_time";

/** A coaching_packages row, as much as plans need. */
export type CatalogPackage = {
  id: string;
  slug: string;
  kind: PackageKindForPlans | string;
  name: string;
  tagline?: string | null;
  best_for?: string | null;
  features?: string[] | null;
  price_cents: number | null;
  currency?: string | null;
  billing_interval?: string | null;
  recommended?: boolean | null;
  status: string;
  is_public?: boolean | null;
  sort_order?: number | null;
  included_calls?: number | null;
  call_minutes?: number | null;
  product_id?: string | null;
  /** Sold straight from the site without the coach's approval (coaching_packages.direct_checkout). */
  direct_checkout?: boolean | null;
};

/** The coaching_products row a package is sold with. */
export type CatalogProduct = {
  id: string;
  name?: string | null;
  price_cents: number | null;
  currency?: string | null;
  stripe_price_id?: string | null;
  mode?: string | null;
  payment_structure?: string | null;
  active?: boolean | null;
  archived?: boolean | null;
};

export type PlanOption = {
  id: string;
  slug: string;
  name: string;
  family: PlanFamily;
  tagline: string | null;
  bestFor: string | null;
  /** The advertised monthly price before tax (0 for free). */
  priceCents: number;
  currency: string;
  /** What's included, "Everything in X" spelled out. */
  features: string[];
  includedCalls: number;
  callMinutes: number;
  recommended: boolean;
  /** On the public site. Unlisted active packages are still plans (a custom offer). */
  listed: boolean;
  /** Higher = more service. Free < membership < coaching; within a family by price. */
  rank: number;
  stripePriceId: string | null;
  productId: string | null;
  /** Why it can't be bought yet (a configuration problem for the admin), else null. */
  problem: string | null;
  /** The coach sells it without an approval (a coaching package with direct_checkout on). */
  directCheckout: boolean;
};

const FAMILY_BASE: Record<PlanFamily, number> = { free: 0, membership: 1, coaching: 2 };

export function planFamilyOf(kind: string | null | undefined): PlanFamily | null {
  if (kind === "free") return "free";
  if (kind === "membership") return "membership";
  if (kind === "subscription") return "coaching";
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** "Everything in Complete Online Coaching" → that package's own lines (recursively), the rest as written. */
export function expandFeatures(pkg: CatalogPackage, all: readonly CatalogPackage[], seen: Set<string> = new Set()): string[] {
  if (seen.has(pkg.id)) return [];
  seen.add(pkg.id);
  const out: string[] = [];
  for (const raw of pkg.features ?? []) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const m = /^everything in (.+?)\.?$/i.exec(line);
    const ref = m ? all.find((p) => norm(p.name) === norm(m[1])) : null;
    if (ref) out.push(...expandFeatures(ref, all, seen));
    else out.push(line);
  }
  const keys = new Set<string>();
  return out.filter((l) => {
    const k = norm(l);
    if (keys.has(k)) return false;
    keys.add(k);
    return true;
  });
}

/** Lines that only say "you have the app" (every plan does): never a gain or a loss. */
const APP_LINE = /\b(the )?full app\b/i;

function isRecurringProduct(p: CatalogProduct): boolean {
  const mode = String(p.mode ?? "").toLowerCase();
  if (mode === "subscription") return true;
  if (mode === "payment") return false;
  return /monthly|month|recurring|subscription/i.test(String(p.payment_structure ?? ""));
}

/** Why a paid package can't be sold right now (null = it can). */
export function configProblem(pkg: CatalogPackage, product: CatalogProduct | null | undefined): string | null {
  const family = planFamilyOf(pkg.kind);
  if (family === "free") return null;
  if (!pkg.price_cents || pkg.price_cents <= 0) return "No price set";
  if ((pkg.billing_interval ?? "month") !== "month") return "Not a monthly plan";
  if (!pkg.product_id) return "Not linked to a Stripe product";
  if (!product) return "Its Stripe product is missing";
  if (product.archived || product.active === false) return "Its Stripe product is archived";
  if (!product.stripe_price_id) return "Its product has no Stripe price";
  if (!isRecurringProduct(product)) return "Its product isn't a monthly subscription";
  if (Number(product.price_cents ?? 0) !== Number(pkg.price_cents)) return "Its product's price doesn't match the package";
  if (String(product.currency ?? "cad").toLowerCase() !== String(pkg.currency ?? "cad").toLowerCase()) return "Its product's currency doesn't match";
  return null;
}

/** Every active plan package, in the order a comparison shows them (free first, then by price). */
export function buildCatalog(packages: readonly CatalogPackage[], products: readonly CatalogProduct[]): PlanOption[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: PlanOption[] = [];
  for (const pkg of packages) {
    if (pkg.status !== "active") continue;
    const family = planFamilyOf(pkg.kind);
    if (!family) continue;
    const product = pkg.product_id ? byId.get(pkg.product_id) ?? null : null;
    const price = family === "free" ? 0 : Math.max(0, Number(pkg.price_cents ?? 0));
    out.push({
      id: pkg.id,
      slug: pkg.slug,
      name: pkg.name,
      family,
      tagline: pkg.tagline ?? null,
      bestFor: pkg.best_for ?? null,
      priceCents: price,
      currency: String(pkg.currency ?? "CAD").toUpperCase(),
      features: expandFeatures(pkg, packages),
      includedCalls: family === "coaching" ? Number(pkg.included_calls ?? 0) || 0 : 0,
      callMinutes: Number(pkg.call_minutes ?? 30) || 30,
      recommended: !!pkg.recommended,
      listed: !!pkg.is_public,
      rank: FAMILY_BASE[family] * 10_000_000 + price,
      stripePriceId: family === "free" ? null : product?.stripe_price_id ?? null,
      productId: pkg.product_id ?? null,
      problem: configProblem(pkg, product),
      directCheckout: family === "coaching" && !!pkg.direct_checkout,
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

/* ───────────────────────── what they're on now ───────────────────────── */

export type PlanSale = {
  id: string;
  offer_name?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  payment_status?: string | null;
  next_billing_date?: string | null;
  cancel_at_period_end?: boolean | null;
  full_payable_amount?: number | string | null;
  stripe_price_id?: string | null;
  is_fixed_term_commitment?: boolean | null;
  sessions_purchased?: number | null;
  archived_at?: string | null;
  stripe_mode?: string | null;
};

export type PlanEnrollment = {
  id: string;
  package_id: string;
  sale_id: string | null;
  contracted_price_cents: number | null;
  starts_on?: string | null;
};

export type CurrentPlanStatus = "free" | "active" | "trialing" | "past_due" | "ending" | "custom";

export type CurrentPlan = {
  family: PlanFamily | "custom";
  option: PlanOption | null;
  name: string;
  /** What they pay a month before tax (null = not known, e.g. custom). */
  priceCents: number | null;
  managed: "free" | "stripe" | "custom";
  /** Why a custom plan can't be changed here, in their words. */
  customReason: string | null;
  status: CurrentPlanStatus;
  saleId: string | null;
  subscriptionId: string | null;
  /** The next charge (or the day it stops, when ending). */
  nextBillingDate: string | null;
  /** They pay something other than the advertised price (grandfathered or custom). */
  specialPrice: boolean;
  /** A price they keep only while they stay on it (special price, or a custom plan's own price). */
  grandfathered: boolean;
  /** A custom plan that can still be cancelled here (a legacy monthly coaching subscription). */
  cancelable: boolean;
  features: string[];
};

const LIVE_SUB = new Set(["active", "trialing", "past_due"]);

/** Is this sale a live Stripe subscription (charging, about to, or retrying)? */
export function saleIsLive(sale: PlanSale | null | undefined): boolean {
  if (!sale || sale.archived_at) return false;
  if (!sale.stripe_subscription_id) return false;
  const s = String(sale.stripe_subscription_status ?? "").toLowerCase();
  if (s) return LIVE_SUB.has(s);
  return /active subscription|overdue/i.test(String(sale.payment_status ?? ""));
}

function saleStatus(sale: PlanSale): CurrentPlanStatus {
  const s = String(sale.stripe_subscription_status ?? "").toLowerCase();
  if (s === "past_due" || /overdue|failed/i.test(String(sale.payment_status ?? ""))) return "past_due";
  if (sale.cancel_at_period_end) return "ending";
  if (s === "trialing") return "trialing";
  return "active";
}

export function currentPlanOf(input: {
  tier: "coaching" | "self_serve";
  enrollment: PlanEnrollment | null;
  sale: PlanSale | null;
  catalog: readonly PlanOption[];
  /** The client's "Coaching package" text (custom arrangements). */
  coachingLabel?: string | null;
  /** Any other live coaching sale (a legacy subscription, a session package's auto-pay). */
  otherLiveSale?: PlanSale | null;
}): CurrentPlan {
  const { tier, enrollment, sale, catalog } = input;
  const free = catalog.find((o) => o.family === "free") ?? null;
  const onPackage = enrollment ? catalog.find((o) => o.id === enrollment.package_id) ?? null : null;
  const blank = {
    saleId: null as string | null,
    subscriptionId: null as string | null,
    nextBillingDate: null as string | null,
    specialPrice: false,
    grandfathered: false,
    cancelable: false,
  };

  const managedPaid = (option: PlanOption, s: PlanSale): CurrentPlan => {
    const paying = enrollment?.contracted_price_cents ?? (Math.round(Number(s.full_payable_amount ?? 0) * 100) || option.priceCents);
    return {
      family: option.family,
      option,
      name: option.name,
      priceCents: paying,
      managed: "stripe",
      customReason: null,
      status: saleStatus(s),
      saleId: s.id,
      subscriptionId: s.stripe_subscription_id ?? null,
      nextBillingDate: s.next_billing_date ?? null,
      specialPrice: paying !== option.priceCents,
      grandfathered: paying !== option.priceCents,
      cancelable: true,
      features: option.features,
    };
  };

  if (tier === "self_serve") {
    if (onPackage?.family === "membership" && sale && saleIsLive(sale) && !sale.is_fixed_term_commitment) {
      return managedPaid(onPackage, sale);
    }
    return {
      family: "free",
      option: free,
      name: free?.name ?? "Free app",
      priceCents: 0,
      managed: "free",
      customReason: null,
      status: "free",
      ...blank,
      features: free?.features ?? [],
    };
  }

  // coaching
  if (onPackage && onPackage.family !== "free" && sale && saleIsLive(sale) && !sale.is_fixed_term_commitment && !(Number(sale.sessions_purchased ?? 0) > 0)) {
    return managedPaid(onPackage, sale);
  }
  const billed = sale ?? input.otherLiveSale ?? null;
  const legacy = legacyMonthly(billed);
  const reason = onPackage
    ? sale?.is_fixed_term_commitment
      ? "You're on a set term, so changes go through your coach."
      : "Your coaching is billed a different way, so changes go through your coach."
    : input.otherLiveSale
      ? "Your plan is set up with your coach, so changes go through them."
      : "Your coaching is set up with your coach, so changes go through them.";
  const price = enrollment?.contracted_price_cents ?? (legacy ? Math.round(Number(billed!.full_payable_amount ?? 0) * 100) || null : null);
  return {
    family: "custom",
    option: onPackage ?? null,
    // what they actually pay for first; the profile's free-text label can be out of date
    name: onPackage?.name ?? (input.otherLiveSale?.offer_name?.trim() || input.coachingLabel?.trim() || "Coaching"),
    priceCents: price,
    managed: "custom",
    customReason: reason,
    status: legacy && billed?.cancel_at_period_end ? "ending" : "custom",
    ...blank,
    saleId: billed?.id ?? null,
    subscriptionId: legacy ? billed!.stripe_subscription_id ?? null : null,
    nextBillingDate: billed?.next_billing_date ?? null,
    specialPrice: price != null && price !== onPackage?.priceCents,
    grandfathered: price != null,
    cancelable: legacy,
    features: onPackage?.features ?? [],
  };
}

/**
 * A legacy coaching subscription that can be cancelled here: one live Stripe
 * subscription, monthly, no fixed term, no session package. Anything else is
 * the coach's to change.
 */
export function legacyMonthly(sale: (PlanSale & { is_recurring?: boolean | null; payment_frequency?: string | null }) | null | undefined): boolean {
  if (!sale || !saleIsLive(sale) || sale.is_fixed_term_commitment) return false;
  if (Number(sale.sessions_purchased ?? 0) > 0) return false;
  const freq = String(sale.payment_frequency ?? "").toLowerCase();
  if (freq && !/month/.test(freq)) return false;
  return true;
}

/* ───────────────────────── changing ───────────────────────── */

export type ChangeKind = "current" | "start" | "upgrade" | "downgrade" | "cancel" | "request" | "apply" | "comeback";
export type ChangeAction = "checkout" | "swap_now" | "swap_later" | "cancel_later" | "request" | "apply" | "comeback" | null;

/**
 * May this person buy coaching? A coaching client may switch packages; anyone
 * else needs a live approval from the coach first.
 *   - approved: the coach said yes (for one package, or any), until it expires.
 *   - apply / applied: never coached, so they apply (and wait).
 *   - comeback / comeback_pending: coached before, so they ask to come back.
 */
export type CoachingAccess =
  | { state: "client" }
  | { state: "approved"; packageId: string | null; packageName: string | null; expiresAt: string }
  | { state: "apply" }
  | { state: "applied"; at: string; applicationId?: string }
  | { state: "comeback" }
  | { state: "comeback_pending"; at: string; changeId: string };

export type OpenChange = {
  id: string;
  status: string;
  kind: string;
  toName: string | null;
  effectiveAt: string | null;
};

export type Transition = {
  kind: ChangeKind;
  action: ChangeAction;
  /** When it takes effect. */
  timing: "now" | "period_end" | "after_payment" | null;
  /** False = shown, but the button is off and `blocked` says why. */
  available: boolean;
  blocked: string | null;
  /** The configuration problem behind `blocked` (for the admin), if any. */
  configProblem: string | null;
};

/** Statuses of a change still in flight (one per client at a time). */
export const OPEN_CHANGE_STATUSES = ["checkout", "processing", "awaiting_payment", "scheduled"] as const;

export function transitionFor(
  current: CurrentPlan,
  target: PlanOption,
  ctx: { native?: boolean; open?: OpenChange | null; coaching?: CoachingAccess } = {},
): Transition {
  const t = (kind: ChangeKind, action: ChangeAction, timing: Transition["timing"]): Transition => ({
    kind,
    action,
    timing,
    available: true,
    blocked: null,
    configProblem: null,
  });
  const block = (tr: Transition, why: string, config: string | null = null): Transition => ({ ...tr, available: false, blocked: why, configProblem: config });

  if (current.option?.id === target.id) return block(t("current", null, null), "Your current plan");

  let tr: Transition;
  if (current.managed === "custom") {
    // a legacy monthly subscription can be cancelled at its period's end; any other change is a request
    if (!(target.family === "free" && current.cancelable)) return t("request", "request", null);
    tr = t("cancel", "cancel_later", "period_end");
  } else if (current.managed === "free") {
    if (target.family === "free") return block(t("current", null, null), "Your current plan");
    tr = t("start", "checkout", "after_payment");
  } else if (target.family === "free") {
    tr = t("cancel", "cancel_later", "period_end");
  } else if (target.rank > (current.option?.rank ?? 0)) {
    tr = t("upgrade", "swap_now", "now");
  } else {
    tr = t("downgrade", "swap_later", "period_end");
  }

  if (target.family !== "free" && target.problem) return block(tr, "Not available yet", target.problem);
  // coaching is sold by approval: anyone who isn't a coaching client yet applies or asks to come back,
  // except a package the coach sells straight (direct checkout), which someone never coached may buy
  // (a former client still asks to come back)
  if (target.family === "coaching" && current.family !== "coaching" && current.family !== "custom") {
    const asked = ctx.coaching ?? { state: "apply" };
    const access: CoachingAccess = target.directCheckout && (asked.state === "apply" || asked.state === "applied") ? { state: "client" } : asked;
    if (access.state === "apply") return t("apply", "apply", null);
    if (access.state === "applied") return block(t("apply", "apply", null), "Your application is with your coach");
    if (access.state === "comeback") return t("comeback", "comeback", null);
    if (access.state === "comeback_pending") return block(t("comeback", "comeback", null), "Your request is with your coach");
    if (access.state === "approved" && access.packageId && access.packageId !== target.id) {
      return block(tr, `Your coach approved ${access.packageName ?? "another package"}`);
    }
  }
  if (ctx.open && (OPEN_CHANGE_STATUSES as readonly string[]).includes(ctx.open.status)) {
    if (ctx.open.status === "scheduled") return block(tr, "Undo your scheduled change first");
    if (ctx.open.status !== "checkout") return block(tr, "A change is still going through");
  }
  if (current.status === "ending" && tr.kind !== "cancel") return block(tr, "Keep your plan first to change it");
  if (current.status === "ending" && tr.kind === "cancel") return block(t("current", null, null), "Your plan is already ending");
  if (current.status === "past_due" && (tr.action === "swap_now" || tr.action === "checkout")) {
    return block(tr, "Update your card first");
  }
  if (ctx.native && (tr.action === "checkout" || tr.action === "swap_now")) {
    return block(tr, "Upgrade on the web at jfeffect.com");
  }
  return tr;
}

/**
 * The plans someone is shown: listed ones that can be bought, plus the one
 * they're on. A package that can't be sold yet (a configuration problem) is
 * the admin's to fix and never shown to a client as a dead end.
 */
export function visibleOptions(catalog: readonly PlanOption[], current: CurrentPlan): PlanOption[] {
  return catalog.filter((o) => o.id === current.option?.id || (o.listed && (o.family === "free" || !o.problem)));
}

/** Packages that are listed (or someone's on) but can't be sold: the admin's to-do. */
export function configIssues(catalog: readonly PlanOption[]): Array<{ slug: string; name: string; problem: string }> {
  return catalog.filter((o) => o.family !== "free" && o.problem && o.listed).map((o) => ({ slug: o.slug, name: o.name, problem: o.problem! }));
}

/* ───────────────────────── what you'd gain and lose ───────────────────────── */

/** Always theirs, whatever plan they're on. */
export const ALWAYS_KEPT = [
  "Every workout, set and PR you've logged",
  "Your progress photos, bodyweight and nutrition history",
  "Your account, your Crew profile and your posts",
];

export type FeatureDiff = { gain: string[]; lose: string[] };

/**
 * What changes between two plans' included lists. `base` is what every plan
 * has (the free app's own lines): never a gain or a loss, so moving from Free
 * to coaching never "loses" the app, and moving down never "gains" it.
 */
export function featureDiff(from: readonly string[], to: readonly string[], base: readonly string[] = []): FeatureDiff {
  const has = (xs: readonly string[], l: string) => xs.some((x) => norm(x) === norm(l));
  const clean = (xs: readonly string[]) => xs.filter((l) => !APP_LINE.test(l) && !has(base, l));
  const a = clean(from);
  const b = clean(to);
  return { gain: b.filter((l) => !has(a, l)), lose: a.filter((l) => !has(b, l)) };
}

/** The lines every plan includes (the free app's). */
export function baseFeatures(catalog: readonly PlanOption[]): string[] {
  return catalog.find((o) => o.family === "free")?.features ?? [];
}

/* ───────────────────────── the money, in words ───────────────────────── */

/** "$130", "$12.50". */
export function money(cents: number | null | undefined, currency = "CAD"): string {
  const c = Math.round(Number(cents ?? 0));
  const whole = c % 100 === 0;
  const s = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  void currency;
  return `${c < 0 ? "−" : ""}$${s}`;
}

export type ChangeQuote = {
  kind: ChangeKind;
  timing: Transition["timing"];
  /** What they pay today (null = worked out at checkout, with tax). */
  todayCents: number | null;
  /** Tax is in todayCents (a Stripe preview) or comes on top. */
  todayTaxIncluded: boolean;
  /** What they pay each month going forward (0 = nothing). */
  nextCents: number;
  nextTaxIncluded: boolean;
  /** The first charge at the new price (or the day the change happens). */
  nextDate: string | null;
  /** When the change takes effect (YYYY-MM-DD), null = now / once paid. */
  effectiveDate: string | null;
  /** A credit Stripe keeps for their next invoices (negative proration), if any. */
  creditCents: number;
};

/**
 * The lines the confirm sheet shows, from a quote. Plain words: what they pay
 * today, what they pay going forward, and when it happens.
 */
export function quoteLines(q: ChangeQuote, fmtDay: (iso: string | null) => string | null): { today: string; forward: string; when: string } {
  const day = (iso: string | null) => (iso ? fmtDay(iso) ?? iso : null);
  const tax = (included: boolean) => (included ? "" : " + tax");
  let today: string;
  if (q.todayCents === null) today = "Set at checkout (plus tax)";
  else if (q.todayCents <= 0) today = q.creditCents > 0 ? `$0 (${money(q.creditCents)} credit for later)` : "$0";
  else today = `${money(q.todayCents)}${tax(q.todayTaxIncluded)}`;

  const forward =
    q.nextCents > 0
      ? `${money(q.nextCents)}${tax(q.nextTaxIncluded)} a month${q.nextDate ? `, from ${day(q.nextDate)}` : ""}`
      : "Nothing. It's free.";

  const when =
    q.timing === "now"
      ? "Right away, once the payment goes through"
      : q.timing === "after_payment"
        ? "As soon as your payment goes through"
        : q.effectiveDate
          ? `${day(q.effectiveDate)}, when your paid month ends`
          : "When your paid month ends";
  return { today, forward, when };
}

/** The headline for a change ("Upgrade to Coaching Plus"). */
export function changeVerb(kind: ChangeKind, toName: string): string {
  switch (kind) {
    case "start":
      return `Start ${toName}`;
    case "upgrade":
      return `Upgrade to ${toName}`;
    case "downgrade":
      return `Switch to ${toName}`;
    case "cancel":
      return `Move to ${toName}`;
    case "request":
      return `Ask about ${toName}`;
    case "apply":
      return `Apply for ${toName}`;
    case "comeback":
      return `Come back to coaching`;
    default:
      return toName;
  }
}

/* ───────────────────────── the change record ───────────────────────── */

export type PlanChangeRow = {
  id: string;
  kind: string;
  status: string;
  from_label: string | null;
  to_label: string | null;
  effective_at: string | null;
  created_at: string;
  applied_at?: string | null;
  source?: string | null;
  amount_due_now_cents?: number | null;
  next_amount_cents?: number | null;
  error?: string | null;
  offer_expires_at?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
};

/** One history line ("Nov 23 · Complete Online Coaching → Coaching Plus · Done"). */
export function historyLine(r: PlanChangeRow, fmtDay: (iso: string | null) => string | null): { title: string; detail: string } {
  const from = r.from_label ?? "Free";
  const to = r.to_label ?? "Free";
  const when = (iso: string | null | undefined) => (iso ? fmtDay(iso.slice(0, 10)) ?? iso.slice(0, 10) : null);
  const title =
    r.status === "offered"
      ? `Offer: ${to}`
      : r.kind === "request"
        ? `Asked to change to ${to}`
        : r.kind === "reactivate"
          ? r.status === "requested" || r.decided_at
            ? `Asked to come back to coaching`
            : `Kept ${to}`
          : `${from} → ${to}`;
  const status: Record<string, string> = {
    checkout: "Waiting for checkout",
    processing: "Going through",
    awaiting_payment: "Waiting for payment",
    scheduled: r.effective_at ? `Happens ${when(r.effective_at)}` : "Scheduled",
    applied: r.applied_at ? `Done ${when(r.applied_at)}` : "Done",
    cancelled: "Undone",
    failed: r.error ? `Didn't go through: ${r.error}` : "Didn't go through",
    requested: "Sent to your coach",
    offered: r.offer_expires_at ? `Open until ${when(r.offer_expires_at)}` : "Waiting for you",
  };
  if (r.decided_at && r.status === "applied" && r.kind === "reactivate") return { title, detail: `Approved ${when(r.decided_at)}` };
  if (r.decided_at && r.status === "cancelled") return { title, detail: r.decision_note ? `Declined: ${r.decision_note}` : `Declined ${when(r.decided_at)}` };
  return { title, detail: status[r.status] ?? r.status };
}

/** Coach-chat words for a custom plan's request. */
export function requestMessage(fromName: string, toName: string, note?: string | null): string {
  const base = `I'd like to change my plan from ${fromName} to ${toName}. Can you set that up?`;
  const extra = (note ?? "").trim();
  return extra ? `${base}\n\n${extra}` : base;
}

/* ───────────────────────── what the screens get back ───────────────────────── */

export type PlanPreview = {
  toSlug: string;
  toName: string;
  transition: Transition;
  headline: string;
  quote: ChangeQuote | null;
  gain: string[];
  lose: string[];
  keep: string[];
  warnings: string[];
  /** Pass back on confirm: an upgrade is charged exactly what this preview showed. */
  prorationDate: number | null;
  /** Their own price ends with this change: they tick that they understand before confirming. */
  forfeit: { priceCents: number; text: string } | null;
  /** The Coaching Agreement version they must accept first (null = nothing to sign). */
  agreement: { version: string; signedVersion: string | null } | null;
};

export type ConfirmResult =
  | { result: "redirect"; url: string; changeId: string }
  | { result: "applied"; changeId: string }
  | { result: "scheduled"; changeId: string; effectiveDate: string | null }
  | { result: "needs_payment"; changeId: string; url: string }
  | { result: "requested"; changeId: string }
  | { result: "agreement_required"; version: string }
  | { result: "failed"; changeId: string | null; message: string };

/* ───────────────────────── agreements and consent ───────────────────────── */

/**
 * The Coaching Agreement that describes buying and switching coaching in the
 * app. Earlier signers keep their signed copy (nobody re-signs for it); they
 * accept this one before they buy coaching or switch packages themselves.
 */
export const PLAN_AGREEMENT_VERSION = "3.0";

/** Must they accept the Coaching Agreement before this change? */
export function agreementNeeded(
  tr: Transition,
  target: PlanOption,
  signed: { version: string | null; exempt?: boolean },
): { version: string; signedVersion: string | null } | null {
  if (target.family !== "coaching") return null;
  if (!tr.available || !tr.action || !["checkout", "swap_now", "swap_later"].includes(tr.action)) return null;
  if (signed.exempt) return null;
  if (signed.version && compareVersions(signed.version, PLAN_AGREEMENT_VERSION) >= 0) return null;
  return { version: PLAN_AGREEMENT_VERSION, signedVersion: signed.version };
}

/** The words someone on their own price agrees to when they switch or cancel. */
export function forfeitText(current: CurrentPlan): string | null {
  if (!current.grandfathered || current.priceCents == null) return null;
  return `I understand my current price of ${money(current.priceCents)} a month is only kept on ${current.name}, and switching or cancelling ends it for good.`;
}

/* ───────────────────────── offers ───────────────────────── */

export type PlanOffer = {
  id: string;
  fromName: string;
  fromPriceCents: number | null;
  toName: string;
  toPriceCents: number;
  timing: "now" | "period_end";
  expiresAt: string | null;
  note: string | null;
  /** They pay through a live Stripe subscription (else accepting opens a checkout). */
  hasSubscription: boolean;
  /** The day the new price starts (their next billing date), when known. */
  nextBillingDate: string | null;
  grandfathered: boolean;
};

export function offerFromRow(row: Record<string, any>, current: CurrentPlan): PlanOffer {
  return {
    id: row.id,
    fromName: row.from_label ?? current.name,
    fromPriceCents: row.from_price_cents ?? current.priceCents,
    toName: row.to_label ?? "",
    toPriceCents: Number(row.to_price_cents ?? 0),
    timing: row.offer_timing === "now" ? "now" : "period_end",
    expiresAt: row.offer_expires_at ?? null,
    note: row.note ?? null,
    hasSubscription: !!current.subscriptionId,
    nextBillingDate: current.nextBillingDate,
    grandfathered: current.grandfathered,
  };
}

/**
 * Everything the client is told before accepting a coach's offer, and the exact
 * words they agree to (stored with the change). Built the same way on the
 * screen and on the server, so what's stored is what was shown.
 */
export function offerTerms(o: PlanOffer, fmtDay: (iso: string | null) => string | null): { lines: string[]; consentText: string } {
  const day = (iso: string | null) => (iso ? fmtDay(iso) ?? iso : null);
  const next = day(o.nextBillingDate);
  const lines: string[] = [];
  lines.push(`${o.toName}: ${money(o.toPriceCents)} a month, plus tax.`);
  if (o.fromPriceCents != null) lines.push(`You pay ${money(o.fromPriceCents)} a month now for ${o.fromName}.`);
  let when: string;
  if (!o.hasSubscription) {
    when = "starting when you pay at checkout";
    lines.push("Accepting opens a checkout to pay by card each month. Your coach stops the old way you pay.");
  } else if (o.timing === "now") {
    when = `switching today, with the new price from ${next ?? "your next billing date"}`;
    lines.push(`It switches today. Nothing is charged or credited today; the new price starts ${next ? `on ${next}` : "on your next billing date"}.`);
  } else {
    when = `switching on ${next ?? "your next billing date"}`;
    lines.push(`It switches ${next ? `on ${next}` : "on your next billing date"}. Nothing changes until then.`);
  }
  if (o.grandfathered && o.fromPriceCents != null) {
    lines.push(`Your ${money(o.fromPriceCents)} price is one you keep only on ${o.fromName}. Accepting ends it, and it can't be brought back later.`);
  }
  lines.push("Your coach, your program and everything you've logged stay as they are.");
  const forfeit = o.grandfathered && o.fromPriceCents != null ? ` My ${money(o.fromPriceCents)} price on ${o.fromName} ends.` : "";
  const consentText = `I accept ${o.toName} at ${money(o.toPriceCents)} a month plus tax, ${when}.${forfeit}`;
  return { lines, consentText };
}
