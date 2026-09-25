import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const membershipLeaf = readFileSync("src/components/admin/membership-leaf.tsx", "utf8");
const programLibrary = readFileSync("src/routes/_authenticated/admin/program-library.tsx", "utf8");
const programming = readFileSync("src/routes/_authenticated/admin/programming.tsx", "utf8");
const support = readFileSync("src/routes/_authenticated/m/support.tsx", "utf8");
const nutrition = readFileSync("src/components/nutrition/NutritionDashboard.tsx", "utf8");
const calc = readFileSync("src/components/nutrition/MacroCalculatorDialog.tsx", "utf8");
const macroCalc = calc;

describe("membership UX organization", () => {
  it("keeps membership admin leaves aligned with the main admin layout", () => {
    expect(membershipLeaf).toContain("overflow-x-hidden p-4 md:p-6");
    expect(membershipLeaf).toContain('backTo="/admin/membership"');
  });

  it("organizes membership programs with a real tag instead of a title marker", () => {
    expect(programLibrary).toContain('MEMBERSHIP_PROGRAM_TAG = "membership-app"');
    expect(programLibrary).toContain("Membership App");
    expect(programLibrary).toContain('chip.kind === "membership"');
    expect(programming).toContain('audience === "membership"');
  });

  it("renders member support as a message-style conversation", () => {
    expect(support).toContain("JF Effect Support");
    expect(support).toContain("Message support…");
    expect(support).toContain("rounded-br-md bg-primary");
    expect(support).toContain("rounded-bl-md border border-border bg-card");
  });

  it("labels membership nutrition as suggested and shows a safety disclaimer", () => {
    expect(nutrition).toContain("Suggested Nutrition Targets");
    expect(nutrition).toContain("general educational estimates");
    expect(calc).toContain("Suggested targets only");
    expect(calc).toContain("not medical advice");
  });

  it("keeps mobile nutrition and support controls unobstructed", () => {
    expect(macroCalc).toContain('safeTopClose className="h-[95dvh]');
    expect(macroCalc).toContain('SheetHeader className="py-4 pr-4 pl-28"');
    expect(support).toContain('h-[calc(100dvh-14.25rem)]');
    expect(support).toContain('sticky bottom-0 z-20');
  });
});
