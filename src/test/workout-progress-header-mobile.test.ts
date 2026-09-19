import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("mobile workout progress header", () => {
  const ring = fs.readFileSync("src/components/workout/shared/workout-progress-ring.tsx", "utf8");
  const workout = fs.readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

  it("does not render a center percentage label inside tiny progress rings", () => {
    expect(ring).toContain("size >= 28");
    expect(ring).toContain("{clamped}%");
  });

  it("keeps the compact header progress badge from shrinking or wrapping internally", () => {
    expect(workout).toContain("inline-flex shrink-0 items-center");
    expect(workout).toContain("whitespace-nowrap");
    expect(workout).toContain("size={16}");
  });
});
