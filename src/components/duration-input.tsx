import { useEffect, useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  type DurationUnit, secondsFromUnit, splitForUnit, preferredUnit,
} from "@/lib/duration";
import { cn } from "@/lib/utils";

type Props = {
  /** Duration in integer seconds. `null` = empty. */
  valueSeconds: number | null;
  /** Called with the new duration in seconds (or null when cleared). */
  onChange: (seconds: number | null) => void;
  /** Optional accessible label (rendered visually-hidden by default). */
  label?: string;
  /** Compact mode shrinks the controls for in-table use. */
  compact?: boolean;
  /** Show the inline "Duration" caption above the inputs. Default false. */
  showCaption?: boolean;
  disabled?: boolean;
  className?: string;
  /** When set, the unit selector starts on this unit instead of auto-pick. */
  defaultUnit?: DurationUnit;
  /** Optional id for the number input (a11y). */
  id?: string;
  /** Auto-focus the number input on mount. */
  autoFocus?: boolean;
};

/**
 * Duration [ number ] [ sec ▼ / min ▼ ]
 *
 * Seconds is the single source of truth. The internal text reflects the
 * currently-selected unit; switching units never mutates the stored value,
 * so `90 sec ↔ 1.5 min` round-trips cleanly.
 *
 * Validation rules:
 * - numeric keypad on mobile (`inputMode="decimal"`)
 * - no negatives, no zero (treated as empty)
 * - decimals only when unit = `min`; `sec` strips the decimal point
 * - inline error appears under the row when the value can't be parsed.
 */
export function DurationInput({
  valueSeconds, onChange, label, compact, showCaption, disabled,
  className, defaultUnit, id, autoFocus,
}: Props) {
  const autoId = useId();
  const inputId = id ?? `dur-${autoId}`;
  // Unit lives in local state so the coach can switch without losing focus.
  const [unit, setUnit] = useState<DurationUnit>(
    defaultUnit ?? preferredUnit(valueSeconds),
  );
  // Text input is local — synced to `valueSeconds` from outside, but the user
  // owns it while typing.
  const [text, setText] = useState(() => splitForUnit(valueSeconds, unit));
  const [error, setError] = useState<string | null>(null);

  // External value changed (e.g. apply-to-all overwrote us) → resync.
  useEffect(() => {
    setText(splitForUnit(valueSeconds, unit));
    setError(null);
  }, [valueSeconds, unit]);

  const onUnitChange = (next: DurationUnit) => {
    if (next === unit) return;
    // Preserve seconds when switching units.
    setText(splitForUnit(valueSeconds, next));
    setUnit(next);
    setError(null);
  };

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) { onChange(null); setError(null); return; }
    // `sec` is whole-numbers only; collapse any decimal/garbage characters.
    const cleaned = unit === "sec"
      ? trimmed.replace(/[^\d]/g, "")
      : trimmed.replace(/[^\d.]/g, "");
    if (!cleaned) { onChange(null); setError("Enter a positive number"); return; }
    const secs = secondsFromUnit(cleaned, unit);
    if (secs == null) { setError("Enter a positive number"); return; }
    setError(null);
    onChange(secs);
  };

  // Filter keystrokes live so coaches can never enter letters/negatives.
  const handleInput = (raw: string) => {
    const filtered = unit === "sec"
      ? raw.replace(/[^\d]/g, "")
      : raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setText(filtered);
  };

  const sizeCls = compact ? "h-7 text-xs" : "h-9 text-sm";
  const numCls = compact ? "w-16" : "w-20";

  // Live preview ("= 1 min 30 sec") for the coach when minutes are entered.
  const previewSeconds = useMemo(() => secondsFromUnit(text, unit), [text, unit]);
  const showPreview = !compact && previewSeconds != null && unit === "min" && previewSeconds % 60 !== 0;

  return (
    <div className={cn("inline-flex flex-col gap-0.5", className)}>
      {showCaption && (
        <label htmlFor={inputId} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label ?? "Duration"}
        </label>
      )}
      <div className="inline-flex items-stretch gap-1">
        <Input
          id={inputId}
          aria-label={label ?? "Duration"}
          inputMode="decimal"
          type="text"
          pattern={unit === "sec" ? "[0-9]*" : "[0-9]*\\.?[0-9]*"}
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          placeholder={unit === "sec" ? "30" : "1.5"}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
          }}
          className={cn(sizeCls, numCls, "tabular-nums text-center")}
        />
        <Select value={unit} onValueChange={(v) => onUnitChange(v as DurationUnit)} disabled={disabled}>
          <SelectTrigger className={cn(sizeCls, compact ? "w-[58px] px-2" : "w-[72px]")} aria-label="Unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sec">sec</SelectItem>
            <SelectItem value="min">min</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-[10px] font-semibold text-destructive">{error}</p>}
      {showPreview && (
        <p className="text-[10px] text-muted-foreground tabular-nums">
          = {Math.floor(previewSeconds! / 60)} min {previewSeconds! % 60} sec
        </p>
      )}
    </div>
  );
}