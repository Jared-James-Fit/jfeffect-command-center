import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plannedLoadView } from "@/lib/workouts/planned-load";
import { rpeRange, topSetAdjustment } from "@/lib/workouts/load-reference";

describe("a back-off at a % of today's top set (Jared's Monday squat: 2 × 4 @ 92.5% | RPE 6)", () => {
  const base = { percentage: "92.5", basis: "top_set", rpe: "6", unit: "lb" as const };

  it("before the top set is logged it waits on it, with no weight", () => {
    const v = plannedLoadView({ ...base, planned: null, open: null, linked: null })!;
    expect(v.label).toBe("92.5% of top set");
    expect(v.value).toBeNull();
    expect(v.waiting).toBe("After your top set");
    expect(v.why).toEqual(["Your coach set these at 92.5% of today's top set. Log the top set and the weight shows here.", "RPE 6 is a cap: if a set goes over it, the next one comes down."]);
    expect(v.load).toBeNull();
  });

  it("once it's logged at 435 lb, says 400 lb and how: 402.4 rounded to a plate step", () => {
    const v = plannedLoadView({ ...base, planned: 400, open: 400, linked: { value: 435, unit: "lb" } })!;
    expect(v.value).toBe("400 lb");
    expect(v.load).toBe(400);
    expect(v.waiting).toBeNull();
    expect(v.why[0]).toBe("92.5% of your top set (435 lb) is 402.4 lb, rounded to 400 lb.");
    expect(v.why[1]).toBe("RPE 6 is a cap: if a set goes over it, the next one comes down.");
    expect(v.why.at(-1)).toBe("Tap the weight to fill your open sets, or type your own.");
    expect(v.capped).toBe(false);
  });

  it("reads a top set logged in the other unit in the card's unit", () => {
    const v = plannedLoadView({ ...base, planned: 400, open: 400, linked: { value: 197.5, unit: "kg" } })!;
    // 197.5 kg = 435.4 lb; 92.5% = 402.8 lb
    expect(v.why[0]).toBe("92.5% of your top set (197.5 kg) is 402.8 lb, rounded to 400 lb.");
  });

  it("after a back-off over the cap, says the lighter weight the sets left carry and why", () => {
    const v = plannedLoadView({ ...base, planned: 400, open: 385, linked: { value: 435, unit: "lb" }, capOver: { set: 1, rpe: 7.5 } })!;
    expect(v.value).toBe("385 lb");
    expect(v.load).toBe(385);
    expect(v.capped).toBe(true);
    expect(v.why[1]).toBe("Set 1 was RPE 7.5, over the RPE 6 cap, so the sets left are 385 lb.");
  });

  it("an exact weight needs no rounding note", () => {
    const v = plannedLoadView({ ...base, percentage: 90, planned: 360, open: 360, linked: { value: 400, unit: "lb" } })!;
    expect(v.why[0]).toBe("90% of your top set (400 lb) is 360 lb.");
  });
});

describe("a % of a max (High Bar Squat 2 × 6 @ 62.5% TM | RPE 5–6)", () => {
  const base = { percentage: 62.5, basis: "training_max", rpe: "5-6", unit: "kg" as const };

  it("names the reference and the cap (a range's cap is its top)", () => {
    const v = plannedLoadView({
      ...base, planned: 147.5, open: 147.5, label: "62.5% Comp Squat TM",
      reference: { lift: "Competition Squat", value: 235, unit: "kg" },
    })!;
    expect(v.label).toBe("62.5% Comp Squat TM");
    expect(v.value).toBe("147.5 kg");
    expect(v.why[0]).toBe("62.5% of your Training Max (Competition Squat 235 kg) is 146.9 kg, rounded to 147.5 kg.");
    expect(v.why[1]).toBe("RPE 6 is a cap: if a set goes over it, the next one comes down.");
  });

  it("while the maxes load it holds the place (no value, no waiting words)", () => {
    const v = plannedLoadView({ ...base, planned: null, open: null, pending: true })!;
    expect(v.value).toBeNull();
    expect(v.waiting).toBeNull();
    expect(v.label).toBe("62.5% TM");
  });

  it("with no max on file it's not a planned load (the % line and Suggested take over)", () => {
    expect(plannedLoadView({ ...base, planned: null, open: null, reference: null })).toBeNull();
  });
});

describe("rows that aren't a coach's %", () => {
  it("RPE-only, a fixed load and a % of an unknown basis get nothing here", () => {
    expect(plannedLoadView({ percentage: null, basis: null, rpe: "7", unit: "lb", planned: null, open: null })).toBeNull();
    expect(plannedLoadView({ percentage: null, basis: "manual", rpe: "7", unit: "lb", planned: 100, open: 100 })).toBeNull();
    expect(plannedLoadView({ percentage: 80, basis: "prev_week", rpe: "7", unit: "lb", planned: null, open: null })).toBeNull();
  });
});

describe("the workout card (source)", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("a back-off follows only a LOGGED top set, never a weight filled in from Suggested", () => {
    expect(wdv).toContain(".filter((x) => x.completed_at && x.actual_load != null && Number.isFinite(Number(x.actual_load)) && Number(x.actual_load) > 0)");
  });
  it("its weight boxes stay empty until a tap on the planned weight fills them", () => {
    expect(wdv).not.toContain("autoFillSuggestedWeight");
    expect(wdv).toContain("<PlannedLoadCell view={plannedView} onApply={clientId && openSetCount > 0 ? logOpenSetsAt : null} />");
  });
  it("the prescription keeps the coach's %, the strip says the weight, the % line steps aside", () => {
    expect(wdv).toContain("suggestedWeight: percentageBackoffWeight != null || plannedFromMax ? null : suggestedWeight,");
    expect(wdv).toContain("<PlannedLoadCell view={plannedView} onApply=");
    expect(wdv).toContain("{pctLine && !plannedView && (");
  });
  it("after a set over the RPE cap, its RPE isn't copied down and Same as set N steps aside", () => {
    expect(wdv).toContain('if (field === "rpe" && capValue != null && Number(value) > capValue) return;');
    expect(wdv).toContain("repeat={frontier === i + 1 && !capHeld ? repeatPrevious : null}");
    // and the cap line says the next weight in the card's unit, not both
    expect(wdv).toContain("next sets {fmtNum(capHeld.load)} {activeUnit}");
  });
  it("Last time breaks between its parts, never inside one", () => {
    expect(wdv).toContain('.replace(/ (?=(?:kg|lb|assist)\\b)/g, "\\u00a0").replace(/ ([×@·]) /g, " $1\\u00a0")');
  });
  it("a set holding only the plan is never saved as typed or shown as a draft", () => {
    expect(wdv).toContain("if (onlyPlan && !existing) return;");
    expect(wdv).toContain("actual_reps: onlyPlan ? null : repsNum,");
    expect(wdv).toContain("const isDraft = !isConfirmed && (hasAnyEntry || existingHolds);");
  });
});

describe("the planned weight is the same blue fill chip as Suggested", () => {
  it("one tap fills the open sets; before the top set it says what it waits on", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PlannedLoadCell } = await import("@/components/workout-day/load-suggestion-card");
    const ready = plannedLoadView({ percentage: 92.5, basis: "top_set", rpe: "6", unit: "lb", planned: 400, open: 400, linked: { value: 435, unit: "lb" } })!;
    const chip = renderToStaticMarkup(createElement(PlannedLoadCell, { view: ready, onApply: async () => 2 }));
    expect(chip).toContain('data-testid="load-apply"');
    expect(chip).toContain("rounded-md border border-border bg-background");
    expect(chip).toContain("Log your open sets at 400 lb");
    expect(chip).toContain('data-testid="load-planned-info"');
    // nothing to fill (read-only, every set logged): the value, the whole half opens the explanation
    const plain = renderToStaticMarkup(createElement(PlannedLoadCell, { view: ready }));
    expect(plain).not.toContain("load-apply");
    expect(plain).toContain("400 lb");
    const waiting = plannedLoadView({ percentage: 92.5, basis: "top_set", rpe: "6", unit: "lb", planned: null, open: null })!;
    const before = renderToStaticMarkup(createElement(PlannedLoadCell, { view: waiting, onApply: async () => 2 }));
    expect(before).not.toContain("load-apply");
    expect(before).toContain("After your top set");
  });
});

describe("a % back-off moves with how the top set went (topSetAdjustment)", () => {
  // Jared's Monday: top set 1 × 4 @ RPE 6, back-offs 2 × 4 @ 92.5% (RPE cap 6); 92.5% of 435 lb = 402.4
  const exact = 435 * 0.925;
  const backoff = (rpe: number | null, target: string = "6") => {
    const adj = topSetAdjustment({ reps: 4, rpe, target });
    if (!adj) return Math.round(exact / 5) * 5;
    const moved = exact * adj.factor;
    return adj.dir === "down" ? Math.min(400, Math.floor(moved / 5) * 5) : Math.max(400, Math.round(moved / 5) * 5);
  };

  it("on plan (or unrated) it's the coach's %: 400 lb", () => {
    expect(topSetAdjustment({ reps: 4, rpe: 6, target: "6" })).toBeNull();
    expect(topSetAdjustment({ reps: 4, rpe: null, target: "6" })).toBeNull();
    expect(topSetAdjustment({ reps: 4, rpe: 6, target: null })).toBeNull();
    expect(backoff(6)).toBe(400);
  });

  it("harder than planned brings them down before the first back-off, by what the chart says", () => {
    expect(backoff(6.5)).toBe(395);
    expect(backoff(8)).toBe(375); // 4 @ 8 instead of @ 6: 0.786 / 0.837 of 402.4 = 377.9, rounded down
    expect(backoff(10)).toBe(350);
    const adj = topSetAdjustment({ reps: 4, rpe: 8, target: "6" })!;
    expect(adj.dir).toBe("down");
    expect(adj.factor).toBeCloseTo(0.786 / 0.837, 4);
  });

  it("a clear point easier nudges them up half an RPE's worth, never more", () => {
    expect(backoff(5.5)).toBe(400); // half a point is rating noise
    expect(backoff(5)).toBe(410); // 402.4 × 1.0158 = 408.7: 94.3%, inside the coach's 92.5–95%
    expect(backoff(3)).toBe(410); // however easy it was rated
    expect(topSetAdjustment({ reps: 4, rpe: 5, target: "6" })!.factor).toBeCloseTo(1 + (0.786 / 0.762 - 1) / 2, 5);
  });

  it("a range is read from its edges: over the top comes down, a point under the bottom goes up", () => {
    expect(topSetAdjustment({ reps: 4, rpe: 6, target: "5-6" })).toBeNull();
    expect(topSetAdjustment({ reps: 4, rpe: 4.5, target: "5–6" })).toBeNull();
    expect(topSetAdjustment({ reps: 4, rpe: 6.5, target: "5-6" })!.dir).toBe("down");
    expect(topSetAdjustment({ reps: 4, rpe: 4, target: "5-6" })!.dir).toBe("up");
    expect(rpeRange("8–8.5")).toEqual({ lo: 8, hi: 8.5 });
    expect(rpeRange("@6")).toEqual({ lo: 6, hi: 6 });
    expect(rpeRange("")).toBeNull();
  });

  it("the ⓘ says why the weight isn't the plain %", () => {
    const down = plannedLoadView({ percentage: 92.5, basis: "top_set", rpe: "6", unit: "lb", planned: 375, plain: 400, open: 375, linked: { value: 435, unit: "lb" }, adjust: { dir: "down", rpe: 8, target: "6" } })!;
    expect(down.value).toBe("375 lb");
    expect(down.capped).toBe(false);
    expect(down.why[0]).toBe("92.5% of your top set (435 lb) is 402.4 lb, rounded to 400 lb.");
    expect(down.why[1]).toBe("Your top set was RPE 8, over its 6, so back-offs start lighter: 375 lb.");
    const up = plannedLoadView({ percentage: 92.5, basis: "top_set", rpe: "6", unit: "lb", planned: 410, plain: 400, open: 410, linked: { value: 435, unit: "lb" }, adjust: { dir: "up", rpe: 5, target: "6" } })!;
    expect(up.why[1]).toBe("Your top set was RPE 5, a clear point under its 6, so back-offs start a little heavier: 410 lb.");
  });

  it("the card uses it for top-set back-offs only and says it once under the sets", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("const adj = topSetAdjustment({ reps: topSetBasis.reps, rpe: topSetBasis.rpe, target: topSetBasis.target });");
    expect(wdv).toContain("? Math.min(plain, Math.floor(moved / step) * step)");
    expect(wdv).toContain("data-backoff-adjust={backoffPlan.adjust.dir}");
    expect(wdv).toContain("{!capHeld && backoffPlan?.adjust && openSetCount > 0 && !readonly && (");
  });
});
