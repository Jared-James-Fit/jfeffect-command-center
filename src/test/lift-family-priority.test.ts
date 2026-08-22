import { describe, expect, it } from "vitest";
import {
  derivePurposeLabels,
  deriveWeeklyPurposeLabelByRowId,
  liftColorGroup,
  resolvePurposeLabel,
} from "@/lib/exercise-metadata";

const competition = (type: "squat" | "bench" | "deadlift") => ({
  exercise_category: "competition" as const,
  is_competition_lift: true,
  competition_lift_type: type,
});

describe("exercise role classification comes from the prescription", () => {
  it("labels two Competition Squat entries on the same day both Primary", () => {
    const rows = [{}, {}];
    expect(derivePurposeLabels(rows, () => competition("squat"))).toEqual(["Primary", "Primary"]);
  });

  it("renders Jared-style Day 4 (squat/bench/deadlift, top set + backoff) as all Primary", () => {
    const rows = [{}, {}, {}, {}, {}, {}];
    const metas = [
      competition("squat"), competition("squat"),
      competition("bench"), competition("bench"),
      competition("deadlift"), competition("deadlift"),
    ];
    const labels = derivePurposeLabels(rows, (_row) => metas[rows.indexOf(_row)] ?? null);
    expect(derivePurposeLabels(rows.map((_, i) => ({ i })), (r: any) => metas[r.i])).toEqual([
      "Primary", "Primary", "Primary", "Primary", "Primary", "Primary",
    ]);
    expect(labels.length).toBe(6);
  });

  it("never infers role from occurrence order or page position", () => {
    const rows = [{ i: 0 }, { i: 1 }, { i: 2 }];
    const metas = [competition("bench"), { exercise_category: "assistance" as const }, competition("bench")];
    expect(derivePurposeLabels(rows, (r: any) => metas[r.i])).toEqual(["Primary", "Assistance", "Primary"]);
  });

  it("keeps programmed Secondary / Tertiary / Assistance labels intact", () => {
    expect(resolvePurposeLabel({ purpose_label: "Secondary" }, competition("squat"))).toBe("Secondary");
    expect(resolvePurposeLabel({ purpose_label: "Tertiary" }, competition("squat"))).toBe("Tertiary");
    expect(resolvePurposeLabel({}, { exercise_category: "assistance" })).toBe("Assistance");
    expect(resolvePurposeLabel({}, { exercise_category: "variation" })).toBe("Secondary");
  });

  it("treats a backoff row as the same role as its top set", () => {
    const top = resolvePurposeLabel({}, competition("deadlift"));
    const backoff = resolvePurposeLabel({}, competition("deadlift"));
    expect([top, backoff]).toEqual(["Primary", "Primary"]);
  });

  it("preserves role identically across weekly (POV/preview) derivation", () => {
    const labels = deriveWeeklyPurposeLabelByRowId(
      [
        { order: 3, rows: [{ id: "bench-late", sort_order: 0 }] },
        { order: 1, rows: [{ id: "bench-early", sort_order: 0 }] },
      ],
      () => competition("bench"),
    );
    expect(labels.get("bench-early")).toBe("Primary");
    expect(labels.get("bench-late")).toBe("Primary");
  });

  it("uses the manual movement family before card color or exercise metadata", () => {
    expect(liftColorGroup({ competition_lift_type: "deadlift" } as never, "emerald", "bench")).toBe("bench");
  });
});
