import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activityFromTrainingDays, bodyInputIssues, toMetricBody, type BodyFields } from "@/lib/nutrition-targets/calc-input";
import { calculateTargets } from "@/lib/nutrition-targets/formula";

const base: BodyFields = { units: "imperial", age: "28", weight: "155", heightCm: "", heightFt: "5", heightIn: "6" };

describe("the targets calculator checks what's typed in plain words", () => {
  it("a normal imperial entry converts to kg / cm", () => {
    const m = toMetricBody(base)!;
    expect(m.age).toBe(28);
    expect(m.kg).toBeCloseTo(70.3, 1);
    expect(m.cm).toBeCloseTo(167.64, 2);
  });

  it("kg typed into the lb box is caught, not turned into a crash diet", () => {
    expect(bodyInputIssues({ ...base, weight: "40" }).weight).toBe("Enter your weight in lb, like 180.");
    expect(toMetricBody({ ...base, weight: "40" })).toBeNull();
  });

  it("height in cm typed into feet, or 14 inches, says what's wrong", () => {
    expect(bodyInputIssues({ ...base, heightFt: "170" }).height).toBe("Feet should be 4 to 7.");
    expect(bodyInputIssues({ ...base, heightIn: "14" }).height).toBe("Inches should be 0 to 11.");
    expect(bodyInputIssues({ ...base, units: "metric", heightCm: "5" }).height).toBe("Enter your height in cm, like 175.");
  });

  it("empty fields aren't errors, they just hold the result back", () => {
    const empty = { ...base, age: "", weight: "" };
    expect(bodyInputIssues(empty)).toEqual({ age: null, weight: null, height: null });
    expect(toMetricBody(empty)).toBeNull();
  });

  it("5 ft with no inches is 5 ft", () => {
    expect(toMetricBody({ ...base, heightIn: "" })!.cm).toBeCloseTo(152.4, 1);
  });

  it("activity starts from their training days", () => {
    expect(activityFromTrainingDays(null)).toBeNull();
    expect(activityFromTrainingDays(2)).toBe("light");
    expect(activityFromTrainingDays(4)).toBe("moderate");
    expect(activityFromTrainingDays(6)).toBe("very");
  });

  it("the formula: a 155 lb, 5'6\" 28-year-old man, moderately active, maintaining ≈ 2,500 kcal", () => {
    const m = toMetricBody(base)!;
    const r = calculateTargets({ bodyweightKg: m.kg, heightCm: m.cm, ageYears: m.age, sex: "male", activity: "moderate", goal: "maintain" });
    expect(r.calories).toBe(2500);
    expect(r.protein_g).toBe(141);
    expect(r.fat_g).toBe(63);
  });
});

describe("saved targets show on the Nutrition screen straight away", () => {
  const calc = readFileSync("src/components/nutrition/MacroCalculatorDialog.tsx", "utf8");
  const fn = readFileSync("src/lib/nutrition-targets/member-targets.functions.ts", "utf8");

  it("the save paints the new row and refreshes every reader of it", () => {
    expect(calc).toContain('queryClient.setQueriesData({ queryKey: ["m-nutrition-targets"] }, row);');
    for (const key of ['"nutrition-dashboard"', '"m-targets-history"', '"water-target"']) expect(calc).toContain(key);
  });

  it("water follows the suggestion unless it was set by hand, and a failed deactivate stops the save", () => {
    expect(fn).toContain('if (!w || (w as any).mode === "auto") {');
    expect(fn).toContain("if (offErr) throw offErr;");
  });

  it("any number of saves works: one active row per member, not one inactive row", () => {
    const sql = readFileSync("supabase/migrations/20261213090000_member_plan_schedule_agreement_nutrition.sql", "utf8");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS member_nutrition_targets_member_id_active_key");
    expect(sql).toContain("ON public.member_nutrition_targets (member_id) WHERE active");
  });
});
