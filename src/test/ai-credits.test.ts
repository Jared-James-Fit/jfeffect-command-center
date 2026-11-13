import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  FEATURE_COSTS,
  canAfford,
  checkoutReturnUrls,
  chipLabel,
  creditsBreakdown,
  packByKey,
  packLookupKey,
  perCredit,
  resetDay,
  resetLine,
  safeReturnPath,
  type CreditState,
} from "@/lib/ai-credits/packs";
import { parseMealEstimate } from "@/lib/ai-credits/meal-estimate";
import { normalizeRevenue, type CreditSaleRowIn } from "@/lib/business-books";
import { DEFAULT_ROUTES } from "@/lib/ai/routing";
import { estimateCost } from "@/lib/ai/model-client.server";

const state = (over: Partial<CreditState> = {}): CreditState => ({
  tier: "member",
  unlimited: false,
  allowance: 30,
  used: 0,
  allowance_left: 30,
  extra: 0,
  left: 30,
  period_start: "2026-11-01",
  resets_on: "2026-12-01",
  costs: { meal_estimate: 1 },
  ...over,
});

describe("AI credit costs", () => {
  it("match the database's ai_credit_cost, feature by feature", () => {
    const sql = readFileSync("supabase/migrations/20270313090000_ai_credits.sql", "utf8");
    const body = sql.slice(
      sql.indexOf("FUNCTION public.ai_credit_cost"),
      sql.indexOf("FUNCTION public.ai_credit_period_start"),
    );
    const inSql = Object.fromEntries(
      [...body.matchAll(/WHEN '([a-z_]+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(inSql).toEqual(FEATURE_COSTS);
  });

  it("runs the AI food log on the OpenAI key, never Lovable credits", () => {
    expect(DEFAULT_ROUTES.meal_estimate.models.every((m) => m.startsWith("openai:"))).toBe(true);
    expect(DEFAULT_ROUTES.meal_estimate.models[0]).toBe("openai:gpt-5-mini");
  });

  it("prices a GPT-5 mini call so the coach sees the real cost", () => {
    // 300 in, 1,000 out (reasoning included) at $0.25 / $2 per million
    expect(estimateCost("openai:gpt-5-mini", 300, 1000)).toBe(0.002);
  });
});

describe("credit packs", () => {
  it("get cheaper per credit as they get bigger, and keep a healthy margin after Stripe and the AI", () => {
    const per = CREDIT_PACKS.map((p) => p.amountCents / p.credits);
    expect(per).toEqual([...per].sort((a, b) => b - a));
    for (const p of CREDIT_PACKS) {
      const total = p.amountCents * 1.05; // GST on top
      const stripe = total * 0.029 + 30;
      const aiMax = p.credits * 0.3; // C$0.003 a credit, the most a call costs
      const kept = p.amountCents - stripe - aiMax;
      expect(kept / p.amountCents).toBeGreaterThan(0.7);
    }
  });

  it("are found by key, with a lookup key that changes when the price does", () => {
    expect(packByKey("p300")?.credits).toBe(300);
    expect(packByKey("nope")).toBeNull();
    expect(packLookupKey({ key: "p300", credits: 300, amountCents: 699 })).toBe(
      "jf_ai_credits_300_699_cad",
    );
    expect(packLookupKey({ key: "p300", credits: 300, amountCents: 799 })).not.toBe(
      packLookupKey(packByKey("p300")!),
    );
  });

  it("say their price per credit", () => {
    expect(perCredit({ credits: 100, amountCents: 299 })).toBe("3¢ a credit");
    expect(perCredit({ credits: 300, amountCents: 699 })).toBe("2.3¢ a credit");
    expect(perCredit({ credits: 1000, amountCents: 1499 })).toBe("1.5¢ a credit");
  });
});

describe("what the app says about credits", () => {
  it("staff are unlimited and never see a count", () => {
    const s = state({
      tier: "staff",
      unlimited: true,
      allowance: null,
      allowance_left: null,
      left: null,
    });
    expect(canAfford(s, "meal_estimate")).toBe(true);
    expect(chipLabel(s)).toBeNull();
    expect(creditsBreakdown(s)).toBe("Unlimited for staff");
    expect(resetLine(s)).toBe("");
  });

  it("counts what's left, the month's free ones first", () => {
    const s = state({ used: 28, allowance_left: 2, extra: 100, left: 102 });
    expect(chipLabel(s)).toBe("102 left");
    expect(creditsBreakdown(s)).toBe("2 of 30 free this month · 100 bought");
    expect(resetLine(s)).toBe("Free credits reset Dec 1. Bought credits never expire.");
  });

  it("is out once nothing is left", () => {
    const s = state({ used: 30, allowance_left: 0, left: 0 });
    expect(canAfford(s, "meal_estimate")).toBe(false);
    expect(chipLabel(s)).toBe("0 left");
    expect(creditsBreakdown(s)).toBe("0 of 30 free this month");
  });

  it("reads the reset day as a calendar date, whatever the phone's zone", () => {
    expect(resetDay("2027-01-01")).toBe("Jan 1");
  });
});

describe("Stripe return", () => {
  it("only ever goes back inside the app", () => {
    expect(safeReturnPath("/portal/nutrition?tab=log#x")).toBe("/portal/nutrition?tab=log");
    expect(safeReturnPath("https://evil.example")).toBe("/portal/account");
    expect(safeReturnPath("//evil.example/x")).toBe("/portal/account");
    expect(safeReturnPath(undefined)).toBe("/portal/account");
  });

  it("leaves Stripe's session placeholder unencoded and drops an old result", () => {
    const u = checkoutReturnUrls(
      "https://jfeffect.com",
      "/portal/nutrition?credits=done&cs=cs_old&tab=log",
    );
    expect(u.success).toBe(
      "https://jfeffect.com/portal/nutrition?tab=log&credits=done&cs={CHECKOUT_SESSION_ID}",
    );
    expect(u.cancel).toBe("https://jfeffect.com/portal/nutrition?tab=log&credits=cancelled");
  });
});

describe("AI food log answer", () => {
  it("reads a fenced or wrapped JSON object and rounds it", () => {
    const r = parseMealEstimate(
      'Here:\n```json\n{"name":"Eggs and toast","calories":412.6,"protein_g":21.2,"carbs_g":30,"fat_g":22}\n```',
      "2 eggs, toast",
    );
    expect(r).toEqual({
      name: "Eggs and toast",
      calories: 413,
      protein_g: 21,
      carbs_g: 30,
      fat_g: 22,
    });
  });

  it("refuses an answer with nothing in it, so the credit goes back", () => {
    expect(parseMealEstimate("I can't tell from that.", "x")).toBeNull();
    expect(
      parseMealEstimate('{"name":"?","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}', "x"),
    ).toBeNull();
  });

  it("keeps what they typed as the name when the model gives none, and caps silly numbers", () => {
    const r = parseMealEstimate(
      '{"calories":99999,"protein_g":-5,"carbs_g":"40","fat_g":10}',
      "big bowl of rice",
    );
    expect(r).toEqual({
      name: "big bowl of rice",
      calories: 10000,
      protein_g: 0,
      carbs_g: 40,
      fat_g: 10,
    });
  });
});

describe("credit packs in the books", () => {
  const sale = (over: Partial<CreditSaleRowIn> = {}): CreditSaleRowIn => ({
    id: "s1",
    credits: 300,
    amount_minor: 699,
    tax_minor: 35,
    total_minor: 734,
    refunded_minor: 0,
    refunded_at: null,
    currency: "CAD",
    paid_at: "2026-11-13T18:00:00Z",
    stripe_mode: "live",
    stripe_payment_intent_id: "pi_1",
    stripe_checkout_session_id: "cs_1",
    client_name: "Devin",
    ...over,
  });

  it("count a pack as revenue with its GST, and a refund back out", () => {
    const out = normalizeRevenue(
      [],
      [],
      [
        sale(),
        sale({ id: "s2", refunded_minor: 734, refunded_at: "2026-11-20T00:00:00Z" }),
        sale({ id: "t", stripe_mode: "test" }),
      ],
    );
    expect(out.map((r) => [r.id, r.kind, r.grossMinor, r.taxMinor, r.date])).toEqual([
      ["ai-credits:s1", "payment", 734, 35, "2026-11-13"],
      ["ai-credits:s2", "payment", 734, 35, "2026-11-13"],
      ["ai-credits-refund:s2", "refund", 734, 35, "2026-11-20"],
    ]);
    expect(out[0].product).toBe("AI credits · 300");
    expect(out[0].clientName).toBe("Devin");
  });
});
