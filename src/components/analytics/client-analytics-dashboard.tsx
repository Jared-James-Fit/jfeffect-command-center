import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TrendingUp, Trophy, Dumbbell, Calendar, Flame } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, ReferenceDot, Area, ComposedChart,
} from "recharts";
import {
  getClientResults, buildExerciseHistory, weeklyMuscleVolume, recentPRs,
} from "@/lib/pl-programs";
import { format, isSameDay } from "date-fns";
import {
  AnalyticsFilterBar,
  defaultAnalyticsFilter,
  exactBlockFilter,
  type AnalyticsFilter,
} from "@/components/analytics/analytics-filter-bar";
import { BlockPickerSheet } from "@/components/analytics/block-picker-sheet";
import {
  type AnalyticsBlock,
  normalizeAnalyticsBlock,
  resolveCurrentBlock,
} from "@/lib/analytics/blocks";
import { PowerliftingExposureSection } from "@/components/analytics/powerlifting-exposure-section";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/analytics/searchable-select";
import { PlannedVsActualCard } from "@/components/analytics/planned-vs-actual-card";
import { WeightLiftedCard } from "@/components/analytics/weight-lifted-card";
import { GraphDotDetail, type GraphDotPoint } from "@/components/analytics/graph-dot-detail";
import { PRCard } from "@/components/analytics/pr-card";
import { PerformanceInsights } from "@/components/analytics/performance-insights";
import { RecoverySummaryCard } from "@/components/analytics/recovery-summary-card";
import { SleepInsightsCard } from "@/components/analytics/sleep-insights-card";
import { CardioSummaryCard } from "@/components/analytics/cardio-summary-card";
import { RecoveryPatternsCard } from "@/components/analytics/recovery-patterns-card";
import { PredictedWindowCard } from "@/components/analytics/predicted-window-card";
import { getClientAnalyticsSettings } from "@/lib/analytics/settings";
import {
  ANALYTICS_COLORS,
  exerciseColor,
  exerciseGroup,
  fmtNum,
  liftFamily,
  muscleColor,
  shortMuscleLabel,
} from "@/lib/analytics-format";

export type Unit = "lb" | "kg";
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
  /** Optional class on outer container. */
  className?: string;
}

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
  className,
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
          "id, name, status, start_date, end_date, weeks, sort_order, training_focus, prep_id, pl_preps(id, title, event_name, event_date)",
        )
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true });
      return (data ?? []).map(normalizeAnalyticsBlock);
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

  const activeBlockId =
    filter.preset === "current_block" ||
    filter.preset === "previous_block" ||
    filter.preset === "exact_block"
      ? ((filter as any).blockId as string)
      : null;

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results", clientId, activeBlockId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => getClientResults(clientId, { blockId: activeBlockId ?? undefined }),
  });

  const selectedBlockId = activeBlockId;

  const { data: analyticsSettings } = useQuery({
    queryKey: ["client-analytics-settings", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: () => getClientAnalyticsSettings(clientId),
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

  // Scroll to the Recovery section when the URL ends with #recovery so the
  // "View Recovery" CTA on the Workouts page lands the user in the right
  // place inside Full Analytics. Also briefly highlights the section so it's
  // obvious where the user landed.
  const [recoveryHighlight, setRecoveryHighlight] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#recovery") return;
    // Wait for the section to be present after data fetches / layout.
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById("recovery");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setRecoveryHighlight(true);
        window.setTimeout(() => setRecoveryHighlight(false), 2200);
        return;
      }
      if (attempts++ < 20) window.setTimeout(tryScroll, 150);
    };
    const t = window.setTimeout(tryScroll, 200);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, []);

  const [selectedEx, setSelectedEx] = useState<string>("");
  const [selectedDot, setSelectedDot] = useState<GraphDotPoint | null>(null);
  // Chart metric toggle for the Estimated 1RM Progress card.
  // "effort" = RPE or RIR (whichever was logged), normalized to a common
  // 0–10 effort scale for chart display; original value is preserved for
  // the tooltip label ("RPE 8" vs "2 RIR").
  const [chartMetric, setChartMetric] = useState<"est" | "load" | "effort">("est");

  const filteredResults = useMemo(() => {
    const startMs = filter.start.getTime();
    const endMs = filter.end.getTime();
    return (results as any[]).filter((r: any) => {
      if (!r.date) return false;
      const t = new Date(r.date).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [results, filter.start, filter.end]);

  const BIG_DAYS = 365000;
  const history = useMemo(
    () => buildExerciseHistory(filteredResults as any),
    [filteredResults],
  );
  const volume = useMemo(
    () => weeklyMuscleVolume(filteredResults as any[], BIG_DAYS),
    [filteredResults],
  );
  const prs = useMemo(
    () => recentPRs(filteredResults as any[], BIG_DAYS),
    [filteredResults],
  );

  const activeEx = selectedEx || history[0]?.name || "";
  const activeSeries = history.find((h) => h.name === activeEx);

  const conv = (v: number) => convertWeight(Number(v) || 0, sourceUnit, displayUnit);

  const handleDotClick = useCallback((data: any) => {
    if (!data || !data.activePayload?.[0]) return;
    const d = data.activePayload[0].payload;
    const idx = d.idx ?? 0;
    const rawPoint = activeSeries?.points?.[idx];
    if (!rawPoint) return;
    setSelectedDot({
      id: rawPoint.id,
      row_id: rawPoint.row_id,
      day_id: rawPoint.day_id ?? null,
      date: rawPoint.date,
      exercise_name: activeEx,
      load: rawPoint.load,
      reps: rawPoint.reps,
      est_1rm: rawPoint.est_1rm,
      rpe: rawPoint.rpe ?? null,
      rir: rawPoint.rir ?? null,
      exercise_note: rawPoint.exercise_note ?? null,
      duration_seconds: rawPoint.duration_seconds ?? null,
      set_index: rawPoint.set_index ?? idx,
      displayUnit,
      displayLoad: d.load,
    });
  }, [activeSeries, activeEx, displayUnit]);

  const gridStroke = "color-mix(in oklab, var(--border) 60%, transparent)";
  const axisColor = "var(--muted-foreground)";

  const lineData = useMemo(() => {
    const pts = activeSeries?.points ?? [];
    return pts.map((p: any, i: number) => {
      const d = new Date(p.date);
      const sameAsPrev = i > 0 && isSameDay(d, new Date(pts[i - 1].date));
      const sameAsNext =
        i < pts.length - 1 && isSameDay(d, new Date(pts[i + 1].date));
      const sameDay = sameAsPrev || sameAsNext;
      const label = sameAsPrev
        ? ""
        : sameDay
          ? format(d, "MMM d")
          : format(d, "MMM d");
      const rpeRaw = p.rpe != null && p.rpe !== "" ? Number(p.rpe) : null;
      const rirRaw = p.rir != null && p.rir !== "" ? Number(p.rir) : null;
      // Normalize to a common effort scale (higher = harder).
      // RPE stays as-is; RIR converts via 10 - RIR (RIR 0 = RPE 10, RIR 2 = RPE 8).
      const effortNorm =
        rpeRaw != null && Number.isFinite(rpeRaw)
          ? rpeRaw
          : rirRaw != null && Number.isFinite(rirRaw)
            ? Math.max(0, Math.min(10, 10 - rirRaw))
            : null;
      const effortSource: "RPE" | "RIR" | null =
        rpeRaw != null && Number.isFinite(rpeRaw)
          ? "RPE"
          : rirRaw != null && Number.isFinite(rirRaw)
            ? "RIR"
            : null;
      return {
        idx: i,
        date: label,
        fullDate: format(d, "MMM d, yyyy"),
        time: sameDay ? format(d, "h:mma") : null,
        est: Number(conv(p.est_1rm).toFixed(1)),
        load: Number(conv(p.load).toFixed(1)),
        reps: p.reps,
        rpe: rpeRaw != null && Number.isFinite(rpeRaw) ? rpeRaw : null,
        rir: rirRaw != null && Number.isFinite(rirRaw) ? rirRaw : null,
        effort: effortNorm,
        effortSource,
      };
    });
  }, [activeSeries, conv]);

  // Which effort systems appear in the current chart window (for labeling).
  const effortSystems = useMemo(() => {
    const set = new Set<string>();
    for (const p of lineData) if (p.effortSource) set.add(p.effortSource);
    return set;
  }, [lineData]);
  const effortLabel =
    effortSystems.size === 2
      ? "Effort (RPE / RIR)"
      : effortSystems.has("RIR")
        ? "Effort (RIR)"
        : "Effort (RPE)";

  // Previous-block date range for the Recovery card comparison chip.
  const { prevBlockStart, prevBlockEnd } = useMemo(() => {
    if (!activeBlockId) return { prevBlockStart: null, prevBlockEnd: null };
    const idx = clientBlocks.findIndex((b) => b.id === activeBlockId);
    if (idx <= 0) return { prevBlockStart: null, prevBlockEnd: null };
    const prev = clientBlocks[idx - 1];
    if (!prev?.start_date || !prev?.end_date) return { prevBlockStart: null, prevBlockEnd: null };
    return { prevBlockStart: new Date(prev.start_date), prevBlockEnd: new Date(prev.end_date) };
  }, [activeBlockId, clientBlocks]);

  const activePr = activeSeries?.pr;
  const activeColor = exerciseColor(activeEx, activeSeries?.points?.[0]?.muscle_group);

  const exerciseOptions: SearchableOption[] = useMemo(
    () =>
      history.map((h: any) => {
        const lf = liftFamily(h.name);
        return {
          value: h.name,
          label: h.name,
          group: exerciseGroup(h.name, h.points?.[0]?.category),
          hint: `${fmtNum(conv(h.pr?.est_1rm ?? 0))} ${displayUnit}`,
          keywords: [
            lf ?? "",
            h.points?.[0]?.muscle_group ?? "",
            h.points?.[0]?.category ?? "",
          ].filter(Boolean),
          color: exerciseColor(h.name, h.points?.[0]?.muscle_group),
        };
      }),
    [history, conv, displayUnit],
  );

  const volumeData = useMemo(() => {
    const merged = new Map<string, { muscle: string; sets: number; color: string; label: string }>();
    for (const v of volume) {
      const label = shortMuscleLabel(v.muscle);
      const existing = merged.get(label);
      if (existing) {
        existing.sets += v.sets;
      } else {
        merged.set(label, { muscle: label, sets: v.sets, color: muscleColor(label), label });
      }
    }
    return [...merged.values()].sort((a, b) => b.sets - a.sets);
  }, [volume]);

  const summary = useMemo(() => {
    const prsInRange = prs.length;
    const setsInRange = filteredResults.length;
    const workouts = new Set(
      filteredResults
        .filter((r: any) => r.date)
        .map((r: any) => format(new Date(r.date), "yyyy-MM-dd")),
    ).size;
    const top = [...prs].sort((a: any, b: any) => b.delta - a.delta)[0];
    return {
      prsInRange,
      setsInRange,
      workouts,
      topLift: top ? { name: top.exercise_name, delta: conv(top.delta) } : null,
    };
  }, [filteredResults, prs, conv]);

  return (
    <>
      <div className={`space-y-6 ${className ?? ""}`}>
        {(headerLeadingNode || showUnitToggle) && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
            <div className="min-w-0">{headerLeadingNode}</div>
            {showUnitToggle && (
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Units
                </span>
                <ToggleGroup
                  type="single"
                  value={displayUnit}
                  onValueChange={(v) => v && setDisplayUnit(v as Unit)}
                  className="rounded-lg border border-border bg-card p-0.5"
                >
                  <ToggleGroupItem value="lb" className="h-8 px-3 text-xs font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    LB
                  </ToggleGroupItem>
                  <ToggleGroupItem value="kg" className="h-8 px-3 text-xs font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    KG
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
          </div>
        )}

        <AnalyticsFilterBar
          blocks={clientBlocks}
          value={filter}
          onChange={handleFilterChange}
          selectedBlockId={selectedBlockId}
          resolvedCurrentBlockId={resolvedCurrentBlockId}
          onOpenPicker={() => setPickerOpen(true)}
        />

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
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            This block has not been scheduled yet. Planned structure is shown; date-based charts will fill in once workouts are scheduled.
          </div>
        )}
        {filter.preset === "exact_block" &&
          selectedBlockId &&
          selectedBlockId !== resolvedCurrentBlockId &&
          resolvedCurrentBlockId && (
            <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300">
              Upcoming Block · No workouts completed yet.
            </div>
          )}

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Loading training data…
          </Card>
        ) : (results as any[]).length === 0 ? (
          <AnalyticsEmptyPreview />
        ) : (
          <>
            {filteredResults.length === 0 && (
              <Card className="border-dashed border-border/70 bg-card/60 p-6 text-center text-sm text-muted-foreground">
                No training data logged in this period ({filter.label}).
              </Card>
            )}

            <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                icon={<Trophy className="h-4 w-4" />}
                label="PRs in range"
                value={String(summary.prsInRange)}
                color={ANALYTICS_COLORS.green}
              />
              <StatCard
                icon={<Flame className="h-4 w-4" />}
                label="Sets in range"
                value={String(summary.setsInRange)}
                color={ANALYTICS_COLORS.red}
              />
              <StatCard
                icon={<Calendar className="h-4 w-4" />}
                label="Workouts"
                value={String(summary.workouts)}
                color={ANALYTICS_COLORS.blue}
              />
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Top gain"
                value={
                  summary.topLift
                    ? `+${fmtNum(summary.topLift.delta)} ${displayUnit}`
                    : "—"
                }
                sublabel={summary.topLift?.name}
                color={ANALYTICS_COLORS.purple}
              />
            </section>

            <WeightLiftedCard
              clientId={clientId}
              displayUnit={displayUnit}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.label}
              blockId={activeBlockId}
            />

            <div
              id="recovery"
              className={`grid gap-4 scroll-mt-24 rounded-xl transition-shadow duration-500 md:grid-cols-2 ${
                recoveryHighlight ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background shadow-lg" : ""
              }`}
            >
              <RecoverySummaryCard
                clientId={clientId}
                rangeStart={filter.start}
                rangeEnd={filter.end}
                rangeLabel={filter.label}
                prevStart={prevBlockStart}
                prevEnd={prevBlockEnd}
              />
              <CardioSummaryCard
                clientId={clientId}
                rangeStart={filter.start}
                rangeEnd={filter.end}
                rangeLabel={filter.label}
              />
            </div>

            <SleepInsightsCard
              clientId={clientId}
              blockStart={filter.start}
              blockEnd={filter.end}
              blockLabel={filter.label}
            />

            <section aria-label="Planned vs Actual">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                {filter.label} · 5 most recent completed workouts in this range
              </div>
              <PlannedVsActualCard
                clientId={clientId}
                formula={analyticsSettings?.e1rm_formula}
                workingRpeMin={analyticsSettings?.working_set_rpe_min}
                startDate={filter.start}
                endDate={filter.end}
                blockId={activeBlockId}
              />
            </section>

            <section>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
                <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
                  <Trophy className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate">Recent PRs</span>
                </h2>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs font-semibold text-muted-foreground">{filter.label}</span>
                  {prs.length > 0 && viewAllPRsNode}
                </div>
              </div>
              {prs.length === 0 ? (
                <Card className="p-6 text-base text-muted-foreground">
                  No new PRs in the selected range.
                </Card>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {prs.slice(0, 5).map((p: any) => (
                      <PRCard key={p.id} pr={p} displayUnit={displayUnit} conv={conv} dense />
                    ))}
                  </div>
                  {prs.length > 5 && viewAllPRsNode && (
                    <div className="mt-3 text-center">{viewAllPRsNode}</div>
                  )}
                </>
              )}
            </section>

            <section>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
                <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
                  <TrendingUp className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate">Exercise Progress</span>
                </h2>
                <ToggleGroup
                  type="single"
                  value={chartMetric}
                  onValueChange={(v) => v && setChartMetric(v as any)}
                  className="rounded-lg border border-border bg-card p-0.5"
                >
                  <ToggleGroupItem value="est" className="h-8 px-3 text-[11px] font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    Est 1RM
                  </ToggleGroupItem>
                  <ToggleGroupItem value="load" className="h-8 px-3 text-[11px] font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    Weight
                  </ToggleGroupItem>
                  <ToggleGroupItem value="effort" className="h-8 px-3 text-[11px] font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    Effort
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <Card className="border-border/80 bg-card p-4">
                <div className="mb-4">
                  <SearchableSelect
                    options={exerciseOptions}
                    value={activeEx}
                    onChange={setSelectedEx}
                    placeholder="Select exercise"
                    searchPlaceholder="Search exercise, lift, or muscle…"
                    emptyText="No exercises match your search."
                    triggerClassName="h-10"
                    ariaLabel="Select exercise for 1RM chart"
                  />
                </div>

                {activeSeries ? (
                  <>
                    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 sm:flex sm:flex-wrap sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          <span
                            aria-hidden
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: activeColor }}
                          />
                          <span className="truncate">{activeEx}</span>
                        </div>
                        <div className="mt-0.5 text-2xl font-black text-foreground">
                          {fmtNum(conv(activePr?.est_1rm ?? 0))}{" "}
                          <span className="text-xs font-semibold uppercase text-muted-foreground">
                            {displayUnit} · PR
                          </span>
                        </div>
                        {activePr?.date && (
                          <div className="text-xs font-medium text-muted-foreground">
                            Set on {format(new Date(activePr.date), "MMM d, yyyy")}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right text-xs font-semibold text-muted-foreground">
                        {activeSeries.points.length}{" "}
                        {activeSeries.points.length === 1 ? "logged set" : "logged sets"}
                      </div>
                    </div>
                    {lineData.length === 1 ? (
                      <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/40 px-6 text-center">
                        <div
                          className="mb-2 h-3 w-3 rounded-full"
                          style={{ background: activeColor }}
                        />
                        <div className="text-2xl font-black text-foreground">
                          {lineData[0].est} {displayUnit}
                        </div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          First logged estimate
                        </div>
                        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
                          Log a few more sessions to build a progress trend.
                        </p>
                      </div>
                    ) : (
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={lineData}
                            margin={{ top: 12, right: 12, left: -10, bottom: 4 }}
                            onClick={handleDotClick}
                            style={{ cursor: "pointer" }}
                          >
                            <defs>
                              <linearGradient
                                id={`fill-${activeEx.replace(/\W+/g, "")}`}
                                x1="0" y1="0" x2="0" y2="1"
                              >
                                <stop offset="0%" stopColor={activeColor} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={activeColor} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                            <XAxis
                              dataKey="date"
                              stroke={axisColor}
                              fontSize={11}
                              tickMargin={6}
                              interval="preserveStartEnd"
                              minTickGap={20}
                            />
                            <YAxis
                              stroke={axisColor}
                              fontSize={11}
                              tickMargin={4}
                              domain={chartMetric === "effort" ? [0, 10] : ["auto", "auto"]}
                              tickFormatter={(v) => fmtNum(v)}
                              width={40}
                            />
                            <Tooltip
                              cursor={{
                                stroke: `color-mix(in oklab, ${activeColor} 50%, transparent)`,
                                strokeWidth: 1,
                              }}
                              wrapperStyle={{ outline: "none" }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d: any = payload[0].payload;
                                const metricLabel =
                                  chartMetric === "est" ? "est 1RM"
                                  : chartMetric === "load" ? "top set"
                                  : effortLabel.toLowerCase();
                                const effortDisplay =
                                  d.effortSource === "RIR"
                                    ? `${d.rir} RIR`
                                    : d.effortSource === "RPE"
                                      ? `RPE ${d.rpe}`
                                      : "—";
                                const metricValue = chartMetric === "effort"
                                  ? effortDisplay
                                  : `${fmtNum(d[chartMetric])} ${displayUnit}`;
                                return (
                                  <div className="max-w-[220px] rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-xl">
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                      <span
                                        aria-hidden
                                        className="h-2 w-2 rounded-full"
                                        style={{ background: activeColor }}
                                      />
                                      {d.fullDate}
                                      {d.time && (
                                        <span className="font-medium normal-case tracking-normal">
                                          · {d.time}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 font-extrabold text-foreground">
                                      {metricValue}{" "}
                                      <span className="text-xs font-medium text-muted-foreground">
                                        {metricLabel}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {fmtNum(d.load)} {displayUnit} × {d.reps}
                                      {chartMetric !== "effort" && (d.effortSource === "RPE"
                                        ? ` · RPE ${d.rpe}`
                                        : d.effortSource === "RIR"
                                          ? ` · ${d.rir} RIR`
                                          : "")}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey={chartMetric}
                              stroke="none"
                              fill={`url(#fill-${activeEx.replace(/\W+/g, "")})`}
                              connectNulls
                            />
                            <Line
                              type="monotone"
                              dataKey={chartMetric}
                              stroke={activeColor}
                              strokeWidth={2.5}
                              dot={{ r: 3.5, fill: activeColor, strokeWidth: 0 }}
                              activeDot={{ r: 8, strokeWidth: 2, stroke: "var(--background)", fill: activeColor, cursor: "pointer" }}
                              connectNulls
                            />
                            {chartMetric === "est" && activePr && lineData.length > 1 && (
                              <ReferenceDot
                                x={lineData.findIndex(
                                  (d) => d.est === Number(conv(activePr.est_1rm).toFixed(1)),
                                ) === -1
                                  ? undefined
                                  : lineData[
                                      lineData.findIndex(
                                        (d) =>
                                          d.est ===
                                          Number(conv(activePr.est_1rm).toFixed(1)),
                                      )
                                    ]?.date}
                                y={Number(conv(activePr.est_1rm).toFixed(1))}
                                r={5}
                                fill={ANALYTICS_COLORS.green}
                                stroke="var(--background)"
                                strokeWidth={2}
                                ifOverflow="extendDomain"
                                isFront
                              />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Select an exercise to see progress.
                  </div>
                )}
              </Card>
            </section>

            <section>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
                <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
                  <Dumbbell className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate">Volume by Muscle Group</span>
                </h2>
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">{filter.label}</span>
              </div>
              {volumeData.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">
                  No working sets logged in this period.
                </Card>
              ) : (
                <Card className="border-border/80 bg-card p-4">
                  <div style={{ height: Math.max(220, volumeData.length * 38) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={volumeData}
                        layout="vertical"
                        margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
                        barCategoryGap="22%"
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                        <XAxis
                          type="number"
                          stroke={axisColor}
                          fontSize={11}
                          allowDecimals={false}
                          tickMargin={4}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          stroke={axisColor}
                          fontSize={12}
                          width={96}
                          tick={{ fill: "var(--foreground)" }}
                          interval={0}
                        />
                        <Tooltip
                          cursor={{
                            fill: "color-mix(in oklab, var(--foreground) 6%, transparent)",
                          }}
                          wrapperStyle={{ outline: "none" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d: any = payload[0].payload;
                            return (
                              <div className="max-w-[220px] rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-xl">
                                <div className="flex items-center gap-2 font-extrabold text-foreground">
                                  <span
                                    aria-hidden
                                    className="h-2 w-2 rounded-full"
                                    style={{ background: d.color }}
                                  />
                                  {d.muscle}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {d.sets} {d.sets === 1 ? "set" : "sets"}
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="sets" radius={[0, 6, 6, 0]}>
                          {volumeData.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}
            </section>

            <PowerliftingExposureSection
              clientId={clientId}
              filter={filter}
              results={results as any[]}
              displayUnit={displayUnit}
              blockId={activeBlockId}
            />

            <RecoveryPatternsCard
              clientId={clientId}
              rangeStart={filter.start}
              rangeEnd={filter.end}
            />

            <PredictedWindowCard
              clientId={clientId}
              currentBlockId={activeBlockId ?? resolvedCurrentBlockId}
            />
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

// Recharts is imported but LineChart is unused in this file; keep parity with
// the original imports so tree-shaking behaves the same.
void LineChart;

function StatCard({
  icon, label, value, sublabel, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  color: string;
}) {
  return (
    <Card
      className="relative overflow-hidden border-border/80 bg-card p-3"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-xl font-black tracking-tight text-foreground">
        {value}
      </div>
      {sublabel && (
        <div className="truncate text-[11px] font-medium text-muted-foreground">
          {sublabel}
        </div>
      )}
    </Card>
  );
}

function AnalyticsEmptyPreview() {
  const previewStats = [
    { icon: <Trophy className="h-4 w-4" />, label: "PRs · 30d", value: "—", color: ANALYTICS_COLORS.green },
    { icon: <Flame className="h-4 w-4" />, label: "Sets · 7d", value: "—", color: ANALYTICS_COLORS.red },
    { icon: <Calendar className="h-4 w-4" />, label: "Workouts", value: "—", color: ANALYTICS_COLORS.blue },
    { icon: <TrendingUp className="h-4 w-4" />, label: "Top gain", value: "—", color: ANALYTICS_COLORS.purple },
  ];
  const sections = [
    { icon: <Trophy className="h-5 w-5 text-primary" />, title: "Recent PRs", desc: "Every time you beat a previous best, the lift, weight, and gain land here automatically." },
    { icon: <TrendingUp className="h-5 w-5 text-primary" />, title: "Estimated 1RM progress", desc: "Track strength curves per exercise — your top sets get plotted over time with PR markers." },
    { icon: <Dumbbell className="h-5 w-5 text-primary" />, title: "Weekly volume by muscle", desc: "See how many sets each muscle group is getting so you can balance your training." },
    { icon: <Calendar className="h-5 w-5 text-primary" />, title: "Planned vs actual", desc: "Compare what was programmed against what you actually completed, set by set." },
  ];
  return (
    <div className="space-y-6">
      <Card className="border-dashed border-border/70 bg-card/60 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Dumbbell className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-black tracking-tight text-foreground">
          Analytics will appear here
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Log a working set from any workout and PRs, strength trends, and weekly volume start filling in automatically — no extra setup required.
        </p>
      </Card>

      <section aria-label="Preview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {previewStats.map((s) => (
          <Card
            key={s.label}
            className="relative overflow-hidden border-border/60 bg-card/60 p-3 opacity-70"
            style={{ borderTop: `3px solid ${s.color}` }}
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span style={{ color: s.color }}>{s.icon}</span>
              <span className="truncate">{s.label}</span>
            </div>
            <div className="mt-1 text-xl font-black tracking-tight text-muted-foreground">
              {s.value}
            </div>
          </Card>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title} className="border-border/70 bg-card/60 p-4">
            <div className="flex items-center gap-2">
              {s.icon}
              <h3 className="text-sm font-black uppercase tracking-wider text-foreground">
                {s.title}
              </h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}

// Re-export Link so consumers can build a viewAllPRsNode without depending
// on the exact router import path.
export { Link as AnalyticsRouterLink };