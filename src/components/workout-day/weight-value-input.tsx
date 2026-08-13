import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eraser, Minus, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  WEIGHT_CAP,
  WEIGHT_STEP,
  validateTypedWeight,
  type WUnit,
} from "@/lib/workout-weight-input";
import { formatLoadDisplay, loadFieldLabel, type LoadType } from "@/lib/workout-load-type";

/**
 * Fast weight entry for the set logger.
 *
 * Tapping the cell opens a compact stepper: big value + unit, −step / +step
 * buttons, and "Tap to type" which opens a BLANK numeric field for direct
 * entry (no backspacing an existing number). Bodyweight / Assisted stay
 * visually neutral secondary options; external weight is the default. The
 * last useful external weight and the last useful assistance value are
 * remembered separately, so switching load type never reuses the wrong one.
 *
 * Layout of the workout card itself is untouched.
 */
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
  /** Prescribed / Last Time / previous best reference for the start value. */
  referenceWeight?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmValue, setConfirmValue] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 640px) and (pointer: fine)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const step = WEIGHT_STEP[unit];
  const numeric = value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const shown = formatLoadDisplay(value, loadType, unit, { compact: true });
  const isEmpty = loadType !== "bodyweight" && value === "";

  // Remembered values per load type — external weight and assistance never
  // borrow each other's number, and Bodyweight destroys neither.
  const memoExternal = useRef<number | null>(null);
  const memoAssist = useRef<number | null>(null);
  useEffect(() => {
    if (numeric == null) return;
    if (loadType === "assisted") memoAssist.current = numeric;
    else if (loadType === "external") memoExternal.current = numeric;
  }, [numeric, loadType]);

  const [draftType, setDraftType] = useState<LoadType>(loadType);
  const [draftValue, setDraftValue] = useState<number>(0);

  const roundToStep = (v: number) => Math.round(v / step) * step;
  const startValue = useMemo(() => {
    if (numeric != null && loadType !== "bodyweight") return numeric;
    const remembered = loadType === "assisted" ? memoAssist.current : memoExternal.current;
    if (remembered != null) return remembered;
    if (referenceWeight != null && Number.isFinite(referenceWeight) && referenceWeight > 0) {
      return roundToStep(referenceWeight);
    }
    return 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric, loadType, referenceWeight, step]);

  // Fresh state each time the sheet/popover opens.
  useEffect(() => {
    if (!open) return;
    setDraftType(loadType);
    setDraftValue(startValue);
    setTyping(false);
    setTyped("");
    setError(null);
    setConfirmValue(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cap = WEIGHT_CAP[unit];
  const bump = (delta: number) => {
    setDraftType((t) => (t === "bodyweight" ? "external" : t));
    setDraftValue((v) => {
      const next = Math.min(cap, Math.max(0, roundToStep(v + delta)));
      return Math.round(next * 100) / 100;
    });
  };

  const reset = () => { setTyped(""); setTyping(false); setError(null); setConfirmValue(null); setDraftType(loadType); };

  const commit = (next: { load: string; bodyweight: boolean; loadType: LoadType }) => {
    const n = next.load === "" ? null : Number(next.load);
    if (n != null && Number.isFinite(n)) {
      if (next.loadType === "assisted") memoAssist.current = n;
      else if (next.loadType === "external") memoExternal.current = n;
    }
    onPick(next);
    setOpen(false);
    reset();
  };

  const commitStepper = () => {
    if (draftType === "bodyweight") { commit({ load: "0", bodyweight: true, loadType: "bodyweight" }); return; }
    commit({ load: String(draftValue), bodyweight: false, loadType: draftType === "assisted" ? "assisted" : "external" });
  };

  const submitTyped = () => {
    const res = validateTypedWeight(typed, unit);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    if (res.aboveCap) { setConfirmValue(res.value); return; }
    commit({ load: String(res.value), bodyweight: false, loadType: draftType === "assisted" ? "assisted" : "external" });
  };

  /** Switch load type, restoring that type's remembered value. */
  const chooseType = (next: LoadType) => {
    if (next === draftType && next !== "bodyweight") { setDraftType("external"); return; }
    setDraftType(next);
    if (next === "assisted") setDraftValue(memoAssist.current ?? draftValue);
    else if (next === "external") setDraftValue(memoExternal.current ?? draftValue);
  };

  const secondaryBtn = (active: boolean) =>
    cn(
      "h-10 rounded-lg border text-xs font-semibold transition-colors",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
    );

  const body = (
    <div className="space-y-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {loadFieldLabel(draftType, unit)}
      </div>

      {confirmValue != null ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="text-[12px] font-medium text-foreground">
            This is above the normal weight cap ({cap} {unit}). Save anyway?
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => commit({ load: String(confirmValue), bodyweight: false, loadType: draftType === "assisted" ? "assisted" : "external" })}
              className="h-9 flex-1 rounded-md bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Save anyway
            </button>
            <button
              type="button"
              onClick={() => { setConfirmValue(null); setTyped(""); setTyping(true); }}
              className="h-9 flex-1 rounded-md border border-border/60 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              Edit weight
            </button>
          </div>
        </div>
      ) : typing ? (
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); submitTyped(); }}>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Input
                autoFocus
                inputMode="decimal"
                type="text"
                enterKeyHint="done"
                value={typed}
                onChange={(e) => { setTyped(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }}
                placeholder=""
                aria-label={`${ariaLabel} — exact value`}
                className="h-11 pr-10 text-base px-2 font-bold tabular-nums"
              />
              {/* The unit is never hidden, even while typing. */}
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {unit}
              </span>
            </div>
            <button
              type="submit"
              aria-label="Apply weight"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
          {error && <div className="text-[11px] font-medium text-destructive">{error}</div>}
          <div className="flex gap-1.5">
            {/* Cancel never writes: the stored value survives an aborted edit. */}
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="h-8 flex-1 rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { setTyping(false); setError(null); }}
              className="h-8 flex-1 rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Use +/−
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => { setTyped(""); setTyping(true); setDraftType(draftType === "bodyweight" ? "external" : draftType); }}
            aria-label={`${ariaLabel} — tap to type an exact value`}
            className={cn(
              "w-full rounded-xl border border-border/60 bg-muted/30 py-2 text-center transition-colors hover:bg-muted/50",
              draftType === "bodyweight" && "opacity-45",
            )}
          >
            <div className="text-3xl font-black leading-none tabular-nums text-foreground">
              {draftType === "bodyweight" ? "BW" : draftValue}
            </div>
            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {draftType === "bodyweight" ? "Bodyweight" : unit}
            </div>
          </button>

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
            onClick={() => { setTyped(""); setTyping(true); setDraftType(draftType === "bodyweight" ? "external" : draftType); }}
            className="h-7 w-full text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Tap to type
          </button>

          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Other load type
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => chooseType(draftType === "bodyweight" ? "external" : "bodyweight")}
                aria-pressed={draftType === "bodyweight"}
                className={secondaryBtn(draftType === "bodyweight")}
              >
                Bodyweight
              </button>
              <button
                type="button"
                onClick={() => chooseType("assisted")}
                aria-pressed={draftType === "assisted"}
                className={secondaryBtn(draftType === "assisted")}
              >
                Assisted
              </button>
            </div>
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="h-10 flex-1 rounded-lg border border-border/60 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitStepper}
              className="h-10 flex-[1.4] rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </>
      )}

      {(loadType !== "external" || value !== "") && (
        <button
          type="button"
          onClick={() => commit({ load: "", bodyweight: false, loadType: "external" })}
          aria-label="Clear weight"
          className="flex h-8 w-full items-center justify-center gap-1 rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
        >
          <Eraser className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => { if (!disabled) setOpen(true); }}
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

  const handleOpenChange = (next: boolean) => {
    if (disabled) return;
    setOpen(next);
    if (!next) reset();
  };

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          collisionPadding={12}
          className="w-[13rem] max-w-[calc(100vw-2rem)] p-2.5"
          onOpenAutoFocus={(e) => e.preventDefault()}
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
            className="absolute inset-0 bg-black/50"
            onClick={() => handleOpenChange(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-background p-3 shadow-2xl"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            {body}
          </div>
        </div>
      )}
    </>
  );
}
