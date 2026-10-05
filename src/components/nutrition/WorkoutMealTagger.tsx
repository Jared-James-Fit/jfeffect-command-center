/**
 * Coach editor: one row of chips per meal so a pasted / AI plan's
 * Pre-Workout and Post-Workout meals can be set, moved or cleared with a tap.
 * Writes the tag into the meal line itself ("Meal 2 (Pre-Workout)").
 */
import { Dumbbell, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { listMealHeaders, setMealTiming, type MealTiming } from "@/lib/nutrition-targets/meal-timing";

const CHOICES: { value: MealTiming; label: string }[] = [
  { value: null, label: "—" },
  { value: "pre", label: "Pre" },
  { value: "post", label: "Post" },
];

export function WorkoutMealTagger({ text, onChange }: { text: string; onChange: (next: string) => void }) {
  const meals = listMealHeaders(text);
  if (!meals.length) return null;
  return (
    <div className="rounded-md border border-border/70 bg-background/60 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Dumbbell className="h-3 w-3 text-primary" /> Workout meals
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {meals.map((m, idx) => (
          <div key={`${m.lineIndex}-${idx}`} className="flex items-center gap-1">
            <span className="text-[11px] font-semibold">{m.base.replace(/\b\w/g, (c) => c.toUpperCase())}</span>
            <div className="flex overflow-hidden rounded-full border border-border">
              {CHOICES.map((c) => {
                const active = m.timing === c.value;
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => onChange(setMealTiming(text, idx, c.value))}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold transition",
                      active && c.value === "pre" && "bg-amber-500/20 text-amber-600 dark:text-amber-400",
                      active && c.value === "post" && "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                      active && c.value === null && "bg-secondary text-foreground",
                      !active && "text-muted-foreground hover:bg-secondary/60",
                    )}
                  >
                    {c.value === "pre" && <Zap className="h-2.5 w-2.5" />}
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
