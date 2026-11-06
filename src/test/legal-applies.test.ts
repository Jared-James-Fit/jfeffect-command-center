import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legalDocApplies, MEMBER_LEGAL_SLUGS } from "@/lib/legal-applies";

const FROM = 3;
const coaching = { tier: "coaching" as const, paidMembership: false };
const freeMember = { tier: "self_serve" as const, paidMembership: false };
const paidMember = { tier: "self_serve" as const, paidMembership: true };

describe("which legal documents someone is asked about", () => {
  it("everyone gets the general documents", () => {
    for (const v of [coaching, freeMember, paidMember, { tier: null, paidMembership: false }]) {
      expect(legalDocApplies({ slug: "terms-of-service", version_number: 3 }, v, FROM)).toBe(true);
      expect(legalDocApplies({ slug: "privacy-policy", version_number: 3 }, v, FROM)).toBe(true);
    }
  });

  it("a coaching client is never asked to accept the member documents", () => {
    for (const slug of MEMBER_LEGAL_SLUGS) {
      expect(legalDocApplies({ slug, version_number: 4 }, coaching, FROM)).toBe(false);
    }
  });

  it("a member is asked about the agreement only from the version the app signs", () => {
    expect(legalDocApplies({ slug: "membership-agreement", version_number: 2 }, freeMember, FROM)).toBe(false);
    expect(legalDocApplies({ slug: "membership-agreement", version_number: 3 }, freeMember, FROM)).toBe(true);
    expect(legalDocApplies({ slug: "membership-agreement", version_number: 4 }, freeMember, FROM)).toBe(true);
  });

  it("the recurring billing disclosure only for a paid membership", () => {
    expect(legalDocApplies({ slug: "recurring-billing-disclosure", version_number: 2 }, freeMember, FROM)).toBe(false);
    expect(legalDocApplies({ slug: "recurring-billing-disclosure", version_number: 2 }, paidMember, FROM)).toBe(true);
  });

  it("the legal status lookup applies the rule with the agreement's own signing version", () => {
    const legal = readFileSync("src/lib/legal.functions.ts", "utf8");
    expect(legal).toContain("legalDocApplies({ slug: d.slug, version_number: d.current_version.version_number }, viewer, IN_APP_SIGNING_FROM_VERSION)");
  });
});
