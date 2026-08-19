import { describe, expect, it } from "vitest";
import {
  assertFirst50Assignment,
  type First50Assignment,
  type First50DiscountRecord,
} from "@/lib/first50-policy";

const discount: First50DiscountRecord = {
  public_code: "FIRST50",
  category: "promotion",
  discount_type: "fixed",
  discount_value: 50,
  subscription_duration: "once",
  status: "active",
  eligible_product_ids: ["11111111-1111-4111-8111-111111111111"],
  applies_to_all_products: false,
  pairing_allowed: false,
};

const assignment: First50Assignment = {
  offer_id: "11111111-1111-4111-8111-111111111111",
  currency: "cad",
  price_cents: 18_000,
  payment_structure: "Monthly recurring",
};

const invalidCases: Array<[First50DiscountRecord, First50Assignment]> = [
  [{ ...discount, discount_value: 49 }, assignment],
  [{ ...discount, subscription_duration: "forever" }, assignment],
  [{ ...discount, pairing_allowed: true }, assignment],
  [discount, { ...assignment, currency: "usd" }],
  [discount, { ...assignment, price_cents: 13_000 }],
  [discount, { ...assignment, payment_structure: "One time" }],
  [{ ...discount, eligible_product_ids: [] }, assignment],
];

describe("FIRST50 assignment policy", () => {
  it("accepts only the approved CAD $180 monthly product assignment", () => {
    expect(() => assertFirst50Assignment(discount, assignment)).not.toThrow();
  });

  it.each(invalidCases)(
    "rejects every ineligible configuration",
    (invalidDiscount, invalidAssignment) => {
      expect(() => assertFirst50Assignment(invalidDiscount, invalidAssignment)).toThrow();
    },
  );
});
