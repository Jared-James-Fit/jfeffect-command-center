import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { getTrainingLoadDays } from "@/lib/wearables/wearables.functions";
import { loadRamp, nextMorningResponse, type ResponseGroup } from "@/lib/wearables/load-analytics";
import type { DailyMetric } from "@/lib/wearables/providers";
import { cn } from "@/lib/utils";

const RAMP_STYLE = {
  ramping: "bg-amber-500/15 text-amber-400",
  steady: "bg-emerald-500/15 text-emerald-400",
  dropping: "bg-sky-500/15 text-sky-400",
  unknown: "bg-muted text-muted-foreground",
} as const;
const RAMP_LABEL = {
  ramping: "Load ramping",
  steady: "Load steady",
  dropping: "Load dropping",
  unknown: "Not enough history",
} as const;

const signed = (n: number | null, unit: string) =>
  n == null ? "–" : `${n > 0 ? "+" : ""}${n}${unit}`;

/** Recovery overlaid on training. `recovery` must come from a single source. */
export function TrainingRecoveryPanel({
  recovery,
  hrvLabel,
}: {
  recovery: DailyMetric[];
  hrvLabel: string;
}) {
  const pov = usePovArgs();
  const loadFn = usePovFn(getTrainingLoadDays);
  const { data } = useQuery({
    queryKey: ["training-load-days", pov.viewAsClientId ?? "me"],
    staleTime: 5 * 60_000,
    queryFn: () => loadFn({ data: {} }),
  });
  const days = data?.days ?? [];

  const asOf = recovery.length ? recovery[recovery.length - 1].metric_date : null;
  const ramp = useMemo(() => (asOf ? loadRamp(days, asOf) : null), [days, asOf]);
  const response = useMemo(() => nextMorningResponse(days, recovery), [days, recovery]);

  const chart = useMemo(() => {
    const hard = new Map(days.map((d) => [d.day, d.hard_sets]));
    return recovery.slice(-30).map((r) => ({
      d: r.metric_date.slice(5),
      hard: hard.get(r.metric_date) ?? 0,
      hrv: r.hrv_ms,
    }));
  }, [days, recovery]);

  if (!days.length || !recovery.length) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">Training vs recovery</h4>
        {ramp && (
          <span
            className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", RAMP_STYLE[ramp.state])}
          >
            {RAMP_LABEL[ramp.state]}
            {ramp.ratio != null && ` · ${ramp.ratio}×`}
          </span>
        )}
      </div>
      {ramp && ramp.ratio != null && (
        <p className="text-xs text-muted-foreground">
          {ramp.acuteHardSets} hard sets (RPE 8+) in the last 7 days vs {ramp.chronicWeeklyHardSets}{" "}
          per week over the last 28.
        </p>
      )}

      {chart.some((c) => c.hrv != null) && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="l" hide />
              <YAxis yAxisId="r" hide domain={["dataMin - 5", "dataMax + 5"]} />
              <Bar
                yAxisId="l"
                dataKey="hard"
                fill="hsl(var(--muted-foreground) / 0.45)"
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="r"
                type="monotone"
                dataKey="hrv"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
            <span>Bars: hard sets</span>
            <span>Line: {hrvLabel}</span>
          </div>
        </div>
      )}

      {response && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Group title="Morning after a hard day" g={response.afterHard} />
            <Group title="Morning after rest" g={response.afterRest} />
          </div>
          <p className="text-xs text-muted-foreground">
            {response.reliable
              ? `Versus their own 14-day baseline. "Hard" means ${response.hardThresholdHardSets}+ hard sets.`
              : "Not enough hard and rest days yet to read a pattern. These are early numbers, not a conclusion."}
          </p>
        </div>
      )}
    </div>
  );
}

function Group({ title, g }: { title: string; g: ResponseGroup }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 text-sm font-semibold">HRV {signed(g.avgHrvPct, "%")}</div>
      <div className="text-xs text-muted-foreground">
        RHR {signed(g.avgRestingHrDeltaBpm, " bpm")} · {g.n} {g.n === 1 ? "day" : "days"}
      </div>
    </div>
  );
}
