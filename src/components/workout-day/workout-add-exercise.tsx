import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { searchEligibleExercises } from "@/lib/exercise-search";
import { sameMuscleGroup, topMuscleGroups } from "@/lib/athlete-program-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type ExerciseLite = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  category: string | null;
};

const LIBRARY_PAGE = 1000;

/**
 * The unarchived library, light (one shared cache for every picker that adds
 * an exercise), read whole page by page: one request capped at 2,000 rows
 * could silently drop the end of the alphabet as the library grows past it.
 */
export function useExerciseLibraryLite(enabled: boolean) {
  return useQuery({
    queryKey: ["workout-add-exercise-library"],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const all: ExerciseLite[] = [];
      for (let from = 0; from < 20 * LIBRARY_PAGE; from += LIBRARY_PAGE) {
        const { data, error } = await supabase
          .from("exercises")
          .select("id,name,muscle_group,equipment,category")
          .eq("archived", false)
          .order("name")
          .order("id")
          .range(from, from + LIBRARY_PAGE - 1);
        if (error) throw error;
        all.push(...((data ?? []) as ExerciseLite[]));
        if (!data || data.length < LIBRARY_PAGE) break;
      }
      return all;
    },
  });
}

/**
 * The exercises this athlete logged most recently, newest first (their own
 * sets, so RLS keeps it to them): what they're most likely to add.
 */
function useRecentExerciseIds(clientId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["workout-add-recent", clientId ?? null],
    enabled: enabled && !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pl_row_results")
        .select("completed_at, pl_exercise_rows!inner(exercise_id)")
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      return recentExerciseIds(data ?? []);
    },
  });
}

/** Distinct exercise ids in the order they were last logged (at most `n`). */
export function recentExerciseIds(rows: readonly { pl_exercise_rows?: { exercise_id?: string | null } | null }[], n = 15): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.pl_exercise_rows?.exercise_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= n) break;
  }
  return out;
}

const RECENT = "Recent";

export function WorkoutAddExercise({
  onAdd,
  disabled = false,
  subtle = false,
  className,
  description = "Add it here without leaving the workout.",
  clientId = null,
}: {
  onAdd: (exercise: ExerciseLite) => Promise<void>;
  disabled?: boolean;
  subtle?: boolean;
  className?: string;
  /** The line under the sheet's title. */
  description?: string;
  /** Whose recent exercises to offer first (the athlete's own). */
  clientId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);

  const { data: library = [], isLoading } = useExerciseLibraryLite(open);
  const { data: recentIds = [] } = useRecentExerciseIds(clientId, open);

  const recent = useMemo<ExerciseLite[]>(() => {
    const byId = new Map(library.map((e) => [e.id, e]));
    return recentIds.map((id) => byId.get(id)).filter(Boolean) as ExerciseLite[];
  }, [library, recentIds]);
  const groups = useMemo(() => topMuscleGroups(library, 8), [library]);
  // Opens on what they've done lately; a muscle chip or a search takes over.
  const chip = group ?? (recent.length ? RECENT : null);

  const results = useMemo<ExerciseLite[]>(() => {
    const q = search.trim();
    const pool = chip && chip !== RECENT ? library.filter((e) => sameMuscleGroup(e.muscle_group, chip)) : library;
    if (q.length >= 2) {
      return searchEligibleExercises(pool as any, q, { limit: 60 })
        .results.map((r: any) => r.exercise as ExerciseLite);
    }
    if (chip === RECENT) return recent;
    return pool.slice(0, 40);
  }, [library, search, chip, recent]);

  const chips = [...(recent.length ? [RECENT] : []), ...groups];

  return (
    <>
      {subtle ? (
        <div className={cn("flex items-center gap-2 py-1", className)}>
          <span className="h-px flex-1 bg-border/45" aria-hidden />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="group grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm transition hover:border-foreground/40 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            aria-label="Add exercise here"
            title="Add exercise here"
          >
            <Plus className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
          </button>
          <span className="h-px flex-1 bg-border/45" aria-hidden />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className={cn("h-10 w-full rounded-xl border-dashed font-semibold text-foreground", className)}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" /> Add exercise
        </Button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" hideCloseButton className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-4 text-left">
            <SheetTitle>Add exercise</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exercises…"
                className="h-10 pl-9 text-base"
                autoComplete="off"
                autoCorrect="off"
              />
            </div>
            {chips.length > 1 && (
              <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Filter exercises" data-add-chips>
                {chips.map((c) => {
                  const on = chip === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGroup(c === RECENT || on ? null : c)}
                      className={cn(
                        "h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors",
                        on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground",
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            )}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading exercises…
              </div>
            ) : (
              <div className="space-y-2">
                {results.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No exercises match.</p>
                )}
                {results.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    disabled={addingId != null}
                    onClick={async () => {
                      setAddingId(ex.id);
                      try {
                        await onAdd(ex);
                        setOpen(false);
                        setSearch("");
                        setGroup(null);
                      } finally {
                        setAddingId(null);
                      }
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition active:scale-[0.99]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{ex.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ") || "Exercise"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground">
                      {addingId === ex.id ? "Adding…" : "Add"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
