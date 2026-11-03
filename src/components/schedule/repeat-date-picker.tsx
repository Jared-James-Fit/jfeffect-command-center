import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The dates a weekly repeat lands on, each one a tap to book or skip, with
 * Select all / Clear: the coach picks exactly which of them to book (a week
 * away, a holiday) without changing the pattern. A date that clashes with the
 * calendar is outlined amber.
 */
export function RepeatDatePicker({ dates, skipped, clashing, onChange }: {
  dates: string[];
  skipped: string[];
  clashing: string[];
  onChange: (skipped: string[]) => void;
}) {
  const skip = new Set(skipped.filter((d) => dates.includes(d)));
  const clash = new Set(clashing);
  const picked = dates.length - skip.size;
  const toggle = (d: string) => {
    const next = new Set(skip);
    if (next.has(d)) next.delete(d); else next.add(d);
    onChange([...next]);
  };
  if (!dates.length) {
    return <p className="text-xs text-muted-foreground">Pick a day of the week to see the dates.</p>;
  }
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/60 p-2.5" data-repeat-dates>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">
          Booking {picked} of {dates.length} date{dates.length === 1 ? "" : "s"}
        </span>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={skip.size === 0} onClick={() => onChange([])}>
            Select all
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={picked === 0} onClick={() => onChange([...dates])}>
            Clear
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dates to book">
        {dates.map((d) => {
          const on = !skip.has(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(d)}
              className={[
                "inline-flex min-h-9 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
                !on ? "border-border text-muted-foreground line-through"
                  : clash.has(d) ? "border-amber-500 bg-amber-500/15 text-foreground"
                  : "border-primary bg-primary/15 text-foreground",
              ].join(" ")}
            >
              {on && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
              {new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">Tap a date to skip it or put it back.</p>
    </div>
  );
}
