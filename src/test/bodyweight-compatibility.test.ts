import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { mergeBodyweightSeries } from "@/lib/bodyweight";

describe("mergeBodyweightSeries", () => {
  it("preserves legacy-visible historical weights alongside canonical rows", () => {
    const rows = mergeBodyweightSeries(
      [
        {
          id: "canonical-aug-20",
          logged_date: "2026-08-20",
          weight_value: 157,
          weight_unit: "lb",
          note: "Canonical weigh-in",
        },
      ],
      [
        {
          id: "legacy-aug-13",
          entry_date: "2026-08-13",
          bodyweight: 160,
          bodyweight_unit: "lb",
          notes: "Historical check-in",
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "legacy-aug-13",
        date: "2026-08-13",
        source: "progress_metrics",
      }),
      expect.objectContaining({
        id: "canonical-aug-20",
        date: "2026-08-20",
        source: "progress_bodyweight",
      }),
    ]);
  });

  it("prefers canonical bodyweight on a same-day collision without losing other legacy dates", () => {
    const rows = mergeBodyweightSeries(
      [
        {
          id: "canonical-aug-20",
          logged_date: "2026-08-20",
          weight_value: 157,
          weight_unit: "lb",
          note: null,
        },
      ],
      [
        {
          id: "legacy-aug-20",
          entry_date: "2026-08-20",
          bodyweight: 158,
          bodyweight_unit: "lb",
          notes: null,
        },
        {
          id: "legacy-aug-19",
          entry_date: "2026-08-19",
          bodyweight: 159,
          bodyweight_unit: "lb",
          notes: null,
        },
      ],
    );

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({ id: "legacy-aug-19", source: "progress_metrics" }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        id: "canonical-aug-20",
        value: 157,
        source: "progress_bodyweight",
      }),
    );
    expect(rows).not.toContainEqual(expect.objectContaining({ id: "legacy-aug-20" }));
  });
});
