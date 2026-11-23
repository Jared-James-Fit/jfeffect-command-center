import { niceDomain } from "@/lib/analytics/analytics-areas";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Scale } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/analytics/info-tip";
import { getCombinedBodyweightSeries, toKg, toLb } from "@/lib/bodyweight";

type Unit = "lb" | "kg";

interface Props {
  clientId: string;
  displayUnit: Unit;
  rangeStart: Date;
  rangeEnd: Date;
  rangeLabel: string;
}

const day = (d: Date) => format(d, "yyyy-MM-dd");
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * Bodyweight context for Training Analytics. Reads the same combined
 * bodyweight source the portal home / progress screens use
 * (`progress_bodyweight` + legacy `progress_metrics`), scoped to the
 * selected client and the analytics date range + unit toggle.
 */
export function BodyweightTrendCard({ clientId, displayUnit, rangeStart, rangeEnd, rangeLabel }: Props) {
  const startKey = day(rangeStart);
  const endKey = day(rangeEnd);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-bodyweight", clientId, startKey, endKey],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: row } = await supabase
        .from("clients")
        .select("user_id")
        .eq("id", clientId)
        .maybeSingle();
      const userId = (row as any)?.user_id as string | null;
      if (!userId) return { all: [], inRange: [] };
      const series = await getCombinedBodyweightSeries(userId, 200);
      return {
        all: series,
        inRange: series.filter((p) => p.date >= startKey && p.date <= endKey),
      };
    },
  });

  const points = (data?.inRange ?? []).map((p) => ({
    date: p.date,
    value: displayUnit === "kg" ? toKg(p.value, p.unit) : toLb(p.value, p.unit),
  }));

  const header = (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
      <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-semibold text-foreground">
        <Scale className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="truncate">Bodyweight</span>
        <InfoTip label="About bodyweight" title="Bodyweight" align="start">
          Every weigh-in, with the change measured between weekly averages
          (single weigh-ins swing with water and food). Read it beside
          strength: a lighter body lifting the same weights is a gain.
        </InfoTip>
      </h2>
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rangeLabel}</span>
    </div>
  );

  if (isLoading) {
    return (
      <section aria-label="Bodyweight">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <div className="h-16 jf-skeleton rounded-lg bg-muted/40" />
        </Card>
      </section>
    );
  }

  const totalLogs = data?.all?.length ?? 0;

  if (points.length === 0) {
    return (
      <section aria-label="Bodyweight">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <div className="text-sm font-bold text-foreground">No bodyweight entries in this range.</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {totalLogs > 0
              ? "Try a wider range — entries exist outside this window."
              : "Bodyweight logged on the home dashboard will appear here."}
          </p>
        </Card>
      </section>
    );
  }

  const latest = points[points.length - 1];
  const first = points[0];
  const latestDate = new Date(latest.date + "T00:00:00");

  // 7-day average: entries within the 7 days ending on the latest weigh-in.
  const sevenAgo = new Date(latestDate);
  sevenAgo.setDate(sevenAgo.getDate() - 6);
  const sevenKey = format(sevenAgo, "yyyy-MM-dd");
  const last7 = points.filter((p) => p.date >= sevenKey);
  const avg7 = last7.reduce((s, p) => s + p.value, 0) / last7.length;

  const single = points.length < 2;
  // Change from the first week's average to the last week's: one weigh-in to
  // another is mostly water and food, and read as a trend it can say anything.
  const firstDate = new Date(first.date + "T00:00:00");
  const firstWeekEnd = format(new Date(firstDate.getTime() + 6 * 86_400_000), "yyyy-MM-dd");
  const firstWeek = points.filter((p) => p.date <= firstWeekEnd);
  const avgFirst = firstWeek.reduce((s, p) => s + p.value, 0) / Math.max(1, firstWeek.length);
  const spanDays = single
    ? 0
    : Math.max(1, Math.round((latestDate.getTime() - firstDate.getTime()) / 86_400_000));
  const comparable = !single && spanDays >= 14 && last7[0]?.date > firstWeekEnd;
  const rangeChange = comparable ? avg7 - avgFirst : null;
  const weeklyChange = rangeChange == null ? null : (rangeChange / spanDays) * 7;

  // Up or down is neither good nor bad on its own (a gain phase, a cut): no colour judges it.
  const changeTone = rangeChange == null || Math.abs(rangeChange) < 0.05 ? "text-muted-foreground" : "text-foreground";
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))} ${displayUnit}`;
  // the axis never zooms in past normal day-to-day swing (3% of bodyweight)
  const bwAxis = niceDomain(
    points.map((p) => p.value),
    { minSpan: Math.max(displayUnit === "kg" ? 2 : 4, (points[points.length - 1]?.value ?? 0) * 0.03) },
  );

  const insight = single
    ? "One weigh-in so far: a trend needs a few more."
    : rangeChange == null
      ? "Needs two weeks of weigh-ins to compare."
      : Math.abs(rangeChange) < 0.3
        ? `Holding steady: the last week's average is within 0.3 ${displayUnit} of the first week's.`
        : `${rangeChange < 0 ? "Down" : "Up"} ${fmt1(Math.abs(rangeChange))} ${displayUnit}, first week's average to the last week's.`;

  return (
    <section aria-label="Bodyweight">
      {header}
      <Card className="border-border/80 bg-card p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="7-day average" value={`${fmt1(avg7)}`} unit={displayUnit} sub={`to ${format(latestDate, "MMM d")} · ${last7.length} weigh-in${last7.length === 1 ? "" : "s"}`} />
          <Stat
            label="Change"
            value={rangeChange == null ? "—" : signed(rangeChange).replace(` ${displayUnit}`, "")}
            unit={rangeChange == null ? undefined : displayUnit}
            sub={rangeChange == null ? "Needs 2+ weeks" : `since ${format(firstDate, "MMM d")}`}
            valueClass={changeTone}
          />
          <Stat
            label="A week"
            value={weeklyChange == null ? "—" : signed(weeklyChange).replace(` ${displayUnit}`, "")}
            unit={weeklyChange == null ? undefined : displayUnit}
            sub={weeklyChange == null ? "Needs 2+ weeks" : "on average"}
          />
        </div>

        {points.length >= 2 && (
          <div className="mt-4 h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in oklab, var(--border) 60%, transparent)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => format(new Date(v + "T00:00:00"), "MMM d")}
                  stroke="var(--muted-foreground)"
                  minTickGap={24}
                />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" domain={bwAxis.domain} ticks={bwAxis.ticks} width={44} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={(v) => format(new Date(String(v) + "T00:00:00"), "MMM d, yyyy")}
                  formatter={(v: any) => [`${fmt1(Number(v))} ${displayUnit}`, "Bodyweight"]}
                />
                <Line type="linear" dataKey="value" stroke="var(--foreground)" strokeOpacity={0.75} strokeWidth={1.75} dot={{ r: 2, fill: "var(--foreground)", fillOpacity: 0.75, strokeWidth: 0 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">{insight}</p>
      </Card>
    </section>
  );
}

function Stat({ label, value, unit, sub, valueClass }: { label: string; value: string; unit?: string; sub?: string; valueClass?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${valueClass ?? "text-foreground"}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
