/**
 * Reusable month-grid calendar that overlays existing scheduled days with
 * an incoming-placements preview. Used by the planner Calendar step and
 * the assignment history panel.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CalendarExistingDay {
  id: string;
  date: string;            // ISO yyyy-mm-dd
  title: string | null;
  completed: boolean;
  locked: boolean;
  blockName: string | null;
}

export interface CalendarIncomingDay {
  dayKey: string;
  date: string;            // ISO yyyy-mm-dd
  title: string;
  hasConflict?: boolean;
}

interface Props {
  existing: CalendarExistingDay[];
  incoming: CalendarIncomingDay[];
  initialMonth?: string;       // yyyy-mm
  onDayClick?: (iso: string) => void;
}

function isoFor(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function AssignmentCalendar({ existing, incoming, initialMonth, onDayClick }: Props) {
  const today = new Date();
  const initial = initialMonth ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [cursor, setCursor] = useState<string>(initial);
  const [y, m] = cursor.split("-").map(Number);
  const monthIdx = m - 1;
  const firstWeekday = new Date(Date.UTC(y, monthIdx, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, monthIdx + 1, 0)).getUTCDate();

  const existingByDate = useMemo(() => {
    const map = new Map<string, CalendarExistingDay[]>();
    for (const d of existing) {
      if (!map.has(d.date)) map.set(d.date, []);
      map.get(d.date)!.push(d);
    }
    return map;
  }, [existing]);

  const incomingByDate = useMemo(() => {
    const map = new Map<string, CalendarIncomingDay[]>();
    for (const d of incoming) {
      if (!map.has(d.date)) map.set(d.date, []);
      map.get(d.date)!.push(d);
    }
    return map;
  }, [incoming]);

  const shift = (delta: number) => {
    const date = new Date(Date.UTC(y, monthIdx + delta, 1));
    setCursor(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const jumpTo = (iso: string) => {
    const [yy, mm] = iso.split("-");
    setCursor(`${yy}-${mm}`);
  };
  const lastIncoming = incoming.length ? incoming.map((i) => i.date).sort().slice(-1)[0] : null;

  const cells: Array<{ day?: number; iso?: string }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({});
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, iso: isoFor(y, monthIdx, d) });

  const todayISO = today.toISOString().slice(0, 10);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[120px] text-center text-sm font-semibold">
            {new Date(y, monthIdx).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </div>
          <Button size="icon" variant="ghost" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => jumpTo(todayISO)}>
            <CalendarIcon className="mr-1 h-3 w-3" />Today
          </Button>
          {lastIncoming && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => jumpTo(lastIncoming)}>
              Last placed
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border text-[10px]">
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} className="bg-muted/40 px-1 py-1 text-center font-semibold uppercase">{d}</div>
        ))}
        {cells.map((c, i) => {
          if (!c.iso) return <div key={i} className="bg-background min-h-[58px]" />;
          const ex = existingByDate.get(c.iso) ?? [];
          const inc = incomingByDate.get(c.iso) ?? [];
          const isToday = c.iso === todayISO;
          const hasConflict = ex.length > 0 && inc.length > 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onDayClick?.(c.iso!)}
              className={
                "relative bg-background min-h-[58px] p-1 text-left hover:bg-secondary/40 " +
                (isToday ? "ring-1 ring-primary " : "")
              }
            >
              <div className="text-[10px] font-semibold">{c.day}</div>
              {ex.map((d) => (
                <div
                  key={d.id}
                  className={
                    "mt-0.5 truncate rounded px-1 text-[9px] " +
                    (d.completed
                      ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                      : d.locked
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                        : "bg-secondary/60 text-muted-foreground")
                  }
                  title={`${d.blockName ?? ""} · ${d.title ?? ""}`}
                >
                  {d.title ?? "Workout"}
                </div>
              ))}
              {inc.map((d) => (
                <div
                  key={d.dayKey}
                  className={
                    "mt-0.5 truncate rounded px-1 text-[9px] " +
                    (hasConflict || d.hasConflict
                      ? "bg-rose-500/30 text-rose-700 dark:text-rose-300"
                      : "bg-primary/30 text-primary")
                  }
                  title={d.title}
                >
                  + {d.title}
                </div>
              ))}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-500/60" /> Completed</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-secondary" /> Scheduled</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-primary/40" /> Incoming</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-rose-500/40" /> Conflict</span>
      </div>
    </div>
  );
}