import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAppointments } from "@/lib/appointments.functions";
import { listGoogleEventsRange } from "@/lib/google-cal.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Video, Calendar as GCalIcon } from "lucide-react";

function startOfWeek(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export function AppointmentCalendarGrid({ onPickDate }: { onPickDate?: (d: Date) => void } = {}) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [showGoogle, setShowGoogle] = useState(true);
  const list = useServerFn(listAppointments);
  const listGcal = useServerFn(listGoogleEventsRange);
  const { data: rows = [] } = useQuery({
    queryKey: ["appointments", "calendar"],
    queryFn: () => list({ data: { range: "all" } as any }),
  });

  const { days, byDay, rangeStart, rangeEnd } = useMemo(() => {
    const start = mode === "week" ? startOfWeek(anchor) : startOfMonth(anchor);
    const count = mode === "week" ? 7 : (() => {
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      // pad to weeks
      const gridStart = startOfWeek(start);
      const lastDay = new Date(anchor.getFullYear(), anchor.getMonth(), end);
      const gridEnd = addDays(startOfWeek(lastDay), 6);
      return Math.round((gridEnd.getTime() - gridStart.getTime()) / (24 * 3600 * 1000)) + 1;
    })();
    const realStart = mode === "week" ? start : startOfWeek(start);
    const ds: Date[] = [];
    for (let i = 0; i < count; i++) ds.push(addDays(realStart, i));
    const map = new Map<string, any[]>();
    for (const a of rows as any[]) {
      const k = new Date(a.starts_at).toDateString();
      const arr = map.get(k) ?? [];
      arr.push(a);
      map.set(k, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    const rangeStart = ds[0];
    const rangeEnd = addDays(ds[ds.length - 1], 1);
    return { days: ds, byDay: map, rangeStart, rangeEnd };
  }, [rows, mode, anchor]);

  const { data: gcalEvents = [] } = useQuery({
    queryKey: ["gcal-events", rangeStart?.toISOString(), rangeEnd?.toISOString()],
    enabled: showGoogle && !!rangeStart && !!rangeEnd,
    queryFn: () => listGcal({ data: { timeMin: rangeStart!.toISOString(), timeMax: rangeEnd!.toISOString() } }),
    staleTime: 60_000,
  });

  const gcalByDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of (gcalEvents as any[]) ?? []) {
      const k = new Date(e.start).toDateString();
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => +new Date(a.start) - +new Date(b.start));
    return m;
  }, [gcalEvents]);

  const title = mode === "week"
    ? `${days[0]?.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[days.length - 1]?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function shift(dir: 1 | -1) {
    if (mode === "week") setAnchor(addDays(anchor, 7 * dir));
    else { const x = new Date(anchor); x.setMonth(x.getMonth() + dir); setAnchor(x); }
  }

  return (
    <Card className="border-border bg-card p-3 md:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => shift(-1)} className="h-8 w-8"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())} className="h-8">Today</Button>
          <Button size="icon" variant="ghost" onClick={() => shift(1)} className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
          <span className="ml-2 text-sm font-semibold">{title}</span>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={showGoogle ? "default" : "outline"}
            onClick={() => setShowGoogle((v) => !v)}
            className="h-8"
            title="Toggle Google Calendar overlay"
          >
            <GCalIcon className="mr-1 h-3.5 w-3.5" /> Google
          </Button>
          <Button size="sm" variant={mode === "week" ? "default" : "outline"} onClick={() => setMode("week")} className="h-8">Week</Button>
          <Button size="sm" variant={mode === "month" ? "default" : "outline"} onClick={() => setMode("month")} className="h-8">Month</Button>
        </div>
      </div>
      <div className={`grid gap-1 ${mode === "week" ? "grid-cols-1 md:grid-cols-7" : "grid-cols-7"}`}>
        {days.map((d) => {
          const items = byDay.get(d.toDateString()) ?? [];
          const gItems = showGoogle ? (gcalByDay.get(d.toDateString()) ?? []) : [];
          const isToday = sameDay(d, new Date());
          const otherMonth = mode === "month" && d.getMonth() !== anchor.getMonth();
          return (
            <div
              key={d.toISOString()}
              role={onPickDate ? "button" : undefined}
              tabIndex={onPickDate ? 0 : undefined}
              onClick={onPickDate ? () => onPickDate(d) : undefined}
              onKeyDown={onPickDate ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPickDate(d); } } : undefined}
              className={`group relative rounded-md border p-1.5 min-h-[80px] md:min-h-[110px] flex flex-col gap-1 ${isToday ? "border-primary/50 bg-primary/5" : "border-border bg-background"} ${otherMonth ? "opacity-50" : ""} ${onPickDate ? "cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors" : ""}`}
            >
              {onPickDate && (
                <span className="pointer-events-none absolute right-1 top-1 hidden text-[10px] font-bold uppercase tracking-wider text-primary group-hover:inline">+ Book</span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className={`text-xs font-bold ${isToday ? "text-primary" : ""}`}>{d.getDate()}</span>
              </div>
              <div className="flex flex-col gap-1">
                {items.length === 0 && gItems.length === 0 && mode === "week" && (
                  <div className="text-[10px] text-muted-foreground">—</div>
                )}
                {items.slice(0, mode === "month" ? 3 : 8).map((a: any) => {
                  const time = new Date(a.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  const tone = a.status === "Cancelled" ? "bg-muted/40 text-muted-foreground line-through"
                    : a.status === "Completed" ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-primary/10 text-primary";
                  return (
                    <div key={a.id} className={`rounded px-1.5 py-1 text-[10px] leading-tight ${tone}`} title={a.title}>
                      <div className="font-semibold truncate flex items-center gap-1">
                        {a.meet_link && <Video className="h-2.5 w-2.5 shrink-0" />}
                        <span className="truncate">{time}</span>
                      </div>
                      <div className="truncate">{a.title}</div>
                    </div>
                  );
                })}
                {items.length > (mode === "month" ? 3 : 8) && (
                  <Badge variant="outline" className="text-[9px]">+{items.length - (mode === "month" ? 3 : 8)} more</Badge>
                )}
                {gItems.slice(0, mode === "month" ? 2 : 6).map((e: any) => {
                  const time = e.allDay
                    ? "All day"
                    : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  return (
                    <a
                      key={`g-${e.id}`}
                      href={e.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded px-1.5 py-1 text-[10px] leading-tight bg-sky-500/10 text-sky-300 border border-sky-500/20 hover:bg-sky-500/20"
                      title={`Google Calendar: ${e.summary}`}
                    >
                      <div className="font-semibold truncate flex items-center gap-1">
                        <GCalIcon className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{time}</span>
                      </div>
                      <div className="truncate opacity-90">{e.summary}</div>
                    </a>
                  );
                })}
                {gItems.length > (mode === "month" ? 2 : 6) && (
                  <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-300">+{gItems.length - (mode === "month" ? 2 : 6)} google</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}