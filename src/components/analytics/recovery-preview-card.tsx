import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Sparkles, TrendingUp, TrendingDown, Minus, ArrowRight, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { recoveryTrendLabel, fetchRecoveryScoreSeries } from "@/lib/analytics/recovery-score";
import { pickCurrentBlock } from "@/lib/block-dates";
import { cn } from "@/lib/utils";

interface Props {
  clientId: string;
  /** Full-analytics route to open when tapping "View Recovery". */
  analyticsTo: string;
}

function statusFor(score: number): { label: string; className: string } {
  if (score >= 85) return { label: "Excellent", className: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 70) return { label: "Good", className: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 55) return { label: "Fair", className: "text-amber-600 dark:text-amber-400" };
  return { label: "Low", className: "text-rose-600 dark:text-rose-400" };
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

/**
 * Compact Recovery snapshot rendered on the main Workouts page.
 * Uses existing review data; never asks the client for new input.
 */
export function RecoveryPreviewCard({ clientId, analyticsTo }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["recovery-preview", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      // Blocks to resolve current + previous block windows.
      const { data: blocks } = await (supabase as any)
        .from("pl_blocks")
        .select("id, start_date, end_date, status, archived, sort_order, created_at")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true });
      const cur = pickCurrentBlock((blocks ?? []) as any[]);
      let prev: any = null;
      if (cur) {
        const visible = (blocks ?? []).filter(
          (b: any) => !b.archived && b.status !== "Archived",
        );
        const idx = visible.findIndex((b: any) => b.id === cur.id);
        prev = idx > 0 ? visible[idx - 1] : null;
      }

      // Pull last 180d of recovery signal from reviews + completions + row logs.
      const since = new Date();
      since.setDate(since.getDate() - 180);
      const series = await fetchRecoveryScoreSeries(
        supabase as any,
        clientId,
        since.toISOString(),
      );
      if (!series.length) return { hasData: false as const };

      const inRange = (ts: string, block: any | null): boolean => {
        if (!block) return false;
        const t = new Date(ts).getTime();
        const s = block.start_date ? new Date(block.start_date).getTime() : null;
        const e = block.end_date ? new Date(block.end_date + "T23:59:59Z").getTime() : null;
        if (s != null && t < s) return false;
        if (e != null && t > e) return false;
        return true;
      };

      const curScores = series.filter((r) => inRange(r.ts, cur)).map((r) => r.score);
      const prevScores = series.filter((r) => inRange(r.ts, prev)).map((r) => r.score);
      const last3 = series.slice(-3).map((r) => r.score);
      const latestScores = series.slice(-6).map((r) => r.score);
      const latest = series[series.length - 1].score;
      const curAvg = avg(curScores);
      const prevAvg = avg(prevScores);

      // Coach Insight — one short actionable sentence.
      let insight: string | null = null;
      if (curAvg != null && latest >= curAvg + 5) {
        insight = "Recovery is above your average. A good day to push performance.";
      } else if (curAvg != null && latest <= curAvg - 5) {
        insight = "Recovery is slightly below your normal. Today's workout may feel harder.";
      } else if (last3.length === 3 && last3[0] < last3[1] && last3[1] < last3[2]) {
        insight = "Recovery is trending up across your last few workouts.";
      } else if (last3.length === 3 && last3[0] > last3[1] && last3[1] > last3[2]) {
        insight = "Recovery is trending down. Consider dialing back intensity today.";
      } else if (curAvg != null) {
        insight = "Recovery has been consistent over your last few workouts.";
      }

      return {
        hasData: true as const,
        latest,
        curAvg,
        prevAvg,
        latestScores,
        trend: recoveryTrendLabel(curAvg, prevAvg),
        insight,
        hasTrendData: curScores.length >= 2 && prevScores.length >= 1,
      };
    },
  });

  const [expanded, setExpanded] = useState(false);

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <Sparkles className="h-5 w-5 shrink-0 text-primary" />
      <h2 className="text-base font-black uppercase tracking-wider text-foreground">Recovery</h2>
    </div>
  );

  if (isLoading) {
    return (
      <section aria-label="Recovery">
        {header}
        <Card className="h-[132px] animate-pulse border-border/80 bg-muted/30" aria-hidden />
      </section>
    );
  }

  if (!data || !data.hasData) {
    return (
      <section aria-label="Recovery">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <div className="text-sm font-bold text-foreground">Not Enough Data</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete more workouts to build your recovery trend.
          </p>
        </Card>
      </section>
    );
  }

  const status = statusFor(data.latest);
  const trend = data.trend;
  const trendIcon =
    trend === "Improving" ? <TrendingUp className="h-3.5 w-3.5" />
      : trend === "Declining" ? <TrendingDown className="h-3.5 w-3.5" />
      : <Minus className="h-3.5 w-3.5" />;
  const trendClass =
    trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
      : trend === "Declining" ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";

  const recentScores = (data.latestScores ?? []).slice(-4);

  return (
    <section aria-label="Recovery">
      {header}
      <Card className="border-border/80 bg-card p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="recovery-preview-details"
          className="-mx-1 -mt-1 flex w-full items-start justify-between gap-3 rounded-lg p-1 text-left transition-colors hover:bg-muted/30"
        >
          <div className="min-w-0">
            <div className={`text-3xl font-black uppercase tracking-wider leading-tight ${status.className}`}>
              {status.label}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-foreground tabular-nums">{data.latest}</span>
              <span className="text-xs font-semibold text-muted-foreground">/ 100</span>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Latest recovery score
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <div className="grid grid-cols-2 gap-2 text-right">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Block avg</div>
                <div className="mt-0.5 text-lg font-black text-foreground">
                  {data.curAvg ?? "—"}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trend</div>
                {data.hasTrendData && trend ? (
                  <div className={`mt-0.5 inline-flex items-center gap-1 text-xs font-bold ${trendClass}`}>
                    {trendIcon}
                    {trend}
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Not Enough Data
                  </div>
                )}
              </div>
            </div>
            <ChevronDown
              className={cn(
                "mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </div>
        </button>

        {expanded && (
          <div id="recovery-preview-details" className="mt-3 space-y-3 border-t border-border/60 pt-3">
            {recentScores.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Recent recovery
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="flex gap-1.5">
                    {recentScores.map((s, i) => {
                      const isLatest = i === recentScores.length - 1;
                      return (
                        <span
                          key={i}
                          className={cn(
                            "inline-flex min-w-[38px] items-center justify-center rounded-md border px-2 py-1 text-xs font-bold tabular-nums",
                            isLatest
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-muted/40 text-foreground",
                          )}
                        >
                          {s}
                        </span>
                      );
                    })}
                  </div>
                  {recentScores.length >= 2 && (
                    <Sparkline values={recentScores} className="ml-auto" />
                  )}
                </div>
              </div>
            )}
            {data.insight && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Coach Insight
                </div>
                <p className="mt-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground">
                  {data.insight}
                </p>
              </div>
            )}
            <div className="flex justify-end">
              <Link to={analyticsTo} hash="recovery">
                <Button size="sm" variant="outline" className="font-bold uppercase tracking-wider">
                  View Full Analytics
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const { path, w, h } = useMemo(() => {
    const w = 72;
    const h = 24;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const pts = values.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { path: `M ${pts.join(" L ")}`, w, h };
  }, [values]);
  const first = values[0];
  const last = values[values.length - 1];
  const stroke = last > first ? "stroke-emerald-500" : last < first ? "stroke-rose-500" : "stroke-muted-foreground";
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      <path d={path} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={stroke} />
    </svg>
  );
}
