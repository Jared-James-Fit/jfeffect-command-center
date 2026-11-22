import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getClientResults, recentPRs } from "@/lib/pl-programs";
import { buildTrainingLoad, weekOf } from "@/lib/analytics/training-load";
import { resultsToLoadSets } from "@/lib/analytics/training-load.queries";
import { strengthPoints, COMP_LIFT_LABEL } from "@/lib/analytics/competition-strength";
import { comparableE1rm } from "@/lib/analytics/strength-read";
import {
  liftSummary,
  liftsTrending,
  progressSnapshot,
  snapshotLift,
  type SnapshotMetric,
} from "@/lib/analytics/analytics-areas";
import { parseLocalDate } from "@/lib/today";

type Unit = "lb" | "kg";
const LB_PER_KG = 2.2046226;
const DAY = 86_400_000;

/**
 * "Am I making progress?" on the Workouts dashboard: one to three numbers
 * picked for the athlete (this month's planned workouts done, the main lift's
 * estimated max over 12 weeks or how many lifts are getting stronger, PRs
 * only when there are some), each saying what it's measured against. The
 * whole card is the one way into Training analytics, which reads the same
 * logged sets (one query, `["pl-results", clientId, null]`, shared with it).
 */
export function TrainingAnalyticsPreviewCard({
  clientId,
  unit = "lb",
  month,
  hideWhenEmpty = false,
}: {
  clientId: string;
  unit?: Unit;
  /** this calendar month's workouts on the program that are due, and how many are done */
  month?: { label: string; planned: number; done: number } | null;
  /** Nothing until there's a workout to count. */
  hideWhenEmpty?: boolean;
  /** kept for callers that still pass them */
  bare?: boolean;
  part?: string;
}) {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results", clientId, null],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => getClientResults(clientId),
  });

  const metrics = useMemo<SnapshotMetric[]>(() => {
    const rs = results as any[];
    if (!rs.length) return [];
    const today = format(new Date(), "yyyy-MM-dd");
    const since = format(new Date(Date.now() - 84 * DAY), "yyyy-MM-dd");
    const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
    const fmtDay = (d: string) => {
      const x = parseLocalDate(d);
      return x ? format(x, "MMM d") : d;
    };
    const points = strengthPoints(rs).points;
    const lift = snapshotLift(points, today);
    let strength: Parameters<typeof progressSnapshot>[0]["strength"] = null;
    if (lift) {
      const sm = liftSummary(points, lift, since, today);
      strength = { name: COMP_LIFT_LABEL[lift], trend: sm.trend, unit, conv, fmtDay };
    } else {
      const lt = liftsTrending(rs, since, today, (x) => comparableE1rm(x as any));
      strength = { up: lt.up, tracked: lt.tracked };
    }
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const prs = recentPRs(rs, 40).filter((p: any) => new Date(p.date) >= monthStart);
    const names = [...new Set(prs.map((p: any) => String(p.exercise_name)))];
    const load = buildTrainingLoad({
      sets: resultsToLoadSets(rs.filter((r) => r.date && r.date >= `${since}T00:00:00`)),
      today,
    });
    const lastWeekKey = weekOf(format(new Date(Date.now() - 7 * DAY), "yyyy-MM-dd"));
    const lastWeek = load.weeks.find((w) => w.key === lastWeekKey)?.sets ?? null;
    return progressSnapshot({
      month: month ?? { label: format(new Date(), "MMMM"), planned: 0, done: 0 },
      strength,
      prs: { count: names.length, names },
      setsLastWeek: lastWeek,
    });
  }, [results, unit, month]);

  if (isLoading)
    return hideWhenEmpty ? null : (
      <Card className="h-[104px] animate-pulse bg-muted/30" aria-hidden />
    );
  if (!metrics.length) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="p-4 text-sm text-muted-foreground" data-progress-snapshot-empty>
        Your progress fills in after your first logged workout.
      </Card>
    );
  }

  return (
    <Card className="p-0" data-progress-snapshot>
      <Link
        to="/portal/workouts/analytics"
        className="block rounded-2xl px-4 pb-4 pt-3.5 transition active:bg-muted/40"
        aria-label="Progress. Open training analytics"
        data-analytics-entry
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Progress</h2>
          <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-muted-foreground">
            Analytics <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <div
          className={cn(
            "mt-3 grid gap-3",
            metrics.length === 1
              ? "grid-cols-1"
              : metrics.length === 2
                ? "grid-cols-2"
                : "grid-cols-3",
          )}
        >
          {metrics.map((m) => (
            <div key={m.key} className="min-w-0" data-snapshot-metric={m.key}>
              <div className="truncate text-[12px] text-muted-foreground">{m.label}</div>
              <div
                className={cn(
                  "mt-0.5 text-xl font-semibold tabular-nums tracking-tight",
                  m.tone === "up"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : m.tone === "record"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground",
                )}
              >
                {m.value}
              </div>
              <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {m.sub}
              </div>
            </div>
          ))}
        </div>
      </Link>
    </Card>
  );
}
