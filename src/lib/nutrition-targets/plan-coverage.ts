/**
 * Whether a plan day's meals cover its targets: the one reading for the
 * client's Meal plan card, the coach's plan view, the AI plan's review, what
 * gets published and the generator's checks. Pure.
 *
 * The meals are read as written (each meal's Approximate macros, 4 / 4 / 9,
 * through `structureMealPlanDay` and the shared macro reader), never from a
 * "Daily Total" line, which is only the writer's claim: Devin's Nov 11 plan
 * said 180 / 305 / 71 under three meals that add up to 150 / 210 / 46.
 *
 * Covering is the meal-prep tolerance the generator already works to
 * (MEAL_PLAN_PROMPT rule 2c): within about 5% of the day's calories, and no
 * more than 10 g under its protein. A coach can reserve the rest on purpose
 * with a "Flexible calories" section (`FLEX_HEADING`), which counts.
 */
import { structureMealPlanDay, FLEX_HEADING } from "@/lib/nutrition-targets/meal-plan-structure";
import { macroKcal, readMacroLine } from "@/lib/nutrition-targets/macro-line";

/** Within this share of the day's calories, the meals cover it (the generator's ±5%). */
export const COVER_KCAL_SHARE = 0.05;
/** And no more than this many grams under its protein. */
export const COVER_PROTEIN_G = 10;

export type DayTarget = {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
};

export type MealsTotal = {
  meals: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Only when every meal says its fibre. */
  fibre: number | null;
};

/** The day's meals added up, as written. Null when there are none or one of them doesn't say its protein, carbs and fat. */
export function mealsTotal(notes: string | null | undefined): MealsTotal | null {
  const { meals } = structureMealPlanDay(notes);
  if (!meals.length) return null;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fibre: number | null = 0;
  for (const m of meals) {
    const x = m.macros;
    if (!x || x.protein == null || x.carbs == null || x.fat == null) return null;
    protein += x.protein;
    carbs += x.carbs;
    fat += x.fat;
    fibre = fibre != null && x.fibre != null ? fibre + x.fibre : null;
  }
  return { meals: meals.length, kcal: Math.round(protein * 4 + carbs * 4 + fat * 9), protein, carbs, fat, fibre };
}

/** The calories a "Flexible calories" section sets aside ("725 kcal", or its macros), else null. */
export function flexibleKcal(notes: string | null | undefined): number | null {
  const lines = String(notes ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => FLEX_HEADING.test(l));
  if (at < 0) return null;
  // the heading line and the few lines under it, up to the next blank line
  for (const l of lines.slice(at, at + 4)) {
    if (!l) break;
    const k = l.match(/(\d[\d,]*)\s*(?:k?cals?|calories)\b/i);
    if (k) return Number(k[1].replace(/,/g, ""));
    const m = readMacroLine(l.replace(FLEX_HEADING, "").replace(/^\s*[:.-]\s*/, ""));
    const kcal = macroKcal(m);
    if (kcal) return Math.round(kcal);
  }
  return null;
}

export function targetKcal(t: DayTarget | null | undefined): number | null {
  if (!t) return null;
  if (t.calories != null && t.calories > 0) return t.calories;
  const k = macroKcal({ protein: t.protein, carbs: t.carbs, fat: t.fats });
  return k ? Math.round(k) : null;
}

export type Coverage = {
  /** covers: the meals are the day. short / over: they aren't. unknown: no target, or meals that don't say their macros. */
  state: "covers" | "short" | "over" | "unknown";
  meals: MealsTotal | null;
  /** What a "Flexible calories" section sets aside. */
  flexible: number | null;
  target: number | null;
  /** target − (meals + flexible): more than 0 when the meals fall short. */
  gap: number | null;
  /** target protein − the meals' protein: more than 0 when they fall short. */
  proteinGap: number | null;
};

export function dayCoverage(notes: string | null | undefined, target: DayTarget | null | undefined): Coverage {
  const meals = mealsTotal(notes);
  const flexible = flexibleKcal(notes);
  const want = targetKcal(target);
  if (!meals || !want) return { state: "unknown", meals, flexible, target: want, gap: null, proteinGap: null };
  const gap = Math.round(want - (meals.kcal + (flexible ?? 0)));
  const proteinGap = target?.protein != null ? Math.round(target.protein - meals.protein) : null;
  const slack = want * COVER_KCAL_SHARE;
  const state =
    gap > slack || (proteinGap != null && proteinGap > COVER_PROTEIN_G)
      ? "short"
      : -gap > slack
        ? "over"
        : "covers";
  return { state, meals, flexible, target: want, gap, proteinGap };
}

const kcal = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The coach's line about a day's meals against its targets ("The meals add up
 * to 1,854 of 2,579 kcal (150 of 180 g protein): 725 kcal short"), or null
 * when they cover it.
 */
export function coachCoverageLine(c: Coverage): string | null {
  if (!c.meals || c.target == null || c.state === "covers" || c.state === "unknown") return null;
  const planned = c.meals.kcal + (c.flexible ?? 0);
  const flex = c.flexible ? ` with ${kcal(c.flexible)} flexible` : "";
  const protein =
    c.proteinGap != null && c.proteinGap > COVER_PROTEIN_G
      ? ` (${Math.round(c.meals.protein)} of ${Math.round(c.meals.protein + c.proteinGap)} g protein)`
      : "";
  if (c.state === "over") return `The meals${flex} add up to ${kcal(planned)} of ${kcal(c.target)} kcal: ${kcal(-c.gap!)} over`;
  if (c.gap! > c.target * COVER_KCAL_SHARE)
    return `The meals${flex} add up to ${kcal(planned)} of ${kcal(c.target)} kcal${protein}: ${kcal(c.gap!)} kcal short`;
  return `The meals have ${Math.round(c.meals.protein)} of ${Math.round(c.meals.protein + c.proteinGap!)} g protein`;
}

/**
 * The client's line under their meals: whether the meals are the whole day.
 * "These meals cover your 2,579 kcal" (with any flexible calories counted), or
 * what's missing in plain words and who to ask. Null when it can't be told
 * (no target, or meals that don't say their macros).
 */
export function clientCoverageLine(c: Coverage): { tone: "ok" | "attention"; text: string } | null {
  if (!c.meals || c.target == null || c.state === "unknown") return null;
  const target = kcal(c.target);
  if (c.state === "covers")
    return {
      tone: "ok",
      text: c.flexible
        ? `These meals plus ${kcal(c.flexible)} flexible kcal cover your ${target} kcal`
        : `These meals cover your ${target} kcal`,
    };
  const planned = c.meals.kcal + (c.flexible ?? 0);
  if (c.state === "over")
    return { tone: "attention", text: `These meals add up to ${kcal(planned)} kcal, more than your ${target} kcal target. Ask your coach which to follow.` };
  if (c.gap! > c.target * COVER_KCAL_SHARE)
    return {
      tone: "attention",
      text: `These meals add up to ${kcal(planned)} of your ${target} kcal. Ask your coach how to cover the other ${kcal(c.gap!)}.`,
    };
  return {
    tone: "attention",
    text: `These meals have ${Math.round(c.meals.protein)} of your ${Math.round(c.meals.protein + c.proteinGap!)} g protein. Ask your coach how to cover the rest.`,
  };
}

/** What Change it with AI is asked when a day's meals don't cover its targets (the coach reads and sends it). */
export const BRING_MEALS_TO_TARGETS =
  "Bring every day's meals up to that day's targets, keeping the targets as they are: each day's meals should add up to its calories within about 5% and its protein within 10 g. Keep the same meals and foods; make the containers bigger the meal-prep way (every container the same grams on every day) or add counted units, and write each meal's Approximate macros from its foods.";

/** A day whose calories aren't what its own macros add up to (more than 3% apart): "3,200 kcal, but the macros add up to 3,020". */
export function targetMathLine(t: DayTarget | null | undefined): string | null {
  if (!t?.calories) return null;
  const sum = macroKcal({ protein: t.protein, carbs: t.carbs, fat: t.fats });
  if (sum == null || Math.abs(sum - t.calories) / t.calories <= 0.03) return null;
  return `Calories say ${kcal(t.calories)}, but the protein, carbs and fat add up to ${kcal(sum)}`;
}

/* ------------------------------------------------------------------------ */
/* The numbers a plan day is saved with                                      */

export type DayNumbers = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  fibre: number | null;
};

/**
 * The numbers an AI-written day is published with. Its targets are the
 * coaching decision: when the meals cover them, the meals' own numbers (so
 * the client's ring is exactly what they eat, the meal-prep tolerance); when
 * they don't, the targets, so meals that fall short can never quietly lower
 * the targets (and the gap shows on both sides until it's fixed). With no
 * targets to read, the day's own numbers (its Daily Total, else its meals).
 */
export function planDayNumbers(day: DayNumbers & { notes?: string | null }, target: DayTarget | null | undefined): DayNumbers {
  const want = targetKcal(target);
  if (!target || !want) return { calories: day.calories, protein: day.protein, carbs: day.carbs, fats: day.fats, fibre: day.fibre };
  const c = dayCoverage(day.notes, target);
  if (c.state === "covers" && c.meals && !c.flexible)
    return {
      calories: c.meals.kcal,
      protein: Math.round(c.meals.protein),
      carbs: Math.round(c.meals.carbs),
      fats: Math.round(c.meals.fat),
      fibre: c.meals.fibre ?? day.fibre,
    };
  return {
    calories: Math.round(want),
    protein: target.protein ?? day.protein,
    carbs: target.carbs ?? day.carbs,
    fats: target.fats ?? day.fats,
    fibre: day.fibre,
  };
}

/* ------------------------------------------------------------------------ */
/* Honest Daily Totals                                                       */

const MENU_HEADER = (t: string) => /MENU\s*$/i.test(t) && t.length < 80 && !/^meal/i.test(t);

function totalLine(m: MealsTotal): string {
  const r = (n: number) => Math.round(n);
  return `Approximately ${r(m.protein)} g protein, ${r(m.carbs)} g carbohydrates, ${r(m.fat)} g fat${m.fibre != null ? ` and ${r(m.fibre)} g fibre` : ""}`;
}

/**
 * A written meal plan with every menu's Daily Total made the sum of its meals
 * (and one added where it's missing), so the text can never claim a total its
 * meals don't add up to. A menu whose meals don't all say their macros keeps
 * its own line.
 */
export function withHonestTotals(text: string): string {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const stop = lines.findIndex((l) => /^FOOD[- ]?WEIGHING\b/i.test(l.trim()));
  const end = stop < 0 ? lines.length : stop;
  const starts: number[] = [];
  for (let i = 0; i < end; i++) if (MENU_HEADER(lines[i].trim())) starts.push(i);
  if (!starts.length) return text;
  const out = lines.slice();
  // back to front, so inserting a line never moves a menu still to do
  for (let k = starts.length - 1; k >= 0; k--) {
    const from = starts[k] + 1;
    const to = k + 1 < starts.length ? starts[k + 1] : end;
    const body = out.slice(from, to);
    const total = mealsTotal(body.join("\n"));
    if (!total) continue;
    const at = body.findIndex((l) => /^\s*daily\s+total\b/i.test(l));
    if (at < 0) {
      let last = body.length;
      while (last > 0 && !body[last - 1].trim()) last--;
      out.splice(from + last, 0, "", "Daily Total", totalLine(total));
      continue;
    }
    if (readMacroLine(body[at].replace(/^\s*daily\s+totals?\s*[:.-]?/i, ""))) {
      out.splice(from + at, 1, "Daily Total", totalLine(total));
      continue;
    }
    let next = at + 1;
    while (next < body.length && !body[next].trim()) next++;
    if (next < body.length && readMacroLine(body[next])) out[from + next] = totalLine(total);
    else out.splice(from + at + 1, 0, totalLine(total));
  }
  return out.join("\n");
}
