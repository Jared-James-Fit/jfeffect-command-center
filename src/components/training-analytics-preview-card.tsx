import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Activity,
  ArrowRight,
  Dumbbell,
  Flame,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildExerciseHistory,
  getClientResults,
  recentPRs,
  weeklyMuscleVolume,
} from "@/lib/pl-programs";

/**
 * Compact, eye-catching preview of a client's training analytics. Sits in
 * place of the old "Training Analytics" button — surfaces enough data that
 * the client *wants* to dig in, with a single CTA to the full dashboard.
 */
export function TrainingAnalyticsPreviewCard({
  clientId,
  unit = "lb",
}: {
  clientId: string;
  unit?: "lb" | "kg";
}) {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results-preview", clientId],
    enabled: !!clientId,
    queryFn: () => getClientResults(clientId),
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const history = buildExerciseHistory(results as any[]);
    const prs30 = recentPRs(results as any[], 30);
    const volume7 = weeklyMuscleVolume(results as any[], 7);
    const volume14 = weeklyMuscleVolume(results as any[], 14);
    const sets7 = volume7.reduce((n, v) => n + v.sets, 0);
    const sets14 = volume14.reduce((n, v) => n + v.sets, 0);
    const prevWeekSets = Math.max(0, sets14 - sets7);
    const volumeDelta = sets7 - prevWeekSets;
    const topMuscle = volume7[0]?.muscle ?? null;
    const topLift = history[0] ?? null;
    const spark = (topLift?.points ?? [])
      .slice(-12)
      .map((p: any, i: number) => ({ i, v: Number(p.est_1rm) || 0 }));
    return {
      history,
      prs30,
      sets7,
      volumeDelta,
      topMuscle,
      topLift,
      spark,
      totalSessions: new Set(
        (results as any[]).map((r) => r.date?.slice(0, 10)).filter(Boolean),
      ).size,
    };
  }, [results]);

  const empty = !isLoading && (results as any[]).length === 0;

  return (
    <Card className="relative overflow-hidden border-analytics-blue/30 bg-gradient-to-br from-background via-background to-analytics-blue/5 p-0 shadow-analytics-blue">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-analytics-blue/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-analytics-blue/10 blur-3xl" />

      <div className="relative p-5 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-analytics-blue shadow-analytics-blue ring-1 ring-analytics-blue/40">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-analytics-blue">
                Training Analytics
              </div>
              <h3 className="text-base font-black leading-tight md:text-lg">
                Your progress at a glance
              </h3>
            </div>
          </div>
          <Link
            to="/portal/workouts/analytics"
            className="hidden sm:block"
          >
            <Button
              size="sm"
              className="bg-gradient-analytics-blue font-bold uppercase tracking-wider shadow-analytics-blue btn-glow-blue"
            >
              Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        {empty ? (
          <EmptyPreview />
        ) : (
          <>
            {/* Stat grid */}
            <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Stat
                icon={<Trophy className="h-3.5 w-3.5" />}
                label="PRs · 30d"
                value={isLoading ? "…" : stats.prs30.length.toString()}
                accent
              />
              <Stat
                icon={<Dumbbell className="h-3.5 w-3.5" />}
                label="Sets · 7d"
                value={isLoading ? "…" : stats.sets7.toString()}
                delta={
                  !isLoading && stats.sets7 > 0
                    ? stats.volumeDelta >= 0
                      ? `+${stats.volumeDelta}`
                      : `${stats.volumeDelta}`
                    : undefined
                }
              />
              <Stat
                icon={<Flame className="h-3.5 w-3.5" />}
                label="Top focus"
                value={isLoading ? "…" : stats.topMuscle ?? "—"}
              />
              <Stat
                icon={<Activity className="h-3.5 w-3.5" />}
                label="Sessions"
                value={isLoading ? "…" : stats.totalSessions.toString()}
              />
            </div>

            {/* Featured lift */}
            {stats.topLift && (
              <div className="mt-4 rounded-xl border border-analytics-blue/20 bg-background/40 p-3 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Top lift trend
                    </div>
                    <div className="truncate text-sm font-bold">
                      {stats.topLift.name}
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1.5 text-xs">
                      <TrendingUp className="h-3 w-3 text-analytics-blue" />
                      <span className="font-black text-foreground">
                        {Math.round(stats.topLift.pr?.est_1rm ?? 0)} {unit}
                      </span>
                      <span className="text-muted-foreground">est. 1RM</span>
                    </div>
                  </div>
                  {stats.spark.length > 1 && (
                    <div className="h-12 w-28 shrink-0 md:w-36">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats.spark}>
                          <defs>
                            <linearGradient id="taSpark" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--analytics-blue)" stopOpacity={0.6} />
                              <stop offset="100%" stopColor="var(--analytics-blue)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Tooltip
                            cursor={false}
                            contentStyle={{ display: "none" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="v"
                            stroke="var(--analytics-blue)"
                            strokeWidth={2}
                            fill="url(#taSpark)"
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Mobile CTA */}
        <Link to="/portal/workouts/analytics" className="mt-4 block sm:hidden">
          <Button
            className="w-full bg-gradient-analytics-blue font-bold uppercase tracking-wider shadow-analytics-blue btn-glow-blue"
            size="lg"
          >
            Open Full Analytics <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  delta,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-background/50 p-2.5 backdrop-blur " +
        (accent
          ? "border-analytics-blue/40 shadow-[0_0_18px_-8px_var(--analytics-blue)]"
          : "border-border/60")
      }
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className={accent ? "text-analytics-blue" : ""}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-lg font-black leading-none">{value}</span>
        {delta && (
          <span
            className={
              "text-[10px] font-bold " +
              (delta.startsWith("-")
                ? "text-muted-foreground"
                : "text-emerald-500")
            }
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}