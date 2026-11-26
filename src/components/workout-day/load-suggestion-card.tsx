import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, Check, Info, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShowLoadSuggestions } from "@/lib/load-suggestion-visibility";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { audibleStep, BACKOFF_FATIGUE, loadStep, roundToStep, type LoadModel, type LoadSuggestion, type RepProgression } from "@/lib/load-suggestion";
import type { PlannedLoadView } from "@/lib/workouts/planned-load";
import { WARMUP_TOO_EASY } from "@/lib/final-warmup";
import { progressionChange, suggestionBadge } from "@/lib/workouts/card-suggestion";
import { HapticTap } from "@/components/haptic-tap";

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * The load suggestion on an exercise card: the right half of the card's
 * reference row under the prescription (ExerciseBlock's data-rx-refs), beside
 * "Last time" on the left. One tap on it logs the first open set at the weight
 * and the untouched sets below fill in with it and log too, the same as a tap on
 * set 1's number (a range logs at its middle, the engine's estimate; a weight
 * picked by feel inside it is typed in set 1); its ⓘ opens how it's worked out
 * (the range, the "audible", the why, the off switch). No weight buttons.
 */

/** The reference row and its halves: one quiet strip, never a card. */
export const REF_BAR = "mt-2.5 flex items-stretch overflow-hidden rounded-xl bg-muted/50";
export const REF_CELL = "flex min-h-[52px] min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2 text-left";
/** A half that's a button: it says so when pressed. */
export const REF_TAP = "transition-colors hover:bg-muted active:bg-muted";
export const REF_LABEL = "flex min-w-0 items-center gap-1 text-xs text-muted-foreground";
export const REF_VALUE = "break-words text-[15px] font-semibold leading-snug tabular-nums text-foreground";
/** The hairline between the halves. */
export const REF_DIVIDER = "my-2.5 w-px shrink-0 bg-border";
/** Last and Suggested's shared size (older callers). */
export const REF_TEXT = "text-[15px] leading-snug";

export function LoadSuggestionCard({
  hint,
  model,
  plan,
  warmupReads = false,
  fromName = null,
  picks = null,
  showPlan = true,
  onApply = null,
}: {
  hint: LoadSuggestion | null;
  model: LoadModel;
  plan: { reps: number; rpe: number };
  /**
   * A warm-up logged now (with + Warm-up, never prompted) would still be read
   * for today's weight: before the first working set of an RPE-led heavy
   * barbell lift. Only the ⓘ says so; nothing suggests a warm-up weight.
   */
  warmupReads?: boolean;
  /** The card today's adjustment comes from (model.dayFactor), e.g. "Competition Squat". */
  fromName?: string | null;
  /** A range to pick within by feel (suggestionPicks): the first set of a main lift. Shown, never offered as buttons; the chip logs its middle. */
  picks?: { low: number; high: number; loads: number[] } | null;
  /** Say "× 5 @ 6" after the weight: only when the prescription right above it doesn't already (a range of reps or RPE, or RIR). */
  showPlan?: boolean;
  /** Logs the open sets at a weight (a range: at its middle, hint.target); resolves to how many it logged. Null: nothing to log. */
  onApply?: ((load: number) => Promise<number>) | null;
}) {
  if (model.status === "calibrating" || !hint) {
    // Suggest is on but there's no number yet: say when there will be one, and why in the info.
    // A warm-up too easy to read never becomes a made-up number (load-suggestion.ts note 8).
    const tooEasy = !!model.warmupTooEasy;
    const why = tooEasy
      ? `${WARMUP_TOO_EASY} from your last warm-up, and no logs of this lift yet`
      : model.historySessions === 0 ? "No logs of this lift yet" : "No recent logs of this lift with an RPE";
    const next = tooEasy
      ? "Log your first set with an RPE and the rest get a live suggestion. A heavier warm-up (RPE 6 or more) would set it now."
      : warmupReads
        ? "Log your first set with an RPE and the rest get a live suggestion. A warm-up logged with + Warm-up can set it sooner."
        : "Log your first set with an RPE and the rest get a live suggestion.";
    return (
      <SuggestionPopover
        label={`Suggested: none yet. ${why}`}
        testId="load-suggestion-pending"
        cell={
          <>
            <span className={REF_LABEL}>Suggested <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></span>
            <span className="text-[13px] leading-snug text-muted-foreground" data-load-pending={tooEasy ? "warmup-too-easy" : undefined}>
              {tooEasy ? "Warm-up too easy · after your first set" : "After your first set"}
            </span>
          </>
        }
      >
        <p className="text-foreground"><span className="font-medium">{why}.</span> {next}</p>
        <TurnOff />
      </SuggestionPopover>
    );
  }
  const parts = suggestionParts({ hint, model, fromName, picks });
  const { badge, shown } = parts;
  const note = badge ? ` (${badge.text})` : "";
  const planText = showPlan ? ` × ${plan.reps} @ ${fmtNum(plan.rpe)}` : "";
  const value = (
    <span className={REF_VALUE}>
      <span data-testid="load-target">{shown} {hint.unit}</span>
      {showPlan && <span className="font-normal text-muted-foreground">{planText}</span>}
    </span>
  );
  const why = <SuggestionWhyBody hint={hint} model={model} warmupReads={warmupReads} picks={picks} rpe={plan.rpe} canApply={!!onApply} {...parts} />;
  if (onApply) {
    // One tap logs the open sets at it (a range at its middle); the ⓘ beside it explains.
    return (
      <div className={REF_CELL} data-testid="load-suggestion" data-picks={picks ? "" : undefined}>
        <span className={cn(REF_LABEL, "justify-between")}>
          <span className="flex min-w-0 items-center gap-1">
            {badge?.live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />}
            Suggested
          </span>
          <InfoButton label="How Suggested is worked out" testId="load-suggestion-info">{why}</InfoButton>
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <FillChip
            load={hint.target}
            unit={hint.unit}
            shown={shown}
            small={!!picks}
            ariaLabel={`Suggested ${shown} ${hint.unit}${planText}${note}. Log your open sets at ${fmtNum(hint.target)} ${hint.unit}`}
            title={picks ? `Tap to log your sets at ${fmtNum(hint.target)} ${hint.unit}` : "Tap to log your sets at this weight"}
            onApply={onApply}
          />
          {hint.progression ? (
            <span className="text-[13px] tabular-nums text-muted-foreground" data-progression={hint.progression.action}>{progressionChange(hint.progression, hint.unit)}</span>
          ) : showPlan && <span className="text-[13px] tabular-nums text-muted-foreground">{planText.trim()}</span>}
        </span>
      </div>
    );
  }
  return (
    <SuggestionPopover
      label={`Suggested ${shown} ${hint.unit}${planText}${note}. How it's worked out`}
      testId="load-suggestion"
      picks={!!picks}
      cell={
        <>
          <span className={REF_LABEL}>
            {badge?.live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />}
            Suggested
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </span>
          {value}
          {hint.progression && <span className="text-[13px] tabular-nums text-muted-foreground" data-progression={hint.progression.action}>{progressionChange(hint.progression, hint.unit)}</span>}
        </>
      }
    >
      {why}
    </SuggestionPopover>
  );
}

/** A double-progression suggestion's change from last time (card-suggestion.ts, shared with the coach's quick view). */
export { progressionChange };

/** Why a double-progression suggestion is what it is, in a coach's words. */
export function progressionWhy(p: RepProgression, unit: string): string {
  const reps = p.reps.join(", ");
  const top = p.range.hi;
  const from = `${fmtNum(p.from)} ${unit}`;
  if (p.action === "add") return `Last time: ${from} for ${reps}, the top of ${p.range.lo}–${top} on every set. So it goes up the smallest step (${progressionChange(p, unit)}). Aim for ${p.range.lo}+ reps, then build back to ${top}.`;
  if (p.action === "drop") return `Last time: ${from} for ${reps}, short of ${p.range.lo} on every set. So it comes down a step (${progressionChange(p, unit)}). Build back up to ${top}.`;
  if (p.bigJump) return `Last time: ${from} for ${reps}. The next weight up is a big jump, so stay at ${from} and add reps past ${top} before you move up.`;
  return `Last time: ${from} for ${reps}. Stay at ${from} until every set reaches ${top} reps at the target effort, then it goes up.`;
}

/**
 * The weight as a quiet chip with a fill-down arrow (information first, never a
 * competing primary action: the card's one accent stays the set you log): one
 * tap logs the first open set at it and the untouched sets below fill in and log
 * too (the card says how many, with Undo). Suggested and a coach's planned %
 * both use it.
 */
function FillChip({ load, unit, shown, small = false, ariaLabel, title = "Tap to log your sets at this weight", onApply }: {
  load: number;
  unit: string;
  /** what the chip reads: the weight, or a range ("187.5–197.5") */
  shown: string;
  /** a range stays on one line on a phone */
  small?: boolean;
  ariaLabel: string;
  title?: string;
  onApply: (load: number) => Promise<number>;
}) {
  const [busy, setBusy] = useState(false);
  const fill = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onApply(load);
    } catch {
      toast.error("Couldn't log your sets. Try again");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void fill()}
      disabled={busy}
      aria-label={ariaLabel}
      title={title}
      data-testid="load-apply"
      className={cn(
        "relative inline-flex min-h-9 max-w-full items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 font-semibold leading-tight tabular-nums text-foreground transition hover:bg-muted active:scale-[0.97] active:bg-muted disabled:opacity-60",
        small ? "text-[13px]" : "text-sm",
      )}
    >
      <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span data-testid="load-target">{shown}{"\u00a0"}{unit}</span>
      {/* the iPhone's tap as the finger logs the sets (haptic-tap.tsx) */}
      {!busy && <HapticTap />}
    </button>
  );
}

/** The ⓘ beside a half's label: its own button, opening what's behind the number. */
function InfoButton({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          className="-my-2 -mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground active:bg-muted"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 text-xs leading-relaxed" data-testid="load-guide">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The right half when the coach planned the load as a % (planned-load.ts): what
 * the % is of, and the weight it means today as the same quiet chip as Suggested
 * (one tap logs the open sets at it; the boxes stay empty until then), or what it
 * waits on ("After your top set"). The ⓘ says how it's worked out and that the
 * RPE is its cap.
 */
export function PlannedLoadCell({ view, onApply = null }: {
  view: PlannedLoadView;
  /** Logs the open sets at the weight; null when there's nothing to log. */
  onApply?: ((load: number) => Promise<number>) | null;
}) {
  const why = (
    <div className="space-y-1.5 text-foreground" data-testid="load-planned-why">
      {view.why.map((line) => <p key={line}>{line}</p>)}
    </div>
  );
  if (onApply && view.load != null && view.value) {
    return (
      <div className={REF_CELL} data-testid="load-planned">
        <span className={cn(REF_LABEL, "justify-between")}>
          <span className="line-clamp-2 min-w-0 break-words" data-load-planned-label>{view.label}</span>
          <InfoButton label="How this weight is worked out" testId="load-planned-info">{why}</InfoButton>
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" data-capped={view.capped ? "" : undefined}>
          <FillChip
            load={view.load}
            unit={view.unit}
            shown={fmtNum(view.load)}
            ariaLabel={`${view.label}: ${view.value}. Log your open sets at ${view.value}`}
            onApply={onApply}
          />
        </span>
      </div>
    );
  }
  return (
    <SuggestionPopover
      label={`${view.label}: ${view.value ?? view.waiting ?? "loading"}. How it's worked out`}
      testId="load-planned"
      cell={
        <>
          <span className={REF_LABEL}>
            <span className="line-clamp-2 min-w-0 break-words" data-load-planned-label>{view.label}</span>
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </span>
          {view.value ? (
            <span className={REF_VALUE} data-testid="load-planned-value" data-capped={view.capped ? "" : undefined}>{view.value}</span>
          ) : view.waiting ? (
            <span className="text-[13px] leading-snug text-muted-foreground" data-load-planned-waiting>{view.waiting}</span>
          ) : (
            <span className="jf-skeleton block h-4 w-16 rounded bg-muted" aria-hidden="true" />
          )}
        </>
      }
    >
      {why}
    </SuggestionPopover>
  );
}

/** The right half as a button that opens what's behind the number. */
function SuggestionPopover({ cell, label, testId, picks = false, children }: {
  cell: ReactNode;
  label: string;
  testId: string;
  picks?: boolean;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          data-picks={picks ? "" : undefined}
          className={cn(REF_CELL, REF_TAP)}
        >
          {cell}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 text-xs leading-relaxed" data-testid="load-guide">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function TurnOff() {
  const [, setShow] = useShowLoadSuggestions();
  return (
    <button
      type="button"
      onClick={() => setShow(false)}
      data-testid="load-suggestions-off"
      className="mt-2 h-10 w-full rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted"
    >
      Turn off suggestions
    </button>
  );
}

/** Everything the suggestion says about itself, worked out once for the line and the Load guide. */
function suggestionParts({ hint, model, fromName, picks }: {
  hint: LoadSuggestion;
  model: LoadModel;
  fromName: string | null;
  picks: { low: number; high: number } | null;
}) {
  const range = hint.low === hint.high ? null : `${fmtNum(hint.low)}–${fmtNum(hint.high)}`;
  const dayPct = model.dayFactor ? Math.round((model.dayFactor - 1) * 100) : 0;
  const daySigned = `${dayPct > 0 ? "+" : "−"}${Math.abs(dayPct)}%`;
  const why =
    hint.progression
      ? progressionWhy(hint.progression, hint.unit)
      : model.source === "warmup"
      ? "your final warm-up (first time on this lift, so kept conservative)"
      : model.source === "history_warmup"
        ? hint.warmup === "too_easy"
          ? `your recent sessions. Your last warm-up was easy enough that it can't say much about today (${WARMUP_TOO_EASY.toLowerCase()}), so it didn't change the number`
          : hint.warmup === "light"
            ? "your recent sessions. Your heaviest warm-up was too far under today's working weight to say how today feels, so it didn't change the number (log one near it, about 85–90%)"
            : "your recent sessions, nudged by your final warm-up"
        : model.source === "history"
      ? model.early
        ? `your ${model.historySessions === 1 ? "one recent session" : "recent sessions"} of this lift, an early estimate that sharpens every session`
        : dayPct !== 0
        ? `your recent sessions, adjusted ${daySigned} for how today's ${fromName ?? "earlier"} sets moved`
        : model.readiness.reasons.length
        ? `your recent sessions, eased a little for ${model.readiness.reasons[0]}`
        : model.staleDays
          ? `your recent sessions, eased back after ${Math.round(model.staleDays / 7)} weeks off`
          : `your last ${Math.min(model.historySessions, 8)} sessions`
      : model.carried
        ? model.source === "blend"
          ? `today's ${fromName ?? "earlier"} sets, checked against your recent sessions`
          : `today's ${fromName ?? "earlier"} sets (no history of this lift yet)`
        : model.source === "blend"
          ? "the sets you've logged today, checked against your recent sessions"
          : "the sets you've logged today";
  // Says when the number is live: moved by what's been logged today (one reading for the logger and the coach's quick view).
  const badge = suggestionBadge(hint, model);
  const audible = audibleStep(hint.target, hint.unit);
  const shown = picks ? `${fmtNum(picks.low)}–${fmtNum(picks.high)}` : fmtNum(hint.target);
  return { range, badge, audible, why, shown };
}

/** What's behind the number: how live it is, the range, the fast / slow call, how it's worked out, the off switch. */
function SuggestionWhyBody({ hint, why, model, warmupReads, audible, range, picks, rpe, badge, canApply = false }: {
  hint: LoadSuggestion;
  why: string;
  model: LoadModel;
  warmupReads: boolean;
  audible: number;
  range: string | null;
  picks: { low: number; high: number } | null;
  rpe: number;
  badge: { text: string; live: boolean } | null;
  shown?: string;
  canApply?: boolean;
}) {
  return (
    <>
        {/* Two short lines a lifter reads between sets; the working-out is one tap
            further, for whoever wants it. */}
        {badge && (
          <p className="mb-1 inline-flex items-center gap-1.5 font-medium text-muted-foreground" data-testid="load-badge">
            {badge.live && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />}
            {badge.text}
          </p>
        )}
        <p className="text-foreground" data-testid="load-range">
          {hint.progression ? (
            <>{why}</>
          ) : picks ? (
            <>
              Pick within{" "}
              <span className="font-semibold tabular-nums">{fmtNum(picks.low)}–{fmtNum(picks.high)} {hint.unit}</span>{" "}
              by how your warm-ups feel. Aim for RPE {fmtNum(rpe)}.
            </>
          ) : (
            <>Aim for RPE {fmtNum(rpe)}. It's an estimate, so let the first set decide.</>
          )}
        </p>
        <p className="mt-1 text-muted-foreground" data-testid="load-audible">
          Bar flying? +{fmtNum(audible)} {hint.unit} next set. Slow? −{fmtNum(audible)}. Pain? Stop and tell your coach.
        </p>
        <p className="mt-1 text-muted-foreground">
          {canApply && picks
            ? `Tap Suggested (or set 1's number) and your sets log at ${fmtNum(hint.target)} ${hint.unit}, the middle. Warm-ups say lighter or heavier? Type that weight in set 1 instead: the sets below fill in with it. A set that went differently? Change its box.`
            : canApply
              ? `Tap Suggested (or set 1's number) and your sets log at ${fmtNum(hint.target)} ${hint.unit}. A set that went differently? Change its box.`
              : "Type the weight you pick in set 1: the sets below fill in with it and log too. A set that went differently? Change its box."}
        </p>
        <details className="group mt-1.5 border-t border-border pt-1.5" data-testid="load-why">
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            How it's worked out
            <span className="text-muted-foreground transition group-open:rotate-180" aria-hidden="true">⌄</span>
          </summary>
          <p className="mt-1 text-muted-foreground">
            {hint.progression
              ? "Double progression: the same weight until every set reaches the top of the range at the target effort, then the smallest step you load on this exercise."
              : <>From {why}.</>}
            {Math.abs((model.bodyweightScale ?? 1) - 1) >= 0.01 &&
              ` Adjusted ${model.bodyweightScale > 1 ? "up" : "down"} ${Math.abs(Math.round((model.bodyweightScale - 1) * 1000) / 10)}% for your bodyweight change (strength doesn't move one-for-one with bodyweight, so it's about two thirds of the change).`}
            {!picks && range && <> A good day lands anywhere in <span className="tabular-nums">{range} {hint.unit}</span>.</>}
            {(model.backoffsAsTopSet ?? 0) > 0 && (
              <span data-testid="load-backoff-history"> Past back-offs count about {Math.round(BACKOFF_FATIGUE * 100)}% heavier, since they're done after the top set.</span>
            )}
          </p>
          {model.carriedTop && (() => {
            // The math behind a back-off, the way a coach would say it.
            const top = model.carriedTop;
            const step = loadStep(hint.unit, top.load);
            return (
              <p className="mt-1 text-muted-foreground" data-testid="load-backoff-math">
                Top set today:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {fmtNum(roundToStep(top.load, step / 2))} {hint.unit} × {top.reps} @ {fmtNum(top.rpe)}
                </span>{" "}
                (estimated max about {fmtNum(roundToStep(top.e1rm, step))}). Back-offs sit about {Math.round(BACKOFF_FATIGUE * 100)}% under what that
                says, for the fatigue a top set leaves.
              </p>
            );
          })()}
          {warmupReads && (
            <p className="mt-1 text-muted-foreground">
              A warm-up you log with + Warm-up counts too: easier than usual nudges this up, harder nudges it down.
            </p>
          )}
        </details>
        <TurnOff />
    </>
  );
}

/**
 * The on/off switch on every exercise card that can suggest. One switch for
 * the whole workout: turning it on here turns it on for every card. Off by
 * default.
 */
export function LoadSuggestionsChip({ highlight = false, className }: { highlight?: boolean; className?: string }) {
  const [show, setShow] = useShowLoadSuggestions();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={show}
      aria-label="Weight suggestions on every exercise"
      onClick={() => setShow(!show)}
      data-testid="load-suggestions-chip"
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition active:scale-[0.97]",
        show ? "border-border bg-secondary text-foreground" : "border-border bg-background text-foreground",
        highlight && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        className,
      )}
    >
      <Target className="h-3.5 w-3.5" aria-hidden="true" />
      Suggest
      <span aria-hidden="true" className={cn("relative h-3.5 w-6 rounded-full transition-colors", show ? "bg-foreground" : "bg-muted-foreground/35")}>
        <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-background shadow-sm transition-all", show ? "left-3" : "left-0.5")} />
      </span>
    </button>
  );
}

/**
 * "Try it" — the first card that can suggest, until the athlete has turned
 * suggestions on once. "Not now" hides it until the app is next opened.
 */
export function LoadSuggestionsNudge({ onDismiss }: { onDismiss: () => void }) {
  const [, setShow] = useShowLoadSuggestions();
  return (
    <div role="note" data-testid="load-suggestions-nudge" className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-muted/40 py-1.5 pl-2.5 pr-1">
      <Target className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-xs font-bold text-foreground">New: live weight suggestions</div>
        <div className="text-[11px] text-muted-foreground">Updates after every set you log. Turn off anytime.</div>
      </div>
      <button type="button" onClick={() => setShow(true)} className="h-9 shrink-0 rounded-full border border-border bg-background px-3.5 text-xs font-semibold text-foreground active:scale-[0.97]">
        Try it
      </button>
      <button type="button" onClick={onDismiss} aria-label="Not now" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * One line on why next time's number is what it is: the change from today's
 * weight and how the sets felt against the plan ("+5 lb · felt easier than
 * planned (RPE 4 vs 5)"), so a re-rated set visibly moves it the honest way.
 */
export function nextTimeWhy(
  next: LoadSuggestion,
  today: { load: number; rpe: number | null },
  plan: { reps: number; rpe: number } | null,
): string {
  const step = next.unit === "kg" ? 1 : 2.5;
  const diff = next.target - today.load;
  const change = Math.abs(diff) < step / 2
    ? "Same weight"
    : `${diff > 0 ? "+" : "−"}${fmtNum(Math.round(Math.abs(diff) * 2) / 2)} ${next.unit}`;
  if (today.rpe == null || !plan) return change;
  const felt = Math.round(today.rpe * 2) / 2;
  const gap = plan.rpe - today.rpe;
  const feel = Math.abs(gap) < 0.5
    ? `right on RPE ${fmtNum(plan.rpe)}`
    : `felt ${Math.abs(gap) < 1 ? "a bit " : ""}${gap > 0 ? "easier" : "harder"} than planned (RPE ${fmtNum(felt)} vs ${fmtNum(plan.rpe)})`;
  return `${change} · ${feel}`;
}

/**
 * Every set on the card is logged: no stale "next set" range. The right half
 * says what to start with next time (its label "Next time"), and the line
 * under the row says it's done and how today ran vs the athlete's usual
 * (LoadSuggestionsDoneNote): never a blank half while Suggest is on (a
 * finished 20-rep calf raise used to show nothing at all).
 */
export function LoadSuggestionsDone({
  next = null,
  plan = null,
}: {
  own?: number | null;
  /** Today's sets → the load for the plan next session. */
  next?: LoadSuggestion | null;
  plan?: { reps: number; rpe: number } | null;
  today?: { load: number; rpe: number | null } | null;
}) {
  if (!next) return null;
  return (
    <div className={REF_CELL} data-testid="load-next-time">
      <span className={REF_LABEL}>Next time</span>
      <span className={REF_VALUE}>
        {fmtNum(next.target)} {next.unit}
        {plan && <span className="font-normal text-muted-foreground"> × {plan.reps} @ {fmtNum(plan.rpe)}</span>}
      </span>
    </div>
  );
}

/** Under the reference row once every set is in: "✓ All sets in · ran 3% above your usual · Same weight · right on RPE 8". */
export function LoadSuggestionsDoneNote({
  own,
  next = null,
  plan = null,
  today = null,
}: {
  own: number | null;
  next?: LoadSuggestion | null;
  plan?: { reps: number; rpe: number } | null;
  today?: { load: number; rpe: number | null } | null;
}) {
  const why = next && today ? nextTimeWhy(next, today, plan) : null;
  const pct = own != null && Number.isFinite(own) ? Math.round((own - 1) * 100) : null;
  const read = pct == null ? null : Math.abs(own! - 1) < 0.015 ? "right on your usual" : `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"} your usual`;
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground" data-testid="load-suggestion-done">
      <Check className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
      <span>
        All sets in
        {read && <> · ran <span className="font-medium text-foreground">{read}</span></>}
        {why && <span data-testid="load-next-why"> · {why}</span>}
      </span>
    </p>
  );
}
