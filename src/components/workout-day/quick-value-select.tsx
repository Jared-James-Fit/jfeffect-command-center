import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Eraser } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatQuickValue } from "@/lib/workout-quick-select";

/**
 * Compact tap selector for workout set logging (reps / RPE / RIR).
 *
 * The trigger looks exactly like the previous chip. Tapping opens a small
 * popover with large one-tap options derived from the prescription, an
 * expandable full range, a manual custom entry, and a clear action — the
 * keyboard only opens if the client explicitly chooses custom entry.
 */
export function QuickValueSelect({
  value,
  displayValue,
  onPick,
  options,
  moreOptions: more = [],
  ariaLabel,
  title,
  empty = "—",
  highlightWhenEmpty = true,
  allowClear = true,
  inputMode = "numeric",
  sanitize = (v: string) => v,
  disabled = false,
  focusMode = false,
  customPlaceholder,
}: {
  /** Raw current value (string, may be ""). */
  value: string;
  /** Optional display override for the closed chip (e.g. RIR = 10 − RPE). */
  displayValue?: string;
  /** Called with the raw string the user picked ("" = clear). */
  onPick: (value: string) => void;
  options: number[];
  moreOptions?: number[];
  ariaLabel: string;
  title?: string;
  empty?: string;
  highlightWhenEmpty?: boolean;
  allowClear?: boolean;
  inputMode?: "numeric" | "decimal";
  sanitize?: (value: string) => string;
  disabled?: boolean;
  focusMode?: boolean;
  customPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState("");

  const shown = displayValue ?? (value || empty);
  const numericValue = Number(value);
  const hasValue = value !== "" && Number.isFinite(numericValue);

  const pick = (v: string) => {
    onPick(v);
    setOpen(false);
    setShowMore(false);
    setShowCustom(false);
    setCustom("");
  };

  const chipGrid = (values: number[]) => (
    <div className="grid grid-cols-3 gap-1.5">
      {values.map((v) => {
        const selected = hasValue && Math.abs(numericValue - v) < 1e-9;
        return (
          <button
            key={v}
            type="button"
            onClick={() => pick(formatQuickValue(v))}
            aria-pressed={selected}
            className={cn(
              "flex h-11 min-w-[3.25rem] items-center justify-center rounded-lg border text-base font-semibold tabular-nums transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/70 active:bg-muted",
            )}
          >
            {formatQuickValue(v)}
          </button>
        );
      })}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) {
          setShowMore(false);
          setShowCustom(false);
          setCustom("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title={title}
          className={cn(
            "flex w-full items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors whitespace-nowrap",
            focusMode ? "h-9 text-base" : "h-8",
            !hasValue && highlightWhenEmpty
              ? "border-blue-500/40 bg-blue-500/10 text-foreground"
              : "border-border/60 bg-muted/40 text-muted-foreground",
            !disabled && !hasValue && "hover:border-blue-500/60 hover:bg-blue-500/10 cursor-pointer",
            !disabled && hasValue && "hover:bg-muted/60 cursor-pointer",
            disabled && "cursor-default",
          )}
        >
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        collisionPadding={12}
        className="w-auto max-w-[calc(100vw-2rem)] p-2.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-2">
          {title && (
            <div className="px-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
          )}
          {chipGrid(options)}
          {more.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {showMore ? (
                  <>Less <ChevronUp className="h-3 w-3" /></>
                ) : (
                  <>More <ChevronDown className="h-3 w-3" /></>
                )}
              </button>
              {showMore && chipGrid(more)}
            </div>
          )}
          {showCustom ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const cleaned = sanitize(custom.trim());
                if (cleaned) pick(cleaned);
              }}
            >
              <Input
                autoFocus
                inputMode={inputMode}
                type="text"
                value={custom}
                onChange={(e) => setCustom(sanitize(e.target.value))}
                placeholder={customPlaceholder ?? "Custom"}
                aria-label={`${ariaLabel} — custom value`}
                className="h-10 text-base px-2"
              />
              <button
                type="submit"
                aria-label="Apply custom value"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Check className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="h-8 flex-1 rounded-md border border-dashed border-border/70 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                Custom…
              </button>
              {allowClear && hasValue && (
                <button
                  type="button"
                  onClick={() => pick("")}
                  aria-label={`Clear ${ariaLabel}`}
                  className="flex h-8 items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                >
                  <Eraser className="h-3 w-3" /> Clear
                </button>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}