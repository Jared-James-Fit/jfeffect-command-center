/**
 * DateField — the canonical JF Effect date selector.
 *
 * Tapping the field opens a real calendar on desktop, tablet and mobile/PWA.
 * Works INSIDE scrollable modals: the popover is `modal`, so Radix does not
 * block its pointer events behind the dialog's focus trap (the reason older
 * in-dialog pickers "opened" but could not be clicked), and it sits above the
 * sale modal's z-[60] layer.
 *
 * Value in/out is always a `yyyy-MM-dd` calendar date — never a UTC instant.
 */
import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCalendarDate, parseCalendarDate, toCalendarDate } from "@/lib/calendar-date";

export type DateFieldProps = {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Earliest selectable calendar date (`yyyy-MM-dd`). */
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
};

export function DateField({
  value,
  onChange,
  placeholder = "Choose a date",
  min,
  max,
  disabled,
  id,
  className,
  ...rest
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseCalendarDate(value);
  const minDate = parseCalendarDate(min);
  const maxDate = parseCalendarDate(max);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={rest["aria-label"] ?? "Choose a date"}
          data-testid="date-field-trigger"
          className={cn(
            "min-h-[44px] w-full justify-start gap-2 text-left font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{selected ? formatCalendarDate(value) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        // Above the sale modal (z-[60]); never clipped by the scrolling body.
        className="pointer-events-auto z-[80] w-auto max-w-[min(20rem,calc(100vw-1.5rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? minDate ?? undefined}
          captionLayout="dropdown"
          startMonth={new Date(new Date().getFullYear() - 2, 0)}
          endMonth={new Date(new Date().getFullYear() + 5, 11)}
          disabled={
            minDate || maxDate
              ? [
                  ...(minDate ? [{ before: minDate }] : []),
                  ...(maxDate ? [{ after: maxDate }] : []),
                ]
              : undefined
          }
          onSelect={(date) => {
            if (!date) return;
            onChange(toCalendarDate(date));
            setOpen(false);
          }}
          className="pointer-events-auto p-3"
        />
      </PopoverContent>
    </Popover>
  );
}
