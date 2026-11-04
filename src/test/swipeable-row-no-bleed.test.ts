import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/ui/swipeable-row.tsx", "utf8");

describe("a closed swipe row never shows its buttons", () => {
  it("paints the buttons only while a swipe has them on screen", () => {
    expect(src).toContain('style={{ width: actionsWidth, visibility: revealed ? "visible" : "hidden" }}');
    expect(src).toContain("if (!revealed) setRevealed(true);");
  });
  it("hides them again once the row is back, whether it slid back or never moved", () => {
    expect(src).toContain('e.propertyName === "transform" && dx === 0 && !open) setRevealed(false);');
    expect(src).toContain("if (dx === 0) setRevealed(false);");
    expect(src).toContain("if (dx === 0 && !open) setRevealed(false);");
  });
});
