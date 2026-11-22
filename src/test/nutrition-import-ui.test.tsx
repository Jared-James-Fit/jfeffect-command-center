import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: (p: any) => createElement("a", { href: p.to }, p.children) }));
vi.mock("@/components/ai-credits/ai-credits", () => ({
  useAiCredits: () => ({ data: null, refetch: () => undefined }),
  AiCreditsChip: () => null,
  AiCreditsSheet: () => null,
  useSetCreditState: () => () => undefined,
}));

const { PlanPreview, dayNumbers } = await import("@/components/nutrition-studio/plan-preview");
const { CleoQuestions } = await import("@/components/nutrition-studio/cleo-questions");
const { seedFromPlan } = await import("@/lib/nutrition-import/seed");

const PLAN = `TRAINING-DAY MENU

Meal 1: Breakfast
3 eggs
2 slices toast

Meal 2: Lunch
150 g chicken breast
1 cup rice`;

describe("the preview", () => {
  it("shows each day with its numbers and meals, the flags (checks first) and the source a tap away", () => {
    const seed = seedFromPlan(PLAN)!;
    const html = renderToStaticMarkup(
      createElement(PlanPreview, {
        days: seed.days.map((d) => ({ label: d.day_label, calories: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats, notes: d.notes })),
        flags: [
          { level: "info", code: "no_macros", text: "Every day: no macros" },
          { level: "check", code: "not_in_file", text: "Meal 2: 150 isn't in your file" },
        ],
        sourceText: "Breakfast 3 eggs",
        sourceLabel: "What was read from your file",
        actions: createElement("button", null, "Edit in your plan"),
      }),
    );
    expect(html).toContain("1 day found");
    expect(html).toContain("Every day");
    expect(html).toContain("No macros given · 2 meals");
    expect(html).toContain("Worth a look (1)");
    expect(html.indexOf("150 isn")).toBeLessThan(html.indexOf("no macros"));
    expect(html).toContain("data-meal-import-source");
    expect(html).toContain("chicken breast");
    expect(dayNumbers({ calories: 2200, protein: 160, carbs: 230, fats: 70 })).toBe("2,200 kcal · P 160 · C 230 · F 70");
  });
});

describe("Create with Cleo's questions", () => {
  it("shows Cleo as what it is, the member's own targets, and never asks for a number", () => {
    const html = renderToStaticMarkup(
      createElement(CleoQuestions, {
        targets: { calories: 2200, protein_g: 160, carbs_g: 230, fat_g: 70 },
        targetsLoading: false,
        busy: false,
        error: null,
        outOfCredits: false,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain("AI assistant");
    expect(html).toContain("Written to your targets");
    expect(html).toContain("2,200 kcal · P 160 · C 230 · F 70");
    expect(html).toContain("Do any of these apply to you?");
    expect(html).not.toMatch(/type="number"/);
    // the health question isn't answered yet: no draft can be asked for
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-cleo-write/);
  });

  it("with no targets, sends them to set targets first", () => {
    const html = renderToStaticMarkup(
      createElement(CleoQuestions, { targets: null, targetsLoading: false, busy: false, error: null, outOfCredits: false, onSubmit: () => undefined }),
    );
    expect(html).toContain("Set your targets first");
    expect(html).toContain('href="/portal/nutrition-targets"');
  });
});
