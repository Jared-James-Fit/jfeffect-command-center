import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/analytics-format";
import { InfoTip } from "@/components/analytics/info-tip";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  grainFor,
  relativeToBodyweight,
  type CompLift,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import {
  changeWords,
  liftSeries,
  liftSummary,
  niceDomain,
  normalizedSeries,
  strengthMinSpan,
  testedNotMeet,
  timeTicks,
  type MaxOnFile,
} from "@/lib/analytics/analytics-areas";
import { parseLocalDate } from "@/lib/today";

/** The validated split palette (styles.css --split-*): the Hall of Strength's colours for the three lifts. */
export const LIFT_SERIES: Record<CompLift, string> = {
  squat: "var(--split-squat)",
  bench: "var(--split-bench)",
  deadlift: "var(--split-deadlift)",
};

const DAY = 86_400_000;
const WIDEN_DAYS = 84;
const toDay = (d: Date) => format(d, "yyyy-MM-dd");
const dayMs = (d: string) => (parseLocalDate(d) ?? new Date(d)).getTime();
const fmtDay = (d: string) => {
  const x = parseLocalDate(d);
  return x ? format(x, x.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy") : d;
};

type View = CompLift | "compare";

/**
 * The competition lifts over time, one lift at a time (each on its own
 * scale), or the three as % change from a stated day (Compare). Estimated
 * max from hard sets is the line; what was lifted at a meet and a tested max
 * are their own marks, never joined to it; a training max never appears here
 * (it's a programming number, in the table under the chart). A line breaks
 * where the gap is too long to be one trend. Tap a point for the set behind it.
 */
export function CompetitionStrengthChart({
  points,
  lightSessions,
  meets,
  maxes = [],
  blocks,
  start,
  end,
  unit,
  conv,
  weighIns,
  onWiden,
}: {
  /** every comparable point on file (the chart cuts to the period) */
  points: StrengthPoint[];
  /** sessions in the period with only light or unrated sets (counted, not plotted) */
  lightSessions: number;
  meets: MeetResult[];
  /** maxes on file: tested ones are marked on the chart */
  maxes?: MaxOnFile[];
  blocks?: Array<{ id: string; name: string | null; start_date: string | null }>;
  start: Date;
  end: Date;
  unit: "lb" | "kg";
  conv: (lb: number) => number;
  /** weigh-ins (lb), for × bodyweight; the switch shows only with some */
  weighIns?: Array<{ day: string; lb: number }>;
  /** too little in this period: offer a longer one */
  onWiden?: () => void;
}) {
  const everTrained = COMP_LIFTS.filter(
    (l) => points.some((p) => p.lift === l) || meets.length > 0,
  );
  const startDay = toDay(start);
  const endDay = toDay(end);
  // the lift with the most hard sessions in the period leads (else the most ever)
  const defaultLift = useMemo<CompLift>(() => {
    const count = (l: CompLift, from: string) =>
      points.filter((p) => p.lift === l && p.day >= from && p.day <= endDay).length;
    const inP = [...COMP_LIFTS].sort((a, b) => count(b, startDay) - count(a, startDay));
    if (count(inP[0], startDay) > 0) return inP[0];
    return [...COMP_LIFTS].sort((a, b) => count(b, "0000") - count(a, "0000"))[0];
  }, [points, startDay, endDay]);
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = picked ?? defaultLift;
  const [relative, setRelative] = useState(false);

  if (!everTrained.length) return null;
  return (
    <Card className="p-4" data-competition-strength data-strength-view={view}>
      <div
        className="grid grid-cols-4 gap-1 rounded-lg bg-muted/60 p-1"
        role="tablist"
        aria-label="Lift"
      >
        {([...COMP_LIFTS, "compare"] as View[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => setPicked(k)}
            className={cn(
              "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 text-[13px] font-medium transition",
              view === k
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-lift-toggle={k}
          >
            {k !== "compare" && (
              <span
                className="h-2 w-2 shrink-0 rounded-full max-[359px]:hidden"
                style={{ background: LIFT_SERIES[k] }}
                aria-hidden
              />
            )}
            <span className="truncate">{k === "compare" ? "Compare" : COMP_LIFT_LABEL[k]}</span>
          </button>
        ))}
      </div>

      {view === "compare" ? (
        <CompareView points={points} start={start} end={end} conv={conv} unit={unit} />
      ) : (
        <LiftView
          lift={view}
          points={points}
          lightSessions={lightSessions}
          meets={meets}
          maxes={maxes}
          blocks={blocks}
          start={start}
          end={end}
          unit={unit}
          conv={conv}
          weighIns={weighIns}
          relative={relative}
          onRelative={setRelative}
          onWiden={onWiden}
        />
      )}
    </Card>
  );
}

function LiftView({
  lift,
  points,
  lightSessions,
  meets,
  maxes,
  blocks,
  start,
  end,
  unit,
  conv,
  weighIns,
  relative,
  onRelative,
  onWiden,
}: {
  lift: CompLift;
  points: StrengthPoint[];
  lightSessions: number;
  meets: MeetResult[];
  maxes: MaxOnFile[];
  blocks?: Array<{ id: string; name: string | null; start_date: string | null }>;
  start: Date;
  end: Date;
  unit: "lb" | "kg";
  conv: (lb: number) => number;
  weighIns?: Array<{ day: string; lb: number }>;
  relative: boolean;
  onRelative: (v: boolean) => void;
  onWiden?: () => void;
}) {
  const eMs = end.getTime() + DAY - 1;
  const endDay = toDay(end);
  const periodStart = toDay(start);
  const count = (from: string) =>
    points.filter((p) => p.lift === lift && p.day >= from && p.day <= endDay).length;
  // A short period with under two hard sessions of this lift (a block's first
  // week) reads the 12 weeks up to it instead of an empty chart, and says so.
  const shortAndEmpty = (eMs - start.getTime()) / DAY < WIDEN_DAYS && count(periodStart) < 2;
  const widenFrom = toDay(new Date(eMs - WIDEN_DAYS * DAY));
  const widened = shortAndEmpty && count(widenFrom) >= 2;
  const startDay = widened ? (widenFrom < periodStart ? widenFrom : periodStart) : periodStart;
  const sMs = dayMs(startDay);
  const spanDays = Math.round((eMs - sMs) / DAY);
  const grain = grainFor(spanDays);
  const hasBw = (weighIns?.length ?? 0) >= 3;
  const rel = relative && hasBw;

  const series = useMemo(
    () => liftSeries(points, lift, startDay, endDay, grain),
    [points, lift, startDay, endDay, grain],
  );
  const summary = useMemo(
    () => liftSummary(points, lift, startDay, endDay),
    [points, lift, startDay, endDay],
  );
  const rows = useMemo(() => {
    if (!rel || !weighIns)
      return series.map((p) => ({
        ...p,
        v: p.value == null ? null : Math.round(conv(p.value) * 10) / 10,
      }));
    const withBw = relativeToBodyweight(
      series.filter((p) => p.value != null).map((p) => ({ ...p, value: p.value! })),
      weighIns,
    );
    const byT = new Map(withBw.map((p) => [p.t, p.value]));
    return series.map((p) => ({ ...p, v: p.value == null ? null : (byT.get(p.t) ?? null) }));
  }, [series, rel, weighIns, conv]);

  const meetMarks = useMemo(
    () =>
      meets
        .filter((m) => m.date >= startDay && m.date <= endDay)
        .map((m) => {
          const v = rel
            ? m.bodyweightLb
              ? m.lifts[lift] / m.bodyweightLb
              : null
            : conv(m.lifts[lift]);
          return v == null ? null : { t: dayMs(m.date), v: Math.round(v * 100) / 100, meet: m };
        })
        .filter(Boolean) as Array<{ t: number; v: number; meet: MeetResult }>,
    [meets, startDay, endDay, rel, conv, lift],
  );
  const testedMarks = useMemo(
    () =>
      rel
        ? []
        : testedNotMeet(
            maxes.filter(
              (m) =>
                m.lift === lift &&
                m.kind === "tested" &&
                m.date &&
                m.date >= startDay &&
                m.date <= endDay,
            ),
            meets,
          ).map((m) => ({ t: dayMs(m.date!), v: Math.round(conv(m.lb)), max: m })),
    [maxes, meets, lift, startDay, endDay, rel, conv],
  );

  const values = [
    ...rows.map((r) => r.v).filter((v): v is number => v != null),
    ...meetMarks.map((m) => m.v),
    ...testedMarks.map((m) => m.v),
  ];
  const axis = niceDomain(values, { minSpan: rel ? 0.15 : strengthMinSpan(values), floor: 0 });
  const plotted = rows.filter((r) => r.v != null).length;
  const enough = plotted >= 2 || plotted + meetMarks.length + testedMarks.length >= 2;
  const latest = summary.latest;
  const change = changeWords(summary.trend, conv, unit, fmtDay);
  const fmtVal = (v: number) => (rel ? `${v.toFixed(2)}× bodyweight` : `${Math.round(v)} ${unit}`);
  const tickFmt = (t: number) =>
    format(new Date(t), spanDays > 400 ? "MMM yy" : spanDays > 120 ? "MMM" : "MMM d");
  const label = COMP_LIFT_LABEL[lift];

  return (
    <div className="mt-4" data-strength-lift={lift}>
      {/* The answer first: where this lift is now and how it's moved, measured from a stated day.
          With nothing to show, only the empty state below says so (never twice). */}
      {latest && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-3xl font-semibold tabular-nums tracking-tight"
                  data-strength-latest
                >
                  {Math.round(conv(latest.e1rm))}
                </span>
                <span className="text-sm text-muted-foreground">{unit}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
                <span className="truncate">Estimated max</span>
                <InfoTip
                  label="How the estimated max is worked out"
                  title="Estimated max"
                  align="start"
                >
                  Each point is a session's best hard set (RPE 7 or harder, 10 reps or fewer), read
                  with how hard it felt. Lighter sessions aren't plotted: they say little about a
                  max. It's an estimate, not a tested max.
                  {grain !== "session" ? ` On long periods each point is the ${grain}'s best.` : ""}{" "}
                  A gap of more than a few weeks between hard sets breaks the line.
                  {lightSessions > 0
                    ? ` ${lightSessions} lighter session${lightSessions === 1 ? " isn't" : "s aren't"} plotted in this period.`
                    : ""}
                </InfoTip>
              </div>
              <div className="text-[12px] text-muted-foreground" data-strength-set>
                {fmtDay(latest.day)} · from {fmtNum(conv(latest.set.load))} × {latest.set.reps} @
                RPE {latest.set.effort}
              </div>
            </div>
            {hasBw && enough && (
              <button
                type="button"
                onClick={() => onRelative(!relative)}
                aria-pressed={rel}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] font-medium transition",
                  rel
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
                title="Each estimate over your average bodyweight that week"
              >
                × bodyweight
              </button>
            )}
          </div>
          <div
            className={cn(
              "mt-2 text-[13px] font-medium",
              change.tone === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : change.tone === "none"
                  ? "text-muted-foreground"
                  : "text-foreground",
            )}
            data-strength-change
          >
            {change.text}
          </div>
        </>
      )}

      {widened && (
        <p className="mt-2 text-[12px] text-muted-foreground" data-strength-widened>
          No hard {label.toLowerCase()} sets in this period yet. Showing the last 12 weeks.
        </p>
      )}

      {!enough ? (
        <div
          className={cn(
            "rounded-xl border border-dashed border-border p-5 text-center",
            latest ? "mt-4" : "mt-1",
          )}
          data-strength-empty
        >
          <p className="text-sm font-medium text-foreground">
            No hard {label.toLowerCase()} sets in this period
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            A point needs a set at RPE 7 or harder, 10 reps or fewer.
            {lightSessions > 0
              ? ` ${lightSessions} lighter session${lightSessions === 1 ? "" : "s"} logged here.`
              : ""}
          </p>
          {onWiden && points.some((p) => p.lift === lift && p.day < startDay) && (
            <button
              type="button"
              onClick={onWiden}
              className="mt-3 inline-flex h-9 items-center rounded-lg bg-secondary px-3 text-[13px] font-medium text-foreground"
            >
              Show all time
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className="mt-3 h-[200px] w-full"
            role="img"
            aria-label={`${label} estimated max over time`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -6 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[sMs, eMs]}
                  ticks={timeTicks(sMs, eMs)}
                  tickFormatter={tickFmt}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  domain={axis.domain}
                  ticks={axis.ticks}
                  allowDataOverflow={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  tickFormatter={(v: number) => (rel ? v.toFixed(1) : String(Math.round(v)))}
                />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pl: any = payload[0]?.payload;
                    if (!pl) return null;
                    const t = Number(pl.t);
                    const block = [...(blocks ?? [])]
                      .filter((b) => b.start_date && dayMs(b.start_date) <= t)
                      .pop();
                    return (
                      <div className="min-w-[170px] max-w-[230px] rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                        <div className="font-medium text-foreground">
                          {format(new Date(t), "EEE, MMM d, yyyy")}
                          {!pl.meet && !pl.max && grain !== "session" ? (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · the {grain}'s best
                            </span>
                          ) : null}
                        </div>
                        {pl.meet ? (
                          <>
                            <div className="mt-1 text-foreground">
                              ◆ Meet: {fmtVal(pl.v)} lifted
                            </div>
                            <div className="text-muted-foreground">
                              {pl.meet.name ?? "Competition"}
                            </div>
                          </>
                        ) : pl.max ? (
                          <div className="mt-1 text-foreground">▲ Tested max: {fmtVal(pl.v)}</div>
                        ) : pl.v != null ? (
                          <>
                            <div className="mt-1 text-foreground">Estimated max {fmtVal(pl.v)}</div>
                            {pl.point && (
                              <div className="text-muted-foreground">
                                From {fmtNum(conv(pl.point.set.load))} × {pl.point.set.reps} @ RPE{" "}
                                {pl.point.set.effort}
                              </div>
                            )}
                          </>
                        ) : null}
                        {block?.name && (
                          <div className="mt-0.5 text-muted-foreground">{block.name}</div>
                        )}
                      </div>
                    );
                  }}
                />
                <Line
                  type="linear"
                  dataKey="v"
                  stroke={LIFT_SERIES[lift]}
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 0, fill: LIFT_SERIES[lift] }}
                  activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {meetMarks.length > 0 && (
                  <Scatter
                    data={meetMarks}
                    dataKey="v"
                    fill="var(--card)"
                    stroke="var(--foreground)"
                    strokeWidth={2}
                    shape="diamond"
                    isAnimationActive={false}
                  />
                )}
                {testedMarks.length > 0 && (
                  <Scatter
                    data={testedMarks}
                    dataKey="v"
                    fill="var(--foreground)"
                    shape="triangle"
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {/* the key, only for what's drawn */}
          <div
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
            data-strength-key
          >
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: LIFT_SERIES[lift] }}
                aria-hidden
              />{" "}
              Estimated max
            </span>
            {meetMarks.length > 0 && <span>◆ Meet (lifted)</span>}
            {testedMarks.length > 0 && <span>▲ Tested max</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** The three lifts as % change from each one's first hard set in the period: the only fair way to put them on one axis. */
function CompareView({
  points,
  start,
  end,
  conv,
  unit,
}: {
  points: StrengthPoint[];
  start: Date;
  end: Date;
  conv: (lb: number) => number;
  unit: "lb" | "kg";
}) {
  const startDay = toDay(start);
  const endDay = toDay(end);
  const sMs = start.getTime();
  const eMs = end.getTime() + DAY - 1;
  const spanDays = Math.round((eMs - sMs) / DAY);
  const data = useMemo(
    () => normalizedSeries(points, startDay, endDay),
    [points, startDay, endDay],
  );
  const last = (l: CompLift) => {
    const v = [...data.rows].reverse().find((r) => typeof r[l] === "number")?.[l];
    return typeof v === "number" ? v : null;
  };
  const vals = data.rows.flatMap((r) =>
    data.lifts.map((l) => r[l]).filter((v): v is number => typeof v === "number"),
  );
  const axis = niceDomain([0, ...vals], { minSpan: 6 });
  const tickFmt = (t: number) =>
    format(new Date(t), spanDays > 400 ? "MMM yy" : spanDays > 120 ? "MMM" : "MMM d");

  if (data.lifts.length < 2) {
    return (
      <div
        className="mt-4 rounded-xl border border-dashed border-border p-5 text-center"
        data-strength-compare-empty
      >
        <p className="text-sm font-medium text-foreground">Not enough to compare yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Comparing needs two or more lifts with at least two hard sets each in this period. Try a
          longer period.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4" data-strength-compare>
      <div className="flex items-center gap-1 text-[13px] font-medium text-foreground">
        Change in estimated max
        <InfoTip label="How the comparison works" title="Comparing lifts" align="start">
          Each lift is measured against its own first hard set in this period, so lifts hundreds of
          pounds apart can share one axis. 0% is where each one started.{" "}
          {data.lifts
            .map(
              (l) =>
                `${COMP_LIFT_LABEL[l]}: ${Math.round(conv(data.baselines[l]!.value))} ${unit} on ${fmtDay(data.baselines[l]!.day)}`,
            )
            .join(". ")}
          .
        </InfoTip>
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-2" data-strength-compare-values>
        {data.lifts.map((l) => {
          const v = last(l);
          return (
            <li key={l} className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: LIFT_SERIES[l] }}
                  aria-hidden
                />
                {COMP_LIFT_LABEL[l]}
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                since {fmtDay(data.baselines[l]!.day)}
              </div>
            </li>
          );
        })}
      </ul>
      <div
        className="mt-3 h-[200px] w-full"
        role="img"
        aria-label="Change in estimated max for each lift, in percent"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.rows} margin={{ top: 6, right: 6, bottom: 0, left: -6 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[sMs, eMs]}
              ticks={timeTicks(sMs, eMs)}
              tickFormatter={tickFmt}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={axis.domain}
              ticks={axis.ticks}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={42}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row: any = payload[0]?.payload;
                if (!row) return null;
                return (
                  <div className="min-w-[150px] rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                    <div className="font-medium text-foreground">
                      {spanDays > 400
                        ? format(new Date(row.t), "MMMM yyyy")
                        : `Week of ${format(new Date(row.t), "MMM d")}`}
                    </div>
                    {data.lifts.map((l) =>
                      row[l] != null ? (
                        <div key={l} className="mt-1 flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: LIFT_SERIES[l] }}
                          />
                          {COMP_LIFT_LABEL[l]} {Number(row[l]) > 0 ? "+" : ""}
                          {row[l]}%
                        </div>
                      ) : null,
                    )}
                  </div>
                );
              }}
            />
            {/* one line per unbroken stretch of each lift (weeks it wasn't trained hard in between are skipped, a long gap breaks it) */}
            {data.lifts.flatMap((l) =>
              Array.from({ length: data.segments[l] ?? 1 }, (_, n) => (
                <Line
                  key={`${l}-${n}`}
                  type="linear"
                  dataKey={`${l}__${n}`}
                  stroke={LIFT_SERIES[l]}
                  strokeWidth={2}
                  dot={{ r: 2.5, strokeWidth: 0, fill: LIFT_SERIES[l] }}
                  activeDot={{ r: 4.5, stroke: "var(--card)", strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
