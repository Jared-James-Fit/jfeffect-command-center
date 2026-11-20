import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { SearchableExercise } from "@/lib/exercise-search";
import type { DescribedMatch } from "@/lib/exercise-identify";
import type { DescribeState } from "@/hooks/use-exercise-search";
import { cn } from "@/lib/utils";

/**
 * "From your description": the library exercises the AI says a described
 * exercise most likely is, at the top of any picker's results. Each says how
 * sure it is in words ("Likely" at most); the person always picks.
 *
 * `renderRow` lets a picker keep its own row (Add, Swap, a tick); without it a
 * plain row calls `onPick`.
 */
export function DescribedMatches<T extends SearchableExercise>({
  state,
  matches,
  onPick,
  renderRow,
  disabled,
  className,
  compact,
}: {
  state: DescribeState;
  matches: readonly DescribedMatch<T>[];
  onPick?: (exercise: T) => void;
  renderRow?: (m: DescribedMatch<T>, hint: string) => ReactNode;
  disabled?: boolean;
  className?: string;
  /** Small rows (the desktop builder's side panel). */
  compact?: boolean;
}) {
  if (state === "idle") return null;
  return (
    <section
      className={cn("space-y-1.5", className)}
      aria-live="polite"
      data-described-matches={state}
    >
      <p
        className={cn(
          "px-1 font-medium text-muted-foreground",
          compact ? "text-[11px]" : "text-[12px]",
        )}
      >
        From your description
      </p>
      {state === "loading" && (
        <div
          className={cn(
            "flex items-center gap-2 px-1 text-muted-foreground",
            compact ? "text-[11px]" : "text-[13px]",
          )}
          data-described-loading
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Working out which exercise you mean…
        </div>
      )}
      {state === "none" && (
        <p className={cn("px-1 text-muted-foreground", compact ? "text-[11px]" : "text-[13px]")}>
          Couldn't place that one. Try a word from its name, the muscle or the equipment.
        </p>
      )}
      {state === "unavailable" && (
        <p className={cn("px-1 text-muted-foreground", compact ? "text-[11px]" : "text-[13px]")}>
          Couldn't read the description right now. The closest names are below.
        </p>
      )}
      {state === "busy" && (
        <p className={cn("px-1 text-muted-foreground", compact ? "text-[11px]" : "text-[13px]")}>
          That's a lot of descriptions in a row. Try the name, or again in a few minutes.
        </p>
      )}
      {state === "done" &&
        matches.map((m) => {
          const hint = m.confidence === "likely" ? "Likely match" : "Possible match";
          if (renderRow) return <div key={m.exercise.id}>{renderRow(m, hint)}</div>;
          const line = [hint, m.exercise.muscle_group, m.exercise.equipment]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={m.exercise.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick?.(m.exercise)}
              data-described-match={m.confidence}
              className={cn(
                "flex w-full flex-col justify-center rounded-xl border border-border bg-card px-3 text-left transition active:scale-[0.99] disabled:opacity-50",
                compact ? "min-h-[36px] py-1.5" : "min-h-[52px] py-2",
              )}
            >
              <span className={cn("font-medium", compact ? "text-[12px]" : "text-[15px]")}>
                {m.exercise.name}
              </span>
              <span
                className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-[12px]")}
              >
                {line}
              </span>
            </button>
          );
        })}
    </section>
  );
}
