import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eraser } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  WEIGHT_CAP,
  readWeightInputMode,
  saveWeightInputMode,
  validateTypedWeight,
  weightPickerValues,
  type WeightInputMode,
  type WUnit,
} from "@/lib/workout-weight-input";

/**
 * Compact weight field for the set logger. Same footprint as the previous
 * plain <Input> — tapping opens a small sheetless popover with:
 *   • BW (bodyweight) one-tap option
 *   • Picker mode (default): 0 then unit jumps, capped at 1000 lb / 450 kg
 *   • Type mode: exact entry with an above-cap confirmation
 */
export function WeightValueInput({
  value,
  isBodyweight,
  unit,
  onPick,
  disabled = false,
  focusMode = false,
  ariaLabel,
}: {
  value: string;
  isBodyweight: boolean;
  unit: WUnit;
  /** null load + bodyweight flag. `{ load: "", bodyweight: false }` clears. */
  onPick: (next: { load: string; bodyweight: boolean }) => void;
  disabled?: boolean;
  focusMode?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<WeightInputMode>("picker");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmValue, setConfirmValue] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMode(readWeightInputMode()); }, []);

  const options = useMemo(() => weightPickerValues(unit), [unit]);
  const numeric = value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const shown = isBodyweight ? "BW" : (value || unit);

  const commit = (next: { load: string; bodyweight: boolean }) => {
    onPick(next);
    setOpen(false);
    setTyped("");
    setError(null);
    setConfirmValue(null);
  };

  const submitTyped = () => {
    const res = validateTypedWeight(typed, unit);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    if (res.aboveCap) { setConfirmValue(res.value); return; }
    commit({ load: String(res.value), bodyweight: false });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) { setTyped(""); setError(null); setConfirmValue(null); }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "flex w-full items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors whitespace-nowrap",
            focusMode ? "h-9 text-base" : "h-8",
            !isBodyweight && value === ""
              ? "border-blue-500/40 bg-blue-500/10 text-foreground"
              : "border-border/60 bg-muted/40 text-muted-foreground",
            !disabled && "cursor-pointer hover:bg-muted/60",
          )}
        >
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        collisionPadding={12}
        className="w-[16rem] max-w-[calc(100vw-2rem)] p-2.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-2">
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
                    "px-2 py-1 transition-colors",
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* BW is always one tap away, in both modes */}
          <button
            type="button"
            onClick={() => commit({ load: "0", bodyweight: true })}
            aria-pressed={isBodyweight}
            className={cn(
              "flex h-11 w-full items-center justify-center rounded-lg border text-base font-bold transition-colors",
              isBodyweight
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/70",
            )}
          >
            BW · Bodyweight
          </button>

          {mode === "picker" ? (
            <div ref={listRef} className="max-h-56 overflow-y-auto rounded-md border border-border/50 p-1">
              <div className="grid grid-cols-3 gap-1.5">
                {options.map((v) => {
                  const selected = !isBodyweight && numeric != null && Math.abs(numeric - v) < 1e-9;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => commit({ load: String(v), bodyweight: false })}
                      aria-pressed={selected}
                      className={cn(
                        "flex h-10 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/70",
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
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
            <form
              className="space-y-1.5"
              onSubmit={(e) => { e.preventDefault(); submitTyped(); }}
            >
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
            </form>
          )}

          {(isBodyweight || value !== "") && (
            <button
              type="button"
              onClick={() => commit({ load: "", bodyweight: false })}
              aria-label="Clear weight"
              className="flex h-8 w-full items-center justify-center gap-1 rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
            >
              <Eraser className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
