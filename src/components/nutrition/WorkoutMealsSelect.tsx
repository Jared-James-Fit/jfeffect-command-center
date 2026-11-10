import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WORKOUT_MEALS_OPTIONS, type WorkoutMealsMode } from "@/lib/nutrition-ai-prompts";

/** Coach control: how the AI should handle Pre-/Post-Workout meals. */
export function WorkoutMealsSelect({
  value,
  onChange,
  className,
}: {
  value: WorkoutMealsMode;
  onChange: (v: WorkoutMealsMode) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as WorkoutMealsMode)}>
      <SelectTrigger className={className ?? "h-10"} aria-label="Workout meals">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WORKOUT_MEALS_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function workoutMealsLabel(v: string | null | undefined): string | null {
  return WORKOUT_MEALS_OPTIONS.find((o) => o.value === v)?.label ?? null;
}
