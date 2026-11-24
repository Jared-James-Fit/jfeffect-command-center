/**
 * Every plan move, end to end through the real server code (plans.server.ts,
 * createAssignmentCheckout), against an in-memory database with the
 * migration's rules and a fake Stripe that prorates, declines cards and rolls
 * billing periods (helpers/plan-fakes.ts). What Stripe's real test mode adds
 * on top (tax, 3-D Secure, the webhook's own delivery) is the
 * plan-lifecycle-check hook's job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeStripe } from "@/test/helpers/plan-fakes";

const pushes: any[] = [];
const emails: any[] = [];
const adminEmails: any[] = [];
vi.mock("@/lib/push/push.server", () => ({ sendWebPushToUser: vi.fn(async (_db: any, uid: string, payload: any) => (pushes.push({ uid, ...payload }), { sent: 1 })) }));
vi.mock("@/lib/push/app-events.server", () => ({ staffUserIdsForClient: vi.fn(async () => ["owner-user"]) }));
vi.mock("@/lib/transactional-email.server", () => ({ sendTemplateEmail: vi.fn(async (_db: any, o: any) => (emails.push(o), { sent: true })) }));
vi.mock("@/lib/billing-notify.server", () => ({ sendBillingAdminEmail: vi.fn(async (_db: any, o: any) => void adminEmails.push(o)) }));

const S = await import("@/lib/plans/plans.server");

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-23T18:00:00Z");

function seed(over: { clients?: any[]; enrollments?: any[]; sales?: any[]; members?: any[]; changes?: any[]; membership?: boolean } = {}) {
  const packages = [
    { id: "p-free", slug: "free", kind: "free", name: "Free app", price_cents: 0, status: "active", is_public: true, sort_order: 0, features: ["My programs, or build or upload your own", "Every set, PR and progression logged"] },
    { id: "p-nut", slug: "nutrition", kind: "subscription", name: "Nutrition Coaching", price_cents: 9900, currency: "CAD", billing_interval: "month", status: "active", is_public: true, product_id: "prod-nut", features: ["A nutrition plan built around the food you eat", "The full app for your own training"] },
    { id: "p-comp", slug: "complete", kind: "subscription", name: "Complete Online Coaching", price_cents: 13000, currency: "CAD", billing_interval: "month", status: "active", is_public: true, recommended: true, product_id: "prod-comp", features: ["Everything in Nutrition Coaching", "A program written for you and changed as you progress", "Message me in the app"] },
    { id: "p-plus", slug: "plus", kind: "subscription", name: "Coaching Plus", price_cents: 24900, currency: "CAD", billing_interval: "month", status: "active", is_public: true, product_id: "prod-plus", included_calls: 2, features: ["Everything in Complete Online Coaching", "Two private 30-minute video calls each billing month"] },
    ...(over.membership
      ? [{ id: "p-mem", slug: "membership", kind: "membership", name: "Membership", price_cents: 1500, currency: "CAD", billing_interval: "month", status: "active", is_public: true, product_id: "prod-mem", features: ["Members' programs library"] }]
      : []),
  ];
  const products = [
    { id: "prod-nut", name: "Nutrition Coaching — $99/month", price_cents: 9900, currency: "cad", stripe_price_id: "price_nut", stripe_product_id: "sprod_nut", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
    { id: "prod-comp", name: "Online Coaching — $130/month", price_cents: 13000, currency: "cad", stripe_price_id: "price_comp", stripe_product_id: "sprod_comp", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
    { id: "prod-plus", name: "Coaching Plus — $249/month", price_cents: 24900, currency: "cad", stripe_price_id: "price_plus", stripe_product_id: "sprod_plus", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
    { id: "prod-mem", name: "Membership — $15/month", price_cents: 1500, currency: "cad", stripe_price_id: "price_mem", stripe_product_id: "sprod_mem", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
  ];
  return new FakeDb({
    coaching_packages: packages,
    coaching_products: products,
    coaches: [{ id: "coach-jared", user_id: "owner-user", archived: false, created_at: "2026-01-01" }],
    business_owners: [{ user_id: "owner-user" }],
    clients: over.clients ?? [],
    coaching_package_enrollments: over.enrollments ?? [],
    purchase_records: over.sales ?? [],
    app_members: over.members ?? [],
    plan_changes: over.changes ?? [],
    pt_sessions: [],
    support_alerts: [],
    messages: [],
  });
}

const freeMember = { id: "c-free", user_id: "u-free", first_name: "Fiona", full_name: "Fiona Free", email: "fiona@example.com", service_tier: "self_serve", status: "Member", archived: false, assigned_coach_id: null, coaching_package: null, timezone: "America/Winnipeg" };
const coached = (over: any = {}) => ({ id: "c-dev", user_id: "u-dev", first_name: "Devin", full_name: "Devin Buth", email: "devin@example.com", service_tier: "coaching", status: "Active", archived: false, assigned_coach_id: "coach-jared", coaching_package: "Complete Online Coaching", timezone: "America/Winnipeg", ...over });
const sale = (subId: string, over: any = {}) => ({ id: "sale-dev", client_id: "c-dev", offer_id: "prod-comp", offer_name: "Online Coaching — $130/month", stripe_subscription_id: subId, stripe_subscription_status: "active", payment_status: "Active Subscription", next_billing_date: "2026-12-09", cancel_at_period_end: false, full_payable_amount: 130, stripe_price_id: "price_comp", stripe_mode: "test", is_recurring: true, archived_at: null, ...over });
const enrolled = (pkg = "p-comp", saleId = "sale-dev") => ({ id: "e-dev", client_id: "c-dev", package_id: pkg, sale_id: saleId, contracted_price_cents: 13000, starts_on: "2026-06-09", status: "active" });

let stripe: FakeStripe;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  stripe = new FakeStripe();
  for (const [id, c] of [["price_nut", 9900], ["price_comp", 13000], ["price_plus", 24900], ["price_mem", 1500]] as const) stripe.price(id, c);
  globalThis.fetch = vi.fn(stripe.handler) as any;
  pushes.length = 0;
  emails.length = 0;
  adminEmails.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

const change = (db: FakeDb, id: string) => db.rows("plan_changes").find((r) => r.id === id)!;
const active = (db: FakeDb, clientId = "c-dev") => db.rows("coaching_package_enrollments").find((e) => e.client_id === clientId && e.status === "active");
const client = (db: FakeDb, id = "c-dev") => db.rows("clients").find((c) => c.id === id)!;

/** What the Stripe webhook does to the sale before handing a paid checkout to the plan (stripe-webhook.ts). */
async function webhookCheckout(db: FakeDb, csId: string) {
  const { session, sub } = stripe.completeCheckout(csId, "cus_fiona");
  const saleId = session.metadata.purchase_record_id;
  await db.from("purchase_records").update({ payment_status: "Active Subscription", stripe_subscription_id: sub.id, stripe_customer_id: "cus_fiona", stripe_subscription_status: "active", stripe_checkout_session_id: session.id, stripe_mode: "test" }).eq("id", saleId);
  await S.onPlanCheckoutCompleted(db, session);
  return { session, sub, saleId };
}

describe("Free → coaching (checkout, applied once paid)", () => {
  it("opens one checkout, gives nothing until Stripe says it's paid, then everything at once", async () => {
    const db = seed({ clients: [freeMember], members: [{ id: "m-1", user_id: "u-free", email: "fiona@example.com", account_type: "jf_member", status: "Active", subscription_status: "Free" }] });
    const state = await S.loadPlanState(db, "c-free");
    expect(state.current.managed).toBe("free");

    const preview = await S.previewChange(db, state, "complete");
    expect(preview.transition).toMatchObject({ kind: "start", action: "checkout" });
    expect(preview.quote).toMatchObject({ todayCents: 13000, todayTaxIncluded: false, nextCents: 13000 });
    expect(preview.lose).toEqual([]);

    const r = await S.confirmChange(db, state, "complete", { actorUserId: "u-free", source: "client", origin: "https://jfeffect.com" });
    expect(r.result).toBe("redirect");
    const row = db.rows("plan_changes")[0];
    expect(row).toMatchObject({ status: "checkout", kind: "start", to_label: "Complete Online Coaching", from_family: "free", to_family: "coaching" });
    const cs = Object.values(stripe.sessions)[0];
    expect(cs).toMatchObject({ mode: "subscription", price: "price_comp" });
    expect(cs.metadata.plan_change_id).toBe(row.id);
    expect(cs.subMeta.plan_change_id).toBe(row.id);
    expect(cs.success_url).toContain(`/portal/plan?checkout=done&change=${row.id}`);
    expect(cs.customer_text).toMatch(/Coaching Agreement/);
    // nothing given yet
    expect(client(db, "c-free").service_tier).toBe("self_serve");
    expect(active(db, "c-free")).toBeUndefined();

    await webhookCheckout(db, cs.id);
    expect(change(db, row.id).status).toBe("applied");
    expect(client(db, "c-free")).toMatchObject({ service_tier: "coaching", status: "New Client", assigned_coach_id: "coach-jared", coaching_package: "Complete Online Coaching" });
    expect(active(db, "c-free")).toMatchObject({ package_id: "p-comp", sale_id: row.sale_id });
    // their member row stays (nutrition logs hang off it); nothing deleted
    expect(db.rows("app_members")).toHaveLength(1);
    expect(pushes.map((p) => p.title)).toContain("Welcome to Complete Online Coaching");
    expect(emails[0]).toMatchObject({ template: "plan-change", to: "fiona@example.com" });
    expect(adminEmails[0].subject).toMatch(/started Complete Online Coaching/);

    // the webhook delivered twice: still one enrollment, one set of notices
    const n = pushes.length;
    await S.onPlanCheckoutCompleted(db, stripe.sessions[cs.id]);
    expect(db.rows("coaching_package_enrollments").filter((e) => e.client_id === "c-free")).toHaveLength(1);
    expect(pushes.length).toBe(n);
  });

  it("starting again replaces an unfinished checkout (never two), and an abandoned one expires", async () => {
    const db = seed({ clients: [freeMember] });
    const first = await S.confirmChange(db, await S.loadPlanState(db, "c-free"), "nutrition", { actorUserId: "u-free", source: "client", origin: "https://jfeffect.com" });
    const second = await S.confirmChange(db, await S.loadPlanState(db, "c-free"), "complete", { actorUserId: "u-free", source: "client", origin: "https://jfeffect.com" });
    expect(first.result).toBe("redirect");
    expect(second.result).toBe("redirect");
    const rows = db.rows("plan_changes");
    expect(rows.filter((r) => r.status === "checkout")).toHaveLength(1);
    expect(rows.find((r) => r.to_label === "Nutrition Coaching")?.status).toBe("cancelled");
    expect(Object.values(stripe.sessions).filter((s) => s.status === "expired")).toHaveLength(1);

    // a day later, unfinished: the tick clears it
    vi.setSystemTime(NOW + 26 * 3600_000);
    await S.runPlanChangesTick(db);
    expect(db.rows("plan_changes").every((r) => r.status === "cancelled")).toBe(true);
    expect(client(db, "c-free").service_tier).toBe("self_serve");
  });

  it("someone coached before comes back to the same coach, as Active", async () => {
    const db = seed({
      clients: [{ ...freeMember, id: "c-back", user_id: "u-back" }],
      enrollments: [{ id: "e-old", client_id: "c-back", package_id: "p-comp", status: "ended", starts_on: "2026-01-01", ends_on: "2026-05-01" }],
      changes: [{ id: "pc-old", client_id: "c-back", kind: "cancel", status: "applied", previous_coach_id: "coach-sam", created_at: "2026-05-01" }],
    });
    db.rows("coaches").push({ id: "coach-sam", user_id: "u-sam", archived: false, created_at: "2026-02-01" });
    await S.confirmChange(db, await S.loadPlanState(db, "c-back"), "complete", { actorUserId: "u-back", source: "client", origin: "https://jfeffect.com" });
    const cs = Object.values(stripe.sessions)[0];
    await webhookCheckout(db, cs.id);
    expect(client(db, "c-back")).toMatchObject({ service_tier: "coaching", status: "Active", assigned_coach_id: "coach-sam" });
  });
});

describe("Coaching → a bigger package (now, prorated, only once paid)", () => {
  function setup(daysIn = 15, declined = false) {
    const sub = stripe.subscribe("cus_dev", "price_comp", daysIn);
    if (declined) stripe.declines.add("cus_dev");
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    return { db, sub };
  }

  it("charges exactly the previewed amount and applies at once", async () => {
    const { db, sub } = setup(15);
    const state = await S.loadPlanState(db, "c-dev");
    const preview = await S.previewChange(db, state, "plus");
    // 15 of 30 days left: ($249 − $130) × ½ = $59.50, + 5% tax
    expect(preview.quote).toMatchObject({ todayCents: 6248, todayTaxIncluded: true, nextCents: 26145 });
    expect(preview.gain).toEqual(["Two private 30-minute video calls each billing month"]);
    expect(preview.lose).toEqual([]);

    // they confirm 4 minutes later: still charged what they saw
    vi.setSystemTime(NOW + 4 * 60_000);
    const r = await S.confirmChange(db, state, "plus", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com", prorationDate: preview.prorationDate });
    expect(r.result).toBe("applied");
    const update = stripe.calls.find((c) => c.method === "POST" && c.path === `/subscriptions/${sub.id}`)!;
    expect(update.params).toMatchObject({ proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete", proration_date: String(preview.prorationDate), "items[0][price]": "price_plus" });
    expect(Object.values(stripe.invoices)[0].total).toBe(6248);
    expect(active(db)).toMatchObject({ package_id: "p-plus", sale_id: "sale-dev" });
    expect(db.rows("coaching_package_enrollments").find((e) => e.id === "e-dev")?.status).toBe("ended");
    expect(db.rows("purchase_records")[0]).toMatchObject({ offer_id: "prod-plus", stripe_price_id: "price_plus", full_payable_amount: 249 });
    expect(client(db).service_tier).toBe("coaching");
    expect(pushes.some((p) => p.title === "You're on Coaching Plus")).toBe(true);
  });

  it("a declined card leaves them on their plan; paying on Stripe's page applies it", async () => {
    const { db, sub } = setup(10, true);
    const state = await S.loadPlanState(db, "c-dev");
    const r = await S.confirmChange(db, state, "plus", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com" });
    expect(r).toMatchObject({ result: "needs_payment", url: `https://invoice.stripe.com/i/${sub.id}` });
    const row = db.rows("plan_changes")[0];
    expect(row.status).toBe("awaiting_payment");
    expect(active(db)?.package_id).toBe("p-comp");
    // the failed charge is the plan change's, never an overdue subscription
    const inv = Object.values(stripe.invoices)[0];
    expect(await S.isPlanChangeInvoice(db, inv)).toBe(true);
    // a second change can't start while this one waits
    await expect(S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "nutrition", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com" })).rejects.toThrow(/going through/);

    const paid = stripe.payInvoice(inv.id);
    await S.onPlanSubscriptionUpdated(db, paid);
    expect(change(db, row.id).status).toBe("applied");
    expect(active(db)?.package_id).toBe("p-plus");
  });

  it("an upgrade nobody pays expires: the invoice is voided, nothing charged, the plan unchanged", async () => {
    const { db } = setup(10, true);
    await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "plus", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com" });
    vi.setSystemTime(NOW + 24 * 3600_000);
    await S.runPlanChangesTick(db);
    const row = db.rows("plan_changes")[0];
    expect(row).toMatchObject({ status: "failed", error: "The payment wasn't completed" });
    expect(Object.values(stripe.invoices)[0].status).toBe("void");
    expect(active(db)?.package_id).toBe("p-comp");
    expect(pushes.some((p) => p.title === "Your plan didn't change")).toBe(true);
  });

  it("they can cancel an upgrade waiting on payment", async () => {
    const { db } = setup(10, true);
    await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "plus", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com" });
    const row = db.rows("plan_changes")[0];
    await S.undoChange(db, await S.loadPlanState(db, "c-dev"), row.id, "u-dev");
    expect(change(db, row.id).status).toBe("cancelled");
    expect(Object.values(stripe.invoices)[0].status).toBe("void");
  });

  it("a double tap reaches Stripe once", async () => {
    const { db } = setup(15);
    const state = await S.loadPlanState(db, "c-dev");
    const [a, b] = await Promise.allSettled([
      S.confirmChange(db, state, "plus", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com" }),
      S.confirmChange(db, state, "plus", { actorUserId: "u-dev", source: "client", origin: "https://jfeffect.com" }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(stripe.calls.filter((c) => c.method === "POST" && c.path.startsWith("/subscriptions/"))).toHaveLength(1);
    expect(Object.values(stripe.invoices)).toHaveLength(1);
  });

  it("blocks an upgrade while a payment is failing (a downgrade or cancel still works)", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 5);
    const db = seed({ clients: [coached()], sales: [sale(sub.id, { stripe_subscription_status: "past_due", payment_status: "Overdue" })], enrollments: [enrolled()] });
    await expect(S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "plus", { actorUserId: "u-dev", source: "client", origin: "x" })).rejects.toThrow(/Update your card first/);
    stripe.subs[sub.id].status = "past_due";
    const r = await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "free", { actorUserId: "u-dev", source: "client", origin: "x" });
    expect(r.result).toBe("scheduled");
  });
});

describe("Coaching → a smaller package (when the paid month ends)", () => {
  it("charges nothing today, keeps Plus until the renewal, then switches", async () => {
    const sub = stripe.subscribe("cus_dev", "price_plus", 20);
    const db = seed({ clients: [coached()], sales: [sale(sub.id, { stripe_price_id: "price_plus", full_payable_amount: 249, offer_id: "prod-plus" })], enrollments: [{ ...enrolled("p-plus"), contracted_price_cents: 24900 }] });
    const state = await S.loadPlanState(db, "c-dev");
    const preview = await S.previewChange(db, state, "nutrition");
    expect(preview.quote).toMatchObject({ todayCents: 0, nextCents: 10395 });
    expect(preview.lose).toContain("Two private 30-minute video calls each billing month");
    expect(preview.lose).toContain("Message me in the app");

    const r = await S.confirmChange(db, state, "nutrition", { actorUserId: "u-dev", source: "client", origin: "x" });
    expect(r.result).toBe("scheduled");
    const row = db.rows("plan_changes")[0];
    expect(row).toMatchObject({ status: "scheduled", kind: "downgrade" });
    expect(stripe.calls.find((c) => c.method === "POST" && c.path.startsWith("/subscriptions/"))?.params).toEqual({ "items[0][id]": stripe.subs[sub.id].items.data[0].id, "items[0][price]": "price_nut", proration_behavior: "none" });
    expect(Object.values(stripe.invoices)).toHaveLength(0);
    // still Plus (and its calls) until the paid month ends
    expect(active(db)?.package_id).toBe("p-plus");
    expect(pushes.some((p) => /Moving to Nutrition Coaching on/.test(p.title))).toBe(true);

    // ten days later the period renews at the new price
    vi.setSystemTime(NOW + 10 * DAY + 60_000);
    stripe.rollPeriod(sub.id);
    await S.runPlanChangesTick(db);
    expect(change(db, row.id).status).toBe("applied");
    expect(active(db)?.package_id).toBe("p-nut");
    expect(db.rows("purchase_records")[0]).toMatchObject({ offer_id: "prod-nut", full_payable_amount: 99 });
    expect(client(db).service_tier).toBe("coaching");
  });

  it("undo puts the price back and nothing changes", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 3);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "nutrition", { actorUserId: "u-dev", source: "client", origin: "x" });
    const row = db.rows("plan_changes")[0];
    expect(stripe.subs[sub.id].items.data[0].price.id).toBe("price_nut");
    await S.undoChange(db, await S.loadPlanState(db, "c-dev"), row.id, "u-dev");
    expect(change(db, row.id).status).toBe("cancelled");
    expect(stripe.subs[sub.id].items.data[0].price.id).toBe("price_comp");
    expect(active(db)?.package_id).toBe("p-comp");
  });

  it("a legacy price is said before it's given up", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 3);
    const db = seed({ clients: [coached()], sales: [sale(sub.id, { full_payable_amount: 65 })], enrollments: [{ ...enrolled(), contracted_price_cents: 6500 }] });
    const preview = await S.previewChange(db, await S.loadPlanState(db, "c-dev"), "nutrition");
    expect(preview.warnings[0]).toMatch(/You pay \$65 a month now/);
  });
});

describe("Coaching → Free (at the end of the paid month, keeping everything)", () => {
  it("schedules, keeps coaching until the end, then moves them to the free app", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 25);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()], members: [{ id: "m-dev", user_id: "u-dev", email: "devin@example.com", account_type: "program_only", status: "Active", subscription_status: null }] });
    db.rows("pt_sessions").push({ id: "pt-1", client_id: "c-dev", status: "Scheduled", starts_at: new Date(NOW + 9 * DAY).toISOString() });
    const preview = await S.previewChange(db, await S.loadPlanState(db, "c-dev"), "free");
    expect(preview.quote).toMatchObject({ todayCents: 0, nextCents: 0 });
    expect(preview.warnings.join(" ")).toMatch(/program your coach wrote stays on your calendar/);
    expect(preview.warnings.join(" ")).toMatch(/1 session booked after/);

    const r = await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "free", { actorUserId: "u-dev", source: "client", origin: "x" });
    expect(r.result).toBe("scheduled");
    expect(stripe.subs[sub.id].cancel_at_period_end).toBe(true);
    expect(db.rows("purchase_records")[0].cancel_at_period_end).toBe(true);
    expect(client(db).service_tier).toBe("coaching");

    // the period ends: Stripe ends the subscription and tells the webhook
    vi.setSystemTime(NOW + 5 * DAY + 60_000);
    const ended = stripe.rollPeriod(sub.id);
    await S.onPlanSubscriptionDeleted(db, ended);
    const row = db.rows("plan_changes")[0];
    expect(row.status).toBe("applied");
    expect(client(db)).toMatchObject({ service_tier: "self_serve", status: "Member", assigned_coach_id: null, coaching_package: null });
    expect(db.rows("app_members")[0]).toMatchObject({ account_type: "jf_member", status: "Active", subscription_status: "Free" });
    expect(active(db)).toBeUndefined();
    // nothing deleted: the enrollment ended, the sale and the booked session are still there
    expect(db.rows("coaching_package_enrollments")).toHaveLength(1);
    expect(db.rows("purchase_records")).toHaveLength(1);
    expect(db.rows("pt_sessions")).toHaveLength(1);
    expect(row.previous_coach_id).toBe("coach-jared");
    expect(pushes.some((p) => p.title === "You're on the free app now")).toBe(true);
  });

  it("Keep my plan undoes it in Stripe", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 25);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "free", { actorUserId: "u-dev", source: "client", origin: "x" });
    await S.keepPlan(db, await S.loadPlanState(db, "c-dev"), "u-dev");
    expect(stripe.subs[sub.id].cancel_at_period_end).toBe(false);
    expect(db.rows("plan_changes")[0].status).toBe("cancelled");
    expect(db.rows("purchase_records")[0].cancel_at_period_end).toBe(false);
  });

  it("a deactivated account keeps its hold (the lifecycle owns it)", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 25);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "free", { actorUserId: "u-dev", source: "client", origin: "x" });
    client(db).status = "Deactivated";
    client(db).archived = true;
    await S.onPlanSubscriptionDeleted(db, stripe.rollPeriod(sub.id));
    expect(client(db).service_tier).toBe("coaching");
    expect(db.rows("plan_changes")[0].note).toMatch(/paused or deactivated/);
  });
});

describe("Membership (once one is configured)", () => {
  it("free → membership → coaching → membership → free, one account throughout", async () => {
    const db = seed({ clients: [freeMember], membership: true });
    await S.confirmChange(db, await S.loadPlanState(db, "c-free"), "membership", { actorUserId: "u-free", source: "client", origin: "x" });
    const cs = Object.values(stripe.sessions)[0];
    expect(cs.customer_text).toBeNull(); // a membership isn't sold under the Coaching Agreement
    const { sub } = await webhookCheckout(db, cs.id);
    expect(client(db, "c-free").service_tier).toBe("self_serve");
    expect(db.rows("app_members")[0].subscription_status).toBe("Active");
    let state = await S.loadPlanState(db, "c-free");
    expect(state.current).toMatchObject({ family: "membership", managed: "stripe" });

    vi.setSystemTime(NOW + 1000);
    const up = await S.confirmChange(db, state, "complete", { actorUserId: "u-free", source: "client", origin: "x" });
    expect(up.result).toBe("applied");
    expect(client(db, "c-free")).toMatchObject({ service_tier: "coaching", assigned_coach_id: "coach-jared" });
    expect(stripe.subs[sub.id].items.data[0].price.id).toBe("price_comp"); // same subscription, no second one

    state = await S.loadPlanState(db, "c-free");
    await S.confirmChange(db, state, "membership", { actorUserId: "u-free", source: "client", origin: "x" });
    vi.setSystemTime(NOW + 31 * DAY);
    stripe.rollPeriod(sub.id);
    await S.runPlanChangesTick(db);
    expect(client(db, "c-free")).toMatchObject({ service_tier: "self_serve", status: "Member", assigned_coach_id: null });
    expect(db.rows("app_members")[0].subscription_status).toBe("Active");

    state = await S.loadPlanState(db, "c-free");
    await S.confirmChange(db, state, "free", { actorUserId: "u-free", source: "client", origin: "x" });
    await S.onPlanSubscriptionDeleted(db, stripe.rollPeriod(sub.id));
    expect(db.rows("app_members")[0].subscription_status).toBe("Free");
    expect(Object.keys(stripe.subs)).toHaveLength(1);
    expect(db.rows("plan_changes").map((r) => `${r.kind}:${r.status}`)).toEqual(["start:applied", "upgrade:applied", "downgrade:applied", "cancel:applied"]);
  });
});

describe("Custom arrangements, Stripe on its own, configuration", () => {
  it("a legacy subscriber asks their coach: a chat message, no Stripe call", async () => {
    const sub = stripe.subscribe("cus_r", "price_legacy", 3);
    const db = seed({ clients: [coached({ id: "c-r", user_id: "u-r", first_name: "Reece" })], sales: [sale(sub.id, { id: "sale-r", client_id: "c-r", offer_name: "Online Coaching — Legacy $65", full_payable_amount: 65, stripe_price_id: "price_legacy" })] });
    const state = await S.loadPlanState(db, "c-r");
    expect(state.current).toMatchObject({ managed: "custom", name: "Online Coaching — Legacy $65" });
    const r = await S.confirmChange(db, state, "plus", { actorUserId: "u-r", source: "client", origin: "x", note: "Want the calls" });
    expect(r.result).toBe("requested");
    expect(db.rows("messages")[0]).toMatchObject({ client_id: "c-r", sender_role: "client", message_type: "Payment" });
    expect(db.rows("messages")[0].body).toMatch(/change my plan from Online Coaching — Legacy \$65 to Coaching Plus[\s\S]*Want the calls/);
    expect(stripe.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(adminEmails[0].subject).toMatch(/asked to change/);
  });

  it("a member still paying for something else never gets a second subscription", async () => {
    const db = seed({ clients: [freeMember], members: [{ id: "m-1", user_id: "u-free", email: "fiona@example.com", account_type: "jf_member", status: "Active", subscription_status: "Active", stripe_subscription_id: "sub_old" }] });
    const state = await S.loadPlanState(db, "c-free");
    expect(state.current.managed).toBe("custom");
    const r = await S.confirmChange(db, state, "complete", { actorUserId: "u-free", source: "client", origin: "x" });
    expect(r.result).toBe("requested");
    expect(Object.keys(stripe.sessions)).toHaveLength(0);
  });

  it("a plan whose Stripe price doesn't match is never sold, and the admin is told", async () => {
    stripe.price("price_comp", 12000);
    const db = seed({ clients: [freeMember] });
    await expect(S.confirmChange(db, await S.loadPlanState(db, "c-free"), "complete", { actorUserId: "u-free", source: "client", origin: "x" })).rejects.toThrow(/isn't available yet/);
    expect(Object.keys(stripe.sessions)).toHaveLength(0);
    expect(db.rows("support_alerts")[0]).toMatchObject({ error_type: "plan_config" });
    expect(db.rows("support_alerts")[0].error_message).toMatch(/charges \$120, not \$130/);
  });

  it("a subscription ended in Stripe with nothing scheduled: the package ends, coaching stays the coach's call", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 3);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    stripe.subs[sub.id].status = "canceled";
    await S.onPlanSubscriptionDeleted(db, stripe.subs[sub.id]);
    expect(active(db)).toBeUndefined();
    expect(client(db).service_tier).toBe("coaching");
    expect(db.rows("plan_changes")[0]).toMatchObject({ kind: "end", status: "applied", source: "stripe" });
    expect(adminEmails[0].subject).toMatch(/ended in Stripe/);
    expect(pushes.every((p) => p.uid === "owner-user")).toBe(true); // the client isn't told what they didn't do
  });

  it("cancelled in Stripe's portal: recorded as scheduled; it ends without moving their tier on its own", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 3);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    stripe.subs[sub.id].cancel_at_period_end = true;
    await S.onPlanSubscriptionUpdated(db, stripe.subs[sub.id]);
    expect(db.rows("plan_changes")[0]).toMatchObject({ kind: "cancel", status: "scheduled", source: "stripe" });
    await S.onPlanSubscriptionDeleted(db, stripe.rollPeriod(sub.id));
    expect(db.rows("plan_changes")[0].status).toBe("applied");
    expect(client(db).service_tier).toBe("coaching");
    expect(adminEmails.at(-1).subject).toMatch(/ended in Stripe/);
    expect(pushes.every((p) => p.uid === "owner-user")).toBe(true);
  });

  it("an admin can switch someone up now with no charge", async () => {
    const sub = stripe.subscribe("cus_dev", "price_comp", 3);
    const db = seed({ clients: [coached()], sales: [sale(sub.id)], enrollments: [enrolled()] });
    const r = await S.confirmChange(db, await S.loadPlanState(db, "c-dev"), "plus", { actorUserId: "owner-user", source: "admin", origin: "x", adminNow: true });
    expect(r.result).toBe("applied");
    expect(stripe.calls.find((c) => c.method === "POST" && c.path.startsWith("/subscriptions/"))?.params.proration_behavior).toBe("none");
    expect(Object.values(stripe.invoices)).toHaveLength(0);
    expect(active(db)?.package_id).toBe("p-plus");
    expect(db.rows("plan_changes")[0]).toMatchObject({ source: "admin", status: "applied" });
  });
});
