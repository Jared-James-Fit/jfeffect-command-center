import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { quickActionsFor, scopeForView, scopeWords } from "@/components/program-ai/cleo-dock";
import { movementFamilyStyle } from "@/lib/exercise-family";

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("Cleo docked in the builder", () => {
  it("follows the builder's view for its scope", () => {
    expect(scopeForView("day")).toBe("day");
    expect(scopeForView("week")).toBe("week");
    expect(scopeForView("block")).toBe("block");
    expect(scopeForView("sheet")).toBe("block");
    expect(scopeForView("program")).toBe("program");
    expect(scopeForView(null)).toBe("block");
  });

  it("says what it's looking at in plain words", () => {
    const here = { view: "day", week: 3, day: 2, dayName: "Lower A", blockName: "Strength" } as never;
    expect(scopeWords("day", here)).toBe("Week 3 · Day 2 “Lower A” of “Strength”");
    expect(scopeWords("week", here)).toBe("Week 3 of “Strength”");
    expect(scopeWords("block", here)).toBe("the whole “Strength” block");
    expect(scopeWords("program", null)).toBe("the whole program");
    expect(scopeWords("week", null)).toBeNull();
  });

  it("offers quick actions for what's in scope", () => {
    for (const scope of ["day", "week", "block", "program"] as const) {
      expect(quickActionsFor(scope, "client").length).toBeGreaterThanOrEqual(3);
      expect(quickActionsFor(scope, "template").length).toBeGreaterThanOrEqual(3);
    }
    expect(quickActionsFor("day", "client")).toContain("Make it fit their session length");
  });

  it("is Adjust program's own engine, never a second assistant", () => {
    const dock = src("components/program-ai/cleo-dock.tsx");
    expect(dock).toMatch(/ChatPanel/);
    expect(dock).toMatch(/useCleoAccess/);
    expect(dock).not.toMatch(/Sparkles|Bot\b|Brain/);
  });

  it("both editors are a builder page with Focus Mode and the dock", () => {
    for (const p of ["routes/_authenticated/admin/blocks.$blockId.tsx", "route-pages/_authenticated/admin/program-library_.$templateId.tsx"]) {
      const s = src(p);
      expect(s).toMatch(/data-builder-page/);
      expect(s).toMatch(/<CleoDock/);
      expect(s).toMatch(/beforeSend/);
    }
    const css = src("styles.css");
    expect(css).toMatch(/html\[data-builder-focus\]/);
    expect(css).toMatch(/--cleo-dock-w/);
  });
});

describe("accessories are neutral", () => {
  it("only the competition lifts carry a colour", () => {
    expect(movementFamilyStyle("accessory").stripe).not.toMatch(/red/);
    expect(movementFamilyStyle("accessory").dot).not.toMatch(/red/);
    expect(movementFamilyStyle("squat").stripe).toBe("bg-yellow-500");
  });
});
