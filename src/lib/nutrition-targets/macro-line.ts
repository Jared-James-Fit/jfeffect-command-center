/**
 * One reading of a meal's "Approximate macros" line, whichever way a coach or
 * an AI wrote it, for every screen that reads a meal plan (the client's meal
 * cards, the coach's plan view, the PDF, the food log, the generator's checks):
 *
 *   45 g protein                                   (one a line)
 *   36 g protein, 65 g carbohydrates, 12 g fat and 9 g fibre
 *   41 g protein / 68 g carbohydrates / 24 g fat
 *   40P / 60C / 8F   ·   50P   ·   Approx: 40P / 60C / 8F
 *
 * A line is only macros when it's nothing else: "30 g protein powder" or
 * "250 g Protein milk (skim)" stay foods.
 */

export type LineMacros = { protein?: number; carbs?: number; fat?: number; fibre?: number };

const WORD_TOKEN = /~?\s*(\d+(?:\.\d+)?)\s*(?:g|grams?)?\s*(protein|carbohydrates?|carbs?|fats?|fib(?:re|er)s?)\b/gi;
const LETTER_TOKEN = /~?\s*(\d+(?:\.\d+)?)\s*g?\s*([PCF])(?![A-Za-z])/g;
/** What may sit between the numbers on a macro line. */
const FILLER = /^(?:[\s,/|·;:+&()~.-]|and\b|approx(?:imately|imate)?\b|macros?\b|per\s+meal\b)*$/i;
const LEAD = /^\s*(?:approx(?:imately|imate)?\.?\s*(?:macros?)?\s*[:.-]?\s*)/i;

function keyOf(word: string): keyof LineMacros {
  const w = word.toLowerCase();
  if (w.startsWith("prot") || w === "p") return "protein";
  if (w.startsWith("carb") || w === "c") return "carbs";
  if (w.startsWith("fat") || w === "f") return "fat";
  return "fibre";
}

/** The macros on a line that holds only macros, else null. */
export function readMacroLine(line: string): LineMacros | null {
  const text = line.replace(LEAD, "").trim();
  if (!text || !/\d/.test(text)) return null;
  for (const re of [WORD_TOKEN, LETTER_TOKEN]) {
    const out: LineMacros = {};
    let found = 0;
    const rest = text.replace(re, (_m, n: string, w: string) => {
      const k = keyOf(w);
      if (out[k] == null) {
        out[k] = Number(n);
        found++;
      }
      return " ";
    });
    if (found && FILLER.test(rest)) return out;
  }
  return null;
}

/** A line's macros as one-a-line text ("36 g protein"), the shape the meal cards read. */
export function macroItems(m: LineMacros): string[] {
  const out: string[] = [];
  if (m.protein != null) out.push(`${m.protein} g protein`);
  if (m.carbs != null) out.push(`${m.carbs} g carbohydrates`);
  if (m.fat != null) out.push(`${m.fat} g fat`);
  if (m.fibre != null) out.push(`${m.fibre} g fibre`);
  return out;
}

/** 4 / 4 / 9, when protein, carbs and fat are all there. */
export function macroKcal(m: { protein?: number | null; carbs?: number | null; fat?: number | null } | null | undefined): number | null {
  if (!m || m.protein == null || m.carbs == null || m.fat == null) return null;
  return m.protein * 4 + m.carbs * 4 + m.fat * 9;
}

/**
 * A day's total heading, however it's written: "Daily Total", "Approximate
 * Daily Total" (Dwayne's), "Day total", "Totals". Every reader stops a meal
 * here, so a total's lines are never read as the last meal's macros.
 */
export const DAILY_TOTAL_HEADING = /^\s*(?:approx(?:imately|imate)?\.?\s+)?(?:(?:daily|day)\s*totals?|totals?)\b/i;

/** "Approximately 3,020 calories from the listed macros": a total's own calorie line. */
const CALORIE_LINE = /\b(k?cals?|calories)\b/i;

/**
 * The Daily Total starting at `lines[at]` (its heading): the macros on the
 * heading's line and the macro / calorie lines under it, any way they're
 * written, and where the block ends (the first line after it).
 */
export function readDailyTotal(lines: string[], at: number): { total: LineMacros | null; end: number } {
  const total: LineMacros = {};
  const add = (m: LineMacros | null) => {
    for (const [k, v] of Object.entries(m ?? {})) if (total[k as keyof LineMacros] == null) total[k as keyof LineMacros] = v;
  };
  add(readMacroLine(lines[at].replace(DAILY_TOTAL_HEADING, "").replace(/^\s*[:.-]\s*/, "")));
  let end = at + 1;
  for (; end < lines.length; end++) {
    const line = lines[end].trim();
    if (!line) {
      if (Object.keys(total).length) break;
      continue;
    }
    const m = readMacroLine(line);
    if (m) add(m);
    else if (!CALORIE_LINE.test(line)) break;
  }
  return { total: Object.keys(total).length ? total : null, end };
}

/** True for a line that belongs to a total block (its macros or its calorie line). */
export function isTotalLine(line: string): boolean {
  return !!readMacroLine(line) || CALORIE_LINE.test(line);
}
