/**
 * What a plan brought into the Studio says about itself before the person
 * edits it: an imported plan whose Daily Total disagrees with its meals or
 * gives no macros at all, and a Cleo draft checked like every plan the app
 * writes (meals against their targets, hard-to-find foods, a food they said
 * they avoid, meal prep). Flags only: nothing here changes the plan. Pure.
 */
import { planDays } from "./read";
import { dayCoverage, mealsTotal, coachCoverageLine } from "@/lib/nutrition-targets/plan-coverage";
import { hardToFindFoods, planMenus, prepDrift, prepDriftLine } from "@/lib/nutrition-targets/plan-foods";
import { allergenConflicts } from "@/lib/nutrition-targets/food-history";
import { planTotalsIssues } from "@/lib/nutrition-targets/nutrition-intel";
import type { QA } from "@/lib/nutrition-request";
import type { MemberTargets } from "./create";
import type { MealFlag } from "./types";

/** An imported plan's own numbers: a Daily Total its meals don't add up to, or no macros to go on. */
export function importFlags(text: string): MealFlag[] {
  const out: MealFlag[] = [];
  for (const line of planTotalsIssues(text, [])) out.push({ level: "check", code: "totals", text: line });
  for (const d of planDays(text)) {
    if (d.protein == null && d.carbs == null && d.fats == null && !mealsTotal(d.notes))
      out.push({
        level: "info",
        code: "no_macros",
        day: d.day_label,
        text: `${d.day_label}: the plan doesn't give its macros, so set this day's targets in your plan.`,
      });
  }
  return out;
}

const list = (xs: string[], n = 3) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");

/**
 * A Cleo draft checked against what the member said and their targets, after
 * its one fix round: what's still worth their look.
 */
export function draftFlags(
  text: string,
  opts: { answers: QA[]; avoid: string[]; targets: MemberTargets | null; mealPrep: boolean },
): MealFlag[] {
  const out: MealFlag[] = [];
  const menus = planMenus(text);
  for (const a of allergenConflicts(menus, opts.avoid))
    out.push({
      level: "check",
      code: "allergen",
      text: `${a.food} (${list(a.where)}) is ${a.allergen.toLowerCase()}, which you said you avoid. Swap it before you save.`,
    });
  for (const h of hardToFindFoods(menus, opts.answers))
    out.push({ level: "check", code: "hard_to_find", text: `${h.food} (${list(h.where)}) can be hard to find in stores.` });
  if (opts.mealPrep)
    for (const d of prepDrift(menus))
      out.push({ level: "info", code: "prep", text: `Meal prep: ${prepDriftLine(d)} is weighed differently between meals.` });
  if (opts.targets) {
    const t = { calories: opts.targets.calories, protein: opts.targets.protein_g, carbs: opts.targets.carbs_g, fats: opts.targets.fat_g };
    for (const d of planDays(text)) {
      const line = coachCoverageLine(dayCoverage(d.notes, t));
      if (line) out.push({ level: "check", code: "coverage", day: d.day_label, text: `${line}. Adjust the amounts in your plan.` });
    }
  }
  return out;
}
