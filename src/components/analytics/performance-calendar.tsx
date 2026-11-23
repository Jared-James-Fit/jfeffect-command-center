/**
 * The performance calendar: training day by day, a GitHub-style grid with an
 * athlete's eye. One read (performance-calendar.ts), five ways to colour it:
 * workouts (done, not finished, missed, planned), volume (working sets on
 * the athlete's own scale), strength (the day's main lift against its own
 * recent best; a day with no hard set has no read, never "weak"), PRs and
 * consistency (each week's planned workouts done).
 *
 * Ranges: a week and a month as calendars, a block as its weeks, a year and
 * everything as a contribution grid that scrolls sideways (opening on the
 * latest week). Every day is a button: a tap (or arrow keys) picks it and
 * the day opens under the grid with its workouts, every set, its strength
 * read, PRs and check-out, and a way into the full workout; a mouse hover
 * says the day in one line first.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronRight, Star, Trophy, Moon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/analytics/info-tip";
import { DualWeight, Figure, LabHeader, Seg, Stepper } from "@/components/analytics/lab-ui";
import {
  CALENDAR_MODES,
  RANGE_KINDS,
  addDays,
  calendarRange,
  cellLook,
  dayLabel,
  gridWeeks,
  mondayOf,
  stepRange,
  summarizeRange,
  type CalBlock,
  type CalDay,
  type CalendarMode,
  type CellLook,
  type PerformanceCalendar as Cal,
  type RangeKind,
} from "@/lib/analytics/performance-calendar";
import { loadText, volumeCompact, type Unit } from "@/lib/analytics/units";

const SLEEP_WORDS: Record<string, string> = {
  lt5: "under 5h",
  "5_6": "5–6h",
  "6_7": "6–7h",
  "7_8": "7–8h",
  "8_9": "8–9h",
  gte9: "9h+",
  gte7: "7h+",
  gte8: "8h+",
};

/** The fill for a level in a mode. */
function fillFor(mode: CalendarMode, look: CellLook): string {
  if (look.level === 0) return "var(--heat-0)";
  if (mode === "workouts" || mode === "consistency") {
    const pct = [0, 28, 48, 72, 100][look.level];
    return `color-mix(in oklch, var(--success) ${pct}%, var(--card))`;
  }
  if (mode === "prs") {
    const pct = [0, 35, 55, 78, 100][look.level];
    return `color-mix(in oklch, var(--warning) ${pct}%, var(--card))`;
  }
  return `var(--heat-${look.level})`;
}

function Cell({
  day,
  look,
  mode,
  size,
  selected,
  today,
  label,
  onPick,
  onHover,
  children,
  className,
}: {
  day: string;
  look: CellLook;
  mode: CalendarMode;
  size: "dot" | "box";
  selected: boolean;
  today: boolean;
  label: string;
  onPick: (d: string) => void;
  onHover?: (d: string | null, el?: HTMLElement) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-cal-day={day}
      data-cal-level={look.level}
      data-cal-missed={look.missed ? "" : undefined}
      aria-label={label}
      aria-pressed={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onPick(day)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onHover?.(day, e.currentTarget);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onHover?.(null);
      }}
      className={cn(
        "relative shrink-0 outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-foreground",
        size === "dot" ? "h-[13px] w-[13px] rounded-[3px]" : "rounded-lg",
        look.missed &&
          "shadow-[inset_0_0_0_1.5px_color-mix(in_oklch,var(--destructive)_70%,transparent)]",
        look.upcoming &&
          "shadow-[inset_0_0_0_1px_var(--border)] [background-image:repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklch,var(--muted-foreground)_18%,transparent)_3px_4px)]",
        look.noRead && "shadow-[inset_0_0_0_1px_var(--border)]",
        selected && "z-10 shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--foreground)]",
        today && !selected && "shadow-[0_0_0_1.5px_var(--foreground)]",
        className,
      )}
      style={{ background: fillFor(mode, look) }}
    >
      {look.star && size === "dot" && (
        <span
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--warning)] ring-1 ring-[var(--card)]"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

function Legend({ mode }: { mode: CalendarMode }) {
  const levels = [1, 2, 3, 4] as const;
  const words: Record<CalendarMode, [string, string]> = {
    workouts: ["Not finished", "Finished"],
    volume: ["Fewer sets", "More sets (your own range)"],
    strength: ["Under your recent best", "At or past it"],
    prs: ["1 PR", "3+ PRs"],
    consistency: ["Little of the week's plan", "Whole week done"],
  };
  const swatch = (bg: string, extra?: string) => (
    <span className={cn("inline-block h-3 w-3 rounded-[3px]", extra)} style={{ background: bg }} />
  );
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground"
      data-cal-legend={mode}
    >
      <span className="inline-flex items-center gap-1">
        <span>{words[mode][0]}</span>
        {(mode === "workouts" ? ([2, 4] as const) : levels).map((l) => (
          <span key={l}>{swatch(fillFor(mode, { level: l }))}</span>
        ))}
        <span>{words[mode][1]}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        {swatch(
          "var(--heat-0)",
          "shadow-[inset_0_0_0_1.5px_color-mix(in_oklch,var(--destructive)_70%,transparent)]",
        )}{" "}
        Missed
      </span>
      <span className="inline-flex items-center gap-1">
        {swatch(
          "var(--heat-0)",
          "shadow-[inset_0_0_0_1px_var(--border)] [background-image:repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklch,var(--muted-foreground)_18%,transparent)_3px_4px)]",
        )}{" "}
        Planned
      </span>
      {mode === "strength" && (
        <>
          <span className="inline-flex items-center gap-1">
            {swatch("var(--heat-0)", "shadow-[inset_0_0_0_1px_var(--border)]")} Trained, no hard set
            to read
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" /> New best estimate
          </span>
        </>
      )}
      {mode === "prs" && (
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" /> Competition-lift PR
        </span>
      )}
    </div>
  );
}

/**
 * Text on a filled day: the dataviz palette's rule (white in a strong fill,
 * near-black on amber and on the light top of the dark theme's ramps).
 */
function inkFor(mode: CalendarMode, level: number): { num: string; sub: string } {
  if (level < 3) return { num: "text-foreground", sub: "text-muted-foreground" };
  if (mode === "prs") return { num: "text-[#0b0b0b]", sub: "text-[#0b0b0b]/80" };
  if (level === 4)
    return { num: "text-white dark:text-[#0b0b0b]", sub: "text-white/90 dark:text-[#0b0b0b]/80" };
  return { num: "text-white", sub: "text-white/90" };
}

const WEEKDAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PerformanceCalendar({
  cal,
  blocks,
  unit,
  coach = false,
  clientId,
  compact = false,
  onOpen,
  initialRange,
}: {
  cal: Cal;
  blocks: CalBlock[];
  unit: Unit;
  coach?: boolean;
  clientId: string;
  /** the Overview's strip: the last 16 weeks, workouts, a tap opens the Calendar */
  compact?: boolean;
  onOpen?: () => void;
  initialRange?: RangeKind;
}) {
  const today = cal.today;
  const [kind, setKind] = useState<RangeKind>(compact ? "all" : (initialRange ?? "month"));
  const [anchor, setAnchor] = useState(today);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [mode, setMode] = useState<CalendarMode>("workouts");
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => {
    if (compact) {
      const start = addDays(mondayOf(today), -15 * 7);
      return {
        kind: "all" as const,
        start,
        end: addDays(mondayOf(today), 6),
        label: "Last 16 weeks",
      };
    }
    return calendarRange(kind, anchor, { blocks, blockId, first: cal.first, today });
  }, [compact, kind, anchor, blocks, blockId, cal.first, today]);
  const weeks = useMemo(() => gridWeeks(range), [range]);
  const summary = useMemo(() => summarizeRange(cal, range), [cal, range]);
  const step = (dir: -1 | 1) => {
    const s = stepRange(range, dir, { blocks, today, first: cal.first });
    if (!s) return null;
    // never step past the first week on file or a year past today
    if (dir === -1 && cal.first && range.start <= cal.first) return null;
    if (dir === 1 && range.end >= addDays(today, 7) && range.kind !== "block") return null;
    return () => {
      setAnchor(s.anchor);
      if (s.blockId !== undefined) setBlockId(s.blockId ?? null);
      setPicked(null);
    };
  };

  // the grid opens on the latest week (a year or everything scrolls sideways)
  const strip = compact || kind === "year" || kind === "all";
  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>("[data-cal-scroll]");
    if (!el || !strip) return;
    // the latest week (today's) in view at the right edge
    const todayCell = el.querySelector<HTMLElement>(`[data-cal-day="${today}"]`);
    if (!todayCell) {
      el.scrollLeft = el.scrollWidth;
      return;
    }
    const r = todayCell.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    el.scrollLeft += r.right - c.right + 24;
  }, [strip, range.start, range.end, today]);

  const pick = (d: string) => setPicked((p) => (p === d ? null : d));
  const onKey = (e: React.KeyboardEvent) => {
    const cur = picked ?? (today >= range.start && today <= range.end ? today : range.end);
    const moves: Record<string, number> = strip
      ? { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
      : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const m = moves[e.key];
    if (m == null) return;
    e.preventDefault();
    const next = addDays(cur, m);
    if (next < range.start || next > range.end) return;
    setPicked(next);
    requestAnimationFrame(() =>
      gridRef.current?.querySelector<HTMLElement>(`[data-cal-day="${next}"]`)?.focus(),
    );
  };
  const onHover = (d: string | null, el?: HTMLElement) => {
    if (!d || !el) return setHover(null);
    const box = el.getBoundingClientRect();
    const host = gridRef.current?.parentElement?.getBoundingClientRect();
    if (!host) return;
    setHover({ day: d, x: box.left - host.left + box.width / 2, y: box.top - host.top });
  };
  const lookOf = (d: string) => cellLook(cal, d, mode);
  const labelOf = (d: string) => dayLabel(cal.days.get(d), d);

  const grid = strip ? (
    <ContributionGrid
      weeks={weeks}
      lookOf={lookOf}
      labelOf={labelOf}
      mode={mode}
      picked={picked}
      today={today}
      onPick={compact ? () => onOpen?.() : pick}
      onHover={compact ? undefined : onHover}
    />
  ) : (
    <MonthGrid
      weeks={weeks}
      lookOf={lookOf}
      labelOf={labelOf}
      mode={mode}
      picked={picked}
      today={today}
      onPick={pick}
      onHover={onHover}
      cal={cal}
      kind={kind}
      unit={unit}
    />
  );

  if (compact) {
    return (
      <Card className="p-0" data-performance-calendar="compact">
        <div className="p-4">
          <button
            type="button"
            onClick={onOpen}
            className="flex w-full items-center gap-2 text-left text-[13px] font-medium text-muted-foreground"
            aria-label="Open Calendar"
          >
            <span className="min-w-0 flex-1 truncate">Training calendar · last 16 weeks</span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </button>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {summary.plannedPast
                ? `${summary.plannedDone} of ${summary.plannedPast}`
                : summary.trainingDays}
            </span>
            <span className="text-sm text-muted-foreground">
              {summary.plannedPast ? "planned workouts done" : "training days"}
            </span>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {[
              summary.daysPerWeek != null ? `${summary.daysPerWeek} days a week` : null,
              summary.streakWeeks ? `${summary.streakWeeks}-week streak` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div ref={gridRef} className="relative mt-3">
            {grid}
          </div>
        </div>
      </Card>
    );
  }

  const day = picked ? cal.days.get(picked) : undefined;
  return (
    <Card
      className="space-y-3 p-4"
      data-performance-calendar="full"
      data-cal-range={kind}
      data-cal-mode={mode}
    >
      <LabHeader
        title="Training calendar"
        tip={
          <InfoTip label="About the calendar" title="Training calendar" align="start">
            Every day you trained or had a workout written. Workouts: finished (Finish tapped),
            logged but not finished, missed (a written workout never trained by a day that's over;
            optional ones are never missed) and planned. Volume: working sets, shaded on your own
            range. Strength: your best estimated max that day on its main lift against that
            exercise's best in the 6 months before (hard sets only; a day with no hard set has no
            read). PRs: all-time records. Consistency: how much of each week's plan was done.
          </InfoTip>
        }
      />
      <Seg
        label="Range"
        value={kind}
        options={RANGE_KINDS}
        onChange={(k) => {
          setKind(k);
          setAnchor(today);
          setBlockId(null);
          setPicked(null);
        }}
        stretch
        testId="cal-range"
      />
      {kind !== "all" && <Stepper label={range.label} onPrev={step(-1)} onNext={step(1)} />}
      <Seg
        label="Show"
        value={mode}
        options={CALENDAR_MODES}
        onChange={setMode}
        size="sm"
        stretch="auto"
        testId="cal-mode"
      />

      <div className="grid grid-cols-3 gap-3 border-y border-border/60 py-3" data-cal-summary>
        <Figure
          label="Workouts"
          value={
            summary.plannedPast ? `${summary.plannedDone}/${summary.plannedPast}` : summary.workouts
          }
          sub={
            summary.plannedPast
              ? `planned · ${summary.missed ? `${summary.missed} missed` : "none missed"}`
              : "none written"
          }
        />
        <Figure
          label="Training days"
          value={summary.trainingDays}
          sub={summary.daysPerWeek != null ? `${summary.daysPerWeek} a week` : "no full week yet"}
        />
        {mode === "prs" ? (
          <Figure label="PRs" value={summary.prs} sub="all-time records" />
        ) : mode === "volume" ? (
          <Figure
            label="Working sets"
            value={summary.sets.toLocaleString()}
            sub={`${volumeCompact(summary.volumeLb, unit)} ${unit} lifted`}
          />
        ) : (
          <Figure
            label="Streak"
            value={summary.streakWeeks ? `${summary.streakWeeks} wk` : "—"}
            sub={`longest ${summary.longestStreakWeeks} wk`}
          />
        )}
      </div>

      <div className="relative" onKeyDown={onKey}>
        <div ref={gridRef}>{grid}</div>
        {hover && hover.day !== picked && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-sm"
            style={{ left: hover.x, top: hover.y - 6 }}
            role="tooltip"
          >
            {labelOf(hover.day)}
          </div>
        )}
      </div>
      <Legend mode={mode} />

      {summary.standouts.length > 0 && !picked && (
        <div className="space-y-1" data-cal-standouts>
          <div className="text-[12px] font-medium text-muted-foreground">Standout days</div>
          {summary.standouts.map((s) => (
            <button
              key={`${s.day}-${s.kind}`}
              type="button"
              onClick={() => setPicked(s.day)}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              {s.kind === "pr" ? (
                <Trophy className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
              ) : s.kind === "best" ? (
                <Star className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] bg-[var(--heat-4)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-foreground">{s.text}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {format(new Date(`${s.day}T12:00:00`), "MMM d")}
              </span>
            </button>
          ))}
        </div>
      )}

      {picked && (
        <DayDetail
          day={picked}
          d={day}
          unit={unit}
          coach={coach}
          clientId={clientId}
          onClose={() => setPicked(null)}
        />
      )}
    </Card>
  );
}

function ContributionGrid({
  weeks,
  lookOf,
  labelOf,
  mode,
  picked,
  today,
  onPick,
  onHover,
}: {
  weeks: ReturnType<typeof gridWeeks>;
  lookOf: (d: string) => CellLook;
  labelOf: (d: string) => string;
  mode: CalendarMode;
  picked: string | null;
  today: string;
  onPick: (d: string) => void;
  onHover?: (d: string | null, el?: HTMLElement) => void;
}) {
  return (
    <div className="flex gap-1.5" data-cal-grid="strip">
      <div
        className="flex shrink-0 flex-col gap-[3px] pt-[18px] text-[9px] leading-[13px] text-muted-foreground"
        aria-hidden
      >
        {WEEKDAY_SHORT.map((w, i) => (
          <span key={i} className={cn("h-[13px]", i % 2 === 1 && "opacity-0")}>
            {w}
          </span>
        ))}
      </div>
      <div
        className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-cal-scroll
      >
        <div className="inline-flex gap-[3px]" role="grid" aria-label="Training days">
          {weeks.map((w, wi) => {
            const first = w.days.find(Boolean)!;
            const showMonth =
              wi === 0 ||
              first.slice(5, 7) !== (weeks[wi - 1].days.find(Boolean) ?? "").slice(5, 7);
            return (
              <div key={w.monday} className="flex flex-col gap-[3px]" role="row">
                <span
                  className="h-[15px] whitespace-nowrap text-[10px] leading-[15px] text-muted-foreground"
                  aria-hidden
                >
                  {showMonth ? format(new Date(`${first}T12:00:00`), "MMM") : ""}
                </span>
                {w.days.map((d, i) =>
                  d ? (
                    <Cell
                      key={d}
                      day={d}
                      look={lookOf(d)}
                      mode={mode}
                      size="dot"
                      selected={picked === d}
                      today={d === today}
                      label={labelOf(d)}
                      onPick={onPick}
                      onHover={onHover}
                      className={d > today ? "opacity-60" : undefined}
                    />
                  ) : (
                    <span key={i} className="h-[13px] w-[13px]" />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  weeks,
  lookOf,
  labelOf,
  mode,
  picked,
  today,
  onPick,
  onHover,
  cal,
  kind,
  unit,
}: {
  weeks: ReturnType<typeof gridWeeks>;
  lookOf: (d: string) => CellLook;
  labelOf: (d: string) => string;
  mode: CalendarMode;
  picked: string | null;
  today: string;
  onPick: (d: string) => void;
  onHover?: (d: string | null, el?: HTMLElement) => void;
  cal: Cal;
  kind: RangeKind;
  unit: Unit;
}) {
  const big = kind === "week";
  return (
    <div data-cal-grid={kind} role="grid" aria-label="Training days">
      <div
        className={cn(
          "grid gap-1.5",
          kind === "block" ? "grid-cols-[1.75rem_repeat(7,minmax(0,1fr))]" : "grid-cols-7",
        )}
      >
        {kind === "block" && <span />}
        {WEEKDAY.map((w) => (
          <span
            key={w}
            className="pb-0.5 text-center text-[10px] font-medium text-muted-foreground"
            aria-hidden
          >
            {big ? w : w[0]}
          </span>
        ))}
        {weeks.map((w, wi) => (
          <div key={w.monday} className="contents" role="row">
            {kind === "block" && (
              <span className="flex items-center text-[10px] tabular-nums text-muted-foreground">
                W{wi + 1}
              </span>
            )}
            {w.days.map((d, i) => {
              if (!d) return <span key={i} />;
              const dd = cal.days.get(d);
              const look = lookOf(d);
              const ink = inkFor(mode, look.level);
              return (
                <Cell
                  key={d}
                  day={d}
                  look={look}
                  mode={mode}
                  size="box"
                  selected={picked === d}
                  today={d === today}
                  label={labelOf(d)}
                  onPick={onPick}
                  onHover={onHover}
                  className={cn(
                    "flex flex-col items-start justify-between p-1.5 text-left",
                    big ? "h-24" : "aspect-square min-h-[38px]",
                    d > today && "opacity-80",
                  )}
                >
                  <span
                    className={cn("text-[11px] font-semibold tabular-nums leading-none", ink.num)}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {(look.star || (dd?.prs.length ?? 0) > 0) && !big && (
                    <span
                      className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--warning)] ring-1 ring-[var(--card)]"
                      aria-hidden
                    />
                  )}
                  {big && dd && (dd.sets > 0 || dd.plannedOpen.length > 0) && (
                    <span className={cn("line-clamp-3 text-[10px] leading-tight", ink.sub)}>
                      {dd.sets > 0
                        ? mode === "strength" && dd.strength
                          ? `${Math.round(dd.strength.ratio * 100)}% of recent best`
                          : mode === "volume"
                            ? `${dd.sets} sets · ${volumeCompact(dd.volumeLb, unit)} ${unit}`
                            : mode === "prs"
                              ? `${dd.prs.length} PR${dd.prs.length === 1 ? "" : "s"}`
                              : `${dd.workouts[0]?.title ?? "Workout"} · ${dd.sets} sets`
                        : dd.plannedOpen[0]?.title}
                    </span>
                  )}
                </Cell>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayDetail({
  day,
  d,
  unit,
  coach,
  clientId,
  onClose,
}: {
  day: string;
  d: CalDay | undefined;
  unit: Unit;
  coach: boolean;
  clientId: string;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const date = new Date(`${day}T12:00:00`);
  const head = format(date, "EEEE, MMMM d");
  if (!d || (!d.sets && !d.plannedOpen.length && !d.optionalSkipped)) {
    return (
      <div className="jf-lab-in rounded-xl border border-border p-3" data-cal-detail={day}>
        <DetailHead head={head} chip="Rest" onClose={onClose} />
        <p className="mt-1 text-[13px] text-muted-foreground">
          Nothing logged or written for this day.
        </p>
      </div>
    );
  }
  const chip = {
    done: "Done",
    partial: "Logged, not finished",
    missed: "Missed",
    upcoming: "Planned",
    untracked: "Not tracked",
    rest: "Rest",
  }[d.status];
  const exercises = all ? d.exercises : d.exercises.slice(0, 4);
  return (
    <div className="jf-lab-in space-y-3 rounded-xl border border-border p-3" data-cal-detail={day}>
      <DetailHead head={head} chip={chip} tone={d.status} onClose={onClose} />
      {d.workouts.length > 0 && (
        <ul className="space-y-1">
          {d.workouts.map((w) => (
            <li
              key={`${w.dayId}`}
              className="flex items-baseline justify-between gap-2 text-[13px]"
            >
              <span className="min-w-0 truncate font-medium text-foreground">{w.title}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {[
                  w.finished ? "finished" : "not finished",
                  w.durationMin ? `${w.durationMin} min` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.plannedOpen.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {d.status === "missed"
            ? "Written and not trained: "
            : d.status === "untracked"
              ? "Written before you started logging in the app (not counted as missed): "
              : "Written for this day: "}
          {d.plannedOpen.map((p) => `${p.title}${p.optional ? " (optional)" : ""}`).join(", ")}
        </p>
      )}
      {d.sets > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Figure
            label="Working sets"
            value={d.sets}
            sub={`${d.hardSets} hard${d.unratedSets ? ` · ${d.unratedSets} unrated` : ""}`}
          />
          <Figure label="Reps" value={d.reps.toLocaleString()} />
          <Figure
            label="Volume"
            value={<DualWeight lb={d.volumeLb} unit={unit} size="sm" stacked />}
            sub={d.volumeLb ? undefined : "no external load"}
          />
        </div>
      )}
      {d.strength && (
        <div className="rounded-lg bg-muted/50 p-2.5 text-[13px]" data-cal-strength>
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            {d.strength.newBest && (
              <Star className="h-3.5 w-3.5 text-[var(--warning)]" aria-label="New best estimate" />
            )}
            {d.strength.exercise}: {Math.round(d.strength.ratio * 100)}% of its recent best
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            Estimated max {loadText(d.strength.e1rmLb, unit)} against{" "}
            {loadText(d.strength.priorBestLb, unit)} (best of the 6 months before).
            {d.strength.newBest ? " Your best estimate on file." : ""}
          </div>
        </div>
      )}
      {d.sets > 0 && !d.strength && (
        <p className="text-[12px] text-muted-foreground">
          No strength read: no hard set (RPE 7+, 10 reps or fewer) on a lift with enough history.
        </p>
      )}
      {d.prs.length > 0 && (
        <div className="space-y-1" data-cal-prs>
          {d.prs.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <Trophy className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
              <span className="min-w-0 flex-1 truncate text-foreground">{p.exercise}</span>
              <span className="shrink-0 tabular-nums text-foreground">
                {loadText(p.load, unit)} × {p.reps}
                {p.rpe != null ? <span className="text-muted-foreground"> @{p.rpe}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {d.exercises.length > 0 && (
        <div className="space-y-2" data-cal-exercises>
          {exercises.map((ex) => (
            <div key={`${ex.key}-${ex.dayId}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                  {ex.name}
                </span>
                {ex.bestE1rm != null && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    est. max {loadText(ex.bestE1rm, unit)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] tabular-nums text-muted-foreground">
                {ex.sets.map((s) => (
                  <span key={s.id} className={cn(s.pr && "font-semibold text-foreground")}>
                    {s.loadType === "bodyweight"
                      ? `BW × ${s.reps}`
                      : s.loadType === "assisted"
                        ? `−${loadText(s.assistLb ?? 0, unit)} × ${s.reps}`
                        : s.load > 0
                          ? `${loadText(s.load, unit)} × ${s.reps}`
                          : `× ${s.reps}`}
                    {s.rpe != null ? ` @${s.rpe}` : s.rir != null ? ` ${s.rir} RIR` : ""}
                    {s.pr ? " PR" : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {d.exercises.length > 4 && (
            <button
              type="button"
              className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setAll((v) => !v)}
            >
              {all ? "Show fewer" : `All ${d.exercises.length} exercises`}
            </button>
          )}
        </div>
      )}
      {d.checkout && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground"
          data-cal-checkout
        >
          <Moon className="h-3.5 w-3.5" aria-hidden />
          {d.checkout.sleepBucket && (
            <span>Slept {SLEEP_WORDS[d.checkout.sleepBucket] ?? d.checkout.sleepBucket}</span>
          )}
          {d.checkout.recovery != null && <span>felt {d.checkout.recovery}/5 recovered</span>}
          {d.checkout.pain ? <span className="text-foreground">pain reported</span> : null}
        </div>
      )}
      {d.workouts.some((w) => w.dayId) && (
        <div className="flex flex-wrap gap-2">
          {d.workouts
            .filter((w) => w.dayId)
            .map((w) =>
              coach ? (
                <Button key={w.dayId} asChild size="sm" variant="outline" className="h-10">
                  <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
                    Open in their program
                  </Link>
                </Button>
              ) : (
                <Button key={w.dayId} asChild size="sm" variant="outline" className="h-10">
                  <Link to="/portal/workouts/$dayId" params={{ dayId: w.dayId! }}>
                    Open {d.workouts.length > 1 ? w.title : "workout"}
                  </Link>
                </Button>
              ),
            )}
        </div>
      )}
    </div>
  );
}

function DetailHead({
  head,
  chip,
  tone,
  onClose,
}: {
  head: string;
  chip: string;
  tone?: CalDay["status"];
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
        {head}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
          tone === "done"
            ? "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-[var(--success)]"
            : tone === "missed"
              ? "bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] text-[var(--destructive)]"
              : "bg-muted text-muted-foreground",
        )}
      >
        {chip}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md px-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        aria-label="Close day"
      >
        Close
      </button>
    </div>
  );
}
