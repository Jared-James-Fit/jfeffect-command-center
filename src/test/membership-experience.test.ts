import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const programLibrary = readFileSync("src/routes/_authenticated/admin/program-library.tsx", "utf8");
const membershipLibraryFns = readFileSync("src/lib/membership-library.functions.ts", "utf8");
const support = readFileSync("src/routes/_authenticated/m/support.tsx", "utf8");
const nutrition = readFileSync("src/components/nutrition/NutritionDashboard.tsx", "utf8");
const macroCalculator = readFileSync("src/components/nutrition/MacroCalculatorDialog.tsx", "utf8");
const memberTargets = readFileSync("src/lib/nutrition-targets/member-targets.functions.ts", "utf8");

describe("membership experience", () => {
  it("organizes Membership App programs by an explicit tag instead of title markers", () => {
    expect(programLibrary).toContain('const MEMBERSHIP_PROGRAM_TAG = "membership-app"');
    expect(programLibrary).toContain("Membership App");
    expect(programLibrary).toContain('chip.kind === "membership"');
    expect(membershipLibraryFns).toContain("ensureMembershipProgramTag");
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
