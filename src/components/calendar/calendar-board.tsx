import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Calendar as CalIcon, ExternalLink, MapPin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_FAMILY, KIND_META, ctaLabel, placeLabel, scheduleTitle, type CalendarItem, type CalendarKind, type KindFamily } from "@/lib/calendar-sources";
import { compactTimeRange, compareInstants, durationLabel } from "@/lib/schedule-time";
import { blockLabels, chipParts, itemDetailLines, personName, rowLines } from "@/lib/calendar-labels";
import { useNow } from "@/components/schedule/agenda";
import { CalendarEmptyState } from "./empty-state";
import { TimeGrid, type TimeGridEntry } from "./time-grid";
import { monthChipOrder } from "@/lib/calendar-timeline";

export type ViewMode = "month" | "week" | "day" | "upcoming";
const VIEW_LABEL: Record<ViewMode, string> = { month: "Month", week: "Week", day: "Day", upcoming: "List" };

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
/** Monday-start, like the Workouts calendar and every Home. */
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
/** Days before the 1st in a Monday-first grid. */
/** yyyy-mm-dd → local midnight, or null when it isn't a real date. */
function parseDay(day: string | null | undefined): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
function leadDays(monthStart: Date) { return (monthStart.getDay() + 6) % 7; }
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

const WEEKDAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export type VisibleRange = { from: string; to: string };
const UPCOMING_DAYS = 60;

/** First and last day each view draws (the month view pads to whole weeks). */
export function visibleRange(view: ViewMode, cursor: Date): VisibleRange {
  if (view === "week") {
    const ws = startOfWeek(cursor);
    return { from: isoDate(ws), to: isoDate(addDays(ws, 6)) };
  }
  if (view === "day") return { from: isoDate(cursor), to: isoDate(cursor) };
  if (view === "upcoming") {
    const today = startOfDay(new Date());
    return { from: isoDate(today), to: isoDate(addDays(today, UPCOMING_DAYS)) };
  }
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const totalCells = Math.ceil((endOfMonth(cursor).getDate() + leadDays(monthStart)) / 7) * 7;
  return { from: isoDate(gridStart), to: isoDate(addDays(gridStart, totalCells - 1)) };
}

export function CalendarBoard({
  items,
  isLoading,
  showClientName = false,
  toolbar,
  emptyHint,
  onCreate,
  onItemSelect,
  renderItemActions,
  onRangeChange,
  views = ["month", "week", "day", "upcoming"],
  initialDate,
  initialView,
  view: viewProp,
  onViewChange,
  timeline = false,
  createButton = true,
  canCreateOn,
  slotVerb,
}: {
  /**
   * The coach's calendar, Google's way: Day and Week are timelines (each
   * booking a block at its time, free time empty, a tap on empty time books
   * there), and a month day shows who's booked and opens that day.
   */
  timeline?: boolean;
  /** Which views to offer (first one is the default). */
  views?: ViewMode[];
  /** Controlled view (the page remembers the coach's choice); otherwise the board keeps its own. */
  view?: ViewMode;
  /** Called when they pick a view from the tabs. */
  onViewChange?: (view: ViewMode) => void;
  /** The view to open on, when not the first of `views` (a day tapped elsewhere opens on that day). */
  initialView?: ViewMode;
  /** yyyy-mm-dd to open on (a day tapped on Home); default today. */
  initialDate?: string | null;
  items: CalendarItem[];
  isLoading?: boolean;
  showClientName?: boolean;
  toolbar?: React.ReactNode;
  emptyHint?: string;
  /** Shows "+ Book" on days; called with yyyy-mm-dd (and "HH:MM" from a tapped slot on a timeline). */
  onCreate?: (dateISO: string, time?: string) => void;
  /** The header's "+ Book" (off where the page has its own way to ask, a client's Calendar: a tap on empty time still asks). */
  createButton?: boolean;
  /** Which days a tap on empty time can ask for (default every day). */
  canCreateOn?: (dateISO: string) => boolean;
  /** What a tap on empty time does, for its label (the timeline's "Book at 3 PM"). */
  slotVerb?: string;
  /** Take over the tap on an item (return true to skip the default detail sheet). */
  onItemSelect?: (item: CalendarItem) => boolean | void;
  /** Extra buttons inside the default detail sheet for an item. */
  renderItemActions?: (item: CalendarItem, close: () => void) => React.ReactNode;
  /** The days on screen (yyyy-mm-dd, inclusive), so a source can load just those. */
  onRangeChange?: (range: VisibleRange) => void;
}) {
  const [innerView, setInnerView] = useState<ViewMode>(() => (initialView && views.includes(initialView) ? initialView : views[0] ?? "month"));
  const view: ViewMode = viewProp && views.includes(viewProp) ? viewProp : innerView;
  const setView = (v: ViewMode) => {
    if (!viewProp) setInnerView(v);
    onViewChange?.(v);
  };
  const [cursor, setCursor] = useState<Date>(() => parseDay(initialDate) ?? startOfDay(new Date()));
  // Month view: the tapped day, listed under the grid (today, or the day they came for, until they tap).
  const [picked, setPicked] = useState<Date>(() => parseDay(initialDate) ?? startOfDay(new Date()));

  const range = useMemo(() => visibleRange(view, cursor), [view, cursor]);
  useEffect(() => {
    onRangeChange?.(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);
  const [selected, setSelectedRaw] = useState<CalendarItem | null>(null);
  const setSelected = (it: CalendarItem | null) => {
    if (it && onItemSelect?.(it) === true) return;
    setSelectedRaw(it);
  };

  const isEmpty = !isLoading && items.length === 0;
  const nowMs = useNow();
  // "Today" scrolls the timeline back to now, even when the period didn't change.
  const [jump, setJump] = useState(0);
  const entries = useMemo<TimeGridEntry<CalendarItem>[]>(
    () =>
      timeline
        ? items.map((it) => ({
            key: it.id,
            date: it.date,
            startsAt: it.startsAt ?? null,
            endsAt: it.endsAt ?? null,
            ...blockLabels(it, showClientName),
            family: KIND_FAMILY[it.kind],
            status: it.status ?? null,
            ref: it,
          }))
        : [],
    [items, showClientName, timeline],
  );
  /** A day tapped in Month or Week: that day on the timeline. */
  const openDay = (d: Date) => {
    setCursor(startOfDay(d));
    setPicked(startOfDay(d));
    setView("day");
  };

  const itemsByDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      if (!m.has(it.date)) m.set(it.date, []);
      m.get(it.date)!.push(it);
    }
    return m;
  }, [items]);

  function shift(direction: -1 | 1) {
    if (view === "month") {
      setCursor((c) => {
        const next = new Date(c.getFullYear(), c.getMonth() + direction, 1);
        const today = startOfDay(new Date());
        setPicked(next.getMonth() === today.getMonth() && next.getFullYear() === today.getFullYear() ? today : next);
        return next;
      });
    }
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
    if (view === "day") {
      // "Tuesday, Nov 3": fits beside Book on a phone (the year only when it isn't this one).
      const thisYear = cursor.getFullYear() === new Date().getFullYear();
      return cursor.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) });
    }
    return "Upcoming";
  }, [view, cursor]);

  return (
    <div className="space-y-3">
      <Card className="border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList className="h-8">
              {views.map((v) => (
                <TabsTrigger key={v} value={v} className="text-xs">{VIEW_LABEL[v]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {view !== "upcoming" && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shift(-1)} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setCursor(startOfDay(new Date())); setPicked(startOfDay(new Date())); setJump((j) => j + 1); }}>
                Today
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shift(1)} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-semibold">{headerLabel}</span>
            {onCreate && createButton && (
              <Button
                size="sm"
                className="h-8 bg-primary font-semibold"
                onClick={() => onCreate(view === "day" || view === "week" ? isoDate(cursor) : isoDate(new Date()))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Book
              </Button>
            )}
          </div>
        </div>
        {toolbar && <div className="mt-3 border-t border-border pt-3">{toolbar}</div>}
        <LegendRow items={items} />
      </Card>

      {isEmpty && !onCreate ? (
        <CalendarEmptyState
          title={emptyHint ? "No calendar items yet" : "No calendar items"}
          hint={emptyHint}
        />
      ) : (
        <>
      {timeline && (view === "week" || view === "day") && (
        <TimeGrid
          days={view === "day" ? [isoDate(cursor)] : Array.from({ length: 7 }, (_, i) => isoDate(addDays(startOfWeek(cursor), i)))}
          entries={entries}
          today={isoDate(new Date())}
          nowMs={nowMs}
          onOpen={setSelected}
          onSlot={onCreate ? (d, time) => onCreate(d, time) : undefined}
          canSlot={canCreateOn}
          slotVerb={slotVerb}
          onDay={view === "week" ? (d) => openDay(parseDay(d) ?? cursor) : undefined}
          hourHeight={52}
          heightClass="h-[max(24rem,calc(100svh-24rem))] sm:h-[max(28rem,calc(100svh-19rem))]"
          scrollKey={`${view}:${jump}`}
          label={headerLabel}
        />
      )}
      {timeline && view === "month" && (
        <MonthGrid cursor={cursor} itemsByDate={itemsByDate} onSelectItem={setSelected} picked={picked} onSelectDay={openDay} showClientName={showClientName} names />
      )}
      {!timeline && view === "month" && (
        <>
          <MonthGrid cursor={cursor} itemsByDate={itemsByDate} onSelectItem={setSelected} picked={picked} onSelectDay={setPicked} showClientName={showClientName} />
          {/* The tapped day, in full: titles never have to fit a 45px cell. */}
          <section className="space-y-2" aria-live="polite">
            <h3 className="px-1 text-xs font-bold text-muted-foreground">{fmtFullDate(picked).replace(/,? \d{4}$/, "")}</h3>
            <DayList date={picked} items={itemsByDate.get(isoDate(picked)) ?? []} onSelectItem={setSelected} showClientName={showClientName} onCreate={onCreate} compact />
          </section>
        </>
      )}
      {!timeline && view === "week" && (
        <WeekGrid cursor={cursor} itemsByDate={itemsByDate} onSelectItem={setSelected} onCreate={onCreate} showClientName={showClientName} />
      )}
      {!timeline && view === "day" && (
        <DayList date={cursor} items={itemsByDate.get(isoDate(cursor)) ?? []} onSelectItem={setSelected} showClientName={showClientName} emptyHint={emptyHint} onCreate={onCreate} />
      )}
      {view === "upcoming" && (
        <UpcomingList items={items} onSelectItem={setSelected} showClientName={showClientName} isLoading={isLoading} emptyHint={emptyHint} />
      )}
        </>
      )}

      <EventDetailSheet item={selected} onClose={() => setSelectedRaw(null)} showClientName={showClientName} renderItemActions={renderItemActions} />
    </div>
  );
}

const FAMILY_LEGEND: Record<KindFamily, string> = {
  training: "Training",
  people: "Sessions",
  coach: "Coach",
  google: "Google",
};

/** One entry per colour family on screen (four at most), not one per item type. */
function LegendRow({ items }: { items: CalendarItem[] }) {
  const families = useMemo(() => {
    const order: KindFamily[] = ["training", "people", "coach", "google"];
    const seen = new Set(items.map((i) => KIND_FAMILY[i.kind]));
    return order.filter((f) => seen.has(f));
  }, [items]);
  if (families.length < 2) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1">
      {families.map((f) => {
        const kind = (Object.keys(KIND_FAMILY) as CalendarKind[]).find((k) => KIND_FAMILY[k] === f)!;
        return (
          <span key={f} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", KIND_META[kind].dot)} />
            {FAMILY_LEGEND[f]}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The month at a glance. On phones each day shows up to three dots in the
 * items' colour families (nothing readable fits 45px; the tapped day is
 * listed in full underneath). Wider screens show a chip per item with its
 * start time and who it's with ("10a Nicolas G."), the full details on
 * hover: a month of "1:1 Training" chips said nothing about who or when.
 */
function MonthGrid({
  cursor, itemsByDate, onSelectItem, onSelectDay, picked, showClientName = false, names = false,
}: {
  /** The coach's month: phones show who's booked (not dots), and a tapped day opens it (no list under the grid). */
  names?: boolean;
  cursor: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onSelectItem: (i: CalendarItem) => void;
  onSelectDay: (d: Date) => void;
  picked: Date;
  showClientName?: boolean;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = endOfMonth(cursor);
  const totalCells = Math.ceil((monthEnd.getDate() + leadDays(monthStart)) / 7) * 7;
  const today = isoDate(new Date());

  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) cells.push(addDays(gridStart, i));

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={60}>
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
          // The coach's month: who's booked first, so Google never pushes a session into "+N".
          const visible = (names ? [...dayItems].sort((a, b) => monthChipOrder({ ...a, family: KIND_FAMILY[a.kind] }, { ...b, family: KIND_FAMILY[b.kind] })) : dayItems).slice(0, 3);
          const extra = dayItems.length - visible.length;
          const isPicked = dIso === isoDate(picked);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectDay(d)}
              aria-pressed={isPicked}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${dayItems.length ? `, ${dayItems.length} item${dayItems.length === 1 ? "" : "s"}` : ""}`}
              className={cn(
                // A column from the top: a button centres its content, so day numbers sat at different heights.
                "flex min-h-[52px] flex-col items-stretch justify-start border-b border-r border-border p-1 text-left transition-colors sm:min-h-[96px]",
                !inMonth && "bg-background/30 text-muted-foreground/60",
                names ? "min-h-[64px] transition hover:bg-secondary/40 active:bg-secondary/60" : isPicked && "bg-secondary/70",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                  isToday ? (names ? "bg-foreground text-background" : "bg-primary text-primary-foreground") : isPicked && !names ? "ring-1 ring-primary/70" : "text-foreground/80",
                )}>
                  {d.getDate()}
                </span>
              </div>
              {/* phones, the coach's month: who's booked, a line each (the day opens on a tap) */}
              {names && dayItems.length > 0 && (
                <div className="mt-0.5 space-y-px sm:hidden" aria-hidden>
                  {visible.map((it) => (
                    <span
                      key={it.id}
                      className={cn(
                        "block truncate rounded-sm border-l-2 px-0.5 text-[9px] font-semibold leading-[13px]",
                        KIND_META[it.kind].chip,
                        (it.status === "Cancelled" || it.status === "Missed") && "line-through opacity-60",
                      )}
                    >
                      {(() => {
                        const l = blockLabels(it, showClientName);
                        return l.tiny ?? l.short;
                      })()}
                    </span>
                  ))}
                  {extra > 0 && <span className="block px-0.5 text-[9px] font-semibold leading-3 text-muted-foreground">+{extra}</span>}
                </div>
              )}
              {/* phones: dots */}
              {!names && dayItems.length > 0 && (
                <div className="mt-1 flex items-center gap-0.5 px-0.5 sm:hidden" aria-hidden>
                  {visible.map((it) => (
                    <span key={it.id} className={cn("h-1.5 w-1.5 rounded-full", KIND_META[it.kind].dot)} />
                  ))}
                  {extra > 0 && <span className="text-[9px] font-bold leading-none text-muted-foreground">+</span>}
                </div>
              )}
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {visible.map((it) => {
                  const { time, label } = chipParts(it, showClientName);
                  const lines = itemDetailLines(it, showClientName);
                  return (
                    <Tooltip key={it.id}>
                      <TooltipTrigger asChild>
                        <div
                          role="button"
                          tabIndex={-1}
                          aria-label={lines.join(", ")}
                          onClick={(e) => { e.stopPropagation(); onSelectItem(it); }}
                          className={cn(
                            "flex min-w-0 items-baseline gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-tight",
                            KIND_META[it.kind].chip,
                            (it.status === "Cancelled" || it.status === "Missed") && "line-through opacity-60",
                          )}
                        >
                          {time && <span className="shrink-0 tabular-nums opacity-75">{time}</span>}
                          <span className="min-w-0 truncate font-semibold">{label}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-[260px] space-y-0.5 border border-border bg-popover py-2 text-popover-foreground shadow-lg">
                        {lines.map((line, i) => (
                          <div key={i} className={i === 0 ? "text-[13px] font-semibold" : "text-xs text-muted-foreground"}>{line}</div>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {extra > 0 && (
                  <div className="px-1 text-[10px] font-semibold text-muted-foreground">+{extra} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
    </TooltipProvider>
  );
}

function WeekGrid({
  cursor, itemsByDate, onSelectItem, onCreate, showClientName = false,
}: {
  cursor: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onSelectItem: (i: CalendarItem) => void;
  onCreate?: (dateISO: string) => void;
  showClientName?: boolean;
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
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{WEEKDAY_LABELS[(d.getDay() + 6) % 7]}</span>
              <span className="flex items-center gap-1">
                <span className={cn("text-sm font-bold", isToday && "text-primary")}>{d.getDate()}</span>
                {onCreate && (
                  <button
                    type="button"
                    aria-label={`Book on ${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`}
                    onClick={() => onCreate(dIso)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-primary"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </span>
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
                      className={cn("w-full rounded px-2 py-1 text-left text-[11px] border", KIND_META[it.kind].chip)}
                    >
                      <span className="block truncate">
                        {it.startsAt ? `${compactTimeRange(it.startsAt, it.endsAt)} · ` : ""}{showNameFirst(it, showClientName)}
                      </span>
                      {placeLabel(it.location) && (
                        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] opacity-75">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{placeLabel(it.location)}</span>
                        </span>
                      )}
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
  date, items, onSelectItem, showClientName, emptyHint, onCreate, compact = false,
}: {
  /** Under the month grid: a one-line empty state. */
  compact?: boolean;
  date: Date;
  items: CalendarItem[];
  onSelectItem: (i: CalendarItem) => void;
  showClientName?: boolean;
  emptyHint?: string;
  onCreate?: (dateISO: string) => void;
}) {
  const dayName = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const bookButton = onCreate ? (
    <Button variant="outline" className="h-11 w-full border-dashed" onClick={() => onCreate(isoDate(date))}>
      <Plus className="mr-2 h-4 w-4" /> Book on {dayName}
    </Button>
  ) : null;
  if (items.length === 0 && compact) {
    return (
      <div className="space-y-2">
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nothing scheduled.</p>
        {bookButton}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <Card className="border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <CalIcon className="mx-auto mb-2 h-5 w-5" />
          Nothing scheduled for {dayName}.
          {emptyHint && !onCreate && <div className="mt-1 text-xs">{emptyHint}</div>}
        </Card>
        {bookButton}
      </div>
    );
  }
  const sorted = [...items].sort((a, b) => compareInstants(a.startsAt, b.startsAt));
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {sorted.map((it) => <ItemRow key={it.id} item={it} onClick={() => onSelectItem(it)} showClientName={showClientName} />)}
      </ul>
      {bookButton}
    </div>
  );
}

/** Week chips are tiny: lead with who it's with (coach views), then what. */
function showNameFirst(it: CalendarItem, withPerson: boolean): string {
  const who = withPerson ? personName(it) : null;
  return who ? `${who} · ${scheduleTitle(it)}` : scheduleTitle(it);
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
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
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

/**
 * One item: a line of its colour family, then who it's with as the title on
 * coach views ("Colten Murray", then "12–1 PM · 1:1 Training · 800 Vaughan
 * Ave"), else the item's own title and when / what.
 */
function ItemRow({ item, onClick, showClientName }: { item: CalendarItem; onClick: () => void; showClientName?: boolean }) {
  const { title, meta } = rowLines(item, !!showClientName);
  const withPerson = !!showClientName && !!personName(item);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-stretch gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
      >
        <span aria-hidden className={cn("w-[3px] shrink-0 rounded-full", KIND_META[item.kind].dot)} />
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-2 text-sm font-semibold leading-snug", item.status === "Cancelled" && "text-muted-foreground line-through")}>{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>
          {!withPerson && item.subtitle && <span className="block truncate text-xs text-muted-foreground/80">{item.subtitle}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/60" />
      </button>
    </li>
  );
}

function EventDetailSheet({
  item, onClose, showClientName, renderItemActions,
}: {
  item: CalendarItem | null;
  onClose: () => void;
  showClientName?: boolean;
  renderItemActions?: (item: CalendarItem, close: () => void) => React.ReactNode;
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
                {item.startsAt && durationLabel(item.startsAt, item.endsAt) ? ` (${durationLabel(item.startsAt, item.endsAt)})` : ""}
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
              {renderItemActions?.(item, onClose)}
              {item.href && (
                <Link
                  to={item.href.to as any}
                  params={item.href.params as any}
                  search={(item.href as any).search as any}
                  onClick={onClose}
                >
                  <Button size="sm" className="w-full bg-primary font-semibold">{ctaLabel(item)}</Button>
                </Link>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}