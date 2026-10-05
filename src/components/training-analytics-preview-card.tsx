import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowRight, CalendarCheck, Dumbbell, Flame, Trophy, TrendingUp, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getClientResults } from "@/lib/pl-programs";
import { InfoTip } from "@/components/analytics/info-tip";
import {
  compactWeight,
  computeMonthHighlights,
  percentChange,
  weightComparison,
  wholeWeight,
  type Unit,
} from "@/lib/month-highlights";

/**
 * "Your Month" — the Workouts-tab analytics card. Four plain-English numbers
 * anyone new to the gym gets at a glance (weight lifted, workouts, PRs, streak)
 * plus a small athlete corner. The deep-dive dashboard stays one tap away.
 */
export function TrainingAnalyticsPreviewCard({
  clientId,
  unit: unitProp,
}: {
  clientId: string;
  unit?: Unit;
}) {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results-preview", clientId],
    enabled: !!clientId,
    queryFn: () => getClientResults(clientId),
    staleTime: 60_000,
  });
  const { data: prefUnit } = useQuery({
    queryKey: ["client-weight-unit", clientId],
    enabled: !!clientId && !unitProp,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("preferred_weight_unit").eq("id", clientId).maybeSingle();
      return ((data as any)?.preferred_weight_unit === "kg" ? "kg" : "lb") as Unit;
    },
  });
  const unit: Unit = unitProp ?? prefUnit ?? "lb";

  const h = useMemo(() => computeMonthHighlights(results as any[]), [results]);
  const compare = percentChange(h.weightLb, h.prevSamePointLb);
  const fun = weightComparison(h.weightLb);
  // Progress toward matching last month's *full* total — a goal that makes sense mid-month.
  const goalPct = h.prevMonthTotalLb > 0 ? Math.min(100, Math.round((h.weightLb / h.prevMonthTotalLb) * 100)) : null;
  const beatLastMonth = h.prevMonthTotalLb > 0 && h.weightLb >= h.prevMonthTotalLb;
  const workoutDelta = h.workouts - h.prevWorkouts;
  const empty = !isLoading && !h.hasData;

  return (
    <Card className="relative overflow-hidden border-analytics-blue/30 bg-gradient-to-br from-background via-background to-analytics-blue/5 p-0 shadow-analytics-blue">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-analytics-blue/20 blur-3xl" />

      <div className="relative p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-analytics-blue">
              Your {h.monthLabel}
            </div>
            <h3 className="text-base font-black leading-tight md:text-lg">How your training is stacking up</h3>
          </div>
          <Link to="/portal/workouts/analytics" className="hidden shrink-0 sm:block">
            <Button size="sm" variant="outline" className="font-bold">
              All analytics <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        {empty ? (
          <div className="mt-5 rounded-xl border border-dashed border-analytics-blue/30 bg-background/40 p-4 text-center">
            <Dumbbell className="mx-auto h-6 w-6 text-analytics-blue" />
            <div className="mt-2 text-sm font-bold">Your numbers start with your first workout</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Log your sets and this fills in automatically: total weight lifted, workouts, PRs and your streak.
            </p>
          </div>
        ) : (
          <>
            {/* The headline number */}
            <div className="mt-5 rounded-2xl border border-analytics-blue/25 bg-background/50 p-4 backdrop-blur">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Dumbbell className="h-3.5 w-3.5 text-analytics-blue" />
                Total weight lifted
                <InfoTip label="About total weight lifted" title="Total weight lifted" align="start">
                  Every set's weight × reps, added up for the month. Bodyweight-only sets aren't included.
                </InfoTip>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-4xl font-black tabular-nums leading-none">
                  {isLoading ? "…" : compactWeight(h.weightLb, unit)}
                </span>
                <span className="text-lg font-bold text-muted-foreground">{unit}</span>
                {compare && (
                  <span
                    className={
                      "ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold " +
                      (compare.pct >= 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")
                    }
                  >
                    {compare.pct >= 0
                      ? `▲ ${compare.pct}% ahead of ${h.prevMonthLabel}'s pace`
                      : `▼ ${Math.abs(compare.pct)}% behind ${h.prevMonthLabel}'s pace`}
                  </span>
                )}
              </div>
              {fun && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {fun.emoji} That's {fun.text}.
                </div>
              )}
              {goalPct != null && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-analytics-blue transition-all"
                      style={{ width: `${Math.max(goalPct, 3)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {beatLastMonth
                      ? `You've already beaten all of ${h.prevMonthLabel} (${wholeWeight(h.prevMonthTotalLb, unit)} ${unit}) 🔥`
                      : `${goalPct}% of the way to matching ${h.prevMonthLabel} (${wholeWeight(h.prevMonthTotalLb, unit)} ${unit})`}
                  </div>
                </div>
              )}
            </div>

            {/* Three simple wins */}
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <Tile
                icon={<CalendarCheck className="h-3.5 w-3.5" />}
                label="Workouts"
                value={isLoading ? "…" : String(h.workouts)}
                caption={
                  h.prevWorkouts > 0 && !isLoading
                    ? workoutDelta === 0
                      ? `same as ${h.prevMonthLabel}`
                      : `${workoutDelta > 0 ? "+" : ""}${workoutDelta} vs ${h.prevMonthLabel}`
                    : "this month"
                }
                good={workoutDelta > 0}
              />
              <Tile
                icon={<Trophy className="h-3.5 w-3.5" />}
                label="PRs"
                value={isLoading ? "…" : String(h.prLifts)}
                caption={h.prLifts === 1 ? "new record this month" : "new records this month"}
                accent={h.prLifts > 0}
              />
              <Tile
                icon={<Flame className="h-3.5 w-3.5" />}
                label="Streak"
                value={isLoading ? "…" : String(h.streakWeeks)}
                caption={h.streakWeeks === 1 ? "week in a row" : "weeks in a row"}
                accent={h.streakWeeks >= 3}
              />
            </div>

            {/* Athlete corner: just two rows */}
            {(h.topLift || h.topMuscle) && (
              <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <Zap className="h-3.5 w-3.5 text-analytics-blue" /> Athlete corner
                </div>
                <div className="space-y-2">
                  {h.topLift && (
                    <Row
                      label="Strongest lift"
                      tip={
                        <InfoTip label="About estimated 1-rep max" title="Estimated 1-rep max" align="start">
                          The heaviest weight you could likely lift for a single rep, calculated from your best sets.
                          It lets you track strength even when you don't test a true max.
                        </InfoTip>
                      }
                      main={h.topLift.name}
                      sub={`est. max ${wholeWeight(h.topLift.est1rmLb, unit)} ${unit}`}
                      badge={
                        h.topLift.gainLb != null && h.topLift.gainLb >= 1
                          ? `+${wholeWeight(h.topLift.gainLb, unit)} ${unit} in 30 days`
                          : null
                      }
                    />
                  )}
                  {h.topMuscle && (
                    <Row
                      label="Most trained this week"
                      main={h.topMuscle.muscle}
                      sub={`${h.topMuscle.sets} set${h.topMuscle.sets === 1 ? "" : "s"}`}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <Link to="/portal/workouts/analytics" className="mt-4 block sm:hidden">
          <Button variant="outline" className="w-full font-bold" size="lg">
            See all analytics <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function Tile({
  icon,
  label,
  value,
  caption,
  accent = false,
  good = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
  accent?: boolean;
  good?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-background/50 p-3 backdrop-blur " +
        (accent ? "border-analytics-blue/40 shadow-[0_0_18px_-8px_var(--analytics-blue)]" : "border-border/60")
      }
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className={accent ? "text-analytics-blue" : ""}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-2xl font-black leading-none tabular-nums">{value}</div>
      <div className={"mt-1 text-[11px] leading-tight " + (good ? "font-semibold text-emerald-500" : "text-muted-foreground")}>
        {caption}
      </div>
    </div>
  );
}

function Row({
  label,
  main,
  sub,
  badge,
  tip,
}: {
  label: string;
  main: string;
  sub: string;
  badge?: string | null;
  tip?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
          {tip}
        </div>
        <div className="truncate text-sm font-bold">{main}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs font-semibold tabular-nums">{sub}</div>
        {badge && (
          <div className="flex items-center justify-end gap-1 text-[11px] font-bold text-emerald-500">
            <TrendingUp className="h-3 w-3" /> {badge}
          </div>
        )}
      </div>
    </div>
  );
}
