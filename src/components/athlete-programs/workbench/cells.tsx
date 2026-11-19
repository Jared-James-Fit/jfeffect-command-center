import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import type { PlanExercise } from "@/lib/program-plan";
import {
  CELL_INPUT_MODE,
  CELL_LABEL,
  LOAD_MODE_LABEL,
  cellInvalid,
  cellPatch,
  cellText,
  loadModeOf,
  type CellField,
  type LoadMode,
} from "@/lib/program-cells";
import { REPS_QUICK, REST_CHOICES, RIR_QUICK, RPE_QUICK, SETS_QUICK } from "@/lib/athlete-program-draft";

/**
 * The cell being typed in, so the bar over the keyboard can put a quick value
 * into it (and the load cell can change what its number means).
 */
export type ActiveCell = {
  exKey: string;
  field: CellField;
  exercise: PlanExercise;
  /** Puts `text` in the cell as if it were typed. */
  type: (text: string) => void;
  /** Applies a patch straight to the exercise (a scale or a load mode). */
  patch: (p: Partial<PlanExercise>) => void;
  mode: LoadMode;
  setMode: (m: LoadMode) => void;
};

type CellsCtx = {
  active: ActiveCell | null;
  setActive: (a: ActiveCell | null) => void;
  /** The weight unit a new load starts in (the last one used). */
  unit: "lb" | "kg";
  setUnit: (u: "lb" | "kg") => void;
};
const Ctx = createContext<CellsCtx | null>(null);
export const CellsProvider = Ctx.Provider;
export function useCells(): CellsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("cells outside the builder");
  return c;
}

/**
 * One number of an exercise, typed straight in (no sheet): what's typed goes
 * into the program as it's typed, a value the cell can't read yet stays on
 * screen until it can, and leaving the cell shows what's saved. A dot marks a
 * value that changed from the week before.
 */
export function Cell({
  e,
  field,
  onPatch,
  changed,
  className,
  label,
}: {
  e: PlanExercise;
  field: CellField;
  onPatch: (p: Partial<PlanExercise>) => void;
  changed?: boolean;
  className?: string;
  /** a label inside the box when it's empty (phones show no column headers) */
  label?: boolean;
}) {
  const { active, setActive, unit, setUnit } = useCells();
  const [draft, setDraft] = useState<string | null>(null);
  const [mode, setModeState] = useState<LoadMode>(() => loadModeOf(e, unit));
  const ref = useRef<HTMLInputElement>(null);
  const shown = cellText(e, field);
  const value = draft ?? shown.value;
  const focused = active?.exKey === e.key && active.field === field;

  // the latest exercise and mode for the bar's buttons
  const latest = useRef({ e, mode });
  latest.current = { e, mode };

  const type = (text: string) => {
    setDraft(text);
    const p = cellPatch(latest.current.e, field, text, latest.current.mode);
    if (p) onPatch(p);
  };
  const setMode = (m: LoadMode) => {
    setModeState(m);
    if (m === "lb" || m === "kg") setUnit(m);
    // the number stays; what it means changes (a relabel, never a conversion)
    const text = draft ?? cellText(latest.current.e, "load").value;
    if (text) {
      const p = cellPatch(latest.current.e, "load", text, m);
      if (p) onPatch(p);
    }
  };

  useEffect(() => {
    if (!focused) return;
    setActive({ exKey: e.key, field, exercise: e, type, patch: onPatch, mode, setMode });
    // keep the bar pointing at this cell's latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, e, mode]);

  const invalid = cellInvalid(e, field);
  return (
    <label
      className={cn(
        "relative flex h-10 min-w-0 items-center justify-center rounded-lg bg-muted/60 px-1 transition-colors",
        "focus-within:bg-background focus-within:ring-2 focus-within:ring-foreground/70",
        invalid && "ring-1 ring-destructive/70",
        className,
      )}
      data-pb-cell-box={field}
    >
      <input
        ref={ref}
        value={value}
        inputMode={CELL_INPUT_MODE[field]}
        enterKeyHint="next"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={`${CELL_LABEL[field]}${e.name ? `, ${e.name}` : ""}`}
        placeholder={label ? CELL_LABEL[field] : "—"}
        data-pb-cell={field}
        onFocus={(ev) => {
          setDraft(null);
          setModeState(loadModeOf(e, unit));
          setActive({ exKey: e.key, field, exercise: e, type, patch: onPatch, mode: loadModeOf(e, unit), setMode });
          ev.currentTarget.select();
        }}
        onBlur={() => {
          setDraft(null);
          setActive(null);
        }}
        onChange={(ev) => type(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            focusNextCell(ev.currentTarget, ev.shiftKey ? -1 : 1, true);
          }
        }}
        className={cn(
          "w-full min-w-0 bg-transparent text-center text-[15px] font-medium tabular-nums outline-none placeholder:text-[12px] placeholder:font-normal placeholder:text-muted-foreground/70",
        )}
      />
      {shown.unit && value && (
        <span className="pointer-events-none -ml-0.5 shrink-0 pr-0.5 text-[10px] font-medium text-muted-foreground">
          {shown.unit}
        </span>
      )}
      {changed && !focused && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500"
          title="Changed from last week"
        />
      )}
    </label>
  );
}

/**
 * Moves to the next cell (or the one before). `sameColumn`: the same field
 * on the next exercise, the way Enter moves down a column in a spreadsheet;
 * else across the row.
 */
export function focusNextCell(from: HTMLElement, dir: 1 | -1, sameColumn = false) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-pb-cell]"));
  const i = all.indexOf(from as HTMLInputElement);
  if (i < 0) return;
  let next: HTMLInputElement | undefined;
  if (sameColumn) {
    const field = from.getAttribute("data-pb-cell");
    const same = all.filter((x) => x.getAttribute("data-pb-cell") === field);
    next = same[same.indexOf(from as HTMLInputElement) + dir];
  }
  next = next ?? all[i + dir];
  if (next) {
    next.focus();
    next.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } else {
    from.blur();
  }
}

/**
 * The bar over the keyboard while a cell is typed in (phones): the usual
 * values for that cell one tap away, the load's meaning (lb, kg, % of a max,
 * % of the top set), RPE or RIR, Next and Done. Taps never close the keyboard.
 */
export function KeyboardBar() {
  const { active } = useCells();
  const box = useVisualViewportBox(!!active);
  const fade = useScrollFade([active?.field, active?.exercise.key, !!box]);
  if (!active || !box) return null;
  const keep = (ev: React.PointerEvent | React.MouseEvent) => ev.preventDefault();
  const chip = (label: string, on: boolean, onTap: () => void, key?: string) => (
    <button
      key={key ?? label}
      type="button"
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={onTap}
      className={cn(
        "h-9 shrink-0 rounded-full px-3 text-[14px] font-medium tabular-nums transition-colors",
        on ? "bg-foreground text-background" : "bg-secondary text-foreground",
      )}
    >
      {label}
    </button>
  );
  const e = active.exercise;
  const value = cellText(e, active.field).value;
  let chips: React.ReactNode[] = [];
  if (active.field === "sets") chips = SETS_QUICK.map((v) => chip(v, v === value, () => active.type(v)));
  if (active.field === "reps") chips = REPS_QUICK.map((v) => chip(v, v === value, () => active.type(v)));
  if (active.field === "effort") {
    const rir = !!e.rir;
    chips = [
      chip(rir ? "RIR" : "RPE", true, () =>
        active.patch(rir ? { rpe: e.rir ?? null, rir: null } : { rir: e.rpe ?? null, rpe: null }), "scale"),
      <span key="sep" aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />,
      ...(rir ? RIR_QUICK : [...RPE_QUICK, "7-8", "8-9"]).map((v) => chip(v, v === value, () => active.type(v))),
    ];
  }
  if (active.field === "load") {
    chips = (["lb", "kg", "pct_1rm", "pct_top"] as LoadMode[]).map((m) =>
      chip(LOAD_MODE_LABEL[m], active.mode === m, () => active.setMode(m), m),
    );
    if (value) chips.push(chip("Clear", false, () => active.type(""), "clear"));
  }
  if (active.field === "rest") {
    chips = REST_CHOICES.filter((r) => r.seconds).map((r) =>
      chip(r.label, (e.rest_seconds ?? null) === r.seconds, () => active.type(r.label)),
    );
  }
  return (
    <div
      className="fixed inset-x-0 z-[60] flex items-center gap-2 border-t border-border bg-background px-2 py-1.5 md:hidden"
      style={{ top: box.top + box.height - 52 }}
      data-keyboard-bar
    >
      <div ref={fade.ref} style={fade.style} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
        {chips}
      </div>
      <button
        type="button"
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={() => {
          const el = document.activeElement as HTMLElement | null;
          if (el) focusNextCell(el, 1);
        }}
        aria-label="Next"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary"
      >
        <ArrowRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
        className="h-9 shrink-0 rounded-full px-3 text-[14px] font-semibold"
      >
        Done
      </button>
    </div>
  );
}
