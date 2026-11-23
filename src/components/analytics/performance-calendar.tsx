/**
 * The performance calendar: a square per day (performance-calendar.ts),
 * coloured for the metric picked, laid out for the span (a month grid, weeks
 * as columns, a strip per year). A tap or hover opens the day's detail under
 * the grid, with the workout one tap away. Rest, missed, partly done, planned
 * and no-data days each look different, and none of them is a zero.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronRight, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import {
  calendarLayout,
  calendarTotals,
  CALENDAR_METRICS,
  MIN_CELL,
  monthBlocks,
  weekColumns,
  type CalendarMetric,
  type DaySummary,
} from "@/lib/analytics/performance-calendar";
import { ChipRow, useWidth, LB_PER_KG } from "@/components/analytics/viz";

/** Each metric's one hue (sequential: light to dark of one hue, never a rainbow). */
const HUE: Record<CalendarMetric, string> = {
  activity: "var(--success)",
  strength: "var(--success)",
  volume: "var(--chart-4)",
  intensity: "var(--chart-2)",
  prs: "var(--warning)",
};
const STEPS = [0, 24, 48, 74, 100];
export function levelColor(metric: CalendarMetric, level: number): string {
  if (level <= 0) return "transparent";
  return `color-mix(in oklch, ${HUE[metric]} ${STEPS[Math.min(4, level)]}%, var(--muted))`;
}

const LEGEND: Record<CalendarMetric, [string, string]> = {
  activity: ["Fewer sets", "More sets"],
  strength: ["Below best", "New best"],
  volume: ["Less weight moved", "More"],
  intensity: ["Easier", "Harder (RPE)"],
  prs: ["1 record", "3+"],
};

export type DayMeta = { title: string | null; block: string | null; week: number | null };

const fmt = (d: string, f: string) => {
  const x = parseLocalDate(d);
  return x ? format(x, f) : d;
};

function Cell({
  d,
  metric,
  size,
  picked,
  today,
  onPick,
  showDate,
}: {
  d: DaySummary | null;
  metric: CalendarMetric;
  size: number;
  picked: boolean;
  today: string;
  onPick: (d: DaySummary) => void;
  showDate?: boolean;
}) {
  if (!d) return <span style={{ width: size, height: size }} aria-hidden />;
  const filled = d.level > 0;
  const radius = Math.max(2, Math.round(size / 5));
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius };
  let cls = "";
  if (d.state === "done" || d.state === "partial") style.background = levelColor(metric, d.level);
  else if (d.state === "rest") cls = "bg-muted/60";
  else if (d.state === "missed") cls = "border-[1.5px] border-destructive/55";
  else if (d.state === "planned" || d.state === "today")
    cls = "border border-dashed border-muted-foreground/45";
  else if (d.state === "future") cls = "bg-muted/25";
  else cls = "bg-muted/20";
  const label = `${fmt(d.day, "EEE, MMM d")}: ${
    d.state === "done"
      ? `${d.sets} sets`
      : d.state === "partial"
        ? `partly done, ${d.sets} of ${d.plannedSets} sets`
        : d.state === "missed"
          ? "missed"
          : d.state === "rest"
            ? "rest"
            : d.state === "planned" || d.state === "today"
              ? "planned"
              : "no data"
  }${d.prs.length ? `, ${d.prs.length} record${d.prs.length > 1 ? "s" : ""}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => onPick(d)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onPick(d);
      }}
      aria-label={label}
      aria-pressed={picked}
      className={cn(
        "relative shrink-0 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring",
        cls,
        picked && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
        d.day === today && !picked && "ring-1 ring-foreground/70",
      )}
      style={style}
      data-cal-day={d.day}
      data-cal-state={d.state}
      data-cal-level={d.level}
    >
      {d.state === "partial" && filled && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-[inherit]"
          style={{
            background: "linear-gradient(135deg, transparent 50%, var(--card) 50%)",
            opacity: 0.55,
          }}
        />
      )}
      {showDate && (
        <span
          className={cn(
            "absolute left-1 top-0.5 text-[10px] font-medium tabular-nums",
            d.level >= 3 ? "text-background" : "text-muted-foreground",
          )}
        >
          {Number(d.day.slice(8, 10))}
        </span>
      )}
      {showDate && d.prs.length > 0 && (
        <Trophy className="absolute bottom-1 right-1 h-2.5 w-2.5 text-warning" aria-hidden />
      )}
    </button>
  );
}

export function PerformanceCalendar({
  days: allDays,
  metric,
  onMetric,
  today,
  unit,
  dayMeta,
  onOpenWorkout,
}: {
  days: DaySummary[];
  metric: CalendarMetric;
  onMetric: (m: CalendarMetric) => void;
  today: string;
  unit: "lb" | "kg";
  dayMeta?: Map<string, DayMeta>;
  onOpenWorkout?: (dayId: string) => void;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [picked, setPicked] = useState<string | null>(null);
  // days before the first logged workout aren't drawn (the period says where it starts)
  const days = useMemo(() => {
    const i = allDays.findIndex((d) => d.state !== "none");
    return i > 0 ? allDays.slice(i) : allDays;
  }, [allDays]);
  const start = days[0]?.day ?? today;
  const end = days[days.length - 1]?.day ?? today;
  const layout = calendarLayout(start, end, width);
  const totals = useMemo(() => calendarTotals(days), [days]);
  const pickedDay = days.find((d) => d.day === picked) ?? null;

  const gap = layout === "month" ? 6 : 3;
  let grid: React.ReactNode;
  if (layout === "month") {
    const cols = weekColumns(days);
    const size = Math.min(46, Math.floor((width - gap * 6) / 7));
    grid = (
      <div>
        <div
          className="mb-1 grid text-center text-[10px] font-medium text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(7, ${size}px)`, columnGap: gap }}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d.slice(0, size < 34 ? 1 : 3)}</span>
          ))}
        </div>
        <div className="flex flex-col" style={{ rowGap: gap }}>
          {cols.map((w, i) => (
            <div key={i} className="flex" style={{ columnGap: gap }}>
              {w.map((d, j) => (
                <Cell
                  key={j}
                  d={d}
                  metric={metric}
                  size={size}
                  picked={picked === d?.day}
                  today={today}
                  onPick={(x) => setPicked(x.day)}
                  showDate
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (layout === "weeks") {
    // weeks as columns (Monday on top), only when they fit the width
    const cols = weekColumns(days);
    const labelW = 14;
    const size = Math.max(MIN_CELL, Math.min(18, Math.floor((width - labelW) / cols.length) - gap));
    let lastMonth = "";
    grid = (
      <div data-cal-weeks>
        <div className="flex" style={{ columnGap: gap, marginLeft: labelW }}>
          {cols.map((c, i) => {
            const first = c.find(Boolean)!;
            const m = first.day.slice(0, 7);
            const show = m !== lastMonth && (first.day.slice(8, 10) <= "07" || i === 0);
            if (show) lastMonth = m;
            return (
              <span
                key={i}
                className="relative h-3.5 text-[10px] text-muted-foreground"
                style={{ width: size }}
              >
                {show ? (
                  <span className="absolute left-0 whitespace-nowrap">{fmt(first.day, "MMM")}</span>
                ) : null}
              </span>
            );
          })}
        </div>
        <div className="flex" style={{ columnGap: gap }}>
          <div
            className="flex flex-col text-[9px] leading-none text-muted-foreground"
            style={{ width: labelW - gap, rowGap: gap }}
          >
            {["M", "", "W", "", "F", "", ""].map((l, i) => (
              <span key={i} className="flex items-center" style={{ height: size }}>
                {l}
              </span>
            ))}
          </div>
          {cols.map((col, i) => (
            <div key={i} className="flex flex-col" style={{ rowGap: gap }}>
              {col.map((d, j) => (
                <Cell
                  key={j}
                  d={d}
                  metric={metric}
                  size={size}
                  picked={picked === d?.day}
                  today={today}
                  onPick={(x) => setPicked(x.day)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  } else {
    // small month calendars that wrap: a year on a phone stays readable
    const months = monthBlocks(days);
    const perRow = Math.max(2, Math.min(4, Math.floor((width + 16) / 112)));
    const colW = (width - 16 * (perRow - 1)) / perRow;
    const size = Math.max(MIN_CELL, Math.min(16, Math.floor((colW - 6 * 2) / 7)));
    const multiYear = days[0]?.day.slice(0, 4) !== days[days.length - 1]?.day.slice(0, 4);
    grid = (
      <div
        className="grid gap-x-4 gap-y-3"
        style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
        data-cal-months
      >
        {months.map((m) => (
          <div key={m.key} className="min-w-0">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              {fmt(
                `${m.key}-01`,
                multiYear && (m.key.endsWith("-01") || m === months[0]) ? "MMM yyyy" : "MMM",
              )}
            </div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(7, ${size}px)`, gap: 2 }}>
              {m.cells.map((d, i) => (
                <Cell
                  key={i}
                  d={d}
                  metric={metric}
                  size={size}
                  picked={picked === d?.day}
                  today={today}
                  onPick={(x) => setPicked(x.day)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const summary = [
    `${totals.trained} workout${totals.trained === 1 ? "" : "s"}`,
    totals.planned
      ? `${Math.round((totals.plannedDone / totals.planned) * 100)}% of planned`
      : null,
    totals.bestStreak >= 2 ? `best run ${totals.bestStreak} weeks` : null,
    totals.prs ? `${totals.prs} record${totals.prs === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div data-performance-calendar data-cal-layout={layout} data-cal-metric={metric}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] text-muted-foreground">
          {summary.join(" · ")}
        </p>
      </div>
      <ChipRow
        value={metric}
        options={CALENDAR_METRICS}
        onChange={(m) => onMetric(m)}
        label="Calendar metric"
        className="mb-3"
      />
      <div ref={wrapRef} className="w-full">
        {grid}
      </div>
      <CalendarKey metric={metric} />
      {pickedDay ? (
        <DayDetail
          d={pickedDay}
          unit={unit}
          meta={pickedDay.dayIds.map((id) => dayMeta?.get(id)).find(Boolean) ?? null}
          onOpen={onOpenWorkout}
          onClose={() => setPicked(null)}
        />
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground">Tap a day to see the workout.</p>
      )}
    </div>
  );
}

function CalendarKey({ metric }: { metric: CalendarMetric }) {
  const [lo, hi] = LEGEND[metric];
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground"
      data-cal-key
    >
      <span className="inline-flex items-center gap-1.5">
        {lo}
        {[1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: levelColor(metric, l) }}
          />
        ))}
        {hi}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-muted/60" /> Rest
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-destructive/55" /> Missed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-muted-foreground/45" />{" "}
        Planned
      </span>
    </div>
  );
}

function DayDetail({
  d,
  unit,
  meta,
  onOpen,
  onClose,
}: {
  d: DaySummary;
  unit: "lb" | "kg";
  meta: DayMeta | null;
  onOpen?: (dayId: string) => void;
  onClose: () => void;
}) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const w = (lb: number) =>
    `${Math.round(conv(lb) * (unit === "kg" ? 2 : 1)) / (unit === "kg" ? 2 : 1)}`;
  const stateWord =
    d.state === "missed"
      ? "Missed"
      : d.state === "rest"
        ? "Rest day"
        : d.state === "planned" || d.state === "today"
          ? "Planned"
          : d.state === "none"
            ? "Before your first logged workout"
            : d.state === "future"
              ? "Nothing planned"
              : null;
  return (
    <div
      className="mt-3 rounded-xl bg-muted/50 p-3 text-[13px]"
      data-cal-detail={d.day}
      role="region"
      aria-label={`Details for ${fmt(d.day, "EEEE, MMMM d")}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground">{fmt(d.day, "EEEE, MMM d, yyyy")}</div>
          {meta?.title && (
            <div className="truncate text-muted-foreground">
              {meta.title}
              {meta.block ? ` · ${meta.block}` : ""}
            </div>
          )}
          {stateWord && <div className="text-muted-foreground">{stateWord}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 h-8 shrink-0 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Close day details"
        >
          Close
        </button>
      </div>
      {d.sets > 0 && (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
            <span>
              <span className="block text-[11px] text-muted-foreground">Sets</span>
              <span className="font-semibold text-foreground">
                {d.sets}
                {d.plannedSets ? (
                  <span className="font-normal text-muted-foreground"> / {d.plannedSets}</span>
                ) : null}
              </span>
            </span>
            <span>
              <span className="block text-[11px] text-muted-foreground">Moved</span>
              <span className="font-semibold text-foreground">
                {Math.round(conv(d.tonnageLb)).toLocaleString()} {unit}
              </span>
            </span>
            <span>
              <span className="block text-[11px] text-muted-foreground">Avg RPE</span>
              <span className="font-semibold text-foreground">{d.avgRpe ?? "—"}</span>
            </span>
          </div>
          {d.topSets.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {d.topSets.slice(0, 3).map((t) => (
                <li key={t.exercise} className="flex justify-between gap-2">
                  <span className="truncate text-muted-foreground">{t.exercise}</span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {w(t.load)} {unit} × {t.reps}
                    {t.rpe ? <span className="text-muted-foreground"> @{t.rpe}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(d.prs.length > 0 || d.strength) && (
            <div className="mt-2 space-y-0.5 text-[12px]">
              {d.prs.map((p) => (
                <div key={p.exercise} className="flex items-center gap-1.5 text-foreground">
                  <Trophy className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> Record:{" "}
                  {p.exercise} {w(p.load)} {unit} × {p.reps}
                </div>
              ))}
              {d.strength &&
                d.strength.pct > 0 &&
                !d.prs.some((p) => p.exercise === d.strength!.exercise) && (
                  <div className="text-success">
                    {d.strength.exercise}: estimate {d.strength.pct > 0 ? "+" : ""}
                    {d.strength.pct}% on its recent best
                  </div>
                )}
            </div>
          )}
          {onOpen && d.dayIds[0] && (
            <button
              type="button"
              onClick={() => onOpen(d.dayIds[0])}
              className="mt-2 inline-flex min-h-10 items-center gap-0.5 text-[13px] font-medium text-foreground"
              data-cal-open
            >
              Open workout <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </>
      )}
    </div>
  );
}
