import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjustRestTimer,
  claimRestDoneCue,
  pauseRestTimer,
  readRestAutoStart,
  readRestTimer,
  restFinished,
  restHosts,
  restRemainingMs,
  setRestAutoStart,
  startRestTimer,
} from "@/lib/rest-timer-store";
import { suggestKind } from "@/lib/equipment/equipment";
import { boxLabel, boxStep } from "@/components/workout-day/set-keyboard-bar";
import { RestLine } from "@/components/workout-day/RestTimerButton";

const read = (p: string) => readFileSync(p, "utf8");

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe("one rest per workout (rest-timer-store.ts)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("−15 / +15 move a running rest's end, never below now", () => {
    const t0 = Date.now();
    startRestTimer("d1", "r1", 120, t0);
    let s = adjustRestTimer("d1", 15, t0 + 10_000)!;
    expect(restRemainingMs(s, t0 + 10_000)).toBe(125_000);
    expect(s.durationSeconds).toBe(135);
    s = adjustRestTimer("d1", -15, t0 + 10_000)!;
    expect(restRemainingMs(s, t0 + 10_000)).toBe(110_000);
    // more off than is left ends it now
    s = adjustRestTimer("d1", -600, t0 + 10_000)!;
    expect(restFinished(s, t0 + 10_000)).toBe(true);
  });

  it("a paused rest keeps more or less; a finished one starts again with the time added", () => {
    const t0 = Date.now();
    startRestTimer("d2", "r1", 60, t0);
    pauseRestTimer("d2", t0 + 20_000);
    let s = adjustRestTimer("d2", 15, t0 + 30_000)!;
    expect(s.pausedRemainingMs).toBe(55_000);
    s = adjustRestTimer("d2", -100, t0 + 30_000)!;
    expect(s.pausedRemainingMs).toBe(0);

    startRestTimer("d3", "r1", 60, t0);
    s = adjustRestTimer("d3", 15, t0 + 90_000)!; // finished 30 s ago
    expect(restRemainingMs(s, t0 + 90_000)).toBe(15_000);
    expect(adjustRestTimer("d3", -15, t0 + 200_000)).toEqual(readRestTimer("d3"));
  });

  it("the end-of-rest cue plays once, however many cards show it", () => {
    const s = { startedAt: 1, endsAt: 2 };
    expect(claimRestDoneCue("d4", s)).toBe(true);
    expect(claimRestDoneCue("d4", s)).toBe(false);
    expect(claimRestDoneCue("d4", { startedAt: 3, endsAt: 4 })).toBe(true);
  });

  it("starts by itself after a set unless turned off (this phone)", () => {
    expect(readRestAutoStart()).toBe(true);
    setRestAutoStart(false);
    expect(readRestAutoStart()).toBe(false);
    setRestAutoStart(true);
    expect(readRestAutoStart()).toBe(true);
  });
});

describe("where a rest shows (restHosts)", () => {
  const order = [
    { id: "squat", open: false },
    { id: "rdl", open: true },
    { id: "press", open: true },
  ];
  it("on its own card while that card has sets to log", () => {
    expect(restHosts(order, "rdl")).toEqual(["rdl"]);
  });
  it("once the exercise is done, on the next one up too (where the next set is)", () => {
    expect(restHosts(order, "squat")).toEqual(["squat", "rdl"]);
    expect(restHosts([{ id: "a", open: false }, { id: "b", open: false }, { id: "c", open: true }], "a")).toEqual(["a", "c"]);
  });
  it("the last exercise, or a card the list doesn't know, keeps it to itself", () => {
    expect(restHosts([{ id: "a", open: true }, { id: "b", open: false }], "b")).toEqual(["b"]);
    expect(restHosts(order, "cardio")).toEqual(["cardio"]);
  });
});

describe("the rest line over the sets", () => {
  it("before it starts: the prescribed rest in words, one tap to start", () => {
    const html = renderToStaticMarkup(createElement(RestLine, { seconds: 180, scopeKey: "d9", timerId: "r1" }));
    expect(html).toContain('data-rest-line="idle"');
    expect(html).toContain("Rest 3 min");
    expect(html).toContain("data-rest-start");
    // red stays the screen's one main action
    expect(html).not.toContain("primary");
  });
  it("a finished card offers no rest to start, only its icons", () => {
    const html = renderToStaticMarkup(createElement(RestLine, { seconds: 180, scopeKey: "d9", timerId: "r1", idle: false }, createElement("span", null, "icons")));
    expect(html).toContain('data-rest-line="off"');
    expect(html).not.toContain("Rest 3 min");
    expect(html).toContain("icons");
  });
  it("the logger has one rest: the card's watcher starts it, the review stops it, no second provider", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).not.toContain("ActiveRestTimerProvider");
    expect(wdv).not.toContain("onSetCompleted");
    // with the set's own moment (feedback.ts: new and fresh), so a refetch's replay never restarts it
    expect(wdv).toContain("if (moment && restAuto && restOrder && effectiveRest && effectiveRest > 0) startWorkoutRest(dayId, restRowId, effectiveRest);");
    expect(wdv).toContain("clearRestTimer(dayId);");
    expect(wdv).toContain("<RestLine");
    expect(wdv).toContain('data-testid="card-rest-auto"');
    // right above the set table
    expect(wdv.indexOf("</RestLine>")).toBeLessThan(wdv.indexOf('<div className={cn("mt-1 overflow-hidden rounded-md border border-builder-card-border bg-builder-inset"'));
  });
});

describe("the setup line under the name", () => {
  it("a dumbbell or kettlebell lift is never read as a rack lift", () => {
    expect(suggestKind({ name: "Bulgarian Split Squat", equipment: "Dumbbell" })).toBeNull();
    expect(suggestKind({ name: "Goblet Squat", equipment: "Kettlebell" })).toBeNull();
    expect(suggestKind({ name: "Barbell Split Squat", equipment: "Barbell" })).toBe("rack");
  });
  it("is on every card someone can change it on, whatever the exercise (Nov 26 2026); never required to log", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain('cardSetup.summary || cardSetup.photo || cardSetup.mode !== "view"');
    expect(wdv).not.toContain("offersSetup(");
  });
});

describe("the keyboard bar", () => {
  it("names the box being typed in", () => {
    expect(boxLabel("Set 2 weight in lb — weight in lb")).toBe("Set 2 · Weight in lb");
    expect(boxLabel("Set 1 reps")).toBe("Set 1 · Reps");
    expect(boxLabel("Set 3 RPE")).toBe("Set 3 · RPE");
    expect(boxLabel("Warm-up RPE (optional)")).toBe("Warm-up · RPE (optional)");
  });
  it("steps through the card's boxes in reading order and stops at either end", () => {
    const boxes = ["w1", "r1", "e1", "w2"];
    expect(boxStep(boxes, "e1", 1)).toBe("w2");
    expect(boxStep(boxes, "e1", -1)).toBe("r1");
    expect(boxStep(boxes, "w2", 1)).toBeNull();
    expect(boxStep(boxes, "w1", -1)).toBeNull();
    expect(boxStep(boxes, "x", 1)).toBeNull();
  });
  it("Focus's bars step aside while typing and come back when the keyboard closes", () => {
    const css = read("src/styles.css");
    expect(css).toContain('html[data-keyboard-open="true"] [data-testid="story-bottom"] { visibility: hidden; transition: none; }');
    expect(read("src/components/workout-day/WorkoutDayView.tsx")).toContain("{!readonly && <SetKeyboardBar />}");
  });
});
