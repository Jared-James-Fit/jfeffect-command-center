/**
 * Coaching sold from the site (T01): "Ready to start" (a short intake, the
 * recurring terms, Stripe Checkout, then onboarding) beside "Want to talk
 * first" (the application and the discovery call). Pure rules first, then the
 * whole purchase through the real plan code against the in-memory database and
 * fake Stripe (helpers/plan-fakes.ts): nothing is granted until the webhook
 * says paid, and a repeated webhook does nothing twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeStripe } from "@/test/helpers/plan-fakes";
import {
  EMPTY_INTAKE,
  cleanIntake,
  consentText,
  directCheckoutGate,
  intakeError,
  recurringTerms,
  returnState,
} from "@/lib/coaching-sales/direct-checkout";
import { onboardingSteps, returnCopy } from "@/lib/coaching-sales/onboarding";
import { buildCatalog, currentPlanOf, transitionFor, type CatalogPackage, type CatalogProduct } from "@/lib/plans/plan-engine";
import { decisionRows, fromPublicRow, optionCards } from "@/lib/coaching-packages/packages";

const pushes: any[] = [];
const emails: any[] = [];
const setupEmails: string[] = [];
vi.mock("@/lib/push/push.server", () => ({ sendWebPushToUser: vi.fn(async (_db: any, uid: string, payload: any) => (pushes.push({ uid, ...payload }), { sent: 1 })) }));
vi.mock("@/lib/push/app-events.server", () => ({ staffUserIdsForClient: vi.fn(async () => ["owner-user"]) }));
vi.mock("@/lib/transactional-email.server", () => ({ sendTemplateEmail: vi.fn(async (_db: any, o: any) => (emails.push(o), { sent: true })) }));
vi.mock("@/lib/billing-notify.server", () => ({ sendBillingAdminEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/clients.functions", () => ({ sendClientSetupEmail: vi.fn(async (id: string) => (setupEmails.push(id), { sent: true })) }));
// The sale checkout itself (stripe-checkout.functions.ts, a server-function module) reduced to what
// it sends Stripe: the price, the way back and the metadata on the session and the subscription.
vi.mock("@/lib/stripe-checkout.functions", () => ({
  createAssignmentCheckout: vi.fn(async (db: any, _actor: any, data: any, opts: any) => {
    const { data: sale } = await db.from("purchase_records").select("*").eq("id", data.purchaseRecordId).maybeSingle();
    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": sale.stripe_price_id ?? "price_comp",
      success_url: opts.successUrl,
      "metadata[purchase_record_id]": sale.id,
      "subscription_data[metadata][purchase_record_id]": sale.id,
      ...Object.fromEntries(Object.entries(opts.metadata ?? {}).flatMap(([k, v]) => [[`metadata[${k}]`, String(v)], [`subscription_data[metadata][${k}]`, String(v)]])),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", body: body.toString() });
    const session = await res.json();
    await db.from("purchase_records").update({ stripe_checkout_session_id: session.id, payment_status: "Pending Payment" }).eq("id", sale.id);
    return { url: session.url, sessionId: session.id, mode: "subscription" };
  }),
}));

const S = await import("@/lib/plans/plans.server");

describe("the intake and what they agree to", () => {
  it("asks only for a name, a working email, an optional phone and a goal", () => {
    expect(intakeError(EMPTY_INTAKE)).toBe("Add your name.");
    const ok = { full_name: "Sam Lifter", email: "sam@example.com", phone: "", main_goal: "powerlifting", target_outcome: "" };
    expect(intakeError(ok)).toBeNull();
    expect(intakeError({ ...ok, email: "sam@" })).toMatch(/email/);
    expect(intakeError({ ...ok, phone: "12" })).toMatch(/phone/);
    expect(intakeError({ ...ok, main_goal: "" })).toMatch(/help with/);
    expect(cleanIntake({ ...ok, full_name: "  Sam   Lifter ", email: " SAM@Example.com " })).toMatchObject({ full_name: "Sam Lifter", email: "sam@example.com" });
  });

  it("says it's monthly until cancelled, how to cancel, tax and the agreement, before Pay", () => {
    const t = recurringTerms({ name: "Complete Online Coaching", priceCents: 13000, currency: "cad" });
    expect(t[0]).toBe("Complete Online Coaching is a monthly subscription: $130 CAD plus applicable tax today, then the same every month on that date until you cancel.");
    expect(t.join(" ")).toMatch(/Cancel any time in the app/);
    expect(t.join(" ")).toMatch(/end of the month you've paid for/);
    expect(t.join(" ")).toMatch(/jfeffect\.com\/coaching-agreement/);
    // refunds are the agreement's, never restated
    expect(t.join(" ")).not.toMatch(/refund within|money back|guarantee/i);
    expect(consentText({ name: "X", priceCents: 9900 })).toMatch(/^I agree: X is a monthly subscription/);
  });
});

describe("when Ready to start is offered", () => {
  const base = { packageOn: true, problem: null, keyMode: "test" as const, liveEnabled: false };
  it("only for a package the coach turned on, that can be sold, with a Stripe key", () => {
    expect(directCheckoutGate(base)).toEqual({ available: true, mode: "test" });
    expect(directCheckoutGate({ ...base, packageOn: false })).toEqual({ available: false, reason: "off" });
    expect(directCheckoutGate({ ...base, problem: "Its product has no Stripe price" })).toEqual({ available: false, reason: "not_ready" });
    expect(directCheckoutGate({ ...base, keyMode: null })).toEqual({ available: false, reason: "no_stripe" });
  });
  it("against live Stripe only once the owner switches it on", () => {
    expect(directCheckoutGate({ ...base, keyMode: "live" })).toEqual({ available: false, reason: "live_off" });
    expect(directCheckoutGate({ ...base, keyMode: "live", liveEnabled: true })).toEqual({ available: true, mode: "live" });
  });
  it("the page back from Stripe only says what happened, never grants anything", () => {
    expect(returnState("paid")).toBe("paid");
    expect(returnState("cancelled")).toBe("cancelled");
    expect(returnState("granted")).toBe("none");
    expect(returnCopy("paid").body).toMatch(/As soon as Stripe confirms it/);
    expect(returnCopy("cancelled").title).toBe("No charge was made.");
    expect(onboardingSteps({ hasAccount: false, setupSent: true })[0]).toMatch(/setup email/);
    expect(onboardingSteps({ hasAccount: true, setupSent: false })[1]).toMatch(/Coaching Agreement first/);
  });
});

describe("plans: a package sold straight skips the approval only for someone never coached", () => {
  const PACKAGES: CatalogPackage[] = [
    { id: "p-free", slug: "free", kind: "free", name: "Free app", price_cents: 0, status: "active", is_public: true },
    { id: "p-comp", slug: "complete", kind: "subscription", name: "Complete Online Coaching", price_cents: 13000, billing_interval: "month", status: "active", is_public: true, product_id: "prod-comp", direct_checkout: true },
    { id: "p-plus", slug: "plus", kind: "subscription", name: "Coaching Plus", price_cents: 24900, billing_interval: "month", status: "active", is_public: true, product_id: "prod-plus" },
  ];
  const PRODUCTS: CatalogProduct[] = [
    { id: "prod-comp", price_cents: 13000, currency: "cad", stripe_price_id: "price_comp", mode: "subscription", active: true },
    { id: "prod-plus", price_cents: 24900, currency: "cad", stripe_price_id: "price_plus", mode: "subscription", active: true },
  ];
  const catalog = buildCatalog(PACKAGES, PRODUCTS);
  const free = currentPlanOf({ tier: "self_serve", enrollment: null, sale: null, catalog });
  const to = (s: string) => catalog.find((o) => o.slug === s)!;

  it("direct checkout → checkout; the rest still by approval; a former client still asks", () => {
    expect(to("complete").directCheckout).toBe(true);
    expect(transitionFor(free, to("complete"), { coaching: { state: "apply" } })).toMatchObject({ kind: "start", action: "checkout", available: true });
    expect(transitionFor(free, to("complete"), { coaching: { state: "applied", at: "2026-11-20" } })).toMatchObject({ action: "checkout", available: true });
    expect(transitionFor(free, to("plus"), { coaching: { state: "apply" } })).toMatchObject({ action: "apply" });
    expect(transitionFor(free, to("complete"), { coaching: { state: "comeback" } })).toMatchObject({ action: "comeback" });
    expect(transitionFor(free, to("complete"), { coaching: { state: "apply" }, native: true })).toMatchObject({ available: false, blocked: "Upgrade on the web at jfeffect.com" });
  });
});

describe("the public pages never market Premium", () => {
  const row = (over: Record<string, unknown>) => fromPublicRow({ slug: "x", kind: "subscription", name: "X", price_cents: 100, listed: true, ...over });
  it("a membership (Premium is one) is never a card or a decision row; the flag reads only on coaching", () => {
    const rows = [
      row({ slug: "free", kind: "free", name: "Free app", price_cents: 0 }),
      row({ slug: "complete", name: "Complete Online Coaching", price_cents: 13000, direct_checkout: true }),
      row({ slug: "premium", kind: "membership", name: "JF Effect Premium", price_cents: 4999, direct_checkout: true }),
    ];
    expect(optionCards(rows, { free: true }).map((p) => p.slug)).toEqual(["free", "complete"]);
    expect(decisionRows(rows).map((p) => p.slug)).toEqual(["free", "complete"]);
    expect(rows[1].directCheckout).toBe(true);
    expect(rows[2].directCheckout).toBe(false);
  });
});

/* ───────────────── the purchase, end to end ───────────────── */

const NOW = Date.parse("2026-11-25T18:00:00Z");
let stripe: FakeStripe;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  stripe = new FakeStripe();
  stripe.price("price_comp", 13000);
  globalThis.fetch = vi.fn(stripe.handler) as any;
  pushes.length = 0;
  emails.length = 0;
  setupEmails.length = 0;
});
afterEach(() => vi.useRealTimers());

const lead = { id: "c-lead", user_id: null, first_name: "Lena", full_name: "Lena Lifter", email: "lena@example.com", service_tier: "coaching", status: "Lead", lifecycle_stage: "applicant", archived: false, assigned_coach_id: null, coaching_package: null, timezone: "America/Winnipeg" };

function seed(clients: any[] = [lead]) {
  return new FakeDb({
    coaching_packages: [
      { id: "p-free", slug: "free", kind: "free", name: "Free app", price_cents: 0, status: "active", is_public: true, sort_order: 0, features: [] },
      { id: "p-comp", slug: "complete", kind: "subscription", name: "Complete Online Coaching", price_cents: 13000, currency: "CAD", billing_interval: "month", status: "active", is_public: true, product_id: "prod-comp", direct_checkout: true, features: ["A program written for you"] },
    ],
    coaching_products: [
      { id: "prod-comp", name: "Online Coaching — $130/month", price_cents: 13000, currency: "cad", stripe_price_id: "price_comp", stripe_product_id: "sprod_comp", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
    ],
    coaches: [{ id: "coach-jared", user_id: "owner-user", archived: false, created_at: "2026-01-01" }],
    business_owners: [{ user_id: "owner-user" }],
    clients,
    coaching_package_enrollments: [],
    purchase_records: [],
    app_members: [],
    plan_changes: [],
    pt_sessions: [],
    support_alerts: [],
    messages: [],
    coaching_purchase_approvals: [],
    coaching_agreement_signatures: [],
    coaching_agreement_client_state: [],
    coaching_applications: [{ id: "app-1", client_id: "c-lead", status: "Checkout started", is_test: false, created_at: "2026-11-25T17:59:00Z", application_source: "direct_checkout" }],
    account_lifecycle_events: [],
    client_crm_activities: [],
  });
}

describe("Ready to start, end to end", () => {
  it("opens one checkout for the lead, gives nothing until paid, then a client with a coach, a package and a setup email, once", async () => {
    const db = seed();
    const r = await S.startDirectCheckout(db, "c-lead", "complete", { origin: "https://jfeffect.com", consentText: "I agree: …", applicationId: "app-1" });
    const row = db.rows("plan_changes")[0];
    expect(row).toMatchObject({ status: "checkout", kind: "start", from_family: "free", to_family: "coaching", consent_text: "I agree: …" });
    const cs = Object.values(stripe.sessions)[0] as any;
    expect(r.url).toBeTruthy();
    expect(cs.metadata).toMatchObject({ plan_change_id: row.id, channel: "site", application_id: "app-1" });
    expect(cs.success_url).toContain(`/coaching/apply?checkout=paid&package=complete&change=${row.id}`);
    // the success page alone grants nothing
    expect(db.rows("clients")[0]).toMatchObject({ status: "Lead", assigned_coach_id: null });
    expect(db.rows("coaching_package_enrollments")).toHaveLength(0);

    // the signed webhook: the sale marked paid, then the plan applied
    const { session, sub } = stripe.completeCheckout(cs.id, "cus_lena");
    const saleId = session.metadata.purchase_record_id;
    await db.from("purchase_records").update({ payment_status: "Active Subscription", stripe_subscription_id: sub.id, stripe_customer_id: "cus_lena", stripe_subscription_status: "active", stripe_mode: "test" }).eq("id", saleId);
    await S.onPlanCheckoutCompleted(db, session);

    const c = db.rows("clients")[0];
    expect(c).toMatchObject({ service_tier: "coaching", status: "New Client", assigned_coach_id: "coach-jared", lifecycle_stage: "active_client" });
    expect(db.rows("coaching_package_enrollments").filter((e) => e.status === "active")).toHaveLength(1);
    expect(db.rows("coaching_applications")[0].status).toBe("Approved");
    expect(setupEmails).toEqual(["c-lead"]);
    expect(emails.filter((e) => e.idempotencyKey === `coaching_welcome:${row.id}`)).toHaveLength(1);
    expect(pushes.some((p) => p.uid === "owner-user")).toBe(true);

    // Stripe sends it again: nothing twice
    await S.onPlanCheckoutCompleted(db, session);
    expect(db.rows("coaching_package_enrollments").filter((e) => e.status === "active")).toHaveLength(1);
    expect(db.rows("client_crm_activities").filter((a) => a.activity_type === "purchased")).toHaveLength(1);
    expect(setupEmails).toEqual(["c-lead"]);
  });

  it("never sells onto an email that already has an account, nor to a coaching client", async () => {
    const withLogin = seed([{ ...lead, user_id: "u-lena" }]);
    await expect(S.startDirectCheckout(withLogin, "c-lead", "complete", { origin: "https://jfeffect.com", consentText: "x", applicationId: null })).rejects.toThrow(/already has a JF Effect account/);
    const coached = seed([{ ...lead, status: "Active", assigned_coach_id: "coach-jared" }]);
    await expect(S.startDirectCheckout(coached, "c-lead", "complete", { origin: "https://jfeffect.com", consentText: "x", applicationId: null })).rejects.toThrow(/already set up with coaching/);
    expect(Object.keys(stripe.sessions)).toHaveLength(0);
  });

  it("a package not sold straight from the site is refused before Stripe is called", async () => {
    const db = seed();
    db.rows("coaching_packages").find((p) => p.slug === "complete")!.direct_checkout = false;
    await expect(S.startDirectCheckout(db, "c-lead", "complete", { origin: "https://jfeffect.com", consentText: "x", applicationId: null })).rejects.toThrow(/Book a call instead/);
    expect(Object.keys(stripe.sessions)).toHaveLength(0);
  });
});
