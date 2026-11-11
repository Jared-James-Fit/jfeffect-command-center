/**
 * Changing a client's current nutrition plan with the AI ("Change it with AI"
 * on the coach's Current plan card): the plan as the AI reads it (its day
 * numbers as targets, its days' meals as the paste format), the AI's answer
 * read back into the plan's own days, and what changed, day by day. Pure, so
 * the server writing the change and the coach's review read it the same way.
 */
import { parseFoodWeighingRules, parseMealPlan } from "@/lib/nutrition-targets/meal-plan-parse";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

/** A plan day as stored (`nutrition_target_days`). */
export type PlanEditDay = {
  day_label: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fibre?: number | null;
  notes?: string | null;
  sort_order?: number | null;
  use_on?: string | null;
  weekdays?: string[] | null;
  steps?: number | null;
};

export type PlanEditPlan = {
  phase?: string | null;
  custom_phase?: string | null;
  food_weighing_rules?: string | null;
  nutrition_target_days?: PlanEditDay[] | null;
};

const n = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v)));

/** The plan's days in their order. */
export function planDays(plan: PlanEditPlan): PlanEditDay[] {
  return (plan.nutrition_target_days ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** "TRAINING DAY MENU": a day's menu heading in the paste format. */
function menuHeader(label: string): string {
  const name = label.replace(/\bmenu\b/gi, "").trim() || "Day";
  return `${name.toUpperCase()} MENU`;
}

/** The plan's numbers in the AI targets' own format (CALORIE / MACRO / DAILY STEPS TARGETS). */
export function planAsTargetsText(plan: PlanEditPlan): string {
  const days = planDays(plan);
  const kcal = days.map((d) => `${d.day_label}: ${n(d.calories) ?? "—"}`);
  const macros = days.flatMap((d) => [
    "",
    d.day_label,
    `Protein: ${n(d.protein) ?? "—"}`,
    `Carbs: ${n(d.carbs) ?? "—"}`,
    `Fats: ${n(d.fats) ?? "—"}`,
    ...(d.fibre != null ? [`Fibre: ${n(d.fibre)}`] : []),
  ]);
  const steps = days.filter((d) => d.steps != null);
  return [
    "CALORIE TARGETS",
    ...kcal,
    "",
    "MACRO TARGETS",
    ...macros,
    ...(steps.length
      ? [
          "",
          "DAILY STEPS TARGETS",
          ...steps.map(
            (d) => `${d.day_label}: ${Math.round(d.steps!).toLocaleString("en-US")} steps`,
          ),
        ]
      : []),
  ].join("\n");
}

/** The plan's meals in the paste format: PHASE, a menu per day with its Daily Total, FOOD-WEIGHING RULES. */
export function planAsMealPlanText(plan: PlanEditPlan): string {
  const phase = plan.phase === "Custom" ? plan.custom_phase : plan.phase;
  const menus = planDays(plan).map((d) => {
    const body = String(d.notes ?? "").trim();
    const total =
      /daily\s+total/i.test(body) || d.protein == null || d.carbs == null || d.fats == null
        ? ""
        : `\n\nDaily Total\nApproximately ${n(d.protein)} g protein, ${n(d.carbs)} g carbohydrates, ${n(d.fats)} g fat${d.fibre != null ? ` and ${n(d.fibre)} g fibre` : ""}`;
    return `${menuHeader(d.day_label)}\n\n${body}${total}`.trim();
  });
  const rules = String(plan.food_weighing_rules ?? "").trim();
  return [
    phase ? `PHASE: ${phase}` : null,
    ...menus,
    rules ? `FOOD-WEIGHING RULES\n${rules}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A day's total steps from the DAILY STEPS TARGETS section, by the day's own label. */
function stepsFor(targetsText: string, label: string): number | null | undefined {
  let inSteps = false;
  const want = label.trim().toLowerCase();
  for (const raw of targetsText.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(daily\s+)?steps?\s+targets?\s*:?$/i.test(line)) {
      inSteps = true;
      continue;
    }
    if (/^[A-Z][A-Z\s/&-]+:?$/.test(line) && !/day/i.test(line)) {
      inSteps = false;
      continue;
    }
    if (!inSteps) continue;
    const at = line.lastIndexOf(":");
    if (at < 0 || line.slice(0, at).trim().toLowerCase() !== want) continue;
    const m = line
      .slice(at + 1)
      .replace(/,/g, "")
      .match(/\d+/);
    return m ? Number(m[0]) : null;
  }
  return undefined;
}

export type EditedPlan = { days: PlanEditDay[]; foodWeighingRules: string | null };

/**
 * The AI's answer as the plan's new days, each in the place of the day it
 * changes: the label, when it's used (`use_on` / `weekdays`) and its order are
 * the plan's own; the numbers come from the answer's Daily Totals (a day the
 * answer leaves without numbers keeps its own), its meals from the answer, and
 * steps from the answer's DAILY STEPS TARGETS when it says. An answer with a
 * different number of days than the plan isn't this plan, so it's refused.
 */
export function readEditedPlan(
  plan: PlanEditPlan,
  mealPlanText: string,
  targetsText: string | null,
): EditedPlan {
  const before = planDays(plan);
  const parsed = parseMealPlan(mealPlanText);
  if (!parsed.length) throw new Error("The AI's answer didn't come back as a meal plan");
  if (parsed.length !== before.length)
    throw new Error(
      `The AI's answer has ${parsed.length} ${parsed.length === 1 ? "day" : "days"} where the plan has ${before.length}. Try wording the change differently`,
    );
  const days = before.map((d, i) => {
    const p = parsed[i];
    const steps = targetsText ? stepsFor(targetsText, d.day_label) : undefined;
    return {
      day_label: d.day_label,
      calories: p.calories ?? d.calories ?? null,
      protein: p.protein ?? d.protein ?? null,
      carbs: p.carbs ?? d.carbs ?? null,
      fats: p.fats ?? d.fats ?? null,
      fibre: p.fibre ?? d.fibre ?? null,
      notes: p.notes ?? d.notes ?? null,
      sort_order: i,
      use_on: d.use_on ?? null,
      weekdays: d.weekdays ?? null,
      steps: steps === undefined ? (d.steps ?? null) : steps,
    };
  });
  const rules = parseFoodWeighingRules(mealPlanText);
  return { days, foodWeighingRules: rules ?? plan.food_weighing_rules ?? null };
}

export type DayChange = {
  label: string;
  before: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };
  after: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };
  /** "Meal 2", "Meal 5 (new)", "Meal 4 (removed)": meals whose foods changed. */
  meals: string[];
  /** The day's new meal text, to show. */
  notes: string | null;
};

/** What the AI's change does to each day: its numbers before and after, and which meals changed. */
export function planEditChanges(plan: PlanEditPlan, edited: EditedPlan): DayChange[] {
  const before = planDays(plan);
  return edited.days.map((d, i) => {
    const b = before[i];
    const mealsBefore = structureMealPlanDay(b?.notes).meals;
    const mealsAfter = structureMealPlanDay(d.notes).meals;
    const sig = (m: (typeof mealsAfter)[number] | undefined) =>
      m
        ? m.foods.map((f) => `${f.amount} ${f.name}`.toLowerCase()).join("|") + `|${m.timing ?? ""}`
        : "";
    const meals: string[] = [];
    const count = Math.max(mealsBefore.length, mealsAfter.length);
    for (let k = 0; k < count; k++) {
      const a = mealsBefore[k];
      const z = mealsAfter[k];
      const title = (z ?? a)!.title.split(" · ")[0];
      if (!a) meals.push(`${title} (new)`);
      else if (!z) meals.push(`${title} (removed)`);
      else if (sig(a) !== sig(z)) meals.push(title);
    }
    return {
      label: d.day_label,
      before: { kcal: n(b?.calories), protein: n(b?.protein), carbs: n(b?.carbs), fat: n(b?.fats) },
      after: { kcal: n(d.calories), protein: n(d.protein), carbs: n(d.carbs), fat: n(d.fats) },
      meals,
      notes: d.notes ?? null,
    };
  });
}

/** Nothing in the answer differs from the plan (numbers, meals, weighing rules). */
export function editChangesNothing(
  plan: PlanEditPlan,
  edited: EditedPlan,
  changes: DayChange[],
): boolean {
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  return (
    changes.every((c) => !c.meals.length && same(c.before, c.after)) &&
    String(edited.foodWeighingRules ?? "").trim() === String(plan.food_weighing_rules ?? "").trim()
  );
}
