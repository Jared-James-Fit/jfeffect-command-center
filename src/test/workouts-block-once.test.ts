import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockNameParts } from "@/lib/training-roadmap";

const page = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");

describe("Workouts: the block is said once, at the top", () => {
  it("a coach's Block 1 — Volume 5s/7s reads as a Block 1 tag beside its name", () => {
    expect(blockNameParts("Block 1 — Volume 5s/7s")).toEqual({ tag: "Block 1", name: "Volume 5s/7s" });
    expect(blockNameParts("Block 3 – Peak / Taper / Meet")).toEqual({ tag: "Block 3", name: "Peak / Taper / Meet" });
    expect(blockNameParts("block 2: Strength")).toEqual({ tag: "Block 2", name: "Strength" });
    // no number in it: all name
    expect(blockNameParts("Home Gym 4-Day Strength + Hypertrophy")).toEqual({ tag: null, name: "Home Gym 4-Day Strength + Hypertrophy" });
    expect(blockNameParts("MARC — At-Home Upper / Lower — 4 Days/Week")).toEqual({ tag: null, name: "MARC — At-Home Upper / Lower — 4 Days/Week" });
    expect(blockNameParts("  ")).toBeNull();
    expect(blockNameParts(null)).toBeNull();
  });
  it("the header names the block (no week: the strip under it says which week)", () => {
    expect(page).toContain('data-testid="workouts-block"');
    expect(page).not.toContain("headerWeek");
    expect(read("src/components/workouts/week-strip.tsx")).toContain("if (n) return `Week ${n}`;");
  });
  it("the day card is the day and how long, never the block and week again (another block's workout still names its block)", () => {
    expect(page).toContain('data-testid="workout-day-meta"');
    expect(page).toContain("item.block?.id && item.block.id !== pageBlockId && item.block.name && !isAtHomeBackupSessionBlock(item.block)");
    expect(page).not.toContain('item.block?.name,\n                item.week?.week_index ? `Week ${item.week.week_index}` : null,\n                format(date, "EEE MMM d"),');
    expect(page).toContain("pageBlockId={headerBlock?.id ?? null}");
  });
});

function read(p: string) {
  return readFileSync(p, "utf8");
}
