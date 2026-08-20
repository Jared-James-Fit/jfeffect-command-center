import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const resolver = readFileSync(
  resolve(process.cwd(), "src/lib/nutrition-targets/member-targets.functions.ts"),
  "utf8",
);
const portalNutrition = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/portal/nutrition-targets.tsx"),
  "utf8",
);
const hero = readFileSync(
  resolve(process.cwd(), "src/components/nutrition/TodaysPlanHero.tsx"),
  "utf8",
);

describe("client nutrition meal-plan access", () => {
  it("loads every saved day record from the visible active nutrition target", () => {
    expect(resolver).toContain(
      "nutrition_target_days(id, day_label, calories, protein, carbs, fats, fibre, notes, sort_order)",
    );
    expect(resolver).toContain('.eq("visible_to_client", true)');
    expect(resolver).toContain('.neq("status", "Archived")');
    expect(resolver).toContain("days: days.map");
  });

  it("selects exact plan-day records by ID instead of remapping saved titles", () => {
    expect(portalNutrition).toContain(
      "resolvePlanDaySelection(days, automaticDayType, manualPlanId)",
    );
    expect(portalNutrition).toContain("planChoices");
    expect(portalNutrition).toContain("onSelectPlan");
    expect(portalNutrition).toContain("day?.day_label || DAY_TYPE_LABEL[automaticDayType]");
    expect(portalNutrition).not.toContain("setManualDay");
  });

  it("renders exact coach-created titles as selector labels with stable IDs", () => {
    expect(hero).toContain("key={choice.id}");
    expect(hero).toContain("onSelectPlan(choice.id)");
    expect(hero).toContain("{choice.title}");
    expect(hero).toContain("display data only");
  });

  it("does not claim a generic day is missing before exposing the uploaded plan choices", () => {
    expect(portalNutrition).toContain("You can still review any uploaded plan above.");
    expect(portalNutrition).toContain("planChoices={planChoices}");
  });
});
