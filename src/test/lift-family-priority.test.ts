import { describe, expect, it } from "vitest";
import {
  derivePurposeLabels,
  deriveWeeklyPurposeLabelByRowId,
  liftColorGroup,
} from "@/lib/exercise-metadata";

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

  it("sequences repeated family exposures across scheduled workout days instead of resetting per card", () => {
    const labels = deriveWeeklyPurposeLabelByRowId(
      [
        { order: 3, rows: [{ id: "bench-late", movement_family: "bench", sort_order: 0 }] },
        { order: 1, rows: [{ id: "bench-early", movement_family: "bench", sort_order: 0 }] },
        { order: 2, rows: [{ id: "squat-mid", movement_family: "squat", sort_order: 0 }] },
      ],
      () => null,
    );

    expect(labels.get("bench-early")).toBe("Primary");
    expect(labels.get("bench-late")).toBe("Secondary");
    expect(labels.get("squat-mid")).toBe("Primary");
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
