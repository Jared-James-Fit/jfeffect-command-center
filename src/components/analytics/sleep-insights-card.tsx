import { useQuery } from "@tanstack/react-query";
import { Moon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { sleepBucketHours, type SleepBucket } from "@/lib/analytics/recovery-score";
import { InfoTip } from "@/components/analytics/info-tip";

interface Props {
  clientId: string;
  blockStart?: Date | null;
  blockEnd?: Date | null;
  blockLabel?: string;
}

type Row = {
  completion_id: string;
  sleep_bucket: SleepBucket;
  completed_at: string | null;
  logging_percentage: number | null;
  session_rating: number | null;
};

function fmt(d: Date) {
  return d.toISOString();
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function fmtHrs(h: number | null): string {
  return h == null ? "—" : `${h.toFixed(1)}h`;
}

/**
 * Sleep Insights — surfaces averages, trend, and personalized correlations
 * between sleep and training. Uses the athlete's own history only.
 */
export function SleepInsightsCard({ clientId, blockStart, blockEnd, blockLabel }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["sleep-insights", clientId, blockStart?.toISOString() ?? null, blockEnd?.toISOString() ?? null],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 120);

      // Pull feedback rows with sleep + join their completion for date/quality.
      const { data: fbs } = await (supabase as any)
        .from("pl_workout_feedback")
        .select(
          "completion_id, sleep_bucket, pl_day_completions!inner(completed_at, logging_percentage, session_rating, client_id)",
        )
        .eq("client_id", clientId)
        .not("sleep_bucket", "is", null)
        .gte("pl_day_completions.completed_at", since.toISOString())
        .order("pl_day_completions(completed_at)", { ascending: true });

      const rows: Row[] = ((fbs ?? []) as any[])
        .map((r) => ({
          completion_id: r.completion_id,
          sleep_bucket: r.sleep_bucket as SleepBucket,
          completed_at: r.pl_day_completions?.completed_at ?? null,
          logging_percentage: r.pl_day_completions?.logging_percentage ?? null,
          session_rating: r.pl_day_completions?.session_rating ?? null,
        }))
        .filter((r) => r.completed_at)
        .sort((a, b) => new Date(a.completed_at!).getTime() - new Date(b.completed_at!).getTime());

      if (rows.length === 0) return { empty: true as const };

      const hoursOf = (r: Row) => sleepBucketHours(r.sleep_bucket) ?? 0;

      // Block avg
      const inBlock = (r: Row) => {
        if (!blockStart || !r.completed_at) return false;
        const t = new Date(r.completed_at).getTime();
        if (t < blockStart.getTime()) return false;
        if (blockEnd && t > blockEnd.getTime() + 86400_000) return false;
        return true;
      };
      const blockRows = blockStart ? rows.filter(inBlock) : [];
      const blockAvg = avg(blockRows.map(hoursOf));

      // Last 7 sessions / last 30 days
      const last7 = rows.slice(-7);
      const since30 = Date.now() - 30 * 86400_000;
      const last30 = rows.filter((r) => new Date(r.completed_at!).getTime() >= since30);
      const avg7 = avg(last7.map(hoursOf));
      const avg30 = avg(last30.map(hoursOf));

      // Trend: recent 3 vs previous 3
      let trend: "Improving" | "Stable" | "Dropping" | null = null;
      if (rows.length >= 6) {
        const recent = avg(rows.slice(-3).map(hoursOf))!;
        const prev = avg(rows.slice(-6, -3).map(hoursOf))!;
        const diff = recent - prev;
        trend = diff >= 0.3 ? "Improving" : diff <= -0.3 ? "Dropping" : "Stable";
      }

      // Personalized insights
      const insights: string[] = [];
      // 1) Top performance days by session_rating >= 4 or completion 100
      const highPerf = rows.filter(
        (r) => (r.session_rating ?? 0) >= 4 || (r.logging_percentage ?? 0) >= 95,
      );
      const lowPerf = rows.filter(
        (r) => (r.session_rating != null && r.session_rating <= 2) || (r.logging_percentage ?? 100) < 70,
      );
      if (highPerf.length >= 3) {
        const h = avg(highPerf.map(hoursOf));
        if (h != null) insights.push(`Your best sessions average ${h.toFixed(1)}h of sleep.`);
      }
      if (lowPerf.length >= 3) {
        const l = avg(lowPerf.map(hoursOf));
        if (l != null) insights.push(`Your low-readiness sessions average ${l.toFixed(1)}h of sleep.`);
      }
      if (avg30 != null && rows.length >= 8) {
        const older = rows.slice(0, Math.floor(rows.length / 2));
        const newer = rows.slice(Math.floor(rows.length / 2));
        const diff = (avg(newer.map(hoursOf)) ?? 0) - (avg(older.map(hoursOf)) ?? 0);
        if (Math.abs(diff) >= 0.4) {
          insights.push(
            diff > 0
              ? `Your average sleep has increased by ${diff.toFixed(1)}h recently.`
              : `Your average sleep has dropped by ${Math.abs(diff).toFixed(1)}h recently.`,
          );
        }
      }

      return {
        empty: false as const,
        blockAvg,
        avg7,
        avg30,
        trend,
        insights,
        sampleCount: rows.length,
      };
    },
  });

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <Moon className="h-5 w-5 shrink-0 text-primary" />
      <h2 className="text-base font-black uppercase tracking-wider text-foreground">Sleep Insights</h2>
      <InfoTip label="About sleep insights" title="Sleep Insights" align="start">
        Sleep comes from the rating logged on workout reviews/check-ins — it is
        only as reliable as how often entries are logged. Averages convert each
        rating to hours. A trend needs at least 6 logged entries; more entries
        make it more trustworthy.
      </InfoTip>
    </div>
  );

  if (isLoading) {
    return (
      <section aria-label="Sleep Insights">
        {header}
        <Card className="h-[160px] animate-pulse border-border/80 bg-muted/30" aria-hidden />
      </section>
    );
  }

  if (!data || data.empty) {
    return (
      <section aria-label="Sleep Insights">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <div className="text-sm font-bold text-foreground">No sleep data yet</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Log sleep on a few workout reviews to unlock personalized sleep insights.
          </p>
        </Card>
      </section>
    );
  }

  const trend = data.trend;
  const trendIcon =
    trend === "Improving" ? <TrendingUp className="h-3.5 w-3.5" />
      : trend === "Dropping" ? <TrendingDown className="h-3.5 w-3.5" />
      : <Minus className="h-3.5 w-3.5" />;
  const trendClass =
    trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
      : trend === "Dropping" ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";

  return (
    <section aria-label="Sleep Insights">
      {header}
      <Card className="border-border/80 bg-card p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label={blockLabel ? `${blockLabel} avg` : "Block avg"} value={fmtHrs(data.blockAvg)} />
          <Stat label="Last 7 sessions" value={fmtHrs(data.avg7)} />
          <Stat label="Last 30 days" value={fmtHrs(data.avg30)} />
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trend</div>
          {trend ? (
            <div className={`inline-flex items-center gap-1 text-sm font-bold ${trendClass}`}>
              {trendIcon}
              {trend}
            </div>
          ) : (
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Not enough data for trend
            </div>
          )}
        </div>

        {data.insights.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {data.insights.map((s, i) => (
              <li
                key={i}
                className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground"
              >
                {s}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-[10px] text-muted-foreground">
          Based on {data.sampleCount} logged {data.sampleCount === 1 ? "entry" : "entries"}.
          {data.sampleCount < 6 && " Trends unlock after 6 entries."}
        </p>
      </Card>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-black text-foreground tabular-nums">{value}</div>
    </div>
  );
}