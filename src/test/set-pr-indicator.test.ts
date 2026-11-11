import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setPrItems, setPrSummary } from "@/lib/set-pr-items";

const rec = (o: Partial<Record<string, unknown>> = {}) =>
  ({ reps: 5, load_kg: 145, atpr: false, program_pr: false, block_pr: false, prev_all_kg: null, prev_program_kg: null, prev_block_kg: null, ...o }) as any;

describe("a set's PR indicator", () => {
  it("one record reads as its own name, with what it beat", () => {
    const items = setPrItems({ record: rec({ atpr: true, program_pr: true, prev_all_kg: 140 }), unit: "kg" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "5-rep ATPR", detail: "145 kg × 5 · was 140 kg" });
    expect(setPrSummary(items)).toBe("5-rep ATPR");
  });
  it("a rep record and a weight record on one set are one indicator: 2 PRs", () => {
    const items = setPrItems({
      record: rec({ atpr: true, prev_all_kg: 140 }),
      loadRecord: rec({ program_pr: true, prev_program_kg: 142.5 }),
      unit: "kg",
    });
    expect(setPrSummary(items)).toBe("2 PRs");
    expect(items.map((i) => i.title)).toEqual(["5-rep ATPR", "Weight program PR"]);
    expect(items[1].detail).toBe("Heaviest yet · 145 kg · was 142.5 kg");
  });
  it("names the scope it actually is, never a bigger one", () => {
    expect(setPrItems({ record: rec({ block_pr: true, prev_block_kg: 135 }), unit: "kg" })[0].title).toBe("5-rep block PR");
  });
  it("shows the athlete's unit", () => {
    expect(setPrItems({ record: rec({ atpr: true, prev_all_kg: 140 }), unit: "lb" })[0].detail).toBe("319.5 lb × 5 · was 308.5 lb");
  });
  it("leaves out 'was' when there's no earlier record on file", () => {
    expect(setPrItems({ record: rec({ atpr: true }), unit: "kg" })[0].detail).toBe("145 kg × 5");
  });
  it("falls back to the on-phone check only when the server has nothing", () => {
    const local = { reps: 3, amount: 2.5, unit: "kg" as const };
    expect(setPrItems({ localPr: local, unit: "kg" })[0]).toMatchObject({ title: "3-rep ATPR", detail: "+2.5 kg over your previous best" });
    expect(setPrItems({ localPr: local, assisted: true, unit: "kg" })[0].detail).toBe("2.5 kg less assistance than your best");
    expect(setPrItems({ record: rec({ atpr: true }), localPr: local, unit: "kg" })).toHaveLength(1);
  });
  it("nothing earned, nothing shown", () => {
    expect(setPrItems({ record: rec(), loadRecord: rec(), unit: "kg" })).toEqual([]);
  });
});

describe("set row look", () => {
  const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const badge = readFileSync("src/components/workout-day/set-number-badge.tsx", "utf8");
  it("a done row is a whisper of green with no left bar; the number carries it", () => {
    expect(view).toContain('isConfirmed && "bg-success/[0.04]"');
    expect(view).not.toContain("bg-emerald-500/[0.07] border-l-2 border-l-emerald-500/70");
    expect(badge).toContain('"border-success bg-success text-white"');
    expect(badge).toContain('"border-transparent bg-muted text-muted-foreground"');
  });
  it("PRs are one indicator under the set, not the old pills", () => {
    expect(view).toContain("<SetPrIndicator items={prItems} celebrate={prFresh} />");
    expect(view).not.toContain("<SetRecordBadge");
    // the PR sound and haptic stay
    expect(view).toContain('playAppSound("pr")');
  });
});
