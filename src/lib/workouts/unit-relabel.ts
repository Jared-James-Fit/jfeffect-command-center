/**
 * Switching an exercise card's unit with weights already on it: were those
 * weights typed in the other unit (a card that opened in kg while they
 * loaded pounds), or does the person want to see them converted? The switch
 * only asks when the card holds a weight in the unit it's leaving, and says
 * both answers with the person's own numbers ("Keep 20 lb" / "20 kg = 44.1
 * lb"), so nobody has to work out which one they mean.
 *
 * Keeping the numbers is a correction: each set and warm-up is saved again
 * with the same number in the new unit, through the logger's own save (never
 * a guess, never a conversion). Converting changes only what's shown; the
 * stored weights stay exactly as they were typed.
 *
 * Pure (tested in unit-relabel.test.ts), plus one short-lived intent the set
 * rows read when the card's unit changes, so every card of the exercise (a
 * top set and its back-offs switch together) keeps its numbers in one go.
 */

export type WeightUnit = "kg" | "lb";

const LB_PER_KG = 2.2046226218;

export type Weighed = { value: number; unit: WeightUnit };

export type UnitSwitchAsk = {
  from: WeightUnit;
  to: WeightUnit;
  /** The weights typed in the unit it's leaving, in the order they're on the card. */
  values: number[];
};

/** "20", "72.5", "142.88" (at most 2 decimals, as typed). */
export function typedNumber(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

function convert(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === "kg" ? value * LB_PER_KG : value / LB_PER_KG;
}

/**
 * What a switch to `to` should ask, or null when there's nothing to ask (no
 * weight on the card is in the other unit: a plain switch).
 */
export function unitSwitchAsk(weights: ReadonlyArray<Weighed>, to: WeightUnit): UnitSwitchAsk | null {
  const from: WeightUnit = to === "kg" ? "lb" : "kg";
  const values = weights
    .filter((w) => w.unit === from && Number.isFinite(w.value) && w.value > 0)
    .map((w) => w.value);
  if (values.length === 0) return null;
  return { from, to, values };
}

/** The numbers, said once each in order: "20", "20 and 25", "20, 25 and 30", "20, 25, 30 and 2 more". */
export function numbersLine(values: ReadonlyArray<number>): string {
  const seen: string[] = [];
  for (const v of values) {
    const t = typedNumber(v);
    if (!seen.includes(t)) seen.push(t);
  }
  if (seen.length === 1) return seen[0];
  if (seen.length <= 3) return `${seen.slice(0, -1).join(", ")} and ${seen[seen.length - 1]}`;
  return `${seen.slice(0, 3).join(", ")} and ${seen.length - 3} more`;
}

/** The two answers in the person's own numbers. */
export function unitSwitchWords(ask: UnitSwitchAsk): {
  title: string;
  question: string;
  keep: { label: string; detail: string };
  convert: { label: string; detail: string };
} {
  const first = ask.values[0];
  const many = ask.values.length > 1;
  const nums = numbersLine(ask.values);
  return {
    title: `Switch to ${ask.to}`,
    question: many
      ? `The weights on this exercise are in ${ask.from} (${nums}). Were they ${ask.to}?`
      : `${typedNumber(first)} ${ask.from} is on this exercise. Was it ${ask.to}?`,
    keep: {
      label: `They were ${ask.to}`,
      detail: many ? `Keep ${nums} as ${ask.to}` : `Keep ${typedNumber(first)} ${ask.to}`,
    },
    convert: {
      label: `Convert to ${ask.to}`,
      detail: `${typedNumber(first)} ${ask.from} = ${typedNumber(Math.round(convert(first, ask.from, ask.to) * 10) / 10)} ${ask.to}`,
    },
  };
}

/**
 * What a set's weight box shows after "They were lb": the number as it is,
 * now in the new unit. A set already stored in the new unit (a mixed card)
 * isn't a mistake: it shows its own number again instead of the converted
 * one the box held a moment ago.
 */
export function relabeledLoad(
  shown: string,
  previousUnit: WeightUnit,
  nextUnit: WeightUnit,
  stored: { value: number | null; unit: WeightUnit | null } | null,
): string {
  const n = Number(shown);
  if (shown.trim() === "" || !Number.isFinite(n)) return shown;
  if (stored && stored.value != null && stored.unit === nextUnit && previousUnit !== nextUnit) {
    const shownAsStored = convert(n, previousUnit, nextUnit);
    if (Math.abs(shownAsStored - stored.value) < 0.01) return typedNumber(stored.value);
  }
  return shown;
}

/* ------------------------------------------------------------------ */
/*  The intent the set rows read                                      */
/* ------------------------------------------------------------------ */

/** How long a "keep the numbers" switch stays in force for the rows re-rendering in its new unit. */
export const RELABEL_WINDOW_MS = 4000;

let intent: { unit: WeightUnit; at: number } | null = null;

/** The next switch to `unit` keeps every weight's number (they were typed in it). */
export function markRelabel(unit: WeightUnit, now: number = Date.now()): void {
  intent = { unit, at: now };
}

/** A plain switch (convert): forget any earlier "keep the numbers". */
export function clearRelabel(): void {
  intent = null;
}

/** Whether a row whose unit just became `unit` should keep its number instead of converting it. */
export function relabelIntent(unit: WeightUnit, now: number = Date.now()): boolean {
  return !!intent && intent.unit === unit && now - intent.at >= 0 && now - intent.at < RELABEL_WINDOW_MS;
}
