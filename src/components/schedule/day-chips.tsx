import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** yyyy-mm-dd on this device, `offsetDays` from today. */
export function localISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Thu, Oct 30". */
export function summaryDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "6 PM", "6:30 PM" from "18:00" / "18:30". */
export function summaryTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

/** "Tmrw", "Wed 14": the next days as one-tap chips. */
function nextDays(count: number): Array<{ iso: string; top: string; day: string }> {
  return Array.from({ length: count }, (_, i) => {
    const iso = localISO(i);
    const d = new Date(`${iso}T00:00:00`);
    return {
      iso,
      top: i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString(undefined, { weekday: "short" }),
      day: String(d.getDate()),
    };
  });
}

/**
 * Pick a day: the next two weeks as chips that scroll sideways, then "Other
 * date" (the phone's date picker) for anything further out. Shared by
 * "Request a session" and "Change time".
 */
export function DayChips({ value, onChange, count = 14, label = "Day" }: {
  value: string;
  onChange: (iso: string) => void;
  count?: number;
  label?: string;
}) {
  const days = useMemo(() => nextDays(count), [count]);
  const inChips = days.some((d) => d.iso === value);
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label={label}>
      {days.map((d) => {
        const on = value === d.iso;
        return (
          <button key={d.iso} type="button" role="radio" aria-checked={on} onClick={() => onChange(d.iso)}
            className={cn("flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg border transition active:scale-[0.97]",
              on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
            <span className={cn("text-[10px] font-bold uppercase", on ? "text-primary-foreground/85" : "text-muted-foreground")}>{d.top}</span>
            <span className="text-base font-black tabular-nums">{d.day}</span>
          </button>
        );
      })}
      <label className={cn("relative flex h-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border px-3 text-xs font-semibold",
        !inChips && value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>
        {inChips || !value ? "Other date" : summaryDate(value)}
        <input type="date" value={value} min={localISO(0)} onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Pick another date" className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}
