import { useReducer, useState, type ReactNode } from "react";
import { Calculator, Delete, Gauge, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { bestE1rm, ReplaceInput } from "@/components/workout-day/final-warmup-input";
import { E1RM_MIN_RPE, estimateOneRepMax, repsLeftLabel, type WarmupUnit } from "@/lib/final-warmup";
import { validateSetField } from "@/lib/set-input-cascade";
import { CALC_START, calcReducer, type CalcKey, type CalcOp } from "@/lib/calculator";

/**
 * Exercise-card tools in the chip row: e1RM and a plain calculator. Each opens
 * as a panel right under the chips, full card width (no floating popover to
 * misalign or clip), one at a time, and nothing grabs focus on open, so the
 * keyboard only comes up when a box is tapped.
 */
export type CardTool = "e1rm" | "calc";

const chip =
  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold tabular-nums transition active:scale-[0.97]";
const chipState = (open: boolean) =>
  open ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background text-foreground";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** "e1RM ≈415" — today's best rough 1RM; tap to open the e1RM panel. */
export function E1rmChip({
  sets,
  unit,
  open,
  onToggle,
}: {
  /** Today's logged sets (working and warm-up), in `unit`. */
  sets: Array<{ load: number; reps: number; rpe: number | null }>;
  unit: WarmupUnit;
  open: boolean;
  onToggle: () => void;
}) {
  const best = bestE1rm(sets, unit);
  return (
    <button
      type="button"
      data-testid="e1rm-chip"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(chip, chipState(open))}
      aria-label={best ? `Estimated 1RM about ${fmt(best.e1rm)} ${unit}` : "e1RM calculator"}
    >
      <Gauge className={cn("h-3.5 w-3.5", open ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      {best ? <>e1RM <span className="font-black">≈{fmt(best.e1rm)}</span></> : "e1RM"}
    </button>
  );
}

function ToolPanel({ icon, title, onClose, children, testId }: {
  icon: ReactNode; title: string; onClose: () => void; children: ReactNode; testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mt-1.5 overflow-hidden rounded-xl border border-border bg-muted/30 p-2.5 duration-200 animate-in fade-in-0 slide-in-from-top-1"
    >
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-bold">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="-my-1 -mr-1 ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * Rough 1RM from weight × reps @ RPE, prefilled with today's best set so it
 * opens on the same number as the chip. Typed like the set cells (tap, type,
 * a blank keeps the old value); any RPE from 6 to 10, halves included.
 */
export function E1rmPanel({
  sets,
  unit,
  onClose,
}: {
  sets: Array<{ load: number; reps: number; rpe: number | null }>;
  unit: WarmupUnit;
  onClose: () => void;
}) {
  const best = bestE1rm(sets, unit);
  const [load, setLoad] = useState(best ? fmt(best.from.load) : "");
  const [reps, setReps] = useState(best ? String(best.from.reps) : "");
  const [rpe, setRpe] = useState(best?.from.rpe != null ? fmt(best.from.rpe) : "");
  const rpeCheck = validateSetField("rpe", rpe);
  const rpeNum = rpeCheck.ok && rpeCheck.value !== "" ? Number(rpeCheck.value) : null;
  const l = Number(load.replace(",", "."));
  const r = Number(reps);
  const max = l > 0 && Number.isInteger(r) && r >= 1 ? estimateOneRepMax({ load: l, reps: r, rpe: rpeNum }, unit) : null;
  const other = max != null ? (unit === "kg" ? Math.round(max * 2.2046226218) : Math.round((max / 2.2046226218) * 2) / 2) : null;
  const hint = !rpeCheck.ok
    ? rpeCheck.error
    : rpeNum != null
      ? `RPE ${fmt(rpeNum)} · ${repsLeftLabel(rpeNum)}`
      : "RPE = reps left in the tank (10 = none)";
  const empty =
    !(l > 0) || !(r >= 1) ? "enter weight × reps"
      : r > 10 ? "10 reps or fewer"
      : rpeNum == null ? "add an RPE"
      : rpeNum < E1RM_MIN_RPE ? `needs RPE ${E1RM_MIN_RPE}+`
      : "—";
  const cell =
    "h-11 w-full rounded-lg border border-input bg-background px-1 text-center text-lg font-bold tabular-nums text-foreground placeholder:text-muted-foreground/40";
  const label = "mb-1 block text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  return (
    <ToolPanel testId="e1rm-panel" icon={<Gauge className="h-4 w-4 text-primary" aria-hidden="true" />} title="e1RM" onClose={onClose}>
      <form
        className="grid grid-cols-[1.3fr_auto_1fr_auto_1fr] items-end gap-1.5"
        onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}
      >
        <label className="min-w-0">
          <span className={label}>Wt ({unit})</span>
          <ReplaceInput value={load} onValue={setLoad} clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 6)}
            inputMode="decimal" enterKeyHint="next" className={cell} aria-label={`Weight in ${unit}`} />
        </label>
        <span className="pb-3 text-sm font-bold text-muted-foreground" aria-hidden>×</span>
        <label className="min-w-0">
          <span className={label}>Reps</span>
          <ReplaceInput value={reps} onValue={setReps} clean={(v) => v.replace(/[^0-9]/g, "").slice(0, 2)}
            inputMode="numeric" enterKeyHint="next" className={cell} aria-label="Reps" />
        </label>
        <span className="pb-3 text-sm font-bold text-muted-foreground" aria-hidden>@</span>
        <label className="min-w-0">
          <span className={label}>RPE</span>
          <ReplaceInput value={rpe} onValue={setRpe} clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 4)}
            inputMode="decimal" enterKeyHint="done" className={cn(cell, !rpeCheck.ok && "border-destructive")}
            aria-label="RPE" aria-invalid={!rpeCheck.ok} />
        </label>
      </form>
      <p className={cn("mt-1.5 text-[11px] leading-snug", rpeCheck.ok ? "text-muted-foreground" : "font-semibold text-destructive")}>{hint}</p>
      <div className="mt-2 flex items-baseline justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2" aria-live="polite">
        <span className="text-xs text-muted-foreground">Rough 1RM</span>
        {max != null ? (
          <span className="text-right">
            <span className="text-xl font-black tabular-nums text-foreground" data-testid="e1rm-result">≈ {fmt(max)} {unit}</span>
            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{fmt(other!)} {unit === "kg" ? "lb" : "kg"}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground" data-testid="e1rm-result">{empty}</span>
        )}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        {best ? "Opens on today's best set. " : ""}A guide from weight × reps @ RPE, not a tested max. Nothing is saved.
      </p>
    </ToolPanel>
  );
}


/**
 * A plain calculator with its own keypad (no phone keyboard), plus percent
 * and a one-tap conversion to the other unit — plate math, % of a max, kg for
 * a meet.
 */
export function CalculatorPanel({ unit, onClose }: { unit: WarmupUnit; onClose: () => void }) {
  const [s, press] = useReducer(calcReducer, CALC_START);
  const key = (k: CalcKey) => () => press(k);
  const base = "h-11 rounded-lg text-lg font-bold tabular-nums transition active:scale-[0.96]";
  const digit = cn(base, "border border-border bg-background text-foreground");
  const fn = cn(base, "bg-muted text-foreground");
  const op = (o: CalcOp) => cn(base, s.op === o && s.fresh ? "bg-primary/20 text-primary" : "bg-muted text-primary");
  const other = unit === "kg" ? "lb" : "kg";
  return (
    <ToolPanel testId="calc-panel" icon={<Calculator className="h-4 w-4 text-primary" aria-hidden="true" />} title="Calculator" onClose={onClose}>
      <div className="mb-2 rounded-lg border border-border bg-background px-3 py-1.5 text-right" aria-live="polite">
        <div className="h-4 truncate text-[11px] tabular-nums text-muted-foreground" data-testid="calc-note">{s.note}</div>
        <div className="truncate text-3xl font-black tabular-nums text-foreground" data-testid="calc-display">{s.display}</div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" className={fn} onClick={key({ type: "clear" })}>C</button>
        <button type="button" className={fn} onClick={key({ type: "back" })} aria-label="Delete"><Delete className="mx-auto h-5 w-5" /></button>
        <button type="button" className={fn} onClick={key({ type: "percent" })}>%</button>
        <button type="button" className={op("÷")} onClick={key({ type: "op", op: "÷" })}>÷</button>
        {["7", "8", "9"].map((d) => <button key={d} type="button" className={digit} onClick={key({ type: "digit", digit: d })}>{d}</button>)}
        <button type="button" className={op("×")} onClick={key({ type: "op", op: "×" })}>×</button>
        {["4", "5", "6"].map((d) => <button key={d} type="button" className={digit} onClick={key({ type: "digit", digit: d })}>{d}</button>)}
        <button type="button" className={op("−")} onClick={key({ type: "op", op: "−" })}>−</button>
        {["1", "2", "3"].map((d) => <button key={d} type="button" className={digit} onClick={key({ type: "digit", digit: d })}>{d}</button>)}
        <button type="button" className={op("+")} onClick={key({ type: "op", op: "+" })}>+</button>
        <button type="button" className={cn(fn, "text-xs")} onClick={key({ type: "convert", from: unit })} aria-label={`Convert ${unit} to ${other}`}>
          {unit}→{other}
        </button>
        <button type="button" className={digit} onClick={key({ type: "digit", digit: "0" })}>0</button>
        <button type="button" className={digit} onClick={key({ type: "dot" })}>.</button>
        <button type="button" className={cn(base, "bg-primary text-primary-foreground")} onClick={key({ type: "equals" })}>=</button>
      </div>
    </ToolPanel>
  );
}

