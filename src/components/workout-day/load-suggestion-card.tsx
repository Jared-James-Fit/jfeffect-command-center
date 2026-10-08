import { Info, Target } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { audibleStep, type LoadModel, type LoadSuggestion } from "@/lib/load-suggestion";

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * The load suggestion on an exercise card: the range for the prescribed reps @
 * RPE, a one-line "audible" (moving fast → add, grinding → drop) and an info
 * button holding the why + "just a suggestion" so the card stays one glance.
 */
export interface WarmupGauge {
  /** What the last warm-up should be (display unit), when a top-set target exists. */
  suggested: { load: number; reps: number } | null;
}

export function LoadSuggestionCard({
  hint,
  model,
  plan,
  warmup = null,
}: {
  hint: LoadSuggestion | null;
  model: LoadModel;
  plan: { reps: number; rpe: number };
  /** Last-warm-up tip — offered only before the first working set (the set table holds the warm-up row). */
  warmup?: WarmupGauge | null;
}) {
  if (model.status === "calibrating" || !hint) {
    // No usable history yet: the set table's warm-up row is the way to a first
    // number, so don't add a dead-end note above it.
    if (warmup) return null;
    if (model.historySessions === 0) return null;
    return (
      <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        <Target className="h-3 w-3" aria-hidden="true" />
        Load suggestions unlock after a week of logs with RPE
      </div>
    );
  }
  const range = hint.low === hint.high
    ? `${fmtNum(hint.target)} ${hint.unit}`
    : `${fmtNum(hint.low)}–${fmtNum(hint.high)} ${hint.unit}`;
  const why =
    model.source === "warmup"
      ? "your final warm-up (first time on this lift, so kept conservative)"
      : model.source === "history_warmup"
        ? "your recent sessions, nudged by your final warm-up"
        : model.source === "history"
      ? model.readiness.reasons.length
        ? `your recent sessions, eased a little for ${model.readiness.reasons[0]}`
        : model.staleDays
          ? `your recent sessions, eased back after ${Math.round(model.staleDays / 7)} weeks off`
          : `your last ${Math.min(model.historySessions, 8)} sessions`
      : "the sets you've logged today";
  const audible = audibleStep(hint.target, hint.unit);
  const label =
    model.source === "warmup" ? "From warm-up" : model.source === "history_warmup" ? "Warm-up tuned" : "Suggested";
  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-primary/25 bg-primary/5" data-testid="load-suggestion">
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-sm font-bold tabular-nums text-foreground">
          {range}
          <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
            {plan.reps} {plan.reps === 1 ? "rep" : "reps"} @ RPE {fmtNum(plan.rpe)}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground" data-testid="load-audible">
          {label}<span aria-hidden="true"> · </span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">▲ Fast +{fmtNum(audible)}</span>
          <span aria-hidden="true"> · </span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">▼ Slow −{fmtNum(audible)} {hint.unit}</span>
        </div>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="How this suggestion works" className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10">
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-72 text-xs leading-relaxed">
          <p className="font-semibold">Just a suggestion</p>
          <p className="mt-1 text-muted-foreground">
            Based on {why}.
            {Math.abs((model.bodyweightScale ?? 1) - 1) >= 0.01 &&
              ` Adjusted ${model.bodyweightScale > 1 ? "up" : "down"} ${Math.abs(Math.round((model.bodyweightScale - 1) * 1000) / 10)}% for your bodyweight change.`}
            {" "}Let your first set decide:
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li><span className="font-semibold text-foreground">Bar flying?</span> Add {fmtNum(audible)} {hint.unit} next set.</li>
            <li><span className="font-semibold text-foreground">Slow or form breaking?</span> Drop {fmtNum(audible)} {hint.unit}.</li>
            <li><span className="font-semibold text-foreground">Pain?</span> Stop and message your coach.</li>
          </ul>
          <p className="mt-1 text-muted-foreground">Log an honest RPE and the next suggestion updates.</p>
          {warmup && (
            <p className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">
              <span className="font-semibold text-foreground">Tip: use your last warm-up as a gauge.</span>{" "}
              {warmup.suggested
                ? `Work up to about ${fmtNum(warmup.suggested.load)} ${hint.unit} × ${warmup.suggested.reps}, then log how it felt. `
                : "Log your heaviest warm-up and how it felt. "}
              Moving easier than usual nudges this number up, harder nudges it down — before your first working set.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
    </div>
  );
}
