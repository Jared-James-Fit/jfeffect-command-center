import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SWIPE_ACTION_WIDTH,
  SWIPE_SLOP,
  classifyGesture,
  dragOffset,
  releaseOpen,
} from "@/components/workout-day/swipe-to-reveal";

describe("swipe intent", () => {
  it("ignores small movements inside the touch slop", () => {
    expect(classifyGesture(-10, 0)).toBe("pending");
    expect(classifyGesture(-(SWIPE_SLOP - 1), 2)).toBe("pending");
  });
  it("locks vertical and diagonal gestures into scrolling", () => {
    expect(classifyGesture(-5, 30)).toBe("scroll");
    expect(classifyGesture(-12, -12)).toBe("scroll");
    expect(classifyGesture(-40, -30)).toBe("scroll"); // 40 < 1.6 × 30
  });
  it("locks clearly horizontal gestures into a swipe", () => {
    expect(classifyGesture(-SWIPE_SLOP, 0)).toBe("swipe");
    expect(classifyGesture(-48, -20)).toBe("swipe");
  });
});

describe("drag tracking", () => {
  it("discounts the slop so the card never jumps", () => {
    expect(dragOffset(0, -SWIPE_SLOP)).toBe(0);
    expect(dragOffset(0, -(SWIPE_SLOP + 30))).toBe(-30);
  });
  it("rubber-bands past the action width and caps the overshoot", () => {
    expect(dragOffset(0, -400)).toBeGreaterThanOrEqual(-(SWIPE_ACTION_WIDTH + 24));
    expect(dragOffset(0, -400)).toBeLessThan(-SWIPE_ACTION_WIDTH);
  });
  it("resists the wrong direction", () => {
    expect(dragOffset(0, 200)).toBeLessThanOrEqual(12);
  });
});

describe("release", () => {
  it("snaps open after a deliberate pull and closed after a short one", () => {
    expect(releaseOpen(-SWIPE_ACTION_WIDTH, 0)).toBe(true);
    expect(releaseOpen(-50, 0)).toBe(true);
    expect(releaseOpen(-30, 0)).toBe(false);
    expect(releaseOpen(-10, -2)).toBe(false); // tiny fast flick never opens
  });
  it("opens on a real flick and lets a flick back close it", () => {
    expect(releaseOpen(-30, -0.8)).toBe(true);
    expect(releaseOpen(-70, 0.9)).toBe(false);
  });
});

describe("no global touch-target override", () => {
  it("the injected !important style that pushed Rest off the card is gone", () => {
    const src = readFileSync("src/components/workout-day/deferred-exercise-actions.tsx", "utf8");
    expect(src).not.toContain("jf-workout-action-touch-styles");
    expect(src).not.toContain("!important");
  });
});
