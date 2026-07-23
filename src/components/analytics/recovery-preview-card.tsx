import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { fetchRecoveryScoreSeries, type SleepBucket } from "@/lib/analytics/recovery-score";
import {
  buildReadinessBreakdown,
  buildPersonalInsights,
  type FactorDetail,
  type FactorKey,
  type FactorStatus,
  type SleepSample,
} from "@/lib/analytics/readiness-factors";
import { pickCurrentBlock } from "@/lib/block-dates";
import { cn } from "@/lib/utils";

interface Props {
  clientId: string;
  /** Deep link into full Training Analytics (kept for compatibility). */
  analyticsTo: string;
}

type Tier = "Ready" | "Good" | "Take It Easy" | "Low";

function tierFor(score: number): {
  label: Tier;
  labelClass: string;
  ringClass: string;
  ringSoftClass: string;
} {
  if (score >= 80) return {
    label: "Ready",
    labelClass: "text-emerald-600 dark:text-emerald-400",
    ringClass: "text-emerald-500",
    ringSoftClass: "text-emerald-500/12",
  };
  if (score >= 65) return {
    label: "Good",
    labelClass: "text-emerald-600 dark:text-emerald-400",
    ringClass: "text-emerald-500",
    ringSoftClass: "text-emerald-500/12",
  };
  if (score >= 50) return {
    label: "Take It Easy",
    labelClass: "text-amber-600 dark:text-amber-400",
    ringClass: "text-amber-500",
    ringSoftClass: "text-amber-500/12",
  };
  return {
    label: "Low",
    labelClass: "text-rose-600 dark:text-rose-400",
    ringClass: "text-rose-500",
    ringSoftClass: "text-rose-500/12",
  };
}

const statusColor: Record<FactorStatus, { ring: string; soft: string; text: string; dot: string }> = {
  good: {
    ring: "text-emerald-500",
    soft: "text-emerald-500/12",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  watch: {
    ring: "text-amber-500",
    soft: "text-amber-500/12",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  low: {
    ring: "text-rose-500",
    soft: "text-rose-500/12",
    text: "text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
  },
};

function rollingTrend(scores: number[]) {
  const valid = scores.filter((n) => Number.isFinite(n));
  if (valid.length < 6) return { label: null as null | "Improving" | "Stable" | "Dropping", diff: 0 };
  const r = valid.slice(-3).reduce((s, n) => s + n, 0) / 3;
  const p = valid.slice(-6, -3).reduce((s, n) => s + n, 0) / 3;
  const diff = r - p;
  if (diff >= 3) return { label: "Improving" as const, diff };
  if (diff <= -3) return { label: "Dropping" as const, diff };
  return { label: "Stable" as const, diff };
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

export function RecoveryPreviewCard({ clientId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["training-readiness", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date();
      const since180 = new Date(now); since180.setDate(now.getDate() - 180);
      const since30 = new Date(now); since30.setDate(now.getDate() - 30);
      const since14 = new Date(now); since14.setDate(now.getDate() - 14);
      const since7 = new Date(now); since7.setDate(now.getDate() - 7);

      // Blocks for "current block avg"
      const { data: blocks } = await (supabase as any)
        .from("pl_blocks")
        .select("id, start_date, end_date, status, archived, sort_order, created_at")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true });
      const curBlock = pickCurrentBlock((blocks ?? []) as any[]);

      // Series of readiness scores
      const series = await fetchRecoveryScoreSeries(
        supabase as any,
        clientId,
        since180.toISOString(),
      );

      // Reviews for sleep / recovery-feel / pain samples
      const { data: reviews } = await (supabase as any)
        .from("member_workout_reviews")
        .select(
          "review_submitted_at, sleep_bucket, recovery_today, pain, member_plan_enrollments!inner(client_id)",
        )
        .eq("member_plan_enrollments.client_id", clientId)
        .gte("review_submitted_at", since180.toISOString())
        .order("review_submitted_at", { ascending: true });

      // Feedback for sleep buckets (keyed via completion→client_id already scoped)
      const { data: feedback } = await (supabase as any)
        .from("pl_workout_feedback")
        .select("created_at, sleep_bucket, client_id")
        .eq("client_id", clientId)
        .gte("created_at", since180.toISOString())
        .not("sleep_bucket", "is", null);

      // Completions
      const { data: comps } = await (supabase as any)
        .from("pl_day_completions")
        .select("completed_at")
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .gte("completed_at", since30.toISOString());
      const completedTs: number[] = (comps ?? []).map((c: any) => new Date(c.completed_at).getTime());
      const workouts7d = completedTs.filter((t: number) => t >= since7.getTime()).length;
      const workouts14d = completedTs.filter((t: number) => t >= since14.getTime()).length;
      const completed30d = completedTs.length;

      // Scheduled workouts in last 30d (best-effort)
      let scheduled30d: number | null = null;
      try {
        const { count } = await (supabase as any)
          .from("pl_scheduled_workouts")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .gte("scheduled_date", since30.toISOString().slice(0, 10));
        scheduled30d = typeof count === "number" ? count : null;
      } catch { scheduled30d = null; }

      // Sleep samples merged (reviews + feedback)
      const sleepSamples: SleepSample[] = [];
      for (const r of (reviews ?? []) as any[]) {
        if (r.sleep_bucket) sleepSamples.push({ ts: r.review_submitted_at, bucket: r.sleep_bucket as SleepBucket });
      }
      for (const f of (feedback ?? []) as any[]) {
        if (f.sleep_bucket) sleepSamples.push({ ts: f.created_at, bucket: f.sleep_bucket as SleepBucket });
      }
      sleepSamples.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      const recoverySamples = ((reviews ?? []) as any[])
        .filter((r) => r.recovery_today != null)
        .map((r) => ({ ts: r.review_submitted_at, rating: Number(r.recovery_today) }));

      const painDays7d = ((reviews ?? []) as any[])
        .filter((r) => r.pain === true && new Date(r.review_submitted_at).getTime() >= since7.getTime())
        .length;

      const allScores = series.map((r) => r.score);
      const latest = allScores.length ? allScores[allScores.length - 1] : null;
      const trend = rollingTrend(allScores);

      const inCurBlock = (ts: string) => {
        if (!curBlock) return false;
        const t = new Date(ts).getTime();
        const s = curBlock.start_date ? new Date(curBlock.start_date).getTime() : null;
        const e = curBlock.end_date ? new Date(curBlock.end_date + "T23:59:59Z").getTime() : null;
        if (s != null && t < s) return false;
        if (e != null && t > e) return false;
        return true;
      };
      const curBlockAvg = avg(series.filter((r) => inCurBlock(r.ts)).map((r) => r.score));

      const breakdown = buildReadinessBreakdown({
        sleepSamples,
        recoverySamples,
        workouts7d,
        workouts14d,
        completed30d,
        scheduled30d,
        scores: allScores,
        painDays7d,
      });

      const insights = buildPersonalInsights(series, sleepSamples, completed30d, scheduled30d);

      return {
        hasData: latest != null,
        latest: latest ?? 0,
        curBlockAvg,
        trend: trend.label,
        breakdown,
        insights,
      };
    },
  });

  const [openFactor, setOpenFactor] = useState<FactorKey | null>(null);

  const header = (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-black uppercase tracking-wider text-foreground">
        Training Readiness
      </h2>
    </div>
  );

  if (isLoading) {
    return (
      <section aria-label="Training Readiness">
        {header}
        <Card className="h-[380px] animate-pulse border-border/60 bg-muted/20 shadow-sm" aria-hidden />
      </section>
    );
  }

  if (!data || !data.hasData) {
    return (
      <section aria-label="Training Readiness">
        {header}
        <Card className="border-border/60 bg-card p-5 shadow-sm">
          <div className="text-sm font-bold text-foreground">Not Enough Data</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete a few workouts and log sleep to unlock your Training Readiness.
          </p>
        </Card>
      </section>
    );
  }

  const tier = tierFor(data.latest);
  const trend = data.trend;
  const trendIcon =
    trend === "Improving" ? <TrendingUp className="h-3.5 w-3.5" />
      : trend === "Dropping" ? <TrendingDown className="h-3.5 w-3.5" />
      : <Minus className="h-3.5 w-3.5" />;
  const trendClass =
    trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
      : trend === "Dropping" ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";

  const bd = data.breakdown;
  const activeFactor = openFactor ? bd.factors[openFactor] : null;

  return (
    <section aria-label="Training Readiness" className="space-y-4">
      {header}

      {/* MAIN CARD */}
      <Card className="relative overflow-hidden border-border/60 bg-gradient-to-b from-card to-card/60 p-5 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <ReadinessRing
            score={data.latest}
            label={tier.label}
            labelClass={tier.labelClass}
            ringClass={tier.ringClass}
            ringSoftClass={tier.ringSoftClass}
          />
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Estimated Training Readiness
          </div>
        </div>

        {/* Block avg + trend */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Current Block Avg
            </div>
            <div className="mt-0.5 text-lg font-black text-foreground tabular-nums">
              {data.curBlockAvg != null ? `${data.curBlockAvg}%` : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Trend
            </div>
            {trend ? (
              <div className={cn("mt-0.5 inline-flex items-center gap-1 text-sm font-bold", trendClass)}>
                {trendIcon}
                {trend}
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Building Trend
              </div>
            )}
          </div>
        </div>

        {/* Positive / Limiter / Recommendation */}
        <div className="mt-4 space-y-2.5">
          {bd.positive && (
            <FactorPill
              tone="positive"
              heading="Biggest Positive"
              emoji={bd.positive.emoji}
              label={bd.positive.label}
              hint={bd.positive.currentValue}
              onClick={() => setOpenFactor(bd.positive!.key)}
            />
          )}
          {bd.limiter && (
            <FactorPill
              tone="limiter"
              heading="Biggest Limiter"
              emoji={bd.limiter.emoji}
              label={bd.limiter.label}
              hint={bd.limiter.currentValue}
              onClick={() => setOpenFactor(bd.limiter!.key)}
            />
          )}
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              💡 Today's Recommendation
            </div>
            <p className="mt-1 text-sm leading-snug text-foreground">
              {bd.recommendation}
            </p>
          </div>
        </div>
      </Card>

      {/* BREAKDOWN */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-foreground">
            What's Affecting Today's Readiness
          </h3>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Tap to explore
          </span>
        </div>
        <Card className="border-border/60 bg-card p-3 shadow-sm">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {bd.order.map((k) => (
              <FactorRing
                key={k}
                factor={bd.factors[k]}
                onClick={() => setOpenFactor(k)}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* INSIGHTS */}
      {data.insights.length > 0 && (
        <div>
          <div className="mb-2.5 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-foreground">
              Personalized Insights
            </h3>
          </div>
          <Card className="border-border/60 bg-card p-3 shadow-sm">
            <ul className="divide-y divide-border/50">
              {data.insights.map((line, i) => (
                <li key={i} className="py-2 text-sm leading-snug text-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* DETAIL SHEET */}
      <Sheet open={!!openFactor} onOpenChange={(v) => !v && setOpenFactor(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl border-border/60 p-0">
          {activeFactor && <FactorSheet factor={activeFactor} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

// ---------- pieces ---------- //

function ReadinessRing({
  score, label, labelClass, ringClass, ringSoftClass,
}: {
  score: number; label: string; labelClass: string; ringClass: string; ringSoftClass: string;
}) {
  const size = 156;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * c;
  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Training readiness ${pct}% — ${label}`}
    >
      <svg width={size} height={size} className="-rotate-90 drop-shadow-sm">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          strokeWidth={stroke}
          className={cn("stroke-current", ringSoftClass)}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className={cn("stroke-current transition-[stroke-dasharray] duration-700 ease-out", ringClass)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black leading-none tabular-nums text-foreground">
          {pct}%
        </span>
        <span className={cn("mt-1.5 text-[11px] font-black uppercase tracking-[0.2em] leading-none", labelClass)}>
          {label}
        </span>
      </div>
    </div>
  );
}

function FactorPill({
  tone, heading, emoji, label, hint, onClick,
}: {
  tone: "positive" | "limiter";
  heading: string;
  emoji: string;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  const tint =
    tone === "positive"
      ? "border-emerald-500/30 bg-emerald-500/8"
      : "border-amber-500/30 bg-amber-500/8";
  const iconTint =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition active:scale-[0.99]",
        tint,
      )}
    >
      <span className="text-2xl leading-none" aria-hidden>{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[10px] font-bold uppercase tracking-widest", iconTint)}>
          {heading}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="truncate text-sm font-bold text-foreground">{label}</span>
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        </div>
      </div>
    </button>
  );
}

function FactorRing({ factor, onClick }: { factor: FactorDetail; onClick: () => void }) {
  const size = 64;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, factor.score));
  const dash = (pct / 100) * c;
  const colors = statusColor[factor.status];
  const dim = factor.isMissing;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-lg p-2 transition active:scale-95 hover:bg-muted/40"
      aria-label={`${factor.label}: ${factor.currentValue}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
            className={cn("stroke-current", dim ? "text-muted-foreground/15" : colors.soft)} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            className={cn("stroke-current transition-[stroke-dasharray] duration-700", dim ? "text-muted-foreground/40" : colors.ring)} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-black tabular-nums text-foreground">
            {dim ? "—" : `${pct}`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[13px] leading-none" aria-hidden>{factor.emoji}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">
          {factor.label}
        </span>
      </div>
    </button>
  );
}

function FactorSheet({ factor }: { factor: FactorDetail }) {
  const colors = statusColor[factor.status];
  const trendClass =
    factor.trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
      : factor.trend === "Dropping" ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
  const impactClass =
    factor.impact === "Positive" ? "text-emerald-600 dark:text-emerald-400"
      : factor.impact === "Limiting" ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
  return (
    <div className="mx-auto max-w-lg px-5 pb-8 pt-5">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" />
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2 text-lg">
          <span className="text-2xl leading-none" aria-hidden>{factor.emoji}</span>
          {factor.label}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Detail view for {factor.label}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-4 flex items-center gap-4 rounded-2xl border border-border/50 bg-muted/30 p-4">
        <div className="relative shrink-0" style={{ width: 72, height: 72 }}>
          {(() => {
            const size = 72; const stroke = 7;
            const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
            const pct = Math.max(0, Math.min(100, factor.score));
            const dash = (pct / 100) * c;
            return (
              <>
                <svg width={size} height={size} className="-rotate-90">
                  <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
                    className={cn("stroke-current", colors.soft)} />
                  <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${c - dash}`}
                    className={cn("stroke-current", colors.ring)} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-base font-black tabular-nums text-foreground">
                    {factor.isMissing ? "—" : `${pct}`}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Current
          </div>
          <div className="mt-0.5 truncate text-base font-black text-foreground">
            {factor.currentValue}
          </div>
          <div className={cn("mt-1 flex items-center gap-2 text-xs font-semibold", colors.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
            {factor.status === "good" ? "In a great range" : factor.status === "watch" ? "Watch this" : "Needs attention"}
          </div>
        </div>
      </div>

      {factor.metrics.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {factor.metrics.map((m, i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {m.label}
              </div>
              <div className="mt-0.5 text-sm font-bold text-foreground tabular-nums">
                {m.value}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-border/50 bg-card px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Trend
            </div>
            <div className={cn("mt-0.5 text-sm font-bold", trendClass)}>{factor.trend}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Impact
            </div>
            <div className={cn("mt-0.5 text-sm font-bold", impactClass)}>{factor.impact}</div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-primary">
          Recommendation
        </div>
        <p className="mt-1 text-sm leading-snug text-foreground">
          {factor.recommendation}
        </p>
      </div>
    </div>
  );
}
