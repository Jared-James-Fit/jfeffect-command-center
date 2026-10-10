import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The week strip shared by every Home: coach dashboard, client Home, member Home.
 *
 * Same layout and behaviour as the Workouts calendar: the Monday–Sunday week the
 * picked day is in, ‹ › to move a week, month label in the middle, the picked day
 * filled, today outlined. Home stays compact (dots per item, max 3); Workouts is
 * the full calendar. Seven equal columns, so it fits a 360px phone.
 */
export function WeekStrip({
  today,
  selected,
  onSelect,
  count,
  dotClass = "bg-violet-400",
  extraCount,
  extraDotClass = "bg-sky-400",
}: {
  today: string;
  /** yyyy-mm-dd: the picked day; its Mon–Sun week is shown. */
  selected: string;
  onSelect: (day: string) => void;
  count: (day: string) => number;
  dotClass?: string;
  /** Second kind of dot after the main ones (e.g. Google events), same 3-dot cap. */
  extraCount?: (day: string) => number;
  extraDotClass?: string;
}) {
  const days = weekDays(selected);
  const first = new Date(`${days[0]}T00:00:00`);
  const last = new Date(`${days[6]}T00:00:00`);
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  const monthLabel = sameMonth
    ? first.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : `${first.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${last.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <button type="button" onClick={() => onSelect(addDaysIso(selected, -7))} aria-label="Previous week" className="rounded p-1 hover:bg-secondary">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{monthLabel}</span>
          {selected !== today && (
            <button
              type="button"
              onClick={() => onSelect(today)}
              className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/10"
            >
              Today
            </button>
          )}
        </div>
        <button type="button" onClick={() => onSelect(addDaysIso(selected, 7))} aria-label="Next week" className="rounded p-1 hover:bg-secondary">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Pick a day">
        {days.map((d) => {
          const date = new Date(`${d}T00:00:00`);
          const main = count(d);
          const extra = extraCount?.(d) ?? 0;
          const n = main + extra;
          const dots = Array.from({ length: Math.min(n, 3) }, (_, i) => (i < main ? dotClass : extraDotClass));
          const isSelected = d === selected;
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${isToday ? " (today)" : ""}${n ? `, ${n} scheduled` : ""}`}
              onClick={() => onSelect(d)}
              className={cn(
                "flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-center transition active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "border border-primary/60 bg-primary/10"
                    : "hover:bg-secondary",
              )}
            >
              <span className={cn("text-[10px] font-bold uppercase tracking-wider", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {date.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span className={cn("text-sm font-black tabular-nums", !isSelected && isToday && "text-primary")}>{date.getDate()}</span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {dots.map((cls, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full", isSelected ? "bg-primary-foreground" : cls)} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday–Sunday week containing `day`, as yyyy-mm-dd (same week as the Workouts calendar). */
export function weekDays(day: string): string[] {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const monday = addDaysIso(day, -((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
}
