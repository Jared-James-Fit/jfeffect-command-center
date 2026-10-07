/**
 * The (i) next to a Pre- / Post-Workout meal. Hover on desktop, tap on a
 * phone (InfoTip handles both). Plain wording on purpose: what each meal is,
 * why it helps, and that it's ideal but not mandatory.
 */
import { InfoTip } from "@/components/analytics/info-tip";
import { WORKOUT_MEAL_EXPLAINER as X } from "@/lib/nutrition-targets/meal-timing";

export function WorkoutMealInfo({
  className,
  side = "top",
}: {
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <InfoTip label="What are pre-workout and post-workout meals?" title={X.title} side={side} className={className}>
      <div className="space-y-1.5">
        <p>
          <span className="font-semibold text-amber-600 dark:text-amber-400">{X.pre.term}</span> = {X.pre.text}
        </p>
        <p>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{X.post.term}</span> = {X.post.text}
        </p>
        <p>{X.move}</p>
        <p className="font-semibold">{X.optional}</p>
      </div>
    </InfoTip>
  );
}
