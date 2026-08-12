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
      <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
        <Scale className="h-5 w-5 shrink-0 text-primary" />
        <span className="truncate">Bodyweight</span>
        <InfoTip label="About bodyweight" title="Bodyweight" align="start">
          Bodyweight helps explain performance changes. Compare it with
          strength, volume, recovery, and sleep. A drop in bodyweight with
          stable or improved performance is usually a positive sign.
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
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
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
  const rangeChange = single ? null : latest.value - first.value;
  const spanDays = single
    ? 0
    : Math.max(
        1,
        Math.round((latestDate.getTime() - new Date(first.date + "T00:00:00").getTime()) / 86_400_000),
      );
  const weeklyChange = rangeChange == null || spanDays < 7 ? null : (rangeChange / spanDays) * 7;

  const changeTone =
    rangeChange == null || Math.abs(rangeChange) < 0.05
      ? "text-muted-foreground"
      : rangeChange < 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-600 dark:text-amber-400";
  const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt1(n)} ${displayUnit}`;

  const insight = single
    ? "Only 1 entry — trend not available yet."
    : Math.abs(rangeChange!) < 0.3
      ? `Bodyweight held steady across ${rangeLabel.toLowerCase()}.`
      : rangeChange! < 0
        ? `Bodyweight down ${fmt1(Math.abs(rangeChange!))} ${displayUnit} across this range.`
        : `Bodyweight up ${fmt1(rangeChange!)} ${displayUnit} across this range.`;

  return (
    <section aria-label="Bodyweight">
      {header}
      <Card className="border-border/80 bg-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Latest" value={`${fmt1(latest.value)} ${displayUnit}`} sub={format(latestDate, "MMM d, yyyy")} />
          <Stat label="7-day avg" value={`${fmt1(avg7)} ${displayUnit}`} sub={`${last7.length} entr${last7.length === 1 ? "y" : "ies"}`} />
          <Stat
            label="Range change"
            value={rangeChange == null ? "—" : signed(rangeChange)}
            sub={rangeChange == null ? "Needs 2+ entries" : rangeLabel}
            valueClass={changeTone}
          />
          <Stat
            label="Weekly change"
            value={weeklyChange == null ? "—" : signed(weeklyChange)}
            sub={`${points.length} weigh-in${points.length === 1 ? "" : "s"}`}
          />
        </div>

        {points.length >= 2 && (
          <div className="mt-4 h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => format(new Date(v + "T00:00:00"), "MMM d")}
                  stroke="hsl(var(--muted-foreground))"
                  minTickGap={24}
                />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} width={44} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={(v) => format(new Date(String(v) + "T00:00:00"), "MMM d, yyyy")}
                  formatter={(v: any) => [`${fmt1(Number(v))} ${displayUnit}`, "Bodyweight"]}
                />
                <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">{insight}</p>
      </Card>
    </section>
  );
}

function Stat({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-2.5">
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-lg font-black ${valueClass ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
