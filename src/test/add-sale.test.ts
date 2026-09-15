import { describe, it, expect } from "vitest";
import {
  pickableProducts, productAssignEligibility, isAssignableProduct, searchProducts,
  productToOfferLike, blankCustomSale, customSalePriceCents, customSalePaymentStructure,
  customSaleToProductInput, validateCustomSale,
} from "@/lib/add-sale";

const base = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Online Coaching",
  status: "Active",
  active: true,
  archived: false,
  is_one_off: false,
  price_cents: 18000,
  currency: "cad",
  product_type: "Coaching",
  payment_structure: "Monthly subscription",
  stripe_price_id: "price_123",
};

describe("product picker eligibility", () => {
  it("shows an active assignable product", () => {
    expect(isAssignableProduct(base)).toBe(true);
  });

  it("hides draft products from assignment", () => {
    expect(productAssignEligibility({ ...base, status: "Draft", active: false }).reason).toBe("Draft");
  });

  it("hides archived products from assignment", () => {
    expect(productAssignEligibility({ ...base, status: "Archived" }).reason).toBe("Archived");
  });

  it("does not require public self-purchase visibility", () => {
    expect(isAssignableProduct({ ...base, is_member_facing: false, visible_on_sales_page: false })).toBe(true);
  });

  it("flags products with no Stripe pricing instead of pretending they work", () => {
    const el = productAssignEligibility({ ...base, stripe_price_id: null, payment_link_url: null });
    expect(el.assignable).toBe(false);
    expect(el.reason).toMatch(/pricing/i);
  });

  it("keeps one-off client sales out of the picker", () => {
    const list = pickableProducts([base, { ...base, id: "x", is_one_off: true }]);
    expect(list).toHaveLength(1);
  });

  it("does not report empty when valid products exist", () => {
    expect(pickableProducts([base]).length).toBeGreaterThan(0);
  });
});

describe("product search", () => {
  const items = [
    { ...base, id: "a", name: "Online Coaching — 12 Week Prep" },
    { ...base, id: "b", name: "Online Coaching" },
    { ...base, id: "c", name: "Custom Program", description: "coaching add-on" },
  ];
  it("ranks the exact name match first", () => {
    expect(searchProducts(items, "Online Coaching")[0]!.id).toBe("b");
  });
  it("matches description and type", () => {
    expect(searchProducts(items, "add-on").map((i) => i.id)).toEqual(["c"]);
  });
  it("returns everything with an empty query", () => {
    expect(searchProducts(items, "")).toHaveLength(3);
  });
});

describe("offer mapping", () => {
  it("maps a product row into the canonical purchase offer shape", () => {
    const o = productToOfferLike({ ...base, sessions_included: 16 });
    expect(o.full_payable_amount).toBe(180);
    expect(o.currency).toBe("CAD");
    expect(o.stripe_price_id).toBe("price_123");
    expect(o.sessions_included).toBe(16);
  });
});

describe("custom sale", () => {
  it("requires a name and a price", () => {
    expect(validateCustomSale(blankCustomSale())).toMatch(/name/i);
    expect(validateCustomSale({ ...blankCustomSale(), name: "X" })).toMatch(/price/i);
  });

  it("builds a one-time sale", () => {
    const d = { ...blankCustomSale(), name: "16 Sessions", priceText: "400" };
    expect(validateCustomSale(d)).toBeNull();
    expect(customSalePriceCents(d)).toBe(40000);
    expect(customSalePaymentStructure(d)).toBe("One-time payment");
    expect(customSaleToProductInput(d).checkoutMode).toBe("payment");
  });

  it("builds a recurring sale with a fixed payment count", () => {
    const d = {
      ...blankCustomSale(), name: "PT Pack", priceText: "200",
      paymentType: "recurring" as const, interval: "biweekly" as const,
      durationMode: "fixed" as const, numberOfPayments: "4",
    };
    expect(validateCustomSale(d)).toBeNull();
    expect(customSalePaymentStructure(d)).toContain("4 payments");
    const input = customSaleToProductInput(d);
    expect(input.checkoutMode).toBe("subscription");
    expect(input.billingFrequency).toBe("biweekly");
  });

  it("carries included session credits through the canonical fields", () => {
    const d = { ...blankCustomSale(), name: "PT", priceText: "400", sessionsIncluded: "16" };
    const input = customSaleToProductInput(d);
    expect(input.sessionsIncluded).toBe(16);
    expect(input.sessionFulfillment).toBe("first_payment");
  });

  it("never creates a Stripe price for a free sale", () => {
    const d = { ...blankCustomSale(), name: "Comp", paymentType: "free" as const };
    expect(validateCustomSale(d)).toBeNull();
    expect(customSaleToProductInput(d).generateStripeLink).toBe(false);
  });

  it("defaults to a one-off sale, not a catalogue product", () => {
    const d = { ...blankCustomSale(), name: "X", priceText: "50" };
    expect(customSaleToProductInput(d).isOneOff).toBe(true);
    expect(customSaleToProductInput({ ...d, saveAsProduct: true }).isOneOff).toBe(false);
  });
});
