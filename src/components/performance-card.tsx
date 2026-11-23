import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChevronRight, Trophy } from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getClientResults } from "@/lib/pl-programs";
import { buildCalendar, weekColumns, type DaySummary } from "@/lib/analytics/performance-calendar";
import { liftStrengths, liftNow, mainLift } from "@/lib/analytics/lift-strength";
import { COMP_LIFT_LABEL } from "@/lib/analytics/competition-strength";
import { useCompetitionData } from "@/lib/analytics/competition-strength.queries";
import { isHeadlineRecord, personalRecords } from "@/lib/analytics/records";
import { levelColor } from "@/components/analytics/performance-calendar";
import { ProgressRing, LB_PER_KG } from "@/components/analytics/viz";

type Unit = "lb" | "kg";
const DAY = 86_400_000;
const WEEKS = 12;

/**
 * The Workouts page's way into analytics, drawn from the athlete's own
 * training: the last 12 weeks as a small activity calendar, this month's
 * planned workouts as a ring, one headline number (the main lift's estimated
 * strength, else the month's records) and the latest record worth naming.
 * The whole card opens Training analytics, which reads the same logged sets
 * (`["pl-results", clientId, null]`).
 */
export function PerformanceCard({
  clientId,
  unit = "lb",
  month,
  hideWhenEmpty = false,
}: {
  clientId: string;
  unit?: Unit;
  /** this calendar month's workouts on the program that are due, and how many are done */
  month?: { label: string; planned: number; done: number } | null;
  hideWhenEmpty?: boolean;
}) {
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results", clientId, null],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => getClientResults(clientId),
  });
  // meets: a competition lift's records and estimate read against the platform too
  const competition = useCompetitionData(
    clientId,
    (results as Array<{ is_competition_lift?: boolean }>).some((r) => r?.is_competition_lift),
  );
  const meets = useMemo(() => competition.data?.meets ?? [], [competition.data]);
  const read = useMemo(() => {
    const rs = results as any[];
    if (!rs.length) return null;
    const today = format(new Date(), "yyyy-MM-dd");
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (WEEKS - 1) * 7);
    const start = format(monday, "yyyy-MM-dd");
    const firstLog = format(new Date(rs[0].date), "yyyy-MM-dd");
    const days = buildCalendar({
      results: rs,
      plan: [],
      prs: [],
      start,
      end: today,
      today,
      metric: "activity",
      firstLog,
      strength: new Map(),
    });
    const strength = liftStrengths(rs, meets, today);
    const sixAgo = format(new Date(Date.now() - 42 * DAY), "yyyy-MM-dd");
    const main = mainLift(strength, format(new Date(Date.now() - 84 * DAY), "yyyy-MM-dd"), today);
    const lift = main ? liftNow(strength[main], sixAgo, today) : null;
    const { records } = personalRecords(rs, meets);
    const monthStart = format(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      "yyyy-MM-dd",
    );
    const monthRecords = records.filter((r) => r.day >= monthStart);
    const latest =
      [...records]
        .reverse()
        .find(
          (r) =>
            r.day >= format(new Date(Date.now() - 45 * DAY), "yyyy-MM-dd") && isHeadlineRecord(r),
        ) ??
      records[records.length - 1] ??
      null;
    const trained = days.filter((d) => d.sets > 0).length;
    // the main lift's estimated-strength line over the same 12 weeks, as a sparkline
    const spark = main
      ? strength[main].envelope.filter((p) => p.day >= start).map((p) => p.value)
      : [];
    return { days, main, lift, monthRecords, latest, trained, spark };
  }, [results, meets]);

  if (isLoading)
    return hideWhenEmpty ? null : (
      <Card className="h-[176px] animate-pulse bg-muted/30" aria-hidden />
    );
  if (!read) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Your performance fills in after your first logged workout.
      </Card>
    );
  }
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const pct = month && month.planned > 0 ? Math.round((month.done / month.planned) * 100) : null;
  const cols = weekColumns(read.days);
  const w = (lb: number) => (unit === "kg" ? Math.round(conv(lb) * 2) / 2 : Math.round(lb));

  return (
    <Card className="overflow-hidden p-0" data-performance-card>
      <Link
        to="/portal/workouts/analytics"
        className="block p-4 transition active:bg-muted/40"
        aria-label="Performance. Open training analytics"
        data-analytics-entry
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Performance</h2>
          <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-muted-foreground">
            Analytics <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-4">
          {/* the last 12 weeks, a square a day: the athlete's own training as the card's art */}
          <div
            className="flex shrink-0 gap-[3px]"
            role="img"
            aria-label={`${read.trained} training days in the last ${WEEKS} weeks`}
            data-performance-heatmap
          >
            {cols.map((col, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {col.map((d: DaySummary | null, j) => (
                  <span
                    key={j}
                    className={cn(
                      "h-[9px] w-[9px] rounded-[2px]",
                      !d
                        ? "opacity-0"
                        : d.sets
                          ? ""
                          : d.state === "none" || d.state === "future"
                            ? "bg-muted/30"
                            : "bg-muted/70",
                    )}
                    style={
                      d && d.sets ? { background: levelColor("activity", d.level) } : undefined
                    }
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            {read.main && read.lift?.now ? (
              <div data-performance-lift>
                <div className="text-[12px] text-muted-foreground">
                  {COMP_LIFT_LABEL[read.main]} estimate
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[24px] font-semibold leading-none tabular-nums tracking-tight">
                    {Math.round(conv(read.lift.now.value))}
                  </span>
                  {read.spark.length >= 3 && <Sparkline values={read.spark} />}
                  <span className="text-[12px] text-muted-foreground">{unit}</span>
                  {read.lift.trend.kind !== "unclear" && Math.abs(read.lift.trend.pct) >= 0.5 && (
                    <span
                      className={cn(
                        "text-[12px] font-medium tabular-nums",
                        read.lift.trend.pct > 0 ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {read.lift.trend.pct > 0 ? "+" : "−"}
                      {Math.abs(read.lift.trend.pct)}%
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div data-performance-days>
                <div className="text-[12px] text-muted-foreground">
                  Training days, {WEEKS} weeks
                </div>
                <div className="text-[24px] font-semibold leading-none tabular-nums tracking-tight">
                  {read.trained}
                </div>
              </div>
            )}
            {pct != null && (
              <div className="flex items-center gap-2" data-performance-month>
                <ProgressRing
                  pct={pct}
                  size={26}
                  stroke={3.5}
                  tone="success"
                  label={`${pct}% of ${month!.label}'s workouts done`}
                />
                <span className="text-[12px] leading-tight text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {month!.done} of {month!.planned}
                  </span>{" "}
                  {month!.label} workouts
                </span>
              </div>
            )}
          </div>
        </div>
        {read.latest && (
          <div
            className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3 text-[13px]"
            data-performance-record
          >
            <Trophy className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 truncate text-foreground">
              {read.latest.exercise} {w(read.latest.load)} {unit} × {read.latest.reps}
            </span>
            <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
              {read.monthRecords.length > 1
                ? `${read.monthRecords.length} records this month`
                : format(new Date(`${read.latest.day}T12:00:00`), "MMM d")}
            </span>
          </div>
        )}
      </Link>
    </Card>
  );
}

/** The estimated-strength line, drawn small: shape only, no axis. */
function Sparkline({ values }: { values: number[] }) {
  const w = 44;
  const h = 16;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, hi * 0.04);
  const pts = values.map(
    (v, i) =>
      `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - lo) / span) * (h - 2)).toFixed(1)}`,
  );
  return (
    <svg
      width={w}
      height={h}
      className="self-center text-success"
      aria-hidden
      data-performance-spark
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
