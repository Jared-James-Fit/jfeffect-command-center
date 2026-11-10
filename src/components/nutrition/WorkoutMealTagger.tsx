/**
 * Coach editor: one row of chips per meal so a pasted / AI plan's
 * Pre-Workout and Post-Workout meals can be set, moved or cleared with a tap.
 * Writes the tag into the meal line itself ("Meal 2 (Pre-Workout)").
 */
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkoutMealInfo } from "@/components/nutrition/WorkoutMealInfo";
import {
  listMealHeaders,
  setMealTiming,
  type MealTiming,
} from "@/lib/nutrition-targets/meal-timing";

const CHOICES: { value: MealTiming; label: string }[] = [
  { value: null, label: "—" },
  { value: "pre", label: "Pre" },
  { value: "post", label: "Post" },
];

export function WorkoutMealTagger({
  text,
  onChange,
}: {
  text: string;
  onChange: (next: string) => void;
}) {
  const meals = listMealHeaders(text);
  if (!meals.length) return null;
  return (
    <div className="space-y-1.5" data-workout-meal-tagger>
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        Workout meals
        <WorkoutMealInfo className="h-4 w-4" />
      </div>
      <div className="divide-y divide-border rounded-xl border border-border">
        {meals.map((m, idx) => (
          <div
            key={`${m.lineIndex}-${idx}`}
            className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5"
          >
            <span className="min-w-0 truncate text-sm">
              {m.base.replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
              {CHOICES.map((c) => {
                const active = m.timing === c.value;
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => onChange(setMealTiming(text, idx, c.value))}
                    aria-pressed={active}
                    aria-label={
                      c.value
                        ? `${m.base} ${c.value === "pre" ? "pre-workout" : "post-workout"}`
                        : `${m.base} not a workout meal`
                    }
                    className={cn(
                      "flex h-9 min-w-11 items-center justify-center gap-1 px-3 text-[13px] transition-colors",
                      // "—" picked is the quiet default; a pre / post pick is the one that stands out
                      active && c.value
                        ? "bg-foreground font-medium text-background"
                        : active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c.value === "pre" && <Zap className="h-3 w-3" />}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
