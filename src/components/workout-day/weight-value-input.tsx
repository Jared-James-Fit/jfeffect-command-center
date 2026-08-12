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
  unit,
  onPick,
  disabled = false,
  focusMode = false,
  ariaLabel,
  referenceWeight = null,
}: {
  value: string;
  isBodyweight: boolean;
  unit: WUnit;
  /** null load + bodyweight flag. `{ load: "", bodyweight: false }` clears. */
  onPick: (next: { load: string; bodyweight: boolean }) => void;
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
  const shown = isBodyweight ? "BW" : (value || "Select");
  const isEmpty = !isBodyweight && value === "";

  const startTarget = useMemo(
    () => weightPickerStart([numeric, referenceWeight]),
    [numeric, referenceWeight],
  );
  const numbers = useMemo(
    () => weightPickerValues(unit, Math.max(numeric ?? 0, referenceWeight ?? 0)),
    [unit, numeric, referenceWeight],
  );
  const items = useMemo<PickerItem[]>(
    () => [
      { key: "bw", label: "BW", bw: true, value: null },
      ...numbers.map((v) => ({ key: String(v), label: String(v), bw: false, value: v })),
    ],
    [numbers],
  );
  /** Index the wheel should land on when opened. */
  const initialIndex = useMemo(() => {
    if (isBodyweight) return 0;
    if (startTarget == null) return 1; // "0" row
    return 1 + nearestWeightIndex(numbers, startTarget);
  }, [isBodyweight, startTarget, numbers]);

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToIndex = useCallback((idx: number, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: idx * ROW_H, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Position the wheel on the smart start row every time it opens.
  useLayoutEffect(() => {
    if (!open || mode !== "picker") return;
    setActiveIndex(initialIndex);
    const id = requestAnimationFrame(() => scrollToIndex(initialIndex));
    return () => cancelAnimationFrame(id);
  }, [open, mode, initialIndex, scrollToIndex]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW_H)));
    setActiveIndex(idx);
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => setActiveIndex(idx), 60);
  };

  const reset = () => { setTyped(""); setError(null); setConfirmValue(null); };

  const commit = (next: { load: string; bodyweight: boolean }) => {
    onPick(next);
    setOpen(false);
    reset();
  };

  const confirmWheel = () => {
    const item = items[activeIndex];
    if (!item) { setOpen(false); return; }
    commit(item.bw ? { load: "0", bodyweight: true } : { load: String(item.value), bodyweight: false });
  };

  const submitTyped = () => {
    const res = validateTypedWeight(typed, unit);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    if (res.aboveCap) { setConfirmValue(res.value); return; }
    commit({ load: String(res.value), bodyweight: false });
  };

  const body = (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Weight ({unit})
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

      {mode === "picker" ? (
        <>
          <div className="relative">
            {/* centre selection band */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-1 top-1/2 z-10 -translate-y-1/2 rounded-lg border border-primary/60 bg-primary/5"
              style={{ height: ROW_H }}
            />
            <div
              ref={scrollRef}
              onScroll={onScroll}
              role="listbox"
              aria-label={`Weight in ${unit}`}
              className="relative h-[200px] snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div style={{ height: ROW_H * PAD_ROWS }} />
              {items.map((it, i) => {
                const active = i === activeIndex;
                return (
                  <button
                    key={it.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => { setActiveIndex(i); scrollToIndex(i, true); }}
                    className={cn(
                      "flex w-full snap-center items-center justify-center tabular-nums transition-all",
                      active
                        ? "text-lg font-bold text-foreground"
                        : "text-sm font-medium text-muted-foreground/70",
                    )}
                    style={{ height: ROW_H }}
                  >
                    {it.label}
                  </button>
                );
              })}
              <div style={{ height: ROW_H * PAD_ROWS }} />
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
              onClick={() => commit({ load: String(confirmValue), bodyweight: false })}
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
              placeholder={`Weight (${unit})`}
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
          <button
            type="button"
            onClick={() => commit({ load: "0", bodyweight: true })}
            className="h-9 w-full rounded-lg border border-border/60 text-xs font-bold text-foreground hover:bg-muted/60"
          >
            Use BW · Bodyweight
          </button>
        </form>
      )}

      {(isBodyweight || value !== "") && (
        <button
          type="button"
          onClick={() => commit({ load: "", bodyweight: false })}
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
