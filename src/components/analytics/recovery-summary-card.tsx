import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format } from "date-fns";
import { recoveryTrendLabel, fetchRecoveryScoreSeries } from "@/lib/analytics/recovery-score";

interface Props {
  clientId: string;
  rangeStart: Date;
  rangeEnd: Date;
  rangeLabel: string;
  /** Optional prior-block date range for the comparison chip. */
  prevStart?: Date | null;
  prevEnd?: Date | null;
}

/**
 * Compact recovery card — current period vs previous period average.
 * Averages per-session recovery scores derived from member_workout_reviews.
 * Hides when no reviews exist in the current range.
 */
export function RecoverySummaryCard({ clientId, rangeStart, rangeEnd, rangeLabel, prevStart, prevEnd }: Props) {
  const fmt = (d: Date) => format(d, "yyyy-MM-dd") + "T00:00:00Z";
  const startCur = fmt(rangeStart);
  const endCur = fmt(rangeEnd);
  const startPrev = prevStart ? fmt(prevStart) : null;
  const endPrev = prevEnd ? fmt(prevEnd) : null;

  const { data } = useQuery({
    queryKey: ["recovery-summary", clientId, startCur, endCur, startPrev, endPrev],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const curSeries = await fetchRecoveryScoreSeries(supabase as any, clientId, startCur, endCur);
      const curScores = curSeries.map((r) => r.score);
      let prevAvg: number | null = null;
      if (startPrev && endPrev) {
        const prevSeries = await fetchRecoveryScoreSeries(supabase as any, clientId, startPrev, endPrev);
        const prevScores = prevSeries.map((r) => r.score);
        if (prevScores.length) prevAvg = Math.round(prevScores.reduce((s: number, n: number) => s + n, 0) / prevScores.length);
      }
      const curAvg = curScores.length ? Math.round(curScores.reduce((s: number, n: number) => s + n, 0) / curScores.length) : null;
      return { curAvg, prevAvg, n: curScores.length };
    },
  });

  const trend = data ? recoveryTrendLabel(data.curAvg, data.prevAvg) : null;

  if (!data || data.curAvg == null) {
    return (
      <section aria-label="Recovery">
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
          <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
            <Sparkles className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">Recovery</span>
          </h2>
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rangeLabel}</span>
        </div>
        <Card className="border-border/80 bg-card p-4">
          <div className="text-sm font-bold text-foreground">Not Enough Data</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete more workouts to build your recovery trend.
          </p>
        </Card>
      </section>
    );
  }
  const trendIcon = trend === "Improving" ? <TrendingUp className="h-3.5 w-3.5" />
    : trend === "Declining" ? <TrendingDown className="h-3.5 w-3.5" />
    : <Minus className="h-3.5 w-3.5" />;
  const trendClass = trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
    : trend === "Declining" ? "text-rose-600 dark:text-rose-400"
    : "text-muted-foreground";
  const barPct = Math.max(4, Math.min(100, data.curAvg));

  return (
    <section aria-label="Recovery">
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate">Recovery</span>
        </h2>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rangeLabel}</span>
      </div>
      <Card className="border-border/80 bg-card p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avg recovery</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-4xl font-black text-foreground">{data.curAvg}</span>
              <span className="text-sm font-semibold text-muted-foreground">/100</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${barPct}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Across {data.n} {data.n === 1 ? "review" : "reviews"}
            </div>
          </div>
          {data.prevAvg != null && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-right">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Prev</div>
              <div className="mt-0.5 text-xl font-black text-foreground">{data.prevAvg}</div>
              {trend && (
                <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-bold ${trendClass}`}>
                  {trendIcon} {trend}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}