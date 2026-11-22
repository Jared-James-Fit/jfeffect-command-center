/**
 * Actual against planned: every weigh-in (a dot, it's noise on its own), the
 * 7-day average (the line people read), the roadmap's planned path with the
 * band that still counts as on plan, the projection from their trend with its
 * likely range, and where each block starts. The theme's own ink, one axis.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { withSevenDayAverage } from "@/lib/nutrition-targets/nutrition-progress";
import { addDays, daysBetween, fromKg, round } from "@/lib/weight-management/units";
import { todayLocalISO } from "@/lib/today";
import type { RoadmapRead } from "@/lib/nutrition-roadmap/types";

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;
const TOOLTIP_BOX = "rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-none";
const dateLabel = (d: string) => format(parseISO(d), "MMM d");

type Point = { x: number; date: string; value?: number; avg?: number; band?: [number, number]; plan?: number; proj?: number; projBand?: [number, number] };

function ticksFor(span: number): number[] {
  const step = span <= 42 ? 7 : span <= 120 ? 14 : span <= 240 ? 28 : 56;
  const out: number[] = [];
  for (let x = 0; x <= span; x += step) out.push(x);
  return out;
}

export function RoadmapChart({ read, series, unit }: { read: RoadmapRead; series: Array<{ date: string; kg: number }>; unit: "kg" | "lb" }) {
  const plan = read.plan;
  const today = todayLocalISO();
  const u = (kg: number) => round(fromKg(kg, unit), 1);
  const first = series.length ? series[0].date : plan.madeOn;
  const from = [first, addDays(plan.madeOn, -42)].sort().pop()!;
  const end = plan.path.length ? plan.path[plan.path.length - 1].date : addDays(plan.madeOn, 28);
  const span = Math.max(14, daysBetween(from, end));

  const data = useMemo(() => {
    const byX = new Map<number, Point>();
    const at = (date: string): Point => {
      const x = daysBetween(from, date);
      let p = byX.get(x);
      if (!p) byX.set(x, (p = { x, date }));
      return p;
    };
    for (const p of withSevenDayAverage(series.map((s) => ({ date: s.date, value: u(s.kg) })))) if (p.date >= from) Object.assign(at(p.date), { value: p.value, avg: p.avg });
    for (const p of plan.path) if (p.date >= from) Object.assign(at(p.date), { plan: u(p.kg), band: [u(p.lowKg), u(p.highKg)] as [number, number] });
    const pr = read.progress.projected;
    if (pr && read.progress.currentKg != null && series.length) {
      const s = at(series[series.length - 1].date);
      s.proj = u(read.progress.currentKg);
      s.projBand = [u(read.progress.currentKg), u(read.progress.currentKg)];
      const e = at(pr.date);
      e.proj = u(pr.kg);
      e.projBand = [u(pr.lowKg), u(pr.highKg)];
    }
    return [...byX.values()].sort((a, b) => a.x - b.x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, plan.hash, from, unit, read.progress.projected?.kg]);

  const values = data.flatMap((p) => [p.value, p.avg, p.plan, ...(p.band ?? []), ...(p.projBand ?? [])].filter((v): v is number => v != null));
  if (plan.goal?.kg != null) values.push(u(plan.goal.kg));
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0.5, (hi - lo) * 0.1);
  const domain: [number, number] = [Math.floor(lo - pad), Math.ceil(hi + pad)];
  const starts = plan.blocks.slice(1).filter((b) => b.start >= from && b.start <= end);
  const label = `Bodyweight against the roadmap${read.progress.currentKg != null ? `, now ${u(read.progress.currentKg)} ${unit}` : ""}${plan.goal?.kg != null ? `, target ${u(plan.goal.kg)} ${unit}` : ""}`;

  return (
    <div className="space-y-2" data-roadmap-chart>
      <div className="h-[220px] w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="x" type="number" domain={[0, span]} ticks={ticksFor(span)} tickFormatter={(x: number) => dateLabel(addDays(from, x))} {...AXIS} />
            <YAxis domain={domain} width={40} allowDecimals={false} {...AXIS} />
            {starts.map((b) => (
              <ReferenceLine key={b.id} x={daysBetween(from, b.start)} stroke="var(--border)" strokeDasharray="3 3" />
            ))}
            {plan.goal?.kg != null && (
              <ReferenceLine y={u(plan.goal.kg)} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `Target ${u(plan.goal.kg)}`, position: "insideBottomRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
            )}
            <ReferenceLine x={daysBetween(from, today)} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
            <Area dataKey="band" type="linear" stroke="none" fill="var(--muted-foreground)" fillOpacity={0.12} connectNulls isAnimationActive={false} />
            <Area dataKey="projBand" type="linear" stroke="none" fill="var(--foreground)" fillOpacity={0.07} connectNulls isAnimationActive={false} />
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
                    {p.plan != null && <div className="tabular-nums text-muted-foreground">Planned {p.plan} {unit}</div>}
                    {p.projBand && p.proj != null && p.value == null && <div className="tabular-nums">Projected {p.proj} {unit} (likely {p.projBand[0]}–{p.projBand[1]})</div>}
                  </div>
                );
              }}
            />
            <Line dataKey="plan" type="linear" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls isAnimationActive={false} />
            {/* a row with no weigh-in (the plan's own points) draws nothing, never a dot at the top */}
            <Scatter dataKey="value" isAnimationActive={false} shape={(props: any) => (props.payload?.value == null || !Number.isFinite(props.cy) ? <g /> : <circle cx={props.cx} cy={props.cy} r={2.5} fill="var(--muted-foreground)" fillOpacity={0.45} />)} />
            <Line dataKey="avg" type="monotone" stroke="var(--foreground)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="proj" type="linear" stroke="var(--foreground)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-chart-key>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-foreground" aria-hidden />7-day average</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-muted-foreground/15" aria-hidden />Planned range</span>
        {read.progress.projected && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-foreground/70" aria-hidden />Projected</span>}
        {starts.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0 border-l border-dashed border-muted-foreground" aria-hidden />New block</span>}
      </div>
    </div>
  );
}
