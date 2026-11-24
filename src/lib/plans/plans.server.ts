/**
 * Plan changes, server side (Nov 23 2026). Never import from the browser.
 *
 * Reads a client's plan from their records (plan-engine.ts decides what it
 * means), asks Stripe for exact prorated amounts, makes the change in Stripe
 * the way plan-stripe.ts describes, and applies it in the app only once it's
 * real: a checkout once Stripe says it's paid, an upgrade once its charge
 * succeeded, a downgrade or cancel on the day the paid month ends.
 *
 * Applying is idempotent (the webhook, the tick and the request itself can all
 * try; the enrollment, the sale and the tier end up the same and only the one
 * that marks the change applied sends the notices). Nothing is ever deleted:
 * an enrollment is ended, a sale keeps its payments, a coaching client who
 * moves to the free app keeps every record (plan_apply_tier).
 *
 * Every function here takes the service-role client; callers check who's asking.
 */
import { stripeFetch, formEncode, getStripeKeyForMode, detectStripeKeyMode, type StripeMode } from "@/lib/stripe.server";
import { compareVersions as compareVersion } from "@/lib/coaching-agreement/version";
import {
  agreementNeeded,
  baseFeatures,
  buildCatalog,
  forfeitText,
  offerFromRow,
  offerTerms,
  PLAN_AGREEMENT_VERSION,
  type CoachingAccess,
  changeVerb,
  currentPlanOf,
  featureDiff,
  money,
  OPEN_CHANGE_STATUSES,
  saleIsLive,
  transitionFor,
  ALWAYS_KEPT,
  type CatalogPackage,
  type CatalogProduct,
  type ChangeQuote,
  type CurrentPlan,
  type OpenChange,
  type PlanEnrollment,
  type PlanFamily,
  type PlanOption,
  type PlanSale,
  type Transition,
  type PlanPreview,
  type ConfirmResult,
} from "@/lib/plans/plan-engine";
import {
  CANCEL_LATER_PARAMS,
  KEEP_PARAMS,
  previewParams,
  readPreview,
  subProblem,
  subState,
  swapLaterParams,
  swapNowParams,
  unixToDay,
  upgradeOutcome,
  usableProrationDate,
  type SubState,
} from "@/lib/plans/plan-stripe";

type Db = any;

const SALE_COLUMNS =
  "id, client_id, offer_id, offer_name, stripe_subscription_id, stripe_subscription_status, payment_status, next_billing_date, cancel_at_period_end, full_payable_amount, contract_value_cents, stripe_price_id, stripe_product_id, stripe_mode, is_fixed_term_commitment, sessions_purchased, archived_at, is_recurring, payment_structure, payment_frequency, created_at";

export const CHANGE_COLUMNS =
  "id, client_id, kind, status, source, from_package_id, to_package_id, from_family, to_family, from_label, to_label, from_price_cents, to_price_cents, effective_at, sale_id, stripe_subscription_id, stripe_checkout_session_id, stripe_invoice_id, stripe_from_price_id, stripe_to_price_id, proration_date, amount_due_now_cents, next_amount_cents, previous_coach_id, warnings, note, error, requested_by, attempts, created_at, updated_at, applied_at, cancelled_at, offer_timing, offer_expires_at, consented_at, consent_text, decided_by, decided_at, decision_note, agreement_version";

/** How long a coach's yes to coaching lasts, and how long an offer stays open. */
export const APPROVAL_DAYS = 30;
export const OFFER_DAYS = 14;
/** An application counts as waiting for this long (older ones are history). */
const APPLICATION_WAIT_DAYS = 90;

export class PlanError extends Error {
  constructor(message: string, readonly config = false) {
    super(message);
  }
}

/* ───────────────────────── reading a client's plan ───────────────────────── */

export type PlanState = {
  client: {
    id: string;
    user_id: string | null;
    first_name: string | null;
    full_name: string | null;
    email: string | null;
    service_tier: "coaching" | "self_serve";
    status: string | null;
    archived: boolean;
    assigned_coach_id: string | null;
    coaching_package: string | null;
    timezone: string | null;
  };
  packages: CatalogPackage[];
  products: CatalogProduct[];
  catalog: PlanOption[];
  enrollment: (PlanEnrollment & { status: string; period_anchor: string | null }) | null;
  sale: (PlanSale & Record<string, any>) | null;
  otherLiveSale: (PlanSale & Record<string, any>) | null;
  current: CurrentPlan;
  open: Record<string, any> | null;
  history: Array<Record<string, any>>;
  /** May they buy coaching (approval, application, a request to come back)? */
  access: CoachingAccess;
  /** The live approval behind `access` (consumed by the purchase it allowed). */
  approval: Record<string, any> | null;
  /** The Coaching Agreement they last signed, and an admin exemption. */
  agreement: { version: string | null; exempt: boolean };
  /** A switch the coach offered that's waiting for their answer. */
  offer: Record<string, any> | null;
};

export async function loadPlanState(db: Db, clientId: string): Promise<PlanState> {
  const { data: client, error } = await db
    .from("clients")
    .select("id, user_id, first_name, full_name, email, service_tier, status, archived, assigned_coach_id, coaching_package, timezone")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!client) throw new PlanError("Couldn't find this account.");

  const nowIso = new Date().toISOString();
  const [pk, en, open, hist, sales, member, appr, comeback, offer, appl, sig, agState, ended, fromCoaching, moved] = await Promise.all([
    db.from("coaching_packages").select("*").neq("status", "archived"),
    db.from("coaching_package_enrollments").select("id, package_id, sale_id, contracted_price_cents, starts_on, status, period_anchor").eq("client_id", clientId).eq("status", "active").maybeSingle(),
    db.from("plan_changes").select(CHANGE_COLUMNS).eq("client_id", clientId).in("status", OPEN_CHANGE_STATUSES as unknown as string[]).maybeSingle(),
    db.from("plan_changes").select(CHANGE_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(15),
    db.from("purchase_records").select(SALE_COLUMNS).eq("client_id", clientId).is("archived_at", null).not("stripe_subscription_id", "is", null),
    client.user_id
      ? db.from("app_members").select("id, stripe_subscription_id, subscription_status").eq("user_id", client.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("coaching_purchase_approvals").select("id, package_id, source, expires_at, approved_at, application_id, request_change_id").eq("client_id", clientId).is("used_at", null).is("revoked_at", null).gt("expires_at", nowIso).order("approved_at", { ascending: false }).limit(1),
    db.from("plan_changes").select(CHANGE_COLUMNS).eq("client_id", clientId).eq("kind", "reactivate").eq("status", "requested").limit(1),
    db.from("plan_changes").select(CHANGE_COLUMNS).eq("client_id", clientId).eq("status", "offered").gt("offer_expires_at", nowIso).limit(1),
    db.from("coaching_applications").select("id, status, created_at, is_test").eq("client_id", clientId).eq("is_test", false).order("created_at", { ascending: false }).limit(1),
    db.from("coaching_agreement_signatures").select("signed_at, coaching_agreement_versions(version)").eq("client_id", clientId).order("signed_at", { ascending: false }).limit(1),
    db.from("coaching_agreement_client_state").select("exempt_kind").eq("client_id", clientId).maybeSingle(),
    db.from("coaching_package_enrollments").select("package_id").eq("client_id", clientId).eq("status", "ended").limit(20),
    db.from("plan_changes").select("id").eq("client_id", clientId).eq("from_family", "coaching").eq("status", "applied").limit(1),
    db.from("account_lifecycle_events").select("id").eq("client_id", clientId).eq("event", "moved_to_membership").limit(1),
  ]);
  for (const r of [pk, en, open, hist, sales, appr, comeback, offer]) if (r.error) throw new Error(r.error.message);
  const packages = (pk.data ?? []) as CatalogPackage[];
  const productIds = [...new Set(packages.map((p) => p.product_id).filter(Boolean))] as string[];
  const { data: products, error: prodErr } = productIds.length
    ? await db.from("coaching_products").select("id, name, price_cents, currency, stripe_price_id, stripe_product_id, mode, payment_structure, active, archived").in("id", productIds)
    : { data: [], error: null };
  if (prodErr) throw new Error(prodErr.message);
  const catalog = buildCatalog(packages, (products ?? []) as CatalogProduct[]);

  const enrollment = en.data ?? null;
  const allSales = (sales.data ?? []) as Array<PlanSale & Record<string, any>>;
  const sale = enrollment?.sale_id ? allSales.find((s) => s.id === enrollment.sale_id) ?? null : null;
  const enrolledSale = sale && enrollment?.sale_id === sale.id ? sale : null;
  // Any other live subscription (a legacy coaching price, a session package's auto-pay, an old membership)
  const otherLiveSale = allSales.find((s) => s.id !== enrolledSale?.id && saleIsLive(s)) ?? null;
  const legacyMembership =
    !!member?.data?.stripe_subscription_id && /^(active|trialing|past due)/i.test(String(member?.data?.subscription_status ?? ""));

  const tier: "coaching" | "self_serve" = client.service_tier === "self_serve" ? "self_serve" : "coaching";
  let current = currentPlanOf({
    tier,
    enrollment,
    sale: enrolledSale,
    catalog,
    coachingLabel: client.coaching_package,
    otherLiveSale,
  });
  // A legacy subscription is cancelled here only when it's their one live subscription.
  const liveOthers = allSales.filter((s) => s.id !== enrolledSale?.id && saleIsLive(s));
  if (current.managed === "custom" && current.cancelable && liveOthers.length !== 1) {
    current = { ...current, cancelable: false, subscriptionId: null, status: "custom" };
  }
  // A member still paying for something else (the retired JF Membership, a stray subscription)
  // never gets a second subscription on top: their changes go through support.
  if (current.managed === "free" && (otherLiveSale || legacyMembership)) {
    current = {
      ...current,
      family: "custom",
      managed: "custom",
      status: "custom",
      name: otherLiveSale?.offer_name ?? "JF Membership",
      customReason: "You already have a paid subscription, so changes go through support.",
    };
  }

  // Who may buy coaching: a coaching client switches; anyone else needs the coach's yes first.
  const approval = appr.data?.[0] ?? null;
  const signedVersion = (() => {
    const v = sig.data?.[0]?.coaching_agreement_versions;
    return (Array.isArray(v) ? v[0]?.version : v?.version) ?? null;
  })();
  const subscriptionPkgIds = new Set(packages.filter((p) => p.kind === "subscription").map((p) => p.id));
  const coachedBefore =
    !!signedVersion ||
    (ended.data ?? []).some((e: any) => subscriptionPkgIds.has(e.package_id)) ||
    !!fromCoaching.data?.length ||
    !!moved.data?.length;
  const lastApp = appl.data?.[0] ?? null;
  const appWaiting =
    !!lastApp &&
    !["Rejected", "Approved", "Declined"].includes(String(lastApp.status ?? "")) &&
    Date.now() - Date.parse(lastApp.created_at) < APPLICATION_WAIT_DAYS * 86_400_000;
  const pkgName = (id: string | null) => (id ? packages.find((p) => p.id === id)?.name ?? null : null);
  let access: CoachingAccess;
  if (tier === "coaching") access = { state: "client" };
  else if (approval) access = { state: "approved", packageId: approval.package_id ?? null, packageName: pkgName(approval.package_id ?? null), expiresAt: approval.expires_at };
  else if (comeback.data?.[0]) access = { state: "comeback_pending", at: comeback.data[0].created_at, changeId: comeback.data[0].id };
  else if (appWaiting) access = { state: "applied", at: lastApp!.created_at, applicationId: lastApp!.id };
  else access = coachedBefore ? { state: "comeback" } : { state: "apply" };

  // A cancelable legacy subscription is the sale the plan is billed on.
  const billingSale = enrolledSale ?? (current.cancelable ? otherLiveSale : null);

  return {
    client: { ...client, archived: !!client.archived, service_tier: tier },
    packages,
    products: (products ?? []) as CatalogProduct[],
    catalog,
    enrollment,
    sale: billingSale,
    otherLiveSale,
    current,
    open: open.data ?? null,
    history: hist.data ?? [],
    access,
    approval,
    agreement: { version: signedVersion, exempt: !!agState.data?.exempt_kind },
    offer: offer.data?.[0] ?? null,
  };
}

export function openChangeOf(row: Record<string, any> | null): OpenChange | null {
  if (!row) return null;
  return { id: row.id, status: row.status, kind: row.kind, toName: row.to_label ?? null, effectiveAt: row.effective_at ?? null };
}

/* ───────────────────────── Stripe helpers ───────────────────────── */

function modeOf(sale: { stripe_mode?: string | null } | null | undefined): StripeMode {
  const m = String(sale?.stripe_mode ?? "").toLowerCase();
  if (m === "test" || m === "live") return m;
  return detectStripeKeyMode(process.env.STRIPE_SECRET_KEY) ?? "live";
}

export function stripeKeyFor(sale?: { stripe_mode?: string | null } | null): string {
  const key = getStripeKeyForMode(modeOf(sale));
  if (!key) throw new PlanError("Billing isn't set up right now. Please try again later.", true);
  return key;
}

async function fetchSub(subId: string, apiKey: string): Promise<any> {
  return stripeFetch(`/subscriptions/${encodeURIComponent(subId)}`, { apiKey });
}

/**
 * The target's Stripe price, checked against the package before any charge:
 * active, monthly, same currency, same amount. A mismatch is a configuration
 * problem (flagged for the admin), never a checkout at the wrong price.
 */
export async function verifyTargetPrice(db: Db, target: PlanOption, apiKey: string): Promise<string> {
  if (!target.stripePriceId) throw new PlanError(`${target.name} isn't available yet.`, true);
  let price: any;
  try {
    price = await stripeFetch(`/prices/${encodeURIComponent(target.stripePriceId)}`, { apiKey });
  } catch (e: any) {
    await flagConfig(db, target, `Stripe price ${target.stripePriceId} couldn't be read: ${String(e?.message ?? e).slice(0, 200)}`);
    throw new PlanError(`${target.name} isn't available yet.`, true);
  }
  const problems: string[] = [];
  if (!price?.active) problems.push("the Stripe price is archived");
  if (price?.recurring?.interval !== "month" || Number(price?.recurring?.interval_count ?? 1) !== 1) problems.push("the Stripe price isn't monthly");
  if (String(price?.currency ?? "").toLowerCase() !== target.currency.toLowerCase()) problems.push(`the Stripe price is in ${String(price?.currency).toUpperCase()}`);
  if (Number(price?.unit_amount) !== target.priceCents) problems.push(`the Stripe price charges ${money(price?.unit_amount)}, not ${money(target.priceCents)}`);
  if (problems.length) {
    await flagConfig(db, target, problems.join("; "));
    throw new PlanError(`${target.name} isn't available yet.`, true);
  }
  return target.stripePriceId;
}

async function flagConfig(db: Db, target: PlanOption, problem: string) {
  try {
    const { data: open } = await db
      .from("support_alerts")
      .select("id")
      .eq("error_type", "plan_config")
      .in("status", ["open", "in_progress"])
      .contains("details", { slug: target.slug })
      .limit(1);
    if (open?.length) return;
    await db.from("support_alerts").insert({
      error_type: "plan_config",
      error_message: `${target.name} can't be sold: ${problem}. Fix it in Sales → Coaching packages.`,
      page_route: "/admin/sales",
      details: { slug: target.slug, package_id: target.id, problem },
      status: "open",
    });
  } catch (e) {
    console.warn("[plans] config alert failed", e);
  }
}

/* ───────────────────────── preview ───────────────────────── */


async function bookedAfter(db: Db, clientId: string, fromIso: string | null): Promise<number> {
  if (!fromIso) return 0;
  const { count } = await db
    .from("pt_sessions")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "Scheduled")
    .gte("starts_at", fromIso);
  return count ?? 0;
}

function dayToIso(day: string | null): string | null {
  return day ? `${day}T00:00:00Z` : null;
}

export async function previewChange(db: Db, state: PlanState, targetSlug: string, opts: { native?: boolean } = {}): Promise<PlanPreview> {
  const target = state.catalog.find((o) => o.slug === targetSlug);
  if (!target) throw new PlanError("That plan isn't available.");
  const tr = transitionFor(state.current, target, { native: opts.native, open: openChangeOf(state.open), coaching: state.access });
  const diff = featureDiff(state.current.features, target.features, baseFeatures(state.catalog));
  const preview: PlanPreview = {
    toSlug: target.slug,
    toName: target.name,
    transition: tr,
    headline: changeVerb(tr.kind, target.name),
    quote: null,
    gain: diff.gain,
    lose: state.current.managed === "custom" ? [] : diff.lose,
    keep: ALWAYS_KEPT,
    warnings: [],
    prorationDate: null,
    forfeit: null,
    agreement: null,
  };
  if (tr.action === "apply") {
    preview.warnings.push(`Coaching starts with a short application. I read every one, and once I've said yes you can pick ${target.name} here and pay.`);
    return preview;
  }
  if (tr.action === "comeback") {
    preview.warnings.push("Ask to come back and I'll get back to you. Once I've said yes you can pick your package here and pay.");
    return preview;
  }
  if (!tr.available || !tr.action || tr.action === "request") return preview;

  const leavingCoaching = (state.current.family === "coaching" || state.current.family === "custom") && target.family !== "coaching";
  const ft = forfeitText(state.current);
  if (ft && state.current.priceCents != null) preview.forfeit = { priceCents: state.current.priceCents, text: ft };
  preview.agreement = agreementNeeded(tr, target, state.agreement);
  if (leavingCoaching) {
    preview.warnings.push("The program your coach wrote stays on your calendar. You can keep training it; it just won't be updated.");
    preview.warnings.push("Your messages with your coach stay saved. Check-ins and coach feedback stop when the change happens.");
  }

  if (tr.action === "checkout") {
    preview.quote = {
      kind: tr.kind,
      timing: tr.timing,
      todayCents: target.priceCents,
      todayTaxIncluded: false,
      nextCents: target.priceCents,
      nextTaxIncluded: false,
      nextDate: null,
      effectiveDate: null,
      creditCents: 0,
    };
    if (target.family === "coaching") preview.warnings.push("Once you've paid, your coach sets up your program.");
    return preview;
  }

  // Everything else changes a live subscription: read it fresh from Stripe.
  const apiKey = stripeKeyFor(state.sale);
  const sub = subState(await fetchSub(state.current.subscriptionId!, apiKey));
  const problem = subProblem(sub);
  if (problem) {
    preview.transition = { ...tr, available: false, blocked: problem };
    return preview;
  }
  const periodEndDay = unixToDay(sub.periodEnd, state.client.timezone ?? "America/Winnipeg");

  if (tr.action === "cancel_later") {
    preview.quote = { kind: tr.kind, timing: tr.timing, todayCents: 0, todayTaxIncluded: true, nextCents: 0, nextTaxIncluded: true, nextDate: null, effectiveDate: periodEndDay, creditCents: 0 };
    const n = await bookedAfter(db, state.client.id, dayToIso(periodEndDay));
    if (n) preview.warnings.push(`You have ${n} session${n === 1 ? "" : "s"} booked after ${periodEndDay}. Your coach will sort ${n === 1 ? "it" : "them"} out with you.`);
    return preview;
  }

  const priceId = await verifyTargetPrice(db, target, apiKey);
  if (tr.action === "swap_later") {
    const next = readPreview(await stripeFetch("/invoices/create_preview", { method: "POST", apiKey, body: formEncode(previewParams(sub, priceId, "none")) }));
    preview.quote = { kind: tr.kind, timing: tr.timing, todayCents: 0, todayTaxIncluded: true, nextCents: next.totalCents, nextTaxIncluded: true, nextDate: periodEndDay, effectiveDate: periodEndDay, creditCents: 0 };
    if (target.includedCalls < (state.current.option?.includedCalls ?? 0)) {
      const n = await bookedAfter(db, state.client.id, dayToIso(periodEndDay));
      if (n) preview.warnings.push(`You have ${n} session${n === 1 ? "" : "s"} booked after ${periodEndDay}. Your coach will sort ${n === 1 ? "it" : "them"} out with you.`);
    }
    return preview;
  }

  // swap_now: today's prorated charge, then the renewal at the new price
  const prorationDate = Math.floor(Date.now() / 1000);
  const [now, next] = await Promise.all([
    stripeFetch("/invoices/create_preview", { method: "POST", apiKey, body: formEncode(previewParams(sub, priceId, "always_invoice", prorationDate)) }),
    stripeFetch("/invoices/create_preview", { method: "POST", apiKey, body: formEncode(previewParams(sub, priceId, "none")) }),
  ]);
  const today = readPreview(now);
  const forward = readPreview(next);
  preview.quote = {
    kind: tr.kind,
    timing: tr.timing,
    todayCents: today.totalCents,
    todayTaxIncluded: true,
    nextCents: forward.totalCents,
    nextTaxIncluded: true,
    nextDate: periodEndDay,
    effectiveDate: null,
    creditCents: today.creditCents,
  };
  preview.prorationDate = prorationDate;
  if (today.totalCents > 0) preview.warnings.push("Today's charge covers the rest of this month at the new price, less what you've already paid for it.");
  return preview;
}

/* ───────────────────────── doing it ───────────────────────── */


async function insertChange(db: Db, row: Record<string, any>): Promise<Record<string, any>> {
  const { data, error } = await db.from("plan_changes").insert(row).select(CHANGE_COLUMNS).single();
  if (error) {
    if (error.code === "23505") throw new PlanError("A plan change is already going through. Refresh and try again.");
    throw new Error(error.message);
  }
  return data;
}

async function patchChange(db: Db, id: string, patch: Record<string, any>, onlyIfStatus?: string[]): Promise<Record<string, any> | null> {
  let q = db.from("plan_changes").update(patch).eq("id", id);
  if (onlyIfStatus?.length) q = q.in("status", onlyIfStatus);
  const { data, error } = await q.select(CHANGE_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

function baseRow(state: PlanState, target: PlanOption, tr: Transition, actorUserId: string | null, source: "client" | "admin", extra: Record<string, any> = {}) {
  return {
    ...extra,
    client_id: state.client.id,
    kind: tr.kind,
    source,
    from_package_id: state.current.option?.id ?? null,
    to_package_id: target.id,
    from_family: state.current.family,
    to_family: target.family,
    from_label: state.current.name.slice(0, 120),
    to_label: target.name.slice(0, 120),
    from_price_cents: state.current.priceCents,
    to_price_cents: target.priceCents,
    requested_by: actorUserId,
    previous_coach_id: state.client.assigned_coach_id,
  };
}

export async function confirmChange(
  db: Db,
  state: PlanState,
  targetSlug: string,
  opts: {
    actorUserId: string | null;
    source: "client" | "admin";
    origin: string;
    prorationDate?: number | null;
    note?: string | null;
    adminNow?: boolean;
    /** They ticked that their own price ends (required when it does). */
    acknowledgeForfeit?: boolean;
  },
): Promise<ConfirmResult> {
  const target = state.catalog.find((o) => o.slug === targetSlug);
  if (!target) throw new PlanError("That plan isn't available.");
  if (state.client.archived || ["Deactivated", "Deleted"].includes(String(state.client.status ?? ""))) {
    throw new PlanError("This account is paused, so its plan can't change.");
  }
  const open = openChangeOf(state.open);
  // the coach changing a plan is the coach's approval
  const access: CoachingAccess = opts.source === "admin" ? { state: "approved", packageId: null, packageName: null, expiresAt: "" } : state.access;
  const tr = transitionFor(state.current, target, { open, coaching: access });
  if (!tr.available) throw new PlanError(tr.blocked ?? "That change isn't available.", !!tr.configProblem);

  if (tr.action === "request") return requestChange(db, state, target, opts);
  if (tr.action === "apply") throw new PlanError("Apply for coaching first.");
  if (tr.action === "comeback") return requestComeback(db, state, target, opts);

  // Their own price ends: they say they understand, in their words, before anything changes.
  const forfeit = forfeitText(state.current);
  if (forfeit && opts.source === "client" && !opts.acknowledgeForfeit) {
    throw new PlanError("Tick that you understand your current price ends, then confirm.");
  }
  // The Coaching Agreement that describes buying and switching coaching here comes first.
  if (opts.source === "client" && agreementNeeded(tr, target, state.agreement)) {
    return { result: "agreement_required", version: PLAN_AGREEMENT_VERSION };
  }
  const consent = {
    consent_text: opts.source === "client" && forfeit ? forfeit : null,
    consented_at: opts.source === "client" && forfeit ? new Date().toISOString() : null,
    agreement_version: target.family === "coaching" ? state.agreement.version : null,
  };

  // An unfinished checkout never blocks starting again: expire it first.
  if (state.open?.status === "checkout") await abandonCheckout(db, state.open, "Replaced by a new checkout");

  if (tr.action === "checkout") return startCheckout(db, state, target, tr, { ...opts, consent });

  const apiKey = stripeKeyFor(state.sale);
  const sub = subState(await fetchSub(state.current.subscriptionId!, apiKey));
  const problem = subProblem(sub);
  if (problem) throw new PlanError(problem);
  const tz = state.client.timezone ?? "America/Winnipeg";
  const periodEndIso = sub.periodEnd ? new Date(sub.periodEnd * 1000).toISOString() : null;

  if (tr.action === "cancel_later") {
    const change = await insertChange(db, {
      ...baseRow(state, target, tr, opts.actorUserId, opts.source, consent),
      status: "processing",
      sale_id: state.sale?.id ?? null,
      stripe_subscription_id: sub.id,
      stripe_from_price_id: sub.priceId,
      effective_at: periodEndIso,
      amount_due_now_cents: 0,
      next_amount_cents: 0,
      note: opts.note ?? null,
    });
    try {
      await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", apiKey, body: formEncode(CANCEL_LATER_PARAMS), idempotencyKey: `plan_cancel_${change.id}` });
    } catch (e: any) {
      await patchChange(db, change.id, { status: "failed", error: String(e?.message ?? e).slice(0, 500) });
      throw new PlanError("Stripe didn't accept the change. Nothing changed; please try again.");
    }
    await db.from("purchase_records").update({ cancel_at_period_end: true, last_payment_update_source: "plan_change", last_payment_update_at: new Date().toISOString() }).eq("id", state.sale!.id);
    const done = await patchChange(db, change.id, { status: "scheduled" }, ["processing"]);
    await notifyPlanChange(db, done ?? change, "scheduled");
    return { result: "scheduled", changeId: change.id, effectiveDate: unixToDay(sub.periodEnd, tz) };
  }

  const priceId = await verifyTargetPrice(db, target, apiKey);

  if (tr.action === "swap_later" || (tr.action === "swap_now" && opts.adminNow)) {
    // Admin "switch now, no charge": the price changes now with nothing prorated, and it applies now.
    const now = tr.action === "swap_now" && opts.adminNow;
    const change = await insertChange(db, {
      ...baseRow(state, target, tr, opts.actorUserId, opts.source, consent),
      status: "processing",
      sale_id: state.sale?.id ?? null,
      stripe_subscription_id: sub.id,
      stripe_from_price_id: sub.priceId,
      stripe_to_price_id: priceId,
      effective_at: now ? new Date().toISOString() : periodEndIso,
      amount_due_now_cents: 0,
      note: now ? opts.note ?? "Switched now by the coach, no charge for the rest of this month" : opts.note ?? null,
    });
    try {
      await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", apiKey, body: formEncode(swapLaterParams(sub, priceId)), idempotencyKey: `plan_swap_${change.id}` });
    } catch (e: any) {
      await patchChange(db, change.id, { status: "failed", error: String(e?.message ?? e).slice(0, 500) });
      throw new PlanError("Stripe didn't accept the change. Nothing changed; please try again.");
    }
    if (now) {
      await applyChange(db, change.id);
      return { result: "applied", changeId: change.id };
    }
    const done = await patchChange(db, change.id, { status: "scheduled" }, ["processing"]);
    await notifyPlanChange(db, done ?? change, "scheduled");
    return { result: "scheduled", changeId: change.id, effectiveDate: unixToDay(sub.periodEnd, tz) };
  }

  // swap_now: charged now (prorated), applied once the charge succeeds
  const prorationDate = usableProrationDate(opts.prorationDate, Math.floor(Date.now() / 1000));
  const change = await insertChange(db, {
    ...baseRow(state, target, tr, opts.actorUserId, opts.source, consent),
    status: "processing",
    sale_id: state.sale?.id ?? null,
    stripe_subscription_id: sub.id,
    stripe_from_price_id: sub.priceId,
    stripe_to_price_id: priceId,
    proration_date: prorationDate,
    effective_at: new Date().toISOString(),
    note: opts.note ?? null,
  });
  let updated: any;
  try {
    updated = await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", apiKey, body: formEncode(swapNowParams(sub, priceId, prorationDate)), idempotencyKey: `plan_swap_${change.id}` });
  } catch (e: any) {
    await patchChange(db, change.id, { status: "failed", error: String(e?.message ?? e).slice(0, 500) });
    throw new PlanError("Stripe didn't accept the change. Nothing was charged; please try again.");
  }
  const outcome = upgradeOutcome(updated, priceId);
  const paid = typeof updated?.latest_invoice === "object" ? Number(updated.latest_invoice?.amount_paid ?? 0) : null;
  if (outcome.result === "applied") {
    await patchChange(db, change.id, { stripe_invoice_id: outcome.invoiceId, amount_due_now_cents: paid });
    await applyChange(db, change.id);
    return { result: "applied", changeId: change.id };
  }
  if (outcome.result === "needs_payment") {
    await patchChange(db, change.id, { status: "awaiting_payment", stripe_invoice_id: outcome.invoiceId }, ["processing"]);
    return { result: "needs_payment", changeId: change.id, url: outcome.payUrl! };
  }
  await voidInvoice(outcome.invoiceId, apiKey);
  const failed = await patchChange(db, change.id, { status: "failed", stripe_invoice_id: outcome.invoiceId, error: "The payment didn't go through" }, ["processing"]);
  if (failed) await notifyPlanChange(db, failed, "failed");
  return { result: "failed", changeId: change.id, message: "The payment didn't go through, so your plan didn't change. Nothing was charged." };
}

async function voidInvoice(invoiceId: string | null, apiKey: string) {
  if (!invoiceId) return;
  try {
    const inv = await stripeFetch(`/invoices/${encodeURIComponent(invoiceId)}`, { apiKey });
    if (inv?.status === "open") await stripeFetch(`/invoices/${encodeURIComponent(invoiceId)}/void`, { method: "POST", apiKey, idempotencyKey: `plan_void_${invoiceId}` });
  } catch (e) {
    console.warn("[plans] void invoice failed", invoiceId, e);
  }
}

async function abandonCheckout(db: Db, row: Record<string, any>, why: string) {
  if (row.stripe_checkout_session_id) {
    try {
      const apiKey = stripeKeyFor(null);
      const s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(row.stripe_checkout_session_id)}`, { apiKey });
      if (s?.status === "complete") {
        // it was paid after all: apply it instead of dropping it
        await onPlanCheckoutCompleted(db, s);
        throw new PlanError("Your last checkout just went through. Refresh to see your plan.");
      }
      if (s?.status === "open") await stripeFetch(`/checkout/sessions/${encodeURIComponent(row.stripe_checkout_session_id)}/expire`, { method: "POST", apiKey });
    } catch (e) {
      if (e instanceof PlanError) throw e;
      console.warn("[plans] expire checkout failed", e);
    }
  }
  await patchChange(db, row.id, { status: "cancelled", note: why.slice(0, 1000) }, ["checkout"]);
}

async function startCheckout(
  db: Db,
  state: PlanState,
  target: PlanOption,
  tr: Transition,
  opts: { actorUserId: string | null; source: "client" | "admin"; origin: string; consent?: Record<string, any>; existingChangeId?: string },
): Promise<ConfirmResult> {
  const apiKey = stripeKeyFor(null);
  await verifyTargetPrice(db, target, apiKey);
  const { data: product, error: pErr } = await db.from("coaching_products").select("*").eq("id", target.productId).maybeSingle();
  if (pErr || !product) throw new PlanError(`${target.name} isn't available yet.`, true);

  // The sale (an unpaid payment request until Stripe says it's paid), reusing an open one for this plan.
  const { productToOfferLike } = await import("@/lib/add-sale");
  const { snapshotOfferForPurchase } = await import("@/lib/offers");
  const { findReusablePurchaseIntent } = await import("@/lib/purchase-idempotency");
  const snap = snapshotOfferForPurchase(productToOfferLike(product), { clientId: state.client.id, assignedBy: opts.actorUserId, timezone: state.client.timezone });
  const payload = {
    ...snap,
    is_recurring: true,
    payment_status: "Pending Payment",
    amount_paid: 0,
    last_payment_update_source: "plan_change",
    last_payment_update_at: new Date().toISOString(),
    billing_schedule_source: "plan_change",
  };
  const { data: existing } = await db
    .from("purchase_records")
    .select("id, client_id, offer_id, payment_status, amount_paid, amount_paid_cents, stripe_subscription_id, stripe_payment_intent_id, stripe_checkout_session_id, archived_at, created_at")
    .eq("client_id", state.client.id)
    .eq("offer_id", product.id);
  const reusable = findReusablePurchaseIntent((existing ?? []) as any[], { clientId: state.client.id, offerId: product.id });
  const saleRes = reusable
    ? await db.from("purchase_records").update(payload).eq("id", reusable.id).select("id").single()
    : await db.from("purchase_records").insert({ ...payload, purchased_at: new Date().toISOString(), assigned_at: new Date().toISOString() }).select("id").single();
  if (saleRes.error) throw new Error(saleRes.error.message);
  const saleId = saleRes.data.id as string;

  const change = opts.existingChangeId
    ? await patchChange(db, opts.existingChangeId, { status: "checkout", sale_id: saleId, amount_due_now_cents: target.priceCents, next_amount_cents: target.priceCents }, ["offered"]).then((r) => {
        if (!r) throw new PlanError("This offer isn't open any more.");
        return r;
      })
    : await insertChange(db, {
        ...baseRow(state, target, tr, opts.actorUserId, opts.source, opts.consent ?? {}),
        status: "checkout",
        sale_id: saleId,
        amount_due_now_cents: target.priceCents,
        next_amount_cents: target.priceCents,
      });
  try {
    const { createAssignmentCheckout } = await import("@/lib/stripe-checkout.functions");
    const origin = opts.origin.replace(/\/+$/, "");
    const r = await createAssignmentCheckout(db, opts.actorUserId, { purchaseRecordId: saleId, origin }, {
      updateSource: "plan_change",
      successUrl: `${origin}/portal/plan?checkout=done&change=${change.id}`,
      cancelUrl: `${origin}/portal/plan?checkout=cancelled&change=${change.id}`,
      metadata: { plan_change_id: change.id, kind: "plan_change" },
      // the Coaching Agreement covers coaching; a membership has its own terms (accepted in the app)
      agreementNotice: target.family === "coaching",
    });
    await patchChange(db, change.id, { stripe_checkout_session_id: r.sessionId });
    return { result: "redirect", url: r.url, changeId: change.id };
  } catch (e: any) {
    await patchChange(db, change.id, { status: "failed", error: String(e?.message ?? e).slice(0, 500) });
    throw new PlanError("Checkout couldn't be opened. Nothing was charged; please try again.");
  }
}

async function requestChange(db: Db, state: PlanState, target: PlanOption, opts: { actorUserId: string | null; source: "client" | "admin"; note?: string | null }): Promise<ConfirmResult> {
  const { requestMessage } = await import("@/lib/plans/plan-engine");
  const change = await insertChange(db, {
    ...baseRow(state, target, { kind: "request", action: "request", timing: null, available: true, blocked: null, configProblem: null }, opts.actorUserId, opts.source),
    status: "requested",
    note: opts.note ?? null,
  });
  const body = requestMessage(state.current.name, target.name, opts.note);
  const now = new Date().toISOString();
  if (state.client.service_tier === "coaching" && state.client.user_id && opts.source === "client") {
    // The ask, in their coach chat as them, so it shows as needing a reply.
    await db.from("messages").insert({
      client_id: state.client.id,
      sender_id: state.client.user_id,
      sender_role: "client",
      body,
      message_type: "Payment",
      is_internal_note: false,
      delivery_status: "sent",
      sent_at: now,
      read_by_client_at: now,
    });
  }
  await notifyPlanChange(db, change, "requested");
  return { result: "requested", changeId: change.id };
}

/* ───────────────────────── coming to coaching ───────────────────────── */

/** Tell the admins and the client's coach (push only), once per key. */
async function pushStaff(db: Db, clientId: string, title: string, body: string, url: string, key: string, skip?: string | null) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { staffUserIdsForClient } = await import("@/lib/push/app-events.server");
    for (const uid of await staffUserIdsForClient(db, clientId)) {
      if (uid === skip) continue;
      await sendWebPushToUser(db, uid, { title, body, url, tag: `plan:${clientId}`, data: { kind: "plan_change", clientId } }, { category: "billing", eventKey: `${key}:${uid}`, priority: "normal" });
    }
  } catch (e) {
    console.warn("[plans] staff push failed", e);
  }
}

/** A former coaching client asks to come back (a request the coach approves or declines). */
async function requestComeback(db: Db, state: PlanState, target: PlanOption, opts: { actorUserId: string | null; source: "client" | "admin"; note?: string | null }): Promise<ConfirmResult> {
  let change: Record<string, any>;
  try {
    change = await insertChange(db, {
      ...baseRow(state, target, { kind: "comeback", action: "comeback", timing: null, available: true, blocked: null, configProblem: null }, opts.actorUserId, opts.source),
      kind: "reactivate",
      status: "requested",
      note: opts.note ?? null,
    });
  } catch (e) {
    if (e instanceof PlanError) throw new PlanError("You've already asked. Your coach will get back to you.");
    throw e;
  }
  await notifyPlanChange(db, change, "comeback_requested");
  return { result: "requested", changeId: change.id };
}

export type InAppApplication = { goal: string; outcome: string; timeline: string; phone?: string | null; packageSlug?: string | null };

/**
 * A member who's never been coached applies from Manage plan: the same
 * application the website takes (coaching_applications, the Leads page, the
 * lead's drafted text), tied to their own account so the coach's yes reaches it.
 */
export async function applyInApp(db: Db, state: PlanState, input: InAppApplication, actorUserId: string): Promise<{ ok: true; applicationId: string }> {
  if (state.access.state === "applied") throw new PlanError("Your application is with your coach already.");
  if (state.access.state !== "apply") throw new PlanError(state.access.state === "client" ? "You're already a coaching client." : "Ask to come back instead.");
  const { data: c } = await db.from("clients").select("id, first_name, last_name, full_name, email, phone, instagram").eq("id", state.client.id).maybeSingle();
  if (!c?.email) throw new PlanError("Add your email in Account first, so your coach can reach you.");
  const pkg = input.packageSlug ? state.catalog.find((o) => o.slug === input.packageSlug && o.family === "coaching") ?? null : null;
  const full = (c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email).trim();
  const { data: row, error } = await db
    .from("coaching_applications")
    .insert({
      client_id: c.id,
      first_name: c.first_name ?? full.split(/\s+/)[0],
      last_name: c.last_name ?? null,
      full_name: full,
      email: c.email,
      phone: (input.phone ?? "").trim() || c.phone || null,
      instagram: c.instagram ?? null,
      main_goal: input.goal.trim().slice(0, 500),
      target_outcome: input.outcome.trim().slice(0, 1000),
      timeline: input.timeline.trim().slice(0, 120),
      coaching_interest: pkg?.name ?? null,
      package_slug: pkg?.slug ?? null,
      package_snapshot: pkg ? { slug: pkg.slug, name: pkg.name, price_cents: pkg.priceCents, billing_interval: "month" } : null,
      application_source: "in_app_plan",
      source: "coaching_application",
      source_label: "In the app",
      form_name: "In-app application",
      application_status: "submitted",
      call_status: "not_booked",
      status: "New",
      is_test: false,
      submitted_at: new Date().toISOString(),
      goals: [input.goal, input.outcome].filter(Boolean).join("\n\n") || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await pushStaff(db, c.id, `${full} applied for coaching`, `From the app${pkg ? `, for ${pkg.name}` : ""}. Approve or decline it in Sales → Plans.`, "/admin/plans", `plan_apply:${row.id}`, actorUserId);
  return { ok: true, applicationId: row.id };
}

/** The coach says yes to coaching: they can now pick a package and pay (for one package, or any). */
export async function approveCoaching(
  db: Db,
  clientId: string,
  input: { actorUserId: string; packageSlug?: string | null; note?: string | null; applicationId?: string | null; requestChangeId?: string | null },
): Promise<{ ok: true; approvalId: string }> {
  const state = await loadPlanState(db, clientId);
  if (state.client.service_tier === "coaching") throw new PlanError("They're already a coaching client.");
  if (state.client.archived || ["Deactivated", "Deleted"].includes(String(state.client.status ?? ""))) throw new PlanError("This account is paused.");
  const pkg = input.packageSlug ? state.catalog.find((o) => o.slug === input.packageSlug && o.family === "coaching") ?? null : null;
  if (input.packageSlug && !pkg) throw new PlanError("That package isn't on sale.");
  const now = new Date();
  await db.from("coaching_purchase_approvals").update({ revoked_at: now.toISOString() }).eq("client_id", clientId).is("used_at", null).is("revoked_at", null);
  // the request or application it answers (else whichever is waiting)
  const requestId = input.requestChangeId ?? (state.access.state === "comeback_pending" ? state.access.changeId : null);
  let applicationId = input.applicationId ?? null;
  if (!applicationId && !requestId) {
    const { data: app } = await db.from("coaching_applications").select("id, status").eq("client_id", clientId).eq("is_test", false).order("created_at", { ascending: false }).limit(1);
    if (app?.[0] && !["Rejected", "Approved", "Declined"].includes(String(app[0].status))) applicationId = app[0].id;
  }
  const source = requestId ? "reactivation" : applicationId ? "application" : "admin";
  const { data: approval, error } = await db
    .from("coaching_purchase_approvals")
    .insert({
      client_id: clientId,
      source,
      application_id: applicationId,
      request_change_id: requestId,
      package_id: pkg?.id ?? null,
      approved_by: input.actorUserId,
      expires_at: new Date(now.getTime() + APPROVAL_DAYS * 86_400_000).toISOString(),
      note: input.note ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (requestId) {
    await patchChange(db, requestId, { status: "applied", decided_by: input.actorUserId, decided_at: now.toISOString(), decision_note: input.note ?? null }, ["requested"]);
  }
  if (applicationId) await db.from("coaching_applications").update({ status: "Approved" }).eq("id", applicationId);
  await notifyPlanChange(db, { id: approval.id, client_id: clientId, to_label: pkg?.name ?? null, source: "admin", requested_by: input.actorUserId, kind: "approve" }, "approved");
  return { ok: true, approvalId: approval.id };
}

/** The coach says no (for now) to a request to come back or an application. */
export async function declineCoaching(db: Db, clientId: string, input: { actorUserId: string; requestChangeId?: string | null; applicationId?: string | null; note?: string | null }) {
  const now = new Date().toISOString();
  let any = false;
  if (input.requestChangeId) {
    const r = await patchChange(db, input.requestChangeId, { status: "cancelled", decided_by: input.actorUserId, decided_at: now, decision_note: input.note ?? null }, ["requested"]);
    any = any || !!r;
  }
  if (input.applicationId) {
    const { data } = await db.from("coaching_applications").update({ status: "Rejected" }).eq("id", input.applicationId).eq("client_id", clientId).select("id");
    any = any || !!data?.length;
  }
  if (!any) throw new PlanError("There's nothing waiting to decline.");
  if (input.note) await notifyPlanChange(db, { id: input.requestChangeId ?? input.applicationId, client_id: clientId, source: "admin", requested_by: input.actorUserId, kind: "decline" }, "declined");
  return { ok: true as const };
}

export async function revokeApproval(db: Db, clientId: string, approvalId: string) {
  const { data } = await db.from("coaching_purchase_approvals").update({ revoked_at: new Date().toISOString() }).eq("id", approvalId).eq("client_id", clientId).is("used_at", null).is("revoked_at", null).select("id");
  if (!data?.length) throw new PlanError("That approval isn't open any more.");
  return { ok: true as const };
}

/** A custom request ("change my plan") the coach has dealt with, or declined. */
export async function decideRequest(db: Db, changeId: string, input: { actorUserId: string; done: boolean; note?: string | null }) {
  const r = await patchChange(
    db,
    changeId,
    { status: input.done ? "applied" : "cancelled", decided_by: input.actorUserId, decided_at: new Date().toISOString(), decision_note: input.note ?? null },
    ["requested"],
  );
  if (!r) throw new PlanError("That request isn't waiting any more.");
  return { ok: true as const };
}

/* ───────────────────────── offers (with the client's consent) ───────────────────────── */

/**
 * The coach offers a client on their own (grandfathered or custom) price a
 * switch. Nothing changes until they accept it in the app; it closes after
 * OFFER_DAYS. Never for someone whose billing this could double (a second live
 * subscription the app can't change).
 */
export async function createOffer(db: Db, state: PlanState, input: { targetSlug: string; timing: "now" | "period_end"; note?: string | null; actorUserId: string }) {
  const target = state.catalog.find((o) => o.slug === input.targetSlug);
  if (!target || target.family === "free") throw new PlanError("Pick a paid package to offer.");
  if (target.problem) throw new PlanError(`${target.name} can't be sold yet: ${target.problem}.`, true);
  if (state.current.managed === "free") throw new PlanError("They aren't paying for a plan. Approve them for coaching instead.");
  if (state.open) throw new PlanError("A plan change is already going through for them.");
  if (state.offer) throw new PlanError("They already have an offer open. Withdraw it first.");
  if (target.id === state.current.option?.id && !state.current.specialPrice) throw new PlanError("They're already on it at that price.");
  if (state.current.managed === "custom" && !state.current.cancelable && state.otherLiveSale) {
    throw new PlanError("Their billing has a subscription the app can't change (a session package or more than one). Change it from their Billing instead.");
  }
  const up = state.current.priceCents == null || target.priceCents >= state.current.priceCents;
  const row = await insertChange(db, {
    ...baseRow(state, target, { kind: up ? "upgrade" : "downgrade", action: null, timing: null, available: true, blocked: null, configProblem: null }, input.actorUserId, "admin"),
    status: "offered",
    offer_timing: input.timing,
    offer_expires_at: new Date(Date.now() + OFFER_DAYS * 86_400_000).toISOString(),
    sale_id: state.sale?.id ?? null,
    stripe_subscription_id: state.current.subscriptionId,
    note: input.note ?? null,
  }).catch((e) => {
    if (e instanceof PlanError) throw new PlanError("They already have an offer open. Withdraw it first.");
    throw e;
  });
  await notifyPlanChange(db, row, "offered");
  return { ok: true as const, changeId: row.id };
}

export async function withdrawOffer(db: Db, clientId: string, changeId: string, actorUserId: string) {
  const r = await db.from("plan_changes").update({ status: "cancelled", decided_by: actorUserId, decided_at: new Date().toISOString(), note: "Withdrawn by the coach" }).eq("id", changeId).eq("client_id", clientId).eq("status", "offered").select("id");
  if (!r.data?.length) throw new PlanError("That offer isn't open any more.");
  return { ok: true as const };
}

export async function declineOffer(db: Db, state: PlanState, changeId: string, actorUserId: string) {
  if (!state.offer || state.offer.id !== changeId) throw new PlanError("That offer isn't open any more.");
  const done = await patchChange(db, changeId, { status: "cancelled", decided_by: actorUserId, decided_at: new Date().toISOString(), decision_note: "Declined by the client" }, ["offered"]);
  if (!done) throw new PlanError("That offer isn't open any more.");
  await notifyPlanChange(db, done, "offer_declined");
  return { ok: true as const };
}

/**
 * The client accepts an offer: their consent (the exact words shown) is kept on
 * the change, then their own subscription moves to the new price with nothing
 * charged or credited today (now, or at the end of the paid month). With no
 * live subscription, accepting opens a checkout instead.
 */
export async function acceptOffer(db: Db, state: PlanState, changeId: string, opts: { actorUserId: string; origin: string; consentText: string }): Promise<ConfirmResult> {
  const row = state.offer;
  if (!row || row.id !== changeId) throw new PlanError("This offer isn't open any more.");
  if (state.client.archived || ["Deactivated", "Deleted"].includes(String(state.client.status ?? ""))) throw new PlanError("This account is paused, so its plan can't change.");
  if (state.open) throw new PlanError("A plan change is already going through. Undo it first.");
  const target = state.catalog.find((o) => o.id === row.to_package_id);
  if (!target) throw new PlanError("That package isn't on sale any more.");
  if (target.problem) throw new PlanError(`${target.name} isn't available yet.`, true);
  const offer = offerFromRow(row, state.current);
  const terms = offerTerms(offer, fmtDay);
  if (opts.consentText.trim() !== terms.consentText) throw new PlanError("The offer changed since you opened it. Refresh and read it again.");
  if (!offer.hasSubscription && state.otherLiveSale) throw new PlanError("Your billing can't be switched here. Message your coach.");
  if (target.family === "coaching" && !state.agreement.exempt && (!state.agreement.version || compareVersion(state.agreement.version, PLAN_AGREEMENT_VERSION) < 0)) {
    return { result: "agreement_required", version: PLAN_AGREEMENT_VERSION };
  }
  const consent = { consented_at: new Date().toISOString(), consent_text: terms.consentText, agreement_version: state.agreement.version };
  const tr: Transition = { kind: row.kind, action: offer.hasSubscription ? "swap_later" : "checkout", timing: offer.timing === "now" ? "now" : "period_end", available: true, blocked: null, configProblem: null } as Transition;

  if (!offer.hasSubscription) {
    await patchChange(db, row.id, consent, ["offered"]);
    return startCheckout(db, state, target, tr, { actorUserId: opts.actorUserId, source: "client", origin: opts.origin, existingChangeId: row.id });
  }

  const apiKey = stripeKeyFor(state.sale);
  const sub = subState(await fetchSub(state.current.subscriptionId!, apiKey));
  const problem = subProblem(sub);
  if (problem) throw new PlanError(problem);
  const priceId = await verifyTargetPrice(db, target, apiKey);
  const now = offer.timing === "now";
  const periodEndIso = sub.periodEnd ? new Date(sub.periodEnd * 1000).toISOString() : null;
  const claimed = await patchChange(
    db,
    row.id,
    {
      ...consent,
      status: "processing",
      sale_id: state.sale?.id ?? row.sale_id ?? null,
      stripe_subscription_id: sub.id,
      stripe_from_price_id: sub.priceId,
      stripe_to_price_id: priceId,
      effective_at: now ? new Date().toISOString() : periodEndIso,
      amount_due_now_cents: 0,
    },
    ["offered"],
  ).catch((e) => {
    if (String(e?.message ?? "").includes("plan_changes_one_open")) throw new PlanError("A plan change is already going through.");
    throw e;
  });
  if (!claimed) throw new PlanError("This offer isn't open any more.");
  try {
    await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", apiKey, body: formEncode(swapLaterParams(sub, priceId)), idempotencyKey: `plan_offer_${row.id}` });
  } catch (e: any) {
    await patchChange(db, row.id, { status: "failed", error: String(e?.message ?? e).slice(0, 500) });
    throw new PlanError("Stripe didn't accept the change. Nothing changed; please try again.");
  }
  if (now) {
    await applyChange(db, row.id);
    return { result: "applied", changeId: row.id };
  }
  const done = await patchChange(db, row.id, { status: "scheduled" }, ["processing"]);
  await notifyPlanChange(db, done ?? claimed, "scheduled");
  return { result: "scheduled", changeId: row.id, effectiveDate: unixToDay(sub.periodEnd, state.client.timezone ?? "America/Winnipeg") };
}

/* ───────────────────────── undo / keep ───────────────────────── */

export async function undoChange(db: Db, state: PlanState, changeId: string, actorUserId: string | null): Promise<{ ok: true }> {
  const row = state.open;
  if (!row || row.id !== changeId) throw new PlanError("There's nothing to undo.");
  if (row.status === "checkout") {
    await abandonCheckout(db, row, "Cancelled before paying");
    return { ok: true };
  }
  const apiKey = stripeKeyFor(state.sale);
  if (row.status === "awaiting_payment") {
    await voidInvoice(row.stripe_invoice_id, apiKey);
    const done = await patchChange(db, row.id, { status: "cancelled", note: "Cancelled before paying" }, ["awaiting_payment"]);
    if (!done) throw new PlanError("It just went through. Refresh to see your plan.");
    return { ok: true };
  }
  if (row.status !== "scheduled") throw new PlanError("This change is already going through.");
  if (!row.stripe_subscription_id) throw new PlanError("There's nothing to undo.");
  try {
    if (row.kind === "cancel") {
      await stripeFetch(`/subscriptions/${row.stripe_subscription_id}`, { method: "POST", apiKey, body: formEncode(KEEP_PARAMS), idempotencyKey: `plan_undo_${row.id}` });
      if (row.sale_id) await db.from("purchase_records").update({ cancel_at_period_end: false, last_payment_update_source: "plan_change", last_payment_update_at: new Date().toISOString() }).eq("id", row.sale_id);
    } else {
      const sub = subState(await fetchSub(row.stripe_subscription_id, apiKey));
      if (!sub.itemId || !row.stripe_from_price_id) throw new PlanError("This change can't be undone here. Message support.");
      if (sub.priceId !== row.stripe_from_price_id) {
        await stripeFetch(`/subscriptions/${sub.id}`, { method: "POST", apiKey, body: formEncode(swapLaterParams(sub, row.stripe_from_price_id)), idempotencyKey: `plan_undo_${row.id}` });
      }
    }
  } catch (e: any) {
    if (e instanceof PlanError) throw e;
    throw new PlanError("Stripe didn't accept the change. Your plan is as it was scheduled; please try again.");
  }
  const done = await patchChange(db, row.id, { status: "cancelled", note: actorUserId ? "Undone" : "Undone in Stripe" }, ["scheduled"]);
  if (done) await notifyPlanChange(db, done, "undone");
  return { ok: true };
}

/** A plan set to end in Stripe (not by a change here): keep it. */
export async function keepPlan(db: Db, state: PlanState, actorUserId: string | null): Promise<{ ok: true }> {
  if (state.open?.status === "scheduled" && state.open.kind === "cancel") return undoChange(db, state, state.open.id, actorUserId);
  const keepable = state.current.managed === "stripe" || (state.current.managed === "custom" && state.current.cancelable);
  if (!keepable || state.current.status !== "ending" || !state.sale) throw new PlanError("Your plan isn't ending.");
  const apiKey = stripeKeyFor(state.sale);
  await stripeFetch(`/subscriptions/${state.current.subscriptionId}`, { method: "POST", apiKey, body: formEncode(KEEP_PARAMS), idempotencyKey: `plan_keep_${state.sale.id}_${Math.floor(Date.now() / 60_000)}` });
  await db.from("purchase_records").update({ cancel_at_period_end: false, last_payment_update_source: "plan_change", last_payment_update_at: new Date().toISOString() }).eq("id", state.sale.id);
  const option = state.current.option;
  const row = await insertChange(db, {
    client_id: state.client.id,
    kind: "reactivate",
    status: "applied",
    source: actorUserId ? "client" : "admin",
    from_package_id: option?.id ?? null,
    to_package_id: option?.id ?? null,
    from_family: state.current.family,
    to_family: state.current.family === "custom" ? null : state.current.family,
    from_label: state.current.name,
    to_label: state.current.name,
    sale_id: state.sale.id,
    stripe_subscription_id: state.current.subscriptionId,
    requested_by: actorUserId,
    effective_at: new Date().toISOString(),
  });
  await notifyPlanChange(db, row, "undone");
  return { ok: true };
}

/* ───────────────────────── applying ───────────────────────── */

/** The coach a client (re)joining coaching gets: the one they had, else the owner's coach record. */
async function coachFor(db: Db, change: Record<string, any>): Promise<string | null> {
  if (change.previous_coach_id) return change.previous_coach_id;
  const { data: prior } = await db
    .from("plan_changes")
    .select("previous_coach_id")
    .eq("client_id", change.client_id)
    .not("previous_coach_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (prior?.[0]?.previous_coach_id) return prior[0].previous_coach_id;
  const { data: owners } = await db.from("business_owners").select("user_id");
  const ownerIds = (owners ?? []).map((o: any) => o.user_id).filter(Boolean);
  if (ownerIds.length) {
    const { data: c } = await db.from("coaches").select("id").in("user_id", ownerIds).eq("archived", false).limit(1);
    if (c?.[0]?.id) return c[0].id;
  }
  const { data: first } = await db.from("coaches").select("id").eq("archived", false).order("created_at", { ascending: true }).limit(1);
  return first?.[0]?.id ?? null;
}

function todayDay(tz = "America/Winnipeg"): string {
  return unixToDay(Math.floor(Date.now() / 1000), tz) ?? new Date().toISOString().slice(0, 10);
}

/**
 * Make the app match a change that's real in Stripe. Safe to run more than once:
 * the enrollment, the sale and the tier end up the same, and only the run that
 * marks the change applied sends the notices.
 */
export async function applyChange(db: Db, changeId: string): Promise<{ applied: boolean }> {
  const { data: change } = await db.from("plan_changes").select(CHANGE_COLUMNS).eq("id", changeId).maybeSingle();
  if (!change) return { applied: false };
  if (["applied", "cancelled", "failed", "requested", "offered"].includes(change.status)) return { applied: change.status === "applied" };
  const { data: client } = await db.from("clients").select("id, timezone, service_tier").eq("id", change.client_id).maybeSingle();
  const tz = client?.timezone ?? "America/Winnipeg";
  const day = todayDay(tz);

  // 1. The package they're on (one active enrollment; the old one ended, never deleted)
  const { data: active } = await db.from("coaching_package_enrollments").select("id, package_id, sale_id, starts_on").eq("client_id", change.client_id).eq("status", "active").maybeSingle();
  const goingToPackage = change.to_family && change.to_family !== "free" && change.to_package_id;
  const alreadyThere = !!active && goingToPackage && active.package_id === change.to_package_id && (active.sale_id ?? null) === (change.sale_id ?? null);
  if (active && !alreadyThere) {
    const endsOn = active.starts_on && active.starts_on > day ? active.starts_on : day;
    const { error } = await db.from("coaching_package_enrollments").update({ status: "ended", ends_on: endsOn, note: `Ended by a plan change (${change.kind})` }).eq("id", active.id).eq("status", "active");
    if (error) throw new Error(error.message);
  }
  // Same package, new price (an accepted offer moving a special price to the advertised one): they pay the advertised price now.
  if (alreadyThere && (change.kind === "upgrade" || change.kind === "downgrade") && change.to_price_cents != null) {
    await db.from("coaching_package_enrollments").update({ contracted_price_cents: null }).eq("id", active.id).eq("status", "active");
  }
  if (goingToPackage && !alreadyThere) {
    const { data: sale } = change.sale_id ? await db.from("purchase_records").select("next_billing_date, purchased_at").eq("id", change.sale_id).maybeSingle() : { data: null };
    const { error } = await db.from("coaching_package_enrollments").insert({
      client_id: change.client_id,
      package_id: change.to_package_id,
      starts_on: day,
      sale_id: change.sale_id ?? null,
      // the billing month (included calls) runs from the day it started, until the sale's own dates take over
      period_anchor: change.kind === "start" ? day : sale?.next_billing_date ?? day,
      contracted_price_cents: null,
      note: `Plan change: ${change.from_label ?? "Free"} → ${change.to_label ?? ""}`.slice(0, 500),
      created_by: change.requested_by ?? null,
    });
    // a parallel run got there first: the unique index keeps one active
    if (error && error.code !== "23505") throw new Error(error.message);
  }

  // 2. The sale says what they pay now
  if (goingToPackage && change.sale_id && change.kind !== "start") {
    const { data: pkg } = await db.from("coaching_packages").select("product_id, price_cents, name").eq("id", change.to_package_id).maybeSingle();
    const { data: prod } = pkg?.product_id ? await db.from("coaching_products").select("id, name, stripe_price_id, stripe_product_id").eq("id", pkg.product_id).maybeSingle() : { data: null };
    if (pkg && prod) {
      const { data: sale } = await db.from("purchase_records").select("contract_value_cents").eq("id", change.sale_id).maybeSingle();
      await db.from("purchase_records").update({
        offer_id: prod.id,
        offer_name: prod.name ?? pkg.name,
        stripe_price_id: prod.stripe_price_id,
        stripe_product_id: prod.stripe_product_id ?? null,
        full_payable_amount: (pkg.price_cents ?? 0) / 100,
        ...(sale?.contract_value_cents ? { contract_value_cents: pkg.price_cents } : {}),
        last_payment_update_source: "plan_change",
        last_payment_update_at: new Date().toISOString(),
      }).eq("id", change.sale_id);
    }
  }

  // 3. Coaching or self-serve (only when the family changes, and never for an end Stripe did on its own)
  const fromFamily: string | null = change.from_family ?? null;
  const toFamily: PlanFamily | null = change.to_family ?? null;
  const tierNow = client?.service_tier === "self_serve" ? "self_serve" : "coaching";
  const wantTier = toFamily === "coaching" ? "coaching" : toFamily ? "self_serve" : null;
  const familyMoves = toFamily && (toFamily !== fromFamily || (wantTier && wantTier !== tierNow));
  if (familyMoves && change.source !== "stripe") {
    const coach = toFamily === "coaching" ? await coachFor(db, change) : null;
    const { data: res, error } = await db.rpc("plan_apply_tier", { _client_id: change.client_id, _family: toFamily, _coach_id: coach });
    if (error) throw new Error(error.message);
    if (res?.skipped === "inactive") {
      await patchChange(db, change.id, { note: "The account is paused or deactivated, so access wasn't changed." });
    }
  }

  // 4. The coach's yes is used up by the purchase it allowed
  if (toFamily === "coaching" && (fromFamily === "free" || fromFamily === "membership")) {
    await db
      .from("coaching_purchase_approvals")
      .update({ used_at: new Date().toISOString(), used_change_id: change.id })
      .eq("client_id", change.client_id)
      .is("used_at", null)
      .is("revoked_at", null);
  }

  // 5. Done: only the run that flips it sends the notices
  const done = await patchChange(db, change.id, { status: "applied", error: null }, ["checkout", "processing", "awaiting_payment", "scheduled"]);
  if (done) {
    // an end Stripe did on its own didn't move their tier: the coach is told it ended, nothing more
    const notice: PlanNotice = done.source === "stripe" ? "ended_in_stripe" : done.kind === "start" || done.kind === "upgrade" ? "started" : "applied";
    await notifyPlanChange(db, done, notice);
    if (done.kind === "start") await checkDuplicatePlans(db, done);
  }
  return { applied: !!done };
}

/** Two live plan subscriptions for one person (a race the guards should have stopped): tell the admin, never refund on our own. */
async function checkDuplicatePlans(db: Db, change: Record<string, any>) {
  const { data: live } = await db
    .from("purchase_records")
    .select("id, offer_name, stripe_subscription_id, stripe_subscription_status, payment_status")
    .eq("client_id", change.client_id)
    .is("archived_at", null)
    .not("stripe_subscription_id", "is", null);
  const others = (live ?? []).filter((s: any) => s.id !== change.sale_id && saleIsLive(s));
  if (!others.length) return;
  try {
    await db.from("support_alerts").insert({
      error_type: "plan_duplicate_subscription",
      error_message: `A client now has ${others.length + 1} live subscriptions after starting ${change.to_label}. Check their Billing and cancel the extra one.`,
      page_route: `/admin/clients/${change.client_id}`,
      details: { client_id: change.client_id, change_id: change.id, sales: [change.sale_id, ...others.map((s: any) => s.id)] },
      status: "open",
    });
  } catch (e) {
    console.warn("[plans] duplicate alert failed", e);
  }
}

/* ───────────────────────── Stripe events ───────────────────────── */

/** checkout.session.completed with metadata.plan_change_id (the webhook already marked the sale paid). */
export async function onPlanCheckoutCompleted(db: Db, session: any): Promise<{ handled: boolean }> {
  const changeId = session?.metadata?.plan_change_id;
  if (!changeId) return { handled: false };
  const { data: change } = await db.from("plan_changes").select(CHANGE_COLUMNS).eq("id", changeId).maybeSingle();
  if (!change) return { handled: true };
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (change.status === "cancelled" && paid) {
    // They paid a checkout that had been replaced (or expired): they paid, so they get the plan.
    // Any newer unfinished checkout steps aside first (one change in flight per client).
    const { data: newer } = await db.from("plan_changes").select(CHANGE_COLUMNS).eq("client_id", change.client_id).eq("status", "checkout");
    for (const n of newer ?? []) await abandonCheckout(db, n, "Replaced: an earlier checkout was paid").catch(() => null);
    await patchChange(db, change.id, { status: "checkout", note: "Paid after being replaced" }, ["cancelled"]);
  }
  await patchChange(db, change.id, { stripe_subscription_id: subId, stripe_checkout_session_id: session.id }, ["checkout"]);
  if (!paid) return { handled: true };
  await applyChange(db, change.id);
  return { handled: true };
}

/** customer.subscription.updated / invoice.paid: an upgrade's charge went through, or a schedule changed in Stripe. */
export async function onPlanSubscriptionUpdated(db: Db, sub: any): Promise<void> {
  const s = subState(sub);
  if (!s.id) return;
  const { data: rows } = await db.from("plan_changes").select(CHANGE_COLUMNS).eq("stripe_subscription_id", s.id).in("status", ["processing", "awaiting_payment", "scheduled"]);
  for (const row of rows ?? []) {
    if ((row.status === "awaiting_payment" || row.status === "processing") && row.kind === "upgrade") {
      if (!s.pendingUpdate && s.priceId === row.stripe_to_price_id) await applyChange(db, row.id);
      continue;
    }
    if (row.status === "scheduled" && row.kind === "cancel" && !s.cancelAtPeriodEnd && s.status !== "canceled") {
      const done = await patchChange(db, row.id, { status: "cancelled", note: "Kept: the subscription was set to continue in Stripe" }, ["scheduled"]);
      if (done) await notifyPlanChange(db, done, "undone");
      continue;
    }
    if (row.status === "scheduled" && row.kind === "downgrade" && s.priceId && row.stripe_to_price_id && s.priceId !== row.stripe_to_price_id) {
      await patchChange(db, row.id, { status: "cancelled", note: "Changed in Stripe: the subscription isn't on the new price any more" }, ["scheduled"]);
      continue;
    }
    if (row.status === "scheduled" && row.kind === "downgrade" && row.effective_at && Date.parse(row.effective_at) <= Date.now() && s.periodEnd && s.periodEnd * 1000 > Date.parse(row.effective_at)) {
      // renewed at the new price: the paid month at the old one is over
      await applyChange(db, row.id);
    }
  }
  // Set to end in Stripe (the customer portal, the dashboard) with no change here: record it.
  if (s.cancelAtPeriodEnd && !(rows ?? []).length) {
    const { data: sale } = await db.from("purchase_records").select("id, client_id").eq("stripe_subscription_id", s.id).maybeSingle();
    if (!sale) return;
    const { data: enr } = await db.from("coaching_package_enrollments").select("id, package_id").eq("sale_id", sale.id).eq("status", "active").maybeSingle();
    if (!enr) return;
    const { data: pkg } = await db.from("coaching_packages").select("id, name, kind, price_cents").eq("id", enr.package_id).maybeSingle();
    const { data: free } = await db.from("coaching_packages").select("id, name").eq("kind", "free").eq("status", "active").limit(1);
    try {
      const row = await insertChange(db, {
        client_id: sale.client_id,
        kind: "cancel",
        status: "scheduled",
        source: "stripe",
        from_package_id: pkg?.id ?? null,
        to_package_id: free?.[0]?.id ?? null,
        from_family: pkg?.kind === "membership" ? "membership" : "coaching",
        to_family: "free",
        from_label: pkg?.name ?? null,
        to_label: free?.[0]?.name ?? "Free app",
        from_price_cents: pkg?.price_cents ?? null,
        to_price_cents: 0,
        sale_id: sale.id,
        stripe_subscription_id: s.id,
        stripe_from_price_id: s.priceId,
        effective_at: s.periodEnd ? new Date(s.periodEnd * 1000).toISOString() : null,
        note: "Set to end in Stripe",
      });
      await notifyPlanChange(db, row, "scheduled");
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
    }
  }
}

/** customer.subscription.deleted: a plan's subscription is over. */
export async function onPlanSubscriptionDeleted(db: Db, sub: any): Promise<void> {
  const s = subState(sub);
  if (!s.id) return;
  const { data: rows } = await db.from("plan_changes").select(CHANGE_COLUMNS).eq("stripe_subscription_id", s.id).in("status", ["processing", "awaiting_payment", "scheduled"]);
  let handled = false;
  for (const row of rows ?? []) {
    if (row.kind === "cancel") {
      await applyChange(db, row.id);
      handled = true;
    } else {
      await patchChange(db, row.id, { status: "failed", error: "The subscription ended before the change could happen" });
    }
  }
  if (handled) return;
  // Ended in Stripe with nothing scheduled here (cancelled in the dashboard, failed payments):
  // the package ends; whether coaching ends is the coach's call, so they're told, nothing more.
  const { data: sale } = await db.from("purchase_records").select("id, client_id").eq("stripe_subscription_id", s.id).maybeSingle();
  if (!sale) return;
  const { data: enr } = await db.from("coaching_package_enrollments").select("id, package_id").eq("sale_id", sale.id).eq("status", "active").maybeSingle();
  if (!enr) return;
  const { data: pkg } = await db.from("coaching_packages").select("id, name, kind, price_cents").eq("id", enr.package_id).maybeSingle();
  await db.from("coaching_package_enrollments").update({ status: "ended", note: "Its subscription ended in Stripe" }).eq("id", enr.id).eq("status", "active");
  try {
    const row = await insertChange(db, {
      client_id: sale.client_id,
      kind: "end",
      status: "applied",
      source: "stripe",
      from_package_id: pkg?.id ?? null,
      from_family: pkg?.kind === "membership" ? "membership" : "coaching",
      from_label: pkg?.name ?? null,
      to_label: null,
      sale_id: sale.id,
      stripe_subscription_id: s.id,
      effective_at: new Date().toISOString(),
      note: "The subscription ended in Stripe. Their access is unchanged until the coach decides.",
    });
    await notifyPlanChange(db, row, "ended_in_stripe");
  } catch (e) {
    if (!(e instanceof PlanError)) throw e;
  }
}

/**
 * invoice.payment_failed: is this the prorated charge of an upgrade waiting on
 * its payment? Then the plan just didn't change (their subscription itself is
 * fine), so the sale is never marked overdue for it.
 */
export async function isPlanChangeInvoice(db: Db, invoice: any): Promise<boolean> {
  const id = invoice?.id;
  if (!id) return false;
  if (invoice?.billing_reason && invoice.billing_reason !== "subscription_update") return false;
  const { data } = await db.from("plan_changes").select("id").eq("stripe_invoice_id", id).in("status", ["processing", "awaiting_payment", "failed", "cancelled"]).limit(1);
  if (data?.length) return true;
  const subId = typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.parent?.subscription_details?.subscription ?? null;
  if (!subId) return false;
  const { data: byOpen } = await db.from("plan_changes").select("id").eq("stripe_subscription_id", subId).in("status", ["processing", "awaiting_payment"]).eq("kind", "upgrade").limit(1);
  return !!byOpen?.length;
}

/* ───────────────────────── the tick ───────────────────────── */

export async function runPlanChangesTick(db: Db): Promise<Record<string, number>> {
  const out = { applied: 0, expired: 0, failed: 0, waiting: 0, errors: 0, offersClosed: 0 };
  // Offers nobody answered in time close; nothing about their plan changes.
  const { data: stale } = await db
    .from("plan_changes")
    .update({ status: "cancelled", note: "The offer ran out before it was answered" })
    .eq("status", "offered")
    .lte("offer_expires_at", new Date().toISOString())
    .select("id");
  out.offersClosed = stale?.length ?? 0;
  const { data: rows } = await db
    .from("plan_changes")
    .select(CHANGE_COLUMNS)
    .in("status", ["checkout", "processing", "awaiting_payment", "scheduled"])
    .order("created_at", { ascending: true })
    .limit(50);
  const now = Date.now();
  for (const row of rows ?? []) {
    try {
      const age = now - Date.parse(row.updated_at ?? row.created_at);
      if (row.status === "checkout") {
        if (age < 30 * 60_000) continue;
        if (!row.stripe_checkout_session_id) {
          if (age > 24 * 3600_000) {
            await patchChange(db, row.id, { status: "cancelled", note: "Checkout wasn't opened" }, ["checkout"]);
            out.expired++;
          }
          continue;
        }
        const apiKey = stripeKeyFor(null);
        const s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(row.stripe_checkout_session_id)}`, { apiKey });
        if (s?.status === "complete") {
          await onPlanCheckoutCompleted(db, s);
          out.applied++;
        } else if (s?.status === "expired" || age > 25 * 3600_000) {
          await patchChange(db, row.id, { status: "cancelled", note: "Checkout wasn't finished" }, ["checkout"]);
          out.expired++;
        }
        continue;
      }
      if (!row.stripe_subscription_id) continue;
      const { data: sale } = row.sale_id ? await db.from("purchase_records").select("stripe_mode").eq("id", row.sale_id).maybeSingle() : { data: null };
      const apiKey = stripeKeyFor(sale);
      if (row.status === "processing" || row.status === "awaiting_payment") {
        if (row.status === "processing" && age < 10 * 60_000) continue;
        const raw = await fetchSub(row.stripe_subscription_id, apiKey);
        const s = subState(raw);
        if (row.kind === "upgrade") {
          if (!s.pendingUpdate && s.priceId === row.stripe_to_price_id) {
            await applyChange(db, row.id);
            out.applied++;
          } else if (s.pendingUpdate && age < 23 * 3600_000) {
            if (row.status === "processing") await patchChange(db, row.id, { status: "awaiting_payment" }, ["processing"]);
            out.waiting++;
          } else {
            await voidInvoice(row.stripe_invoice_id ?? s.latestInvoiceId, apiKey);
            const f = await patchChange(db, row.id, { status: "failed", error: "The payment wasn't completed" }, ["processing", "awaiting_payment"]);
            if (f) await notifyPlanChange(db, f, "failed");
            out.failed++;
          }
        } else {
          // a downgrade / cancel cut off before it was marked scheduled: read what Stripe has
          const there = row.kind === "cancel" ? s.cancelAtPeriodEnd : s.priceId === row.stripe_to_price_id;
          if (there) {
            const d = await patchChange(db, row.id, { status: "scheduled", effective_at: s.periodEnd ? new Date(s.periodEnd * 1000).toISOString() : row.effective_at }, ["processing"]);
            if (d) await notifyPlanChange(db, d, "scheduled");
          } else {
            await patchChange(db, row.id, { status: "failed", error: "The change didn't reach Stripe" }, ["processing"]);
            out.failed++;
          }
        }
        continue;
      }
      // scheduled: due?
      if (!row.effective_at || Date.parse(row.effective_at) > now) continue;
      const raw = await fetchSub(row.stripe_subscription_id, apiKey).catch((e: any) => {
        if (/no such subscription|resource_missing/i.test(String(e?.message ?? ""))) return { id: row.stripe_subscription_id, status: "canceled" };
        throw e;
      });
      const s = subState(raw);
      if (row.kind === "cancel") {
        if (s.status === "canceled") {
          await applyChange(db, row.id);
          out.applied++;
        } else if (!s.cancelAtPeriodEnd) {
          const d = await patchChange(db, row.id, { status: "cancelled", note: "Kept: the subscription was set to continue in Stripe" }, ["scheduled"]);
          if (d) await notifyPlanChange(db, d, "undone");
        } else {
          out.waiting++; // Stripe ends it at the period's end; subscription.deleted (or the next tick) applies it
        }
        continue;
      }
      if (s.status === "canceled") {
        await patchChange(db, row.id, { status: "failed", error: "The subscription ended before the change could happen" }, ["scheduled"]);
        out.failed++;
        continue;
      }
      if (s.priceId && row.stripe_to_price_id && s.priceId !== row.stripe_to_price_id) {
        await patchChange(db, row.id, { status: "cancelled", note: "Changed in Stripe: the subscription isn't on the new price any more" }, ["scheduled"]);
        continue;
      }
      // renewed into the new price (its period now ends after the change), or the day has passed by an hour
      if ((s.periodEnd && s.periodEnd * 1000 > Date.parse(row.effective_at) + 60_000) || now - Date.parse(row.effective_at) > 3600_000) {
        await applyChange(db, row.id);
        out.applied++;
      } else out.waiting++;
    } catch (e) {
      out.errors++;
      console.error("[plans] tick failed for", row.id, e);
      await db.from("plan_changes").update({ attempts: (row.attempts ?? 0) + 1, error: String((e as any)?.message ?? e).slice(0, 500) }).eq("id", row.id);
    }
  }
  return out;
}

/* ───────────────────────── telling people ───────────────────────── */

export type PlanNotice =
  | "started"
  | "applied"
  | "scheduled"
  | "undone"
  | "failed"
  | "requested"
  | "ended_in_stripe"
  | "comeback_requested"
  | "offered"
  | "offer_declined"
  | "approved"
  | "declined";

function fmtDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Winnipeg" });
}

/** What the client is told (push + email) and what the admin is told, for one change. */
export function noticeCopy(row: Record<string, any>, notice: PlanNotice, firstName: string) {
  const to = row.to_label ?? "the free app";
  const from = row.from_label ?? "your plan";
  const when = fmtDay(row.effective_at);
  const toFree = row.to_family === "free";
  const client: { title: string; body: string } | null = (() => {
    switch (notice) {
      case "started":
        return row.kind === "start"
          ? { title: `Welcome to ${to}`, body: "Your plan is active. Tap to see what's included." }
          : { title: `You're on ${to}`, body: "Your new plan is active now." };
      case "applied":
        return toFree
          ? { title: "You're on the free app now", body: "Everything you logged is still here. Come back to coaching any time." }
          : { title: `You're on ${to} now`, body: "Your plan changed today, as scheduled." };
      case "scheduled":
        return toFree
          ? { title: `${from} ends ${when ?? "at the end of your paid month"}`, body: "Nothing changes until then. You can keep your plan any time before." }
          : { title: `Moving to ${to} on ${when ?? "your next billing date"}`, body: "Nothing changes until then. You can undo it any time before." };
      case "undone":
        return { title: `You're keeping ${from}`, body: "Nothing changes. Your plan carries on as it was." };
      case "failed":
        return { title: "Your plan didn't change", body: "The payment didn't go through, so nothing was charged. Tap to try again." };
      case "offered":
        return { title: `An offer from your coach: ${to}`, body: `Open your plan to see the price and when it would start. Nothing changes unless you accept.` };
      case "approved":
        return { title: "You're approved for coaching", body: `Pick ${row.to_label ?? "your package"} in the app to get started.` };
      case "declined":
        return { title: "About your coaching request", body: "Your coach replied. Open your plan to see it." };
      default:
        return null;
    }
  })();
  const verb: Record<PlanNotice, string> = {
    started: row.kind === "start" ? `started ${to}` : `upgraded to ${to}`,
    applied: toFree ? `moved to the free app (from ${from})` : `moved to ${to}`,
    scheduled: toFree ? `cancelled ${from} (ends ${when ?? "at period end"})` : `is moving to ${to} on ${when ?? "their next billing date"}`,
    undone: `is keeping ${from}`,
    failed: `tried to change to ${to}, but the payment didn't go through`,
    requested: `asked to change from ${from} to ${to}`,
    ended_in_stripe: `'s ${from} subscription ended in Stripe`,
    comeback_requested: `asked to come back to coaching${row.to_label ? ` (${row.to_label})` : ""}`,
    offered: `was offered ${to}`,
    offer_declined: `declined the offer of ${to}`,
    approved: `was approved for coaching`,
    declined: `was told no for now`,
  };
  const admin = {
    title: `${firstName} ${verb[notice]}`.replace(" 's", "'s"),
    body:
      notice === "ended_in_stripe"
        ? "They're still set up as before. Open their plan to end coaching or set it up again."
        : notice === "comeback_requested"
          ? "Approve or decline it in Sales → Plans."
          : "Tap to see their plan.",
  };
  return { client, admin };
}

/** The coach-chat confirmation a coaching client gets for a change (automated, from their coach). */
export function chatConfirmation(row: Record<string, any>, notice: PlanNotice): string | null {
  const to = row.to_label ?? "the free app";
  const from = row.from_label ?? "your plan";
  const when = fmtDay(row.effective_at);
  const toFree = row.to_family === "free";
  const price = row.to_price_cents != null && row.to_family !== "free" ? ` It's ${money(row.to_price_cents)} a month plus tax.` : "";
  switch (notice) {
    case "started":
      return row.kind === "start" ? `You're on ${to} now.${price} Welcome in.` : `Your plan is now ${to}.${price}`;
    case "applied":
      return toFree ? `${from} has ended, as scheduled. Everything you logged is still in the app.` : `Your plan changed to ${to} today, as scheduled.${price}`;
    case "scheduled":
      return toFree
        ? `Confirmed: ${from} ends ${when ?? "at the end of your paid month"}. Nothing changes until then, and you can keep it any time before in Account → Your plan.`
        : `Confirmed: you're moving to ${to} on ${when ?? "your next billing date"}.${price} Nothing changes until then, and you can undo it in Account → Your plan.`;
    case "undone":
      return `Done: you're keeping ${from}. Nothing changes.`;
    case "offered":
      return `I've offered you ${to}.${price} Have a look in Account → Your plan. Nothing changes unless you accept it.`;
    default:
      return null;
  }
}

async function postChatConfirmation(db: Db, row: Record<string, any>, notice: PlanNotice, client: Record<string, any>) {
  const body = chatConfirmation(row, notice);
  if (!body || !client.user_id) return;
  // only people with a coach chat: a coaching client, or someone just leaving coaching (the message lands before access changes)
  const coaching = client.service_tier === "coaching" || row.from_family === "coaching" || row.to_family === "coaching";
  if (!coaching) return;
  try {
    const key = `${row.id}:${notice}`;
    const { data: earlier } = await db.from("messages").select("id").eq("client_id", row.client_id).contains("attachments", JSON.stringify([{ kind: "plan_change", key }])).limit(1);
    if (earlier?.length) return;
    let sender: string | null = null;
    if (client.assigned_coach_id) {
      const { data: coach } = await db.from("coaches").select("user_id").eq("id", client.assigned_coach_id).maybeSingle();
      sender = coach?.user_id ?? null;
    }
    if (!sender) {
      const { data: owner } = await db.from("business_owners").select("user_id").limit(1).maybeSingle();
      sender = owner?.user_id ?? null;
    }
    if (!sender) return;
    const at = new Date().toISOString();
    await db.from("messages").insert({
      client_id: row.client_id,
      sender_id: sender,
      sender_role: "admin",
      body,
      attachments: [{ kind: "plan_change", key, change_id: row.id, notice }],
      message_type: "Payment",
      is_internal_note: false,
      // automated: it never counts as the coach replying
      is_automated: true,
      delivery_status: "sent",
      sent_at: at,
      read_by_admin_at: at,
    });
  } catch (e) {
    console.warn("[plans] chat confirmation failed", notice, e);
  }
}

export async function notifyPlanChange(db: Db, row: Record<string, any>, notice: PlanNotice): Promise<void> {
  try {
    const { data: c } = await db.from("clients").select("id, user_id, first_name, full_name, email, service_tier, assigned_coach_id").eq("id", row.client_id).maybeSingle();
    if (!c) return;
    if (row.source !== "stripe") await postChatConfirmation(db, row, notice, c);
    const name = (c.full_name || c.first_name || "A client").trim();
    const copy = noticeCopy(row, notice, name);
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const key = `plan:${row.id}:${notice}`;

    // the client (never for a request they sent, or an end Stripe did on its own)
    if (copy.client && c.user_id && (row.source !== "stripe" || notice === "approved")) {
      await sendWebPushToUser(db, c.user_id, { title: copy.client.title, body: copy.client.body, url: "/portal/plan", tag: `plan:${row.client_id}`, data: { kind: "plan_change", changeId: row.id } }, { category: "billing", eventKey: `${key}:${c.user_id}`, priority: "normal" });
      if (c.email) {
        const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
        await sendTemplateEmail(db, {
          template: "plan-change",
          to: c.email,
          idempotencyKey: key,
          data: {
            first_name: c.first_name ?? "",
            headline: copy.client.title,
            body: copy.client.body,
            rows: planEmailRows(row, notice),
            url: "https://jfeffect.com/portal/plan",
          },
        });
      }
    }

    // the admin(s) and their coach
    const { staffUserIdsForClient } = await import("@/lib/push/app-events.server");
    const staff = await staffUserIdsForClient(db, row.client_id);
    for (const uid of staff) {
      if (uid === row.requested_by) continue;
      await sendWebPushToUser(db, uid, { title: copy.admin.title, body: copy.admin.body, url: `/admin/clients/${row.client_id}?tab=billing`, tag: `plan:${row.client_id}`, data: { kind: "plan_change", clientId: row.client_id } }, { category: "billing", eventKey: `${key}:${uid}`, priority: "normal" });
    }
    const { sendBillingAdminEmail } = await import("@/lib/billing-notify.server");
    await sendBillingAdminEmail(db, {
      stripeEventId: key,
      subject: `Plan change: ${copy.admin.title}`,
      body: [
        copy.admin.title,
        "",
        ...planEmailRows(row, notice).map(([k, v]) => `${k}: ${v}`),
        row.note ? `Note: ${row.note}` : null,
        row.error ? `Problem: ${row.error}` : null,
        "",
        `Client: https://jfeffect.com/admin/clients/${row.client_id}?tab=billing`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    });
  } catch (e) {
    console.warn("[plans] notify failed", notice, e);
  }
}

function planEmailRows(row: Record<string, any>, notice: PlanNotice): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  out.push(["From", row.from_label ?? "Free app"]);
  out.push(["To", row.to_label ?? "Free app"]);
  const when = fmtDay(row.effective_at);
  if (notice === "scheduled" && when) out.push(["Takes effect", when]);
  if ((notice === "started" || notice === "applied") && row.applied_at) out.push(["Took effect", fmtDay(row.applied_at) ?? ""]);
  if (row.amount_due_now_cents != null && notice === "started" && row.amount_due_now_cents > 0) out.push(["Charged today", `${money(row.amount_due_now_cents)} (incl. tax)`]);
  if (row.to_price_cents != null && row.to_family !== "free") out.push(["Going forward", `${money(row.to_price_cents)} a month + tax`]);
  if (row.to_family === "free") out.push(["Going forward", "Nothing. The app stays free."]);
  return out;
}
