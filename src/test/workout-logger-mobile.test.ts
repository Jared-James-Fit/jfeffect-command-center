import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displayLoadInUnit } from "@/lib/workout-unit-persistence";
import { ExerciseActionRow } from "@/components/workout-day/exercise-action-row";

const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

describe("set rows saved without a weight", () => {
  it("stay blank instead of showing a weight of 0", () => {
    // A set saved with only reps/RPE: every load column is null.
    const repsOnly = {
      actual_load: null, actual_load_unit: "lb", entered_value: null, entered_unit: null,
      normalized_kg: null, normalized_lb: null, actual_load_kg: null, actual_load_lb: null,
    };
    expect(displayLoadInUnit(repsOnly, "lb")).toBeNull();
    expect(displayLoadInUnit(repsOnly, "kg")).toBeNull();
  });
  it("still show a real bodyweight 0", () => {
    expect(displayLoadInUnit({ actual_load: 0, actual_load_unit: "kg" }, "kg")).toBe(0);
  });
});

describe("exercise action row", () => {
  const render = (hasNote: boolean) =>
    renderToStaticMarkup(
      createElement(ExerciseActionRow, {
        name: "Squat", howTo: null, hasNote, onOpenNote() {}, moreMenu: null, rest: null,
      }),
    );
  it("is How To · Note · More · Rest — reorder lives in More", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Add note for Squat"');
    expect(html).toContain('aria-label="More options for Squat"');
    expect(html).not.toContain("Reorder");
  });
  it("marks an existing note with a dot instead of a label", () => {
    expect(render(true)).toContain('aria-label="Notes for Squat"');
  });
});

describe("phone-first logger card", () => {
  it("puts the column picker in the table header instead of its own row", () => {
    expect(logger).toContain("aria-label={`Log columns for ${name}`}");
    expect(logger).not.toContain(">\n                Inputs\n");
  });
  it("shows helper chips only on the next set to log", () => {
    expect(logger).toContain("isNextSet={frontier === i + 1}");
    expect(logger).toContain("repeat={frontier === i + 1 ? repeatPrevious : null}");
    expect(logger).not.toContain("Copy Previous (");
    expect(logger).not.toContain("Apply to remaining sets\n");
  });
  it("never shows a dead Fill All button", () => {
    expect(logger).not.toContain("Fill All Sets (enter Set 1 weight first)");
    expect(logger).toContain("if (!needsFill) return null;");
  });
  it("never shows a second warm-up prompt above the table (the W row owns it)", () => {
    const card = readFileSync("src/components/workout-day/load-suggestion-card.tsx", "utf8");
    expect(card).toContain("if (warmup) return null;");
    expect(card).not.toContain("Log your last warm-up for a first suggestion");
  });
});
