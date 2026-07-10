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
export function DayDateButton({ value, onChange, disabled, allowClear = true, compact }: Props) {
  const [open, setOpen] = useState(false);
  const parts = formatTrainingDate(value ?? null);
  const selected = value ? parseLocalDate(value) ?? undefined : undefined;

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