import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitDistance, shouldGoBack, swipeOffset } from "@/components/swipe-back";

const W = 390; // a phone

describe("swipe back feel", () => {
  it("a short thumb move is enough (~85px on a phone), but not a twitch", () => {
    expect(commitDistance(W)).toBeGreaterThanOrEqual(80);
    expect(commitDistance(W)).toBeLessThanOrEqual(110);
    expect(shouldGoBack(90, 0, W)).toBe(true);
    expect(shouldGoBack(40, 0.1, W)).toBe(false);
  });
  it("a quick flick goes back from a short distance; a slow nudge doesn't", () => {
    expect(shouldGoBack(35, 0.5, W)).toBe(true);
    expect(shouldGoBack(20, 0.9, W)).toBe(false);
    expect(shouldGoBack(60, 0.2, W)).toBe(false);
  });
  it("the page follows 1:1, then rubber-bands, and never slides far enough to leave an empty screen", () => {
    expect(swipeOffset(50, W)).toBe(50);
    expect(swipeOffset(300, W)).toBeLessThan(300);
    expect(swipeOffset(2000, W)).toBeLessThanOrEqual(W * 0.42);
  });
  it("paints once per frame on the GPU and fills the gap with the app surface", () => {
    const src = readFileSync("src/components/swipe-back.tsx", "utf8");
    expect(src).toMatch(/requestAnimationFrame/);
    expect(src).toMatch(/translate3d/);
    expect(src).toMatch(/from-muted to-background/);
    // no full-width slide-out (that was the black screen)
    expect(src).not.toMatch(/paint\(window\.innerWidth/);
  });
});
