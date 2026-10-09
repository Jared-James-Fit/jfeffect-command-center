import { cn } from "@/lib/utils";

/**
 * The 7-day strip shared by every Home: coach dashboard, client Home, member
 * Home. One tap per day, a dot per item (max 3), today labelled and the picked
 * day highlighted. Seven equal columns, so it fits a 360px phone without
 * scrolling.
 */
export function WeekStrip({
  days,
  today,
  selected,
  onSelect,
  count,
  dotClass = "bg-violet-400",
  extraCount,
  extraDotClass = "bg-sky-400",
}: {
  /** yyyy-mm-dd, in order. */
  days: string[];
  today: string;
  selected: string;
  onSelect: (day: string) => void;
  count: (day: string) => number;
  dotClass?: string;
  /** Second kind of dot after the main ones (e.g. Google events), same 3-dot cap. */
  extraCount?: (day: string) => number;
  extraDotClass?: string;
}) {
  return (
    <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Pick a day">
      {days.map((d) => {
        const date = new Date(`${d}T00:00:00`);
        const main = count(d);
        const extra = extraCount?.(d) ?? 0;
        const n = main + extra;
        const dots = Array.from({ length: Math.min(n, 3) }, (_, i) => (i < main ? dotClass : extraDotClass));
        const isSelected = d === selected;
        const label = d === today ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${n ? `, ${n} scheduled` : ""}`}
            onClick={() => onSelect(d)}
            className={cn(
              "flex min-h-[54px] min-w-0 flex-col items-center justify-center rounded-lg border text-center transition active:scale-[0.97]",
              isSelected ? "border-primary bg-primary/15" : "border-transparent bg-secondary/30 hover:bg-secondary/60",
            )}
          >
            <span className={cn("max-w-full truncate px-0.5 text-[10px] font-semibold uppercase", isSelected ? "text-primary" : "text-muted-foreground")}>
              {label}
            </span>
            <span className={cn("text-sm font-black tabular-nums", isSelected && "text-primary")}>{date.getDate()}</span>
            <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
              {dots.map((cls, i) => (
                <span key={i} className={cn("h-1 w-1 rounded-full", isSelected ? "bg-primary" : cls)} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Today plus the next six days, as yyyy-mm-dd in the device's zone. */
export function nextSevenDays(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}
