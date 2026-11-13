import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreditDetail } from "@/lib/ai-credits/packs";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/platform", () => ({ isNative: () => platform.native }));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => ({}),
}));
vi.mock("@/lib/ai-credits.functions", () => ({
  getAiCredits: vi.fn(),
  startAiCreditsCheckout: vi.fn(),
  confirmAiCreditsCheckout: vi.fn(),
}));
vi.mock("@/lib/client-impersonation", () => ({ useViewingAsClient: () => false }));
vi.mock("@/lib/client-pov-args", () => ({ usePovArgs: () => ({}) }));
vi.mock("@/hooks/use-charges-tax", () => ({ useChargesTax: () => true }));

const { AiCreditsChip, AiCreditsPanel } = await import("@/components/ai-credits/ai-credits");

const detail = (over: Partial<CreditDetail> = {}): CreditDetail => ({
  tier: "member",
  unlimited: false,
  allowance: 30,
  used: 12,
  allowance_left: 18,
  extra: 0,
  left: 18,
  period_start: "2026-11-01",
  resets_on: "2026-12-01",
  costs: { meal_estimate: 1 },
  uses_this_month: { meal_estimate: 12 },
  history: [],
  purchases: [],
  ...over,
});

const panel = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(AiCreditsPanel, props as any));

describe("AI credits on screen", () => {
  it("shows what's left, where it comes from, when it resets, and the packs before tax", () => {
    platform.native = false;
    const html = panel({ state: detail() });
    expect(html).toContain('data-ai-credits-left="true">18</span>');
    expect(html).toContain("18 of 30 free this month");
    expect(html).toContain(
      "Free credits reset Dec 1. Bought credits never expire. 1 credit = 1 AI food log.",
    );
    expect(html).toContain('data-ai-credits-pack="p300"');
    expect(html).toContain("$6.99");
    expect(html).toContain(" + tax");
    expect(html).toContain("Most popular");
    expect(html).toContain("This month: 12 AI food logs");
    // the packs are choices, never the brand red
    expect(html).not.toContain("bg-primary");
  });

  it("says they're out and when the free ones come back", () => {
    platform.native = false;
    const html = panel({ state: detail({ used: 30, allowance_left: 0, left: 0 }), out: true });
    expect(html).toContain("You&#x27;ve used this month&#x27;s AI credits");
    expect(html).toContain("Get more below, or your free credits come back Dec 1.");
  });

  it("never offers a purchase inside the App Store / Play builds", () => {
    platform.native = true;
    const html = panel({ state: detail({ used: 30, allowance_left: 0, left: 0 }), out: true });
    expect(html).not.toContain("data-ai-credits-packs");
    expect(html).toContain("Your free credits come back Dec 1.");
    expect(html).toContain("Purchases aren&#x27;t available in the app.");
    platform.native = false;
  });

  it("staff are unlimited: no count, no packs", () => {
    const s = detail({
      tier: "staff",
      unlimited: true,
      allowance: null,
      allowance_left: null,
      left: null,
    });
    expect(panel({ state: s })).toContain("Staff accounts have unlimited AI credits.");
    expect(
      renderToStaticMarkup(createElement(AiCreditsChip, { state: s, onClick: () => {} })),
    ).toBe("");
  });

  it("the chip beside the AI log turns amber at 0", () => {
    const some = renderToStaticMarkup(
      createElement(AiCreditsChip, { state: detail(), onClick: () => {} }),
    );
    expect(some).toContain("18 left");
    expect(some).not.toContain("text-warning");
    const none = renderToStaticMarkup(
      createElement(AiCreditsChip, {
        state: detail({ left: 0, allowance_left: 0, used: 30 }),
        onClick: () => {},
      }),
    );
    expect(none).toContain("0 left");
    expect(none).toContain("text-warning");
  });

  it("lists credits bought and given", () => {
    const html = panel({
      state: detail({
        extra: 300,
        left: 318,
        history: [
          {
            id: "a",
            kind: "purchase",
            credits: 300,
            note: "300 credits bought",
            at: "2026-11-10T12:00:00Z",
          },
          {
            id: "b",
            kind: "grant",
            credits: 50,
            note: "Given by your coach",
            at: "2026-11-02T12:00:00Z",
          },
        ],
      }),
    });
    expect(html).toContain("18 of 30 free this month · 300 bought");
    expect(html).toContain("Bought");
    expect(html).toContain("+300");
    expect(html).toContain("Given by your coach");
  });
});
