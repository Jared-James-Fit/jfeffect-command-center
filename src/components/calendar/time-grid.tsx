import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import type { KindFamily } from "@/lib/calendar-sources";
import {
  DAY_MINUTES,
  MIN_BLOCK_MIN,
  SLOT_MIN,
  hourLabel,
  layoutDay,
  localDay,
  minuteClock,
  openingMinute,
  slotTime,
  spanOnDay,
  type Placed,
} from "@/lib/calendar-timeline";
import { cn } from "@/lib/utils";

/**
 * The coach's day or week as a timeline, Google Calendar's way: hours down the
 * side, a column per day, each booking a block at its start and as tall as it
 * lasts (who in bold, then when and what), overlapping bookings side by side,
 * a line at "now" in today's column, and empty space reading as free time.
 * All-day things sit in a row under the day names. A tap on a block opens it;
 * a tap on empty time books there (a mouse click books at once; a finger
 * first shows "+ 10:30 AM" so a stray tap never opens the booking form). It
 * only ever reads: nothing is dragged, so no booking's time changes by
 * accident.
 */

export type TimeGridEntry<T> = {
  key: string;
  /** The device's yyyy-mm-dd: where an all-day entry sits. */
  date: string;
  /** Null = all day. */
  startsAt: string | null;
  endsAt: string | null;
  /** Who it's with (or what it is): the block's bold line. */
  title: string;
  /** For a narrow column ("Nicolas"). */
  short?: string | null;
  /** What and where, after the time. */
  detail?: string | null;
  family: KindFamily;
  status?: string | null;
  ref: T;
};

/** A block per colour family: a tint, a solid edge, the theme's own text (readable light and dark). */
const BLOCK: Record<KindFamily, string> = {
  people: "border-violet-500 bg-violet-500/15 hover:bg-violet-500/25",
  coach: "border-amber-500 bg-amber-500/15 hover:bg-amber-500/25",
  training: "border-foreground/50 bg-foreground/[0.07] hover:bg-foreground/[0.12]",
  google: "border-muted-foreground/40 bg-muted hover:bg-muted/70",
};

const STRUCK = new Set(["Cancelled", "Missed", "Rescheduled"]);

export function TimeGrid<T>({
  days,
  entries,
  today,
  nowMs,
  onOpen,
  onSlot,
  onDay,
  hourHeight = 48,
  heightClass,
  compact = false,
  scrollKey,
  label,
}: {
  /** yyyy-mm-dd columns, in order (1 for a day, 7 for a week). */
  days: string[];
  entries: TimeGridEntry<T>[];
  today: string;
  nowMs: number;
  onOpen: (ref: T) => void;
  /** Book on an empty slot ("HH:MM" on a half hour). */
  onSlot?: (day: string, time: string) => void;
  /** A day's name was tapped (open that day). */
  onDay?: (day: string) => void;
  hourHeight?: number;
  /** The scrolling window's height (the day scrolls inside it, opening near now). */
  heightClass: string;
  /** The Home card: smaller type and gutter. */
  compact?: boolean;
  /** Change it to scroll back to the opening time (a new period, Today). */
  scrollKey?: string;
  label?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  // Until they scroll it themselves, the grid keeps its opening place as bookings load in.
  const placed = useRef<{ key: string; byUs: boolean; touched: boolean }>({ key: "", byUs: false, touched: false });
  const lastPointer = useRef<string>("mouse");
  const [pending, setPending] = useState<{ day: string; min: number } | null>(null);
  const [hover, setHover] = useState<{ day: string; min: number } | null>(null);
  const single = days.length === 1;
  const nowDate = new Date(nowMs);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const nowDay = localDay(nowDate);
  const showsToday = days.includes(nowDay);

  const { timedByDay, allDayByDay, firstStart, lastEnd } = useMemo(() => {
    const timed = new Map<string, Placed<TimeGridEntry<T>>[]>();
    const allDay = new Map<string, TimeGridEntry<T>[]>();
    let first: number | null = null;
    let last: number | null = null;
    for (const day of days) {
      const spans: Array<{ item: TimeGridEntry<T>; startMin: number; endMin: number }> = [];
      for (const e of entries) {
        if (!e.startsAt) continue;
        const span = spanOnDay(day, e.startsAt, e.endsAt);
        if (span) spans.push({ item: e, ...span });
      }
      const placed = layoutDay(spans);
      timed.set(day, placed);
      for (const p of placed) {
        if (STRUCK.has(p.item.status ?? "")) continue;
        if (first == null || p.startMin < first) first = p.startMin;
        if (last == null || p.endMin > last) last = p.endMin;
      }
      allDay.set(day, entries.filter((e) => !e.startsAt && e.date === day));
    }
    return { timedByDay: timed, allDayByDay: allDay, firstStart: first, lastEnd: last };
  }, [days, entries]);

  const hasAllDay = days.some((d) => (allDayByDay.get(d) ?? []).length > 0);
  const gutter = compact ? "2.5rem" : "3.25rem";
  const cols: CSSProperties = { gridTemplateColumns: `${gutter} repeat(${days.length}, minmax(0, 1fr))` };
  const gridHeight = 24 * hourHeight;
  const pxPerMin = hourHeight / 60;

  // Open on the whole busy part when it fits, else near now (today on screen),
  // else just before the first booking, else 7 AM; again for a new period or Today.
  const openKey = `${scrollKey ?? ""}|${days[0]}|${days.length}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const state = placed.current;
    if (state.key !== openKey) {
      state.key = openKey;
      state.touched = false;
      setPending(null);
    }
    if (state.touched) return;
    const viewMin = Math.round((el.clientHeight - (header.current?.offsetHeight ?? 0)) / pxPerMin);
    const top = openingMinute({ nowMin: showsToday ? nowMin : null, firstStartMin: firstStart, lastEndMin: lastEnd, viewMin });
    const next = Math.round(top * pxPerMin);
    if (Math.abs(el.scrollTop - next) > 1) {
      state.byUs = true;
      el.scrollTop = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, firstStart, lastEnd]);

  const minuteAt = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(DAY_MINUTES - 1, (e.clientY - rect.top) / pxPerMin));
  };
  const slotStart = (min: number) => Math.floor(min / SLOT_MIN) * SLOT_MIN;

  return (
    <div className={cn("overflow-hidden bg-card", compact ? "border-y border-border/60" : "rounded-xl border border-border")} role="group" aria-label={label}>
      <div
        ref={scroller}
        className={cn("relative overflow-y-auto overscroll-contain [overflow-anchor:none]", heightClass)}
        data-time-grid
        onScroll={() => {
          if (placed.current.byUs) placed.current.byUs = false;
          else placed.current.touched = true;
        }}
      >
        {/* Day names (and all-day things) stay on top while the hours scroll under them. */}
        {(!single || hasAllDay) && (
          <div ref={header} className="sticky top-0 z-30 border-b border-border bg-card">
            {!single && (
              <div className="grid" style={cols}>
                <div />
                {days.map((d) => (
                  <DayHead key={d} day={d} today={today} compact={compact} onDay={onDay} />
                ))}
              </div>
            )}
            {hasAllDay && (
              <div className="grid border-t border-border/60" style={cols}>
                <div className={cn("self-center pr-1.5 text-right font-medium text-muted-foreground", compact ? "text-[9px]" : "text-[10px]")}>All day</div>
                {days.map((d) => {
                  const list = allDayByDay.get(d) ?? [];
                  const shown = list.slice(0, 2);
                  return (
                    <div key={d} className="min-w-0 space-y-0.5 border-l border-border/60 p-0.5">
                      {shown.map((e) => (
                        <button
                          key={e.key}
                          type="button"
                          onClick={() => onOpen(e.ref)}
                          title={e.title}
                          className={cn(
                            "block w-full truncate rounded border-l-2 px-1 py-px text-left font-semibold text-foreground",
                            compact ? "text-[10px] leading-tight" : "text-[11px] leading-tight",
                            BLOCK[e.family],
                            STRUCK.has(e.status ?? "") && "line-through opacity-50",
                          )}
                        >
                          {single ? e.title : (e.short ?? e.title)}
                        </button>
                      ))}
                      {list.length > shown.length && (
                        <button type="button" onClick={() => onDay?.(d)} className="block w-full truncate px-1 text-left text-[10px] font-semibold text-muted-foreground">
                          +{list.length - shown.length}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="relative grid" style={{ ...cols, height: gridHeight }}>
          {/* Hours down the side. */}
          <div className="relative" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span
                key={h}
                className={cn("absolute right-1.5 -translate-y-1/2 whitespace-nowrap tabular-nums text-muted-foreground", compact ? "text-[9px]" : "text-[10px]")}
                style={{ top: h * hourHeight }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const placed = timedByDay.get(d) ?? [];
            const isNowColumn = d === nowDay;
            const ghost = pending?.day === d ? pending : hover?.day === d ? hover : null;
            return (
              <div
                key={d}
                role="presentation"
                className={cn("relative border-l border-border/60", onSlot && "cursor-pointer")}
                style={{
                  backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                  backgroundSize: `100% ${hourHeight}px`,
                }}
                onPointerDown={(e) => {
                  lastPointer.current = e.pointerType;
                }}
                onPointerMove={(e) => {
                  if (!onSlot || e.pointerType !== "mouse" || e.target !== e.currentTarget) {
                    if (hover) setHover(null);
                    return;
                  }
                  const min = slotStart(minuteAt(e));
                  if (hover?.day !== d || hover.min !== min) setHover({ day: d, min });
                }}
                onPointerLeave={() => setHover(null)}
                onClick={(e) => {
                  if (!onSlot || e.target !== e.currentTarget) return;
                  const min = slotStart(minuteAt(e));
                  // A finger shows the slot first; a second tap on it books (a stray tap never opens the form).
                  if (lastPointer.current === "mouse") onSlot(d, slotTime(min));
                  else setPending({ day: d, min });
                }}
              >
                {placed.map((p) => (
                  <Block key={p.item.key} placed={p} pxPerMin={pxPerMin} compact={compact} ended={isEnded(p, d, nowDay, nowMin)} onOpen={onOpen} />
                ))}

                {ghost && onSlot && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPending(null);
                      onSlot(d, slotTime(ghost.min));
                    }}
                    className={cn(
                      "absolute inset-x-0.5 z-10 flex items-start gap-0.5 overflow-hidden rounded-md border border-dashed border-foreground/40 bg-foreground/[0.06] px-1 py-0.5 text-left font-semibold text-foreground",
                      compact ? "text-[10px]" : "text-[11px]",
                      hover && !pending && "pointer-events-none",
                    )}
                    style={{ top: ghost.min * pxPerMin, height: SLOT_MIN * pxPerMin }}
                    aria-label={`Book at ${minuteClock(ghost.min)}`}
                  >
                    <Plus className="mt-px h-3 w-3 shrink-0" />
                    <span className="truncate tabular-nums">{minuteClock(ghost.min)}</span>
                  </button>
                )}

                {isNowColumn && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: nowMin * pxPerMin }} aria-label="Now">
                    <span className="-ml-[5px] h-2.5 w-2.5 shrink-0 rounded-full bg-foreground" />
                    <span className="h-0.5 flex-1 bg-foreground" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function isEnded(p: { endMin: number }, day: string, nowDay: string, nowMin: number): boolean {
  if (day < nowDay) return true;
  return day === nowDay && p.endMin <= nowMin;
}

/** A day's name and date over its column; today in a filled circle, like every calendar in the app. */
function DayHead({ day, today, compact, onDay }: { day: string; today: string; compact: boolean; onDay?: (day: string) => void }) {
  const date = new Date(`${day}T00:00:00`);
  const isToday = day === today;
  const body = (
    <>
      <span className={cn("font-medium", compact ? "text-[10px]" : "text-[11px]", isToday ? "text-foreground" : "text-muted-foreground")}>
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span
        className={cn(
          "grid place-items-center rounded-full font-semibold tabular-nums",
          compact ? "h-6 w-6 text-[13px]" : "h-7 w-7 text-sm",
          isToday ? "bg-foreground text-background" : day < today ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {date.getDate()}
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-col items-center gap-0.5 border-l border-border/60 py-1";
  const name = `${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${isToday ? " (today)" : ""}`;
  return onDay ? (
    <button type="button" onClick={() => onDay(day)} aria-label={`Open ${name}`} aria-current={isToday ? "date" : undefined} className={cn(cls, "transition hover:bg-secondary/50 active:bg-secondary/60")}>
      {body}
    </button>
  ) : (
    <div className={cls} aria-label={name} aria-current={isToday ? "date" : undefined}>
      {body}
    </div>
  );
}

/**
 * One booking, worded for the room it has: its width by container query (a
 * phone's week column is the first name in small type; a little wider adds the
 * start time; a full column is who in bold, the time range, then what and
 * where) and its height by how many lines fit (never a line cut in half; a
 * word that doesn't fit is clipped, never broken mid-word). A short one is a
 * single line ("Nicolas Galli, 10 AM"). Ended ones read quieter; cancelled and
 * no-shows are crossed out and dashed, so they never look like time that's
 * taken.
 */
function Block<T>({
  placed, pxPerMin, compact, ended, onOpen,
}: {
  placed: Placed<TimeGridEntry<T>>;
  pxPerMin: number;
  compact: boolean;
  ended: boolean;
  onOpen: (ref: T) => void;
}) {
  const { item, startMin, endMin, col, cols, span } = placed;
  const top = startMin * pxPerMin;
  const height = Math.max(MIN_BLOCK_MIN, endMin - startMin) * pxPerMin;
  const left = (col / cols) * 100;
  const width = (span / cols) * 100;
  const struck = STRUCK.has(item.status ?? "");
  const sameHalf = (startMin < 720) === (endMin < 720 || endMin === DAY_MINUTES);
  const range = `${minuteClock(startMin, !sameHalf)}–${minuteClock(endMin)}`;
  const start = minuteClock(startMin);
  // Lines that fit: the padding is 4px; a line is 12.5px (card, 10px type) / 15px (page, 12px type).
  const fit = Math.max(1, Math.floor((height - 4) / (compact ? 12.5 : 15)));
  const short = item.short ?? item.title;
  const status = item.status === "Missed" ? "No-show" : item.status === "Cancelled" ? "Cancelled" : null;
  const words = [item.title, range, item.detail, status].filter(Boolean);
  const strike = struck && "line-through";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(item.ref);
      }}
      aria-label={words.join(", ")}
      title={words.join("\n")}
      className={cn(
        // A column from the top: a button centres its content by default.
        "@container absolute z-10 flex flex-col items-stretch justify-start overflow-hidden rounded-md border-l-[3px] py-0.5 text-left text-foreground transition-colors",
        // The line height after the size: a size class later in the list would drop it.
        compact ? "px-0.5 text-[10px] leading-tight @[4.5rem]:px-1" : "px-0.5 text-[11px] leading-tight @[4.5rem]:px-1 sm:text-xs sm:leading-tight",
        BLOCK[item.family],
        cols > 1 && "ring-1 ring-card",
        ended && !struck && "opacity-60",
        struck && "border-dashed opacity-45",
      )}
      style={{ top, height, left: `calc(${left}% + 1px)`, width: `calc(${width}% - 3px)` }}
    >
      {/* A phone's week column: the first name, small. */}
      <span className="block @[4.5rem]:hidden">
        <Lines n={fit} className={cn("text-[9px] font-semibold tracking-tight", strike)}>{short}</Lines>
      </span>
      {/* A narrow column: the first name and when it starts. */}
      <span className="hidden @[4.5rem]:block @[6.5rem]:hidden">
        {fit === 1 ? (
          <Lines n={1} className={cn("font-semibold", strike)}>{short}</Lines>
        ) : (
          <>
            <Lines n={fit - 1} className={cn("font-semibold", strike)}>{short}</Lines>
            <span className="block truncate tabular-nums text-foreground/70">{start}</span>
          </>
        )}
      </span>
      {/* A full column: who, when, then what and where. */}
      <span className="hidden @[6.5rem]:block">
        {fit === 1 ? (
          <span className={cn("block truncate", strike)}>
            <span className="font-semibold">{item.title}</span>
            <span className="font-normal text-foreground/70">, {start}</span>
          </span>
        ) : (
          <>
            <span className={cn("block truncate font-semibold", strike)}>{item.title}</span>
            <span className="block truncate tabular-nums text-foreground/70">{range}</span>
            {fit >= 3 && (item.detail || status) && (
              <span className="block truncate text-foreground/60">{[status, item.detail].filter(Boolean).join(" · ")}</span>
            )}
          </>
        )}
      </span>
    </button>
  );
}

/** Up to `n` lines, wrapping between words only (a word too long is clipped, never broken). */
function Lines({ n, className, children }: { n: number; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn("overflow-hidden break-normal [overflow-wrap:normal]", className)}
      style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(1, n) }}
    >
      {children}
    </span>
  );
}
