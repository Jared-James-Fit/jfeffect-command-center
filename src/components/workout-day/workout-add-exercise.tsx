import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { searchEligibleExercises } from "@/lib/exercise-search";
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

type ExerciseLite = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  category: string | null;
};

export function WorkoutAddExercise({
  onAdd,
  disabled = false,
  subtle = false,
  className,
}: {
  onAdd: (exercise: ExerciseLite) => Promise<void>;
  disabled?: boolean;
  subtle?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: library = [], isLoading } = useQuery({
    queryKey: ["workout-add-exercise-library"],
    enabled: open,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercises")
        .select("id,name,muscle_group,equipment,category")
        .eq("archived", false)
        .order("name")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ExerciseLite[];
    },
  });

  const results = useMemo(() => {
    const q = search.trim();
    if (q.length < 2) return library.slice(0, 30);
    return searchEligibleExercises(library as any, q, { limit: 60 })
      .map((r: any) => r.exercise as ExerciseLite);
  }, [library, search]);

  return (
    <>
      {subtle ? (
        <div className={cn("flex items-center gap-2 py-1", className)}>
          <span className="h-px flex-1 bg-border/45" aria-hidden />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="group grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-40"
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
          className={cn("h-10 w-full rounded-xl border-dashed border-primary/40 bg-primary/5 font-bold text-primary", className)}
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
            <SheetDescription>Add it here without leaving the workout.</SheetDescription>
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
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading exercises…
              </div>
            ) : (
              <div className="space-y-2">
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
                    <span className="shrink-0 text-xs font-bold text-primary">
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
