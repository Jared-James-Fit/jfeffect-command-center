import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowRight, CalendarDays, Dumbbell, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getClientResults } from "@/lib/pl-programs";
import { InfoTip } from "@/components/analytics/info-tip";
import { SectionLabel } from "@/components/ui/section-label";
import {
  compactWeight,
  computeMonthHighlights,
  percentChange,
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
  // Progress toward matching last month's *full* total — a goal that makes sense mid-month.
  const goalPct = h.prevMonthTotalLb > 0 ? Math.min(100, Math.round((h.weightLb / h.prevMonthTotalLb) * 100)) : null;
  const beatLastMonth = h.prevMonthTotalLb > 0 && h.weightLb >= h.prevMonthTotalLb;
  const workoutDelta = h.workouts - h.prevWorkouts;
  const empty = !isLoading && !h.hasData;
  // One line under the number: beaten → say so; otherwise how far along, plus pace.
  const pace = compare
    ? `${compare.pct >= 0 ? "▲" : "▼"} ${Math.abs(compare.pct)}% vs ${h.prevMonthLabel}'s pace`
    : null;
  const weightLine = beatLastMonth
    ? `Beat all of ${h.prevMonthLabel} (${wholeWeight(h.prevMonthTotalLb, unit)} ${unit}) 🔥`
    : goalPct != null
      ? [`${goalPct}% of ${h.prevMonthLabel}'s total`, pace].filter(Boolean).join(" · ")
      : pace;

  return (
    <section aria-label={`Your ${h.monthLabel}`}>
      <SectionLabel icon={<CalendarDays className="h-4 w-4 shrink-0" />}>Your {h.monthLabel}</SectionLabel>
      <Card className="overflow-hidden border-border/60 bg-card p-0 shadow-sm">
        {empty ? (
          <div className="p-4 text-center">
            <Dumbbell className="mx-auto h-6 w-6 text-primary" />
            <div className="mt-2 text-sm font-bold">Your numbers start with your first workout</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Log your sets and this fills in automatically: total weight lifted, workouts, PRs and your streak.
            </p>
          </div>
        ) : (
          <div className="p-4">
            {/* The headline number */}
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total weight lifted
              <InfoTip label="About total weight lifted" title="Total weight lifted" align="start">
                Every set's weight × reps, added up for the month. Bodyweight-only sets aren't included.
              </InfoTip>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-4xl font-black leading-none tabular-nums">
                {isLoading ? "…" : compactWeight(h.weightLb, unit)}
              </span>
              <span className="text-base font-bold text-muted-foreground">{unit}</span>
            </div>
            {goalPct != null && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={beatLastMonth ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-primary"}
                  style={{ width: `${Math.max(goalPct, 3)}%` }}
                />
              </div>
            )}
            {weightLine && (
              <div
                className={
                  "mt-1.5 text-xs " +
                  (beatLastMonth || (compare && compare.pct >= 0) ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")
                }
                data-testid="month-weight-line"
              >
                {weightLine}
              </div>
            )}

            {/* Three simple wins */}
            <div className="mt-4 grid grid-cols-3 divide-x divide-border/60 border-y border-border/60 py-3">
              <Tile
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
                label="PRs"
                value={isLoading ? "…" : String(h.prLifts)}
                caption="this month"
                good={h.prLifts > 0}
              />
              <Tile
                label="Streak"
                value={isLoading ? "…" : String(h.streakWeeks)}
                caption={h.streakWeeks === 1 ? "week in a row" : "weeks in a row"}
              />
            </div>

            {/* Athlete rows */}
            {(h.topLift || h.topMuscle) && (
              <div className="mt-3 space-y-2.5">
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
            )}
          </div>
        )}

        <Link
          to="/portal/workouts/analytics"
          className="flex items-center justify-center gap-1.5 border-t border-border/60 py-3 text-sm font-bold text-primary transition active:bg-muted/40"
        >
          See all analytics <ArrowRight className="h-4 w-4" />
        </Link>
      </Card>
    </section>
  );
}

function Tile({
  label,
  value,
  caption,
  good = false,
}: {
  label: string;
  value: string;
  caption: string;
  good?: boolean;
}) {
  return (
    <div className="px-2 text-center first:pl-0 last:pr-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black leading-none tabular-nums">{value}</div>
      <div className={"mt-1 text-[11px] leading-tight " + (good ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
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
          <div className="flex items-center justify-end gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-3 w-3" /> {badge}
          </div>
        )}
      </div>
    </div>
  );
}
