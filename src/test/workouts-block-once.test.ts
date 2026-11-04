import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockNameParts } from "@/lib/training-roadmap";

const page = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");

describe("Workouts: the block is said once, on the Program card", () => {
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
  it("the header is just Workouts and the strip says dates: no block tag, no week number up top", () => {
    expect(page).not.toContain('data-testid="workouts-block"');
    expect(page).not.toContain("subtitle={subtitle");
    const strip = read("src/components/workouts/week-strip.tsx");
    expect(strip).not.toContain("if (n) return `Week ${n}`;");
    expect(strip).toContain("export function weekRangeLabel(");
  });
  it("the day card is the day and how long, never the block and week again (another block's workout still names its block)", () => {
    expect(page).toContain('data-testid="workout-day-meta"');
    expect(page).toContain("item.block?.id && item.block.id !== pageBlockId && item.block.name && !isAtHomeBackupSessionBlock(item.block)");
    expect(page).toContain("pageBlockId={currentBlockId}");
    // "Today" is the day line, so no "Today" / "Upcoming" badge on top of it
    expect(page).toContain('const QUIET_DAY_STATUSES: WorkoutStatus[] = ["today", "upcoming", "available", "not_started"];');
    expect(page).toContain('const dayText = isSameDay(date, localStartOfToday()) ? "Today" : format(date, "EEE, MMM d");');
  });
});

function read(p: string) {
  return readFileSync(p, "utf8");
}
