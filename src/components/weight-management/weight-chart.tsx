/**
 * The bodyweight trajectory: every weigh-in (a dot, it's noise on its own),
 * the 7-day average (the line people read), the planned path to the goal
 * (a pale band: anywhere in it is on track), the projection from their trend
 * to the date (dashed, with its likely range), and the target. One axis, the
 * theme's own ink, so it reads the same in light and dark.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { withSevenDayAverage } from "@/lib/nutrition-targets/nutrition-progress";
import type { Assessment } from "@/lib/weight-management/assessment";
import { addDays, daysBetween, fromKg, round } from "@/lib/weight-management/units";

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;
const TOOLTIP_BOX = "rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-none";
const dateLabel = (d: string) => format(parseISO(d), "MMM d");

type Point = {
  x: number;
  date: string;
  value?: number;
  avg?: number;
  path?: [number, number];
  pathMid?: number;
  proj?: number;
  projBand?: [number, number];
};

function ticksFor(span: number): number[] {
  const step = span <= 35 ? 7 : span <= 100 ? 14 : span <= 200 ? 28 : 56;
  const out: number[] = [];
  for (let x = 0; x <= span; x += step) out.push(x);
  return out;
}

export function WeightChart({ a, series, from }: { a: Assessment; series: Array<{ date: string; kg: number }>; from: string }) {
  const unit = a.unit;
  const t = a.trajectory;
  const u = (kg: number) => round(fromKg(kg, unit), 1);
  const goalDate = a.goal?.date && daysBetween(a.today, a.goal.date) <= 26 * 7 ? a.goal.date : null;
  const end = goalDate && goalDate > a.today ? goalDate : a.today;
  const span = Math.max(7, daysBetween(from, end));

  const data = useMemo(() => {
    const byX = new Map<number, Point>();
    const at = (date: string): Point => {
      const x = daysBetween(from, date);
      let p = byX.get(x);
      if (!p) byX.set(x, (p = { x, date }));
      return p;
    };
    const shown = withSevenDayAverage(series.map((p) => ({ date: p.date, value: u(p.kg) }))).filter((p) => p.date >= from && p.date <= a.today);
    for (const p of shown) Object.assign(at(p.date), { value: p.value, avg: p.avg });
    for (const p of t.path) {
      if (p.date < from) continue;
      Object.assign(at(p.date), { path: [u(p.lowKg), u(p.highKg)] as [number, number], pathMid: u(p.kg) });
    }
    if (t.projected && t.trend && t.latest) {
      const s = at(t.latest.date);
      s.proj = u(t.trend.levelKg);
      s.projBand = [u(t.trend.levelKg), u(t.trend.levelKg)];
      const e = at(t.projected.date);
      e.proj = u(t.projected.kg);
      e.projBand = [u(t.projected.lowKg), u(t.projected.highKg)];
    }
    return [...byX.values()].sort((a1, b) => a1.x - b.x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, from, a.hash, unit]);

  const values = data.flatMap((p) => [p.value, p.avg, ...(p.path ?? []), ...(p.projBand ?? [])].filter((v): v is number => v != null));
  if (a.goal) values.push(u(a.goal.kg));
  if (a.goal?.limitKg) values.push(u(a.goal.limitKg));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const pad = Math.max(0.5, (hi - lo) * 0.08);
  const domain: [number, number] = [Math.floor(lo - pad), Math.ceil(hi + pad)];

  if (!data.some((p) => p.value != null)) return null;
  const label = [
    `Bodyweight from ${dateLabel(from)}`,
    t.current ? `now ${u(t.current.kg)} ${unit}` : null,
    a.goal ? `target ${u(a.goal.kg)} ${unit}${a.goal.date ? ` by ${dateLabel(a.goal.date)}` : ""}` : null,
    t.projected ? `projected ${u(t.projected.kg)} ${unit}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-2" data-weight-chart>
      <div className="h-[220px] w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="x" type="number" domain={[0, span]} ticks={ticksFor(span)} tickFormatter={(x: number) => dateLabel(addDays(from, x))} {...AXIS} />
            <YAxis domain={domain} width={40} allowDecimals={false} {...AXIS} />
            {a.goal?.limitKg != null && (
              <ReferenceLine y={u(a.goal.limitKg)} stroke="var(--muted-foreground)" strokeOpacity={0.5} label={{ value: "Class limit", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
            )}
            {a.goal && (
              <ReferenceLine y={u(a.goal.kg)} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `Target ${u(a.goal.kg)}`, position: "insideBottomRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
            )}
            <ReferenceLine x={daysBetween(from, a.today)} stroke="var(--border)" />
            <Area dataKey="path" type="linear" stroke="none" fill="var(--muted-foreground)" fillOpacity={0.12} connectNulls isAnimationActive={false} />
            <Area dataKey="projBand" type="linear" stroke="none" fill="var(--foreground)" fillOpacity={0.08} connectNulls isAnimationActive={false} />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as Point | undefined);
                if (!p) return null;
                return (
                  <div className={TOOLTIP_BOX}>
                    <div className="font-medium">{format(parseISO(p.date), "EEE, MMM d")}</div>
                    {p.value != null && <div className="tabular-nums">Weigh-in {p.value} {unit}</div>}
                    {p.avg != null && <div className="tabular-nums text-muted-foreground">7-day average {p.avg} {unit}</div>}
                    {p.pathMid != null && p.value == null && <div className="tabular-nums text-muted-foreground">Planned {p.pathMid} {unit}</div>}
                    {p.projBand && p.proj != null && p.value == null && (
                      <div className="tabular-nums">Projected {p.proj} {unit} (likely {p.projBand[0]}–{p.projBand[1]})</div>
                    )}
                  </div>
                );
              }}
            />
            <Scatter dataKey="value" isAnimationActive={false} shape={(props: any) => <circle cx={props.cx} cy={props.cy} r={3} fill="var(--muted-foreground)" fillOpacity={0.45} />} />
            <Line dataKey="avg" type="monotone" stroke="var(--foreground)" strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: "var(--foreground)" }} isAnimationActive={false} />
            <Line dataKey="proj" type="linear" stroke="var(--foreground)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-chart-key>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground/45" aria-hidden />Weigh-in</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-foreground" aria-hidden />7-day average</span>
        {t.path.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-muted-foreground/15" aria-hidden />Planned path</span>}
        {t.projected && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-foreground/70" aria-hidden />Projected (likely range shaded)</span>}
        {a.goal && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-muted-foreground" aria-hidden />Target</span>}
      </div>
    </div>
  );
}
