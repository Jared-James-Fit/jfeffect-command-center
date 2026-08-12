import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Eraser } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  WEIGHT_CAP,
  nearestWeightIndex,
  readWeightInputMode,
  saveWeightInputMode,
  validateTypedWeight,
  weightPickerStart,
  weightPickerValues,
  type WeightInputMode,
  type WUnit,
} from "@/lib/workout-weight-input";
import { formatLoadDisplay, loadFieldLabel, type LoadType } from "@/lib/workout-load-type";

const ITEM_W = 72; // px per horizontal wheel cell

/**
 * Compact weight picker for the set logger. Tapping the cell opens a fast
 * horizontal wheel (native momentum, JS snap once it settles) with a quick
 * Bodyweight button above it, plus a Type mode for exact entry. Mobile renders
 * it as a bottom sheet, desktop as a compact popover. Layout of the workout
 * card itself is untouched.
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
  /** Prescribed / Last Time / previous best reference for the start position. */
  referenceWeight?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<WeightInputMode>("picker");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmValue, setConfirmValue] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => { setMode(readWeightInputMode()); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 640px) and (pointer: fine)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const numeric = value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const shown = formatLoadDisplay(value, loadType, unit, { compact: true });
  const isEmpty = loadType !== "bodyweight" && value === "";

  const startTarget = useMemo(
    () => weightPickerStart([numeric, referenceWeight]),
    [numeric, referenceWeight],
  );
  const numbers = useMemo(
    () => weightPickerValues(unit, Math.max(numeric ?? 0, referenceWeight ?? 0)),
    [unit, numeric, referenceWeight],
  );
  /** Numeric index the wheel should land on when opened. */
  const initialIndex = useMemo(() => {
    if (startTarget == null) return nearestWeightIndex(numbers, numeric ?? 0);
    return nearestWeightIndex(numbers, startTarget);
  }, [startTarget, numbers, numeric]);

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [draftType, setDraftType] = useState<LoadType>(loadType);
  const bwSelected = draftType === "bodyweight";
  const setBwSelected = (next: boolean) => setDraftType(next ? "bodyweight" : draftType === "assisted" ? "assisted" : "external");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticRef = useRef(false);

  const scrollToIndex = useCallback((idx: number, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTo({ left: idx * ITEM_W, behavior: smooth ? "smooth" : "auto" });
    window.setTimeout(() => { programmaticRef.current = false; }, smooth ? 400 : 80);
  }, []);

  // Position the wheel on the smart start value every time it opens.
  useLayoutEffect(() => {
    if (!open || mode !== "picker") return;
    setActiveIndex(initialIndex);
    setDraftType(loadType);
    const id = requestAnimationFrame(() => scrollToIndex(initialIndex));
    return () => cancelAnimationFrame(id);
  }, [open, mode, initialIndex, loadType, scrollToIndex]);

  /**
   * Native momentum runs untouched (no CSS snap, no scrollIntoView mid-drag);
   * we only read the index and snap once the scroll has settled.
   */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(numbers.length - 1, Math.round(el.scrollLeft / ITEM_W)));
    setActiveIndex((prev) => (prev === idx ? prev : idx));
    if (!programmaticRef.current && bwSelected) setBwSelected(false);
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      if (programmaticRef.current) return;
      const settled = Math.max(0, Math.min(numbers.length - 1, Math.round(el.scrollLeft / ITEM_W)));
      setActiveIndex(settled);
      if (Math.abs(el.scrollLeft - settled * ITEM_W) > 1) scrollToIndex(settled, true);
    }, 140);
  };

  const reset = () => { setTyped(""); setError(null); setConfirmValue(null); setDraftType(loadType); };

  const commit = (next: { load: string; bodyweight: boolean; loadType: LoadType }) => {
    onPick(next);
    setOpen(false);
    reset();
  };

  const confirmWheel = () => {
    if (bwSelected) { commit({ load: "0", bodyweight: true, loadType: "bodyweight" }); return; }
    const v = numbers[activeIndex];
    if (v == null) { setOpen(false); return; }
    commit({ load: String(v), bodyweight: false, loadType: draftType === "assisted" ? "assisted" : "external" });
  };

  const submitTyped = () => {
    const res = validateTypedWeight(typed, unit);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    if (res.aboveCap) { setConfirmValue(res.value); return; }
    commit({ load: String(res.value), bodyweight: false, loadType: draftType === "assisted" ? "assisted" : "external" });
  };

  const body = (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {loadFieldLabel(draftType, unit)}
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-border/60 text-[10px] font-bold uppercase">
          {(["picker", "type"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); saveWeightInputMode(m); setError(null); setConfirmValue(null); }}
              aria-pressed={mode === m}
              className={cn(
                "px-2.5 py-1 transition-colors",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (draftType === "bodyweight") { setDraftType("external"); return; }
            if (mode === "type") { commit({ load: "0", bodyweight: true, loadType: "bodyweight" }); return; }
            setDraftType("bodyweight");
          }}
          aria-pressed={draftType === "bodyweight"}
          className={cn(
            "h-10 rounded-lg border text-xs font-bold transition-colors",
            draftType === "bodyweight"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/60 text-foreground hover:bg-muted/60",
          )}
        >
          Bodyweight
        </button>
        <button
          type="button"
          onClick={() => setDraftType(draftType === "assisted" ? "external" : "assisted")}
          aria-pressed={draftType === "assisted"}
          className={cn(
            "h-10 rounded-lg border text-xs font-bold transition-colors",
            draftType === "assisted"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/60 text-foreground hover:bg-muted/60",
          )}
        >
          Assisted
        </button>
      </div>

      {mode === "picker" ? (
        <>

          <div className={cn("relative", bwSelected && "opacity-45")}>
            {/* centre selection band */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-primary/60 bg-primary/5"
              style={{ width: ITEM_W }}
            />
            <div
              ref={scrollRef}
              onScroll={onScroll}
              role="listbox"
              aria-label={loadFieldLabel(draftType, unit)}
              className="relative flex h-[64px] items-center overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="shrink-0" style={{ width: `calc(50% - ${ITEM_W / 2}px)` }} />
              {numbers.map((v, i) => {
                const active = !bwSelected && i === activeIndex;
                return (
                  <div
                    key={v}
                    role="option"
                    aria-selected={active}
                    onClick={() => { setBwSelected(false); setActiveIndex(i); scrollToIndex(i, true); }}
                    className={cn(
                      "flex h-full shrink-0 cursor-pointer select-none items-center justify-center tabular-nums",
                      active
                        ? "text-lg font-bold text-foreground"
                        : "text-sm font-medium text-muted-foreground/70",
                    )}
                    style={{ width: ITEM_W }}
                  >
                    {v}
                  </div>
                );
              })}
              <div className="shrink-0" style={{ width: `calc(50% - ${ITEM_W / 2}px)` }} />
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
              onClick={confirmWheel}
              className="h-10 flex-[1.4] rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </>
      ) : confirmValue != null ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="text-[12px] font-medium text-foreground">
            This is above the normal weight cap ({WEIGHT_CAP[unit]} {unit}). Save anyway?
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
              onClick={() => setConfirmValue(null)}
              className="h-9 flex-1 rounded-md border border-border/60 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              Edit weight
            </button>
          </div>
        </div>
      ) : (
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); submitTyped(); }}>
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              inputMode="decimal"
              type="text"
              value={typed}
              onChange={(e) => { setTyped(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }}
              placeholder={loadFieldLabel(draftType, unit)}
              aria-label={`${ariaLabel} — exact value`}
              className="h-10 text-base px-2"
            />
            <button
              type="submit"
              aria-label="Apply weight"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
          {error && <div className="text-[11px] font-medium text-destructive">{error}</div>}
        </form>
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
