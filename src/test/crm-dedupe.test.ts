import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone } from "@/lib/crm.functions";

/**
 * upsertApplicantClient matches an existing CRM client on the normalized
 * email first, then the normalized phone. These are the exact keys it uses,
 * so equivalent inputs must collapse to one value.
 */
describe("CRM applicant dedupe keys", () => {
  it("normalizes email case and whitespace", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeEmail("jane.doe@example.com")).toBe("jane.doe@example.com");
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("normalizes phone formatting to digits", () => {
    expect(normalizePhone("(204) 229-4913")).toBe("2042294913");
    expect(normalizePhone("204.229.4913")).toBe("2042294913");
    expect(normalizePhone("+1 204 229 4913")).toBe("12042294913");
  });

  it("rejects phone values too short to dedupe on", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("collapses differently formatted duplicates to the same key", () => {
    expect(normalizeEmail("A@B.com")).toBe(normalizeEmail("a@b.com"));
    expect(normalizePhone("204-229-4913")).toBe(normalizePhone("(204)2294913"));
  });
});
