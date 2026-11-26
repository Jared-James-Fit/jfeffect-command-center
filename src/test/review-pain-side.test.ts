import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PAIN_AREAS,
  checkoutCta,
  composePainArea,
  composePainAreas,
  painAreaNames,
  painAreaParts,
  parsePainAreas,
} from "@/lib/workout-review";

describe("where it hurts in the review", () => {
  it("has the neck and reads head to toe, three across", () => {
    expect(PAIN_AREAS).toEqual([
      "Neck", "Shoulder", "Upper back",
      "Chest", "Elbow", "Wrist",
      "Low back", "Hip / groin", "Hamstring",
      "Knee", "Calf / ankle", "Other",
    ]);
  });

  it("writes the side the way earlier reviews stored it", () => {
    expect(composePainArea("Shoulder", "R")).toBe("Shoulder (R)");
    expect(composePainArea("Knee", "L")).toBe("Knee (L)");
    expect(composePainArea("Knee", "both")).toBe("Knee (L), Knee (R)");
    expect(composePainArea("Shoulder", null)).toBe("Shoulder");
    // Neck, the backs and Other have no side.
    expect(composePainArea("Low back", "R")).toBe("Low back");
    expect(composePainArea("Neck", "L")).toBe("Neck");
  });

  it("several places are one list, head to toe whatever order they were tapped", () => {
    expect(composePainAreas([{ area: "Low back", side: null }, { area: "Neck", side: null }])).toBe("Neck, Low back");
    expect(composePainAreas([{ area: "Knee", side: "both" }, { area: "Shoulder", side: "R" }])).toBe("Shoulder (R), Knee (L), Knee (R)");
    expect(composePainAreas([], ["General"])).toBe("General");
    expect(composePainAreas([{ area: "Neck", side: null }], ["General"])).toBe("Neck, General");
    expect(composePainAreas([])).toBeNull();
  });

  it("reads every stored shape back into chips + sides; anything else stays as written", () => {
    expect(parsePainAreas("Neck, Shoulder (R), Knee (L), Knee (R)")).toEqual({
      picks: [{ area: "Neck", side: null }, { area: "Shoulder", side: "R" }, { area: "Knee", side: "both" }],
      other: [],
    });
    expect(parsePainAreas("Low back")).toEqual({ picks: [{ area: "Low back", side: null }], other: [] });
    expect(parsePainAreas("General")).toEqual({ picks: [], other: ["General"] });
    expect(parsePainAreas(null)).toEqual({ picks: [], other: [] });
    // the older sheet's names light today's chips
    expect(parsePainAreas("Lower back, Hip (L), Ankle/foot (R)").picks).toEqual([
      { area: "Low back", side: null },
      { area: "Hip / groin", side: "L" },
      { area: "Calf / ankle", side: "R" },
    ]);
    // a side on a place that has none is never dropped
    expect(parsePainAreas("Low back (R)")).toEqual({ picks: [], other: ["Low back (R)"] });
    // and what's read saves back the same
    for (const s of ["Neck, Low back", "Shoulder (L), Shoulder (R)", "Wrist", "General"]) {
      const { picks, other } = parsePainAreas(s);
      expect(composePainAreas(picks, other)).toBe(s);
    }
  });

  it("says each place in words, and counts places without their sides", () => {
    expect(painAreaParts("Neck, Shoulder (R), Knee (L), Knee (R)")).toEqual(["Neck", "Right shoulder", "Both knees"]);
    expect(painAreaParts("Hip / groin (L), Hip / groin (R), Chest (L), Chest (R)")).toEqual(["Hip / groin (both sides)", "Chest (both sides)"]);
    expect(painAreaNames("Neck, Shoulder (L), Shoulder (R), Lower back")).toEqual(["neck", "shoulder", "low back"]);
  });

  it("an older free-text area still saves; only a missing area blocks", () => {
    const base = { isEdit: true, effort: 7, pain: true, sleepBucket: null, recoveryToday: null };
    expect(checkoutCta({ ...base, painArea: "General" }).enabled).toBe(true);
    expect(checkoutCta({ ...base, painArea: null }).label).toBe("Say where it hurts");
  });

  it("the editor takes any number of places from the body map, each with its own severity, and sends them structured", () => {
    const ed = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    expect(ed).toContain("<PainReporter picks={painPicks} onChange={setPainPicks} ctx={painContext} />");
    expect(ed).toContain("painReports: pain ? painReports : [],");
    expect(ed).toContain("painArea: pain ? painCols.painArea : null,");
    // a place with no "how bad" (a number or Unsure) or no side holds the button
    expect(ed).toContain("painUnrated: painPicks.some((p) => needsScore(p)),");
    expect(ed).toContain('painNoSide: painPicks.some((p) => pickGaps(p).includes("side")),');
    expect(ed).toContain('painUnnamed: painPicks.some((p) => p.region === "other" && !p.note?.trim())');
    const rep = readFileSync("src/components/pain/pain-reporter.tsx", "utf8");
    expect(rep).toContain("<PainMap");
    expect(rep).toContain("<PainEntryRow");
    expect(readFileSync("src/components/pain/pain-entries.tsx", "utf8")).toContain("data-pain-place");
  });
});
