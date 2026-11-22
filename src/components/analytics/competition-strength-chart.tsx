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
import { trendWords } from "@/lib/analytics/strength-read";
import {
  bucketPoints,
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  grainFor,
  liftTrends,
  relativeToBodyweight,
  type CompLift,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import { parseLocalDate } from "@/lib/today";

/** The validated split palette (styles.css --split-*): the Hall of Strength's colours for the three lifts. */
export const LIFT_SERIES: Record<CompLift, string> = {
  squat: "var(--split-squat)",
  bench: "var(--split-bench)",
  deadlift: "var(--split-deadlift)",
};

const DAY = 86_400_000;
const WIDEN_DAYS = 84;
const dayMs = (d: string) => (parseLocalDate(d) ?? new Date(d)).getTime();

type Row = { t: number; day: string } & Partial<Record<CompLift, number>> & {
    sets?: Partial<Record<CompLift, StrengthPoint["set"]>>;
  };

/**
 * Competition lifts over time: each lift's estimated max from its hard sets
 * (RPE 7+, ≤10 reps), meet results as separate marks (what was lifted, never
 * mixed into the line), block starts as quiet lines. One axis: estimated max,
 * or × bodyweight when switched. A lift toggle shows one alone (its scale).
 */
export function CompetitionStrengthChart({
  points,
  lightSessions,
  meets,
  blocks,
  start,
  end,
  unit,
  conv,
  weighIns,
  onWiden,
  compact = false,
}: {
  /** every comparable point on file (the chart cuts to the period) */
  points: StrengthPoint[];
  /** sessions in the period with only light or unrated sets (counted, not plotted) */
  lightSessions: number;
  meets: MeetResult[];
  blocks?: Array<{ id: string; name: string | null; start_date: string | null }>;
  start: Date;
  end: Date;
  unit: "lb" | "kg";
  conv: (lb: number) => number;
  /** weigh-ins (lb), for × bodyweight; the switch shows only with some */
  weighIns?: Array<{ day: string; lb: number }>;
  /** too little in this period: offer a longer one */
  onWiden?: () => void;
  compact?: boolean;
}) {
  const [only, setOnly] = useState<CompLift | "all">("all");
  const [relative, setRelative] = useState(false);
  const periodStart = start.getTime();
  const eMs = end.getTime() + DAY - 1;
  // A short period with under two heavy sessions (a block's first week) reads
  // the 12 weeks up to it instead of an empty chart, and says so.
  const pointsIn = (from: number) =>
    points.filter((p) => {
      const t = dayMs(p.day);
      return t >= from && t <= eMs;
    });
  const shortAndEmpty = (eMs - periodStart) / DAY < WIDEN_DAYS && pointsIn(periodStart).length < 2;
  const widened = shortAndEmpty && pointsIn(eMs - WIDEN_DAYS * DAY).length >= 2;
  const sMs = widened ? Math.min(periodStart, eMs - WIDEN_DAYS * DAY) : periodStart;
  const spanDays = Math.round((eMs - sMs) / DAY);
  const grain = grainFor(spanDays);

  const inPeriod = useMemo(
    () =>
      points.filter((p) => {
        const t = dayMs(p.day);
        return t >= sMs && t <= eMs;
      }),
    [points, sMs, eMs],
  );
  const trends = useMemo(() => liftTrends(inPeriod), [inPeriod]);
  const hasBw = (weighIns?.length ?? 0) >= 3;
  const rel = relative && hasBw;
  const meetsIn = meets.filter((m) => {
    const t = dayMs(m.date);
    return t >= sMs && t <= eMs;
  });
  const present = COMP_LIFTS.filter(
    (l) => inPeriod.some((p) => p.lift === l) || meetsIn.length > 0,
  );
  const shown = only === "all" ? present : present.filter((l) => l === only);

  const rows: Row[] = useMemo(() => {
    const bucketed = bucketPoints(inPeriod, grain);
    const byDay = new Map<string, Row>();
    const add = (lift: CompLift, day: string, value: number, set: StrengthPoint["set"]) => {
      const r = byDay.get(day) ?? { t: dayMs(day), day, sets: {} };
      r[lift] = value;
      r.sets![lift] = set;
      byDay.set(day, r);
    };
    if (rel && weighIns) {
      for (const lift of COMP_LIFTS) {
        const lp = bucketed.filter((p) => p.lift === lift).map((p) => ({ ...p, value: p.e1rm }));
        for (const p of relativeToBodyweight(lp, weighIns)) add(lift, p.day, p.value, p.set);
      }
    } else {
      for (const p of bucketed) add(p.lift, p.day, Math.round(conv(p.e1rm) * 10) / 10, p.set);
    }
    return [...byDay.values()].sort((a, b) => a.t - b.t);
  }, [inPeriod, grain, rel, weighIns, conv]);

  const meetMarks = useMemo(() => {
    const out: Array<{ t: number; lift: CompLift; value: number; meet: MeetResult }> = [];
    for (const m of meets) {
      const t = dayMs(m.date);
      if (t < sMs || t > eMs) continue;
      for (const lift of COMP_LIFTS) {
        const v = rel
          ? m.bodyweightLb
            ? m.lifts[lift] / m.bodyweightLb
            : null
          : conv(m.lifts[lift]);
        if (v != null) out.push({ t, lift, value: Math.round(v * 100) / 100, meet: m });
      }
    }
    return out;
  }, [meets, sMs, eMs, rel, conv]);

  // Block starts only while they're few enough to read (a year of blocks is a fence).
  const allLines = (blocks ?? [])
    .map((b) => ({ id: b.id, name: b.name, t: b.start_date ? dayMs(b.start_date) : NaN }))
    .filter((b) => Number.isFinite(b.t) && b.t > sMs && b.t <= eMs);
  const blockLines = allLines.length <= 6 ? allLines : [];

  const enough = present.length > 0 && (inPeriod.length >= 2 || meetsIn.length >= 2);
  // The axis from what's drawn (lines and meet marks), with a little room: "auto" clipped the top line.
  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    for (const r of rows) for (const l of shown) if (r[l] != null) vals.push(r[l]!);
    for (const m of meetMarks) if (shown.includes(m.lift)) vals.push(m.value);
    if (!vals.length) return [0, 1];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.08, rel ? 0.05 : 5);
    const step = rel ? 0.1 : 5;
    return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step];
  }, [rows, meetMarks, shown, rel]);
  const fmtVal = (v: number) => (rel ? `${v.toFixed(2)}× BW` : `${Math.round(v)} ${unit}`);
  const tickFmt = (t: number) =>
    format(new Date(t), spanDays > 400 ? "MMM yy" : spanDays > 120 ? "MMM" : "MMM d");

  return (
    <Card className={cn("p-4", compact && "p-3.5")} data-competition-strength>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lifts shown">
        {(["all", ...present] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setOnly(k as CompLift | "all")}
            aria-pressed={only === k}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition",
              only === k
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            data-lift-toggle={k}
          >
            {k !== "all" && (
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: LIFT_SERIES[k as CompLift] }}
                aria-hidden
              />
            )}
            {k === "all" ? "All" : COMP_LIFT_LABEL[k as CompLift]}
          </button>
        ))}
        {hasBw && (
          <button
            type="button"
            onClick={() => setRelative((v) => !v)}
            aria-pressed={rel}
            className={cn(
              "ml-auto inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition",
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

      {widened && (
        <p className="mt-2 text-[12px] text-muted-foreground" data-strength-widened>
          No hard sets in this period yet, so this shows the last 12 weeks.
        </p>
      )}
      {!enough ? (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-5 text-center"
          data-strength-empty
        >
          <p className="text-sm font-medium text-foreground">
            {inPeriod.length === 0
              ? "No hard competition-lift sets in this period"
              : "Only one heavy session in this period"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            A point needs a set at RPE 7 or harder, 10 reps or fewer.
            {lightSessions > 0
              ? ` ${lightSessions} lighter session${lightSessions === 1 ? "" : "s"} logged here.`
              : ""}
          </p>
          {/* only when older hard sets exist to show (a wider empty chart helps nobody) */}
          {onWiden && points.some((p) => dayMs(p.day) < sMs) && (
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
            className="mt-3 h-[220px] w-full"
            role="img"
            aria-label="Estimated max over time for the competition lifts"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[sMs, eMs]}
                  tickFormatter={tickFmt}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  domain={yDomain}
                  allowDataOverflow={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => (rel ? v.toFixed(1) : String(Math.round(v)))}
                />
                {blockLines.map((b) => (
                  <ReferenceLine
                    key={b.id}
                    x={b.t}
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.35}
                    strokeDasharray="3 3"
                  />
                ))}
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const t = Number(label);
                    const row = rows.find((r) => r.t === t);
                    const meetHere = meetMarks.filter((m) => m.t === t);
                    const block = [...(blocks ?? [])]
                      .filter((b) => b.start_date && dayMs(b.start_date) <= t)
                      .pop();
                    return (
                      <div className="min-w-[160px] rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                        <div className="font-medium text-foreground">
                          {grain === "month"
                            ? format(new Date(t), "MMMM yyyy")
                            : grain === "week"
                              ? `Week of ${format(new Date(t), "MMM d")}`
                              : format(new Date(t), "EEE, MMM d")}
                        </div>
                        {block?.name && <div className="text-muted-foreground">{block.name}</div>}
                        {shown.map(
                          (l) =>
                            row?.[l] != null && (
                              <div key={l} className="mt-1 flex items-center gap-1.5">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: LIFT_SERIES[l] }}
                                />
                                <span className="text-foreground">
                                  {COMP_LIFT_LABEL[l]} {fmtVal(row[l]!)}
                                </span>
                                {row.sets?.[l] && (
                                  <span className="text-muted-foreground">
                                    · {fmtNum(conv(row.sets[l]!.load))}×{row.sets[l]!.reps} @
                                    {row.sets[l]!.effort}
                                  </span>
                                )}
                              </div>
                            ),
                        )}
                        {meetHere.length > 0 && (
                          <div className="mt-1 text-foreground">
                            Meet: {meetHere[0].meet.name ?? "result"}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {shown.map((l) => (
                  <Line
                    key={l}
                    type="monotone"
                    dataKey={l}
                    stroke={LIFT_SERIES[l]}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: LIFT_SERIES[l] }}
                    activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                {shown.map((l) => (
                  <Scatter
                    key={`meet-${l}`}
                    data={meetMarks.filter((m) => m.lift === l)}
                    dataKey="value"
                    fill="var(--card)"
                    stroke={LIFT_SERIES[l]}
                    strokeWidth={2}
                    shape="diamond"
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* The table view and direct labels: each lift, its latest estimate and trend in this period. */}
          <ul className="mt-3 divide-y divide-border/60" data-strength-table>
            {present.map((l) => {
              const lp = inPeriod.filter((p) => p.lift === l);
              const tr = trends[l];
              if (!lp.length) {
                const bestMeet = meetsIn.reduce<MeetResult | null>(
                  (a, m) => (!a || m.lifts[l] > a.lifts[l] ? m : a),
                  null,
                );
                return (
                  <li key={l} className="flex min-h-11 items-center gap-2 py-1.5 text-[13px]">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: LIFT_SERIES[l] }}
                      aria-hidden
                    />
                    <span className="w-[68px] shrink-0 font-medium text-foreground">
                      {COMP_LIFT_LABEL[l]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {bestMeet
                        ? `Best meet ${fmtNum(conv(bestMeet.lifts[l]))} (${format(parseLocalDate(bestMeet.date)!, "MMM yyyy")})`
                        : "No hard sets"}
                    </span>
                  </li>
                );
              }
              const last = lp[lp.length - 1];
              const best = lp.reduce((a, p) => (p.e1rm > a.e1rm ? p : a), lp[0]);
              return (
                <li key={l} className="flex min-h-11 items-center gap-2 py-1.5 text-[13px]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: LIFT_SERIES[l] }}
                    aria-hidden
                  />
                  <span className="w-[68px] shrink-0 font-medium text-foreground">
                    {COMP_LIFT_LABEL[l]}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    <span className="block truncate">
                      <span className="font-medium text-foreground tabular-nums">
                        {Math.round(conv(last.e1rm))}
                      </span>{" "}
                      · {format(parseLocalDate(last.day)!, "MMM d")}
                    </span>
                    {best.e1rm - last.e1rm >= 2 && (
                      <span className="block truncate text-[12px]">
                        best {Math.round(conv(best.e1rm))} ·{" "}
                        {format(parseLocalDate(best.day)!, "MMM d")}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      tr.kind === "up"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : tr.kind === "down"
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {trendWords(tr)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Estimated max ({unit}) from hard sets: RPE 7+, 10 reps or fewer.{" "}
            {grain !== "session" ? `Each point is the ${grain}'s best. ` : ""}
            {meetMarks.length
              ? "◆ marks what you lifted at a meet; a peak and the lighter weeks after it move these lines, so compare like phases. "
              : ""}
            {blockLines.length ? "Dashed lines are block starts. " : ""}
            {lightSessions > 0
              ? `${lightSessions} lighter session${lightSessions === 1 ? "" : "s"} not plotted.`
              : ""}
          </p>
        </>
      )}
    </Card>
  );
}
