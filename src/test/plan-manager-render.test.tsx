import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PlanManager, type PlanApi } from "@/components/plans/plan-manager";
import type { PlanView } from "@/lib/plans/plans.functions";

const api: PlanApi = {
  preview: async () => {
    throw new Error("not in this test");
  },
  confirm: async () => ({ result: "applied", changeId: "x" }),
  undo: async () => null,
  keep: async () => null,
};

const card = (slug: string, name: string, family: any, priceCents: number, transition: any, extra: any = {}) => ({
  slug,
  name,
  family,
  tagline: null,
  bestFor: null,
  priceCents,
  features: ["A program written for you"],
  includedCalls: 0,
  recommended: false,
  gain: [],
  lose: [],
  transition: { available: true, blocked: null, configProblem: null, ...transition },
  ...extra,
});

function view(over: Partial<PlanView> = {}): PlanView {
  return {
    clientId: "c1",
    firstName: "Devin",
    current: {
      family: "coaching",
      name: "Complete Online Coaching",
      priceCents: 13000,
      managed: "stripe",
      customReason: null,
      status: "active",
      saleId: "s1",
      subscriptionId: "sub_1",
      nextBillingDate: "2026-12-09",
      specialPrice: false,
      grandfathered: false,
      cancelable: true,
      features: ["A program written for you", "Message me in the app", "Weekly check-ins", "Meet prep"],
      slug: "complete",
      includedCalls: 0,
    },
    options: [
      card("free", "Free app", "free", 0, { kind: "cancel", action: "cancel_later", timing: "period_end" }, { lose: ["Message me in the app"] }),
      card("complete", "Complete Online Coaching", "coaching", 13000, { kind: "current", action: null, timing: null, available: false, blocked: "Your current plan" }),
      card("plus", "Coaching Plus", "coaching", 24900, { kind: "upgrade", action: "swap_now", timing: "now" }, { gain: ["Two private 30-minute video calls each billing month"] }),
    ],
    open: null,
    history: [{ id: "h1", title: "Free app → Complete Online Coaching", detail: "Done Jun 9", at: "2026-06-09T00:00:00Z", source: null }],
    configIssues: [],
    canChange: true,
    preview: false,
    endedInStripe: false,
    tier: "coaching",
    access: { state: "client" },
    offer: null,
    agreementVersion: "3.0",
    approval: null,
    ...over,
  };
}

const render = (v: PlanView, who: "client" | "admin" = "client") =>
  renderToStaticMarkup(createElement(PlanManager, { view: v, api, who, onChanged: () => {} }));

describe("Manage plan renders every state", () => {
  it("a coaching client: the plan, the price, next payment, the other plans with what changes", () => {
    const html = render(view());
    expect(html).toContain("Complete Online Coaching");
    expect(html).toContain("$130 a month + tax · next payment Dec 9");
    expect(html).toContain('data-plan-option="plus"');
    expect(html).toContain("Two private 30-minute video calls each billing month");
    expect(html).toContain("Upgrade");
    expect(html).toContain("Move to the free app");
    expect(html).toContain("Happens when your paid month ends");
    // the current plan isn't offered as a change
    expect(html).not.toContain('data-plan-option="complete"');
  });

  it("a free member", () => {
    const html = render(
      view({
        current: { ...view().current, family: "free", name: "Free app", priceCents: 0, managed: "free", status: "free", saleId: null, subscriptionId: null, nextBillingDate: null, slug: "free" },
        options: [card("complete", "Complete Online Coaching", "coaching", 13000, { kind: "start", action: "checkout", timing: "after_payment" })],
      }),
    );
    expect(html).toContain(">Free<");
    expect(html).toContain("Start Complete Online Coaching");
  });

  it("a custom arrangement asks the coach", () => {
    const html = render(
      view({
        current: { ...view().current, family: "custom", name: "Online Coaching — Legacy $65", managed: "custom", status: "custom", priceCents: null, customReason: "Your plan is set up with your coach, so changes go through them." },
        options: [card("plus", "Coaching Plus", "coaching", 24900, { kind: "request", action: "request", timing: null })],
      }),
    );
    expect(html).toContain("Set up with your coach");
    expect(html).toContain("Ask about this plan");
    expect(html).toContain('data-plan-custom');
  });

  it("ending, failing, scheduled and waiting on payment each say what to do", () => {
    expect(render(view({ current: { ...view().current, status: "ending" } }))).toContain("Keep my plan");
    expect(render(view({ current: { ...view().current, status: "past_due" } }))).toContain("data-plan-past-due");
    const scheduled = render(view({ open: { id: "o1", status: "scheduled", kind: "downgrade", toLabel: "Nutrition Coaching", fromLabel: "Complete Online Coaching", effectiveAt: "2026-12-09T18:00:00Z", payUrl: null } }));
    expect(scheduled).toContain("Switching to Nutrition Coaching on Dec 9");
    expect(scheduled).toContain("data-plan-undo");
    const cancel = render(view({ open: { id: "o1", status: "scheduled", kind: "cancel", toLabel: "Free app", fromLabel: "Complete Online Coaching", effectiveAt: "2026-12-09T18:00:00Z", payUrl: null } }));
    expect(cancel).toContain("Complete Online Coaching ends Dec 9");
    expect(cancel).toContain("Keep my plan");
    const waiting = render(view({ open: { id: "o1", status: "awaiting_payment", kind: "upgrade", toLabel: "Coaching Plus", fromLabel: "Complete Online Coaching", effectiveAt: null, payUrl: "https://invoice.stripe.com/i/x" } }));
    expect(waiting).toContain("Finish payment");
    expect(waiting).toContain("Cancel upgrade");
  });

  it("a coach previewing sees everything and changes nothing; the admin's card hides the client's Keep", () => {
    const preview = render(view({ canChange: false, preview: true }));
    expect(preview).toContain("disabled");
    expect(render(view({ current: { ...view().current, status: "ending" } }), "admin")).not.toContain("Keep my plan");
    expect(render(view(), "admin")).toContain("Change their plan");
  });

  it("an offer from the coach shows its terms and the exact words they agree to", () => {
    const html = render(
      view({
        offer: {
          id: "o1",
          fromName: "Online Coaching — Legacy $65",
          fromPriceCents: 6500,
          toName: "Complete Online Coaching",
          toPriceCents: 13000,
          timing: "period_end",
          expiresAt: "2026-12-08T00:00:00Z",
          note: "Moving everyone onto Complete",
          hasSubscription: true,
          nextBillingDate: "2026-12-09",
          grandfathered: true,
          lines: ["Complete Online Coaching: $130 a month, plus tax.", "Your $65 price is one you keep only on Online Coaching — Legacy $65. Accepting ends it, and it can't be brought back later."],
          consentText: "I accept Complete Online Coaching at $130 a month plus tax, switching on Dec 9, 2026. My $65 price on Online Coaching — Legacy $65 ends.",
        },
      }),
    );
    expect(html).toContain("data-plan-offer");
    expect(html).toContain("An offer from your coach");
    expect(html).toContain("can&#x27;t be brought back later");
    expect(html).toContain("My $65 price on Online Coaching — Legacy $65 ends.");
    expect(html).toContain("No thanks");
  });

  it("a member waiting on the coach is told where it stands; an approved one is told to pick", () => {
    expect(render(view({ tier: "self_serve", access: { state: "applied", at: "2026-11-20T00:00:00Z" } }))).toContain("Your application is with your coach");
    expect(render(view({ tier: "self_serve", access: { state: "approved", packageId: null, packageName: "Complete Online Coaching", expiresAt: "2026-12-20T00:00:00Z" } }))).toContain(
      "Your coach approved you for Complete Online Coaching",
    );
  });
});
