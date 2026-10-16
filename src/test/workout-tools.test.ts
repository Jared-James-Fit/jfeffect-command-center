import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CALC_START, calcReducer, formatCalc, type CalcKey } from "@/lib/calculator";
import { estimateOneRepMax } from "@/lib/final-warmup";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { E1rmTool, CalculatorTool } = await import("@/components/workout-tools/lifting-math");
const { ToolsPicker, TOOLS, toolStatus, WorkoutToolsProvider, useWorkoutToolsActions } = await import("@/components/workout-tools/workout-tools");
const { ExerciseActionRow } = await import("@/components/workout-day/exercise-action-row");
const { emptyStopwatch, emptyTimer } = await import("@/lib/workout-tools/timing");

const run = (...keys: (string | CalcKey)[]) =>
  keys.reduce((s, k) => calcReducer(s, typeof k !== "string" ? k
    : /^[0-9]$/.test(k) ? { type: "digit", digit: k }
    : k === "." ? { type: "dot" }
    : k === "=" ? { type: "equals" }
    : k === "%" ? { type: "percent" }
    : k === "C" ? { type: "clear" }
    : k === "<" ? { type: "back" }
    : { type: "op", op: k as any }), CALC_START);

describe("plain calculator", () => {
  it("does the usual math, left to right", () => {
    expect(run("3", "1", "5", "×", "2", "=").display).toBe("630");
    expect(run("1", "0", "0", "+", "2", "5", "×", "2", "=").display).toBe("250");
    expect(run("2", "2", "5", "÷", "4", "=").display).toBe("56.25");
    expect(run("0", ".", "1", "+", "0", ".", "2", "=").display).toBe("0.3");
  });
  it("percent: 315 × 85 % = 267.75; 200 + 10 % = 220", () => {
    expect(run("3", "1", "5", "×", "8", "5", "%", "=").display).toBe("267.75");
    expect(run("3", "1", "5", "×", "8", "5", "%", "=").note).toBe("315 × 85% =");
    expect(run("2", "0", "0", "+", "1", "0", "%", "=").display).toBe("220");
  });
  it("one-tap kg ⇄ lb", () => {
    expect(run("1", "7", "5", { type: "convert", from: "kg" }).display).toBe("385.81");
    expect(run("3", "1", "5", { type: "convert", from: "lb" }).display).toBe("142.88");
    expect(run("1", "7", "5", { type: "convert", from: "kg" }).note).toBe("175 kg → lb");
  });
  it("delete, clear, divide by zero, operator swap", () => {
    expect(run("1", "2", "3", "<").display).toBe("12");
    expect(run("9", "C").display).toBe("0");
    expect(run("5", "÷", "0", "=").display).toBe("Error");
    expect(run("8", "+", "×", "2", "=").display).toBe("16");
    expect(formatCalc(1 / 3)).toBe("0.333333");
  });
});

describe("Workout Tools: one sheet for the whole workout, plain labels", () => {
  const idle = { tally: 0, stopwatch: emptyStopwatch(), timer: emptyTimer(60) };
  it("groups the tools by job, each with a one-line description", () => {
    const html = renderToStaticMarkup(createElement(ToolsPicker, { state: idle, go() {} }));
    const order = ["Lifting math", "Calculator", "e1RM", "Timers &amp; counting", "Timer", "Stopwatch", "Tally"].map((t) => html.indexOf(`>${t}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const t of Object.values(TOOLS)) expect(html).toContain(t.desc.replace("&", "&amp;").replace("⇄", "⇄"));
    expect(html).toContain("Rest timers are separate");
  });
  it("shows what a running tool is doing right on its row", () => {
    const now = 1_000_000;
    const busy = { tally: 7, stopwatch: { startedAt: now - 65_000, accumulatedMs: 0 }, timer: { durationSec: 90, endsAt: now + 83_000, pausedRemainingMs: null } };
    expect(toolStatus("tally", busy, now)).toBe("7");
    expect(toolStatus("stopwatch", busy, now)).toBe("01:05");
    expect(toolStatus("timer", busy, now)).toBe("01:23 left");
    expect(toolStatus("timer", idle, now)).toBeNull();
    expect(toolStatus("tally", idle, now)).toBeNull();
  });
  it("e1RM opens on today's first lift and offers every lift as a one-tap fill", () => {
    const picks = [
      { rowId: "a", name: "Competition Squat", order: 1, unit: "lb" as const, e1rm: 405, from: { load: 315, reps: 5, rpe: 6 } },
      { rowId: "b", name: "Larsen Press", order: 2, unit: "kg" as const, e1rm: 120, from: { load: 100, reps: 5, rpe: 8 } },
    ];
    const html = renderToStaticMarkup(createElement(E1rmTool, { picks, defaultUnit: "lb" }));
    expect(html).toContain("Today&#x27;s best sets");
    expect(html.match(/data-testid="e1rm-pick"/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('value="315"');
    expect(html).toContain('value="6"');
    expect(html).toContain(`≈ ${estimateOneRepMax({ load: 315, reps: 5, rpe: 6 }, "lb")} lb`);
    expect(html).toContain("RPE 6 · about 4 reps left");
  });
  it("e1RM with nothing logged yet starts blank in the athlete's unit", () => {
    const html = renderToStaticMarkup(createElement(E1rmTool, { picks: [], defaultUnit: "kg" }));
    expect(html).not.toContain("Today&#x27;s best sets");
    expect(html).toContain('aria-label="Weight in kg"');
    expect(html).toContain("Enter weight × reps");
  });
  it("calculator has its own keypad and converts to the other unit", () => {
    const html = renderToStaticMarkup(createElement(CalculatorTool, { unit: "lb", state: CALC_START, press() {} }));
    expect(html).toContain('data-testid="calc-display"');
    expect(html).toContain("lb→kg");
    expect(html).not.toContain("<input");
  });
  it("every tool is one tap from any card's ⋯ menu, in the card's unit (nothing on the card itself)", () => {
    const row = renderToStaticMarkup(createElement(ExerciseActionRow, {
      name: "Squat", howTo: null, hasNote: false, onOpenNote() {}, moreMenu: null, rest: null,
    }));
    expect(row).not.toContain('aria-label="Calculator"');
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("<CardToolsRow unit={activeUnit} />");
    const tools = readFileSync("src/components/workout-tools/workout-tools.tsx", "utf8");
    expect(tools).toContain("onSelect={() => tools.open({ tool: key, unit })}");
    for (const key of ["calc", "e1rm", "timer", "stopwatch", "tally"]) expect(tools).toContain(`{ key: "${key}", label:`);
    // the running one carries a dot; it's rendered only while the menu is open
    expect(tools).toContain("status?.active === key");
  });
  it("no Tools button at the top of the workout any more (Warm-Up and List / Focus only)", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).not.toContain("<WorkoutToolsButton");
    expect(readFileSync("src/components/workout-tools/workout-tools.tsx", "utf8")).not.toContain("export function WorkoutToolsButton");
  });
  it("exercise cards use the actions without subscribing to the ticking status", () => {
    let seen: unknown = undefined;
    const Probe = () => { seen = useWorkoutToolsActions(); return null; };
    renderToStaticMarkup(createElement(WorkoutToolsProvider, { scopeKey: "d1", children: createElement(Probe) }));
    expect(seen).toMatchObject({ open: expect.any(Function), reportE1rm: expect.any(Function) });
  });
});
