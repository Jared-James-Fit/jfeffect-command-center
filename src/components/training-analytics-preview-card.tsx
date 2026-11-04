import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Dumbbell, TrendingUp, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { getClientResults } from "@/lib/pl-programs";
import { InfoTip } from "@/components/analytics/info-tip";
import {
  compactWeight,
  computeMonthHighlights,
  percentChange,
  wholeWeight,
  type Unit,
} from "@/lib/month-highlights";

/**
 * "Your Month" — the Workouts-tab analytics card: one row of the three numbers
 * that matter (workouts, PRs, week streak). Weight lifted, the strongest lift
 * and the most trained muscle fold under "More" (the analytics page reads
 * them by block, not by month), and the deep-dive dashboard is one tap away.
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
  // Workouts against last month to the same day (the tile is only the number).
  const workoutLine = h.prevWorkouts > 0 && !isLoading
    ? workoutDelta === 0
      ? `Workouts: same as ${h.prevMonthLabel}`
      : `Workouts: ${workoutDelta > 0 ? "+" : ""}${workoutDelta} vs ${h.prevMonthLabel}`
    : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const empty = !isLoading && !h.hasData;
  // One line under the number: beaten → say so; otherwise how far along, plus pace.
  const pace = compare
    ? `${compare.pct >= 0 ? "▲" : "▼"} ${Math.abs(compare.pct)}% vs ${h.prevMonthLabel}'s pace`
    : null;
  const weightLine = beatLastMonth
    ? `Beat all of ${h.prevMonthLabel} (${wholeWeight(h.prevMonthTotalLb, unit)} ${unit})`
    : goalPct != null
      ? [`${goalPct}% of ${h.prevMonthLabel}'s total`, pace].filter(Boolean).join(" · ")
      : pace;

  return (
    <section aria-label={`Your ${h.monthLabel}`}>
      <Card className="overflow-hidden p-0">
        {/* Its own header, like every card on the page: no all-caps label floating above it. */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold">Your {h.monthLabel}</h2>
        </div>
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          {empty ? (
            <div className="p-4 text-center">
              <Dumbbell className="mx-auto h-6 w-6 text-muted-foreground" />
              <div className="mt-2 text-sm font-semibold">Your numbers start with your first workout</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Log your sets and this fills in automatically.
              </p>
            </div>
          ) : (
            <>
              {/* The three numbers that matter, in one row */}
              <div className="grid grid-cols-3 divide-x divide-border/60 px-2 pb-3.5 pt-3">
                <Tile label="Workouts" value={isLoading ? "…" : String(h.workouts)} />
                <Tile label="PRs" value={isLoading ? "…" : String(h.prLifts)} record={h.prLifts > 0} />
                <Tile label="Week streak" value={isLoading ? "…" : String(h.streakWeeks)} />
              </div>

              {/* The rest of the month, one tap away: weight lifted and the athlete rows. */}
              <CollapsibleContent className="border-t border-border/60 px-4 pb-4 pt-3">
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  Total weight lifted
                  <InfoTip label="About total weight lifted" title="Total weight lifted" align="start">
                    Every set's weight × reps, added up for the month. Bodyweight-only sets aren't included.
                  </InfoTip>
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold leading-none tabular-nums">
                    {isLoading ? "…" : compactWeight(h.weightLb, unit)}
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">{unit}</span>
                </div>
                {goalPct != null && (
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={beatLastMonth ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-muted-foreground/60"}
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
                    {beatLastMonth && <Trophy className="mr-1 inline h-3.5 w-3.5 -translate-y-px" strokeWidth={2.25} aria-hidden />}
                    {weightLine}
                  </div>
                )}
                {workoutLine && (
                  <div className={"mt-1 text-xs " + (workoutDelta > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {workoutLine}
                  </div>
                )}

                {(h.topLift || h.topMuscle) && (
                  <div className="mt-3 space-y-2.5 border-t border-border/60 pt-3">
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
              </CollapsibleContent>
            </>
          )}

          <div className="flex items-center justify-between border-t border-border/60">
            {!empty ? (
              <CollapsibleTrigger className="inline-flex h-11 items-center gap-1 px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground active:bg-muted/40">
                {moreOpen ? "Less" : "More"}
                <ChevronDown className={"h-4 w-4 transition-transform " + (moreOpen ? "rotate-180" : "")} aria-hidden />
              </CollapsibleTrigger>
            ) : <span />}
            <Link
              to="/portal/workouts/analytics"
              className="inline-flex h-11 items-center gap-0.5 px-4 text-sm font-semibold text-foreground transition active:bg-muted/40"
            >
              See all analytics <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </Collapsible>
      </Card>
    </section>
  );
}

function Tile({
  label,
  value,
  record = false,
}: {
  label: string;
  value: string;
  /** A PR count above zero: amber, the app's colour for records. */
  record?: boolean;
}) {
  return (
    <div className="px-2 text-center">
      <div className={"text-2xl font-semibold leading-none tabular-nums " + (record ? "text-amber-600 dark:text-amber-400" : "")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
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
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
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
