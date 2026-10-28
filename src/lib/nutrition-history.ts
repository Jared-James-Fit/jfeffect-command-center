/**
 * The plan a client was on when they sent a Nutrition Update, and how it
 * went, for the AI that writes the next one: it adjusts from the last plan's
 * numbers and keeps the meals they know, instead of starting from scratch.
 *
 * Snapshotted onto nutrition_ai_plans.previous_plan the first time the AI
 * runs for a submission, so a regenerate after the old plan was replaced or
 * deleted still sees exactly what the client was on. Pure.
 */

/** The new form questions (Nutrition Update Request). */
export const MEAL_CHOICE_LABEL = "What should happen with the meals in your current plan?";
export const MEAL_SWAP_LABEL = "Which foods or meals do you want changed, and what would you rather have?";
export const MEAL_CHOICE = {
  keep: "Keep my meals (just update the numbers)",
  swap: "Swap some foods or meals",
  fresh: "Start fresh with new meals",
  first: "This is my first plan",
} as const;
export type MealChoice = keyof typeof MEAL_CHOICE;

export function mealChoiceOf(answer: string | null | undefined): MealChoice | null {
  const a = String(answer ?? "").trim().toLowerCase();
  if (!a) return null;
  for (const [k, v] of Object.entries(MEAL_CHOICE)) if (a === v.toLowerCase()) return k as MealChoice;
  if (/swap|change/.test(a)) return "swap";
  if (/fresh|new meals/.test(a)) return "fresh";
  if (/first/.test(a)) return "first";
  if (/keep|same/.test(a)) return "keep";
  return null;
}

export type PlanDay = {
  label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  fibre: number | null;
  /** The day's meals as the client sees them (nutrition_target_days.notes). */
  meals: string | null;
};

export type PlanResults = {
  unit: "lb" | "kg";
  bw_start: number | null;
  bw_now: number | null;
  /** Bodyweight change over the plan, in `unit`. */
  change: number | null;
  /** % of bodyweight per week (negative = losing). */
  rate_pct_week: number | null;
  /** Weeks between the two bodyweight readings. */
  bw_weeks: number | null;
  /** "logged" = 7-day averages of logged weigh-ins; "form" = this vs the last Nutrition Update's answer. */
  bw_source: "logged" | "form" | null;
  checkins: number;
  /** Weekly check-in "stuck to your meal plan" 1-5, averaged. */
  adherence_avg: number | null;
  /** How many weekly check-ins flagged each. */
  flags: { hunger: number; energy: number; digestion: number; sleep: number };
};

export type PreviousPlan = {
  target_id: string;
  phase: string | null;
  goal: string | null;
  start_date: string | null;
  /** Weeks on the plan when the update was sent. */
  weeks_on: number | null;
  days: PlanDay[];
  results: PlanResults | null;
};

const DAY = 86_400_000;
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;
const toUnit = (kg: number, unit: "lb" | "kg") => (unit === "lb" ? kg * 2.2046226 : kg);

/** The latest plan made before `beforeIso` that has at least one day with numbers. */
export function pickPreviousPlan<T extends { created_at: string; days?: Array<{ calories?: unknown }> }>(
  targets: T[],
  beforeIso: string,
): T | null {
  return (
    targets
      .filter((t) => t.created_at < beforeIso && (t.days ?? []).some((d) => num(d.calories) != null))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/**
 * Bodyweight and adherence on the plan, from `start` (YYYY-MM-DD) to `end`.
 * Weights are kg. Bodyweight uses a 7-day average at each end (a single
 * weigh-in is noise); without enough logged weigh-ins it falls back to the
 * last Nutrition Update's bodyweight answer vs this one.
 */
export function planResults(input: {
  start: string;
  end: string;
  unit: "lb" | "kg";
  weights: Array<{ date: string; kg: number }>;
  checkins: Array<{ answers: Record<string, unknown> | null }>;
  formFallback?: { fromKg: number; toKg: number; days: number } | null;
}): PlanResults {
  const { unit } = input;
  const w = input.weights
    .filter((x) => x.date >= addDays(input.start, -3) && x.date <= input.end && Number.isFinite(x.kg) && x.kg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  let bwStart: number | null = null;
  let bwNow: number | null = null;
  let weeks: number | null = null;
  let source: PlanResults["bw_source"] = null;
  if (w.length >= 4) {
    const first = w[0].date;
    const last = w[w.length - 1].date;
    const a = w.filter((x) => x.date <= addDays(first, 6));
    const b = w.filter((x) => x.date >= addDays(last, -6));
    const span = (Date.parse(midDate(b)) - Date.parse(midDate(a))) / DAY;
    if (a.length >= 2 && b.length >= 2 && span >= 10) {
      bwStart = avg(a.map((x) => x.kg));
      bwNow = avg(b.map((x) => x.kg));
      weeks = span / 7;
      source = "logged";
    }
  }
  if (source == null && input.formFallback && input.formFallback.days >= 10) {
    bwStart = input.formFallback.fromKg;
    bwNow = input.formFallback.toKg;
    weeks = input.formFallback.days / 7;
    source = "form";
  }

  const ratings = input.checkins.map((c) => num(c.answers?.nutrition_rating)).filter((v): v is number => v != null);
  const flagCount = (re: RegExp) =>
    input.checkins.filter((c) => Array.isArray(c.answers?.recovery_flags) && (c.answers!.recovery_flags as unknown[]).some((f) => re.test(String(f)))).length;

  return {
    unit,
    bw_start: bwStart != null ? round1(toUnit(bwStart, unit)) : null,
    bw_now: bwNow != null ? round1(toUnit(bwNow, unit)) : null,
    change: bwStart != null && bwNow != null ? round1(toUnit(bwNow - bwStart, unit)) : null,
    rate_pct_week: bwStart != null && bwNow != null && weeks ? Math.round(((bwNow - bwStart) / bwStart / weeks) * 10000) / 100 : null,
    bw_weeks: weeks != null ? round1(weeks) : null,
    bw_source: source,
    checkins: input.checkins.length,
    adherence_avg: ratings.length ? round1(avg(ratings)) : null,
    flags: {
      hunger: flagCount(/hunger|appetite/i),
      energy: flagCount(/energy/i),
      digestion: flagCount(/digestion|bloat/i),
      sleep: flagCount(/sleep/i),
    },
  };
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
function midDate(xs: Array<{ date: string }>) {
  const t = (Date.parse(`${xs[0].date}T00:00:00Z`) + Date.parse(`${xs[xs.length - 1].date}T00:00:00Z`)) / 2;
  return new Date(t).toISOString();
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
const signed = (n: number, digits = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

/** The last plan + how it went, for the targets prompt. Empty when there's no previous plan. */
export function previousPlanText(p: PreviousPlan | null | undefined): string {
  if (!p || !p.days.length) return "";
  const head = [
    p.weeks_on != null ? `on it ${p.weeks_on} weeks` : null,
    p.start_date ? `since ${fmtDate(p.start_date)}` : null,
    p.phase ? `phase: ${p.phase}` : null,
    p.goal ? `goal: ${p.goal}` : null,
  ].filter(Boolean).join(" · ");
  const lines = [`PREVIOUS PLAN (${head})`];
  for (const d of p.days) {
    lines.push(`- ${d.label}: ${d.calories ?? "?"} kcal · protein ${d.protein ?? "?"} g · carbs ${d.carbs ?? "?"} g · fat ${d.fats ?? "?"} g${d.fibre != null ? ` · fibre ${d.fibre} g` : ""}`);
  }
  const r = p.results;
  if (r) {
    lines.push("RESULTS ON THE PREVIOUS PLAN");
    if (r.bw_start != null && r.bw_now != null && r.change != null) {
      lines.push(
        `- bodyweight${r.bw_source === "logged" ? " (7-day average)" : " (last update's answer vs this one)"}: ${r.bw_start} → ${r.bw_now} ${r.unit} (${signed(r.change)} ${r.unit}, ${signed(r.rate_pct_week ?? 0, 2)}% of bodyweight per week over ${r.bw_weeks} weeks)`,
      );
    } else {
      lines.push("- bodyweight: not enough weigh-ins to call a trend");
    }
    if (r.checkins) {
      const f = r.flags;
      const flagged = [
        f.hunger && `hunger ${f.hunger}`,
        f.energy && `low energy ${f.energy}`,
        f.digestion && `digestion ${f.digestion}`,
        f.sleep && `sleep ${f.sleep}`,
      ].filter(Boolean);
      lines.push(
        `- weekly check-ins: ${r.checkins}${r.adherence_avg != null ? ` · stuck to the meal plan ${r.adherence_avg}/5 on average` : ""}${flagged.length ? ` · flagged ${flagged.join(", ")} (of ${r.checkins})` : " · nothing flagged"}`,
      );
    } else {
      lines.push("- weekly check-ins: none on this plan, adherence unknown");
    }
  }
  return lines.join("\n");
}

/** The last plan's meals, per day type, for the meal plan prompt. */
export function previousMealsText(p: PreviousPlan | null | undefined): string {
  if (!p) return "";
  const days = p.days.filter((d) => d.meals?.trim());
  if (!days.length) return "";
  return days.map((d) => `${d.label.toUpperCase()} (current)\n${d.meals!.trim()}`).join("\n\n");
}

/**
 * What to do with the current meals. A "first plan" answer from someone who
 * has one is treated as no answer, and keep / swap with no plan on file has
 * nothing to keep.
 */
export function mealChoiceRule(choice: MealChoice | null, swap: string, hasMeals: boolean): string {
  if (!hasMeals) return "";
  const asked = swap.trim();
  if (choice === "fresh") {
    return "Client wants NEW meals: build fresh meals from their preferred foods. Don't reuse the CURRENT MEALS unless a food is on their preferred list.";
  }
  if (choice === "swap" && asked) {
    return `Keep the CURRENT MEALS (same meals, foods, order and workout-meal tags) EXCEPT what the client asked to change: "${asked}". Make exactly those swaps with foods that fit their preferences and allergies, then rescale portions to hit the new targets.`;
  }
  if (choice === "keep") {
    return "Client wants to KEEP their meals: same meals, same foods, same order and workout-meal tags as the CURRENT MEALS. Only change portion sizes to hit the new targets. Swap a food only if the targets can't be hit with portions alone, and keep it as close as possible.";
  }
  return "Use the CURRENT MEALS as the base (the client knows them): keep the foods and structure that still fit the new targets and their food list, rescale portions, and only change what the new targets or their answers require.";
}

/* ------------------------------------------------------------------------ */
/* High Day free meal                                                        */

export const FREE_MEAL_LABEL = "Do you want a free meal on your High Day?";
export const FREE_MEAL_HELP =
  "A free meal is one meal of whatever you want (burger + fries, steak + potatoes, pasta…), built into your High Day calories so it doesn't set you back. Heads up: going without one takes more discipline. You'd get a High Day with extra carbs instead, but every meal stays planned and weighed.";
export const FREE_MEAL = {
  yes: "Yes, give me a free meal on my High Day",
  no: "No free meal, just a planned High Day",
} as const;
export const FREE_MEAL_PICK_LABEL = "What's your go-to free meal?";
export const FREE_MEAL_PICKS = [
  "Burger + fries",
  "Steak + potatoes",
  "Pasta",
  "Pizza",
  "Sushi",
  "Tacos / burritos",
  "Whatever I'm craving that week",
] as const;

/** true = wants a free meal, false = fully planned High Day, null = not asked (older forms). */
export function wantsFreeMeal(answer: string | null | undefined): boolean | null {
  const a = String(answer ?? "").trim().toLowerCase();
  if (!a) return null;
  if (a === FREE_MEAL.yes.toLowerCase() || /^yes\b/.test(a)) return true;
  if (a === FREE_MEAL.no.toLowerCase() || /^no\b/.test(a)) return false;
  return null;
}

/** The meal plan instruction for the High Day. Empty when the client wasn't asked. */
export function freeMealRule(wants: boolean | null, pick: string): string {
  if (wants === true) {
    const p = pick.trim();
    const theirs = p && !/whatever|craving/i.test(p) ? `${p}, ` : "";
    return [
      "Client wants a FREE MEAL on the HIGH-DAY MENU only (never on the other menus).",
      "Make it the last meal of the day, never the Pre-Workout meal, with the header exactly \"Meal X – Free Meal\".",
      `Under it, instead of weighed foods, write one line "Your choice: ${theirs}burger + fries, steak + potatoes, pasta or whatever you're craving" and one line "Aim for about <kcal> kcal with 40+ g protein. Enjoy it, then straight back to the plan."`,
      "Budget it at about 25–35% of the High Day calories, and give its Approximate macros as that budget (protein 40 g or more).",
      "Build the other High-Day meals lean and high-protein with less fat, so the whole day still lands on the High Day totals.",
    ].join(" ");
  }
  if (wants === false) {
    return "No free meal: the client chose a fully planned High Day. Put the High Day's extra carbs into foods they enjoy from their list (e.g. bagels, rice, pasta, cereal, fruit) so it still feels like a reward, every food weighed like the other days.";
  }
  return "";
}

/** One line for the coach: what the last plan was and how it went. */
export function lastPlanSummary(p: PreviousPlan | null | undefined): string | null {
  if (!p) return null;
  const r = p.results;
  const parts = [
    `${p.phase ?? "Plan"}${p.weeks_on != null ? ` for ${p.weeks_on} weeks` : ""}`,
    r?.rate_pct_week != null && r.change != null
      ? `${signed(r.rate_pct_week, 2)}% bodyweight/week (${signed(r.change)} ${r.unit})`
      : "no clear bodyweight trend",
    r?.adherence_avg != null ? `stuck to it ${r.adherence_avg}/5 over ${r.checkins} check-ins` : null,
    r && r.flags.hunger ? `hunger flagged ${r.flags.hunger}×` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
