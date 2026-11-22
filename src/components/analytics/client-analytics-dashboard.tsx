import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TrendingUp, Trophy, Dumbbell, Calendar, Flame, PieChart, Clock, BarChart3, Check, Moon } from "lucide-react";
import {
  getClientResults, buildExerciseHistory, recentPRs,
} from "@/lib/pl-programs";
import { format } from "date-fns";
import {
  AnalyticsPeriodControl,
  defaultAnalyticsFilter,
  exactBlockFilter,
  lifetimeFilter,
  type AnalyticsFilter,
} from "@/components/analytics/analytics-filter-bar";
import { BlockPickerSheet } from "@/components/analytics/block-picker-sheet";
import {
  type AnalyticsBlock,
  normalizeAnalyticsBlock,
  resolveCurrentBlock,
} from "@/lib/analytics/blocks";
import { PowerliftingExposureSection } from "@/components/analytics/powerlifting-exposure-section";
import { PlannedVsActualCard } from "@/components/analytics/planned-vs-actual-card";
import { WeightLiftedCard } from "@/components/analytics/weight-lifted-card";
import { GraphDotDetail, type GraphDotPoint } from "@/components/analytics/graph-dot-detail";
import { LiftProgressCard } from "@/components/analytics/lift-progress-card";
import { BodyweightTrendCard } from "@/components/analytics/bodyweight-trend-card";
import { CardioAnalyticsSection } from "@/components/analytics/cardio-analytics-section";
import { RunningAnalyticsSection } from "@/components/analytics/running-analytics-section";
import { RecoveryPatternsCard } from "@/components/analytics/recovery-patterns-card";
import { RecoveryTrendsCard } from "@/components/analytics/recovery-trends-card";
import { PredictedWindowCard } from "@/components/analytics/predicted-window-card";
import { TrainingTimeCard } from "@/components/analytics/training-time-card";
import { CompetitionStrengthChart } from "@/components/analytics/competition-strength-chart";
import { TotalStandingCard } from "@/components/analytics/total-standing-card";
import { getClientAnalyticsSettings } from "@/lib/analytics/settings";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { InfoTip } from "@/components/analytics/info-tip";
import { InsightList, Muscles, TrainingLoadSection, WeeklyChart } from "@/components/analytics/training-load-section";
import { useTrainingLoad } from "@/lib/analytics/training-load.queries";
import { perWeekWords, type Insight } from "@/lib/analytics/training-load";
import { strengthPoints } from "@/lib/analytics/competition-strength";
import { useCompetitionData } from "@/lib/analytics/competition-strength.queries";
import { analyticsProfile, compSessionsSince } from "@/lib/analytics/analytics-profile";
import { clientBodyweightQueryKey, loadClientBodyweight } from "@/lib/client-bodyweight";
import { cn } from "@/lib/utils";

export type Unit = "lb" | "kg";
/** A load as lifted: whole, or one decimal when it has one (72.5). */
const fmtLoad = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const LB_PER_KG = 2.2046226;
function convertWeight(value: number, from: Unit, to: Unit) {
  if (!value || from === to) return value;
  return to === "lb" ? value * LB_PER_KG : value / LB_PER_KG;
}

export interface ClientAnalyticsDashboardProps {
  clientId: string;
  preferredUnit?: Unit;
  /** Optional initial filter (used by portal for URL deep-links). */
  initialFilter?: AnalyticsFilter | null;
  /** Called whenever the filter changes. Portal syncs to URL. */
  onFilterChange?: (filter: AnalyticsFilter) => void;
  /** Show the LB/KG toggle above the filter bar. Defaults to true. */
  showUnitToggle?: boolean;
  /** Optional node rendered as the "View All" PRs affordance. */
  viewAllPRsNode?: ReactNode;
  /** Optional node rendered above the filter bar (e.g. "Back to workouts"). */
  headerLeadingNode?: ReactNode;
  /** Whether GraphDotDetail can open the underlying set log. */
  canOpenLog?: boolean;
  /** Leave out the bodyweight trend card (the coach's Progress tab has its own bodyweight panel above). */
  hideBodyweight?: boolean;
  /** Optional class on outer container. */
  className?: string;
  /** The coach's view: programming detail (intensity spread, coach-only insights). */
  coach?: boolean;
  /** Which section opens first (a deep link), and a callback to keep it in the address. */
  initialView?: AnalyticsView;
  onViewChange?: (view: AnalyticsView) => void;
}

export type AnalyticsView = "overview" | "strength" | "volume" | "recovery";
export const ANALYTICS_VIEWS: Array<[AnalyticsView, string]> = [
  ["overview", "Overview"],
  ["strength", "Strength"],
  ["volume", "Volume"],
  ["recovery", "Recovery"],
];

/**
 * Shared client analytics dashboard — identical numbers for coach and client.
 * Extracted from the portal analytics page so the Admin → Client Profile →
 * Analytics tab renders exactly the same view a client sees, keyed to any
 * clientId. Filter state lives inside; portal wraps this with URL sync.
 */
export function ClientAnalyticsDashboard({
  clientId,
  preferredUnit = "lb",
  initialFilter,
  onFilterChange,
  showUnitToggle = true,
  viewAllPRsNode,
  headerLeadingNode,
  canOpenLog = false,
  hideBodyweight = false,
  className,
  coach = false,
  initialView,
  onViewChange,
}: ClientAnalyticsDashboardProps) {
  const {
    data: clientBlocks = [],
    isLoading: blocksLoading,
    isError: blocksError,
    refetch: refetchBlocks,
  } = useQuery<AnalyticsBlock[]>({
    queryKey: ["pl-blocks-for-analytics", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_blocks")
        .select(
          "id, name, status, start_date, end_date, weeks, sort_order, training_focus, prep_id, source_template_block_key, pl_preps(id, title, event_name, event_date)",
        )
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true });
      return (data ?? []).filter(isPrimaryProgramBlock).map(normalizeAnalyticsBlock);
    },
  });

  const resolvedCurrentBlockId = useMemo(
    () => resolveCurrentBlock(clientBlocks)?.id ?? null,
    [clientBlocks],
  );

  const [analyticsFilter, setAnalyticsFilter] = useState<AnalyticsFilter | null>(
    initialFilter ?? null,
  );
  useEffect(() => {
    if (!clientBlocks.length && !analyticsFilter) return;
    if (analyticsFilter) return;
    setAnalyticsFilter(initialFilter ?? defaultAnalyticsFilter(clientBlocks));
  }, [analyticsFilter, clientBlocks, initialFilter]);
  const filter = analyticsFilter ?? defaultAnalyticsFilter(clientBlocks);

  const handleFilterChange = (next: AnalyticsFilter) => {
    setAnalyticsFilter(next);
    onFilterChange?.(next);
  };

  const [pickerOpen, setPickerOpen] = useState(false);

  // Overview · Strength · Volume · Recovery: one page, one section at a time.
  // A #recovery link opens Recovery.
  const [view, setView] = useState<AnalyticsView>(() => {
    if (typeof window !== "undefined" && window.location.hash === "#recovery") return "recovery";
    return initialView && ANALYTICS_VIEWS.some(([v]) => v === initialView) ? initialView : "overview";
  });
  const changeView = (v: AnalyticsView) => {
    setView(v);
    onViewChange?.(v);
  };

  // Soonest upcoming meet across this athlete's prep blocks.
  const nextMeetDate = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return (
      clientBlocks
        .map((b) => b.pl_preps?.event_date ?? null)
        .filter((d): d is string => !!d && d >= today)
        .sort()[0] ?? null
    );
  }, [clientBlocks]);

  const activeBlockId =
    filter.preset === "current_block" ||
    filter.preset === "previous_block" ||
    filter.preset === "exact_block"
      ? ((filter as any).blockId as string)
      : null;

  // Every logged set, read once. A period only filters it: an "all-time PR"
  // and a strength trend are judged against the whole history, never against
  // the first set logged inside the period (that read a block's second Rear
  // Delt Cable Fly as a "PR").
  const { data: allResults = [], isLoading } = useQuery({
    queryKey: ["pl-results", clientId, null],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => getClientResults(clientId),
  });
  // A block is its own workouts (never another program's sets on the same dates).
  const { data: blockDayIds } = useQuery({
    queryKey: ["analytics-block-days", activeBlockId],
    enabled: !!activeBlockId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: weeks } = await supabase.from("pl_weeks").select("id").eq("block_id", activeBlockId!);
      const ids = (weeks ?? []).map((w: any) => w.id);
      if (!ids.length) return new Set<string>();
      const { data: days } = await supabase.from("pl_days").select("id").in("week_id", ids);
      return new Set((days ?? []).map((d: any) => d.id as string));
    },
  });
  const results = useMemo(() => {
    if (!activeBlockId) return allResults as any[];
    if (!blockDayIds) return [] as any[];
    return (allResults as any[]).filter((r) => r.day_id && blockDayIds.has(r.day_id));
  }, [allResults, activeBlockId, blockDayIds]);
  const scopeLoading = isLoading || (!!activeBlockId && !blockDayIds);

  const selectedBlockId = activeBlockId;
  const firstDataDate = useMemo(() => {
    const first = (allResults as any[])[0]?.date;
    return first ? new Date(first) : null;
  }, [allResults]);

  const { data: analyticsSettings } = useQuery({
    queryKey: ["client-analytics-settings", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: () => getClientAnalyticsSettings(clientId),
  });
  const { data: goals } = useQuery({
    queryKey: ["analytics-goals", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("client_goals_setup")
        .select("main_goal, training_styles")
        .eq("client_id", clientId)
        .maybeSingle();
      return (data ?? null) as { main_goal: string | null; training_styles: string[] | null } | null;
    },
  });

  const sourceUnit: Unit = "lb";
  const [displayUnit, setDisplayUnit] = useState<Unit>(preferredUnit);
  const [unitSynced, setUnitSynced] = useState(false);
  useEffect(() => {
    if (!unitSynced) {
      setDisplayUnit(preferredUnit);
      setUnitSynced(true);
    }
  }, [preferredUnit, unitSynced]);

  const [selectedDot, setSelectedDot] = useState<GraphDotPoint | null>(null);

  const startMs = filter.start.getTime();
  const endMs = filter.end.getTime() + 86_399_999;
  const inPeriod = useCallback((iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= startMs && t <= endMs;
  }, [startMs, endMs]);

  const filteredResults = useMemo(
    () => (results as any[]).filter((r: any) => inPeriod(r.date)),
    [results, inPeriod],
  );

  const history = useMemo(
    () => buildExerciseHistory(filteredResults as any),
    [filteredResults],
  );
  // All-time PRs (against everything on file) that happened in this period.
  const prs = useMemo(() => {
    const scope = activeBlockId && blockDayIds ? blockDayIds : null;
    return recentPRs(allResults as any[], 365000).filter(
      (p: any) => inPeriod(p.date) && (!scope || (p.day_id && scope.has(p.day_id))),
    );
  }, [allResults, inPeriod, activeBlockId, blockDayIds]);

  const conv = useCallback(
    (v: number) => convertWeight(Number(v) || 0, sourceUnit, displayUnit),
    [displayUnit],
  );

  // Volume & workload: the same read for the coach and the athlete (training-load.ts)
  const trainingLoad = useTrainingLoad({
    clientId,
    results: results as any[],
    start: filter.start,
    end: filter.end,
    blockId: activeBlockId,
  });
  const loadInsights = useMemo(
    () => trainingLoad.load.insights.filter((i) => coach || i.audience === "both"),
    [trainingLoad.load, coach],
  );

  // Competition lifts: every hard set on file (the chart and "where you stand" cut it).
  const strength = useMemo(() => strengthPoints(allResults as any[]), [allResults]);
  const lightInPeriod = useMemo(
    () => strength.light.filter((l) => inPeriod(`${l.day}T12:00:00`)).length,
    [strength.light, inPeriod],
  );
  const compSessions12w = useMemo(
    () => compSessionsSince(allResults as any[], Date.now() - 84 * 86_400_000),
    [allResults],
  );
  const hasPowerlifting = compSessions12w > 0 || strength.points.length > 0 || trainingLoad.load.lifts.some((l) => l.competitionSets > 0);
  const profile = analyticsProfile({
    mainGoal: goals?.main_goal,
    styles: goals?.training_styles,
    compSessions12w,
    hasMeet: !!nextMeetDate,
  });
  const competition = useCompetitionData(clientId, hasPowerlifting);
  const { data: bodyweight } = useQuery({
    queryKey: clientBodyweightQueryKey(clientId),
    enabled: !!clientId && hasPowerlifting && view === "strength",
    staleTime: 5 * 60_000,
    queryFn: () => loadClientBodyweight(clientId),
  });
  const weighIns = useMemo(
    () => (bodyweight?.entries ?? []).map((e) => ({ day: e.date, lb: e.unit === "kg" ? e.value * 2.2046226 : e.value })),
    [bodyweight],
  );
  const todayISO = format(new Date(), "yyyy-MM-dd");

  const summary = useMemo(() => {
    const workouts = new Set(
      filteredResults
        .filter((r: any) => r.date)
        .map((r: any) => format(new Date(r.date), "yyyy-MM-dd")),
    ).size;
    // Competition lifts lead the PR line: they're what a powerlifter reads first.
    const named = [...prs].sort((a: any, b: any) => Number(b.is_competition_lift === true) - Number(a.is_competition_lift === true));
    const names = [...new Set(named.map((p: any) => p.exercise_name as string))];
    return { workouts, prNames: names };
  }, [filteredResults, prs]);

  const t = trainingLoad.load.totals;
  const perWeek = perWeekWords(trainingLoad.load);
  const widen = () => handleFilterChange(lifetimeFilter(clientBlocks, firstDataDate));
  const strengthChart = (
    <CompetitionStrengthChart
      points={strength.points}
      lightSessions={lightInPeriod}
      meets={competition.data?.meets ?? []}
      blocks={clientBlocks.map((b) => ({ id: b.id, name: b.name, start_date: b.start_date }))}
      start={filter.start}
      end={filter.end}
      unit={displayUnit}
      conv={conv}
      weighIns={weighIns}
      onWiden={filter.preset === "lifetime" ? undefined : widen}
    />
  );

  return (
    <>
      <div className={`space-y-4 ${className ?? ""}`}>
        {headerLeadingNode}
        {/* One row of controls: the period (every choice in one sheet) and the unit. */}
        <div className="flex items-center gap-2" data-analytics-controls>
          <AnalyticsPeriodControl
            blocks={clientBlocks}
            value={filter}
            onChange={handleFilterChange}
            onOpenBlocks={() => setPickerOpen(true)}
            firstDataDate={firstDataDate}
            className="flex-1"
          />
          {showUnitToggle && (
            <ToggleGroup
              type="single"
              value={displayUnit}
              onValueChange={(v) => v && setDisplayUnit(v as Unit)}
              className="h-10 shrink-0 rounded-lg border border-border bg-card p-0.5"
              aria-label="Units"
            >
              <ToggleGroupItem value="lb" className="h-8 px-2.5 text-xs font-semibold data-[state=on]:bg-foreground data-[state=on]:text-background">
                lb
              </ToggleGroupItem>
              <ToggleGroupItem value="kg" className="h-8 px-2.5 text-xs font-semibold data-[state=on]:bg-foreground data-[state=on]:text-background">
                kg
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>

        <BlockPickerSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          blocks={clientBlocks}
          selectedBlockId={selectedBlockId}
          resolvedCurrentBlockId={resolvedCurrentBlockId}
          isLoading={blocksLoading}
          isError={blocksError}
          onRetry={() => { void refetchBlocks(); }}
          onSelect={(b) => handleFilterChange(exactBlockFilter(b, clientBlocks))}
        />

        {filter.preset === "exact_block" && !filter.hasBlockDates && (
          <p className="text-xs text-muted-foreground">This block has no dates yet, so its charts fill in once it's scheduled.</p>
        )}

        {scopeLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground" role="status">
            Loading training data…
          </Card>
        ) : (allResults as any[]).length === 0 ? (
          <AnalyticsEmptyPreview />
        ) : (
          <>
            <AnalyticsTabs view={view} onChange={changeView} hasPowerlifting={hasPowerlifting} />

            {view === "overview" && (
              <div className="space-y-5" data-analytics-view="overview" data-analytics-profile={profile}>
                {/* What matters most for this athlete comes first: the chart, then the numbers. */}
                {profile === "powerlifting" && hasPowerlifting && (
                  <section aria-label="Competition lifts">
                    <SectionHeading
                      icon={<TrendingUp className="h-5 w-5" />}
                      title="Competition lifts"
                      tip={
                        <InfoTip label="About the strength chart" title="Competition lifts" align="start">
                          Each point is the session's estimated max from a hard set (RPE 7 or harder, 10 reps or
                          fewer), read with its effort. Light days and unrated sets aren't plotted: they say little
                          about a max. Meet results are marked apart. Variations have their own history under
                          Strength.
                        </InfoTip>
                      }
                    />
                    {strengthChart}
                  </section>
                )}
                {profile === "physique" && (
                  <section aria-label="Weekly sets by muscle">
                    <SectionHeading
                      icon={<BarChart3 className="h-5 w-5" />}
                      title={perWeek.label === "a week" ? "Sets a week by muscle" : "Sets by muscle this week"}
                      tip={
                        <InfoTip label="About sets by muscle" title="Sets by muscle" align="start">
                          Working sets (never warm-ups). A muscle gets a full set from exercises aimed at it and half
                          a set from ones that help. Hard sets (RPE 7+) are the darker part.
                        </InfoTip>
                      }
                    />
                    <Card className="p-4"><Muscles load={trainingLoad.load} coach={coach} /></Card>
                  </section>
                )}
                {profile === "general" && trainingLoad.load.weeks.length > 0 && (
                  <section aria-label="Training by week">
                    <Card className="p-4"><WeeklyChart weeks={trainingLoad.load.weeks} unit={displayUnit} /></Card>
                  </section>
                )}

                {filteredResults.length === 0 && (
                  <Card className="border-dashed border-border/70 bg-card/60 p-5 text-center text-sm text-muted-foreground">
                    Nothing logged in this period yet.
                  </Card>
                )}

                <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard
                    icon={<Calendar className="h-4 w-4" />}
                    label="Workouts"
                    value={String(summary.workouts)}
                    sublabel={t.plannedSessions ? `${t.plannedSessionsDone} of ${t.plannedSessions} planned` : undefined}
                    tip={
                      <InfoTip label="About workouts count" title="Workouts" align="start">
                        Days with at least one logged set in this period. "Planned" counts the program's workouts
                        dated on days that have passed.
                      </InfoTip>
                    }
                  />
                  <StatCard
                    icon={<Flame className="h-4 w-4" />}
                    label={trainingLoad.load.perWeekBasis.partial ? "Sets this week" : "Sets a week"}
                    value={t.sets ? String(t.setsPerWeek) : "0"}
                    sublabel={t.sets ? perWeek.note : undefined}
                    tip={
                      <InfoTip label="About working sets" title="Working sets" align="end">
                        Logged working sets (warm-ups never count; stretches and conditioning are left out). The
                        average reads only weeks that are over, never weeks still ahead; before a full week it's
                        this week so far.
                      </InfoTip>
                    }
                  />
                  <StatCard
                    icon={<Check className="h-4 w-4" />}
                    label="Done as written"
                    value={t.completionPct != null ? `${t.completionPct}%` : "—"}
                    sublabel={t.prescribed != null ? `${t.completedOfPrescribed} of ${t.prescribed} sets` : trainingLoad.planLoading ? "Reading the program…" : "No program dates here"}
                    tip={
                      <InfoTip label="About done as written" title="Done as written" align="start">
                        Of the sets the program wrote for days that have passed, how many were logged. Extra sets
                        don't raise it.
                      </InfoTip>
                    }
                  />
                  <StatCard
                    icon={<Trophy className="h-4 w-4" />}
                    label="All-time PRs"
                    value={String(prs.length)}
                    sublabel={summary.prNames.length ? summary.prNames.slice(0, 2).join(", ") + (summary.prNames.length > 2 ? ` +${summary.prNames.length - 2}` : "") : "None in this period"}
                    tip={
                      <InfoTip label="About all-time PRs" title="All-time PRs" align="end">
                        A set whose estimated max beats every earlier set of that exercise on file (Epley).
                        The first time you log an exercise doesn't count.
                      </InfoTip>
                    }
                  />
                </section>

                {loadInsights.length > 0 && (
                  <SectionErrorBoundary label="Coaching insights">
                    <TrainingLoadInsights insights={loadInsights} coach={coach} onOpenVolume={() => changeView("volume")} />
                  </SectionErrorBoundary>
                )}

                {hasPowerlifting && competition.data && (
                  <SectionErrorBoundary label="Where you stand">
                    <section aria-label="Where you stand">
                      <SectionHeading
                        icon={<PieChart className="h-5 w-5" />}
                        title={coach ? "Where they stand" : "Where you stand"}
                        tip={
                          <InfoTip label="About where you stand" title="Where you stand" align="start">
                            Your last meet (lifted), today's estimate for each lift from hard sets in the last 6
                            weeks (with the set behind it), and your coach's training max, kept apart. A current
                            total only when all three lifts have a recent hard set. Not tied to the period above.
                          </InfoTip>
                        }
                      />
                      <TotalStandingCard
                        clientId={clientId}
                        points={strength.points}
                        data={competition.data}
                        unit={displayUnit}
                        conv={conv}
                        today={todayISO}
                        coach={coach}
                      />
                    </section>
                  </SectionErrorBoundary>
                )}
              </div>
            )}

            {view === "strength" && (
              <div className="space-y-6" data-analytics-view="strength">
            {hasPowerlifting && (
              <section aria-label="Competition lifts over time">
                <SectionHeading
                  icon={<TrendingUp className="h-5 w-5" />}
                  title="Competition lifts"
                  tip={
                    <InfoTip label="About the strength chart" title="Competition lifts" align="start">
                      Estimated max from hard sets (RPE 7+, 10 reps or fewer), meet results marked apart, block
                      starts as dashed lines. × bodyweight divides each point by your average weigh-in that week.
                    </InfoTip>
                  }
                />
                {strengthChart}
              </section>
            )}
            <section aria-label="Lift Progress">
              <SectionHeading
                icon={<Dumbbell className="h-5 w-5" />}
                title="Any exercise"
                tip={
                  <InfoTip label="About lift progress" title="Any exercise" align="start">
                    One point per session: its best set. Est. max reads hard sets only (RPE 7+, 10 reps or fewer);
                    Top set is the heaviest weight; Volume is weight × reps. Touch the chart to see a session;
                    Details opens the set. Variations are their own exercise, never the competition lift.
                  </InfoTip>
                }
              />
              <LiftProgressCard
                history={history}
                displayUnit={displayUnit}
                conv={conv}
                onOpenSet={setSelectedDot}
              />
            </section>

            <section aria-label="All-time PRs">
              <SectionHeading
                icon={<Trophy className="h-5 w-5" />}
                title="All-time PRs"
                action={prs.length > 0 ? viewAllPRsNode : undefined}
                tip={
                  <InfoTip label="About all-time PRs" title="All-time PRs" align="start">
                    Each is a set whose estimated max beat every earlier set of that exercise on file: the set,
                    the best it beat, and the gain. Epley: weight × (1 + reps ÷ 30).
                  </InfoTip>
                }
              />
              {prs.length === 0 ? (
                <Card className="p-5 text-sm text-muted-foreground">
                  No all-time PRs in this period.
                </Card>
              ) : (
                <>
                  <Card className="divide-y divide-border/60 p-0" data-pr-list>
                    {prs.slice(0, 8).map((p: any) => (
                      <div key={p.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-[13px]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">{p.exercise_name}</div>
                          <div className="truncate text-[12px] text-muted-foreground">
                            {format(new Date(p.date), "MMM d")} · {fmtLoad(conv(p.load))} × {p.reps}{p.rpe ? ` @${p.rpe}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                          <div className="font-medium text-foreground">{Math.round(conv(p.est_1rm))} <span className="text-[11px] font-normal text-muted-foreground">est.</span></div>
                          <div className="text-[12px] text-emerald-600 dark:text-emerald-400">+{fmtLoad(conv(p.delta))}</div>
                        </div>
                      </div>
                    ))}
                  </Card>
                  {prs.length > 8 && viewAllPRsNode && (
                    <div className="mt-3 text-center">{viewAllPRsNode}</div>
                  )}
                </>
              )}
            </section>

            {/* Programming detail (roles, weekly session grid): the coach's, never an athlete's scroll. */}
            {coach && (
            <SectionErrorBoundary label="Powerlifting exposure">
            <PowerliftingExposureSection
              clientId={clientId}
              filter={filter}
              results={results as any[]}
              displayUnit={displayUnit}
              blockId={activeBlockId}
              admin={coach}
              navigateToBuilderHref={coach ? `/admin/clients/${clientId}?tab=training` : undefined}
            />
            </SectionErrorBoundary>
            )}

            <SectionErrorBoundary label="Predicted window">
            <PredictedWindowCard
              clientId={clientId}
              currentBlockId={activeBlockId ?? resolvedCurrentBlockId}
            />
            </SectionErrorBoundary>
              </div>
            )}

            {view === "volume" && (
              <div className="space-y-6" data-analytics-view="volume">
            <SectionErrorBoundary label="Volume and workload">
              <TrainingLoadSection
                load={trainingLoad.load}
                coach={coach}
                unit={displayUnit}
                rangeLabel={filter.short}
                planLoading={trainingLoad.planLoading}
                planError={trainingLoad.planError}
                hideInsights
                header={
                  <SectionHeading
                    icon={<BarChart3 className="h-5 w-5" />}
                    title="Volume & workload"
                    tip={
                      <InfoTip label="About volume and workload" title="Volume & workload" align="start">
                        Working sets (never warm-ups) by week, muscle, movement and day, against what was written.
                        A muscle gets a full set from exercises aimed at it and half a set from ones that help.
                        "How these are counted" under the charts has every definition.
                      </InfoTip>
                    }
                  />
                }
              />
            </SectionErrorBoundary>

            <section aria-label="Planned vs Actual">
              <SectionHeading
                icon={<Calendar className="h-5 w-5" />}
                title="Planned vs actual"
                tip={
                  <InfoTip label="About planned vs actual" title="Planned vs actual" align="start">
                    The 5 most recent finished workouts in this period, set by set against what was written.
                  </InfoTip>
                }
              />
              <PlannedVsActualCard
                clientId={clientId}
                formula={analyticsSettings?.e1rm_formula}
                workingRpeMin={analyticsSettings?.working_set_rpe_min}
                startDate={filter.start}
                endDate={filter.end}
                blockId={activeBlockId}
              />
            </section>

            <SectionErrorBoundary label="Weight lifted">
            <WeightLiftedCard
              clientId={clientId}
              displayUnit={displayUnit}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.short}
              blockId={activeBlockId}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Training time">
              <TrainingTimeCard
                clientId={clientId}
                rangeStart={filter.start}
                rangeEnd={filter.end}
                rangeLabel={filter.short}
                nextMeetDate={nextMeetDate}
                canOpenLog={canOpenLog}
                header={
                  <SectionHeading
                    icon={<Clock className="h-5 w-5" />}
                    title="Training time"
                    tip={
                      <InfoTip label="About training time" title="Training time" align="start">
                        When you train and for how long, from the workout timer or the time you set on a finished
                        workout. Workouts logged after the fact (lots of sets in a few minutes) are left out until
                        you set their real time. A best time is only named with 3+ sessions in at least two windows
                        and a real gap between them.
                      </InfoTip>
                    }
                  />
                }
              />
            </SectionErrorBoundary>
              </div>
            )}

            {view === "recovery" && (
              <div className="space-y-6" data-analytics-view="recovery" id="recovery">
            <section aria-label="Recovery">
              <SectionHeading
                icon={<Moon className="h-5 w-5" />}
                title="Check-outs"
                tip={
                  <InfoTip label="About check-outs" title="Check-outs" align="start">
                    What was logged after workouts: sleep, how recovered you felt and pain. Logged observations,
                    never an estimate. Today's readiness (an estimate) is on the Workouts page.
                  </InfoTip>
                }
              />
              <SectionErrorBoundary label="Recovery">
                <RecoveryTrendsCard clientId={clientId} start={filter.start} end={filter.end} />
              </SectionErrorBoundary>
            </section>

            {!hideBodyweight && (
            <SectionErrorBoundary label="Bodyweight trend">
            <BodyweightTrendCard
              clientId={clientId}
              displayUnit={displayUnit}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.short}
            />
            </SectionErrorBoundary>
            )}

            <SectionErrorBoundary label="Cardio">
            <CardioAnalyticsSection
              clientId={clientId}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.short}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Running">
            <RunningAnalyticsSection
              clientId={clientId}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.short}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Recovery patterns">
            <RecoveryPatternsCard
              clientId={clientId}
              rangeStart={filter.start}
              rangeEnd={filter.end}
            />
            </SectionErrorBoundary>
              </div>
            )}
          </>
        )}
      </div>

      <GraphDotDetail
        point={selectedDot}
        clientId={clientId}
        onClose={() => setSelectedDot(null)}
        canOpenLog={canOpenLog}
      />
    </>
  );
}

/**
 * The page's sections as one neutral row: Overview (what stands out, the
 * headline numbers), Strength (lifts, PRs), Volume (where the work went,
 * against what was written) and Recovery. Squat · bench · deadlift detail
 * only shows for someone who trains them.
 */
function AnalyticsTabs({ view, onChange }: { view: AnalyticsView; onChange: (v: AnalyticsView) => void; hasPowerlifting: boolean }) {
  return (
    <div
      role="tablist"
      aria-label="Analytics sections"
      className="flex gap-1 overflow-x-auto rounded-xl border border-border p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-analytics-tabs
    >
      {ANALYTICS_VIEWS.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-10 min-w-0 flex-1 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors",
            view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          data-analytics-tab={v}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Overview's "what stands out": the training-load insights (training-load-section.tsx's list). */
function TrainingLoadInsights({ insights, coach, onOpenVolume }: { insights: Insight[]; coach: boolean; onOpenVolume: () => void }) {
  return (
    <section aria-label="Coaching insights">
      <SectionHeading
        icon={<TrendingUp className="h-5 w-5" />}
        title={coach ? "Coaching insights" : "What stands out"}
        tip={
          <InfoTip label="About these insights" title={coach ? "Coaching insights" : "What stands out"} align="start">
            Read from logged sets and the program, never a guess. Each says what's happening, how sure it is,
            why it might be and whether anything needs to change. Often nothing does.
          </InfoTip>
        }
      />
      <InsightList insights={insights} coach={coach} onSeeNumbers={onOpenVolume} titled={false} />
    </section>
  );
}

/** Section title on its own line, so a long range label can never squeeze it. */
function SectionHeading({
  icon, title, tip, meta, action,
}: {
  icon: React.ReactNode;
  title: string;
  tip?: React.ReactNode;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <span className="truncate">{title}</span>
          {tip}
        </h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {meta && <div className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">{meta}</div>}
    </div>
  );
}

function StatCard({
  icon, label, value, sublabel, tip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  tip?: React.ReactNode;
}) {
  return (
    <Card className="relative min-w-0 overflow-hidden p-3">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
        {tip && <span className="ml-auto">{tip}</span>}
      </div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sublabel && (
        <div className="truncate text-[11px] text-muted-foreground">
          {sublabel}
        </div>
      )}
    </Card>
  );
}

function AnalyticsEmptyPreview() {
  return (
    <Card className="p-6 text-center" data-analytics-empty>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Dumbbell className="h-6 w-6" />
      </div>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">Your analytics start with your first workout</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Log your sets and this fills in by itself: strength over time, all-time PRs, weekly sets by muscle, and how
        closely you follow the plan.
      </p>
    </Card>
  );
}

// Re-export Link so consumers can build a viewAllPRsNode without depending
// on the exact router import path.
export { Link as AnalyticsRouterLink };