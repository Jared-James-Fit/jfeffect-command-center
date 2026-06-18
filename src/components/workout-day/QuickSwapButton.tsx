import { useState } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type ExerciseLite = {
  id: string;
  name: string;
  muscle_group: string | null;
  category: string | null;
  equipment: string | null;
  difficulty: string | null;
};

/**
 * Deterministic ranker. Buckets, in order:
 *   1. same muscle_group + same category
 *   2. same muscle_group, different equipment
 *   3. same category, same difficulty
 *   4. same category (fallback)
 * Within a bucket, sort by name (case-insensitive). Dedupe across buckets,
 * drop the source exercise, cap at 5.
 */
function rankSuggestions(src: ExerciseLite, pool: ExerciseLite[]): ExerciseLite[] {
  const cand = pool.filter((e) => e.id !== src.id);
  const byName = (a: ExerciseLite, b: ExerciseLite) =>
    (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase());
  const buckets: ExerciseLite[][] = [
    cand.filter((e) => e.muscle_group && e.muscle_group === src.muscle_group && e.category === src.category).sort(byName),
    cand.filter((e) => e.muscle_group && e.muscle_group === src.muscle_group && e.equipment !== src.equipment).sort(byName),
    cand.filter((e) => e.category && e.category === src.category && e.difficulty && e.difficulty === src.difficulty).sort(byName),
    cand.filter((e) => e.category && e.category === src.category).sort(byName),
  ];
  const out: ExerciseLite[] = [];
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const e of bucket) {
      if (out.length >= 5) return out;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

/**
 * Shared Quick Swap entry point used by every exercise row in
 * WorkoutDayView (both coaching clients and membership users).
 */
export function QuickSwapButton({
  exerciseId,
  exerciseName,
  muscleGroup,
  category,
  equipment,
  difficulty,
}: {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  muscleGroup?: string | null;
  category?: string | null;
  equipment?: string | null;
  difficulty?: string | null;
}) {
  const [open, setOpen] = useState(false);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["quick-swap-suggestions", exerciseId, muscleGroup, category, difficulty, equipment],
    enabled: open && !!exerciseId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!exerciseId) return [] as ExerciseLite[];
      const filters: string[] = [];
      if (muscleGroup) filters.push(`muscle_group.eq.${muscleGroup}`);
      if (category) filters.push(`category.eq.${category}`);
      let q = supabase
        .from("exercises")
        .select("id,name,muscle_group,category,equipment,difficulty")
        .eq("archived", false)
        .neq("id", exerciseId)
        .limit(200);
      if (filters.length) q = q.or(filters.join(","));
      const { data, error } = await q;
      if (error) throw error;
      const src: ExerciseLite = {
        id: exerciseId,
        name: exerciseName,
        muscle_group: muscleGroup ?? null,
        category: category ?? null,
        equipment: equipment ?? null,
        difficulty: difficulty ?? null,
      };
      return rankSuggestions(src, (data ?? []) as ExerciseLite[]);
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-xs"
        aria-label={`Quick swap ${exerciseName}`}
      >
        <ArrowLeftRight className="mr-1 h-3 w-3" /> Swap
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="truncate">{exerciseName}</SheetTitle>
            <SheetDescription>Pick an alternate exercise.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {!exerciseId && (
              <p className="text-sm text-muted-foreground">
                This row isn't linked to an exercise, so we can't suggest alternates.
              </p>
            )}
            {exerciseId && isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding alternates…
              </div>
            )}
            {exerciseId && !isLoading && suggestions.length === 0 && (
              <p className="text-sm text-muted-foreground">No close alternates found.</p>
            )}
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex w-full items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[s.muscle_group, s.category, s.equipment].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default QuickSwapButton;