import { useQuery } from "@tanstack/react-query";
import { Battery, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { recoveryTrendLabel, fetchRecoveryScoreSeries } from "@/lib/analytics/recovery-score";
import { pickCurrentBlock } from "@/lib/block-dates";

interface Props {
  clientId: string;
  /** Reserved for future deep-link; kept for call-site compatibility. */
  analyticsTo: string;
}

type ReadinessTier = "Ready" | "Good" | "Take It Easy" | "Low Readiness";

function readinessFor(score: number): {
  label: ReadinessTier;
  labelClass: string;
  ringClass: string;
  ringSoftClass: string;
  focus: string;
} {
  if (score >= 80) {
    return {
      label: "Ready",
      labelClass: "text-emerald-600 dark:text-emerald-400",
      ringClass: "text-emerald-500",
      ringSoftClass: "text-emerald-500/15",
      focus:
        "Train as planned. Push your top sets if warm-ups feel good.",
    };
  }
  if (score >= 65) {
    return {
      label: "Good",
      labelClass: "text-emerald-600 dark:text-emerald-400",
      ringClass: "text-emerald-500",
      ringSoftClass: "text-emerald-500/15",
      focus: "Train as planned.",
    };
  }
  if (score >= 50) {
    return {
      label: "Take It Easy",
      labelClass: "text-amber-600 dark:text-amber-400",
      ringClass: "text-amber-500",
      ringSoftClass: "text-amber-500/15",
      focus:
        "Stay within today's prescribed RPE/RIR and be conservative if weights feel heavier than expected.",
    };
  }
  return {
    label: "Low Readiness",
    labelClass: "text-rose-600 dark:text-rose-400",
    ringClass: "text-rose-500",
    ringSoftClass: "text-rose-500/15",
    focus:
      "Complete today's workout with quality technique and don't force extra weight if today's performance feels off.",
  };
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
      const latest = series[series.length - 1].score;
      const curAvg = avg(curScores);
      const prevAvg = avg(prevScores);

      // Coach's Note — one short sentence.
      let insight: string | null = null;
      if (curAvg != null && latest >= curAvg + 5) {
        insight = "You're recovering well this week.";
      } else if (curAvg != null && latest <= curAvg - 5) {
        insight = "Readiness is slightly below your normal today.";
      } else if (last3.length === 3 && last3[0] < last3[1] && last3[1] < last3[2]) {
        insight = "Readiness has been improving over your last few workouts.";
      } else if (last3.length === 3 && last3[0] > last3[1] && last3[1] > last3[2]) {
        insight = "Readiness has dipped over your last few workouts.";
      } else if (curAvg != null) {
        insight = "You've handled your recent training well.";
      }

      return {
        hasData: true as const,
        latest,
        curAvg,
        prevAvg,
        trend: recoveryTrendLabel(curAvg, prevAvg),
        insight,
        hasTrendData: curScores.length >= 2 && prevScores.length >= 1,
      };
    },
  });

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <Battery className="h-5 w-5 shrink-0 text-primary" />
      <h2 className="text-base font-black uppercase tracking-wider text-foreground">Training Readiness</h2>
    </div>
  );

  if (isLoading) {
    return (
      <section aria-label="Training Readiness">
        {header}
        <Card className="h-[132px] animate-pulse border-border/80 bg-muted/30" aria-hidden />
      </section>
    );
  }

  if (!data || !data.hasData) {
    return (
      <section aria-label="Training Readiness">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <div className="text-sm font-bold text-foreground">Not Enough Data</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete more workouts to build your readiness trend.
          </p>
        </Card>
      </section>
    );
  }

  const readiness = readinessFor(data.latest);
  const trend = data.trend;
  const trendIcon =
    trend === "Improving" ? <TrendingUp className="h-3.5 w-3.5" />
      : trend === "Declining" ? <TrendingDown className="h-3.5 w-3.5" />
      : <Minus className="h-3.5 w-3.5" />;
  const trendLabel =
    trend === "Declining" ? "Dropping" : trend ?? null;
  const trendClass =
    trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
      : trend === "Declining" ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";

  return (
    <section aria-label="Training Readiness">
      {header}
      <Card className="border-border/80 bg-card p-4">
        <div className="min-w-0">
          <BatteryMeter bars={readiness.bars} barClass={readiness.barClass} />
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-black uppercase tracking-wider leading-tight ${readiness.labelClass}`}>
              {readiness.label}
            </span>
            <span className="text-sm font-bold text-foreground tabular-nums">{data.latest}%</span>
          </div>
          <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Estimated training readiness
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Current block avg
            </div>
            <div className="mt-0.5 text-lg font-black text-foreground tabular-nums">
              {data.curAvg != null ? `${data.curAvg}%` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trend</div>
            {data.hasTrendData && trendLabel ? (
              <div className={`mt-0.5 inline-flex items-center gap-1 text-sm font-bold ${trendClass}`}>
                {trendIcon}
                {trendLabel}
              </div>
            ) : (
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Not Enough Data
              </div>
            )}
          </div>
        </div>

        {data.insight && (
          <div className="mt-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Coach's Note
            </div>
            <p className="mt-1 text-xs text-foreground">{data.insight}</p>
          </div>
        )}

        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Today's Focus
            </div>
            <p className="mt-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground">
              {readiness.focus}
            </p>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Guidance only — your coach's program always comes first.
            </p>
          </div>
          <div className="flex justify-end">
            <Link to={analyticsTo} hash="recovery">
              <Button size="sm" variant="outline" className="font-bold uppercase tracking-wider">
                View Recovery Details
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </Card>
    </section>
  );
}

function BatteryMeter({ bars, barClass }: { bars: number; barClass: string }) {
  const total = 5;
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Readiness ${bars} of ${total} bars`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-3 w-6 rounded-sm border border-border/70",
            i < bars ? barClass : "bg-muted/40",
          )}
        />
      ))}
    </div>
  );
}
