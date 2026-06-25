import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fetchMediaTasks, PRIORITY_LABELS } from "@/lib/media-tasks";
import { cn } from "@/lib/utils";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WorkCalendarView() {
  const { data: tasks = [] } = useQuery({ queryKey: ["media-tasks"], queryFn: () => fetchMediaTasks() });
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { date: Date | null; key: string }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ date: null, key: `pad-${i}` });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), key: `d-${d}` });
    while (cells.length % 7 !== 0) cells.push({ date: null, key: `pad-end-${cells.length}` });
    return cells;
  }, [cursor]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, typeof tasks>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const key = t.due_at.slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return m;
  }, [tasks]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Card className="border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">{monthLabel}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-border bg-border">
        {DOW.map((d) => (
          <div key={d} className="bg-muted/40 p-2 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{d}</div>
        ))}
        {grid.map((c) => {
          if (!c.date) return <div key={c.key} className="min-h-20 bg-card/30" />;
          const key = c.date.toISOString().slice(0, 10);
          const items = tasksByDay.get(key) ?? [];
          const today = key === new Date().toISOString().slice(0, 10);
          return (
            <div key={c.key} className={cn("min-h-20 bg-card p-1.5", today && "ring-1 ring-primary")}>
              <div className={cn("mb-1 text-[10px] font-semibold", today ? "text-primary" : "text-muted-foreground")}>{c.date.getDate()}</div>
              <ul className="space-y-0.5">
                {items.slice(0, 3).map((t) => {
                  const pri = PRIORITY_LABELS.find((p) => p.value === t.priority_label);
                  return (
                    <li key={t.id} className="truncate rounded px-1 py-0.5 text-[10px]" style={pri ? { backgroundColor: `${pri.color}22`, color: pri.color } : { backgroundColor: "hsl(var(--muted))" }}>
                      {t.title}
                    </li>
                  );
                })}
                {items.length > 3 && <li className="text-[9px] text-muted-foreground">+{items.length - 3} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}