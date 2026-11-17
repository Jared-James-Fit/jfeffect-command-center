/**
 * This week's check-in: the weekly questions plus only what its plan adds
 * (plan.ts), never a second form. Weight-making right after the nutrition
 * question; a weigh-in, photos and measurements (each optional, each the
 * Progress page's own entry, so it lands in the same records) just before the
 * open questions at the end. Pure, tested.
 */
import type { CheckinExtra, CheckinPlan } from "@/lib/checkin-coordination/plan";

export type PlanStep = {
  key: string;
  prompt: string;
  helper?: string;
  type: "rating" | "action";
  action?: "photo" | "measure" | "weight";
  scale?: [string, string, string, string, string];
  optional?: boolean;
};

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
    }
    out.push(q);
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
