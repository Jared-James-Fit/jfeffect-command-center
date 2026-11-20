import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Dumbbell, TrendingUp, Trophy } from "lucide-react";
import { format } from "date-fns";
import { buildTrainingLoad, weekOf } from "@/lib/analytics/training-load";
import { resultsToLoadSets } from "@/lib/analytics/training-load.queries";
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
 * Training analytics' way in, on the Workouts tab: its header opens the
 * analytics page, then the month's three numbers (workouts, PRs, week streak),
 * then a glance at the trend (working sets a week for 8 weeks and the one
 * insight that stands out, from the same read as the page) that opens Volume.
 * Weight lifted, the strongest lift and the most trained muscle fold under
 * "More" (the analytics page reads them by block, not by month).
 */
export function TrainingAnalyticsPreviewCard({
  clientId,
  unit: unitProp,
  hideWhenEmpty = false,
  bare = false,
}: {
  clientId: string;
  unit?: Unit;
  /** Nothing until there's a workout to count (analytics stays in Workouts' ⋯). */
  hideWhenEmpty?: boolean;
  /** Rows inside another card (Workouts groups them with readiness): no card of its own. */
  bare?: boolean;
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
  // the last 8 weeks of working sets and the one insight worth a line (training-load.ts, the analytics page's read)
  const { spark, sparkMax, lastFull, headline } = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    const load = buildTrainingLoad({ sets: resultsToLoadSets(results as any[]), today });
    const byWeek = new Map(load.weeks.map((w) => [w.key, w.sets]));
    const thisWeek = weekOf(today);
    const keys: string[] = [];
    for (let i = 7; i >= 0; i--) keys.push(weekOf(format(new Date(Date.parse(thisWeek) - i * 7 * 86_400_000 + 12 * 3_600_000), "yyyy-MM-dd")));
    const spark = keys.map((key) => ({ key, sets: byWeek.get(key) ?? 0, current: key === thisWeek }));
    const prev = spark[spark.length - 2];
    const top = load.insights.find((i) => i.audience === "both" && i.tone !== "info");
    return {
      spark,
      sparkMax: Math.max(1, ...spark.map((w) => w.sets)),
      lastFull: prev && prev.sets > 0 ? prev : null,
      headline: top?.title ?? null,
    };
  }, [results]);
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

  if (hideWhenEmpty && (isLoading || empty)) return null;

  // The month in one line: what happened, nothing at zero ("12 workouts · 3 PRs · 4-week streak").
  const monthParts: { text: string; record?: boolean }[] = isLoading
    ? [{ text: "…" }]
    : [
        { text: `${h.workouts} workout${h.workouts === 1 ? "" : "s"}` },
        ...(h.prLifts > 0 ? [{ text: `${h.prLifts} PR${h.prLifts === 1 ? "" : "s"}`, record: true }] : []),
        ...(h.streakWeeks > 0 ? [{ text: `${h.streakWeeks}-week streak` }] : []),
      ];
  const Wrap = bare ? "div" : Card;

  return (
    <section aria-label={`Your ${h.monthLabel}`}>
      <Wrap className={bare ? "divide-y divide-border" : "divide-y divide-border overflow-hidden p-0"}>
        {/* The row is the way in: it opens Training analytics. */}
        <Link
          to="/portal/workouts/analytics"
          className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition active:bg-muted/50"
          data-analytics-entry
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center" aria-hidden>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight">
              Training <span className="font-normal text-muted-foreground">· {h.monthLabel}</span>
            </span>
            {!empty && (
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground" data-month-line>
                {monthParts.map((p, i) => (
                  <span key={p.text}>
                    {i > 0 && " · "}
                    <span className={p.record ? "font-medium text-amber-600 dark:text-amber-400" : undefined}>{p.text}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
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
              {/* A glance at the trend: working sets a week for 8 weeks, and the one thing that stands out. */}
              {!isLoading && spark.some((w) => w.sets > 0) && (
                <Link
                  to="/portal/workouts/analytics"
                  search={{ view: "volume" } as any}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition active:bg-muted/50"
                  aria-label={`Working sets the last 8 weeks: ${spark.map((w) => w.sets).join(", ")}. Open volume.`}
                  data-analytics-spark
                >
                  <span className="flex h-7 w-10 shrink-0 items-end justify-center gap-[2px]" aria-hidden>
                    {spark.map((w) => (
                      <span
                        key={w.key}
                        className={
                          "w-[3px] rounded-t-[1px] " +
                          (w.sets > 0 ? (w.current ? "bg-foreground/35" : "bg-foreground/70") : "bg-border")
                        }
                        style={{ height: `${Math.max(10, (w.sets / sparkMax) * 100)}%` }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium tabular-nums">
                      {lastFull ? `${lastFull.sets} working sets last week` : `${spark[spark.length - 1].sets} working sets this week`}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {headline ?? "Volume by muscle, lift and day"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              )}

              {/* The rest of the month, one tap away: weight lifted and the athlete rows. */}
              <CollapsibleContent className="px-4 pb-4 pt-3">
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
                {/* What the three numbers count, said once (month-highlights.ts). */}
                <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground" data-month-definitions>
                  Workouts are days with a logged set. PRs are exercises with a new best estimated max this month (a first time doing one doesn't count). Week streak is weeks in a row with a logged set.
                </p>
              </CollapsibleContent>
            </>
          )}

          {!empty && (
            <div className="flex items-center border-t border-border">
              <CollapsibleTrigger className="inline-flex h-11 items-center gap-1 px-4 text-[13px] font-medium text-muted-foreground transition hover:text-foreground active:bg-muted/40">
                {moreOpen ? "Less" : `More about ${h.monthLabel}`}
                <ChevronDown className={"h-4 w-4 transition-transform " + (moreOpen ? "rotate-180" : "")} aria-hidden />
              </CollapsibleTrigger>
            </div>
          )}
        </Collapsible>
      </Wrap>
    </section>
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
