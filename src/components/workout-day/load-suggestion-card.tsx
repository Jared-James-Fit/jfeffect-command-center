import { useState } from "react";
import { Check, Info, Target, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShowLoadSuggestions } from "@/lib/load-suggestion-visibility";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { audibleStep, BACKOFF_FATIGUE, loadStep, roundToStep, type LoadModel, type LoadSuggestion } from "@/lib/load-suggestion";

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * The load suggestion on an exercise card: one quiet line ("Suggested 190 kg ×
 * 4 @ 7") under "Last time", and an ⓘ holding the range, the "audible" (moving
 * fast → add, grinding → drop), the why, "just a suggestion" and the off
 * switch, so the card stays one glance.
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
  fromName = null,
  picks = null,
  onApply = null,
}: {
  hint: LoadSuggestion | null;
  model: LoadModel;
  plan: { reps: number; rpe: number };
  /** Last-warm-up tip — offered only before the first working set (the set table holds the warm-up row). */
  warmup?: WarmupGauge | null;
  /** The card today's adjustment comes from (model.dayFactor), e.g. "Competition Squat". */
  fromName?: string | null;
  /** A weight to choose from instead of one number (suggestionPicks): the first set of a main lift, by feel. */
  picks?: { low: number; high: number; loads: number[] } | null;
  /** Puts a weight in every open set as a draft (never logs one); resolves to how many it filled. Null: nothing to fill. */
  onApply?: ((load: number) => Promise<number>) | null;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (model.status === "calibrating" || !hint) {
    // Suggest is on but there's no number yet: say why and what unlocks one
    // (a blank card read as broken). The warm-up row, when offered, is the
    // fastest way to a first number, so point at it rather than repeat it.
    const why = model.historySessions === 0 ? "No logs of this lift yet" : "No recent logs of this lift with an RPE";
    const next = warmup
      ? "log your last warm-up below and it sets today's weight."
      : "log your first set with an RPE and the rest get a live suggestion.";
    return (
      <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="load-suggestion-pending">
        <Target className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span><span className="font-semibold text-foreground">{why}</span> · {next}</span>
      </div>
    );
  }
  const range = hint.low === hint.high ? null : `${fmtNum(hint.low)}–${fmtNum(hint.high)}`;
  const dayPct = model.dayFactor ? Math.round((model.dayFactor - 1) * 100) : 0;
  const daySigned = `${dayPct > 0 ? "+" : "−"}${Math.abs(dayPct)}%`;
  const why =
    model.source === "warmup"
      ? "your final warm-up (first time on this lift, so kept conservative)"
      : model.source === "history_warmup"
        ? "your recent sessions, nudged by your final warm-up"
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
  const audible = audibleStep(hint.target, hint.unit);
  // The badge says when the number is live — moved by what's been logged today.
  const badge: { text: string; live: boolean } | null =
    model.source === "warmup" ? { text: "From warm-up", live: false }
      : model.source === "history_warmup" ? { text: "Warm-up tuned", live: false }
      : model.source === "today" || model.source === "blend" ? { text: "Live", live: true }
      : model.early ? { text: "Early estimate", live: false }
      : dayPct !== 0 ? { text: `Live ${daySigned}`, live: true }
      : null;
  // A tap puts the weight in the open sets (as drafts: nothing is logged until
  // the set's number is tapped). A range opens its loads first, one tap each.
  const apply = async (load: number) => {
    if (!onApply || busy) return;
    setBusy(true);
    try {
      const n = await onApply(load);
      setChoosing(false);
      if (n > 0) toast.success(`${fmtNum(load)} ${hint.unit} in ${n} set${n === 1 ? "" : "s"}. Tap each set's number as you finish it`);
    } catch {
      toast.error("Couldn't fill your sets. Try again");
    } finally {
      setBusy(false);
    }
  };
  const shown = picks ? `${fmtNum(picks.low)}–${fmtNum(picks.high)}` : fmtNum(hint.target);
  const body = (
    <>
      <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs">
        <span className="shrink-0 text-muted-foreground">Suggested</span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground" data-testid="load-target">{shown} {hint.unit}</span>
        <span className="min-w-0 truncate tabular-nums text-muted-foreground">× {plan.reps} @ {fmtNum(plan.rpe)}</span>
      </span>
    </>
  );
  return (
    // One quiet line under "Last time": the number (or the weights to pick from
    // on a first heavy set) and what it's for. The why, the fast / slow call and
    // the off switch live behind ⓘ, so the card stays about the sets.
    <div className="mt-1.5 rounded-lg border border-border bg-muted/40" data-testid="load-suggestion" data-picks={picks ? "" : undefined}>
    <div className="flex min-h-9 items-center gap-2 py-0.5 pl-2.5 pr-0.5">
      {onApply ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => (picks ? setChoosing((v) => !v) : void apply(hint.target))}
          aria-expanded={picks ? choosing : undefined}
          aria-label={picks ? `Suggested ${shown} ${hint.unit}. Choose a weight for your sets` : `Suggested ${shown} ${hint.unit}. Put it in your sets`}
          data-testid="load-apply"
          className="-my-0.5 -ml-1 flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md pl-1 text-left active:bg-foreground/5 disabled:opacity-60"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>
      )}
      {badge && (
        <span
          data-testid="load-badge"
          className="shrink-0 rounded-full bg-background px-1.5 py-px text-[10px] font-semibold text-muted-foreground"
        >
          {badge.live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" aria-hidden="true" />}
          {badge.text}
        </span>
      )}
      <SuggestionWhy hint={hint} why={why} model={model} warmup={warmup} audible={audible} range={range} picks={picks} rpe={plan.rpe} canApply={!!onApply} />
    </div>
    {picks && choosing && onApply && (
      <div className="flex gap-1.5 border-t border-border px-2 py-1.5" role="group" aria-label="Weights to choose from" data-testid="load-picks">
        {picks.loads.map((l) => (
          <button
            key={l}
            type="button"
            disabled={busy}
            onClick={() => void apply(l)}
            data-testid="load-pick"
            className={cn(
              "h-9 min-w-0 flex-1 rounded-md text-sm font-semibold tabular-nums transition active:scale-[0.97] disabled:opacity-60",
              l === hint.target ? "bg-foreground text-background" : "bg-background text-foreground",
            )}
          >
            {fmtNum(l)}
          </button>
        ))}
      </div>
    )}
    </div>
  );
}

/** ⓘ on the suggestion line: the range, the fast / slow call, the why, and the off switch. */
function SuggestionWhy({ hint, why, model, warmup, audible, range, picks, rpe, canApply }: {
  hint: LoadSuggestion;
  why: string;
  model: LoadModel;
  warmup: WarmupGauge | null;
  audible: number;
  range: string | null;
  picks: { low: number; high: number } | null;
  rpe: number;
  canApply: boolean;
}) {
  const [, setShow] = useShowLoadSuggestions();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="How this suggestion works" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 text-xs leading-relaxed">
        {/* Two short lines a lifter reads between sets; the working-out is one tap
            further, for whoever wants it. */}
        <p className="text-foreground" data-testid="load-range">
          {picks ? (
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
        {canApply && <p className="mt-1 text-muted-foreground">Tap the weight to put it in your sets. Nothing is logged until you tap a set's number.</p>}
        <details className="group mt-1.5 border-t border-border pt-1.5" data-testid="load-why">
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            How it's worked out
            <span className="text-muted-foreground transition group-open:rotate-180" aria-hidden="true">⌄</span>
          </summary>
          <p className="mt-1 text-muted-foreground">
            From {why}.
            {Math.abs((model.bodyweightScale ?? 1) - 1) >= 0.01 &&
              ` Adjusted ${model.bodyweightScale > 1 ? "up" : "down"} ${Math.abs(Math.round((model.bodyweightScale - 1) * 1000) / 10)}% for your bodyweight change (strength doesn't move one-for-one with bodyweight, so it's about two thirds of the change).`}
            {!picks && range && <> A good day lands anywhere in <span className="tabular-nums">{range} {hint.unit}</span>.</>}
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
          {warmup && (
            <p className="mt-1 text-muted-foreground">
              {warmup.suggested
                ? `Work up to about ${fmtNum(warmup.suggested.load)} ${hint.unit} × ${warmup.suggested.reps} and log how it felt: `
                : "Log your heaviest warm-up and how it felt: "}
              easier than usual nudges this up, harder nudges it down.
            </p>
          )}
        </details>
        <button
          type="button"
          onClick={() => setShow(false)}
          data-testid="load-suggestions-off"
          className="mt-2 w-full rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-muted"
        >
          Turn off suggestions
        </button>
      </PopoverContent>
    </Popover>
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
 * Every set on the card is logged: no stale "next set" range. Says it's done,
 * how today ran vs the athlete's usual (when that can be read), and what to
 * start with next time from today's sets — never a blank card while Suggest
 * is on (a finished 20-rep calf raise used to show nothing at all).
 */
export function LoadSuggestionsDone({
  own,
  next = null,
  plan = null,
  today = null,
}: {
  own: number | null;
  /** Today's sets → the load for the plan next session. */
  next?: LoadSuggestion | null;
  plan?: { reps: number; rpe: number } | null;
  /** Today's last working weight (display unit) and average RPE, for the "why". */
  today?: { load: number; rpe: number | null } | null;
}) {
  const why = next && today ? nextTimeWhy(next, today, plan) : null;
  const pct = own != null && Number.isFinite(own) ? Math.round((own - 1) * 100) : null;
  const read = pct == null ? null : Math.abs(own! - 1) < 0.015 ? "right on your usual" : `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"} your usual`;
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="load-suggestion-done">
      <Check className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
      <span>
        All sets in
        {read && <> · today ran <span className="font-semibold text-foreground">{read}</span></>}
        {next && (
          <span className="block" data-testid="load-next-time">
            Next time: <span className="text-sm font-bold tabular-nums text-foreground">{fmtNum(next.target)} {next.unit}</span>
            {plan && <> for {plan.reps} @ RPE {fmtNum(plan.rpe)}</>}
          </span>
        )}
        {why && <span className="block" data-testid="load-next-why">{why}</span>}
      </span>
    </div>
  );
}
