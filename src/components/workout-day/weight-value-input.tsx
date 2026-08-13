import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eraser, Minus, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  WEIGHT_CAP,
  WEIGHT_STEP,
  validateTypedWeight,
  type WUnit,
} from "@/lib/workout-weight-input";
import { formatLoadDisplay, type LoadType } from "@/lib/workout-load-type";

/**
 * Weight entry for the set logger — TAP → TYPE → keyboard Done → saved+closed.
 *
 * RELIABILITY RULES (do not reintroduce the old multi-draft design):
 *  - exactly ONE draft state for the number (`typed`)
 *  - exactly ONE commit path (`commitWeight`)
 *  - no effect ever writes to `typed`; it is seeded once, in the open handler,
 *    inside the tap gesture. Prop changes (cascade, autosave, refetch) can
 *    therefore never clobber what the user is typing.
 *  - nothing persists until commit: no per-keystroke autosave, no cascade
 *  - Cancel closes without writing, so the stored value survives
 *
 * Bodyweight / Assisted / +/− live behind a small "Options" disclosure and
 * never gate the plain numeric path.
 *
 * UNIT: read-only, from the workout card's KG/LB toggle. No local unit state,
 * no conversion here.
 */

type SheetMode = "type" | "adjust" | "bodyweight";

export function WeightValueInput({
  value,
  isBodyweight,
  loadType = isBodyweight ? "bodyweight" : "external",
  unit,
  onPick,
  disabled = false,
  focusMode = false,
  ariaLabel,
  referenceWeight = null,
}: {
  value: string;
  isBodyweight: boolean;
  /** external | bodyweight | assisted — assisted means the number is assistance. */
  loadType?: LoadType;
  unit: WUnit;
  /** `{ load: "", bodyweight: false, loadType: "external" }` clears. */
  onPick: (next: { load: string; bodyweight: boolean; loadType: LoadType }) => void;
  disabled?: boolean;
  focusMode?: boolean;
  ariaLabel: string;
  /** Prescribed / Last Time / previous best reference for the +/− start value. */
  referenceWeight?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SheetMode>("type");
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** THE single numeric draft. Only user input and the open handler write it. */
  const [typed, setTyped] = useState("");
  const [draftType, setDraftType] = useState<LoadType>("external");
  const [stepValue, setStepValue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmValue, setConfirmValue] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 640px) and (pointer: fine)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const step = WEIGHT_STEP[unit];
  const cap = WEIGHT_CAP[unit];
  const numeric = value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const shown = formatLoadDisplay(value, loadType, unit, { compact: true });
  const isEmpty = loadType !== "bodyweight" && value === "";

  // Remembered values per load type — external weight and assistance never
  // borrow each other's number.
  const memoExternal = useRef<number | null>(null);
  const memoAssist = useRef<number | null>(null);
  useEffect(() => {
    if (numeric == null) return;
    if (loadType === "assisted") memoAssist.current = numeric;
    else if (loadType === "external") memoExternal.current = numeric;
  }, [numeric, loadType]);

  const roundToStep = (v: number) => Math.round(v / step) * step;
  /** Start value for the +/− view only. Typing always starts blank. */
  const stepperStart = () => {
    if (numeric != null && loadType !== "bodyweight") return numeric;
    const remembered = loadType === "assisted" ? memoAssist.current : memoExternal.current;
    if (remembered != null) return remembered;
    if (referenceWeight != null && Number.isFinite(referenceWeight) && referenceWeight > 0) {
      return roundToStep(referenceWeight);
    }
    return 0;
  };

  /** Seed everything synchronously in the tap gesture — no open-effect. */
  const openSheet = () => {
    if (disabled) return;
    setTyped("");
    setError(null);
    setConfirmValue(null);
    setOptionsOpen(false);
    setDraftType(loadType === "assisted" ? "assisted" : "external");
    setStepValue(stepperStart());
    setMode(loadType === "bodyweight" ? "bodyweight" : "type");
    setOpen(true);
  };

  const closeSheet = () => {
    inputRef.current?.blur();
    setOpen(false);
    setOptionsOpen(false);
    setConfirmValue(null);
    setError(null);
  };

  // iOS/PWA: focus in the same commit the field mounts, inside the tap gesture,
  // or Safari refuses to raise the keyboard.
  const wantsInput = open && mode === "type" && confirmValue == null;
  useLayoutEffect(() => {
    if (!wantsInput) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const raf = requestAnimationFrame(() => {
      if (document.activeElement !== el) el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [wantsInput]);

  /**
   * THE canonical commit. Every successful confirmation — keyboard Done,
   * desktop ✓, +/− Done, Bodyweight, Clear — funnels through here.
   * Optimistic by construction: onPick updates local row state immediately and
   * the existing autosave/cascade/auto-complete run downstream of it.
   */
  const commitWeight = (next: { load: string; bodyweight: boolean; loadType: LoadType }) => {
    const n = next.load === "" ? null : Number(next.load);
    if (n != null && Number.isFinite(n)) {
      if (next.loadType === "assisted") memoAssist.current = n;
      else if (next.loadType === "external") memoExternal.current = n;
    }
    inputRef.current?.blur();
    setOpen(false);
    setOptionsOpen(false);
    setConfirmValue(null);
    setError(null);
    onPick(next);
  };

  const numericType: LoadType = draftType === "assisted" ? "assisted" : "external";

  const submitTyped = () => {
    const res = validateTypedWeight(typed, unit);
    if (!res.ok) { setError(res.error); return; }
    if (res.aboveCap) { setError(null); setConfirmValue(res.value); return; }
    commitWeight({ load: String(res.value), bodyweight: false, loadType: numericType });
  };

  const bump = (delta: number) => {
    setStepValue((v) => {
      const nextV = Math.min(cap, Math.max(0, roundToStep(v + delta)));
      return Math.round(nextV * 100) / 100;
    });
  };

  const chooseBodyweight = () => {
    setOptionsOpen(false);
    setError(null);
    setDraftType("bodyweight");
    setMode("bodyweight");
    inputRef.current?.blur();
  };

  const chooseAssisted = () => {
    setOptionsOpen(false);
    setError(null);
    setTyped("");
    setDraftType("assisted");
    setMode("type");
  };

  const chooseExternalTyping = () => {
    setOptionsOpen(false);
    setError(null);
    setTyped("");
    setDraftType("external");
    setMode("type");
  };

  const chooseStepper = () => {
    setOptionsOpen(false);
    setError(null);
    setDraftType((t) => (t === "assisted" ? "assisted" : "external"));
    setStepValue((v) => (v > 0 ? v : stepperStart()));
    setMode("adjust");
  };

  const fieldLabel =
    draftType === "assisted"
      ? `Assistance · ${unit.toUpperCase()}`
      : `Weight · ${unit.toUpperCase()}`;

  const cancelBtn = (
    // Cancel never writes: the stored value survives an aborted edit.
    <button
      type="button"
      onClick={closeSheet}
      className="h-9 w-full rounded-md text-[11px] font-semibold text-muted-foreground hover:text-foreground"
    >
      Cancel
    </button>
  );

  const optionsMenu = (
    // LOAD TYPE / INPUT METHOD only. Never KG/LB.
    <div>
      <button
        type="button"
        onClick={() => setOptionsOpen((v) => !v)}
        aria-expanded={optionsOpen}
        className="flex h-7 w-full items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
      >
        Options <ChevronDown className={cn("h-3 w-3 transition-transform", optionsOpen && "rotate-180")} />
      </button>
      {optionsOpen && (
        <div className="mt-1 space-y-1 rounded-lg border border-border/60 p-1">
          {draftType !== "bodyweight" && (
            <button type="button" onClick={chooseBodyweight} className={optionItem}>
              Bodyweight
            </button>
          )}
          {draftType !== "assisted" && (
            <button type="button" onClick={chooseAssisted} className={optionItem}>
              Assisted
            </button>
          )}
          {draftType === "assisted" && (
            <button type="button" onClick={chooseExternalTyping} className={optionItem}>
              External weight
            </button>
          )}
          {mode !== "adjust" && (
            <button type="button" onClick={chooseStepper} className={optionItem}>
              Use +/−
            </button>
          )}
          {(loadType !== "external" || value !== "") && (
            <button
              type="button"
              onClick={() => commitWeight({ load: "", bodyweight: false, loadType: "external" })}
              className={cn(optionItem, "text-muted-foreground hover:text-destructive")}
            >
              <span className="inline-flex items-center gap-1"><Eraser className="h-3 w-3" /> Clear weight</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  const body = (
    <div className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {mode === "bodyweight" ? "Load type" : fieldLabel}
      </div>

      {confirmValue != null ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="text-[12px] font-medium text-foreground">
            This is above the normal weight cap ({cap} {unit}). Save anyway?
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => commitWeight({ load: String(confirmValue), bodyweight: false, loadType: numericType })}
              className="h-9 flex-1 rounded-md bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Save anyway
            </button>
            <button
              type="button"
              onClick={() => { setConfirmValue(null); setTyped(""); setMode("type"); }}
              className="h-9 flex-1 rounded-md border border-border/60 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              Edit weight
            </button>
          </div>
        </div>
      ) : mode === "bodyweight" ? (
        <>
          <div className="w-full rounded-xl border border-primary/40 bg-primary/10 py-3 text-center">
            <div className="text-base font-black uppercase leading-none tracking-wide text-primary">
              Bodyweight
            </div>
          </div>
          <button
            type="button"
            onClick={() => commitWeight({ load: "0", bodyweight: true, loadType: "bodyweight" })}
            className="h-10 w-full rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            Save bodyweight
          </button>
          <button
            type="button"
            onClick={chooseExternalTyping}
            className="h-8 w-full rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Enter a weight instead
          </button>
          {optionsMenu}
          {cancelBtn}
        </>
      ) : mode === "adjust" ? (
        <>
          <div className="w-full rounded-xl border border-border/60 bg-muted/30 py-2 text-center">
            <div className="text-3xl font-black leading-none tabular-nums text-foreground">{stepValue}</div>
            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {unit}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => bump(-step)}
              aria-label={`Decrease by ${step} ${unit}`}
              className="flex h-11 items-center justify-center gap-1 rounded-lg border border-border/60 text-sm font-bold text-foreground hover:bg-muted/60"
            >
              <Minus className="h-3.5 w-3.5" /> {step}
            </button>
            <button
              type="button"
              onClick={() => bump(step)}
              aria-label={`Increase by ${step} ${unit}`}
              className="flex h-11 items-center justify-center gap-1 rounded-lg border border-border/60 text-sm font-bold text-foreground hover:bg-muted/60"
            >
              <Plus className="h-3.5 w-3.5" /> {step}
            </button>
          </div>
          <button
            type="button"
            onClick={() => commitWeight({ load: String(stepValue), bodyweight: false, loadType: numericType })}
            className="h-10 w-full rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
          <button
            type="button"
            onClick={chooseExternalTyping}
            className="h-8 w-full rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Type exact weight
          </button>
          {optionsMenu}
          {cancelBtn}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submitTyped(); }} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                autoFocus
                inputMode="decimal"
                type="text"
                enterKeyHint="done"
                value={typed}
                onChange={(e) => { setTyped(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }}
                placeholder=""
                aria-label={`${ariaLabel} — ${draftType === "assisted" ? "assistance" : "weight"} in ${unit}`}
                className="h-12 px-2 pr-10 text-lg font-bold tabular-nums"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {unit}
              </span>
            </div>
            {/* Desktop only — there is no keyboard Done key with a mouse. */}
            {isDesktop && (
              <button
                type="submit"
                aria-label="Save weight"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>
          {error && <div className="text-[11px] font-medium text-destructive">{error}</div>}
          {optionsMenu}
          {cancelBtn}
        </form>
      )}
    </div>
  );

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={openSheet}
      className={cn(
        "flex w-full items-center justify-center whitespace-nowrap rounded-md border px-2 text-sm font-medium transition-colors",
        focusMode ? "h-9 text-base" : "h-8",
        loadType === "bodyweight" && "text-[10px] font-semibold uppercase tracking-tight",
        isEmpty
          ? "border-blue-500/40 bg-blue-500/10 text-muted-foreground"
          : "border-border/60 bg-muted/40 text-foreground",
        !disabled && "cursor-pointer hover:bg-muted/60",
      )}
    >
      {shown}
    </button>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={(next) => (next ? openSheet() : closeSheet())}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          collisionPadding={12}
          className="w-[13rem] max-w-[calc(100vw-2rem)] p-2.5"
        >
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[70] sm:hidden" role="dialog" aria-modal="true" aria-label={ariaLabel}>
          <button
            type="button"
            aria-label="Close weight picker"
            tabIndex={-1}
            className="absolute inset-0 bg-black/50"
            onClick={closeSheet}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-background p-2.5 shadow-2xl"
            style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
            {body}
          </div>
        </div>
      )}
    </>
  );
}

const optionItem =
  "h-9 w-full rounded-md px-2 text-left text-[12px] font-semibold text-foreground hover:bg-muted/60";
