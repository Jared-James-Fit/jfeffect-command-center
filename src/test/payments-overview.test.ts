import { describe, expect, it } from "vitest";
import { countActiveDiscountCodes } from "@/lib/payments-overview";

describe("countActiveDiscountCodes", () => {
  it("counts only active internal discount records", () => {
    expect(
      countActiveDiscountCodes([
        { id: "first50", status: "active" },
        { id: "expired", status: "expired" },
        { id: "inactive", status: "inactive" },
        { id: "missing", status: null },
      ]),
    ).toBe(1);
  });

  it("returns zero for an empty or non-active result set", () => {
    expect(countActiveDiscountCodes([])).toBe(0);
    expect(countActiveDiscountCodes([{ id: "draft", status: "draft" }])).toBe(0);
  });
});
