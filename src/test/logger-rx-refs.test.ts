import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { LoadSuggestionCard, LoadSuggestionsDone, LoadSuggestionsDoneNote, REF_BAR, REF_CELL } = await import("@/components/workout-day/load-suggestion-card");
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

  it("the prescription is the card's one big line, nothing beside it (Suggested carries its own ⓘ)", () => {
    expect(wdv).toMatch(/runRow \|\| cardioRow \? "text-lg" : "text-2xl"\)\} data-run-rx=\{runRow \|\| undefined\} data-rx>/);
    const rx = wdv.slice(wdv.indexOf("data-rx>"), wdv.indexOf("data-rx-refs"));
    expect(rx).not.toContain("<LoadGuide");
  });

  it("Last time and Suggested are two halves of one quiet strip under it, each once on the card", () => {
    const refs = wdv.slice(wdv.indexOf("data-rx-refs>") - 140, wdv.indexOf("data-rx-refs>") + 1200);
    expect(refs).toContain("<div className={REF_BAR} data-rx-refs>");
    expect(refs).toContain("<PreviousLiftChip");
    expect(refs).toContain("<span aria-hidden=\"true\" className={REF_DIVIDER} />");
    expect(REF_BAR).toContain("rounded-xl bg-muted/50");
    expect(REF_BAR).not.toContain("border");
    expect(REF_CELL).toContain("min-h-[52px]");
    expect(wdv.split("<LoadSuggestionCard ").length).toBe(2);
    expect(wdv.split("<PreviousLiftChip").length).toBe(2);
  });

  it("one tap on Suggested logs the open sets (no weight buttons); its ⓘ is its own button", () => {
    const html = render({ onApply: async () => 1 });
    expect(html).toContain("Tap to log your sets at this weight");
    // information, not a competing primary action: a quiet neutral chip
    expect(html).toContain("rounded-md border border-border bg-background");
    expect(html).not.toMatch(/blue-|bg-primary/);
    expect(html).toContain('data-testid="load-apply"');
    expect(html).toContain("Log your open sets at 250 lb");
    expect(html).toContain('data-testid="load-suggestion-info"');
    expect(html).toMatch(/data-testid="load-target">250[\s\u00a0]lb<\/span>/);
    expect(html).not.toContain("load-pick");
    // a range logs its middle in one tap: no row of weights to choose from
    const ranged = render({ onApply: async () => 1, picks: { low: 240, high: 260, loads: [240, 250, 260] } });
    expect(ranged).toContain("240–260 lb");
    expect(ranged).toContain("Log your open sets at 250 lb");
    expect(ranged).toContain("Tap to log your sets at 250 lb");
    expect(ranged).not.toContain("load-pick");
    // nothing to fill (read-only, every set logged): the whole half opens the explanation
    const readOnly = render({});
    expect(readOnly).not.toContain("load-apply");
    expect(readOnly).toContain("How it&#x27;s worked out");
    expect(wdv).toContain("onApply={!readonly && clientId && openSetCount > 0 ? logOpenSetsAt : null}");
  });

  it("an empty weight box is an open neutral field: where the weight goes, never a colour", () => {
    const input = readFileSync("src/components/workout-day/weight-value-input.tsx", "utf8");
    expect(input).toContain('? "border-muted-foreground/40 bg-background text-muted-foreground"');
    expect(input).not.toMatch(/blue-/);
    // the optional warm-up's box (plain) is lighter than a working set's
    expect(input).toContain('? cn("border-border/40 bg-transparent", isEmpty ? "text-muted-foreground/50" : "text-foreground/80")');
  });

  it("says the reps and RPE only when the prescription above doesn't", () => {
    expect(render({})).toContain("× 5 @ 6");
    expect(render({ showPlan: false })).not.toContain("× ");
    expect(wdv).toContain("const rxSaysPlan = !!loadPlan && repTarget.exact === loadPlan.reps && rpeTarget?.exact === loadPlan.rpe;");
    expect(wdv).toContain("showPlan={!rxSaysPlan}");
  });

  it("how live it is: a dot on the label when live, the words in the explanation", () => {
    expect(render({})).not.toContain("bg-success");
    expect(render({ model: { ...model, source: "today" } })).toContain("bg-success");
  });

  it("a finished card says Next time where Suggested was, and why under the strip", () => {
    const cell = renderToStaticMarkup(createElement(LoadSuggestionsDone, { next: { low: 270, high: 290, target: 280, unit: "lb" }, plan }));
    expect(cell).toContain(">Next time<");
    expect(cell).toContain("280 lb");
    const note = renderToStaticMarkup(createElement(LoadSuggestionsDoneNote, { own: 1.034, next: { low: 270, high: 290, target: 280, unit: "lb" }, plan }));
    expect(note).toContain("All sets in");
    expect(note).toContain(" · ran ");
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
