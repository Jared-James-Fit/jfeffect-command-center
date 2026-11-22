import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TrendingUp, Trophy, Dumbbell, Calendar, PieChart, BarChart3, Check, Moon, Download, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPdfLogo, makeAndDeliverPdf } from "@/lib/pdf/deliver";
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
import { InsightList, TrainingLoadSection } from "@/components/analytics/training-load-section";
import { RecoveryPreviewCard } from "@/components/analytics/recovery-preview-card";
import {
  AreaCard,
  BlockStrengthTable,
  ConsistencySummary,
  LiftTriplet,
  LiftsMovingCard,
  MeetsList,
  MiniBars,
  MoreDetail,
  ProgressBar,
} from "@/components/analytics/analytics-area-cards";
import {
  blockStrengthRows,
  blockVolumeRows,
  changeWords,
  consistencyOf,
  liftSummary,
  liftsTrending,
} from "@/lib/analytics/analytics-areas";
import { comparableE1rm } from "@/lib/analytics/strength-read";
import { recoverySummary } from "@/lib/analytics/recovery-trends";
import { useCheckouts } from "@/lib/analytics/recovery-trends.queries";
import { COMP_LIFTS } from "@/lib/analytics/competition-strength";
import { weekOf } from "@/lib/analytics/training-load";
import { parseLocalDate } from "@/lib/today";
import { useTrainingLoad } from "@/lib/analytics/training-load.queries";
import { perWeekWords, type Insight } from "@/lib/analytics/training-load";
import { strengthPoints } from "@/lib/analytics/competition-strength";
import { useCompetitionData } from "@/lib/analytics/competition-strength.queries";
import { analyticsProfile, compSessionsSince } from "@/lib/analytics/analytics-profile";
import { clientBodyweightQueryKey, loadClientBodyweight } from "@/lib/client-bodyweight";
import { cn } from "@/lib/utils";
import { useScrollFade } from "@/hooks/use-scroll-fade";

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

export type AnalyticsView = "overview" | "strength" | "volume" | "consistency" | "recovery";
export const ANALYTICS_VIEWS: Array<[AnalyticsView, string]> = [
  ["overview", "Overview"],
  ["strength", "Strength"],
  ["volume", "Volume"],
  ["consistency", "Consistency"],
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

  const t = trainingLoad.load.totals;
  const perWeek = perWeekWords(trainingLoad.load);
  const widen = () => handleFilterChange(lifetimeFilter(clientBlocks, firstDataDate));
  const strengthChart = (
    <CompetitionStrengthChart
      points={strength.points}
      lightSessions={lightInPeriod}
      meets={competition.data?.meets ?? []}
      maxes={competition.data?.maxes ?? []}
      blocks={clientBlocks.map((b) => ({ id: b.id, name: b.name, start_date: b.start_date }))}
      start={filter.start}
      end={filter.end}
      unit={displayUnit}
      conv={conv}
      weighIns={weighIns}
      onWiden={filter.preset === "lifetime" ? undefined : widen}
    />
  );

  // ── the four areas (analytics-areas.ts): one read each, shared by the Overview and the area ──
  const startDay = format(filter.start, "yyyy-MM-dd");
  const endDay = format(filter.end, "yyyy-MM-dd");
  const consistency = useMemo(() => consistencyOf(trainingLoad.load), [trainingLoad.load]);
  const blockStrength = useMemo(
    () => blockStrengthRows(strength.points, clientBlocks, startDay, endDay),
    [strength.points, clientBlocks, startDay, endDay],
  );
  const blockVolume = useMemo(() => blockVolumeRows(trainingLoad.load.weeks, clientBlocks), [trainingLoad.load.weeks, clientBlocks]);
  const liftsMoving = useMemo(
    () => liftsTrending(results as any[], startDay, endDay, (x) => comparableE1rm(x as any)),
    [results, startDay, endDay],
  );
  const fmtDay = (d: string) => {
    const x = parseLocalDate(d);
    return x ? format(x, "MMM d") : d;
  };
  // The three lifts in one row: each estimate now and how far it's moved (a compact
  // "+12 lb"; the day it's measured from is said once, under the card's title).
  const liftSummaries = COMP_LIFTS.map((lift) => liftSummary(strength.points, lift, startDay, endDay));
  const liftTriplet = liftSummaries.map((sm) => {
    const ch = changeWords(sm.trend, conv, displayUnit, fmtDay);
    const diff = sm.trend.kind === "unclear" ? null : Math.round(conv(sm.trend.last) - conv(sm.trend.first));
    return {
      lift: sm.lift,
      value: sm.latest ? Math.round(conv(sm.latest.e1rm)) : null,
      change: !sm.latest ? null : diff == null ? "Too few hard sets" : sm.trend.kind === "steady" ? "About the same" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${displayUnit}`,
      tone: ch.tone,
    };
  });
  const tripletSince = liftSummaries
    .map((sm) => (sm.trend.kind === "unclear" ? null : sm.trend.firstDate))
    .filter((d): d is string => !!d)
    .sort()[0];
  const showLiftTriplet = profile === "powerlifting" && liftTriplet.some((r) => r.value != null);
  const overviewOrder: Array<"strength" | "volume" | "consistency" | "recovery"> =
    profile === "physique"
      ? ["volume", "strength", "consistency", "recovery"]
      : profile === "powerlifting"
        ? ["strength", "consistency", "volume", "recovery"]
        : ["consistency", "strength", "volume", "recovery"];
  // the last 8 weeks of working sets (the last one this week)
  const spark = useMemo(() => {
    const byWeek = new Map(trainingLoad.load.weeks.map((w) => [w.key, w.sets]));
    const last = weekOf(endDay < todayISO ? endDay : todayISO);
    const out: number[] = [];
    for (let i = 7; i >= 0; i--) out.push(byWeek.get(new Date(Date.parse(`${last}T12:00:00Z`) - i * 7 * 86_400_000).toISOString().slice(0, 10)) ?? 0);
    return out;
  }, [trainingLoad.load.weeks, endDay, todayISO]);
  const checkouts = useCheckouts(clientId, filter.start, filter.end, view === "overview");
  const recovery = useMemo(() => (checkouts.data ? recoverySummary(checkouts.data) : null), [checkouts.data]);

  // The period on screen as a document (progress-report-pdf.ts): this page's training load and records,
  // plus weigh-ins and nutrition read for it; made on the tap and handed to the share sheet.
  const [reportBusy, setReportBusy] = useState(false);
  const downloadReport = () => {
    if (reportBusy) return;
    setReportBusy(true);
    const from = format(filter.start, "yyyy-MM-dd");
    const to = format(filter.end, "yyyy-MM-dd");
    void makeAndDeliverPdf("Progress report", async () => {
      const [{ buildProgressReport, progressReportFileName }, { loadProgressReportExtras }, logo] = await Promise.all([
        import("@/lib/analytics/progress-report-pdf"),
        import("@/lib/analytics/progress-report-data"),
        loadPdfLogo(),
      ]);
      const extra = await loadProgressReportExtras(clientId, displayUnit, from, to);
      const doc = buildProgressReport(
        {
          athlete: extra.athlete,
          audience: coach ? "coach" : "client",
          period: { label: filter.label, start: filter.start, end: filter.end },
          unit: displayUnit,
          load: trainingLoad.load,
          prs: prs as any[],
          bodyweight: extra.bodyweight,
          nutrition: extra.nutrition,
        },
        { logo },
      );
      return doc.toFile(progressReportFileName(extra.athlete, filter.label));
    }).finally(() => setReportBusy(false));
  };

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
          {/* The period on screen as a document (progress report PDF), handed to the share sheet. */}
          {(allResults as any[]).length > 0 && (
            <Button
              variant="outline"
              className="h-10 w-10 shrink-0 p-0"
              onClick={downloadReport}
              disabled={reportBusy || trainingLoad.planLoading}
              aria-label="Download progress report (PDF)"
              title="Progress report (PDF)"
              data-progress-report
            >
              <Download className="h-4 w-4" aria-hidden />
            </Button>
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
            <AnalyticsTabs view={view} onChange={changeView} />

            {view === "overview" && (
              <div className="space-y-3" data-analytics-view="overview" data-analytics-profile={profile}>
                {filteredResults.length === 0 && (
                  <Card className="border-dashed border-border/70 bg-card/60 p-4 text-center text-sm text-muted-foreground">
                    Nothing logged in this period yet.
                  </Card>
                )}
                {/* One answer per area, in the order that matters most for this athlete; a tap opens the area. */}
                <div className="grid gap-3 md:grid-cols-2">
                  {overviewOrder.map((area) => {
                    if (area === "strength") {
                      return (
                        <AreaCard
                          key={area}
                          area="strength"
                          title="Strength"
                          icon={<TrendingUp className="h-4 w-4" />}
                          onOpen={() => changeView("strength")}
                          value={showLiftTriplet ? undefined : liftsMoving.tracked ? `${liftsMoving.up} of ${liftsMoving.tracked}` : prs.length ? String(prs.length) : "—"}
                          sub={
                            showLiftTriplet
                              ? `Estimated max${tripletSince ? ` · change since ${fmtDay(tripletSince)}` : ""}${prs.length ? ` · ${prs.length} PR${prs.length === 1 ? "" : "s"}` : ""}`
                              : liftsMoving.tracked
                                ? `lifts getting stronger (estimated max, hard sets)${prs.length ? ` · ${prs.length} all-time PR${prs.length === 1 ? "" : "s"}` : ""}`
                                : prs.length
                                  ? `all-time PR${prs.length === 1 ? "" : "s"} in this period`
                                  : "Log RPE on your top sets to see strength trends"
                          }
                        >
                          {showLiftTriplet && <LiftTriplet rows={liftTriplet} />}
                        </AreaCard>
                      );
                    }
                    if (area === "volume") {
                      return (
                        <AreaCard
                          key={area}
                          area="volume"
                          title="Volume"
                          icon={<BarChart3 className="h-4 w-4" />}
                          onOpen={() => changeView("volume")}
                          value={t.sets ? String(t.setsPerWeek) : "0"}
                          unit={trainingLoad.load.perWeekBasis.partial ? "sets this week" : "sets a week"}
                          sub={t.sets ? perWeek.note : "No working sets in this period"}
                        >
                          {spark.some((v) => v > 0) && <MiniBars values={spark} label="Working sets, last 8 weeks" />}
                        </AreaCard>
                      );
                    }
                    if (area === "consistency") {
                      return (
                        <AreaCard
                          key={area}
                          area="consistency"
                          title="Consistency"
                          icon={<Check className="h-4 w-4" />}
                          onOpen={() => changeView("consistency")}
                          value={consistency.planned ? `${consistency.done} of ${consistency.planned}` : String(consistency.logged)}
                          sub={
                            trainingLoad.planLoading
                              ? "Reading the program…"
                              : consistency.planned
                                ? `planned workouts done · ${consistency.pct}%`
                                : `workout${consistency.logged === 1 ? "" : "s"} logged · no planned workouts here`
                          }
                        >
                          {!!consistency.planned && (
                            <ProgressBar value={consistency.done ?? 0} max={consistency.planned} label="Planned workouts done" />
                          )}
                        </AreaCard>
                      );
                    }
                    return (
                      <AreaCard
                        key={area}
                        area="recovery"
                        title="Recovery"
                        icon={<Moon className="h-4 w-4" />}
                        onOpen={() => changeView("recovery")}
                        value={recovery && recovery.checkouts ? (recovery.sleepAvg != null ? `${recovery.sleepAvg}h` : `${recovery.recoveryAvg ?? "—"}/5`) : "—"}
                        unit={recovery && recovery.checkouts && recovery.sleepAvg != null ? "sleep" : undefined}
                        sub={
                          recovery && recovery.checkouts
                            ? `${recovery.recoveryAvg != null ? `felt ${recovery.recoveryAvg}/5 recovered · ` : ""}${recovery.painSessions ? `pain ${recovery.painSessions}× · ` : ""}from ${recovery.checkouts} check-out${recovery.checkouts === 1 ? "" : "s"}`
                            : "No check-outs logged in this period"
                        }
                      />
                    );
                  })}
                </div>

                {loadInsights.length > 0 && (
                  <SectionErrorBoundary label="Coaching insights">
                    <TrainingLoadInsights insights={loadInsights.slice(0, 2)} coach={coach} onOpenVolume={() => changeView("volume")} />
                  </SectionErrorBoundary>
                )}
              </div>
            )}

            {view === "strength" && (
              <div className="space-y-6" data-analytics-view="strength">
                {/* anyone who isn't a powerlifter: how far each lift has moved, first */}
                {profile !== "powerlifting" && (
                  <section aria-label="Your lifts">
                    <SectionHeading
                      icon={<TrendingUp className="h-5 w-5" />}
                      title="Your lifts"
                      tip={
                        <InfoTip label="About your lifts" title="Your lifts" align="start">
                          Each lift's estimated max from hard sets (RPE 7+, 10 reps or fewer): the best of its first few
                          sessions in this period against the best of its last few. A lift needs 4+ hard sessions over 3+
                          weeks to show.
                        </InfoTip>
                      }
                    />
                    <LiftsMovingCard data={liftsMoving} unit={displayUnit} conv={conv} />
                  </section>
                )}
                {hasPowerlifting && (
                  <section aria-label="Competition lifts over time">
                    <SectionHeading icon={<TrendingUp className="h-5 w-5" />} title="Competition lifts" />
                    {strengthChart}
                  </section>
                )}

                {hasPowerlifting && competition.data && (
                  <SectionErrorBoundary label="Where you stand">
                    <section aria-label="Where you stand">
                      <SectionHeading
                        icon={<PieChart className="h-5 w-5" />}
                        title={coach ? "Where they stand" : "Where you stand"}
                        tip={
                          <InfoTip label="About these numbers" title="Four different numbers" align="start">
                            Est. now: the best estimate from a hard set in the last 6 weeks. Last meet: what was lifted on
                            the platform. 1RM on file: a max on the client's file, tested (with its day) or entered by the
                            coach. Training max: the number the program works % loads from, set by the coach. They're never
                            added together or swapped. Not tied to the period above.
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

                {hasPowerlifting && blockStrength.length >= 2 && (
                  <section aria-label="By block">
                    <SectionHeading
                      icon={<Calendar className="h-5 w-5" />}
                      title="By block"
                      tip={
                        <InfoTip label="About the block comparison" title="By block" align="start">
                          Each block's best estimated max from a hard set, by the block's own dates. Pick a phase to
                          compare a peak with a peak, never with a base block.
                        </InfoTip>
                      }
                    />
                    <BlockStrengthTable rows={blockStrength} unit={displayUnit} conv={conv} />
                  </section>
                )}

                <section aria-label="All-time PRs">
                  <SectionHeading
                    icon={<Trophy className="h-5 w-5" />}
                    title="Personal records"
                    action={prs.length > 0 ? viewAllPRsNode : undefined}
                    tip={
                      <InfoTip label="About personal records" title="Personal records" align="start">
                        Sets in this period whose estimated max beat every earlier set of that exercise on file (Epley:
                        weight × (1 + reps ÷ 30)). The first time you log an exercise doesn't count. The set is what you
                        lifted; the estimate is how it compares.
                      </InfoTip>
                    }
                  />
                  {prs.length === 0 ? (
                    <Card className="p-4 text-sm text-muted-foreground">No all-time PRs in this period.</Card>
                  ) : (
                    <>
                      <Card className="divide-y divide-border/60 p-0" data-pr-list>
                        {prs.slice(0, 8).map((p: any) => (
                          <div key={p.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-[13px]">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">{p.exercise_name}</div>
                              <div className="truncate text-[12px] text-muted-foreground">{format(new Date(p.date), "EEE, MMM d")}</div>
                            </div>
                            <div className="shrink-0 text-right font-semibold tabular-nums text-foreground">
                              {fmtLoad(conv(p.load))} × {p.reps}
                              {p.rpe ? <span className="font-normal text-muted-foreground"> @{p.rpe}</span> : null}
                            </div>
                          </div>
                        ))}
                      </Card>
                      {prs.length > 8 && viewAllPRsNode && <div className="mt-3 text-center">{viewAllPRsNode}</div>}
                    </>
                  )}
                </section>

                {hasPowerlifting && (competition.data?.meets.length ?? 0) > 0 && (
                  <section aria-label="Competition results">
                    <SectionHeading icon={<Trophy className="h-5 w-5" />} title="Competition results" />
                    <MeetsList meets={competition.data!.meets} unit={displayUnit} conv={conv} />
                  </section>
                )}

                <section aria-label="Lift Progress">
                  <SectionHeading
                    icon={<Dumbbell className="h-5 w-5" />}
                    title="Any exercise"
                    tip={
                      <InfoTip label="About lift progress" title="Any exercise" align="start">
                        One point per session: its best set. Est. max reads hard sets only (RPE 7+, 10 reps or fewer);
                        Top set is the heaviest weight; Volume is weight × reps. Touch the chart to see a session.
                        Variations are their own exercise, never the competition lift.
                      </InfoTip>
                    }
                  />
                  <LiftProgressCard history={history} displayUnit={displayUnit} conv={conv} onOpenSet={setSelectedDot} />
                </section>

                {coach && (
                  <MoreDetail label="Programming detail">
                    <SectionErrorBoundary label="Powerlifting exposure">
                      <PowerliftingExposureSection
                        clientId={clientId}
                        filter={filter}
                        results={results as any[]}
                        displayUnit={displayUnit}
                        blockId={activeBlockId}
                        admin={coach}
                        navigateToBuilderHref={`/admin/clients/${clientId}?tab=training`}
                      />
                    </SectionErrorBoundary>
                    <SectionErrorBoundary label="Predicted window">
                      <PredictedWindowCard clientId={clientId} currentBlockId={activeBlockId ?? resolvedCurrentBlockId} />
                    </SectionErrorBoundary>
                  </MoreDetail>
                )}
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
                    blockRows={blockVolume}
                    header={
                      <SectionHeading
                        icon={<BarChart3 className="h-5 w-5" />}
                        title="How much you train"
                        tip={
                          <InfoTip label="About volume" title="Volume" align="start">
                            Working sets, never warm-ups. A muscle gets a full set from exercises aimed at it and half a set
                            from ones that help. "How these are counted" under the charts has every definition.
                          </InfoTip>
                        }
                      />
                    }
                  />
                </SectionErrorBoundary>
                <MoreDetail>
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
                </MoreDetail>
              </div>
            )}

            {view === "consistency" && (
              <div className="space-y-6" data-analytics-view="consistency">
                <section aria-label="Consistency">
                  <SectionHeading
                    icon={<Check className="h-5 w-5" />}
                    title="Following the plan"
                    tip={
                      <InfoTip label="About consistency" title="Consistency" align="start">
                        Workouts and sets your program wrote for days that have passed, against what was logged. A day
                        still ahead is never missed; extra sets don't raise it.
                      </InfoTip>
                    }
                  />
                  <ConsistencySummary c={consistency} planLoading={trainingLoad.planLoading} planError={trainingLoad.planError} />
                </section>
                <section aria-label="Planned vs Actual">
                  <SectionHeading
                    icon={<Calendar className="h-5 w-5" />}
                    title="Recent workouts"
                    tip={
                      <InfoTip label="About recent workouts" title="Recent workouts" align="start">
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
                <MoreDetail label="When and how long you train">
                  <SectionErrorBoundary label="Training time">
                    <TrainingTimeCard
                      clientId={clientId}
                      rangeStart={filter.start}
                      rangeEnd={filter.end}
                      rangeLabel={filter.short}
                      nextMeetDate={nextMeetDate}
                      canOpenLog={canOpenLog}
                    />
                  </SectionErrorBoundary>
                </MoreDetail>
              </div>
            )}

            {view === "recovery" && (
              <div className="space-y-6" data-analytics-view="recovery" id="recovery">
                <section aria-label="Recovery">
                  <SectionHeading
                    icon={<Moon className="h-5 w-5" />}
                    title="What you logged"
                    tip={
                      <InfoTip label="About check-outs" title="What you logged" align="start">
                        From the quick check-out after a workout: sleep (logged as a range, 7–8h reads as 7.5h), how
                        recovered you felt and pain. Recorded, never estimated. Only workouts with a check-out count.
                      </InfoTip>
                    }
                  />
                  <SectionErrorBoundary label="Recovery">
                    <RecoveryTrendsCard clientId={clientId} start={filter.start} end={filter.end} />
                  </SectionErrorBoundary>
                </section>

                <section aria-label="Readiness">
                  <SectionHeading
                    icon={<Gauge className="h-5 w-5" />}
                    title="Readiness (estimate)"
                    tip={
                      <InfoTip label="About readiness" title="Readiness" align="start">
                        An estimate from your last check-out and recent training, not a measurement. It's a guide for how
                        to approach a session, never a reason to go heavier.
                      </InfoTip>
                    }
                  />
                  <SectionErrorBoundary label="Readiness">
                    <RecoveryPreviewCard clientId={clientId} analyticsTo="/portal/workouts/analytics" />
                  </SectionErrorBoundary>
                </section>

                <SectionErrorBoundary label="Recovery patterns">
                  <RecoveryPatternsCard clientId={clientId} rangeStart={filter.start} rangeEnd={filter.end} />
                </SectionErrorBoundary>

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
                  <CardioAnalyticsSection clientId={clientId} rangeStart={filter.start} rangeEnd={filter.end} rangeLabel={filter.short} />
                </SectionErrorBoundary>

                <SectionErrorBoundary label="Running">
                  <RunningAnalyticsSection clientId={clientId} rangeStart={filter.start} rangeEnd={filter.end} rangeLabel={filter.short} />
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
 * The page's areas as one row: Overview (one answer per area), Strength,
 * Volume, Consistency and Recovery. Underlined like Crew's tabs; on a narrow
 * phone it scrolls sideways and keeps the area you're on in view.
 */
function AnalyticsTabs({ view, onChange }: { view: AnalyticsView; onChange: (v: AnalyticsView) => void }) {
  const fade = useScrollFade();
  // keep the area you're on in view (sideways only: never scrolls the page)
  useEffect(() => {
    const row = fade.ref.current;
    const el = row?.querySelector<HTMLElement>(`[data-analytics-tab="${view}"]`);
    if (!row || !el) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = left - 8;
    else if (left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + el.offsetWidth - row.clientWidth + 8;
  }, [view, fade.ref]);
  return (
    <div className="relative -mx-4 border-b border-border px-4" data-analytics-tabs-wrap>
      <div
        ref={fade.ref}
        role="tablist"
        aria-label="Analytics sections"
        style={fade.style}
        className="flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              "relative h-11 shrink-0 text-[15px] font-medium transition-colors",
              view === v ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-analytics-tab={v}
          >
            {label}
            {view === v && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground" />}
          </button>
        ))}
      </div>
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