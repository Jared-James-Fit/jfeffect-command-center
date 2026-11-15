import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { LoadGuide, LoadSuggestionCard, LoadSuggestionsDone, REF_TEXT } = await import("@/components/workout-day/load-suggestion-card");
const { ExerciseActionRow } = await import("@/components/workout-day/exercise-action-row");
const { restWords } = await import("@/components/workout-day/RestTimerButton");

const hint = { low: 240, high: 260, target: 250, unit: "lb" as const };
const model: any = { status: "ok", source: "history", historySessions: 6, early: false, dayFactor: null, readiness: { reasons: [] }, staleDays: 0, carried: false };
const plan = { reps: 5, rpe: 6 };
const render = (props: any) => renderToStaticMarkup(createElement(LoadSuggestionCard, { hint, model, plan, ...props }));
const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

describe("the card's top: name, role, the prescription, then Last / Suggested", () => {
  it("the name with its unit as one word top right, the role in plain words, no number tile or chip", () => {
    expect(wdv).toContain('data-exercise-name>{name}</div>');
    expect(wdv).toContain("<UnitSwitch unit={activeUnit} onChange={handleUnitToggle} />");
    expect(wdv).toContain("<span data-exercise-role>{purposeLabelText(purposeLabel || category)}</span>");
    expect(wdv).not.toContain("<ExerciseOrderBadge");
    expect(wdv).not.toContain("<UnitToggle");
  });

  it("the prescription is the card's one big line, with the Load guide beside it", () => {
    expect(wdv).toMatch(/runRow \|\| cardioRow \? "text-lg" : "text-2xl"\)\} data-run-rx=\{runRow \|\| undefined\} data-rx>/);
    const rx = wdv.slice(wdv.indexOf("data-rx>"), wdv.indexOf("data-rx-refs"));
    expect(rx).toContain("<LoadGuide hint={loadHint}");
  });

  it("Last and Suggested share one line under it (two when they don't fit), each once on the card", () => {
    const refs = wdv.slice(wdv.indexOf("data-rx-refs>") - 140, wdv.indexOf("data-rx-refs>") + 2400);
    expect(refs).toContain("flex-wrap");
    expect(refs).toContain("justify-between");
    expect(refs).toContain("<PreviousLiftChip");
    expect(refs).toContain("<LoadSuggestionCard");
    expect(refs).toContain("<LoadSuggestionsDone");
    expect(wdv.split("<LoadSuggestionCard ").length).toBe(2);
    expect(wdv.split("<PreviousLiftChip").length).toBe(2);
    expect(wdv).toContain("const body = <>Last: <span className=\"tabular-nums\">{shownLoad}{repsStr}{effortStr}</span></>;");
  });

  it("Suggested is the tap that fills the sets (a range opens its weights), never a box", () => {
    const html = render({ onApply: async () => 1 });
    expect(html).toContain("Suggested: ");
    expect(html).toContain('data-testid="load-apply"');
    expect(html).toContain('aria-label="Suggested 250 lb. Put it in your sets"');
    expect(html).toContain(REF_TEXT);
    expect(html).not.toContain("rounded-lg border");
    expect(render({ onApply: async () => 1, picks: { low: 240, high: 260, loads: [240, 250, 260] } })).toContain("Choose a weight for your sets");
    expect(render({})).not.toContain('data-testid="load-apply"');
  });

  it("says the reps and RPE only when the prescription above doesn't", () => {
    expect(render({})).toContain("× ");
    expect(render({ showPlan: false })).not.toContain("× ");
    expect(wdv).toContain("const rxSaysPlan = !!loadPlan && repTarget.exact === loadPlan.reps && rpeTarget?.exact === loadPlan.rpe;");
    expect(wdv).toContain("showPlan={!rxSaysPlan}");
  });

  it("how live it is lives in the Load guide, never on the line", () => {
    expect(render({ onApply: async () => 1 }, )).not.toContain('data-testid="load-badge"');
    const guide = renderToStaticMarkup(createElement(LoadGuide, { hint, model, plan }));
    expect(guide).toContain("Load guide");
    expect(renderToStaticMarkup(createElement(LoadGuide, { hint: null, model, plan }))).toBe("");
  });

  it("a finished card says Next time where Suggested was, and why under it", () => {
    const html = renderToStaticMarkup(createElement(LoadSuggestionsDone, { own: 1.034, next: { low: 270, high: 290, target: 280, unit: "lb" }, plan }));
    expect(html).toContain("Next time: ");
    expect(html).toContain("All sets in");
    expect(html).toContain(" · ran ");
    expect(html).toContain("basis-full");
  });
});

describe("the action row: Rest on the left, quiet icons on the right", () => {
  it("rest in words", () => {
    expect(restWords(180)).toBe("Rest 3 min");
    expect(restWords(150)).toBe("Rest 2:30");
    expect(restWords(45)).toBe("Rest 45 s");
    expect(restWords(0)).toBeNull();
    expect(restWords(null)).toBeNull();
  });

  it("How To · Note · rest timer · More, borderless, after a hairline", () => {
    const html = renderToStaticMarkup(createElement(ExerciseActionRow, {
      name: "Squat", howTo: null, hasNote: true, onOpenNote() {}, moreMenu: null, rest: null, restLabel: "Rest 3 min",
    }));
    expect(html).toContain("border-t");
    expect(html).toContain("Rest 3 min");
    expect(html).not.toContain("border border-border bg-card");
    expect(html).not.toContain("bg-primary");
    expect(wdv).toContain("restLabel={(exerciseId || name) ? restParts.label : null}");
    expect(wdv).toContain("iconOnly");
  });

  it("the running countdown is neutral: red stays the screen's one main action", () => {
    const timer = readFileSync("src/components/workout-day/RestTimerButton.tsx", "utf8");
    expect(timer).not.toContain("primary");
  });
});
