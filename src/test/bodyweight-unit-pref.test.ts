import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latestLoggedUnit, resolveBodyweightUnit } from "@/lib/use-bodyweight-unit";

describe("bodyweight kg/lb is remembered", () => {
  it("saved choice wins, then the unit they last logged in, then the page default", () => {
    expect(resolveBodyweightUnit("kg", "lb", "lb")).toBe("kg");
    expect(resolveBodyweightUnit(null, "kg", "lb")).toBe("kg");
    expect(resolveBodyweightUnit(undefined, null, "lb")).toBe("lb");
  });
  it("finds the most recent entry's unit", () => {
    expect(latestLoggedUnit([{ date: "2026-10-01", unit: "lb" }, { date: "2026-10-08", unit: "kg" }, { date: "2026-09-01", unit: "lb" }])).toBe("kg");
    expect(latestLoggedUnit([])).toBeNull();
  });
  it("every bodyweight card uses the saved preference (no throwaway local state)", () => {
    for (const f of [
      "src/components/home/home-bodyweight-card.tsx",
      "src/components/portal/bodyweight-summary-card.tsx",
      "src/components/portal/missing-bodyweight-prompt.tsx",
      "src/components/log-bodyweight-card.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/useBodyweightUnit\(/);
      expect(src, f).not.toMatch(/useState<(WeightUnit|"kg" \| "lb")>\(defaultUnit\)/);
    }
  });
  it("is saved on the account in its own table (not user_preferences, which carries the theme)", () => {
    const hook = readFileSync("src/lib/use-bodyweight-unit.ts", "utf8");
    expect(hook).toMatch(/from\("bodyweight_unit_prefs"\)\s*\.upsert/);
    expect(hook).not.toMatch(/user_preferences/);
  });
});
