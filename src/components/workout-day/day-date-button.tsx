import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatTrainingDate } from "@/lib/workout-day-label";
import { parseLocalDate } from "@/lib/today";
import { format } from "date-fns";

interface Props {
  value: string | null | undefined;      // ISO yyyy-mm-dd
  onChange: (iso: string | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  compact?: boolean;
  /**
   * "inline": a quiet date in a line of text ("Wed, Nov 4", or "Set date"),
   * for the program editor's day header. Clearing is inside the calendar.
   */
  variant?: "field" | "inline";
  /** Inline only: the date is missing where it's needed (amber "Set date"). */
  needed?: boolean;
}

/**
 * Prominent training-date control for the workout builder. Replaces the
 * tiny numeric YYYY-MM-DD input that used to sit beside the Focus field.
 *
 * - Minimum 44px tap target (48px on default sizing).
 * - Full readable date + weekday.
 * - Popover calendar for picking.
 * - Clear "Unscheduled" state with a Set date affordance.
 * - Optional Clear button when scheduling rules allow removal.
 */
export function DayDateButton({ value, onChange, disabled, allowClear = true, compact, variant = "field", needed }: Props) {
  const [open, setOpen] = useState(false);
  const parts = formatTrainingDate(value ?? null);
  const selected = value ? parseLocalDate(value) ?? undefined : undefined;

  if (variant === "inline") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            data-day-date
            aria-label={selected ? `Training date ${format(selected, "EEEE, MMMM d")}. Change it` : "Set a training date"}
            className={cn(
              "-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-xs transition-colors hover:bg-muted disabled:opacity-60",
              selected ? "text-foreground/80" : needed ? "font-medium text-warning" : "text-muted-foreground",
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {selected ? format(selected, "EEE, MMM d") : "Set date"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (!d) return;
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }}
            initialFocus
            className="pointer-events-auto p-3"
          />
          {allowClear && selected && (
            <div className="border-t border-border p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-full text-muted-foreground"
                onClick={() => { onChange(null); setOpen(false); }}
              >
                <X className="mr-1.5 h-4 w-4" /> Clear date
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn("inline-flex items-stretch gap-1", compact ? "" : "")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-auto min-h-[48px] justify-start gap-3 px-3 py-2 text-left",
              compact && "min-h-[44px] py-1.5",
              !parts && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-80" />
            {parts ? (
              <span className="flex flex-col leading-tight">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Training date
                </span>
                <span className="text-sm font-semibold">
                  {parts.weekday}, {parts.full}
                </span>
              </span>
            ) : (
              <span className="flex flex-col leading-tight">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Training date
                </span>
                <span className="text-sm font-semibold">Unscheduled — set date</span>
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (!d) return;
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      {allowClear && parts && !disabled && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-9 text-muted-foreground hover:text-destructive"
          onClick={() => onChange(null)}
          title="Clear scheduled date"
          aria-label="Clear scheduled date"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}