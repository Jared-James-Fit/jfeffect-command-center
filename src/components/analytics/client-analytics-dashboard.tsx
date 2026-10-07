import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TrendingUp, Trophy, Dumbbell, Calendar, Flame } from "lucide-react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell,
} from "recharts";
import {
  getClientResults, buildExerciseHistory, weeklyMuscleVolume, recentPRs,
} from "@/lib/pl-programs";
import { format } from "date-fns";
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
import { PlannedVsActualCard } from "@/components/analytics/planned-vs-actual-card";
import { WeightLiftedCard } from "@/components/analytics/weight-lifted-card";
import { GraphDotDetail, type GraphDotPoint } from "@/components/analytics/graph-dot-detail";
import { LiftProgressCard } from "@/components/analytics/lift-progress-card";
import { PRCard } from "@/components/analytics/pr-card";
import { PerformanceInsights } from "@/components/analytics/performance-insights";
import { RecoverySummaryCard } from "@/components/analytics/recovery-summary-card";
import { SleepInsightsCard } from "@/components/analytics/sleep-insights-card";
import { BodyweightTrendCard } from "@/components/analytics/bodyweight-trend-card";
import { CardioAnalyticsSection } from "@/components/analytics/cardio-analytics-section";
import { RecoveryPatternsCard } from "@/components/analytics/recovery-patterns-card";
import { PredictedWindowCard } from "@/components/analytics/predicted-window-card";
import { getClientAnalyticsSettings } from "@/lib/analytics/settings";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { InfoTip } from "@/components/analytics/info-tip";
import {
  ANALYTICS_COLORS,
  fmtNum,
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

  // Whether this client has EVER logged a set. The full-page "Analytics will
  // appear here" preview is reserved for genuinely empty accounts — a filter
  // range with no results (e.g. a brand-new block) must NOT hide the whole
  // dashboard, since Recovery/Sleep/Bodyweight/Cardio have their own data.
  const { data: hasAnyResults } = useQuery({
    queryKey: ["pl-results-any", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("pl_row_results")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .not("actual_reps", "is", null);
      return (count ?? 0) > 0;
    },
  });

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

  const [selectedDot, setSelectedDot] = useState<GraphDotPoint | null>(null);

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

  const conv = useCallback(
    (v: number) => convertWeight(Number(v) || 0, sourceUnit, displayUnit),
    [displayUnit],
  );

  const gridStroke = "color-mix(in oklab, var(--border) 60%, transparent)";
  const axisColor = "var(--muted-foreground)";

  // Previous-block date range for the Recovery card comparison chip.
  const { prevBlockStart, prevBlockEnd } = useMemo(() => {
    if (!activeBlockId) return { prevBlockStart: null, prevBlockEnd: null };
    const idx = clientBlocks.findIndex((b) => b.id === activeBlockId);
    if (idx <= 0) return { prevBlockStart: null, prevBlockEnd: null };
    const prev = clientBlocks[idx - 1];
    if (!prev?.start_date || !prev?.end_date) return { prevBlockStart: null, prevBlockEnd: null };
    return { prevBlockStart: new Date(prev.start_date), prevBlockEnd: new Date(prev.end_date) };
  }, [activeBlockId, clientBlocks]);

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

  const totalVolumeSets = useMemo(
    () => volumeData.reduce((s, d) => s + d.sets, 0),
    [volumeData],
  );
  const otherVolume = useMemo(
    () => volumeData.find((d) => d.muscle === "Other") ?? null,
    [volumeData],
  );

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
        ) : (results as any[]).length === 0 && hasAnyResults === false ? (
          <AnalyticsEmptyPreview />
        ) : (
          <>
            <SectionErrorBoundary label="Performance Insights">
              <PerformanceInsights clientId={clientId} displayUnit={displayUnit} />
            </SectionErrorBoundary>
            {filteredResults.length === 0 && (
              <Card className="border-dashed border-border/70 bg-card/60 p-6 text-center text-sm text-muted-foreground">
                No training data logged in this period ({filter.label}).
              </Card>
            )}

            <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                icon={<Trophy className="h-4 w-4" />}
                label="ATPRs in range"
                value={String(summary.prsInRange)}
                color={ANALYTICS_COLORS.green}
                tip={
                  <InfoTip label="About ATPRs in range" title="ATPRs in range" align="start">
                    New estimated 1RM personal bests logged in this range. A PR
                    counts when a set's estimated 1RM beats every previous
                    logged set for that exercise — first-time logs don't count,
                    since there is no previous best to beat. Estimates use the
                    Epley formula.
                  </InfoTip>
                }
              />
              <StatCard
                icon={<Flame className="h-4 w-4" />}
                label="Sets in range"
                value={String(summary.setsInRange)}
                color={ANALYTICS_COLORS.red}
                tip={
                  <InfoTip label="About sets in range" title="Sets in range" align="start">
                    All sets logged with a weight in this range (warm-ups
                    included if they were logged). Bodyweight sets with no
                    external load are not counted here.
                  </InfoTip>
                }
              />
              <StatCard
                icon={<Calendar className="h-4 w-4" />}
                label="Workouts"
                value={String(summary.workouts)}
                color={ANALYTICS_COLORS.blue}
                tip={
                  <InfoTip label="About workouts count" title="Workouts" align="end">
                    Distinct training days with at least one logged set in this
                    range — workouts with real logged data, not scheduled
                    sessions.
                  </InfoTip>
                }
              />
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Top e1RM gain"
                value={
                  summary.topLift
                    ? `+${fmtNum(summary.topLift.delta)} ${displayUnit}`
                    : "—"
                }
                sublabel={summary.topLift?.name ?? "No ATPRs in this range"}
                color={ANALYTICS_COLORS.purple}
                tip={
                  <InfoTip label="About top e1RM gain" title="Top e1RM gain" align="end">
                    The biggest estimated 1RM increase detected in this range —
                    the PR with the largest jump over the client's previous best
                    for that exercise.
                  </InfoTip>
                }
              />
            </section>

            <SectionErrorBoundary label="Weight lifted">
            <WeightLiftedCard
              clientId={clientId}
              displayUnit={displayUnit}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.label}
              blockId={activeBlockId}
            />
            </SectionErrorBoundary>

            <section aria-label="Lift Progress">
              <SectionHeading
                icon={<TrendingUp className="h-5 w-5" />}
                title="Lift Progress"
                meta={filter.label}
                tip={
                  <InfoTip label="About lift progress" title="Lift Progress" align="start">
                    One point per session: its best set. Switch between e1RM
                    (estimated one-rep max, Epley), Top set (heaviest weight),
                    Volume (weight × reps), RPE and Velocity when logged. Touch
                    or drag the chart to see a session; Details opens the set.
                    The green dot marks the PR. The trend is fitted across all
                    sessions, so one light day doesn't swing it.
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

            <section aria-label="Recent ATPRs">
              <SectionHeading
                icon={<Trophy className="h-5 w-5" />}
                title="Recent ATPRs"
                meta={filter.label}
                action={prs.length > 0 ? viewAllPRsNode : undefined}
                tip={
                  <InfoTip label="About recent ATPRs" title="Recent ATPRs" align="start">
                    Every card is a new estimated 1RM personal best: the logged
                    set, the previous best it beat, and the gain. Estimates use
                    the Epley formula — weight × (1 + reps ÷ 30).
                  </InfoTip>
                }
              />
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

            <section aria-label="Volume by Muscle Group">
              <SectionHeading
                icon={<Dumbbell className="h-5 w-5" />}
                title="Volume by Muscle"
                meta={filter.label}
                tip={
                  <InfoTip label="About volume by muscle group" title="Volume by Muscle Group" align="start">
                    Working sets per muscle group in this range, based on each
                    exercise's muscle tag. Exercises without a tag land in
                    Other — it is not a real muscle group.
                  </InfoTip>
                }
              />
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
                            const pct = totalVolumeSets > 0
                              ? Math.round((d.sets / totalVolumeSets) * 100)
                              : 0;
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
                                  {d.sets} {d.sets === 1 ? "set" : "sets"} · {pct}% of total
                                </div>
                                {d.muscle === "Other" && (
                                  <div className="mt-1 text-[11px] text-muted-foreground">
                                    Exercises without a mapped muscle group.
                                  </div>
                                )}
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
                  {otherVolume && (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      {otherVolume.sets} {otherVolume.sets === 1 ? "set" : "sets"}
                      {totalVolumeSets > 0 &&
                        ` (${Math.round((otherVolume.sets / totalVolumeSets) * 100)}%)`}{" "}
                      in <span className="font-semibold">Other</span> — exercises without a
                      muscle group tag. Tag exercises in the library to improve this chart.
                    </p>
                  )}
                </Card>
              )}
            </section>

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

            <SectionErrorBoundary label="Powerlifting exposure">
            <PowerliftingExposureSection
              clientId={clientId}
              filter={filter}
              results={results as any[]}
              displayUnit={displayUnit}
              blockId={activeBlockId}
            />
            </SectionErrorBoundary>

            <div
              id="recovery"
              className={`grid gap-4 scroll-mt-24 rounded-xl transition-shadow duration-500 ${
                recoveryHighlight ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background shadow-lg" : ""
              }`}
            >
              <SectionErrorBoundary label="Recovery">
              <RecoverySummaryCard
                clientId={clientId}
                rangeStart={filter.start}
                rangeEnd={filter.end}
                rangeLabel={filter.label}
                prevStart={prevBlockStart}
                prevEnd={prevBlockEnd}
              />
              </SectionErrorBoundary>
            </div>

            <SectionErrorBoundary label="Sleep">
            <SleepInsightsCard
              clientId={clientId}
              blockStart={filter.start}
              blockEnd={filter.end}
              blockLabel={filter.label}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Bodyweight trend">
            <BodyweightTrendCard
              clientId={clientId}
              displayUnit={displayUnit}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.label}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Cardio">
            <CardioAnalyticsSection
              clientId={clientId}
              rangeStart={filter.start}
              rangeEnd={filter.end}
              rangeLabel={filter.label}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Recovery patterns">
            <RecoveryPatternsCard
              clientId={clientId}
              rangeStart={filter.start}
              rangeEnd={filter.end}
            />
            </SectionErrorBoundary>

            <SectionErrorBoundary label="Predicted window">
            <PredictedWindowCard
              clientId={clientId}
              currentBlockId={activeBlockId ?? resolvedCurrentBlockId}
            />
            </SectionErrorBoundary>
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
        <h2 className="flex min-w-0 items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
          <span className="shrink-0 text-primary">{icon}</span>
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
  icon, label, value, sublabel, color, tip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  color: string;
  tip?: React.ReactNode;
}) {
  return (
    <Card
      className="relative overflow-hidden border-border/80 bg-card p-3"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
        {tip && <span className="ml-auto normal-case">{tip}</span>}
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
    { icon: <Trophy className="h-4 w-4" />, label: "ATPRs · 30d", value: "—", color: ANALYTICS_COLORS.green },
    { icon: <Flame className="h-4 w-4" />, label: "Sets · 7d", value: "—", color: ANALYTICS_COLORS.red },
    { icon: <Calendar className="h-4 w-4" />, label: "Workouts", value: "—", color: ANALYTICS_COLORS.blue },
    { icon: <TrendingUp className="h-4 w-4" />, label: "Top e1RM gain", value: "—", color: ANALYTICS_COLORS.purple },
  ];
  const sections = [
    { icon: <Trophy className="h-5 w-5 text-primary" />, title: "Recent ATPRs", desc: "Every time you beat a previous best, the lift, weight, and gain land here automatically." },
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