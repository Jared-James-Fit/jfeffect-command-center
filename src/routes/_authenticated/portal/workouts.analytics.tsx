import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowLeft, TrendingUp, Trophy, Dumbbell, Calendar, Flame } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, ReferenceDot, Area, ComposedChart,
} from "recharts";
import {
  getClientResults, buildExerciseHistory, weeklyMuscleVolume, recentPRs,
} from "@/lib/pl-programs";
import { format, isSameDay } from "date-fns";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/analytics/searchable-select";
import { PlannedVsActualCard } from "@/components/analytics/planned-vs-actual-card";
import { getClientAnalyticsSettings } from "@/lib/analytics/settings";
import {
  ANALYTICS_COLORS,
  exerciseColor,
  exerciseGroup,
  fmtDelta,
  fmtNum,
  fmtWeight,
  liftFamily,
  muscleColor,
  shortMuscleLabel,
} from "@/lib/analytics-format";

/**
 * Client-facing analytics dashboard.
 *
 * Reuses the same helpers that drive the coach analytics page so client and
 * coach numbers are guaranteed identical. All calculations use the
 * normalized columns (via getClientResults) — partial sets are excluded
 * because the query requires actual_load AND actual_reps.
 */
export const Route = createFileRoute("/_authenticated/portal/workouts/analytics")({
  component: PortalAnalytics,
});

type Unit = "lb" | "kg";
const LB_PER_KG = 2.2046226;

function convertWeight(value: number, from: Unit, to: Unit) {
  if (!value || from === to) return value;
  return to === "lb" ? value * LB_PER_KG : value / LB_PER_KG;
}

function PortalAnalytics() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client-analytics", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("id, full_name, preferred_weight_unit")
        .eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results", client?.id],
    enabled: !!client?.id,
    queryFn: () => getClientResults(client!.id),
  });

  const { data: analyticsSettings } = useQuery({
    queryKey: ["client-analytics-settings", client?.id],
    enabled: !!client?.id,
    queryFn: () => getClientAnalyticsSettings(client!.id),
  });

  const sourceUnit: Unit = (client?.preferred_weight_unit === "kg" ? "kg" : "lb");
  const [displayUnit, setDisplayUnit] = useState<Unit>(sourceUnit);
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [volumeDays, setVolumeDays] = useState<number>(7);
  const [selectedEx, setSelectedEx] = useState<string>("");
  const [prFilter, setPrFilter] = useState<string>("all");

  const history = useMemo(() => buildExerciseHistory(results as any), [results]);
  const volume = useMemo(
    () => weeklyMuscleVolume(results as any[], volumeDays),
    [results, volumeDays],
  );
  const prs = useMemo(
    () => recentPRs(results as any[], rangeDays),
    [results, rangeDays],
  );

  const activeEx = selectedEx || history[0]?.name || "";
  const activeSeries = history.find((h) => h.name === activeEx);

  const conv = (v: number) => convertWeight(Number(v) || 0, sourceUnit, displayUnit);

  // Chart palette — themed accents, high contrast in dark mode.
  // NOTE: CSS variables hold oklch(...) values so we use var(...) directly,
  // never hsl(var(--token)) (that would produce invalid colors → black bars).
  const gridStroke = "color-mix(in oklab, var(--border) 60%, transparent)";
  const axisColor = "var(--muted-foreground)";

  // Build chart data with smart x-axis labels: include time when same day repeats.
  const lineData = useMemo(() => {
    const pts = activeSeries?.points ?? [];
    return pts.map((p: any, i: number) => {
      const d = new Date(p.date);
      const sameAsPrev = i > 0 && isSameDay(d, new Date(pts[i - 1].date));
      const sameAsNext =
        i < pts.length - 1 && isSameDay(d, new Date(pts[i + 1].date));
      const sameDay = sameAsPrev || sameAsNext;
      // Hide repeated date labels — show date only on first occurrence.
      const label = sameAsPrev
        ? ""
        : sameDay
          ? format(d, "MMM d")
          : format(d, "MMM d");
      return {
        idx: i,
        date: label,
        fullDate: format(d, "MMM d, yyyy"),
        time: sameDay ? format(d, "h:mma") : null,
        est: Number(conv(p.est_1rm).toFixed(1)),
        load: Number(conv(p.load).toFixed(1)),
        reps: p.reps,
      };
    });
  }, [activeSeries, conv]);

  const activePr = activeSeries?.pr;
  const activeColor = exerciseColor(activeEx, activeSeries?.points?.[0]?.muscle_group);

  // Exercise selector options — grouped, with PR hint.
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

  // PR filter selector options.
  const prOptions: SearchableOption[] = useMemo(() => {
    const exNames = Array.from(new Set(prs.map((p: any) => p.exercise_name)));
    return [
      { value: "all", label: "All exercises" },
      ...exNames.map((n) => ({
        value: n,
        label: n,
        color: exerciseColor(n),
        group: exerciseGroup(n),
      })),
    ];
  }, [prs]);

  const filteredPrs = useMemo(
    () =>
      prFilter === "all"
        ? prs
        : prs.filter((p: any) => p.exercise_name === prFilter),
    [prs, prFilter],
  );

  // Volume data with stable colours + short labels.
  const volumeData = useMemo(
    () => {
      // Merge raw muscle_group strings that collapse to the same short label.
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
    },
    [volume],
  );

  const rangeOptions: SearchableOption[] = [
    { value: "7", label: "Last 7 days" },
    { value: "30", label: "Last 30 days" },
    { value: "90", label: "Last 90 days" },
    { value: "365", label: "Last year" },
  ];
  const volumeRangeOptions: SearchableOption[] = [
    { value: "7", label: "Last 7 days" },
    { value: "14", label: "Last 14 days" },
    { value: "30", label: "Last 30 days" },
  ];

  // Summary stats (display only; computed from already-loaded data).
  const summary = useMemo(() => {
    const now = Date.now();
    const prs30 = (results as any[]).length
      ? recentPRs(results as any[], 30).length
      : 0;
    const last7Sets = (results as any[]).filter(
      (r: any) => r.date && now - new Date(r.date).getTime() <= 7 * 86400000,
    ).length;
    const workouts = new Set(
      (results as any[])
        .filter((r: any) => r.date)
        .map((r: any) => format(new Date(r.date), "yyyy-MM-dd")),
    ).size;
    // Top improved lift in selected range.
    const top = [...prs].sort((a: any, b: any) => b.delta - a.delta)[0];
    return {
      prs30,
      last7Sets,
      workouts,
      topLift: top
        ? { name: top.exercise_name, delta: conv(top.delta) }
        : null,
    };
  }, [results, prs, conv]);

  return (
    <>
      <PageHeader title="Training Analytics" subtitle={client?.full_name ?? ""} />
      <div className="space-y-6 p-4 pb-10 md:p-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
          <Link
            to="/portal/workouts"
            className="inline-flex min-w-0 items-center truncate text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4 shrink-0" />
            <span className="truncate">Back to workouts</span>
          </Link>
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
        </div>

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Loading your training data…
          </Card>
        ) : (results as any[]).length === 0 ? (
          <Card className="p-10 text-center">
            <Dumbbell className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-base font-semibold text-foreground">
              No workouts logged yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Log your first working set to start tracking estimated strength.
            </p>
          </Card>
        ) : (
          <>
            {/* SUMMARY STATS */}
            <section
              aria-label="Summary"
              className="grid grid-cols-2 gap-3 md:grid-cols-4"
            >
              <StatCard
                icon={<Trophy className="h-4 w-4" />}
                label="PRs · 30d"
                value={String(summary.prs30)}
                color={ANALYTICS_COLORS.green}
              />
              <StatCard
                icon={<Flame className="h-4 w-4" />}
                label="Sets · 7d"
                value={String(summary.last7Sets)}
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

            {/* RECENT PRS */}
            {client?.id && (
              <section aria-label="Planned vs Actual">
                <PlannedVsActualCard
                  clientId={client.id}
                  formula={analyticsSettings?.e1rm_formula}
                  workingRpeMin={analyticsSettings?.working_set_rpe_min}
                />
              </section>
            )}

            <section>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
                <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
                  <Trophy className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate">Recent PRs</span>
                </h2>
                <div className="flex shrink-0 items-center gap-2">
                  <SearchableSelect
                    options={rangeOptions}
                    value={String(rangeDays)}
                    onChange={(v) => setRangeDays(Number(v))}
                    triggerClassName="h-9 w-36"
                    ariaLabel="PR range"
                  />
                </div>
              </div>
              <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <SearchableSelect
                  options={prOptions}
                  value={prFilter}
                  onChange={setPrFilter}
                  placeholder="Filter exercise"
                  searchPlaceholder="Search PR exercise…"
                  emptyText="No exercises match your search."
                  triggerClassName="h-9"
                  ariaLabel="Filter PRs by exercise"
                />
              </div>
              {filteredPrs.length === 0 ? (
                <Card className="p-6 text-base text-muted-foreground">
                  {prs.length === 0
                    ? "No new PRs in the selected range."
                    : "No PRs match this filter."}
                </Card>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filteredPrs.map((p: any) => {
                    const color = exerciseColor(p.exercise_name, p.muscle_group);
                    return (
                      <Card
                        key={p.id}
                        className="relative overflow-hidden border-border/80 bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
                        style={{ borderLeft: `4px solid ${color}` }}
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <div className="min-w-0 text-base font-extrabold leading-tight text-foreground">
                            <span className="truncate">{p.exercise_name}</span>
                          </div>
                          <Badge
                            className="shrink-0 border-transparent text-xs font-bold"
                            style={{
                              background: `color-mix(in oklab, ${ANALYTICS_COLORS.green} 18%, transparent)`,
                              color: ANALYTICS_COLORS.green,
                            }}
                          >
                            {fmtDelta(conv(p.delta), displayUnit)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs font-medium text-muted-foreground">
                          {format(new Date(p.date), "MMM d, yyyy")}
                        </div>
                        <div className="mt-3 text-3xl font-black tracking-tight text-foreground">
                          {fmtNum(conv(p.est_1rm))}{" "}
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {displayUnit} · est 1RM
                          </span>
                        </div>
                        <div className="mt-2 text-sm font-medium text-foreground/80">
                          {fmtWeight(conv(p.load), displayUnit)} × {p.reps}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Previous best{" "}
                          {fmtWeight(conv(p.prior_est), displayUnit)}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ESTIMATED 1RM */}
            <section>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
                <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
                  <TrendingUp className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate">Estimated 1RM Progress</span>
                </h2>
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
                              domain={["auto", "auto"]}
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
                                      {fmtNum(d.est)} {displayUnit}{" "}
                                      <span className="text-xs font-medium text-muted-foreground">
                                        est 1RM
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {fmtNum(d.load)} {displayUnit} × {d.reps}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="est"
                              stroke="none"
                              fill={`url(#fill-${activeEx.replace(/\W+/g, "")})`}
                            />
                            <Line
                              type="monotone"
                              dataKey="est"
                              stroke={activeColor}
                              strokeWidth={2.5}
                              dot={{ r: 3.5, fill: activeColor, strokeWidth: 0 }}
                              activeDot={{ r: 6, strokeWidth: 0 }}
                            />
                            {activePr && lineData.length > 1 && (
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

            {/* WEEKLY VOLUME */}
            <section>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
                <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
                  <Dumbbell className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate">Volume by Muscle Group</span>
                </h2>
                <SearchableSelect
                  options={volumeRangeOptions}
                  value={String(volumeDays)}
                  onChange={(v) => setVolumeDays(Number(v))}
                  triggerClassName="h-9 w-36 shrink-0"
                  ariaLabel="Volume range"
                />
              </div>
              {volumeData.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">
                  No working sets logged in the last {volumeDays} days.
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
                                  {d.sets} {d.sets === 1 ? "set" : "sets"} · last {volumeDays} days
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
          </>
        )}
      </div>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
  color,
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