import { Check, Info, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShowLoadSuggestions } from "@/lib/load-suggestion-visibility";
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
  fromName = null,
}: {
  hint: LoadSuggestion | null;
  model: LoadModel;
  plan: { reps: number; rpe: number };
  /** Last-warm-up tip — offered only before the first working set (the set table holds the warm-up row). */
  warmup?: WarmupGauge | null;
  /** The card today's adjustment comes from (model.dayFactor), e.g. "Competition Squat". */
  fromName?: string | null;
}) {
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
        <Target className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
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
        ? `your ${model.historySessions === 1 ? "one recent session" : "recent sessions"} of this lift — an early estimate that sharpens every session`
        : dayPct !== 0
        ? `your recent sessions, adjusted ${daySigned} for how today's ${fromName ?? "earlier"} sets moved`
        : model.readiness.reasons.length
        ? `your recent sessions, eased a little for ${model.readiness.reasons[0]}`
        : model.staleDays
          ? `your recent sessions, eased back after ${Math.round(model.staleDays / 7)} weeks off`
          : `your last ${Math.min(model.historySessions, 8)} sessions`
      : model.carried
        ? "your earlier sets of this lift today (no history of this card yet)"
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
  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-primary/25 bg-primary/5" data-testid="load-suggestion">
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-black tabular-nums text-foreground" data-testid="load-target">{fmtNum(hint.target)} {hint.unit}</span>
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {plan.reps} @ RPE {fmtNum(plan.rpe)}
          </span>
          {badge && (
            <span
              data-testid="load-badge"
              className={cn(
                "ml-auto shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold",
                badge.live ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
              )}
            >
              {badge.live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" aria-hidden="true" />}
              {badge.text}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] tabular-nums text-muted-foreground" data-testid="load-audible">
          {range && <>{range}<span aria-hidden="true"> · </span></>}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">▲ Fast +{fmtNum(audible)}</span>
          <span aria-hidden="true"> · </span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">▼ Slow −{fmtNum(audible)}</span>
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
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition active:scale-[0.97]",
        show ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background text-foreground",
        highlight && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        className,
      )}
    >
      <Target className="h-3.5 w-3.5" aria-hidden="true" />
      Suggest
      <span aria-hidden="true" className={cn("relative h-3.5 w-6 rounded-full transition-colors", show ? "bg-primary" : "bg-muted-foreground/35")}>
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
    <div role="note" data-testid="load-suggestions-nudge" className="mt-1.5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 py-1.5 pl-2.5 pr-1">
      <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-xs font-bold text-foreground">New: live weight suggestions</div>
        <div className="text-[11px] text-muted-foreground">Updates after every set you log. Turn off anytime.</div>
      </div>
      <button type="button" onClick={() => setShow(true)} className="h-8 shrink-0 rounded-full bg-primary px-3.5 text-xs font-bold text-primary-foreground active:scale-[0.97]">
        Try it
      </button>
      <button type="button" onClick={onDismiss} aria-label="Not now" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10">
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
            Next time: <span className="text-sm font-black tabular-nums text-foreground">{fmtNum(next.target)} {next.unit}</span>
            {plan && <> for {plan.reps} @ RPE {fmtNum(plan.rpe)}</>}
          </span>
        )}
        {why && <span className="block" data-testid="load-next-why">{why}</span>}
      </span>
    </div>
  );
}
