import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PlanApi } from "@/components/plans/plan-manager";
import type { PlanView } from "@/lib/plans/plans.functions";
import { NATIVE_PURCHASE_BLOCKED, isBuyPath, plansForShell, promosForShell, showPlanPrice } from "@/lib/native-purchases";

// Premium (and every other digital product) is sold on the web only: the iPhone app shows no
// purchase button, price or link to buy one, and members who already have it see it normally.
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/platform", () => ({ isNative: () => platform.native }));

const { PlanManager } = await import("@/components/plans/plan-manager");
const { UpgradeCTA } = await import("@/components/upgrade-cta");

const api: PlanApi = {
  preview: async () => {
    throw new Error("not in this test");
  },
  confirm: async () => ({ result: "applied", changeId: "x" }),
  undo: async () => null,
  keep: async () => null,
};

const card = (slug: string, name: string, family: any, priceCents: number, transition: any) => ({
  slug, name, family, tagline: null, bestFor: null, priceCents,
  features: ["A program written for you"], includedCalls: 0, recommended: false, gain: [], lose: [],
  transition: { available: true, blocked: null, configProblem: null, ...transition },
});

const freeMember = (): PlanView => ({
  clientId: "c1", firstName: "Devin",
  current: { family: "free", name: "Free app", priceCents: 0, managed: "free", customReason: null, status: "free", saleId: null, subscriptionId: null, nextBillingDate: null, specialPrice: false, grandfathered: false, cancelable: false, features: [], slug: "free", includedCalls: 0 },
  options: [
    card("membership", "JF Membership", "membership", 2900, { kind: "start", action: "checkout", timing: "after_payment", available: false, blocked: NATIVE_PURCHASE_BLOCKED }),
    card("complete", "Complete Online Coaching", "coaching", 13000, { kind: "start", action: "checkout", timing: "after_payment", available: false, blocked: NATIVE_PURCHASE_BLOCKED }),
  ],
  open: null, history: [], configIssues: [], canChange: true, preview: false, endedInStripe: false,
  tier: "self_serve", access: { state: "none" } as any, offer: null, agreementVersion: "3.0", approval: null,
} as unknown as PlanView);

const payingClient = (): PlanView => {
  const v = freeMember();
  return {
    ...v,
    current: { ...v.current, family: "coaching", name: "Complete Online Coaching", priceCents: 13000, managed: "stripe", status: "active", slug: "complete", cancelable: true },
    options: [
      card("free", "Free app", "free", 0, { kind: "cancel", action: "cancel_later", timing: "period_end" }),
      card("complete", "Complete Online Coaching", "coaching", 13000, { kind: "current", action: null, timing: null, available: false, blocked: "Your current plan" }),
      card("plus", "Coaching Plus", "coaching", 24900, { kind: "upgrade", action: "swap_now", timing: "now", available: false, blocked: NATIVE_PURCHASE_BLOCKED }),
    ],
  } as unknown as PlanView;
};

const render = (v: PlanView) => renderToStaticMarkup(createElement(PlanManager, { view: v, api, who: "client", onChanged: () => {} }));

describe("buying is web only: pure rules", () => {
  it("knows which links sell something", () => {
    for (const p of ["/premium", "/membership", "/coaching", "/coaching?from=crew", "/join", "/pay/abc", "/portal/plan", "/portal/upgrade", "/portal/membership", "/checkout", "/credits"]) {
      expect(isBuyPath(p), p).toBe(true);
    }
    for (const p of ["/portal/workouts", "/portal/programs", "/coaching-agreement", "/portal/community", "/athletes/x", "", null]) {
      expect(isBuyPath(p as any), String(p)).toBe(false);
    }
  });

  it("Crew promos that point at something to buy are dropped in the app, kept on the web", () => {
    const promos = [
      { id: "a", cta_path: "/premium" },
      { id: "b", cta_path: "/portal/programs" },
      { id: "c", cta_path: "/coaching" },
    ];
    expect(promosForShell(promos, true).map((p) => p.id)).toEqual(["b"]);
    expect(promosForShell(promos, false).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("plans that need a purchase are dropped in the app; switching down stays", () => {
    const v = payingClient();
    expect(plansForShell(v.options, true).map((o) => o.slug)).toEqual(["free", "complete"]);
    expect(plansForShell(v.options, false)).toHaveLength(3);
  });

  it("a price shows only for the plan the person is on", () => {
    const v = payingClient();
    expect(showPlanPrice(v.options[1], true)).toBe(true);
    expect(showPlanPrice(v.options[2], true)).toBe(false);
    expect(showPlanPrice(v.options[2], false)).toBe(true);
  });

  it("the refusal never points at another place to buy", () => {
    expect(NATIVE_PURCHASE_BLOCKED).not.toMatch(/jfeffect|web|website|online|browser/i);
  });
});

describe("the iPhone app never sells (rendered)", () => {
  it("Your plan lists no paid plan, no price and no buy button for a free member in the app", () => {
    platform.native = true;
    const html = render(freeMember());
    expect(html).not.toContain("data-plan-option");
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toMatch(/Start |Upgrade|Subscribe|Buy /);
    expect(html).not.toMatch(/jfeffect\.com/);
  });

  it("a paying client in the app sees their own plan and its price, and can switch down, but is offered no upgrade or other price", () => {
    platform.native = true;
    const html = render(payingClient());
    expect(html).toContain("$130 a month");
    expect(html).toContain('data-plan-option="free"');
    expect(html).not.toContain('data-plan-option="plus"');
    expect(html).not.toContain("$249");
    expect(html).not.toMatch(/jfeffect\.com/);
  });

  it("on the web the same plans, prices and buttons are all there", () => {
    platform.native = false;
    const html = render(freeMember());
    expect(html).toContain('data-plan-option="membership"');
    expect(html).toContain("$29");
    expect(html).toContain("Start JF Membership");
  });

  it("a locked-feature card has no upgrade button or link in the app, only the account note", () => {
    platform.native = true;
    for (const inline of [true, false]) {
      const html = renderToStaticMarkup(createElement(UpgradeCTA, { inline }));
      expect(html).not.toContain("<a");
      expect(html).not.toMatch(/Upgrade<|See plans/);
    }
  });
});

describe("Premium is shown normally to people who have it", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the Premium screens never check the platform: no gate, so a holder sees everything in the app", () => {
    for (const p of ["src/components/premium/premium-ui.tsx", "src/lib/premium/premium.ts", "src/lib/premium/premium.functions.ts"]) {
      expect(read(p), p).not.toMatch(/isNative|isNativePlatform|@\/platform/);
    }
  });

  it("nothing in the Premium code sells it: no price, checkout or buy link", () => {
    for (const p of ["src/components/premium/premium-ui.tsx", "src/lib/premium/premium.ts"]) {
      expect(read(p), p).not.toMatch(/checkout|\$\d|priceCents|Subscribe|Buy Premium|Upgrade to Premium/i);
    }
  });

  it("Crew promos are filtered for the shell where they're shown", () => {
    expect(read("src/components/community/crew-promo.tsx")).toContain("promosForShell(");
  });
});
