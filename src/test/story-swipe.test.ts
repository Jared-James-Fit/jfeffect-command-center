import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../src/components/community/crew-stories.tsx", import.meta.url), "utf8");

describe("stories: swipe to the next person (Instagram's cube)", () => {
  it("sideways is a swipe, down is close, anything less is a tap", () => {
    expect(src).toContain("if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) swiping.current = true;");
    expect(src).toContain("else if (dy >= 12 && dy >= Math.abs(dx) * 1.2) dragging.current = true;");
  });
  it("follows the finger, turns past a quarter or on a flick, else settles back; nobody that way only gives a little", () => {
    expect(src).toContain("const toNext = q < 0 && (q < -0.25 || (v < -0.4 && q < -0.03));");
    expect(src).toContain("const toPrev = q > 0 && (q > 0.25 || (v > 0.4 && q > 0.03));");
    expect(src).toContain("q = Math.sign(q) * Math.min(0.12, Math.abs(q) * 0.3);");
    // past the last person: the end card
    expect(src).toContain("setEnd(storyEnd(groups, posts, watched.current));");
  });
  it("a cube: this story and the next person's turn round the corner together, both pre-loaded", () => {
    expect(src).toContain("rotateY(${(sp + offset) * 90}deg)");
    expect(src).toContain('style={{ perspective: "1100px" }}');
    expect(src).toContain('data-story-face="next"');
    expect(src).toContain('data-story-face="prev"');
  });
  it("a story that runs out (or a tap back past the first) turns the same way", () => {
    expect(src).toContain("turnTo(j, at >= 0 ? at : Math.max(0, items.findIndex(fresh)), 1);");
    expect(src).toContain("else if (gi > 0) turnTo(gi - 1, frames(groups[gi - 1]) - 1, -1);");
    expect(src).toContain('window.matchMedia?.("(prefers-reduced-motion: reduce)").matches');
  });
});
