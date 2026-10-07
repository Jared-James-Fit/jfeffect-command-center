/**
 * Coach editor: label the Pre-/Post-Workout meal on every training day in one
 * tap. Defaults to when the client actually trains (logged workouts); any
 * training time can be picked instead. Only meal header lines change.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getClientTrainingPatternFn } from "@/lib/nutrition-ai-plans.functions";
import { TRAINING_TIME_LABELS } from "@/lib/nutrition-targets/training-pattern";
import { autoLabelPlan, type AutoLabelTime } from "@/lib/nutrition-targets/workout-meal-suggest";

const TIMES: Array<{ value: AutoLabelTime; label: string }> = [
  ...(Object.entries(TRAINING_TIME_LABELS) as Array<[AutoLabelTime, string]>).map(([value, label]) => ({ value, label })),
  { value: "varies", label: "It varies (movable pair)" },
];

export function AutoLabelWorkoutMeals<D extends { day_label: string; notes?: string | null }>({
  clientId,
  days,
  onApply,
}: {
  clientId?: string | null;
  days: D[];
  onApply: (next: D[]) => void;
}) {
  const getPattern = useServerFn(getClientTrainingPatternFn);
  const { data: pattern } = useQuery({
    queryKey: ["client-training-pattern", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: () => getPattern({ data: { clientId: clientId! } }),
  });

  const apply = (time: AutoLabelTime) => {
    const { days: next, labelled } = autoLabelPlan(days, time);
    if (!labelled.length) {
      toast.error("No meals found to label — paste the meal plan first (Meal 1, Meal 2…).");
      return;
    }
    onApply(next);
    const n = (i: number | null) => (i == null ? null : `Meal ${i + 1}`);
    const first = labelled[0];
    const what = [first.pre != null && `${n(first.pre)} Pre`, first.post != null && `${n(first.post)} Post`].filter(Boolean).join(", ");
    toast.success(`Labelled ${labelled.length} training day${labelled.length === 1 ? "" : "s"}: ${what}. Rest days untouched.`);
  };

  const detected = pattern?.confident ? (pattern.bucket as AutoLabelTime) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1" title="Label the Pre-/Post-Workout meal on every training day">
          <Dumbbell className="h-3.5 w-3.5 text-primary" /> Auto-label workout meals <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {pattern ? pattern.summary : clientId ? "No logged workouts yet — pick when they train." : "Pick when they train."}
        </DropdownMenuLabel>
        {detected && (
          <>
            <DropdownMenuItem onClick={() => apply(detected)} className="font-semibold">
              {TRAINING_TIME_LABELS[detected as keyof typeof TRAINING_TIME_LABELS]}
              <span className="ml-auto text-[10px] font-normal text-primary">from logged workouts</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {TIMES.filter((t) => t.value !== detected).map((t) => (
          <DropdownMenuItem key={t.value} onClick={() => apply(t.value)}>
            {t.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
          Only the meal names change (e.g. “Meal 3 (Pre-Workout)”). Foods and macros stay exactly as they are. Rest days are skipped.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
