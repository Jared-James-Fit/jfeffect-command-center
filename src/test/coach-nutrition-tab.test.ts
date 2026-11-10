import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayRows } from "@/components/nutrition/nutrition-ui";

const read = (p: string) => readFileSync(p, "utf8");
const update = read("src/components/nutrition/NutritionRequestPanel.tsx");
const plan = read("src/components/nutrition-targets-panel.tsx");
const cardio = read("src/components/cardio-targets-panel.tsx");

describe("the coach's Nutrition tab reads as one calm screen", () => {
  it("three cards with plain sentence-case titles, never shouting caps", () => {
    expect(update).toContain('title="Nutrition update"');
    expect(plan).toContain('title="Current plan"');
    expect(cardio).toContain('title="Cardio"');
    for (const src of [update, plan, cardio]) {
      expect(src).not.toMatch(/uppercase tracking-widest|font-bold uppercase/);
      expect(src).not.toContain("bg-primary");
    }
    expect(cardio).not.toContain("Apply Default Cardio");
    expect(plan).not.toContain("Preview Grocery List");
  });

  it("only a decision gets the red button: publishing a plan waiting on the coach, or a first request", () => {
    // published plans and everything else are outlined; one primary per state
    expect(update).toContain('variant={published ? "outline" : "default"}');
    expect(update).toContain('variant={currentPlan ? "outline" : "default"}');
    expect(plan).not.toMatch(/<Button(?![^>]*variant=)[^>]*>/);
    expect(cardio).not.toMatch(/<Button(?![^>]*variant=)[^>]*>/);
  });

  it("a published plan is one line until the coach opens it; one waiting on him opens its review", () => {
    expect(update).toContain("const reviewOpen = ready && (!published || showDetails);");
    expect(update).toContain("onClick={() => setPublishOpen(true)}");
    expect(update).toContain("Review & edit first");
    // the rest lives in sections that open in place, and the copy tools in one list
    for (const s of [
      'title="Change something"',
      'title="AI targets"',
      'title="Meal plan"',
      'title="Client answers"',
      'title="Regenerate"',
    ])
      expect(update).toContain(s);
    expect(update).toContain("<CopyDialog");
  });

  it("day rows fit a phone: label and calories on one line, the macros under them, never a wide table", () => {
    const html = renderToStaticMarkup(
      createElement(DayRows, {
        rows: [
          {
            label: "Training Day",
            kcal: 1840,
            protein: 167,
            carbs: 185,
            fat: 48,
            extra: "10,000 steps · 15 min cardio",
          },
          { label: "High Day", kcal: 2144.4, protein: 163, carbs: null, fat: 48 },
        ],
      }),
    );
    expect(html).toContain("Training Day");
    expect(html).toContain("P 167 · C 185 · F 48");
    expect(html).toContain("10,000 steps · 15 min cardio");
    expect(html).toContain("2144");
    expect(html).toContain("C —");
    expect(html).not.toContain("<table");
    expect(update).not.toContain("<table");
  });

  it("cardio says only what's news: no 'linked' badge on every row, a warning only when a session matches no day", () => {
    expect(cardio).not.toContain("Linked to {t.day_type} nutrition");
    expect(cardio).toContain("const unlinked = orphanIds.has(t.id);");
    expect(cardio).toContain('"past-due": "Ended"');
  });
});
