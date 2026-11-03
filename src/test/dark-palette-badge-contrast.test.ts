import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOVEMENT_FAMILIES, movementFamilyStyle } from "@/lib/exercise-family";

// styles/dark-palette.css remaps every `text-<colour>-950` class to a LIGHT tint
// in dark mode (so 950 text stays readable on dark surfaces). On a solid
// coloured fill that makes the text blend in — the squat badge's yellow "1"
// was pale yellow on yellow. Solid fills need text-black / text-white.
const palette = readFileSync("src/styles/dark-palette.css", "utf8");
const remapped = new Set([...palette.matchAll(/\.dark \.(text-[a-z]+-950):/g)].map((m) => m[1]));

describe("movement-family badges stay readable in dark mode", () => {
  it("the palette really does remap -950 text classes (this test is meaningful)", () => {
    expect(remapped.has("text-yellow-950")).toBe(true);
  });
  it.each(MOVEMENT_FAMILIES)("%s badge text is not a remapped -950 class", (family) => {
    const classes = movementFamilyStyle(family).badge.split(/\s+/);
    expect(classes.filter((c) => remapped.has(c))).toEqual([]);
  });
  it("squat's digit is black on its yellow fill", () => {
    expect(movementFamilyStyle("squat").badge).toContain("text-black");
  });
});
