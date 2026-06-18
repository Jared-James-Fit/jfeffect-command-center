import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Loader2,
  PlayCircle,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
  vimeo_embed_url?: string | null;
};

type RankedSuggestion = { ex: ExerciseLite; reason: string };

const REASONS = [
  "Same muscle target",
  "Same muscle, different equipment",
  "Similar difficulty",
  "Same movement category",
] as const;

/**
 * Deterministic ranker. Buckets, in order:
 *   1. same muscle_group + same category
 *   2. same muscle_group, different equipment
 *   3. same category, same difficulty
 *   4. same category (fallback)
 * Within a bucket, sort by name (case-insensitive). Dedupe across buckets,
 * drop the source exercise, cap at 5.
 */
function rankSuggestions(src: ExerciseLite, pool: ExerciseLite[]): RankedSuggestion[] {
  const cand = pool.filter((e) => e.id !== src.id);
  const byName = (a: ExerciseLite, b: ExerciseLite) =>
    (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase());
  const buckets: ExerciseLite[][] = [
    cand.filter((e) => e.muscle_group && e.muscle_group === src.muscle_group && e.category === src.category).sort(byName),
    cand.filter((e) => e.muscle_group && e.muscle_group === src.muscle_group && e.equipment !== src.equipment).sort(byName),
    cand.filter((e) => e.category && e.category === src.category && e.difficulty && e.difficulty === src.difficulty).sort(byName),
    cand.filter((e) => e.category && e.category === src.category).sort(byName),
  ];
  const out: RankedSuggestion[] = [];
  const seen = new Set<string>();
  buckets.forEach((bucket, i) => {
    for (const e of bucket) {
      if (out.length >= 5) return;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ ex: e, reason: REASONS[i] });
    }
  });
  return out;
}

const SELECT_COLS = "id,name,muscle_group,category,equipment,difficulty,vimeo_embed_url";
const PAGE_SIZE = 20;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ExerciseRowCard({
  ex,
  reason,
  onSelect,
}: {
  ex: ExerciseLite;
  reason?: string;
  onSelect: () => void;
}) {
  const meta = [ex.muscle_group, ex.equipment].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{ex.name}</span>
          {ex.vimeo_embed_url && (
            <PlayCircle className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Video available" />
          )}
        </div>
        {reason && <div className="mt-0.5 text-[11px] font-medium text-primary/80">{reason}</div>}
        {meta && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</div>}
      </div>
      <Button size="sm" variant="default" className="h-7 px-2 text-xs shrink-0" onClick={onSelect}>
        Select
      </Button>
    </div>
  );
}

type ViewMode = "suggestions" | "search" | "confirm";

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
  const [mode, setMode] = useState<ViewMode>("suggestions");
  const [pending, setPending] = useState<ExerciseLite | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebounced(search.trim(), 300);

  // Reset state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setMode("suggestions");
      setPending(null);
      setSearch("");
      setPage(0);
    }
  }, [open]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["quick-swap-suggestions", exerciseId, muscleGroup, category, difficulty, equipment],
    enabled: open && !!exerciseId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!exerciseId) return [] as RankedSuggestion[];
      const filters: string[] = [];
      if (muscleGroup) filters.push(`muscle_group.eq.${muscleGroup}`);
      if (category) filters.push(`category.eq.${category}`);
      let q = supabase
        .from("exercises")
        .select(SELECT_COLS)
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

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ["quick-swap-search", debouncedSearch, page, exerciseId],
    enabled: open && mode === "search" && debouncedSearch.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from("exercises")
        .select(SELECT_COLS, { count: "exact" })
        .eq("archived", false)
        .ilike("name", `%${debouncedSearch}%`)
        .order("name")
        .range(from, to);
      if (exerciseId) q = q.neq("id", exerciseId);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as ExerciseLite[], total: count ?? 0 };
    },
  });

  const startSelect = (ex: ExerciseLite) => {
    const diff =
      (muscleGroup && ex.muscle_group && ex.muscle_group !== muscleGroup) ||
      (category && ex.category && ex.category !== category);
    if (diff) {
      setPending(ex);
      setMode("confirm");
    } else {
      confirmSwap(ex);
    }
  };

  const confirmSwap = (ex: ExerciseLite) => {
    // Persistence wiring lands in the next pass; for now confirm + close.
    toast.success(`Swap queued: ${exerciseName} → ${ex.name}`);
    setOpen(false);
  };

  const totalPages = useMemo(() => {
    if (!searchResults) return 1;
    return Math.max(1, Math.ceil(searchResults.total / PAGE_SIZE));
  }, [searchResults]);

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
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="truncate">{exerciseName}</SheetTitle>
            <SheetDescription>
              {mode === "search"
                ? "Search all exercises."
                : mode === "confirm"
                ? "Confirm swap."
                : "Pick an alternate exercise."}
            </SheetDescription>
          </SheetHeader>

          {mode === "suggestions" && (
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
              {suggestions.map(({ ex, reason }) => (
                <ExerciseRowCard key={ex.id} ex={ex} reason={reason} onSelect={() => startSelect(ex)} />
              ))}

              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setMode("search")}
                disabled={!exerciseId}
              >
                <Search className="mr-2 h-4 w-4" /> Search All Exercises
              </Button>
            </div>
          )}

          {mode === "search" && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setMode("suggestions")}
                  aria-label="Back to suggestions"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Input
                  autoFocus
                  placeholder="Search exercises…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />
              </div>

              {debouncedSearch.length < 2 && (
                <p className="text-xs text-muted-foreground px-1">Type at least 2 characters.</p>
              )}
              {debouncedSearch.length >= 2 && isSearching && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </div>
              )}
              {debouncedSearch.length >= 2 && !isSearching && (searchResults?.rows.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">No matches.</p>
              )}
              {(searchResults?.rows ?? []).map((ex) => (
                <ExerciseRowCard key={ex.id} ex={ex} onSelect={() => startSelect(ex)} />
              ))}

              {searchResults && searchResults.total > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}

          {mode === "confirm" && pending && (
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <strong className="block">Different target</strong>
                  This exercise targets a different muscle group or category. Swap anyway?
                </div>
              </div>
              <ExerciseRowCard ex={pending} onSelect={() => confirmSwap(pending)} />
            </div>
          )}

          <SheetFooter className="mt-4">
            <Button variant="ghost" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default QuickSwapButton;