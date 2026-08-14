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
import { InfoTip } from "@/components/analytics/info-tip";
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
      const since35 = new Date(now); since35.setDate(now.getDate() - 35);
      const since7 = new Date(now); since7.setDate(now.getDate() - 7);
      const since14 = new Date(now); since14.setDate(now.getDate() - 14);

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
        .select("created_at, sleep_bucket, recovery_today, client_id")
        .eq("client_id", clientId)
        .gte("created_at", since180.toISOString());

      // Completions
      const { data: comps } = await (supabase as any)
        .from("pl_day_completions")
        .select("completed_at")
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .gte("completed_at", since180.toISOString());
      const completedTs: number[] = (comps ?? []).map((c: any) => new Date(c.completed_at).getTime());
      const workouts7d = completedTs.filter((t: number) => t >= since7.getTime()).length;
      const completed30d = completedTs.filter((t: number) => t >= since30.getTime()).length;
      const completedPrev30d = completedTs.filter(
        (t: number) => t < since30.getTime() && t >= since30.getTime() - 30 * 86_400_000,
      ).length;

      // Consecutive-workout streak from the most recent completed session
      // walking backwards: any completed session within 7 days of the previous
      // counts as continuing the streak.
      const sortedDesc = [...completedTs].sort((a, b) => b - a);
      let streak = 0;
      for (let i = 0; i < sortedDesc.length; i++) {
        if (i === 0) { streak = 1; continue; }
        if (sortedDesc[i - 1] - sortedDesc[i] <= 7 * 86_400_000) streak += 1;
        else break;
      }

      // ── Consistency (This Week first) ──────────────────────────────
      // Timeframes:
      //   • This Week (Mon–Sun local): main ring; due-so-far denominator.
      //   • Last 4 completed weeks: supporting context, drives trend.
      //   • Current Block: supporting context.
      // We fetch a wide scheduled window (block start OR last 8 weeks —
      // whichever is earlier) so all three timeframes come from one query.
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const startOfWeek = (d: Date) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        const dow = x.getDay(); // 0 = Sun, 1 = Mon…
        const diffToMon = (dow + 6) % 7;
        x.setDate(x.getDate() - diffToMon);
        return x;
      };
      const weekStart = startOfWeek(now);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
      const todayISO = ymd(now);
      const weekStartISO = ymd(weekStart);
      const weekEndISO = ymd(weekEnd);

      // Fetch scheduled workouts back to the earlier of (block start, 8 weeks ago).
      const eightWeeksAgo = new Date(weekStart); eightWeeksAgo.setDate(weekStart.getDate() - 8 * 7);
      const blockStartDate = curBlock?.start_date ? new Date(curBlock.start_date) : null;
      const schedLowerBound = blockStartDate && blockStartDate < eightWeeksAgo
        ? blockStartDate
        : eightWeeksAgo;

      let scheduledRows: Array<{ scheduled_date: string; original_date: string | null }> = [];
      try {
        const { data: sched } = await (supabase as any)
          .from("pl_scheduled_workouts")
          .select("scheduled_date, original_date")
          .eq("client_id", clientId)
          .gte("scheduled_date", ymd(schedLowerBound));
        scheduledRows = (sched ?? []) as typeof scheduledRows;
      } catch { scheduledRows = []; }

      // Completed-date set — a scheduled workout is "completed" if a
      // pl_day_completions row exists on that date (best-effort match).
      const completedDates = new Set(
        completedTs.map((t) => ymd(new Date(t))),
      );

      // This Week counts
      const weekSched = scheduledRows.filter(
        (r) => r.scheduled_date >= weekStartISO && r.scheduled_date < weekEndISO,
      );
      const weekTotalScheduled = weekSched.length;
      const weekDueSoFar = weekSched.filter((r) => r.scheduled_date <= todayISO).length;
      // Completions logged during this week (early completions of future
      // scheduled workouts count in the numerator per spec).
      const weekCompleted = completedTs.filter(
        (t) => t >= weekStart.getTime() && t < weekEnd.getTime(),
      ).length;
      const weekMissed = Math.max(0, weekDueSoFar - Math.min(weekCompleted, weekDueSoFar));
      const weekRemaining = Math.max(0, weekTotalScheduled - weekDueSoFar);

      // ── Cardio adherence for the current week (supporting signal) ──────
      let cardioWeek: { weekPrescribed: number; weekCompleted: number; weekSkipped: number } | null = null;
      try {
        const [cardioCompRes, cardioTargetRes] = await Promise.all([
          (supabase as any)
            .from("cardio_completions")
            .select("completed, skipped, completed_date")
            .eq("client_id", clientId)
            .gte("completed_date", weekStartISO)
            .lt("completed_date", weekEndISO),
          (supabase as any)
            .from("cardio_targets")
            .select("frequency_per_week, status, enabled, start_date, end_date")
            .eq("client_id", clientId)
            .neq("status", "Archived"),
        ]);
        const cRows = (cardioCompRes?.data ?? []) as any[];
        const activeTargets = ((cardioTargetRes?.data ?? []) as any[])
          .filter((t) => (t.enabled ?? true) && t.status !== "Archived")
          .filter(
            (t) =>
              (!t.start_date || t.start_date < weekEndISO) &&
              (!t.end_date || t.end_date >= weekStartISO),
          );
        const prescribed = activeTargets.reduce(
          (s, t) => s + (Number(t.frequency_per_week) || 0),
          0,
        );
        const doneCount = cRows.filter((c) => c.completed !== false && !c.skipped).length;
        const skippedCount = cRows.filter((c) => !!c.skipped).length;
        if (prescribed > 0 || doneCount > 0 || skippedCount > 0) {
          cardioWeek = {
            weekPrescribed: prescribed,
            weekCompleted: doneCount,
            weekSkipped: skippedCount,
          };
        }
      } catch { cardioWeek = null; }

      // Last 4 completed weeks (weeks strictly before the current week).
      const priorWeekStart = new Date(weekStart); priorWeekStart.setDate(weekStart.getDate() - 4 * 7);
      const priorWeekEnd = new Date(weekStart);
      const last4Scheduled = scheduledRows.filter(
        (r) => r.scheduled_date >= ymd(priorWeekStart) && r.scheduled_date < ymd(priorWeekEnd),
      ).length;
      const last4Completed = completedTs.filter(
        (t) => t >= priorWeekStart.getTime() && t < priorWeekEnd.getTime(),
      ).length;
      const last4 = last4Scheduled > 0
        ? { scheduled: last4Scheduled, completed: Math.min(last4Completed, last4Scheduled) }
        : null;

      // Current Block (start → min(today+1, blockEnd)).
      let block: { scheduled: number; completed: number } | null = null;
      if (curBlock?.start_date) {
        const bStart = new Date(curBlock.start_date);
        const bEnd = curBlock.end_date
          ? new Date(curBlock.end_date + "T23:59:59Z")
          : new Date(now.getTime() + 86_400_000);
        const cap = bEnd < now ? bEnd : now;
        const bStartISO = ymd(bStart);
        const capISO = ymd(cap);
        const bSched = scheduledRows.filter(
          (r) => r.scheduled_date >= bStartISO && r.scheduled_date <= capISO,
        ).length;
        const bComp = completedTs.filter(
          (t) => t >= bStart.getTime() && t <= cap.getTime(),
        ).length;
        if (bSched > 0) block = { scheduled: bSched, completed: Math.min(bComp, bSched) };
      }

      // Streak: consecutive scheduled workouts (date ≤ today) completed
      // walking backwards. A missed scheduled workout breaks the streak.
      const streakSched = scheduledRows
        .filter((r) => r.scheduled_date <= todayISO)
        .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
      let scheduledStreak = 0;
      for (const r of streakSched) {
        if (completedDates.has(r.scheduled_date)) scheduledStreak += 1;
        else break;
      }

      // Trend: previous 4 completed weeks vs the 4 weeks before that.
      // Only compare when we have adherence data for both windows.
      const weekAdherence = (offsetWeeks: number): number | null => {
        const wStart = new Date(weekStart);
        wStart.setDate(weekStart.getDate() - offsetWeeks * 7);
        const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
        const s = scheduledRows.filter(
          (r) => r.scheduled_date >= ymd(wStart) && r.scheduled_date < ymd(wEnd),
        ).length;
        if (s === 0) return null;
        const c = completedTs.filter(
          (t) => t >= wStart.getTime() && t < wEnd.getTime(),
        ).length;
        return Math.min(100, Math.round((c / s) * 100));
      };
      const recent4 = [1, 2, 3, 4].map(weekAdherence).filter((v): v is number => v != null);
      const prior4 = [5, 6, 7, 8].map(weekAdherence).filter((v): v is number => v != null);
      let consistencyTrend: "Improving" | "Stable" | "Dropping" | "Building" = "Building";
      if (recent4.length >= 3 && prior4.length >= 3) {
        const rAvg = recent4.reduce((a, b) => a + b, 0) / recent4.length;
        const pAvg = prior4.reduce((a, b) => a + b, 0) / prior4.length;
        const diff = rAvg - pAvg;
        consistencyTrend = Math.abs(diff) < 5 ? "Stable" : diff > 0 ? "Improving" : "Dropping";
      }

      // Training load: sets, tonnage, avg RPE for last 7 vs last 28 days.
      const LB_PER_KG = 2.2046226;
      const { data: setRows } = await (supabase as any)
        .from("pl_row_results")
        .select(
          "completed_at, actual_reps, actual_rpe, actual_load, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, is_bodyweight, load_type",
        )
        .eq("client_id", clientId)
        .not("actual_reps", "is", null)
        .gte("completed_at", since35.toISOString());
      const setsAll = ((setRows ?? []) as any[]).map((r) => {
        let load_lb = 0;
        if (r.normalized_lb != null) load_lb = Number(r.normalized_lb) || 0;
        else if (r.normalized_kg != null) load_lb = (Number(r.normalized_kg) || 0) * LB_PER_KG;
        else {
          const raw = Number(r.entered_value ?? r.actual_load) || 0;
          const unit = (r.entered_unit ?? r.actual_load_unit ?? "lb") as string;
          load_lb = unit === "kg" ? raw * LB_PER_KG : raw;
        }
        // Bodyweight and assisted sets carry no external tonnage: assistance
        // is a *reduction* in load, and bodyweight load isn't measured here.
        // They still count as working sets and still feed average RPE.
        const loadType = (r.load_type ?? (r.is_bodyweight ? "bodyweight" : "external")) as string;
        if (loadType === "bodyweight" || loadType === "assisted") load_lb = 0;
        return {
          t: new Date(r.completed_at).getTime(),
          reps: Number(r.actual_reps) || 0,
          load_lb,
          rpe: r.actual_rpe != null ? Number(r.actual_rpe) : null,
        };
      });
      const buildWindow = (fromMs: number, toMs: number) => {
        const rows = setsAll.filter((s) => s.t >= fromMs && s.t < toMs);
        const sets = rows.length;
        const tonnage = rows.reduce((s, r) => s + r.load_lb * r.reps, 0);
        const rpeVals = rows.map((r) => r.rpe).filter((n): n is number => n != null);
        const avgRpe = rpeVals.length
          ? Number((rpeVals.reduce((s, n) => s + n, 0) / rpeVals.length).toFixed(2))
          : null;
        const days = new Set(rows.map((r) => new Date(r.t).toISOString().slice(0, 10))).size;
        return { sets, tonnage, avgRpe, days };
      };
      const current7 = buildWindow(since7.getTime(), now.getTime() + 1);
      // Baseline = the 4 COMPLETE weeks that end before the current window
      // starts (days -35 → -8). It never overlaps the period being judged.
      const priorWeeks = [1, 2, 3, 4].map((i) => {
        const to = since7.getTime() - (i - 1) * 7 * 86_400_000;
        const from = since7.getTime() - i * 7 * 86_400_000;
        return {
          ...buildWindow(from, to),
          from: new Date(from).toISOString().slice(0, 10),
          to: new Date(to).toISOString().slice(0, 10),
        };
      });

      // Kept for legacy insight builder (30-day adherence sentence).
      const scheduled30dInsight = scheduledRows.filter(
        (r) => r.scheduled_date >= since30.toISOString().slice(0, 10)
          && r.scheduled_date <= todayISO,
      ).length || null;
      void completedPrev30d;

      // Sleep samples merged (reviews + feedback)
      const sleepSamples: SleepSample[] = [];
      for (const r of (reviews ?? []) as any[]) {
        if (r.sleep_bucket) sleepSamples.push({ ts: r.review_submitted_at, bucket: r.sleep_bucket as SleepBucket });
      }
      for (const f of (feedback ?? []) as any[]) {
        if (f.sleep_bucket) sleepSamples.push({ ts: f.created_at, bucket: f.sleep_bucket as SleepBucket });
      }
      sleepSamples.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      // Recovery samples come from both member reviews and coaching-client
      // workout feedback so every completed review's Recovery answer feeds
      // the readiness ring — regardless of which surface the client used.
      const recoverySamples: Array<{ ts: string; rating: number }> = [];
      for (const r of (reviews ?? []) as any[]) {
        if (r.recovery_today != null) {
          recoverySamples.push({
            ts: r.review_submitted_at,
            rating: Number(r.recovery_today),
          });
        }
      }
      for (const f of (feedback ?? []) as any[]) {
        if (f.recovery_today != null) {
          recoverySamples.push({
            ts: f.created_at,
            rating: Number(f.recovery_today),
          });
        }
      }
      recoverySamples.sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      );

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
        load: { current7, priorWeeks },
        consistency: {
          weekDueSoFar,
          weekCompleted,
          weekTotalScheduled,
          weekRemaining,
          weekMissed,
          last4,
          block,
          streak: scheduledStreak,
          trend: consistencyTrend,
          cardio: cardioWeek,
        },
        scores: allScores,
        painDays7d,
      });
      // avoid unused var warning under strict TS
      void workouts7d; void since14; void streak;

      const insights = buildPersonalInsights(series, sleepSamples, completed30d, scheduled30dInsight);

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
  const colors = factor.isBuilding
    ? {
        ring: "text-muted-foreground/55",
        soft: "text-muted-foreground/15",
        text: "text-muted-foreground",
        dot: "bg-muted-foreground/40",
      }
    : statusColor[factor.status];
  const dim = factor.isMissing || factor.isBuilding;
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
  const colors = factor.isBuilding
    ? {
        ring: "text-muted-foreground/55",
        soft: "text-muted-foreground/15",
        text: "text-muted-foreground",
        dot: "bg-muted-foreground/40",
      }
    : statusColor[factor.status];
  const trendClass =
    factor.trend === "Improving" ? "text-emerald-600 dark:text-emerald-400"
      : factor.trend === "Dropping" ? "text-rose-600 dark:text-rose-400"
      : factor.trend === "Rising" ? "text-amber-600 dark:text-amber-400"
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

      {factor.tooltip && (
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          {factor.tooltip}
        </p>
      )}

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
                    {factor.isMissing || factor.isBuilding ? "—" : `${pct}`}
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
            {factor.isBuilding ? "Need more history" : factor.status === "good" ? "In a great range" : factor.status === "watch" ? "Watch this" : "Needs attention"}
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
              {factor.key === "load" ? "Load Trend" : "Trend"}
            </div>
            <div className={cn("mt-0.5 text-sm font-bold", trendClass)}>
              {factor.trendLabel ?? factor.trend}
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card px-3 py-2.5">
            <div className="flex items-center gap-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Impact
              </div>
              {factor.key === "load" && (
                <InfoTip label="What Impact means" side="top" align="start">
                  Impact shows whether your current training load is supporting,
                  neutral to, or limiting today's readiness.
                </InfoTip>
              )}
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
