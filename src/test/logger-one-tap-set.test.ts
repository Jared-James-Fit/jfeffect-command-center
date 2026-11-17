import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";

const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

describe("a set done as suggested is one tap on its number", () => {
  it("the card works out the weight a tap logs: the coach's planned weight, else Suggested while it's on", () => {
    expect(wdv).toContain(": plannedView ? (plannedView.load != null && plannedView.value ? plannedView.load : null)");
    // a range is picked by feel: it never logs on a tap
    expect(wdv).toContain(': showSuggestionCard && canSuggest && loadHint && loadModel && loadModel.status !== "calibrating" && !loadPicks ? loadHint.target');
    // never while the warm-up form is setting today's weight
    expect(wdv).toContain("quickLoad={warmupForm && warmupGauge ? null : quickLoad}");
  });

  it("the weight box stays blank, and the set's number logs the set at the strip's weight", () => {
    expect(wdv).toContain('!isConfirmed && !bw && !hideWeight && loadType === "external" && load === "" && quickLoad != null && quickLoad > 0');
    // no number in the box: the coach wants them blank until the athlete acts
    expect(wdv).not.toContain("suggested={quickWeight");
    expect(wdv).toContain("Log set ${setIndex} at ${quickWeight} ${unit}");
    expect(wdv).toContain("const quick = nextCompletedAt && !bw && !hideWeight ? (opts?.weight ?? quickWeight) : null;");
    expect(wdv).toContain("quick ? persistedLoadForDisplayValue(quick, unit, existing) : persistedLoadForDisplayValue(load, loadUnit, existing)");
    expect(wdv).toContain("load: bw ? 0 : quick ?? load,");
    // the weight that came back from the server isn't a new edit to save again
    expect(wdv).toContain("if (quick) adoptShownAsSaved(true);");
  });

  it("a typed weight still wins, and the box itself stays empty until a tap or a fill", () => {
    expect(wdv).toContain("const [load, setLoad] = useState(existingDisplayLoad);");
    const ghost = renderToStaticMarkup(createElement(WeightValueInput, {
      value: "", isBodyweight: false, unit: "lb", onPick: () => {}, ariaLabel: "Set 2 weight in lb", suggested: 195,
    }));
    expect(ghost).toContain('data-testid="weight-suggested"');
    expect(ghost).toContain("195");
    expect(ghost).toContain("text-blue-700/80");
    expect(ghost).toContain("Set 2 weight in lb, suggested 195 lb");
    const typed = renderToStaticMarkup(createElement(WeightValueInput, {
      value: "185", isBodyweight: false, unit: "lb", onPick: () => {}, ariaLabel: "Set 2 weight in lb", suggested: 195,
    }));
    expect(typed).not.toContain("weight-suggested");
    expect(typed).toContain("185");
  });
});
