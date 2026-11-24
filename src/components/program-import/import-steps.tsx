import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const IMPORT_STEPS = ["Upload", "Review", "Save"] as const;

/**
 * Where an import is, in three steps: Upload your program, Review it, Save it.
 * One slim line at the top of every import screen, the step you're on
 * strongest, the ones behind you ticked.
 */
export function ImportSteps({
  at,
  busy = false,
  className,
}: {
  at: 1 | 2 | 3;
  busy?: boolean;
  className?: string;
}) {
  return (
    <ol
      className={cn("flex items-center gap-2", className)}
      aria-label={`Step ${at} of 3: ${IMPORT_STEPS[at - 1]}`}
      data-import-steps={at}
    >
      {IMPORT_STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < at;
        const on = n === at;
        return (
          <li
            key={label}
            className="flex min-w-0 items-center gap-2"
            aria-current={on ? "step" : undefined}
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-4 shrink-0 sm:w-8",
                  n <= at ? "bg-foreground/40" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums",
                done
                  ? "bg-success/15 text-success"
                  : on
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                on && busy && "ring-2 ring-foreground/25 ring-offset-2 ring-offset-background",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
            </span>
            <span
              className={cn(
                "truncate text-[13px]",
                on ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
