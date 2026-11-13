import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const programLibrary = readFileSync("src/route-pages/_authenticated/admin/program-library.tsx", "utf8");
const membershipLibraryFns = readFileSync("src/lib/membership-library.functions.ts", "utf8");
const support = readFileSync("src/routes/_authenticated/portal/support.tsx", "utf8");
const nutrition = readFileSync("src/components/nutrition/NutritionDashboard.tsx", "utf8");
const macroCalculator = readFileSync("src/components/nutrition/MacroCalculatorDialog.tsx", "utf8");
const memberTargets = readFileSync("src/lib/nutrition-targets/member-targets.functions.ts", "utf8");

describe("membership experience", () => {
  it("membership programs are the one library's Membership app view, read from their listing, never a tag", () => {
    expect(programLibrary).toContain("membershipByTemplate(");
    expect(programLibrary).toContain("MembershipListingSheet");
    expect(programLibrary).not.toContain("MEMBERSHIP_PROGRAM_TAG");
    expect(membershipLibraryFns).not.toContain("ensureMembershipProgramTag");
    // a listing whose program is gone is never offered to members
    expect(membershipLibraryFns).toContain('.not("source_template_id", "is", null)');
  });

  it("keeps support as a message-style conversation", () => {
    expect(support).toContain("JF Effect Support");
    expect(support).toContain("Message support…");
    expect(support).toContain("rounded-br-md bg-primary");
    expect(support).toContain("rounded-bl-md border border-border bg-card");
  });

  it("labels member nutrition as suggested and includes the disclaimer", () => {
    expect(nutrition).toContain("Suggested Nutrition Targets");
    expect(nutrition).toContain("general educational estimates");
    expect(macroCalculator).toContain("Suggested targets only");
    expect(macroCalculator).toContain("not medical advice");
  });

  it("does not require approval for member-created suggested targets", () => {
    expect(memberTargets).toContain("pending_review: false");
    expect(memberTargets).toContain("if (data) return data;");
  });
});
