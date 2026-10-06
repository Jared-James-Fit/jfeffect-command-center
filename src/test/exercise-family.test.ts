import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOVEMENT_FAMILIES,
  familyStripeClass,
  movementFamilyStyle,
  resolveMovementFamily,
} from "@/lib/exercise-family";
import { defaultCardColor } from "@/lib/exercise-metadata";
import { exerciseAccent } from "@/components/program-builder";
import { ExerciseOrderBadge } from "@/components/exercise-order-badge";
import { displayExerciseName } from "@/lib/exercise-display-name";

describe("movement family colour", () => {
  it("maps the four families to yellow / blue / green / red", () => {
    expect(movementFamilyStyle("squat").stripe).toBe("bg-yellow-500");
    expect(movementFamilyStyle("bench").stripe).toBe("bg-blue-500");
    expect(movementFamilyStyle("deadlift").stripe).toBe("bg-green-500");
    expect(movementFamilyStyle("accessory").stripe).toBe("bg-red-500");
    expect(MOVEMENT_FAMILIES).toHaveLength(4);
  });

  it("uses the library's movement_family, so variations (not just comp lifts) are coloured", () => {
    expect(resolveMovementFamily({ movement_family: "squat" })).toBe("squat");   // Pause Squat
    expect(resolveMovementFamily({ movement_family: "bench" })).toBe("bench");   // Larsen Press
    expect(resolveMovementFamily({ movement_family: "deadlift" })).toBe("deadlift"); // RDL
  });

  it("colours by MOVEMENT, not by the lift a muscle group helps: Leg Curl stays accessory", () => {
    // A hamstring accessory must never turn green just because it helps the deadlift.
    expect(resolveMovementFamily({ movement_family: "accessory", competition_lift_type: null })).toBe("accessory");
    expect(familyStripeClass({ movement_family: "accessory" })).toBe("bg-red-500");
  });

  it("falls back safely for older cached payloads and unlinked rows", () => {
    expect(resolveMovementFamily({ competition_lift_type: "bench" })).toBe("bench");
    expect(resolveMovementFamily(null, "deadlift")).toBe("deadlift"); // typed row with an SBD analytics tag
    expect(resolveMovementFamily(null, "upper")).toBe("accessory");   // analytics-only values are not colours
    expect(resolveMovementFamily(undefined)).toBe("accessory");
    expect(resolveMovementFamily({ movement_family: "nonsense" })).toBe("accessory");
  });

  it("the exercise family wins over the row's analytics override", () => {
    expect(resolveMovementFamily({ movement_family: "accessory" }, "squat")).toBe("accessory");
  });

  it("every colour helper agrees (no screen decides its own colour)", () => {
    const squat = { movement_family: "squat" };
    expect(exerciseAccent(squat)).toBe("bg-yellow-500");
    expect(exerciseAccent(squat, "red")).toBe("bg-yellow-500"); // legacy per-row card_color is ignored
    expect(defaultCardColor(squat)).toBe("yellow");
    expect(defaultCardColor({ movement_family: "bench" })).toBe("blue");
    expect(defaultCardColor({ movement_family: "deadlift" })).toBe("green");
    expect(defaultCardColor({ movement_family: "accessory" })).toBe("red");
  });
});

describe("exercise order number", () => {
  const family = (i: number) => (["squat", "bench", "deadlift", "accessory", "accessory"] as const)[i];
  const render = (names: string[]) =>
    renderToStaticMarkup(
      createElement(
        "div",
        null,
        names.map((n, i) =>
          createElement("section", { key: n, "data-name": n }, createElement(ExerciseOrderBadge, { position: i + 1, family: family(i) ?? "accessory" })),
        ),
      ),
    );
  const numbers = (html: string) => Array.from(html.matchAll(/data-testid="exercise-order-badge"[^>]*>(\d+)</g)).map((m) => Number(m[1]));

  it("shows each card's position in its own badge, in workout order", () => {
    const names = ["Competition Squat", "Competition Bench Press", "Romanian Deadlift", "Lat Pulldown", "Triceps Pressdown"];
    expect(numbers(render(names))).toEqual([1, 2, 3, 4, 5]);
  });

  it("renumbers automatically when an exercise is deleted (1,2,4,5 -> 1,2,3,4)", () => {
    const names = ["Competition Squat", "Competition Bench Press", "Romanian Deadlift", "Lat Pulldown", "Triceps Pressdown"];
    const afterDelete = names.filter((n) => n !== "Romanian Deadlift");
    expect(numbers(render(afterDelete))).toEqual([1, 2, 3, 4]);
  });

  it("renumbers automatically when exercises are reordered", () => {
    const names = ["A", "B", "C"];
    const reordered = [names[2], names[0], names[1]];
    const html = render(reordered);
    expect(numbers(html)).toEqual([1, 2, 3]);
    expect(html.indexOf('data-name="C"')).toBeLessThan(html.indexOf('data-name="A"'));
  });

  it("carries the family colour and an accessible label", () => {
    const html = renderToStaticMarkup(createElement(ExerciseOrderBadge, { position: 3, family: "deadlift" }));
    expect(html).toContain("bg-green-600");
    expect(html).toContain('data-family="deadlift"');
    expect(html).toContain('aria-label="Exercise 3, Deadlift"');
  });
});

describe("numbering is derived, never stored", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the logger passes the live list index to every card", () => {
    const src = read("src/components/workout-day/WorkoutDayView.tsx");
    expect((src.match(/position=\{rowIndex \+ 1\}/g) ?? []).length).toBe(2);
  });

  it("the builder derives the badge from the row's index in the day", () => {
    const src = read("src/routes/_authenticated/admin/program-library_.$templateId.tsx");
    expect(src).toContain("<ExerciseOrderBadge position={index + 1} family={family} />");
    expect(src).not.toMatch(/sort_order\s*=\s*i\s*\+\s*1[^\n]*label/);
  });

  it("no card persists a manual number or a per-row colour any more", () => {
    const src = read("src/routes/_authenticated/admin/program-library_.$templateId.tsx");
    expect(src).not.toContain('title="Card color"');
  });
});

describe("display name", () => {
  it("shows the standardized library name; the typed name is only a fallback", () => {
    expect(displayExerciseName({ exercises: { name: "Competition Bench Press" }, exercise_name_override: "Comp Bench" })).toBe("Competition Bench Press");
    expect(displayExerciseName({ exercises: null, exercise_name_override: " Cable Crunch " })).toBe("Cable Crunch");
    expect(displayExerciseName({ exercises: { name: "  " }, exercise_name_override: null })).toBe("Exercise");
  });
});
