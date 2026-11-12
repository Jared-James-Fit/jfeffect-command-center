/**
 * Client profile → Nutrition → How it's going: whether the plan is working,
 * from what the client logged. Bodyweight (every weigh-in, its 7-day average
 * and when each plan started with its calories), the weekly check-in's
 * nutrition consistency (1–5) and water against the target (only once they
 * log it). The math is nutrition-progress.ts; nothing here is estimated.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Activity } from "lucide-react";
import {
  Bar,
  BarChart,
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
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/nutrition/nutrition-ui";
import { clientBodyweightQueryKey, inUnit, loadClientBodyweight } from "@/lib/client-bodyweight";
import { clientPlansQuery } from "@/lib/nutrition-targets/plan-publish";
import { splitPlans } from "@/lib/nutrition-targets/plan-history";
import { configuredHighWeekday } from "@/lib/client-nutrition-day";
import { ensureWaterTarget, formatWater } from "@/lib/water";
import { todayLocalISO } from "@/lib/today";
import {
  PROGRESS_RANGES,
  addDays,
  bodyweightSummary,
  dayIndex,
  nutritionConsistency,
  perWeekText,
  planMarkers,
  rangeStart,
  waterDays,
  withSevenDayAverage,
  type ProgressRange,
} from "@/lib/nutrition-targets/nutrition-progress";
import { cn } from "@/lib/utils";

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;
const TOOLTIP_BOX = "rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-none";
const dateLabel = (d: string) => format(parseISO(d), "MMM d");

export function NutritionProgressCard({ clientId, className }: { clientId: string; className?: string }) {
  const [range, setRange] = useState<ProgressRange>("12w");
  const today = todayLocalISO();
  const from = rangeStart(today, range);
  const span = dayIndex(from, today);

  const { data: client } = useQuery({
    queryKey: ["nutrition-progress-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("user_id, preferred_weight_unit, committed_training_days, preferred_high_days")
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        user_id: string | null;
        preferred_weight_unit: string | null;
        committed_training_days: string[] | null;
        preferred_high_days: string[] | null;
      } | null;
    },
  });
  const unit: "lb" | "kg" = client?.preferred_weight_unit === "kg" ? "kg" : "lb";
  const userId = client?.user_id ?? null;

  const { data: bw, isLoading: loadingBw } = useQuery({
    queryKey: clientBodyweightQueryKey(clientId),
    queryFn: () => loadClientBodyweight(clientId),
  });
  const { data: plans = [] } = useQuery(clientPlansQuery(clientId));
  const { data: checkins = [], isLoading: loadingCheckins } = useQuery({
    queryKey: ["nutrition-progress-checkins", clientId],
    queryFn: async () => {
      const since = addDays(todayLocalISO(), -190);
      const { data, error } = await supabase
        .from("messenger_checkins")
        .select("submitted_at, answers")
        .eq("client_id", clientId)
        .eq("task_type", "weekly_checkin")
        .eq("status", "completed")
        .gte("submitted_at", `${since}T00:00:00Z`)
        .order("submitted_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Array<{ submitted_at: string | null; answers: Record<string, unknown> | null }>;
    },
  });
  const { data: water = [] } = useQuery({
    queryKey: ["nutrition-progress-water", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress_water_entries")
        .select("entry_date, amount_ml")
        .eq("user_id", userId!)
        .gte("entry_date", addDays(todayLocalISO(), -13))
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Array<{ entry_date: string | null; amount_ml: number | null }>;
    },
  });
  const { data: waterTarget } = useQuery({
    queryKey: ["water-target", userId],
    enabled: !!userId,
    queryFn: () => ensureWaterTarget(userId!),
    staleTime: 30_000,
  });

  const all = useMemo(
    () => (bw?.entries ?? []).map((e) => ({ date: e.date, value: Math.round(inUnit(e.value, e.unit, unit) * 10) / 10 })),
    [bw, unit],
  );
  const withAvg = useMemo(() => withSevenDayAverage(all), [all]);
  const shown = useMemo(() => withAvg.filter((p) => p.date >= from && p.date <= today), [withAvg, from, today]);
  const current = splitPlans(plans).current[0] ?? null;
  const summary = useMemo(
    () => bodyweightSummary(shown, all, unit, (current as any)?.start_date ?? null, today),
    [shown, all, unit, current, today],
  );
  const markers = useMemo(
    () =>
      planMarkers(
        plans.map((p: any) => ({
          id: p.id,
          start_date: p.start_date,
          phase: p.phase === "Custom" ? p.custom_phase : p.phase,
          days: (p.nutrition_target_days ?? []).map((d: any) => ({ label: d.day_label, calories: d.calories })),
        })),
        from,
        today,
        client?.committed_training_days ?? [],
        configuredHighWeekday(client?.preferred_high_days ?? null).weekday,
      ),
    [plans, from, today, client],
  );
  const consistency = useMemo(() => nutritionConsistency(checkins, from, today), [checkins, from, today]);
  const waterLog = useMemo(() => waterDays(water, today, 14), [water, today]);
  const targetL = waterTarget?.active_ml ? Math.round(waterTarget.active_ml / 100) / 10 : null;

  return (
    <Card className={cn("space-y-5 border-border bg-card p-4 md:p-6", className)} data-nutrition-progress>
      <CardHeader icon={Activity} title="How it's going" />

      {/* One range for the charts, above them. */}
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Range">
        {PROGRESS_RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={range === r.value}
            onClick={() => setRange(r.value)}
            className={cn(
              "h-9 flex-1 rounded-md text-[13px] font-medium transition-colors",
              range === r.value ? "bg-card text-foreground shadow-none ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Bodyweight against the plans */}
        <Block
          className="md:col-span-2"
          title="Bodyweight"
          figure={summary.latest ? `${summary.latest.avg} ${unit}` : null}
          figureNote={summary.latest ? `7-day average · ${dateLabel(summary.latest.date)}` : null}
          lines={[
            summary.onPlan
              ? summary.onPlan.clear
                ? `On this plan: ${perWeekText(summary.onPlan.perWeek, unit)} (${summary.onPlan.pctPerWeek > 0 ? "+" : ""}${summary.onPlan.pctPerWeek}% of bodyweight)`
                : "On this plan: holding steady (changes so far are within day-to-day noise)"
              : current
                ? "On this plan: not enough weigh-ins yet to call a trend"
                : null,
            summary.rangeChange != null ? `Over ${PROGRESS_RANGES.find((r) => r.value === range)!.label}: ${summary.rangeChange > 0 ? "+" : summary.rangeChange < 0 ? "−" : ""}${Math.abs(summary.rangeChange)} ${unit}` : null,
          ]}
          data-chart="bodyweight"
        >
          {loadingBw ? (
            <div className="h-[200px] animate-pulse rounded-xl bg-muted" />
          ) : shown.length === 0 ? (
            <Empty>{all.length ? `No weigh-ins in the last ${PROGRESS_RANGES.find((r) => r.value === range)!.label}.` : "No weigh-ins yet. They show here once they log their weight."}</Empty>
          ) : (
            <>
              <div className="h-[200px] w-full" role="img" aria-label={`Bodyweight, ${shown.length} weigh-ins, 7-day average ${summary.latest?.avg} ${unit}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={shown.map((p) => ({ ...p, x: dayIndex(from, p.date) }))} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={[0, span]}
                      ticks={ticksFor(span)}
                      tickFormatter={(x: number) => dateLabel(addDays(from, x))}
                      {...AXIS}
                    />
                    <YAxis domain={yDomain(shown.flatMap((p) => [p.value, p.avg]))} width={36} {...AXIS} allowDecimals={false} />
                    {markers.map((m) => (
                      <ReferenceLine
                        key={m.id}
                        x={dayIndex(from, m.date)}
                        stroke="var(--muted-foreground)"
                        strokeDasharray="3 3"
                        label={{ value: m.kcal ? `${m.kcal.toLocaleString("en-US")} kcal` : "New plan", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10, dy: -14 }}
                      />
                    ))}
                    <Tooltip
                      cursor={{ stroke: "var(--border)" }}
                      content={({ active, payload }) => {
                        const p = active && payload?.[0]?.payload;
                        if (!p) return null;
                        return (
                          <div className={TOOLTIP_BOX}>
                            <div className="font-medium">{format(parseISO(p.date), "EEE, MMM d")}</div>
                            <div className="tabular-nums">Weigh-in {p.value} {unit}</div>
                            <div className="tabular-nums text-muted-foreground">7-day average {p.avg} {unit}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter dataKey="value" fill="var(--muted-foreground)" fillOpacity={0.45} shape={(props: any) => <circle cx={props.cx} cy={props.cy} r={3} fill="var(--muted-foreground)" fillOpacity={0.45} />} isAnimationActive={false} />
                    <Line dataKey="avg" type="monotone" stroke="var(--foreground)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: "var(--foreground)" }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-chart-key>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground/45" aria-hidden />Weigh-in</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-foreground" aria-hidden />7-day average</span>
                {markers.length > 0 && (
                  <span className="inline-flex items-center gap-1.5"><span className="h-3 border-l border-dashed border-muted-foreground" aria-hidden />New plan, its calories a day</span>
                )}
              </div>
            </>
          )}
        </Block>

        {/* Weekly check-in: nutrition consistency */}
        <Block
          title="Nutrition consistency"
          figure={consistency.avg != null ? `${consistency.avg} / 5` : null}
          figureNote={consistency.points.length ? `Average of ${consistency.points.length} weekly ${consistency.points.length === 1 ? "check-in" : "check-ins"}` : null}
          data-chart="consistency"
        >
          {loadingCheckins ? (
            <div className="h-[140px] animate-pulse rounded-xl bg-muted" />
          ) : consistency.points.length === 0 ? (
            <Empty>No weekly check-ins in this range. Their 1–5 nutrition rating shows here.</Empty>
          ) : (
            <div className="h-[140px] w-full" role="img" aria-label={`Nutrition consistency, average ${consistency.avg} out of 5`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consistency.points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={dateLabel} interval="preserveStartEnd" minTickGap={16} {...AXIS} />
                  <YAxis domain={[0, 5]} ticks={[1, 3, 5]} width={24} {...AXIS} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    content={({ active, payload }) => {
                      const p = active && payload?.[0]?.payload;
                      if (!p) return null;
                      return (
                        <div className={TOOLTIP_BOX}>
                          <div className="font-medium">Week of {dateLabel(p.date)}</div>
                          <div className="tabular-nums">{p.rating} / 5</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="rating" fill="var(--foreground)" fillOpacity={0.6} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Block>

        {/* Water, the last 14 days, once they log it */}
        <Block
          title="Water"
          figure={waterLog?.avgLiters != null ? `${waterLog.avgLiters} L` : null}
          figureNote={waterLog ? `A day on average · logged ${waterLog.logged} of the last 14 days` : null}
          data-chart="water"
        >
          {!waterLog ? (
            <Empty>No water logged in the last 14 days.</Empty>
          ) : (
            <div className="h-[140px] w-full" role="img" aria-label={`Water, ${waterLog.avgLiters} litres a day on average`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterLog.days} margin={{ top: 14, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={dateLabel} interval="preserveStartEnd" minTickGap={16} {...AXIS} />
                  <YAxis width={28} domain={[0, (max: number) => Math.ceil(Math.max(max, targetL ?? 0) + 0.5)]} allowDecimals={false} {...AXIS} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    content={({ active, payload }) => {
                      const p = active && payload?.[0]?.payload;
                      if (!p) return null;
                      return (
                        <div className={TOOLTIP_BOX}>
                          <div className="font-medium">{format(parseISO(p.date), "EEE, MMM d")}</div>
                          <div className="tabular-nums">{p.liters ? `${p.liters} L` : "Nothing logged"}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="liters" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  {/* over the bars, so the target reads where a bar falls short */}
                  {targetL ? <ReferenceLine y={targetL} stroke="var(--foreground)" strokeDasharray="4 3" strokeWidth={1.5} /> : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {waterLog && targetL ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-4 border-t-[1.5px] border-dashed border-foreground" aria-hidden />
              Target {formatWater(waterTarget!.active_ml, "L")} a day
            </div>
          ) : null}
        </Block>
      </div>
    </Card>
  );
}

/** A chart with its title, the one number that matters, and a line or two on what it means. */
function Block({
  title,
  figure,
  figureNote,
  lines = [],
  className,
  children,
  ...rest
}: {
  title: string;
  figure: string | null;
  figureNote: string | null;
  lines?: Array<string | null>;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  const said = lines.filter(Boolean) as string[];
  return (
    <section className={cn("min-w-0 space-y-2", className)} {...rest}>
      <h4 className="text-[15px] font-semibold">{title}</h4>
      {figure ? (
        <div>
          <div className="text-2xl font-semibold leading-tight tabular-nums">{figure}</div>
          {figureNote ? <div className="text-[13px] text-muted-foreground">{figureNote}</div> : null}
        </div>
      ) : null}
      {said.length ? (
        <ul className="space-y-0.5 text-[13px]">
          {said.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** Four evenly spread date ticks across the range. */
function ticksFor(span: number): number[] {
  if (span <= 0) return [0];
  return [0, Math.round(span / 3), Math.round((2 * span) / 3), span];
}

/** A y range with a little room, in whole units. */
function yDomain(values: number[]): [number, number] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [0, 1];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pad = Math.max(1, (hi - lo) * 0.15);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}
