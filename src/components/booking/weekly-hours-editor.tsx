import { Copy, Plus, X } from "lucide-react";
import { HOURS_PRESETS, hmToMin, minToHm, type HoursWindow } from "@/lib/booking-slots";
import { cn } from "@/lib/utils";

const DAYS: Array<{ dow: number; short: string }> = [
  { dow: 1, short: "Mon" },
  { dow: 2, short: "Tue" },
  { dow: 3, short: "Wed" },
  { dow: 4, short: "Thu" },
  { dow: 5, short: "Fri" },
  { dow: 6, short: "Sat" },
  { dow: 0, short: "Sun" },
];

/** A new window after the day's last one (or 9–5 on an empty day). */
function nextWindow(day: HoursWindow[], dow: number): HoursWindow {
  if (!day.length) return { day_of_week: dow, start_time: "09:00", end_time: "17:00" };
  const lastEnd = Math.max(...day.map((w) => hmToMin(w.end_time)));
  const start = Math.min(lastEnd + 60, 21 * 60);
  return {
    day_of_week: dow,
    start_time: minToHm(start),
    end_time: minToHm(Math.min(start + 120, 23 * 60 + 45)),
  };
}

const timeInput = "h-10 w-[5.4rem] rounded-md border bg-background px-1.5 text-sm tabular-nums";

/**
 * Weekly hours: tap a day on or off, give it one or more windows
 * (6–9 AM and 4–8 PM), copy a day to the rest of the week. Presets for the
 * usual patterns. Fits a 360px phone.
 */
export function WeeklyHoursEditor({
  value,
  onChange,
}: {
  value: HoursWindow[];
  onChange: (v: HoursWindow[]) => void;
}) {
  const byDay = (dow: number) => value.filter((w) => w.day_of_week === dow);
  const replaceDay = (dow: number, windows: HoursWindow[]) =>
    onChange(
      [...value.filter((w) => w.day_of_week !== dow), ...windows].sort(
        (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
      ),
    );

  const toggle = (dow: number) => replaceDay(dow, byDay(dow).length ? [] : [nextWindow([], dow)]);
  const update = (dow: number, idx: number, patch: Partial<HoursWindow>) =>
    replaceDay(
      dow,
      byDay(dow).map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  const remove = (dow: number, idx: number) =>
    replaceDay(
      dow,
      byDay(dow).filter((_, i) => i !== idx),
    );
  const add = (dow: number) => replaceDay(dow, [...byDay(dow), nextWindow(byDay(dow), dow)]);
  const weekend = (dow: number) => dow === 0 || dow === 6;
  const copyAcross = (dow: number) => {
    const src = byDay(dow);
    const targets = weekend(dow) ? [0, 6] : [1, 2, 3, 4, 5];
    onChange([
      ...value.filter((w) => !targets.includes(w.day_of_week)),
      ...targets.flatMap((d) => src.map((w) => ({ ...w, day_of_week: d }))),
    ]);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {HOURS_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.hours)}
            className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full px-2 py-1.5 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="divide-y divide-border rounded-lg border border-border">
        {DAYS.map(({ dow, short }) => {
          const windows = byDay(dow);
          const on = windows.length > 0;
          return (
            <div key={dow} className="flex items-start gap-2 px-2 py-2">
              <button
                type="button"
                onClick={() => toggle(dow)}
                aria-pressed={on}
                aria-label={
                  on
                    ? `${short}: available, tap to turn off`
                    : `${short}: unavailable, tap to turn on`
                }
                className={cn(
                  "h-10 w-11 shrink-0 rounded-md text-[11px] font-black uppercase tracking-wider transition",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/50 text-muted-foreground",
                )}
              >
                {short}
              </button>
              <div className="min-w-0 flex-1 space-y-1.5">
                {!on ? (
                  <button
                    type="button"
                    onClick={() => toggle(dow)}
                    className="flex h-10 items-center text-xs text-muted-foreground"
                  >
                    Unavailable · tap to add hours
                  </button>
                ) : (
                  <>
                    {windows.map((w, i) => {
                      const bad = hmToMin(w.end_time) <= hmToMin(w.start_time);
                      return (
                        <div key={i} className="flex items-center gap-1">
                          <input
                            type="time"
                            step={900}
                            value={w.start_time}
                            onChange={(e) =>
                              e.target.value &&
                              update(dow, i, { start_time: e.target.value.slice(0, 5) })
                            }
                            aria-label={`${short} from`}
                            className={cn(timeInput, "border-input")}
                          />
                          <span className="px-0.5 text-xs text-muted-foreground">–</span>
                          <input
                            type="time"
                            step={900}
                            value={w.end_time}
                            onChange={(e) =>
                              e.target.value &&
                              update(dow, i, { end_time: e.target.value.slice(0, 5) })
                            }
                            aria-label={`${short} until`}
                            aria-invalid={bad}
                            className={cn(timeInput, bad ? "border-destructive" : "border-input")}
                          />
                          <button
                            type="button"
                            onClick={() => remove(dow, i)}
                            aria-label={`Remove ${short} hours`}
                            className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={() => add(dow)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
                      >
                        <Plus className="h-3 w-3" /> Add hours
                      </button>
                      <button
                        type="button"
                        onClick={() => copyAcross(dow)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />{" "}
                        {weekend(dow) ? "Same on the weekend" : "Same Mon–Fri"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
