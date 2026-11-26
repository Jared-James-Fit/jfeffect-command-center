import { Link, useNavigate } from "@tanstack/react-router";
import { ErrorState, OfflineState, SlowNote } from "@/components/loading";
import { queryView } from "@/lib/loading/load-state";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Dumbbell } from "lucide-react";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { loadPdfLogo, makeAndDeliverPdf } from "@/lib/pdf/deliver";
import { getClientResults, buildExerciseHistory } from "@/lib/pl-programs";
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
import { GraphDotDetail, type GraphDotPoint } from "@/components/analytics/graph-dot-detail";
import { LiftProgressCard } from "@/components/analytics/lift-progress-card";
import { BodyweightTrendCard } from "@/components/analytics/bodyweight-trend-card";
import { CardioAnalyticsSection } from "@/components/analytics/cardio-analytics-section";
import { RunningAnalyticsSection } from "@/components/analytics/running-analytics-section";
import { RecoveryTrendsCard } from "@/components/analytics/recovery-trends-card";
import { PredictedWindowCard } from "@/components/analytics/predicted-window-card";
import { TrainingTimeCard } from "@/components/analytics/training-time-card";
import { getClientAnalyticsSettings } from "@/lib/analytics/settings";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { TrainingLoadSection } from "@/components/analytics/training-load-section";
import { LiftsMovingCard, MoreDetail } from "@/components/analytics/analytics-area-cards";
import { consistencyOf, liftsTrending } from "@/lib/analytics/analytics-areas";
import { comparableE1rm } from "@/lib/analytics/strength-read";
import { useCheckouts } from "@/lib/analytics/recovery-trends.queries";
import { useAnalyticsUnit } from "@/lib/analytics/use-analytics-unit";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  compLiftOfResult,
  type CompLift,
} from "@/lib/analytics/competition-strength";
import { useTrainingLoad, resultsToLoadSets } from "@/lib/analytics/training-load.queries";
import { useCompetitionData } from "@/lib/analytics/competition-strength.queries";
import { analyticsProfile, compSessionsSince } from "@/lib/analytics/analytics-profile";
import { liftStrengths, liftNow, mainLift } from "@/lib/analytics/lift-strength";
import { envelopeTrend, type EnvelopeTrend } from "@/lib/analytics/strength-estimate";
import {
  buildCalendar,
  strengthChanges,
  type CalendarMetric,
} from "@/lib/analytics/performance-calendar";
import {
  lifetimeTotals,
  personalRecords,
  recordsByExercise,
  isHeadlineRecord,
} from "@/lib/analytics/records";
import { buildWorkload, splitShift } from "@/lib/analytics/sbd-workload";
import { clientBodyweightQueryKey, loadClientBodyweight } from "@/lib/client-bodyweight";
import { buildMuscleRead, muscleWindowChanges, musclesNamed } from "@/lib/analytics/muscle-read";
import { recoveryPatterns } from "@/lib/analytics/recovery-intel";
import { pickObservation } from "@/lib/analytics/performance-observation";
import { blockRows } from "@/lib/analytics/block-comparison";
import { inferBlockType } from "@/lib/block-types";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { cn } from "@/lib/utils";
import { PerformanceCalendar, type DayMeta } from "@/components/analytics/performance-calendar";
import { SbdDonut } from "@/components/analytics/sbd-donut";
import { StrengthTrendChart } from "@/components/analytics/strength-trend-chart";
import { phasesFromBlocks } from "@/lib/strength-intel/phases";
import { SbdWorkloadChart } from "@/components/analytics/sbd-workload-chart";
import { BlockComparisonCard } from "@/components/analytics/block-comparison-card";
import { RecordsView } from "@/components/analytics/records-view";
import { MuscleMap, useSupportCredit } from "@/components/analytics/muscle-map";
import {
  CleoObservationCard,
  ConsistencyBlock,
  KpiStrip,
  RecoveryPatternList,
  type Kpi,
} from "@/components/analytics/overview-pieces";
import { Change, SectionTitle, LB_PER_KG } from "@/components/analytics/viz";

export type Unit = "lb" | "kg";

export interface ClientAnalyticsDashboardProps {
  clientId: string;
  preferredUnit?: Unit;
  /** Optional initial filter (used by portal for URL deep-links). */
  initialFilter?: AnalyticsFilter | null;
  /** Called whenever the filter changes. Portal syncs to URL. */
  onFilterChange?: (filter: AnalyticsFilter) => void;
  /** Show the LB/KG toggle above the filter bar. Defaults to true. */
  showUnitToggle?: boolean;
  /** Optional node rendered as the "View All" PRs affordance (kept for callers; Records has them all). */
  viewAllPRsNode?: ReactNode;
  /** Optional node rendered above the filter bar (e.g. "Back to workouts"). */
  headerLeadingNode?: ReactNode;
  /** Whether a session's detail can open the underlying workout log (the coach). */
  canOpenLog?: boolean;
  /** Leave out the bodyweight trend card (the coach's Progress tab has its own bodyweight panel above). */
  hideBodyweight?: boolean;
  className?: string;
  /** The coach's view: programming detail (intensity spread, coach-only insights). */
  coach?: boolean;
  /** Which section opens first (a deep link), and a callback to keep it in the address. */
  initialView?: AnalyticsView;
  onViewChange?: (view: AnalyticsView) => void;
}

/**
 * Overview · Strength · Training · Records. Old addresses (volume,
 * consistency, recovery) open Training, where those now live.
 */
export type AnalyticsView = "overview" | "strength" | "training" | "records";
export const ANALYTICS_VIEWS: Array<[AnalyticsView, string]> = [
  ["overview", "Overview"],
  ["strength", "Strength"],
  ["training", "Training"],
  ["records", "Records"],
];
const LEGACY_VIEW: Record<string, AnalyticsView> = {
  volume: "training",
  consistency: "training",
  recovery: "training",
  calendar: "overview",
  lifetime: "records",
};
export function viewFromSearch(v: string | null | undefined): AnalyticsView | undefined {
  if (!v) return undefined;
  if (ANALYTICS_VIEWS.some(([k]) => k === v)) return v as AnalyticsView;
  return LEGACY_VIEW[v];
}

const DAY = 86_400_000;
const isoDay = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Training analytics: identical numbers for the athlete and the coach (the
 * coach adds programming detail). Every module reads one shared set of reads
 * (lib/analytics: lift-strength, performance-calendar, records, sbd-workload,
 * sbd-composition, muscle-read, recovery-intel, performance-observation), so
 * nothing on the page can disagree with anything else.
 */
export function ClientAnalyticsDashboard({
  clientId,
  preferredUnit = "lb",
  initialFilter,
  onFilterChange,
  showUnitToggle = true,
  headerLeadingNode,
  canOpenLog = false,
  hideBodyweight = false,
  className,
  coach = false,
  initialView,
  onViewChange,
}: ClientAnalyticsDashboardProps) {
  const navigate = useNavigate();
  const cleoOn = useCleoAccess();
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
  // a block's coach-picked type, where the database has it (never blocks the page)
  const { data: blockTypes } = useQuery({
    queryKey: ["analytics-block-types", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pl_blocks")
        .select("id, block_type")
        .eq("client_id", clientId);
      if (error) return new Map<string, string>();
      return new Map<string, string>(
        ((data ?? []) as any[]).filter((r) => r.block_type).map((r) => [r.id, r.block_type]),
      );
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

  const [view, setView] = useState<AnalyticsView>(() => {
    if (typeof window !== "undefined" && window.location.hash === "#recovery") return "training";
    return initialView ?? "overview";
  });
  const changeView = (v: AnalyticsView) => {
    setView(v);
    onViewChange?.(v);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const today = isoDay(new Date());
  const nextMeetDate = useMemo(
    () =>
      clientBlocks
        .map((b) => b.pl_preps?.event_date ?? null)
        .filter((d): d is string => !!d && d >= today)
        .sort()[0] ?? null,
    [clientBlocks, today],
  );
  const activeBlockId =
    filter.preset === "current_block" ||
    filter.preset === "previous_block" ||
    filter.preset === "exact_block"
      ? ((filter as any).blockId as string)
      : null;

  // Every logged set, read once; a period only filters it (records and trends read the whole history).
  const resultsQ = useQuery({
    queryKey: ["pl-results", clientId, null],
    enabled: !!clientId,
    // The whole history (up to tens of thousands of sets): read once a visit, not on every
    // remount, while a set logged since is still picked up on the next open.
    staleTime: 5 * 60_000,
    queryFn: () => getClientResults(clientId),
  });
  const allResults = useMemo(() => resultsQ.data ?? [], [resultsQ.data]);
  // A failed or offline read is said, never the new-athlete preview over years of training
  const resultsState = queryView(resultsQ as any).kind;
  const isLoading = resultsState === "loading";
  const { data: blockDayIds } = useQuery({
    queryKey: ["analytics-block-days", activeBlockId],
    enabled: !!activeBlockId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: weeks } = await supabase
        .from("pl_weeks")
        .select("id")
        .eq("block_id", activeBlockId!);
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
    queryKey: ["analytics-goals-v2", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("client_goals_setup")
        .select("main_goal, main_goal_other, goal_target, training_styles")
        .eq("client_id", clientId)
        .maybeSingle();
      return (data ?? null) as {
        main_goal: string | null;
        main_goal_other: string | null;
        goal_target: string | null;
        training_styles: string[] | null;
      } | null;
    },
  });
  const { data: athlete } = useQuery({
    queryKey: ["analytics-athlete", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clients")
        .select("full_name, first_name, service_tier")
        .eq("id", clientId)
        .maybeSingle();
      return (data ?? null) as {
        full_name: string | null;
        first_name: string | null;
        service_tier: string | null;
      } | null;
    },
  });
  const coached = athlete?.service_tier !== "self_serve";

  // one choice for every analytics screen, remembered on this phone (use-analytics-unit.ts)
  const [displayUnit, setDisplayUnit] = useAnalyticsUnit(preferredUnit);
  const conv = useCallback(
    (lb: number) => (displayUnit === "kg" ? (Number(lb) || 0) / LB_PER_KG : Number(lb) || 0),
    [displayUnit],
  );
  const [selectedDot, setSelectedDot] = useState<GraphDotPoint | null>(null);
  const [muscleExercise, setMuscleExercise] = useState<string | null>(null);


  const startDay = isoDay(filter.start);
  const endDay = isoDay(filter.end);
  const startMs = filter.start.getTime();
  const endMs = filter.end.getTime() + 86_399_999;
  const filteredResults = useMemo(
    () =>
      (results as any[]).filter((r: any) => {
        const t = r.date ? new Date(r.date).getTime() : NaN;
        return t >= startMs && t <= endMs;
      }),
    [results, startMs, endMs],
  );
  const history = useMemo(() => buildExerciseHistory(filteredResults as any), [filteredResults]);
  const comparisonHistory=useMemo(()=>view==="strength"||muscleExercise?buildExerciseHistory(allResults as any):[],[allResults,view,muscleExercise]);

  const trainingLoad = useTrainingLoad({
    clientId,
    results: results as any[],
    start: filter.start,
    end: filter.end,
    blockId: activeBlockId,
  });
  const consistency = useMemo(() => consistencyOf(trainingLoad.load), [trainingLoad.load]);

  // ── the shared reads ────────────────────────────────────────────────
  const compSessions12w = useMemo(
    () => compSessionsSince(allResults as any[], Date.now() - 84 * DAY),
    [allResults],
  );
  const anyComp = useMemo(
    () => (allResults as any[]).some((r) => compLiftOfResult(r)),
    [allResults],
  );
  const hasPowerlifting = compSessions12w > 0 || anyComp;
  const profile = analyticsProfile({
    mainGoal: goals?.main_goal,
    styles: goals?.training_styles,
    compSessions12w,
    hasMeet: !!nextMeetDate,
  });
  const competition = useCompetitionData(clientId, hasPowerlifting || profile === "powerlifting" || view === "records");
  const meets = useMemo(() => competition.data?.meets ?? [], [competition.data]);
  // the training phases the strength read judges lower sessions in (a volume block's
  // tired sets aren't lost strength): the athlete's blocks, by their type or their words
  const strengthPhases = useMemo(
    () =>
      phasesFromBlocks(
        clientBlocks.map((b) => ({
          start_date: b.start_date,
          end_date: b.end_date,
          name: b.name,
          phase: b.training_focus,
          block_type: blockTypes?.get(b.id) ?? null,
        })),
      ),
    [clientBlocks, blockTypes],
  );
  const strength = useMemo(
    () => liftStrengths(allResults as any[], meets, today, { phases: strengthPhases }),
    [allResults, meets, today, strengthPhases],
  );
  const { records } = useMemo(
    () => personalRecords(allResults as any[], meets),
    [allResults, meets],
  );
  const lifetime = useMemo(
    () => lifetimeTotals(allResults as any[], records),
    [allResults, records],
  );
  const byExercise = useMemo(
    () => recordsByExercise(records, allResults as any[]),
    [records, allResults],
  );
  const recordsInPeriod = useMemo(
    () => records.filter((r) => r.day >= startDay && r.day <= endDay),
    [records, startDay, endDay],
  );
  const changes = useMemo(() => strengthChanges(allResults as any[]), [allResults]);
  const [calMetric, setCalMetric] = useState<CalendarMetric>("activity");
  const firstLog = firstDataDate ? isoDay(firstDataDate) : null;
  const calendarDays = useMemo(
    () =>
      buildCalendar({
        results: results as any[],
        plan: trainingLoad.plan.map((p) => ({
          day: p.day,
          dayId: p.dayId,
          sets: p.sets,
          isTime: p.isTime,
        })),
        prs: records.map((r) => ({
          date: `${r.day}T12:00:00`,
          exercise_name: r.exercise,
          load: r.load,
          reps: r.reps,
        })),
        start: startDay,
        end: endDay,
        today,
        metric: calMetric,
        firstLog,
        strength: changes,
      }),
    [results, trainingLoad.plan, records, startDay, endDay, today, calMetric, firstLog, changes],
  );
  const allLoadSets = useMemo(() => resultsToLoadSets(allResults as any[]), [allResults]);
  const periodLoadSets = useMemo(
    () => resultsToLoadSets(filteredResults as any[]),
    [filteredResults],
  );
  const liftTrendsPeriod = useMemo(() => {
    const out: Partial<Record<CompLift, EnvelopeTrend>> = {};
    for (const l of COMP_LIFTS) out[l] = envelopeTrend(strength[l].envelope, startDay, endDay);
    return out;
  }, [strength, startDay, endDay]);
  const named = useMemo(
    () => musclesNamed(`${goals?.goal_target ?? ""} ${goals?.main_goal_other ?? ""}`),
    [goals],
  );
  const [supportCredit, setSupportCredit] = useSupportCredit();
  const muscleRead = useMemo(
    () =>
      buildMuscleRead({
        muscles: trainingLoad.load.muscles,
        sets: periodLoadSets,
        history: allLoadSets,
        weeks: trainingLoad.load.perWeekBasis.weeks,
        partial: trainingLoad.load.perWeekBasis.partial,
        profile,
        named,
        liftTrends: liftTrendsPeriod,
        start: startDay,
        end: endDay,
        today,
        coached,
        supportCredit,
        plan: trainingLoad.plan,
      }),
    [
      trainingLoad.plan,
      trainingLoad.load,
      periodLoadSets,
      allLoadSets,
      profile,
      named,
      liftTrendsPeriod,
      startDay,
      endDay,
      today,
      coached,
      supportCredit,
    ],
  );
  const blocksForCompare = useMemo(
    () =>
      clientBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        start_date: b.start_date,
        end_date: b.end_date,
        training_focus: b.training_focus,
        block_type: blockTypes?.get(b.id) ?? null,
      })),
    [clientBlocks, blockTypes],
  );
  const blocks = useMemo(
    () =>
      blockRows({
        blocks: blocksForCompare,
        strength,
        weeks: trainingLoad.load.weeks,
        sets: allLoadSets,
        today,
      }),
    [blocksForCompare, strength, trainingLoad.load.weeks, allLoadSets, today],
  );

  // recovery patterns read up to half a year of the athlete's own check-outs
  const patternStart = useMemo(
    () => new Date(Math.min(filter.start.getTime(), Date.now() - 182 * DAY)),
    [filter.start],
  );
  const checkouts = useCheckouts(
    clientId,
    patternStart,
    filter.end,
    view === "overview" || view === "training",
  );
  const patternDays = useMemo(
    () =>
      buildCalendar({
        results: allResults as any[],
        plan: [],
        prs: [],
        start: isoDay(patternStart),
        end: endDay,
        today,
        metric: "activity",
        firstLog,
        strength: changes,
      }),
    [allResults, patternStart, endDay, today, firstLog, changes],
  );
  const ratedCompSets = useMemo(
    () =>
      (allResults as any[])
        .map((r) => {
          const lift = compLiftOfResult(r);
          const rpe = r.rpe != null && r.rpe !== "" ? Number(r.rpe) : null;
          return lift && rpe && r.counts_load !== false && Number(r.load) > 0
            ? {
                day: format(new Date(r.date), "yyyy-MM-dd"),
                lift,
                load: Number(r.load),
                reps: Number(r.reps) || 0,
                rpe,
              }
            : null;
        })
        .filter(
          (x): x is { day: string; lift: CompLift; load: number; reps: number; rpe: number } => !!x,
        ),
    [allResults],
  );
  const patterns = useMemo(
    () =>
      recoveryPatterns({
        checkouts: checkouts.data ?? [],
        days: patternDays,
        strength,
        ratedSets: ratedCompSets,
        today,
      }),
    [checkouts.data, patternDays, strength, ratedCompSets, today],
  );

  // Cleo's one observation: the last six weeks, whatever period is on screen
  const observation = useMemo(() => {
    const sixAgo = isoDay(new Date(Date.now() - 42 * DAY));
    const lastSunday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 7) % 7 || 7));
      return isoDay(d);
    })();
    const shiftStart = isoDay(new Date(Date.parse(`${lastSunday}T12:00:00`) - 41 * DAY));
    const wk = (metric: "sets" | "avgRpe") =>
      buildWorkload({
        sets: allLoadSets,
        metric,
        scope: "both",
        grain: "week",
        start: shiftStart,
        end: lastSunday,
        today,
      });
    const liftTrends: Partial<Record<CompLift, EnvelopeTrend>> = {};
    for (const l of COMP_LIFTS) liftTrends[l] = liftNow(strength[l], sixAgo, today).trend;
    const cur = blocks.find((b) => b.current);
    const currentWeekPhase =
      trainingLoad.plan.find(
        (p) => p.day && p.day <= today && p.day >= isoDay(new Date(Date.now() - 6 * DAY)),
      )?.weekPhase ?? null;
    const phase =
      (
        cur?.typeKey ??
        inferBlockType({ phase: currentWeekPhase }) ??
        currentWeekPhase ??
        null
      )?.toLowerCase() ?? null;
    const recent = records
      .filter((r) => r.day >= isoDay(new Date(Date.now() - 14 * DAY)))
      .sort(
        (a, b) =>
          Number(isHeadlineRecord(b)) - Number(isHeadlineRecord(a)) || b.day.localeCompare(a.day),
      )
      .map((r) => ({ exercise: r.exercise, load: r.load, reps: r.reps, day: r.day }));
    return pickObservation({
      coached,
      phase,
      unit: displayUnit,
      conv,
      liftTrends,
      setShifts: splitShift(wk("sets")),
      rpeShifts: splitShift(wk("avgRpe")),
      patterns,
      recentRecords: recent,
      consistency: {
        recentPct: consistency.recent?.pct ?? null,
        beforePct: consistency.before?.pct ?? null,
        planned: consistency.planned ?? 0,
      },
      mainLift: mainLift(strength, sixAgo, today),
      insight:
        trainingLoad.load.insights.find((i) => i.audience === "both" && i.actionNeeded) ?? null,
      profile,
      muscles: muscleWindowChanges({
        sets: allLoadSets,
        start: sixAgo,
        end: today,
        profile,
        named,
        supportCredit,
      }),
    });
  }, [
    profile,
    named,
    supportCredit,
    allLoadSets,
    strength,
    today,
    blocks,
    trainingLoad.plan,
    trainingLoad.load.insights,
    records,
    coached,
    displayUnit,
    conv,
    patterns,
    consistency,
  ]);

  // the workouts' names for the calendar's day detail
  const periodDayIds = useMemo(
    () => [...new Set(calendarDays.flatMap((d) => d.dayIds))],
    [calendarDays],
  );
  const { data: dayMeta } = useQuery({
    queryKey: [
      "analytics-day-meta",
      clientId,
      periodDayIds.length,
      periodDayIds[0] ?? "",
      periodDayIds[periodDayIds.length - 1] ?? "",
    ],
    enabled: periodDayIds.length > 0 && view === "overview",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out = new Map<string, DayMeta>();
      const blockName = new Map(
        clientBlocks.map((b) => [b.id, b.name.replace(/^\s*block\s*\d+\s*[—–\-:·]\s*/i, "")]),
      );
      for (let i = 0; i < periodDayIds.length; i += 150) {
        const ids = periodDayIds.slice(i, i + 150);
        const { data: days } = await supabase
          .from("pl_days")
          .select("id, title, subtitle, week_id")
          .in("id", ids);
        const weekIds = [...new Set((days ?? []).map((d: any) => d.week_id))];
        const { data: weeks } = weekIds.length
          ? await supabase.from("pl_weeks").select("id, block_id, week_index").in("id", weekIds)
          : { data: [] as any[] };
        const wk = new Map((weeks ?? []).map((w: any) => [w.id, w]));
        for (const d of (days ?? []) as any[]) {
          const w: any = wk.get(d.week_id);
          out.set(d.id, {
            title: d.subtitle || d.title || null,
            block: w ? (blockName.get(w.block_id) ?? null) : null,
            week: w?.week_index != null ? Number(w.week_index) + 1 : null,
          });
        }
      }
      return out;
    },
  });

  const bodyweightHistory = useQuery({
    queryKey: clientBodyweightQueryKey(clientId),
    queryFn: () => loadClientBodyweight(clientId),
    enabled: !!clientId && !hideBodyweight && (view === "overview" || view === "records" || view === "training" || view === "strength"),
    staleTime: 60_000,
  });

  // ── key numbers for this athlete ────────────────────────────────────
  const fmtDay = (d: string) => format(new Date(`${d}T12:00:00`), "MMM d");
  const liftsMoving = useMemo(
    () => liftsTrending(results as any[], startDay, endDay, (x) => comparableE1rm(x as any)),
    [results, startDay, endDay],
  );
  const main =
    mainLift(strength, startDay, endDay) ??
    (profile === "powerlifting"
      ? ((["squat", "bench", "deadlift"] as CompLift[]).find((l) => strength[l].sessions.length) ??
        null)
      : null);
  const kpis: Kpi[] = [];
  if (profile === "powerlifting" && main) {
    const n = liftNow(strength[main], startDay, endDay);
    const t = n.trend;
    kpis.push({
      key: "lift",
      label: `${COMP_LIFT_LABEL[main]} strength`,
      value: n.now ? (
        <>
          {Math.round(conv(n.now.value))}
          <span className="ml-0.5 text-[13px] font-medium text-muted-foreground">{displayUnit}</span>
        </>
      ) : (
        "—"
      ),
      sub:
        t.kind === "unclear" ? (
          t.reason === "held" ? (
            "Estimated max · no hard sets lately"
          ) : (
            "Estimated max · too early to tell"
          )
        ) : (
          <>
            Estimated max,{" "}
            <span className={t.kind === "up" ? "text-success" : undefined}>
              {t.kind === "up" ? "up" : t.kind === "down" ? "down" : "steady"}
              {t.kind !== "steady" ? ` ${Math.abs(Math.round(t.pct * 10) / 10)}%` : ""}
            </span>{" "}
            since {fmtDay(t.from.day)}
          </>
        ),
      onOpen: () => changeView("strength"),
    });
  } else if (liftsMoving.tracked) {
    kpis.push({
      key: "moving",
      label: "Lifts improving",
      value: `${liftsMoving.up} of ${liftsMoving.tracked}`,
      sub: "Based on your hardest sets",
      onOpen: () => changeView("strength"),
    });
  }
  kpis.push({
    key: "consistency",
    label: consistency.planned ? "Workouts done" : "Workouts",
    value: consistency.planned ? `${consistency.pct}%` : String(consistency.logged),
    ring: consistency.planned ? consistency.pct : undefined,
    sub: consistency.planned
      ? `${consistency.done} of ${consistency.planned} planned`
      : "logged this period",
    onOpen: () => changeView("training"),
  });
  if (profile === "physique" && kpis.length < 3) {
    const t = trainingLoad.load.totals;
    kpis.push({
      key: "sets",
      label: trainingLoad.load.perWeekBasis.partial ? "Sets this week" : "Sets a week",
      value: String(t.setsPerWeek),
      sub: "Work sets, not warm-ups",
      onOpen: () => changeView("training"),
    });
  }
  kpis.push({
    key: "records",
    label: "New records",
    value: String(recordsInPeriod.length),
    sub: (() => {
      const main = recordsInPeriod.filter(isHeadlineRecord).length;
      return recordsInPeriod.length
        ? main
          ? `${main} on squat, bench or deadlift`
          : "On other exercises"
        : "None this period";
    })(),
    onOpen: () => changeView("records"),
  });

  // The period as a PDF (progress-report-pdf.ts), made on the tap.
  const [reportBusy, setReportBusy] = useState(false);
  const downloadReport = () => {
    if (reportBusy) return;
    setReportBusy(true);
    void makeAndDeliverPdf("Progress report", async () => {
      const [{ buildProgressReport, progressReportFileName }, { loadProgressReportExtras }, logo] =
        await Promise.all([
          import("@/lib/analytics/progress-report-pdf"),
          import("@/lib/analytics/progress-report-data"),
          loadPdfLogo(),
        ]);
      const extra = await loadProgressReportExtras(clientId, displayUnit, startDay, endDay);
      const doc = buildProgressReport(
        {
          athlete: extra.athlete,
          audience: coach ? "coach" : "client",
          period: { label: filter.label, start: filter.start, end: filter.end },
          unit: displayUnit,
          load: trainingLoad.load,
          prs: recordsInPeriod.map((r) => ({
            exercise_name: r.exercise,
            date: `${r.day}T12:00:00`,
            load: r.load,
            reps: r.reps,
            rpe: r.rpe,
          })) as any[],
          bodyweight: extra.bodyweight,
          nutrition: extra.nutrition,
        },
        { logo },
      );
      return doc.toFile(progressReportFileName(extra.athlete, filter.label));
    }).finally(() => setReportBusy(false));
  };

  const openWorkout = (dayId: string) => {
    if (coach) void navigate({ to: "/admin/clients/$id", params: { id: clientId }, search: { tab: "training" } as any });
    else void navigate({ to: "/portal/workouts/$dayId", params: { dayId } });
  };
  const widen = () => handleFilterChange(lifetimeFilter(clientBlocks, firstDataDate));
  const hasSbdInPeriod = periodLoadSets.some(
    (s) =>
      s.isCompetitionLift ||
      ["squat", "bench", "deadlift"].includes(
        String(s.rowFamily ?? s.competitionLiftType ?? "").toLowerCase(),
      ),
  );

  return (
    <>
      <div className={cn("mx-auto max-w-5xl space-y-4", className)}>
        {headerLeadingNode}
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
              <ToggleGroupItem
                value="lb"
                className="h-8 px-2.5 text-xs font-semibold data-[state=on]:bg-foreground data-[state=on]:text-background"
              >
                lb
              </ToggleGroupItem>
              <ToggleGroupItem
                value="kg"
                className="h-8 px-2.5 text-xs font-semibold data-[state=on]:bg-foreground data-[state=on]:text-background"
              >
                kg
              </ToggleGroupItem>
            </ToggleGroup>
          )}
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
          selectedBlockId={activeBlockId}
          resolvedCurrentBlockId={resolvedCurrentBlockId}
          isLoading={blocksLoading}
          isError={blocksError}
          onRetry={() => {
            void refetchBlocks();
          }}
          onSelect={(b) => handleFilterChange(exactBlockFilter(b, clientBlocks))}
        />

        {scopeLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading training data">
            <div className="jf-load-reveal space-y-3">
              <div className="jf-skeleton h-11 rounded-lg bg-muted/50" />
              <div className="jf-skeleton h-28 rounded-2xl bg-muted/40" />
              <div className="jf-skeleton h-64 rounded-2xl bg-muted/40" />
            </div>
            <SlowNote active onRetry={() => resultsQ.refetch()} what="training data" />
          </div>
        ) : resultsState === "offline" ? (
          <OfflineState what="training data" />
        ) : resultsState === "error" ? (
          <ErrorState error={resultsQ.error} what="training data" onRetry={() => resultsQ.refetch()} retrying={resultsQ.isFetching} />
        ) : (allResults as any[]).length === 0 && !meets.length && view !== "records" ? (
          <AnalyticsEmptyPreview />
        ) : (
          <>
            <AnalyticsTabs view={view} onChange={changeView} />

            {view === "overview" && (
              <div
                className="space-y-6"
                data-analytics-view="overview"
                data-analytics-profile={profile}
              >
                <div
                  className={cn(
                    "grid gap-6",
                    profile === "powerlifting" &&
                      "lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]",
                  )}
                >
                  {profile === "powerlifting" && (
                    <Card className="p-4" data-overview-total>
                      <SectionTitle
                        title="Performance"
                        info="Current strength projections, official competition totals and gym records are separate views."
                      />
                      <SectionErrorBoundary label="Total">
                        <SbdDonut
                          strength={strength}
                          meets={meets}
                          results={allResults as any[]}
                          bodyweights={hideBodyweight ? [] : bodyweightHistory.data?.entries ?? []}
                          hideBodyweight={hideBodyweight}
                          periods={blocks.map(b=>({id:"block:"+b.id,name:b.name,start:b.start,end:b.end<today?b.end:today})).filter(b=>!!b.start&&!!b.end&&b.start<=b.end)}
                          sex={competition.data?.sex ?? null}
                          today={today}
                          unit={displayUnit}
                          onRecords={() => changeView("records")}
                        />
                      </SectionErrorBoundary>
                    </Card>
                  )}
                  <MoreDetail label="Training calendar">
                    <SectionTitle
                      title="Training calendar"
                      sub="Every day you trained. Tap a day to see it."
                    />
                    <SectionErrorBoundary label="Calendar">
                      <PerformanceCalendar
                        days={calendarDays}
                        metric={calMetric}
                        onMetric={setCalMetric}
                        today={today}
                        unit={displayUnit}
                        dayMeta={dayMeta}
                        onOpenWorkout={openWorkout}
                      />
                    </SectionErrorBoundary>
                  </MoreDetail>
                </div>
                <KpiStrip items={kpis.filter((k) => profile !== "powerlifting" || k.key !== "lift").slice(0, 3)} />
                {observation && (
                  <MoreDetail label="Cleo’s insight"><SectionErrorBoundary label="Observation">
                    <CleoObservationCard
                      o={observation}
                      askCleo={coach && cleoOn}
                      athleteName={athlete?.first_name ?? athlete?.full_name ?? null}
                    />
                  </SectionErrorBoundary></MoreDetail>
                )}

                {profile === "physique" && muscleRead.rows.some((r) => r.perWeek > 0) && (
                  <section aria-label="Your most trained muscles">
                    <SectionTitle
                      title="Your most trained muscles"
                      sub="Sets a week for each muscle"
                      right={
                        <button
                          type="button"
                          onClick={() => changeView("training")}
                          className="min-h-10 text-[13px] font-medium text-foreground"
                        >
                          See all muscles
                        </button>
                      }
                    />
                    <ul className="space-y-1.5">
                      {[...muscleRead.rows]
                        .sort((a, b) => b.perWeek - a.perWeek)
                        .slice(0, 5)
                        .map((r, _i, top) => (
                          <li key={r.muscle} className="flex items-center gap-3 text-[14px]">
                            <span className="w-24 shrink-0 truncate">{r.muscle}</span>
                            <span className="relative h-2 flex-1 rounded-full bg-muted/60">
                              <span
                                className="absolute inset-y-0 left-0 rounded-full bg-[var(--chart-4)]"
                                style={{ width: `${(r.perWeek / Math.max(0.1, top[0].perWeek)) * 100}%` }}
                              />
                            </span>
                            <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
                              {r.perWeek} a week
                            </span>
                          </li>
                        ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {view === "strength" && (
              <div className="space-y-6" data-analytics-view="strength">

                <Card className="p-4">
                  <SectionTitle
                    title="Exercise progress"
                    sub="Pick an exercise to see its progress. Each dot is your best set that day."
                  />
                  <SectionErrorBoundary label="Exercise progress">
                    <LiftProgressCard
                      history={history}
                      comparisonHistory={comparisonHistory}
                      periods={blocks.map(b=>({id:b.id,name:b.name,start:b.start,end:b.end<today?b.end:today}))}
                      displayUnit={displayUnit}
                      conv={conv}
                      onOpenSet={setSelectedDot}
                      compact
                    />
                  </SectionErrorBoundary>
                </Card>
                {hasPowerlifting && (
                  <MoreDetail label="Competition lift trends">
                    <SectionTitle
                      title="Squat, bench and deadlift strength"
                      sub="Your estimated max for each lift over time"
                      info={
                        <>
                          <p>
                            Your estimated max is the most you could likely lift for one rep,
                            worked out from your sets: the weight, the reps and how hard they felt
                            (RPE).
                          </p>
                          <p>
                            Each dot is one workout. The line is your training-day strength: hard
                            sets move it, lighter sets can only nudge it up, and a tired week or a
                            deload never pulls it down. Diamonds are meet lifts; a peaked meet runs a
                            little over a normal training day, so the line sits just under them.
                          </p>
                          <p>
                            Competition PR, best in training and peak estimate are kept apart from
                            the estimate: each answers a different question.
                          </p>
                        </>
                      }
                    />
                    <SectionErrorBoundary label="Competition lifts">
                      <StrengthTrendChart
                        strength={strength}
                        start={startDay}
                        end={endDay}
                        unit={displayUnit}
                        onWiden={filter.preset === "lifetime" ? undefined : widen}
                      />
                    </SectionErrorBoundary>
                  </MoreDetail>
                )}
                {profile !== "powerlifting" && (
                  <MoreDetail label="Strength summary">
                  <section aria-label="Your lifts">
                    <SectionTitle
                      title="Your lifts"
                      sub="How your estimated max changed this period"
                      info={
                        <p>
                          Your estimated max is the most you could likely lift for one rep, worked
                          out from your hardest sets (the weight, the reps and how hard they felt).
                          It compares the start of the period with the end.
                        </p>
                      }
                    />
                    <LiftsMovingCard data={liftsMoving} unit={displayUnit} conv={conv} />
                  </section>
                  </MoreDetail>
                )}
                {blocks.length >= 2 && (
                  <MoreDetail label="Compare training blocks">
                    <SectionTitle
                      title="Compare your training blocks"
                      sub="See how each block went, side by side"
                      info={
                        <p>
                          A training block is a few weeks of training with one aim, like building
                          muscle or peaking for a meet. Compare blocks of the same kind: a lighter
                          block is meant to be lighter.
                        </p>
                      }
                    />
                    <SectionErrorBoundary label="Blocks">
                      <BlockComparisonCard rows={blocks} powerlifter={hasPowerlifting} />
                    </SectionErrorBoundary>
                  </MoreDetail>
                )}
                {coach && (
                  <MoreDetail label="Programming detail (coach)">
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
                      <PredictedWindowCard
                        clientId={clientId}
                        currentBlockId={activeBlockId ?? resolvedCurrentBlockId}
                      />
                    </SectionErrorBoundary>
                  </MoreDetail>
                )}
              </div>
            )}

            {view === "training" && (
              <div className="space-y-6" data-analytics-view="training">
                <Card className="p-4" data-training-muscles>
                  <SectionTitle
                    title="Muscle training map"
                  />
                  <SectionErrorBoundary label="Muscle training map">
                    <MuscleMap
                      read={muscleRead}
                      coached={coached}
                      credit={supportCredit}
                      onCredit={setSupportCredit}
                      onExercise={setMuscleExercise}
                      history={allLoadSets}
                      start={startDay}
                      end={endDay < today ? endDay : today}
                      periods={blocks.map(b=>({id:b.id,name:b.name,start:b.start,end:b.end < today ? b.end : today}))}
                    />
                  </SectionErrorBoundary>
                </Card>
                {hasSbdInPeriod && (
                  <MoreDetail label="Squat, bench and deadlift workload">
                    <SectionTitle
                      title="Squat, bench and deadlift training"
                      sub="How much you did of each lift, week by week"
                      info={
                        <>
                          <p>
                            Sets, reps and total weight lifted (weight × reps, added up) for your
                            three main lifts.
                          </p>
                          <p>
                            The outline is what your program planned, when there's a plan on file.
                          </p>
                        </>
                      }
                    />
                    <SectionErrorBoundary label="Workload">
                      <SbdWorkloadChart
                        sets={periodLoadSets}
                        plan={trainingLoad.plan}
                        start={startDay}
                        end={endDay}
                        today={today}
                        unit={displayUnit}
                        envelopes={{
                          squat: strength.squat.envelope,
                          bench: strength.bench.envelope,
                          deadlift: strength.deadlift.envelope,
                        }}
                        blocks={blocks.map((b) => ({
                          id: b.id,
                          name: b.name,
                          start: b.start,
                          end: b.end,
                        }))}
                      />
                    </SectionErrorBoundary>
                  </MoreDetail>
                )}
                <MoreDetail label="Training consistency">
                <section aria-label="Consistency">
                  <SectionTitle
                    title="How often you train"
                    sub="Planned workouts you did, for days that have passed"
                  />
                  <ConsistencyBlock c={consistency} loading={trainingLoad.planLoading} />
                </section>
                </MoreDetail>
                {patterns.length > 0 && (
                  <MoreDetail label="Recovery patterns">
                  <section aria-label="Recovery patterns">
                    <SectionTitle
                      title="What helps your training"
                      sub="Patterns in your sleep, effort and recovery"
                      info={
                        <p>
                          Found by comparing your own workouts and the check-ins after them. A
                          pattern shows up only when there's enough data, and it shows what tends to
                          go together, not what causes what.
                        </p>
                      }
                    />
                    <RecoveryPatternList patterns={patterns} />
                  </section>
                  </MoreDetail>
                )}
                <SectionErrorBoundary label="Running">
                  <RunningAnalyticsSection
                    clientId={clientId}
                    rangeStart={filter.start}
                    rangeEnd={filter.end}
                    rangeLabel={filter.short}
                  />
                </SectionErrorBoundary>
                <MoreDetail label="More: workouts, sleep, bodyweight and cardio">
                  <section aria-label="Recent workouts">
                    <SectionTitle
                      title="Recent workouts"
                      sub="What you did, set by set, next to what was planned"
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
                  <section aria-label="What you logged" id="recovery">
                    <SectionTitle
                      title="Sleep, recovery and pain"
                      sub="What you told us after each workout"
                    />
                    <SectionErrorBoundary label="Recovery">
                      <RecoveryTrendsCard
                        clientId={clientId}
                        start={filter.start}
                        end={filter.end}
                      />
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
                  {coach && (
                    <SectionErrorBoundary label="Volume and workload">
                      <TrainingLoadSection
                        load={trainingLoad.load}
                        coach={coach}
                        unit={displayUnit}
                        rangeLabel={filter.short}
                        planLoading={trainingLoad.planLoading}
                        planError={trainingLoad.planError}
                        hideInsights={false}
                        header={
                          <SectionTitle
                            title="Programming detail (coach)"
                            sub="Movement patterns, how heavy, and coach-only notes"
                          />
                        }
                      />
                    </SectionErrorBoundary>
                  )}
                </MoreDetail>
              </div>
            )}

            {view === "records" && (
              <div data-analytics-view="records">
                <SectionErrorBoundary label="Records">
                  <RecordsView
                    lifetime={lifetime}
                    records={records}
                    byExercise={byExercise}
                    meets={meets}
                    unit={displayUnit}
                    bodyweights={hideBodyweight ? [] : bodyweightHistory.data?.entries ?? []}
                    sex={competition.data?.sex ?? null}
                    results={allResults as any[]}
                    today={today}
                  />
                </SectionErrorBoundary>
              </div>
            )}
          </>
        )}
      </div>

      <Sheet open={!!muscleExercise} onOpenChange={(open) => { if (!open) setMuscleExercise(null); }}>
        <SheetContent side="bottom" swipeToClose className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4">
          <SheetTitle>{muscleExercise ?? "Exercise"}</SheetTitle>
          <SheetDescription>{filter.label} · Exercise performance</SheetDescription>
          {muscleExercise && <LiftProgressCard key={muscleExercise} history={history.filter((h) => h.name === muscleExercise)} comparisonHistory={comparisonHistory} periods={blocks.map(b=>({id:b.id,name:b.name,start:b.start,end:b.end<today?b.end:today}))} displayUnit={displayUnit} conv={conv} onOpenSet={setSelectedDot} compact single />}
        </SheetContent>
      </Sheet>
      <GraphDotDetail
        point={selectedDot}
        clientId={clientId}
        onClose={() => setSelectedDot(null)}
        canOpenLog={canOpenLog}
      />
    </>
  );
}

/** One compact destination selector; existing routes and deep links remain valid. */
function AnalyticsTabs({view,onChange}:{view:AnalyticsView;onChange:(v:AnalyticsView)=>void}) {
  return <div className="flex items-center justify-between gap-2 border-b border-border pb-3" data-analytics-tabs-wrap>
    <span className="text-xs font-medium text-muted-foreground">Analytics</span>
    <select aria-label="Analytics section" value={view} onChange={e=>onChange(e.target.value as AnalyticsView)}
      className="min-h-10 min-w-[9rem] rounded-lg border border-border bg-background px-3 text-sm font-medium" data-analytics-section-select>
      {ANALYTICS_VIEWS.map(([v,label])=><option key={v} value={v}>{label}</option>)}
    </select>
  </div>;
}

function AnalyticsEmptyPreview() {
  return (
    <Card className="p-6 text-center" data-analytics-empty>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Dumbbell className="h-6 w-6" />
      </div>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
        Your analytics start with your first workout
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Log a workout and this page fills in by itself: when you trained, how your strength is
        changing, which muscles you're training and your records.
      </p>
    </Card>
  );
}

// Re-export Link so consumers can build a viewAllPRsNode without depending
// on the exact router import path.
export { Link as AnalyticsRouterLink };
