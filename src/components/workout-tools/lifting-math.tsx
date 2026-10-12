import { useState } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReplaceInput } from "@/components/workout-day/final-warmup-input";
import { E1RM_MIN_RPE, estimateOneRepMax, repsLeftLabel, type WarmupUnit } from "@/lib/final-warmup";
import { validateSetField } from "@/lib/set-input-cascade";
import type { CalcKey, CalcOp, CalcState } from "@/lib/calculator";

/**
 * The Workout Tools' lifting math: a plain calculator and a rough 1RM. Both
 * are scratchpads — nothing here is saved to the log.
 */

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const KG_TO_LB = 2.2046226218;

/** Today's best set of one lift, offered as a one-tap fill in the e1RM tool. */
export type E1rmPick = {
  rowId: string;
  name: string;
  /** Exercise position in the workout (picks show in workout order). */
  order: number;
  unit: WarmupUnit;
  e1rm: number;
  from: { load: number; reps: number; rpe: number | null };
};

/**
 * A calculator with its own keypad (no phone keyboard), percent and a one-tap
 * conversion to the other unit: plate math, % of a max, kg for a meet. State
 * lives with the caller so a sum survives closing the sheet.
 */
export function CalculatorTool({ unit, state: s, press }: { unit: WarmupUnit; state: CalcState; press: (k: CalcKey) => void }) {
  const key = (k: CalcKey) => () => press(k);
  const base = "h-12 rounded-xl text-lg font-bold tabular-nums transition active:scale-[0.96]";
  const digit = cn(base, "border border-border bg-background text-foreground");
  const fn = cn(base, "bg-muted text-foreground");
  const op = (o: CalcOp) => cn(base, s.op === o && s.fresh ? "bg-primary/20 text-primary" : "bg-muted text-primary");
  const other = unit === "kg" ? "lb" : "kg";
  return (
    <div data-testid="calc-tool">
      <div className="mb-2 rounded-xl border border-border bg-background px-3 py-1.5 text-right" aria-live="polite">
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
    </div>
  );
}

/**
 * Rough 1RM from weight × reps @ RPE. Opens on today's first logged lift (the
 * chips above fill any other one in a tap); typed like the set cells (tap,
 * type, a blank keeps the old value); any RPE from 6 to 10, halves included.
 */
export function E1rmTool({ picks, defaultUnit }: { picks: E1rmPick[]; defaultUnit: WarmupUnit }) {
  const first = picks[0] ?? null;
  const [picked, setPicked] = useState<string | null>(first?.rowId ?? null);
  const [unit, setUnit] = useState<WarmupUnit>(first?.unit ?? defaultUnit);
  const [load, setLoad] = useState(first ? fmt(first.from.load) : "");
  const [reps, setReps] = useState(first ? String(first.from.reps) : "");
  const [rpe, setRpe] = useState(first?.from.rpe != null ? fmt(first.from.rpe) : "");
  const fillFrom = (p: E1rmPick) => {
    setPicked(p.rowId);
    setUnit(p.unit);
    setLoad(fmt(p.from.load));
    setReps(String(p.from.reps));
    setRpe(p.from.rpe != null ? fmt(p.from.rpe) : "");
  };
  const typed = <T,>(set: (v: T) => void) => (v: T) => { setPicked(null); set(v); };
  const rpeCheck = validateSetField("rpe", rpe);
  const rpeNum = rpeCheck.ok && rpeCheck.value !== "" ? Number(rpeCheck.value) : null;
  const l = Number(load.replace(",", "."));
  const r = Number(reps);
  const max = l > 0 && Number.isInteger(r) && r >= 1 ? estimateOneRepMax({ load: l, reps: r, rpe: rpeNum }, unit) : null;
  const other = max != null ? (unit === "kg" ? Math.round(max * KG_TO_LB) : Math.round((max / KG_TO_LB) * 2) / 2) : null;
  const hint = !rpeCheck.ok
    ? rpeCheck.error
    : rpeNum != null
      ? `RPE ${fmt(rpeNum)} · ${repsLeftLabel(rpeNum)}`
      : "RPE = how many reps were left in the tank (10 = none)";
  const empty =
    !(l > 0) || !(r >= 1) ? "Enter weight × reps"
      : r > 10 ? "10 reps or fewer"
      : rpeNum == null ? "Add an RPE"
      : rpeNum < E1RM_MIN_RPE ? `Needs RPE ${E1RM_MIN_RPE}+`
      : "—";
  const cell =
    "h-12 w-full rounded-xl border border-input bg-background px-1 text-center text-lg font-bold tabular-nums text-foreground placeholder:text-muted-foreground/40";
  const label = "mb-1 block text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  return (
    <div data-testid="e1rm-tool">
      {picks.length > 0 && (
        <div className="mb-2.5">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Today's best sets</div>
          <div className="flex flex-wrap gap-1.5">
            {picks.map((p) => (
              <button
                key={p.rowId}
                type="button"
                data-testid="e1rm-pick"
                aria-pressed={picked === p.rowId}
                onClick={() => fillFrom(p)}
                className={cn(
                  "inline-flex h-8 max-w-full items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition active:scale-[0.97]",
                  picked === p.rowId ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background text-foreground",
                )}
              >
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 font-black tabular-nums">{fmt(p.e1rm)} {p.unit}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        className="grid grid-cols-[1.3fr_auto_1fr_auto_1fr] items-end gap-1.5"
        onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}
      >
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-center gap-0.5" role="group" aria-label="Weight unit">
            {(["lb", "kg"] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => { setPicked(null); setUnit(u); }}
                className={cn(
                  "rounded px-1.5 text-[10px] font-bold uppercase tracking-wider",
                  unit === u ? "bg-foreground text-background" : "text-muted-foreground",
                )}
              >
                {u}
              </button>
            ))}
          </div>
          <ReplaceInput value={load} onValue={typed(setLoad)} clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 6)}
            inputMode="decimal" enterKeyHint="next" className={cell} aria-label={`Weight in ${unit}`} />
        </div>
        <span className="pb-3.5 text-sm font-bold text-muted-foreground" aria-hidden>×</span>
        <label className="min-w-0">
          <span className={label}>Reps</span>
          <ReplaceInput value={reps} onValue={typed(setReps)} clean={(v) => v.replace(/[^0-9]/g, "").slice(0, 2)}
            inputMode="numeric" enterKeyHint="next" className={cell} aria-label="Reps" />
        </label>
        <span className="pb-3.5 text-sm font-bold text-muted-foreground" aria-hidden>@</span>
        <label className="min-w-0">
          <span className={label}>RPE</span>
          <ReplaceInput value={rpe} onValue={typed(setRpe)} clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 4)}
            inputMode="decimal" enterKeyHint="done" className={cn(cell, !rpeCheck.ok && "border-destructive")}
            aria-label="RPE" aria-invalid={!rpeCheck.ok} />
        </label>
      </form>
      <p className={cn("mt-1.5 text-[11px] leading-snug", rpeCheck.ok ? "text-muted-foreground" : "font-semibold text-destructive")}>{hint}</p>
      <div className="mt-2 flex items-baseline justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5" aria-live="polite">
        <span className="text-xs text-muted-foreground">Rough 1RM</span>
        {max != null ? (
          <span className="text-right">
            <span className="text-2xl font-black tabular-nums text-foreground" data-testid="e1rm-result">≈ {fmt(max)} {unit}</span>
            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{fmt(other!)} {unit === "kg" ? "lb" : "kg"}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground" data-testid="e1rm-result">{empty}</span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        A guide from one set, not a tested max. Most accurate from a heavy set of 1–5 reps at RPE 8–10.
      </p>
    </div>
  );
}
