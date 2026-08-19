import { describe, expect, it } from "vitest";
import { derivePurposeLabels, liftColorGroup } from "@/lib/exercise-metadata";

describe("lift-family priorities", () => {
  it("calculates weekly exposure priority independently for squat, bench, and deadlift", () => {
    const rows = [
      { movement_family: "squat" },
      { movement_family: "bench" },
      { movement_family: "squat" },
      { movement_family: "deadlift" },
      { movement_family: "bench" },
      { movement_family: "squat" },
    ];

    const labels = derivePurposeLabels(rows, () => null);

    expect(labels).toEqual(["Primary", "Primary", "Secondary", "Primary", "Secondary", "Tertiary"]);
  });

  it("uses the manual movement family before card color or exercise metadata", () => {
    expect(liftColorGroup({ competition_lift_type: "deadlift" } as never, "emerald", "bench")).toBe(
      "bench",
    );
  });

  it("does not advance an SBD family for non-competition assistance rows", () => {
    const rows = [
      { movement_family: "bench" },
      { movement_family: "upper" },
      { movement_family: "bench" },
    ];

    expect(derivePurposeLabels(rows, () => null)).toEqual(["Primary", "Assistance", "Secondary"]);
  });

  it("keeps a manual purpose label authoritative for its parent exercise row", () => {
    const rows = [
      { movement_family: "bench", purpose_label: "Primary" },
      { movement_family: "bench" },
    ];

    expect(derivePurposeLabels(rows, () => null)).toEqual(["Primary", "Primary"]);
  });
});
