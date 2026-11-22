import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { BarChart3, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { buildTrainingLoad, weekOf } from "@/lib/analytics/training-load";
import { resultsToLoadSets } from "@/lib/analytics/training-load.queries";
import { Card } from "@/components/ui/card";
import { getClientResults } from "@/lib/pl-programs";
import { computeMonthHighlights, type Unit } from "@/lib/month-highlights";

/**
 * Training analytics' way in, on the Workouts tab: one row named for what it
 * opens ("Training analytics", the month's workouts, PRs and streak under it),
 * and a glance at the trend (working sets a week for 8 weeks and the one
 * insight that stands out, from the same read as the page) that opens Volume.
 * Nothing folds: weight lifted, the strongest lift and the rest are the
 * analytics page's, one tap away.
 */
export function TrainingAnalyticsPreviewCard({
  clientId,
  unit: unitProp,
  hideWhenEmpty = false,
  bare = false,
  part = "all",
}: {
  clientId: string;
  unit?: Unit;
  /** Nothing until there's a workout to count (analytics stays in Workouts' ⋯). */
  hideWhenEmpty?: boolean;
  /** Rows inside another card (Workouts groups them with readiness): no card of its own. */
  bare?: boolean;
  /** Workouts places the way in and the trend apart (readiness between them): which row(s) to draw. */
  part?: "entry" | "trend" | "all";
}) {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results-preview", clientId],
    enabled: !!clientId,
    queryFn: () => getClientResults(clientId),
    staleTime: 60_000,
  });
  void unitProp;

  const h = useMemo(() => computeMonthHighlights(results as any[]), [results]);
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

  if (hideWhenEmpty && (isLoading || empty)) return null;

  // The month in one line: what happened, nothing at zero ("12 workouts · 3 PRs · 4-week streak").
  const monthParts: { text: string; record?: boolean }[] = isLoading
    ? [{ text: "…" }]
    : [
        { text: `${h.monthLabel.slice(0, 3)} · ${h.workouts} workout${h.workouts === 1 ? "" : "s"}` },
        ...(h.prLifts > 0 ? [{ text: `${h.prLifts} PR${h.prLifts === 1 ? "" : "s"}`, record: true }] : []),
        ...(h.streakWeeks > 0 ? [{ text: `${h.streakWeeks}-wk streak` }] : []),
      ];
  const Wrap = bare ? "div" : Card;

  const entry = (
    // The way in: one tap from Workouts to Training analytics.
    <Link
      to="/portal/workouts/analytics"
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition active:bg-muted/50"
      data-analytics-entry
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center" aria-hidden>
        <BarChart3 className="h-5 w-5 text-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">Training analytics</span>
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
        {empty && <span className="mt-0.5 block text-[13px] text-muted-foreground">Fills in with your first logged workout</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );

  const trend = !isLoading && !empty && spark.some((w) => w.sets > 0) ? (
    // A glance at the trend: working sets a week for 8 weeks, and the one thing that stands out.
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
  ) : null;

  if (part === "entry") return entry;
  if (part === "trend") return trend;
  return (
    <section aria-label={`Your ${h.monthLabel}`}>
      <Wrap className={bare ? "divide-y divide-border" : "divide-y divide-border overflow-hidden p-0"}>
        {entry}
        {trend}
      </Wrap>
    </section>
  );
}
