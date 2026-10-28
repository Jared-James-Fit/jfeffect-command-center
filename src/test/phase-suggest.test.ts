import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { phaseSourceText, suggestTargetsPhase } from "@/lib/nutrition-targets/phase-suggest";

describe("new nutrition targets pick their Phase / Goal", () => {
  it("the coach's pick on the request comes first, then the AI plan's, then the client's Goal answer", () => {
    expect(
      suggestTargetsPhase({
        requestPhase: "Fat Loss",
        aiPhase: "Recomp",
        goalAnswer: "Build muscle",
      }),
    ).toMatchObject({ phase: "Fat Loss", source: "request" });
    expect(suggestTargetsPhase({ aiPhase: "Recomp", goalAnswer: "Build muscle" })).toMatchObject({
      phase: "Recomp",
      source: "ai",
    });
    expect(suggestTargetsPhase({ goalAnswer: "Fat Loss" })).toMatchObject({
      phase: "Fat Loss",
      source: "form",
    });
    expect(suggestTargetsPhase({ goalAnswer: "Lose body fat" })).toMatchObject({
      phase: "Fat Loss",
      source: "form",
      detail: "Lose body fat",
    });
    expect(
      suggestTargetsPhase({ goalAnswer: "Other", goalDetail: "Want to recomp before summer" }),
    ).toMatchObject({ phase: "Recomp", source: "form" });
  });

  it("targets the coach set after the latest Nutrition Update win, and are the fallback without one", () => {
    const current = { phase: "Maintenance", created_at: "2026-10-20T00:00:00Z" };
    expect(
      suggestTargetsPhase({ aiPhase: "Recomp", submittedAt: "2026-10-18T00:00:00Z", current }),
    ).toMatchObject({ phase: "Maintenance", source: "current" });
    expect(
      suggestTargetsPhase({ aiPhase: "Recomp", submittedAt: "2026-10-25T00:00:00Z", current }),
    ).toMatchObject({ phase: "Recomp", source: "ai" });
    expect(suggestTargetsPhase({ current })).toMatchObject({
      phase: "Maintenance",
      source: "current",
    });
    expect(suggestTargetsPhase({ profileGoals: "Gain muscle and get stronger" })).toMatchObject({
      phase: "Muscle Gain",
      source: "profile",
    });
  });

  it("nothing to go on, or an unknown phase, suggests nothing", () => {
    expect(suggestTargetsPhase({})).toBeNull();
    expect(suggestTargetsPhase({ requestPhase: "Custom", aiPhase: "Bogus" })).toBeNull();
  });

  it("says where it came from", () => {
    expect(
      phaseSourceText(
        { phase: "Fat Loss", source: "form", detail: "Lose body fat" },
        { name: "David" },
      ),
    ).toBe('From David\'s Nutrition Update: goal "Lose body fat"');
    expect(
      phaseSourceText({ phase: "Maintenance", source: "current", detail: null }, { name: "David" }),
    ).toBe("Same as David's current targets");
  });

  it("the targets dialog uses it and shows the source", () => {
    const dialog = readFileSync("src/components/nutrition-target-dialog.tsx", "utf8");
    expect(dialog).toContain("suggestTargetsPhase({");
    expect(dialog).toContain("{phaseSource}");
  });

  it("reads every Goal option on the Nutrition Update and the older goal wording", async () => {
    const { phaseFromText } = await import("@/lib/nutrition-cardio");
    const cases: [string, string | null][] = [
      ["Fat Loss", "Fat Loss"],
      ["Muscle Gain", "Muscle Gain"],
      ["Recomp (lose fat + build muscle)", "Recomp"],
      ["Maintenance", "Maintenance"],
      ["Performance / strength", "Performance"],
      ["Reverse Diet", "Reverse Diet"],
      ["Lifestyle Reset (build better habits)", "Lifestyle Reset"],
      ["Lose body fat", "Fat Loss"],
      ["Lose fat and build muscle", "Recomp"],
      ["Lean bulk this winter", "Muscle Gain"],
      ["Eat clean and feel better", null],
    ];
    for (const [text, phase] of cases) expect(phaseFromText(text), text).toBe(phase);
  });
});
