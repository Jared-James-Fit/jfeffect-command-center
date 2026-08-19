import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/program-planner/AvailabilityGuardDialog.tsx", "utf8");

describe("AvailabilityGuardDialog manual override", () => {
  it("requires the exact number of selected days before assignment can proceed", () => {
    expect(source).toContain("disabled={busy || !exact}");
    expect(source).not.toContain("disabled={busy || days.length === 0}");
  });
});
