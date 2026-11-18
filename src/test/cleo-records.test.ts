/**
 * Cleo's PR lookup (personal_records) reads the records engine, which compares only finished workouts:
 * a set in a workout nobody tapped Finish on isn't a previous best. Nov 18 2026: Jarrett's 180 kg x 3
 * on Nov 14 (never finished) left Nov 17's 4 x 3 at 180 kg reading as an all-time PR.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("Cleo's PR lookup", () => {
  it("says records count finished workouts only, so a PR is checked against the log", () => {
    const src = readFileSync("src/lib/cleo-tools.server.ts", "utf8");
    expect(src).toContain("Records count finished workouts only, so before calling something an all-time PR check training_log");
    expect(src).toContain("a set in a workout they never tapped Finish on isn't compared");
  });
});
