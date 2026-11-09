import { useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useExerciseLibraryLite,
  type ExerciseLite,
} from "@/components/workout-day/workout-add-exercise";
import { searchEligibleExercises } from "@/lib/exercise-search";
import { MAX_EXERCISES, sameMuscleGroup, topMuscleGroups } from "@/lib/athlete-program-draft";
import { cn } from "@/lib/utils";

const BROWSE_LIMIT = 120;

/**
 * The builder's library picker. "multi": tap as many as you want (numbered in
 * the order they'll go in), then Add; "single": the tap is the pick (Swap).
 * Muscle chips browse without typing, which is most of the work on a phone.
 */
export function ExercisePickerSheet({
  open,
  onOpenChange,
  mode,
  room,
  title,
  description,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "multi" | "single";
  /** How many more the day can take (multi). */
  room: number;
  title: string;
  description: string;
  onPick: (picked: ExerciseLite[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [picked, setPicked] = useState<ExerciseLite[]>([]);
  const { data: library = [], isLoading, isError, refetch } = useExerciseLibraryLite(open);

  const groups = useMemo(() => topMuscleGroups(library, 10), [library]);
  const results = useMemo<ExerciseLite[]>(() => {
    const pool = group ? library.filter((e) => sameMuscleGroup(e.muscle_group, group)) : library;
    const q = search.trim();
    if (q.length >= 2) {
      return searchEligibleExercises(pool, q, { limit: 60 }).results.map((r) => r.exercise);
    }
    return pool.slice(0, BROWSE_LIMIT);
  }, [library, group, search]);

  const reset = () => {
    setSearch("");
    setGroup(null);
    setPicked([]);
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const toggle = (ex: ExerciseLite) => {
    if (mode === "single") {
      onPick([ex]);
      close(false);
      return;
    }
    setPicked((list) => {
      if (list.some((p) => p.id === ex.id)) return list.filter((p) => p.id !== ex.id);
      if (list.length >= room) {
        toast(
          room === 0
            ? `This day is full (${MAX_EXERCISES} exercises is the most).`
            : `Only ${room} more ${room === 1 ? "fits" : "fit"} on this day (${MAX_EXERCISES} is the most).`,
        );
        return list;
      }
      return [...list, ex];
    });
  };

  const add = () => {
    if (!picked.length) return;
    onPick(picked);
    close(false);
  };

  const browsingHint =
    search.trim().length < 2 && !group && library.length > BROWSE_LIMIT
      ? "Search, or pick a muscle to browse."
      : search.trim().length < 2 && group && results.length >= BROWSE_LIMIT
        ? "Search to narrow it down."
        : null;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="flex h-[88dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        <SheetHeader className="shrink-0 space-y-0 border-b border-border px-4 pb-3 pt-2 text-left">
          <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
              <SheetDescription className="text-[13px]">{description}</SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Close"
              onClick={() => close(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // the keyboard's Search key puts it away so the list and Add are in reach
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              enterKeyHint="search"
              type="search"
              placeholder="Search exercises"
              aria-label="Search exercises"
              className="h-11 pl-9 text-base"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {groups.length ? (
            <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <GroupChip selected={!group} onClick={() => setGroup(null)}>
                All
              </GroupChip>
              {groups.map((g) => (
                <GroupChip
                  key={g}
                  selected={!!group && sameMuscleGroup(group, g)}
                  onClick={() => setGroup(group && sameMuscleGroup(group, g) ? null : g)}
                >
                  {g}
                </GroupChip>
              ))}
            </div>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading exercises…
            </div>
          ) : isError ? (
            <div className="space-y-3 py-10 text-center text-sm text-muted-foreground">
              <p>Couldn't load the exercise library.</p>
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing matches that. Try another word.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {results.map((ex) => {
                const order = picked.findIndex((p) => p.id === ex.id);
                const on = order >= 0;
                return (
                  <li key={ex.id}>
                    <button
                      type="button"
                      aria-pressed={mode === "multi" ? on : undefined}
                      onClick={() => toggle(ex)}
                      className={cn(
                        "flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                        on ? "border-foreground bg-secondary" : "border-border bg-card",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{ex.name}</div>
                        <div className="truncate text-[12px] text-muted-foreground">
                          {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ") ||
                            "Exercise"}
                        </div>
                      </div>
                      {mode === "multi" ? (
                        <span
                          aria-hidden
                          className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[13px] font-semibold tabular-nums",
                            on
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-transparent",
                          )}
                        >
                          {on ? order + 1 : <Check className="h-3.5 w-3.5" />}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[13px] font-medium text-muted-foreground">
                          Pick
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {browsingHint && !isLoading ? (
            <p className="py-3 text-center text-[13px] text-muted-foreground">{browsingHint}</p>
          ) : null}
        </div>

        {mode === "multi" ? (
          <div className="shrink-0 border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3 dark:bg-card">
            <div className="flex items-center gap-2">
              {picked.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-12 shrink-0 px-3 text-muted-foreground"
                  onClick={() => setPicked([])}
                >
                  Clear
                </Button>
              ) : null}
              <Button
                type="button"
                className="h-12 flex-1 text-base"
                disabled={!picked.length}
                onClick={add}
              >
                {picked.length
                  ? `Add ${picked.length} ${picked.length === 1 ? "exercise" : "exercises"}`
                  : "Tap exercises to add them"}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function GroupChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] capitalize transition",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground",
      )}
    >
      {children}
    </button>
  );
}
