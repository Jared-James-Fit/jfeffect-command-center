import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CALC_START, calcReducer, formatCalc, type CalcKey } from "@/lib/calculator";
import { estimateOneRepMax } from "@/lib/final-warmup";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { E1rmPanel, CalculatorPanel } = await import("@/components/workout-day/card-tools");
const { ExerciseActionRow } = await import("@/components/workout-day/exercise-action-row");

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

describe("card tools: inline panels under the chips", () => {
  it("e1RM opens on today's best set — the same number as the chip", () => {
    const sets = [{ load: 315, reps: 5, rpe: 6 }];
    const html = renderToStaticMarkup(createElement(E1rmPanel, { sets, unit: "lb", onClose() {} }));
    expect(html).toContain('value="315"');
    expect(html).toContain('value="6"');
    expect(html).toContain(`≈ ${estimateOneRepMax(sets[0], "lb")} lb`);
    expect(html).toContain("RPE 6 · about 4 reps left");
  });
  it("calculator has its own keypad and converts to the other unit", () => {
    const html = renderToStaticMarkup(createElement(CalculatorPanel, { unit: "lb", onClose() {} }));
    expect(html).toContain('data-testid="calc-display"');
    expect(html).toContain("lb→kg");
    expect(html).not.toContain("<input");
    const row = renderToStaticMarkup(createElement(ExerciseActionRow, {
      name: "Squat", howTo: null, hasNote: false, onOpenNote() {}, moreMenu: null, rest: null,
      calculator: { open: false, onToggle() {} },
    }));
    expect(row).toContain('aria-label="Calculator"');
    expect(row).toContain('aria-expanded="false"');
  });
  it("lives on every card's action row, one tool open at a time", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain('calculator={{ open: cardTool === "calc", onToggle: () => toggleCardTool("calc") }}');
    expect(wdv).toContain("const toggleCardTool = (t: CardTool) => setCardTool((cur) => (cur === t ? null : t));");
  });
});
