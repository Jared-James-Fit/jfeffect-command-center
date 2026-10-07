import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SearchableSelect, type SearchableOption } from "@/components/analytics/searchable-select";
import type { GraphDotPoint } from "@/components/analytics/graph-dot-detail";
import {
  ANALYTICS_COLORS,
  exerciseColor,
  exerciseGroup,
  fmtNum,
  liftFamily,
} from "@/lib/analytics-format";
import {
  e1rmTrendPerWeek,
  fmtEffort,
  groupLiftSessions,
  repMaxes,
  sameLoadEffortChange,
  sessionNotation,
  setEffort,
  type LiftSession,
  type LiftSetInput,
} from "@/lib/analytics/lift-sessions";

type Unit = "lb" | "kg";
type Metric = "est" | "top" | "volume" | "effort" | "velocity";

export type LiftHistoryPoint = LiftSetInput & {
  day_id?: string | null;
  exercise_note?: string | null;
  duration_seconds?: number | null;
  muscle_group?: string | null;
  category?: string | null;
};

export type LiftHistory = { name: string; pr: LiftHistoryPoint | null; points: LiftHistoryPoint[] };

const METRICS: { key: Metric; label: string }[] = [
  { key: "est", label: "e1RM" },
  { key: "top", label: "Top set" },
  { key: "volume", label: "Volume" },
  { key: "effort", label: "RPE" },
  { key: "velocity", label: "Velocity" },
];

const SESSIONS_SHOWN = 3;

/**
 * Lift Progress — one lift, the way a strength coach reads it.
 *
 * One chart point per session (its best set), so back-offs never draw a fake
 * drop. Touch or drag the chart to inspect a session in the readout above
 * it; "Details" opens the full set sheet only when asked. Below: trend,
 * work done, rep maxes, a same-load effort signal and the session log.
 */
export function LiftProgressCard({
  history,
  displayUnit,
  conv,
  onOpenSet,
}: {
  history: LiftHistory[];
  displayUnit: Unit;
  /** lb → display unit. */
  conv: (lb: number) => number;
  onOpenSet: (point: GraphDotPoint) => void;
}) {
  const [selectedEx, setSelectedEx] = useState("");
  const [metric, setMetric] = useState<Metric>("est");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const sessionsByEx = useMemo(
    () => new Map(history.map((h) => [h.name, groupLiftSessions(h.points)])),
    [history],
  );

  // Quick picks: competition lifts first, then the most-trained lifts.
  const quickPicks = useMemo(
    () =>
      [...history]
        .map((h) => ({
          name: h.name,
          n: sessionsByEx.get(h.name)?.length ?? 0,
          big3: liftFamily(h.name) ? 1 : 0,
        }))
        .sort((a, b) => b.big3 - a.big3 || b.n - a.n || a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((x) => x.name),
    [history, sessionsByEx],
  );

  const activeEx = history.some((h) => h.name === selectedEx) ? selectedEx : (quickPicks[0] ?? "");
  const series = history.find((h) => h.name === activeEx);
  const sessions = useMemo(() => sessionsByEx.get(activeEx) ?? [], [sessionsByEx, activeEx]);
  const color = exerciseColor(activeEx, series?.points?.[0]?.muscle_group);
  const hasVelocity = sessions.some((s) => s.velocity != null);
  const activeMetric: Metric = metric === "velocity" && !hasVelocity ? "est" : metric;

  const fmtLoad = (lb: number) => fmtNum(conv(lb));
  const prKey = useMemo(
    () =>
      sessions.reduce<LiftSession | null>((b, s) => (!b || s.e1rm > b.e1rm ? s : b), null)?.key ??
      null,
    [sessions],
  );

  const chartData = useMemo(
    () =>
      sessions.map((s) => ({
        key: s.key,
        est: round1(conv(s.e1rm)),
        top: round1(conv(s.heaviest.load)),
        volume: Math.round(conv(s.tonnage)),
        effort: s.avgEffort,
        velocity: s.velocity,
      })),
    [sessions, conv],
  );

  const selIdx = Math.max(
    0,
    selectedKey ? sessions.findIndex((s) => s.key === selectedKey) : sessions.length - 1,
  );
  const selected = sessions[selIdx] ?? null;
  const previous = selIdx > 0 ? sessions[selIdx - 1] : null;

  function selectExercise(name: string) {
    setSelectedEx(name);
    setSelectedKey(null);
    setOpenSession(null);
    setShowAllSessions(false);
  }

  // Recharts routes touchstart/touchmove through onMouseDown/onMouseMove
  // (while a Tooltip is mounted), so a tap or a drag inspects; nothing opens.
  function inspect(state: { activeTooltipIndex?: number } | null) {
    const i = state?.activeTooltipIndex;
    if (typeof i === "number" && i >= 0 && sessions[i]) setSelectedKey(sessions[i].key);
  }

  function toPoint(s: LiftHistoryPoint): GraphDotPoint {
    return {
      id: s.id,
      row_id: s.row_id ?? "",
      day_id: s.day_id ?? null,
      date: s.date,
      exercise_name: activeEx,
      load: s.load,
      reps: s.reps,
      est_1rm: s.est_1rm,
      rpe: s.rpe != null ? String(s.rpe) : null,
      rir: s.rir != null ? String(s.rir) : null,
      velocity_mps: s.velocity_mps ?? null,
      exercise_note: s.exercise_note ?? null,
      duration_seconds: s.duration_seconds ?? null,
      set_index: s.set_index ?? 1,
      displayUnit,
      displayLoad: conv(s.load),
    };
  }

  const value = (s: LiftSession, m: Metric): number | null =>
    m === "est"
      ? conv(s.e1rm)
      : m === "top"
        ? conv(s.heaviest.load)
        : m === "volume"
          ? conv(s.tonnage)
          : m === "effort"
            ? s.avgEffort
            : s.velocity;

  const exerciseOptions: SearchableOption[] = useMemo(
    () =>
      history.map((h) => ({
        value: h.name,
        label: h.name,
        group: exerciseGroup(h.name, h.points?.[0]?.category),
        hint: `${fmtNum(conv(h.pr?.est_1rm ?? 0))} ${displayUnit}`,
        keywords: [
          liftFamily(h.name) ?? "",
          h.points?.[0]?.muscle_group ?? "",
          h.points?.[0]?.category ?? "",
        ].filter(Boolean),
        color: exerciseColor(h.name, h.points?.[0]?.muscle_group),
      })),
    [history, conv, displayUnit],
  );

  const totals = useMemo(() => {
    let sets = 0;
    let reps = 0;
    let tonnage = 0;
    let effortSum = 0;
    let effortN = 0;
    for (const s of sessions) {
      sets += s.setCount;
      reps += s.reps;
      tonnage += s.tonnage;
      for (const set of s.sets) {
        const e = setEffort(set);
        if (e) {
          effortSum += e.value;
          effortN += 1;
        }
      }
    }
    return { sets, reps, tonnage, avgEffort: effortN ? effortSum / effortN : null };
  }, [sessions]);

  const trend = useMemo(() => e1rmTrendPerWeek(sessions), [sessions]);
  const maxes = useMemo(() => repMaxes(series?.points ?? []).slice(0, 6), [series]);
  const effortChange = useMemo(() => sameLoadEffortChange(sessions), [sessions]);
  const velocityInsight = useVelocityInsight(series?.points ?? [], activeEx, displayUnit, conv);

  if (!history.length) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No loaded sets in this period yet.
      </Card>
    );
  }

  const visibleSessions = [...sessions]
    .reverse()
    .slice(0, showAllSessions ? undefined : SESSIONS_SHOWN);

  return (
    <Card className="space-y-4 border-border/80 bg-card p-4">
      <div className="space-y-2">
        <SearchableSelect
          options={exerciseOptions}
          value={activeEx}
          onChange={selectExercise}
          placeholder="Select exercise"
          searchPlaceholder="Search exercise, lift, or muscle…"
          emptyText="No exercises match your search."
          triggerClassName="h-11"
          ariaLabel="Select exercise"
        />
        {quickPicks.length > 1 && (
          <div
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]"
            role="group"
            aria-label="Quick lift picks"
          >
            {quickPicks.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => selectExercise(name)}
                aria-pressed={name === activeEx}
                title={name}
                className={cn(
                  "h-9 shrink-0 rounded-full border px-3 text-xs font-bold transition-colors",
                  name === activeEx
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-secondary",
                )}
              >
                {chipLabel(name)}
              </button>
            ))}
          </div>
        )}
      </div>

      {series && selected ? (
        <>
          <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              <span className="font-bold text-foreground">
                PR {fmtLoad(series.pr?.est_1rm ?? 0)} {displayUnit}
              </span>{" "}
              e1RM
              {series.pr?.date ? ` · ${format(new Date(series.pr.date), "MMM d, yyyy")}` : ""}
            </span>
            <span className="shrink-0 font-semibold">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </span>
          </div>

          <div
            role="tablist"
            aria-label="Chart metric"
            className={cn(
              "grid gap-1 rounded-xl bg-muted/50 p-1",
              hasVelocity ? "grid-cols-5" : "grid-cols-4",
            )}
          >
            {METRICS.filter((m) => m.key !== "velocity" || hasVelocity).map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={activeMetric === m.key}
                onClick={() => setMetric(m.key)}
                className={cn(
                  "h-9 rounded-lg text-xs font-bold transition-colors",
                  activeMetric === m.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <SessionReadout
            session={selected}
            previous={previous}
            metric={activeMetric}
            value={value}
            isLatest={selIdx === sessions.length - 1}
            isPr={selected.key === prKey}
            displayUnit={displayUnit}
            fmtLoad={fmtLoad}
            onDetails={() =>
              onOpenSet(toPoint(activeMetric === "top" ? selected.heaviest : selected.top))
            }
          />

          {sessions.length > 1 ? (
            <div className="h-56 touch-pan-y select-none sm:h-72" data-testid="lift-progress-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
                  onMouseDown={inspect}
                  onMouseMove={inspect}
                  onClick={inspect}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="color-mix(in oklab, var(--border) 60%, transparent)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="key"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickMargin={6}
                    interval="preserveStartEnd"
                    minTickGap={18}
                    tickFormatter={(k: string) => format(parseISO(k), "MMM d")}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={44}
                    tickFormatter={(v: number) => compact(v)}
                    domain={
                      activeMetric === "effort"
                        ? [(min: number) => Math.max(0, Math.floor(min) - 1), 10]
                        : activeMetric === "volume" || activeMetric === "velocity"
                          ? [0, "auto"]
                          : ["auto", "auto"]
                    }
                    allowDecimals={activeMetric === "velocity" || activeMetric === "effort"}
                  />
                  {/* Mounted only so Recharts wires touch; the readout replaces the floating tooltip. */}
                  <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
                  <ReferenceLine
                    x={selected.key}
                    stroke={color}
                    strokeOpacity={0.45}
                    strokeDasharray="3 3"
                  />
                  {activeMetric === "volume" ? (
                    <Bar
                      dataKey="volume"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                      maxBarSize={28}
                    >
                      {chartData.map((d) => (
                        <Cell
                          key={d.key}
                          fill={color}
                          fillOpacity={d.key === selected.key ? 1 : 0.45}
                        />
                      ))}
                    </Bar>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey={activeMetric}
                      stroke={color}
                      strokeWidth={2.5}
                      connectNulls
                      isAnimationActive={false}
                      activeDot={false}
                      dot={(p: {
                        cx?: number;
                        cy?: number;
                        payload?: { key: string };
                        value?: number | null;
                      }) => {
                        if (p.cx == null || p.cy == null || p.value == null)
                          return <g key={p.payload?.key} />;
                        const isSel = p.payload?.key === selected.key;
                        const isPr = activeMetric === "est" && p.payload?.key === prKey;
                        return (
                          <circle
                            key={p.payload?.key}
                            cx={p.cx}
                            cy={p.cy}
                            r={isSel ? 7 : isPr ? 5 : 3.5}
                            fill={isPr ? ANALYTICS_COLORS.green : color}
                            stroke={isSel ? "var(--background)" : "none"}
                            strokeWidth={isSel ? 2.5 : 0}
                          />
                        );
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border/70 px-4 py-3 text-center text-xs text-muted-foreground">
              Log this lift in another session to see a trend.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Tile
              label="e1RM trend"
              value={
                trend == null
                  ? "—"
                  : `${trend >= 0 ? "+" : ""}${fmtNum(conv(trend))} ${displayUnit}/wk`
              }
              sub={
                trend == null
                  ? "Needs 3+ sessions over 2+ weeks"
                  : `Fitted across ${sessions.length} sessions`
              }
              tone={trend == null ? undefined : trend > 0 ? "up" : trend < 0 ? "down" : undefined}
            />
            <Tile
              label="Sets · Reps"
              value={`${totals.sets} · ${totals.reps}`}
              sub={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
            />
            <Tile
              label="Volume"
              value={`${Math.round(conv(totals.tonnage)).toLocaleString()} ${displayUnit}`}
              sub={
                sessions.length
                  ? `≈${Math.round(conv(totals.tonnage / sessions.length)).toLocaleString()} per session`
                  : undefined
              }
            />
            <Tile
              label="Avg RPE"
              value={totals.avgEffort == null ? "—" : fmtNum(totals.avgEffort)}
              sub={totals.avgEffort == null ? "Not logged yet" : "All logged sets"}
            />
          </div>

          {maxes.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Rep maxes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {maxes.map((m) => (
                  <span
                    key={m.reps}
                    className="inline-flex items-baseline gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5"
                    title={format(new Date(m.date), "MMM d, yyyy")}
                  >
                    <span className="text-[11px] font-bold text-muted-foreground">{m.reps}RM</span>
                    <span className="text-sm font-black tabular-nums">{fmtLoad(m.load)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {effortChange && (
            <div
              className={cn(
                "flex gap-2.5 rounded-xl border p-3 text-xs",
                effortChange.delta < 0
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-amber-500/30 bg-amber-500/10",
              )}
            >
              {effortChange.delta < 0 ? (
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              )}
              <p>
                <span className="font-bold">
                  {fmtLoad(effortChange.load)} {displayUnit} × {effortChange.reps}
                </span>{" "}
                went from {fmtEffort(effortChange.from)} to {fmtEffort(effortChange.to)} since{" "}
                {format(new Date(effortChange.from.date), "MMM d")}.{" "}
                <span className="text-muted-foreground">
                  {effortChange.delta < 0
                    ? "Same weight, less effort: you're getting stronger."
                    : "Same weight felt harder. Check sleep, stress and fatigue."}
                </span>
              </p>
            </div>
          )}

          {velocityInsight}

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Sessions
            </div>
            <ul className="space-y-1.5" data-testid="lift-session-log">
              {visibleSessions.map((s) => {
                const idx = sessions.indexOf(s);
                const prev = idx > 0 ? sessions[idx - 1] : null;
                const delta = prev ? conv(s.e1rm) - conv(prev.e1rm) : null;
                const expanded = openSession === s.key;
                const isSel = s.key === selected.key;
                return (
                  <li
                    key={s.key}
                    className={cn(
                      "overflow-hidden rounded-xl border bg-background",
                      isSel ? "border-primary/50" : "border-border",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKey(s.key);
                        setOpenSession(expanded ? null : s.key);
                      }}
                      aria-expanded={expanded}
                      className="grid w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 text-left"
                    >
                      <span className="leading-tight">
                        <span className="block whitespace-nowrap text-sm font-black tabular-nums">
                          {format(parseISO(s.key), "MMM d")}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {format(parseISO(s.key), "EEE")}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-[13px] font-semibold tabular-nums">
                          {sessionNotation(s.sets, fmtLoad)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {s.setCount} {s.setCount === 1 ? "set" : "sets"} · {s.reps} reps ·{" "}
                          {Math.round(conv(s.tonnage)).toLocaleString()} {displayUnit}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-right leading-tight">
                          <span className="block text-sm font-black tabular-nums">
                            {fmtLoad(s.e1rm)}
                          </span>
                          <span
                            className={cn(
                              "block text-[11px] font-semibold tabular-nums",
                              delta == null || Math.abs(delta) < 0.05
                                ? "text-muted-foreground"
                                : delta > 0
                                  ? "text-emerald-500"
                                  : "text-rose-500",
                            )}
                          >
                            {delta == null || Math.abs(delta) < 0.05
                              ? "e1RM"
                              : `${delta > 0 ? "▲" : "▼"} ${fmtNum(Math.abs(delta))}`}
                          </span>
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </span>
                    </button>
                    {expanded && (
                      <ul className="border-t border-border/70 bg-muted/20">
                        {s.sets.map((set, i) => {
                          const e = setEffort(set);
                          return (
                            <li key={set.id}>
                              <button
                                type="button"
                                onClick={() => onOpenSet(toPoint(set as LiftHistoryPoint))}
                                className="grid min-h-11 w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary/60"
                              >
                                <span className="text-[11px] font-bold text-muted-foreground">
                                  Set {i + 1}
                                </span>
                                <span className="tabular-nums">
                                  <span className="font-bold">
                                    {fmtLoad(set.load)} × {set.reps}
                                  </span>
                                  {e && (
                                    <span className="text-muted-foreground"> · {fmtEffort(e)}</span>
                                  )}
                                </span>
                                <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                                  {fmtLoad(set.est_1rm)}
                                  <ChevronRight className="h-4 w-4" />
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {sessions.length > SESSIONS_SHOWN && (
              <button
                type="button"
                onClick={() => setShowAllSessions((v) => !v)}
                className="mt-1.5 h-10 w-full rounded-lg text-xs font-bold text-primary hover:bg-secondary"
              >
                {showAllSessions ? "Show fewer" : `Show all ${sessions.length} sessions`}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Select an exercise to see progress.
        </div>
      )}
    </Card>
  );
}

function SessionReadout({
  session,
  previous,
  metric,
  value,
  isLatest,
  isPr,
  displayUnit,
  fmtLoad,
  onDetails,
}: {
  session: LiftSession;
  previous: LiftSession | null;
  metric: Metric;
  value: (s: LiftSession, m: Metric) => number | null;
  isLatest: boolean;
  isPr: boolean;
  displayUnit: Unit;
  fmtLoad: (lb: number) => string;
  onDetails: () => void;
}) {
  const v = value(session, metric);
  const pv = previous ? value(previous, metric) : null;
  const delta = v != null && pv != null ? v - pv : null;
  const heaviestEffort = setEffort(session.heaviest);

  const main =
    v == null
      ? "—"
      : metric === "volume"
        ? Math.round(v).toLocaleString()
        : metric === "velocity"
          ? v.toFixed(2)
          : fmtNum(v);
  const unit =
    metric === "est"
      ? `${displayUnit} e1RM`
      : metric === "top"
        ? `${displayUnit} × ${session.heaviest.reps}${heaviestEffort ? ` · ${fmtEffort(heaviestEffort)}` : ""}`
        : metric === "volume"
          ? `${displayUnit} moved`
          : metric === "effort"
            ? v == null
              ? "RPE not logged"
              : "avg RPE"
            : "m/s";
  // Effort going up isn't "better", so it stays neutral.
  const good = metric === "effort" ? null : delta == null ? null : delta > 0;
  const showDelta = delta != null && Math.abs(delta) >= (metric === "velocity" ? 0.005 : 0.05);

  return (
    <div
      className="rounded-xl bg-muted/40 px-3 py-2.5"
      aria-live="polite"
      data-testid="lift-readout"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {format(parseISO(session.key), "EEE · MMM d, yyyy")}
          {isLatest && " · Latest"}
        </div>
        <button
          type="button"
          onClick={onDetails}
          className="-my-1 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg px-2 text-xs font-bold text-primary hover:bg-secondary"
        >
          Details <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-black tabular-nums">{main}</span>
        <span className="text-xs font-semibold text-muted-foreground">{unit}</span>
        {showDelta && (
          <span
            className={cn(
              "text-xs font-bold tabular-nums",
              good == null ? "text-muted-foreground" : good ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {delta! > 0 ? "▲" : "▼"}{" "}
            {metric === "velocity" ? Math.abs(delta!).toFixed(2) : fmtNum(Math.abs(delta!))} vs last
          </span>
        )}
        {isPr && metric === "est" && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: `color-mix(in oklab, ${ANALYTICS_COLORS.green} 18%, transparent)`,
              color: ANALYTICS_COLORS.green,
            }}
          >
            PR
          </span>
        )}
      </div>
      <div className="line-clamp-2 text-xs tabular-nums text-muted-foreground">
        {sessionNotation(session.sets, fmtLoad)}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background px-3 py-2.5">
      <div className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 truncate text-lg font-black tabular-nums",
          tone === "up" && "text-emerald-500",
          tone === "down" && "text-rose-500",
        )}
      >
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** "Competition Squat" → "Squat": the comp lift is the default meaning. */
function chipLabel(name: string) {
  return name.replace(/^competition\s+/i, "") || name;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function compact(v: number) {
  if (Math.abs(v) >= 10_000) return `${fmtNum(v / 1000, 0)}k`;
  if (Math.abs(v) >= 1_000) return `${fmtNum(v / 1000, 1)}k`;
  return fmtNum(v);
}

/**
 * Velocity readiness + load-velocity 1RM profile (moved here unchanged from
 * the dashboard). Velocity is compared only within the same exercise: the
 * readiness signal uses prior sets at the same reps and nearly the same load;
 * the 1RM projection needs enough singles across several loads to fit a
 * personal load-velocity line.
 */
function useVelocityInsight(
  points: LiftHistoryPoint[],
  activeEx: string,
  displayUnit: Unit,
  conv: (lb: number) => number,
) {
  const insight = useMemo(() => {
    const pts = points
      .map((p) => ({
        load: conv(p.load),
        reps: p.reps,
        velocity: p.velocity_mps != null ? Number(p.velocity_mps) : null,
      }))
      .filter(
        (p) => p.velocity != null && Number.isFinite(p.velocity) && p.velocity > 0 && p.load > 0,
      ) as {
      load: number;
      reps: number;
      velocity: number;
    }[];
    if (!pts.length) return null;

    const latest = pts[pts.length - 1];
    const prior = pts.slice(0, -1);
    const increment = displayUnit === "kg" ? 2.5 : 5;
    const tolerance = Math.max(increment, latest.load * 0.025);
    const comparable = prior
      .filter((p) => p.reps === latest.reps && Math.abs(p.load - latest.load) <= tolerance)
      .slice(-6);

    let baseline: number | null = null;
    let deltaPct: number | null = null;
    let signal: "faster" | "normal" | "slower" | null = null;
    if (comparable.length >= 2) {
      baseline = comparable.reduce((s, p) => s + p.velocity, 0) / comparable.length;
      deltaPct = baseline > 0 ? ((latest.velocity - baseline) / baseline) * 100 : null;
      if (deltaPct != null)
        signal = deltaPct >= 5 ? "faster" : deltaPct <= -5 ? "slower" : "normal";
    }

    const family = liftFamily(activeEx);
    const mvt =
      family === "squat" ? 0.3 : family === "bench" ? 0.15 : family === "deadlift" ? 0.15 : null;
    const singles = pts.filter((p) => p.reps === 1 && p.velocity >= 0.05 && p.velocity <= 1.2);
    const buckets = new Set(singles.map((p) => Math.round(p.load / increment)));
    let predicted1rm: number | null = null;
    let r2: number | null = null;

    if (mvt != null && singles.length >= 5 && buckets.size >= 3) {
      const xs = singles.map((p) => p.velocity);
      const ys = singles.map((p) => p.load);
      const xBar = xs.reduce((a, b) => a + b, 0) / xs.length;
      const yBar = ys.reduce((a, b) => a + b, 0) / ys.length;
      const ssX = xs.reduce((s, x) => s + (x - xBar) ** 2, 0);
      const slope = ssX > 0 ? xs.reduce((s, x, i) => s + (x - xBar) * (ys[i] - yBar), 0) / ssX : 0;
      const intercept = yBar - slope * xBar;
      const fitted = xs.map((x) => intercept + slope * x);
      const ssTot = ys.reduce((s, y) => s + (y - yBar) ** 2, 0);
      const ssRes = ys.reduce((s, y, i) => s + (y - fitted[i]) ** 2, 0);
      r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : null;
      const projected = intercept + slope * mvt;
      const observedMax = Math.max(...ys);
      // Only surface a projection when the athlete's own data forms a sensible
      // inverse load-velocity relationship and the extrapolation stays modest.
      if (
        slope < 0 &&
        r2 != null &&
        r2 >= 0.7 &&
        projected >= observedMax * 0.9 &&
        projected <= observedMax * 1.25
      ) {
        predicted1rm = projected;
      }
    }

    return {
      latest,
      comparableCount: comparable.length,
      baseline,
      deltaPct,
      signal,
      family,
      singlesCount: singles.length,
      distinctLoads: buckets.size,
      predicted1rm,
      r2,
    };
  }, [points, activeEx, displayUnit, conv]);

  if (!insight) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Velocity readiness
          </div>
          <div className="mt-1 text-sm font-bold text-foreground">
            {insight.signal === "faster"
              ? "Moving faster than your baseline"
              : insight.signal === "slower"
                ? "Moving slower than your baseline"
                : insight.signal === "normal"
                  ? "Right on your normal baseline"
                  : "Building your baseline"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Latest: {insight.latest.velocity.toFixed(2)} m/s at {fmtNum(insight.latest.load)}{" "}
            {displayUnit} × {insight.latest.reps}
            {insight.deltaPct != null && insight.baseline != null
              ? ` · ${insight.deltaPct >= 0 ? "+" : ""}${insight.deltaPct.toFixed(1)}% vs ${insight.comparableCount} matched prior sets`
              : " · log this same load/reps a few times for a strength-readiness comparison"}
          </div>
        </div>
        {insight.predicted1rm != null && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Velocity 1RM estimate
            </div>
            <div className="text-lg font-black text-foreground">
              {fmtNum(insight.predicted1rm)} {displayUnit}
            </div>
            <div className="text-[10px] text-muted-foreground">
              personal load-velocity profile · R² {insight.r2?.toFixed(2)}
            </div>
          </div>
        )}
      </div>
      {insight.predicted1rm == null && insight.family && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          1RM profile needs at least 5 velocity-tracked singles across 3+ loads with a clean
          load-velocity relationship. Current profile: {insight.singlesCount} singles ·{" "}
          {insight.distinctLoads} load levels.
        </div>
      )}
      <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Use the same velocity device and setup each time. Mean concentric velocity is most useful
        here as an athlete-vs-self signal at matched load/reps; it does not replace RPE or
        competition-specific judgment.
      </div>
    </div>
  );
}
