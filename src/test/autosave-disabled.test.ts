import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("emergency autosave lock", () => {
  it("does not schedule backend saves from the autosave hook", () => {
    const source = readFileSync("src/hooks/use-autosave.ts", "utf8");

    expect(source).not.toContain("setTimeout(() => { void doSave(); }");
    expect(source).not.toContain("schedule();");
    expect(source).not.toContain("if (online && state === \"offline\") schedule()");
    expect(source).not.toContain("void doSave();\n    }\n  }, [doSave, equals]);");
  });

  it("keeps workout set row persistence manual-only", () => {
    const source = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

    expect(source).toContain("Emergency safety lock 2026-06-25: set rows are manual-save only.");
    expect(source).toContain("enabled: false,");
    expect(source).toContain("aria-label={`Save set ${setIndex}`}");
    expect(source).not.toContain("save.flush().finally(() => { setFocusedField(null); });");
  });
});