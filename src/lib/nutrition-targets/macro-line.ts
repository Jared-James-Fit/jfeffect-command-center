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
