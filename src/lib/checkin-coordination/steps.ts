/**
 * This week's check-in: the weekly questions plus only what its plan adds
 * (plan.ts), never a second form. Weight-making right after the nutrition
 * question; a weigh-in, photos and measurements (each optional, each the
 * Progress page's own entry, so it lands in the same records) just before the
 * open questions at the end. Pure, tested.
 */
import type { CheckinExtra, CheckinPlan } from "@/lib/checkin-coordination/plan";
import { CHANGED, CHANGED_OPTIONS, MEAL_OPTIONS, NU } from "@/lib/checkin-coordination/nutrition-fold";
import { MEAL_CHOICE } from "@/lib/nutrition-history";
import { askQuestion } from "@/lib/nutrition-roadmap/questions";
import type { CheckinAsk } from "@/lib/nutrition-roadmap/types";

export type PlanStep = {
  key: string;
  prompt: string;
  helper?: string;
  type: "rating" | "action" | "single" | "multi" | "text";
  action?: "photo" | "measure" | "weight";
  scale?: [string, string, string, string, string];
  options?: string[];
  /** A multi's option that stands alone ("Nothing else changed"). */
  exclusive?: string;
  optional?: boolean;
  showWhen?: (answers: Record<string, any>) => boolean;
};

const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const picked = (a: Record<string, any>, option: string) => Array.isArray(a[NU.changed]) && a[NU.changed].includes(option);

/**
 * This month's Nutrition Update inside the check-in (nutrition-fold.ts): the
 * meals, then what changed, each change's one follow-up only when it's ticked.
 * Three screens when nothing changed; everything else carries from last time.
 */
export function nutritionSteps(extra: { since?: string | null; options?: { goal: string[]; freeMeal: string[] } | null; askFreeMeal?: boolean }): PlanStep[] {
  const since = extra.since ? ` (${fmtDay(extra.since)})` : "";
  const goals = extra.options?.goal?.length ? extra.options.goal : ["Fat Loss", "Muscle Gain", "Recomp (lose fat + build muscle)", "Maintenance"];
  const free = extra.options?.freeMeal?.length ? extra.options.freeMeal : ["Yes, give me a free meal on my High Day", "No free meal, just a planned High Day"];
  return [
    {
      key: NU.meals,
      type: "single",
      prompt: "Monthly nutrition update: what should happen with your meals?",
      helper: "It's part of this check-in, so there's no separate form this month. Your new targets are built from your weigh-ins and check-ins.",
      options: [...MEAL_OPTIONS],
    },
    {
      key: NU.swap,
      type: "text",
      prompt: "Which foods or meals do you want changed, and what would you rather have?",
      showWhen: (a) => a[NU.meals] === MEAL_CHOICE.swap,
    },
    {
      key: NU.changed,
      type: "multi",
      prompt: `Anything changed since your last update${since}?`,
      helper: "Everything you told me then (allergies, foods, schedule) carries over unless you pick it here.",
      options: CHANGED_OPTIONS,
      exclusive: CHANGED.nothing,
    },
    { key: NU.goal, type: "single", prompt: "What's your goal now?", options: goals, showWhen: (a) => picked(a, CHANGED.goal) },
    { key: NU.goalDetail, type: "text", prompt: "Any target bodyweight, date or event?", optional: true, showWhen: (a) => picked(a, CHANGED.goal) },
    { key: NU.allergies, type: "text", prompt: "What changed with allergies or how you eat?", showWhen: (a) => picked(a, CHANGED.allergies) },
    { key: NU.health, type: "text", prompt: "What changed with your health, injuries or medications?", showWhen: (a) => picked(a, CHANGED.health) },
    { key: NU.supplements, type: "text", prompt: "What supplements do you take now? Name and dose.", showWhen: (a) => picked(a, CHANGED.supplements) },
    { key: NU.activity, type: "text", prompt: "What changed with your training days, schedule or daily activity?", showWhen: (a) => picked(a, CHANGED.activity) },
    // asked when it changed, or when they've never answered it (it came to the form later)
    { key: NU.freeMeal, type: "single", prompt: "Free meal on your High Day?", options: free, showWhen: (a) => !!extra.askFreeMeal || picked(a, CHANGED.freeMeal) },
  ];
}

/** The nutrition roadmap's follow-ups as check-in steps (the same questions a self-coached athlete answers). */
export function roadmapSteps(asks: string[], sex: "M" | "F" | null = null): PlanStep[] {
  return asks
    .map((a) => askQuestion(a as CheckinAsk, sex))
    .filter((q): q is NonNullable<typeof q> => !!q)
    .map((q) => ({ key: q.key, type: q.type, prompt: q.prompt, helper: q.helper, options: q.options, scale: q.scale, exclusive: q.exclusive, optional: q.optional, showWhen: q.showWhen as PlanStep["showWhen"] }));
}

/** The check-in's answer key for its one profile question (the plan says which field it was). */
export const PROFILE_ASK_KEY = "profile_ask";

/** The one optional work & lifestyle question (client-context checkinProfileAsk): one tap, or Skip. */
export function profileStep(extra: { prompt?: string; choices?: string[] }): PlanStep {
  return {
    key: PROFILE_ASK_KEY,
    type: "single",
    prompt: extra.prompt ?? "Quick one for your profile",
    helper: "Optional, one tap. It helps your coach fit your plan around your work. Skip and it won't be asked again for a while.",
    options: extra.choices ?? [],
    optional: true,
  };
}

export function addPlanSteps<T extends { key: string }>(base: T[], plan: CheckinPlan | null): Array<T | PlanStep> {
  if (!plan) return base;
  const has = (k: CheckinExtra) => plan.extras.some((e) => e.key === k);
  const out: Array<T | PlanStep> = [];
  for (const q of base) {
    if (q.key === "win") {
      if (has("bodyweight"))
        out.push({ key: "bodyweight_logged", type: "action", action: "weight", prompt: "Log this morning's weight", helper: "Nothing logged this week yet. It goes straight to your log, so you're never asked twice.", optional: true });
      if (has("photos"))
        out.push({ key: "photos_added", type: "action", action: "photo", prompt: "Progress photos are due", helper: "Same spot, same light, same time of day as last time. They go to your progress photos, private to you and your coach.", optional: true });
      if (has("measurements"))
        out.push({ key: "measurements_added", type: "action", action: "measure", prompt: "Measurements are due", helper: "Waist matters most. Measure at the same time of day as last time.", optional: true });
      const nutrition = plan.extras.find((e) => e.key === "nutrition_update" && e.inline);
      if (nutrition) out.push(...nutritionSteps(nutrition));
      const profile = plan.extras.find((e) => e.key === "profile" && e.choices?.length);
      if (profile) out.push(profileStep(profile));
    }
    out.push(q);
    if (q.key === "nutrition_rating") {
      const r = plan.extras.find((e) => e.key === "roadmap");
      if (r?.asks?.length) out.push(...roadmapSteps(r.asks, r.sex ?? null));
    }
    if (q.key === "nutrition_rating" && has("weight_making")) {
      const why = plan.extras.find((e) => e.key === "weight_making")?.reason;
      out.push({
        key: "weight_making",
        prompt: "How's making weight feeling?",
        helper: `${why ? `${why}. ` : ""}Your weigh-ins come from your log, nothing to type.`,
        type: "rating",
        scale: ["Easy", "Fine", "Some work", "Hard", "Struggling"],
      });
    }
  }
  return out;
}
