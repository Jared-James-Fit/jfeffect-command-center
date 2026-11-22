/**
 * An AI read of a meal plan, checked against what was given (the program
 * importer's idea, program-import/ai.ts `groundingFlags`, for meals): the AI
 * only copies, so every number it wrote and every word of every food must be
 * in the source. A number that isn't (an amount, a macro, a total it worked
 * out) or a food word that isn't ("cooked" added to "100 g rice", which
 * triples its calories) is flagged for the person, never trusted. The meal
 * numbering ("Meal 2") and the day headers are the format's, not the plan's,
 * so they're never checked. Pure.
 */
import { MEAL_HEADER } from "@/lib/nutrition-targets/meal-plan-structure";
import { DAILY_TOTAL_HEADING, readMacroLine } from "@/lib/nutrition-targets/macro-line";
import { planDays } from "./read";
import type { MealFlag } from "./types";

const FRACTION: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅕": 0.2 };
const WORD_NUMBER: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, half: 0.5, quarter: 0.25,
};

const key = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The numbers a text says. With `generous` (the source), every way a number
 * could be read counts: "1,200" as 1200 and 1.2, "1/2" as 0.5 and its parts,
 * "two" as 2. Without (the plan), only what a reader would take it to mean.
 */
export function numbersIn(text: string, generous = false): number[] {
  const out: number[] = [];
  let s = String(text ?? "");
  // "1½", "½"
  s = s.replace(/(\d+)?\s*([½¼¾⅓⅔⅛⅕])/g, (_, w: string | undefined, f: string) => {
    out.push((w ? Number(w) : 0) + FRACTION[f]);
    if (w && generous) out.push(Number(w));
    return " ";
  });
  // "1 1/2"
  s = s.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, w: string, a: string, b: string) => {
    if (Number(b)) out.push(Number(w) + Number(a) / Number(b));
    // the source may mean two things ("Meal 1 1/2 bagel"): both readings count
    if (generous) out.push(Number(w), Number(a), Number(b), ...(Number(b) ? [Number(a) / Number(b)] : []));
    return " ";
  });
  // "1/2"
  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, (_, a: string, b: string) => {
    if (Number(b)) out.push(Number(a) / Number(b));
    if (generous) out.push(Number(a), Number(b));
    return " ";
  });
  for (const m of s.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const t = m[0];
    if (t.includes(",")) {
      const [a, b] = t.split(",");
      if (b.length === 3) out.push(Number(a + b));
      if (generous || b.length !== 3) out.push(Number(`${a}.${b}`));
    } else out.push(Number(t));
  }
  if (generous)
    for (const w of s.toLowerCase().match(/[a-z]+/g) ?? []) if (WORD_NUMBER[w] != null) out.push(WORD_NUMBER[w]);
  return out.filter((n) => Number.isFinite(n));
}

/** Words that say how much or how it's measured, never what the food is. */
const MEASURE_WORDS = new Set(
  "cup cups tbsp tbs tsp tablespoon tablespoons teaspoon teaspoons gram grams gr kg kilo oz ounce ounces lb lbs pound pounds ml litre liter litres liters slice slices scoop scoops piece pieces serving servings portion portions each whole large medium small can cans tin tins packet packets pack handful handfuls and with the for about approx approximately plus some".split(
    " ",
  ),
);

/** A word as compared: lower case, plurals folded ("berries" → "berry", "potatoes" → "potato"). */
export function stem(w: string): string {
  const s = w.toLowerCase();
  if (s.length > 4 && s.endsWith("ies")) return `${s.slice(0, -3)}y`;
  if (s.length > 4 && s.endsWith("oes")) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
  return s;
}

const wordsOf = (s: string) => (s.toLowerCase().match(/[a-zà-ÿ]+/g) ?? []).map(stem);

export type SourceIndex = { numbers: Set<number>; words: Set<string>; flat: string };

/** What the source says, ready to check against. */
export function indexSource(source: string): SourceIndex {
  return {
    numbers: new Set(numbersIn(source, true).map(key)),
    words: new Set(wordsOf(source)),
    flat: wordsOf(source).join(""),
  };
}

const MENU_LINE = (t: string) => /MENU\s*$/i.test(t) && t.length < 80 && !/^meal/i.test(t);
const MACROS_LABEL = /^approx(?:imate)?\.?\s*(?:macros?)?\s*[:.]?$/i;
const KCAL_LINE = /^(?:about\s+|approx(?:imately)?\.?\s+)?\d[\d,.]*\s*(?:k?cals?|calories)\.?$/i;

const fmt = (n: number) => String(key(n));
const short = (l: string) => (l.length > 60 ? `${l.slice(0, 59)}…` : l);

/**
 * Where an AI-read plan isn't backed by its source. Each flag names the day,
 * the meal and the line. A source that's empty (nothing to check against)
 * gives one `unchecked` flag instead.
 */
export function planGroundingFlags(planText: string, source: string | null | undefined, opts: { max?: number } = {}): MealFlag[] {
  const max = opts.max ?? 30;
  if (!source?.trim()) {
    return [{ level: "info", code: "unchecked", text: "There was no text to check this against, so compare every amount with your file before you save." }];
  }
  const src = indexSource(source);
  const labels = planDays(planText).map((d) => d.day_label);
  const out: MealFlag[] = [];
  const seen = new Set<string>();
  let day = "";
  let dayIdx = -1;
  let meal = "";
  let inNotes = false;
  const add = (f: MealFlag) => {
    const k = `${f.code}|${f.text}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };
  const where = () => (inNotes ? "Notes" : [day, meal].filter(Boolean).join(" · ") || "The plan");
  const checkNumbers = (line: string, text: string) => {
    for (const n of numbersIn(text)) {
      if (src.numbers.has(key(n))) continue;
      add({ level: "check", code: "not_in_file", day: day || undefined, text: `${where()}: ${fmt(n)} in "${short(line)}" isn't in your file` });
    }
  };

  for (const raw of planText.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/^[-*•·]\s*/, "").trim();
    if (!line) continue;
    if (/^FOOD[- ]?WEIGHING\b/i.test(line)) {
      inNotes = true;
      meal = "";
      continue;
    }
    if (!inNotes && MENU_LINE(line)) {
      dayIdx++;
      day = labels[dayIdx] ?? line.replace(/\s*MENU\s*$/i, "");
      meal = "";
      continue;
    }
    if (/^PHASE\s*[:\-]/i.test(line) || MACROS_LABEL.test(line)) continue;
    if (DAILY_TOTAL_HEADING.test(line) && !/\d/.test(line)) {
      meal = "Daily Total";
      continue;
    }
    const header = inNotes ? null : line.match(MEAL_HEADER);
    if (header) {
      meal = header[1].replace(/\b\w/g, (c) => c.toUpperCase());
      // the meal's own number is the format's; anything after it (a time) is the plan's
      checkNumbers(line, line.replace(/^(meal|snack)\s*\d+/i, "$1"));
      continue;
    }
    checkNumbers(line, line);
    // a food line: every word of the food must be in the source
    if (inNotes || !meal || meal === "Daily Total" || readMacroLine(line) || KCAL_LINE.test(line) || /^approximately\b/i.test(line)) continue;
    const words = wordsOf(line.replace(/^[\d\s.,/½¼¾⅓⅔⅛⅕–-]+/, "")).filter((w) => w.length >= 3 && !MEASURE_WORDS.has(w));
    if (!words.length) continue;
    const missing = words.filter((w) => !src.words.has(w) && !(w.length >= 5 && src.flat.includes(w)));
    if (!missing.length) continue;
    add({
      level: "check",
      code: "food_not_in_file",
      day: day || undefined,
      text:
        missing.length === words.length
          ? `${where()}: "${short(line)}" isn't in your file`
          : `${where()}: "${missing.join(" ")}" in "${short(line)}" isn't in your file`,
    });
  }
  if (out.length > max) {
    const more = out.length - max;
    return [...out.slice(0, max), { level: "check", code: "not_in_file", text: `And ${more} more line${more === 1 ? "" : "s"} that aren't in your file.` }];
  }
  return out;
}
