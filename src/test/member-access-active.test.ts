import { describe, it, expect } from "vitest";
import { isMemberAccessActive } from "@/lib/memberAccess";

describe("isMemberAccessActive — lifecycle statuses", () => {
  it("keeps access for a member who cancelled but is paid through the period", () => {
    expect(
      isMemberAccessActive({ subscription_status: "Active (Cancels at period end)", status: "Active" }),
    ).toBe(true);
  });

  it("still allows plain active and trialing members", () => {
    expect(isMemberAccessActive({ subscription_status: "Active", status: "Active" })).toBe(true);
    expect(isMemberAccessActive({ subscription_status: "Trialing", status: "Active" })).toBe(true);
  });

  it("denies once the lifecycle marks the member cancelled", () => {
    expect(isMemberAccessActive({ subscription_status: "Cancelled", status: "Cancelled" })).toBe(false);
  });

  it("denies a cancels-at-period-end member whose access end date has passed", () => {
    expect(
      isMemberAccessActive({
        subscription_status: "Active (Cancels at period end)",
        status: "Active",
        access_end_date: "2000-01-01T00:00:00Z",
      }),
    ).toBe(false);
  });
});
