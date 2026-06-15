import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, Calendar as CalIcon, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_META, ctaLabel, type CalendarItem, type CalendarKind } from "@/lib/calendar-sources";
import { CalendarEmptyState } from "./empty-state";

type ViewMode = "month" | "week" | "day" | "upcoming";

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; } // Sunday-start
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function fmtTime(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}
function fmtFullDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

const WEEKDAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function CalendarBoard({
  items,
  isLoading,
  showClientName = false,
  toolbar,
  emptyHint,
}: {
  items: CalendarItem[];
  isLoading?: boolean;
  showClientName?: boolean;
  toolbar?: React.ReactNode;
  emptyHint?: string;
}) {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  const isEmpty = !isLoading && items.length === 0;

  const itemsByDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      if (!m.has(it.date)) m.set(it.date, []);
      m.get(it.date)!.push(it);
    }
    return m;
  }, [items]);

  function shift(direction: -1 | 1) {
    if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() + direction, 1));
    else if (view === "week") setCursor((c) => addDays(c, 7 * direction));
    else if (view === "day") setCursor((c) => addDays(c, direction));
  }

  const headerLabel = useMemo(() => {
    if (view === "month") return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (view === "week") {
      const ws = startOfWeek(cursor);
      const we = addDays(ws, 6);
      return `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (view === "day") return fmtFullDate(cursor);
    return "Upcoming";
  }, [view, cursor]);

  return (
    <div className="space-y-3">
      <Card className="border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="month" className="text-xs">Month</TabsTrigger>
              <TabsTrigger value="week" className="text-xs">Week</TabsTrigger>
              <TabsTrigger value="day" className="text-xs">Day</TabsTrigger>
              <TabsTrigger value="upcoming" className="text-xs">Upcoming</TabsTrigger>
            </TabsList>
          </Tabs>

          {view !== "upcoming" && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shift(-1)} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCursor(startOfDay(new Date()))}>
                Today
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shift(1)} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-semibold">{headerLabel}</span>
          </div>
        </div>
        {toolbar && <div className="mt-3 border-t border-border pt-3">{toolbar}</div>}
        <LegendRow items={items} />
      </Card>

      {isEmpty ? (
        <CalendarEmptyState
          title={emptyHint ? "No calendar items yet" : "No calendar items"}
          hint={emptyHint}
        />
      ) : (
        <>
      {view === "month" && (
        <MonthGrid cursor={cursor} itemsByDate={itemsByDate} onSelectItem={setSelected} onSelectDay={(d) => { setCursor(d); setView("day"); }} />
      )}
      {view === "week" && (
        <WeekGrid cursor={cursor} itemsByDate={itemsByDate} onSelectItem={setSelected} />
      )}
      {view === "day" && (
        <DayList date={cursor} items={itemsByDate.get(isoDate(cursor)) ?? []} onSelectItem={setSelected} showClientName={showClientName} emptyHint={emptyHint} />
      )}
      {view === "upcoming" && (
        <UpcomingList items={items} onSelectItem={setSelected} showClientName={showClientName} isLoading={isLoading} emptyHint={emptyHint} />
      )}
        </>
      )}

      <EventDetailSheet item={selected} onClose={() => setSelected(null)} showClientName={showClientName} />
    </div>
  );
}

function LegendRow({ items }: { items: CalendarItem[] }) {
  const kinds = useMemo(() => {
    const s = new Set<CalendarKind>();
    for (const i of items) s.add(i.kind);
    return Array.from(s);
  }, [items]);
  if (kinds.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", KIND_META[k].dot)} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}

function MonthGrid({
  cursor, itemsByDate, onSelectItem, onSelectDay,
}: {
  cursor: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onSelectItem: (i: CalendarItem) => void;
  onSelectDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = endOfMonth(cursor);
  const totalCells = Math.ceil((monthEnd.getDate() + monthStart.getDay()) / 7) * 7;
  const today = isoDate(new Date());

  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) cells.push(addDays(gridStart, i));

  return (
    <Card className="border-border bg-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-background/40">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, idx) => {
          const dIso = isoDate(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = dIso === today;
          const dayItems = itemsByDate.get(dIso) ?? [];
          const visible = dayItems.slice(0, 3);
          const extra = dayItems.length - visible.length;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectDay(d)}
              className={cn(
                "min-h-[72px] sm:min-h-[96px] border-b border-r border-border p-1 text-left align-top transition-colors",
                !inMonth && "bg-background/30 text-muted-foreground/60",
                isToday && "bg-primary/5",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                  isToday ? "bg-primary text-primary-foreground" : "text-foreground/80",
                )}>
                  {d.getDate()}
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                {visible.map((it) => (
                  <div
                    key={it.id}
                    onClick={(e) => { e.stopPropagation(); onSelectItem(it); }}
                    className={cn(
                      "truncate rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium border",
                      KIND_META[it.kind].chip,
                    )}
                  >
                    {it.title}
                  </div>
                ))}
                {extra > 0 && (
                  <div className="text-[10px] text-muted-foreground">+{extra} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WeekGrid({
  cursor, itemsByDate, onSelectItem,
}: {
  cursor: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onSelectItem: (i: CalendarItem) => void;
}) {
  const ws = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const today = isoDate(new Date());
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((d) => {
        const dIso = isoDate(d);
        const dayItems = itemsByDate.get(dIso) ?? [];
        const isToday = dIso === today;
        return (
          <Card key={dIso} className={cn("border-border bg-card p-2", isToday && "ring-1 ring-primary/60")}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{WEEKDAY_LABELS[d.getDay()]}</span>
              <span className={cn("text-sm font-bold", isToday && "text-primary")}>{d.getDate()}</span>
            </div>
            {dayItems.length === 0 ? (
              <div className="rounded border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">—</div>
            ) : (
              <ul className="space-y-1">
                {dayItems.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onSelectItem(it)}
                      className={cn("w-full truncate rounded px-2 py-1 text-left text-[11px] border", KIND_META[it.kind].chip)}
                    >
                      {fmtTime(it.startsAt)} {fmtTime(it.startsAt) ? "· " : ""}{it.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function DayList({
  date, items, onSelectItem, showClientName, emptyHint,
}: {
  date: Date;
  items: CalendarItem[];
  onSelectItem: (i: CalendarItem) => void;
  showClientName?: boolean;
  emptyHint?: string;
}) {
  if (items.length === 0) {
    return (
      <Card className="border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        <CalIcon className="mx-auto mb-2 h-5 w-5" />
        Nothing scheduled for {date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}.
        {emptyHint && <div className="mt-1 text-xs">{emptyHint}</div>}
      </Card>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((it) => <ItemRow key={it.id} item={it} onClick={() => onSelectItem(it)} showClientName={showClientName} />)}
    </ul>
  );
}

function UpcomingList({
  items, onSelectItem, showClientName, isLoading, emptyHint,
}: {
  items: CalendarItem[];
  onSelectItem: (i: CalendarItem) => void;
  showClientName?: boolean;
  isLoading?: boolean;
  emptyHint?: string;
}) {
  const today = isoDate(new Date());
  const upcoming = items.filter((i) => i.date >= today).slice(0, 50);
  const grouped = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of upcoming) {
      if (!m.has(it.date)) m.set(it.date, []);
      m.get(it.date)!.push(it);
    }
    return Array.from(m.entries());
  }, [upcoming]);

  if (isLoading) return <Card className="border-border bg-card p-6 text-sm text-muted-foreground">Loading…</Card>;
  if (grouped.length === 0) {
    return (
      <Card className="border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        <CalIcon className="mx-auto mb-2 h-5 w-5" /> No upcoming items.
        {emptyHint && <div className="mt-1 text-xs">{emptyHint}</div>}
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {grouped.map(([d, list]) => {
        const dateObj = new Date(d + "T00:00:00");
        return (
          <section key={d} className="space-y-1.5">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {dateObj.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              <span className="ml-1 text-muted-foreground/60">({list.length})</span>
            </h4>
            <ul className="space-y-1.5">
              {list.map((it) => <ItemRow key={it.id} item={it} onClick={() => onSelectItem(it)} showClientName={showClientName} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ItemRow({ item, onClick, showClientName }: { item: CalendarItem; onClick: () => void; showClientName?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px]", KIND_META[item.kind].chip)}>{KIND_META[item.kind].label}</Badge>
          {item.status && <Badge variant="outline" className="text-[10px]">{item.status}</Badge>}
          {showClientName && item.clientName && <span className="text-[11px] text-muted-foreground">{item.clientName}</span>}
          {item.startsAt && <span className="ml-auto text-xs text-muted-foreground">{fmtTime(item.startsAt)}</span>}
        </div>
        <div className="mt-1 truncate text-sm font-semibold">{item.title}</div>
        {item.subtitle && <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</div>}
      </button>
    </li>
  );
}

function EventDetailSheet({
  item, onClose, showClientName,
}: {
  item: CalendarItem | null;
  onClose: () => void;
  showClientName?: boolean;
}) {
  const open = !!item;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {item && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-[10px]", KIND_META[item.kind].chip)}>{KIND_META[item.kind].label}</Badge>
                {item.status && <Badge variant="outline" className="text-[10px]">{item.status}</Badge>}
                {item.importance && <Badge variant="outline" className="text-[10px]">{item.importance}</Badge>}
              </div>
              <SheetTitle className="text-left">{item.title}</SheetTitle>
              <SheetDescription className="text-left">
                {new Date(item.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                {item.startsAt && ` · ${fmtTime(item.startsAt)}`}
                {item.endsAt && ` – ${fmtTime(item.endsAt)}`}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-3 text-sm">
              {item.subtitle && <div className="text-muted-foreground">{item.subtitle}</div>}
              {showClientName && item.clientName && (
                <div><span className="text-muted-foreground">Client:</span> <span className="font-medium">{item.clientName}</span></div>
              )}
              {item.raw?.description && <p className="whitespace-pre-wrap text-foreground/80">{item.raw.description}</p>}
              {item.raw?.client_facing_notes && <p className="whitespace-pre-wrap text-foreground/80">{item.raw.client_facing_notes}</p>}
              {item.raw?.notes && item.raw?.client_visible_notes !== false && <p className="whitespace-pre-wrap text-foreground/80">{item.raw.notes}</p>}
              {item.raw?.meet_link && (
                <a href={item.raw.meet_link} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="w-full">Join call <ExternalLink className="ml-2 h-3.5 w-3.5" /></Button>
                </a>
              )}
              {item.raw?.external_url && !item.raw?.meet_link && (
                <a href={item.raw.external_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="w-full">
                    {item.kind === "google_event" ? "Open in Google Calendar" : "Open"} <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
              {item.href && (
                <Link to={item.href.to as any} params={item.href.params as any} onClick={onClose}>
                  <Button size="sm" className="w-full bg-gradient-primary font-bold uppercase">{ctaLabel(item)}</Button>
                </Link>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}