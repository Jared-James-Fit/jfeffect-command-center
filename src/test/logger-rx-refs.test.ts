import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { LoadSuggestionCard, LoadSuggestionsDone, REF_LABEL, REF_ROW } = await import("@/components/workout-day/load-suggestion-card");

const hint = { low: 240, high: 260, target: 250, unit: "lb" as const };
const model: any = { status: "ok", source: "history", historySessions: 6, early: false, dayFactor: null, readiness: { reasons: [] }, staleDays: 0, carried: false };
const plan = { reps: 5, rpe: 6 };
const render = (props: any) => renderToStaticMarkup(createElement(LoadSuggestionCard, { hint, model, plan, ...props }));

describe("Last time and Suggested sit under the prescription as plain lines", () => {
  it("are two rows in one label column, inside the prescription's group, never boxes", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const group = wdv.slice(wdv.indexOf("data-rx-refs"), wdv.indexOf("data-rx-refs") + 2600);
    expect(group).toContain("<PreviousLiftChip");
    expect(group).toContain("<LoadSuggestionCard");
    expect(group).toContain("<LoadSuggestionsDone");
    // each appears once on the card
    expect(wdv.split("<LoadSuggestionCard ").length).toBe(2);
    expect(wdv.split("<PreviousLiftChip").length).toBe(2);
    expect(wdv).not.toContain("rounded-md border border-border bg-muted/50 px-2 py-1 text-xs");
    const html = render({ onApply: async () => 1 });
    expect(html).not.toContain("rounded-lg border");
    expect(html).toContain(REF_ROW);
    expect(html).toContain(REF_LABEL);
  });

  it("says the reps and RPE only when the prescription above doesn't", () => {
    expect(render({})).toContain("× 5 @ 6");
    expect(render({ showPlan: false })).not.toContain("× 5 @ 6");
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("const rxSaysPlan = !!loadPlan && repTarget.exact === loadPlan.reps && rpeTarget?.exact === loadPlan.rpe;");
    expect(wdv).toContain("showPlan={!rxSaysPlan}");
  });

  it("applying is a visible Use (Pick for a range), and nothing to fill offers neither", () => {
    expect(render({ onApply: async () => 1 })).toMatch(/data-testid="load-apply"[^>]*>.*Use</);
    expect(render({ onApply: async () => 1, picks: { low: 240, high: 260, loads: [240, 250, 260] } })).toMatch(/data-testid="load-apply"[^>]*>.*Pick</);
    expect(render({})).not.toContain('data-testid="load-apply"');
  });

  it("what follows the weight wraps on a narrow phone instead of being cut", () => {
    const html = render({});
    expect(html).toContain("flex-wrap");
    expect(html).not.toMatch(/data-testid="load-badge"[^>]*truncate/);
  });

  it("a finished card says so in the same place", () => {
    const html = renderToStaticMarkup(createElement(LoadSuggestionsDone, { own: 1.034 }));
    expect(html).toContain("Today");
    expect(html).toContain("All sets in");
    expect(html).toContain("ran <");
    expect(html).not.toContain("bg-muted px-2");
  });
});
