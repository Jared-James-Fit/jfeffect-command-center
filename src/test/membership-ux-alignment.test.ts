import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const membershipLeaf = readFileSync("src/components/admin/membership-leaf.tsx", "utf8");
const programLibrary = readFileSync("src/route-pages/_authenticated/admin/program-library.tsx", "utf8");
const programming = readFileSync("src/routes/_authenticated/admin/programming.tsx", "utf8");
// JF Effect Support: its own screen and the same conversation in Messages
const support = ["src/routes/_authenticated/portal/support.tsx", "src/components/support/support-conversation.tsx", "src/lib/member-support.ts"]
  .map((f) => readFileSync(f, "utf8")).join("\n");
const nutrition = readFileSync("src/components/nutrition/NutritionDashboard.tsx", "utf8");
const calc = readFileSync("src/components/nutrition/MacroCalculatorDialog.tsx", "utf8");
const macroCalc = calc;

describe("membership UX organization", () => {
  it("keeps membership admin leaves aligned with the main admin layout", () => {
    expect(membershipLeaf).toContain("overflow-x-hidden p-4 md:p-6");
    expect(membershipLeaf).toContain('backTo="/admin/membership"');
  });

  it("membership programs open as the program library's Membership app view, not a second library", () => {
    expect(programLibrary).toContain('initialAudience === "membership" ? "membership" : "all"');
    expect(programming).toContain('audience === "membership"');
    expect(programming).not.toContain('value: "browse"');
  });

  it("renders member support as a message-style conversation", () => {
    expect(support).toContain("JF Effect Support");
    expect(support).toContain("Message support…");
    expect(support).toContain("rounded-br-md bg-primary");
    // the team's replies read like the coach chat's incoming bubbles
    expect(support).toContain("rounded-bl-md bg-secondary");
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
    // anchored to the visible screen like the coach chat: the box sits right above the keyboard
    expect(support).toContain('top: "calc(var(--vv-top, 0px) + var(--app-top-chrome, 0px))"');
    expect(support).toContain('var(--bottom-nav-clearance, 0px)');
  });
});
