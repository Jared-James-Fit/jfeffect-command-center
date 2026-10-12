/**
 * A plain gym calculator (the "regular calculator" on exercise cards): add,
 * subtract, multiply, divide, percent, and one tap kg ⇄ lb. Immediate
 * execution like a phone calculator ("315 × 85 % =" → 267.75). Pure reducer so
 * it is unit tested; the keypad is the UI.
 */
export type CalcOp = "+" | "−" | "×" | "÷";
export type CalcKey =
  | { type: "digit"; digit: string }
  | { type: "dot" }
  | { type: "op"; op: CalcOp }
  | { type: "equals" }
  | { type: "percent" }
  | { type: "clear" }
  | { type: "back" }
  | { type: "convert"; from: "kg" | "lb" };

export type CalcState = {
  /** What the display shows (the number being typed, or a result). */
  display: string;
  /** Left-hand side waiting for the next number. */
  acc: number | null;
  op: CalcOp | null;
  /** The next digit starts a new number (after an operator, =, or a conversion). */
  fresh: boolean;
  /** Small line above the display: "315 × 85% =", "175 kg → lb". */
  note: string;
  /** How the number on display was typed when it came from %, for the note ("85%"). */
  pct?: string | null;
};

export const CALC_START: CalcState = { display: "0", acc: null, op: null, fresh: true, note: "" };
const LB_PER_KG = 2.2046226218;
const MAX_DIGITS = 10;

/** 0.1 + 0.2 → "0.3"; 1/3 → "0.333333"; errors → "Error". */
export function formatCalc(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round(n * 1e6) / 1e6;
  const s = String(rounded === 0 ? 0 : rounded);
  return s.includes("e") ? rounded.toPrecision(8) : s;
}

function apply(a: number, op: CalcOp, b: number): number {
  switch (op) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return b === 0 ? NaN : a / b;
  }
}

const num = (s: CalcState) => (s.display === "Error" ? 0 : Number(s.display));

export function calcReducer(s: CalcState, key: CalcKey): CalcState {
  switch (key.type) {
    case "clear":
      return CALC_START;
    case "digit": {
      if (s.fresh || s.display === "0" || s.display === "Error") return { ...s, display: key.digit, fresh: false, pct: null };
      if (s.display.replace(/[-.]/g, "").length >= MAX_DIGITS) return s;
      return { ...s, display: s.display + key.digit };
    }
    case "dot": {
      if (s.fresh || s.display === "Error") return { ...s, display: "0.", fresh: false };
      return s.display.includes(".") ? s : { ...s, display: s.display + "." };
    }
    case "back": {
      if (s.fresh || s.display === "Error") return s;
      const next = s.display.slice(0, -1);
      return { ...s, display: next === "" || next === "-" ? "0" : next };
    }
    case "op": {
      // Changing your mind about the operator: just swap it.
      if (s.op && s.fresh && s.acc != null) return { ...s, op: key.op, note: `${formatCalc(s.acc)} ${key.op}` };
      const value = s.op && s.acc != null ? apply(s.acc, s.op, num(s)) : num(s);
      if (!Number.isFinite(value)) return { ...CALC_START, display: "Error" };
      return { display: formatCalc(value), acc: value, op: key.op, fresh: true, note: `${formatCalc(value)} ${key.op}` };
    }
    case "equals": {
      if (!s.op || s.acc == null) return { ...s, fresh: true };
      const b = num(s);
      const value = apply(s.acc, s.op, b);
      return {
        display: formatCalc(value), acc: null, op: null, fresh: true,
        note: `${formatCalc(s.acc)} ${s.op} ${s.pct ?? formatCalc(b)} =`,
      };
    }
    case "percent": {
      // 315 × 85 % → 0.85 (so = gives 267.75); 200 + 10 % → 20 (10% of 200).
      const b = num(s);
      const value = s.acc != null && (s.op === "+" || s.op === "−") ? (s.acc * b) / 100 : b / 100;
      return { ...s, display: formatCalc(value), fresh: true, pct: `${formatCalc(b)}%` };
    }
    case "convert": {
      const b = num(s);
      const value = key.from === "kg" ? b * LB_PER_KG : b / LB_PER_KG;
      const to = key.from === "kg" ? "lb" : "kg";
      return {
        display: formatCalc(Math.round(value * 100) / 100), acc: null, op: null, fresh: true,
        note: `${formatCalc(b)} ${key.from} → ${to}`,
      };
    }
  }
}
