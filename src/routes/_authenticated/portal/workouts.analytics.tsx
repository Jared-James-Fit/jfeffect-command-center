import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, TrendingUp, Trophy, Dumbbell, Search } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar,
} from "recharts";
import {
  getClientResults, buildExerciseHistory, weeklyMuscleVolume, recentPRs,
} from "@/lib/pl-programs";
import { format } from "date-fns";

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
function fmtWeight(value: number, unit: Unit) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} ${unit}`;
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

  const sourceUnit: Unit = (client?.preferred_weight_unit === "kg" ? "kg" : "lb");
  const [displayUnit, setDisplayUnit] = useState<Unit>(sourceUnit);
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [volumeDays, setVolumeDays] = useState<number>(7);
  const [search, setSearch] = useState("");
  const [selectedEx, setSelectedEx] = useState<string>("");

  const history = useMemo(() => buildExerciseHistory(results as any), [results]);
  const volume = useMemo(
    () => weeklyMuscleVolume(results as any[], volumeDays),
    [results, volumeDays],
  );
  const prs = useMemo(
    () => recentPRs(results as any[], rangeDays),
    [results, rangeDays],
  );

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.name.toLowerCase().includes(q));
  }, [history, search]);

  const activeEx = selectedEx || filteredHistory[0]?.name || history[0]?.name || "";
  const activeSeries = history.find((h) => h.name === activeEx);

  const conv = (v: number) => convertWeight(Number(v) || 0, sourceUnit, displayUnit);

  // Chart palette — themed accents, high contrast in dark mode.
  const chartLine = "hsl(var(--primary))";
  const chartBar = "hsl(var(--primary))";
  const gridStroke = "hsl(var(--border) / 0.6)";
  const axisColor = "hsl(var(--muted-foreground))";

  const lineData = activeSeries?.points.map((p: any) => ({
    date: format(new Date(p.date), "MMM d"),
    est: Number(conv(p.est_1rm).toFixed(1)),
    load: Number(conv(p.load).toFixed(1)),
    reps: p.reps,
    raw: p.date,
  })) ?? [];

  const activePr = activeSeries?.pr;

  return (
    <>
      <PageHeader title="Training Analytics" subtitle={client?.full_name ?? ""} />
      <div className="space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/portal/workouts"
            className="inline-flex items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to workouts
          </Link>
          <div className="flex items-center gap-2">
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
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (results as any[]).length === 0 ? (
          <Card className="p-10 text-center">
            <Dumbbell className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              No logged sets yet. Analytics appear once you start logging workouts.
            </p>
          </Card>
        ) : (
          <>
            {/* RECENT PRS */}
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
                  <Trophy className="h-5 w-5 text-primary" /> Recent PRs
                </h2>
                <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
                  <SelectTrigger className="h-9 w-36 text-sm font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="365">Last year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {prs.length === 0 ? (
                <Card className="p-6 text-base text-muted-foreground">
                  No new PRs in the selected range.
                </Card>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {prs.map((p: any) => (
                    <Card
                      key={p.id}
                      className="border-border/80 bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 text-base font-extrabold leading-tight text-foreground">
                          {p.exercise_name}
                        </div>
                        <Badge className="shrink-0 border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
                          +{conv(p.delta).toFixed(1)} {displayUnit}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs font-medium text-muted-foreground">
                        {format(new Date(p.date), "MMM d, yyyy")}
                      </div>
                      <div className="mt-3 text-3xl font-black tracking-tight text-foreground">
                        {conv(p.est_1rm).toFixed(1)}{" "}
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {displayUnit} · est 1RM
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-medium text-foreground/80">
                        {conv(p.load).toFixed(1)} {displayUnit} × {p.reps}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Previous best {conv(p.prior_est).toFixed(1)} {displayUnit}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* ESTIMATED 1RM */}
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
                  <TrendingUp className="h-5 w-5 text-primary" /> Estimated 1RM Progress
                </h2>
              </div>
              <Card className="border-border/80 bg-card p-4">
                <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setSelectedEx(""); }}
                      placeholder="Search exercise…"
                      className="h-10 pl-9 text-sm"
                    />
                  </div>
                  <Select value={activeEx} onValueChange={setSelectedEx}>
                    <SelectTrigger className="h-10 w-full text-sm sm:w-72">
                      <SelectValue placeholder="Select exercise" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredHistory.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No exercises match “{search}”.
                        </div>
                      ) : (
                        filteredHistory.map((h) => (
                          <SelectItem key={h.name} value={h.name}>
                            {h.name} · {conv(h.pr?.est_1rm ?? 0).toFixed(1)} {displayUnit}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {activeSeries ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          {activeEx}
                        </div>
                        <div className="mt-0.5 text-2xl font-black text-foreground">
                          {conv(activePr?.est_1rm ?? 0).toFixed(1)}{" "}
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
                      <div className="text-xs font-semibold text-muted-foreground">
                        {activeSeries.points.length} logged sets
                      </div>
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lineData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                          <XAxis dataKey="date" stroke={axisColor} fontSize={12} tickMargin={6} />
                          <YAxis stroke={axisColor} fontSize={12} tickMargin={4}
                            domain={["auto", "auto"]}
                            tickFormatter={(v) => `${v}`}
                          />
                          <Tooltip
                            cursor={{ stroke: "hsl(var(--primary) / 0.4)", strokeWidth: 1 }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const d: any = payload[0].payload;
                              return (
                                <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-sm shadow-xl backdrop-blur">
                                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    {d.date}
                                  </div>
                                  <div className="mt-1 font-extrabold text-foreground">
                                    {d.est} {displayUnit} <span className="text-xs font-medium text-muted-foreground">est 1RM</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {d.load} {displayUnit} × {d.reps}
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Line
                            type="monotone" dataKey="est"
                            stroke={chartLine} strokeWidth={2.5}
                            dot={{ r: 4, fill: chartLine, strokeWidth: 0 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
                  <Dumbbell className="h-5 w-5 text-primary" /> Volume by Muscle Group
                </h2>
                <Select value={String(volumeDays)} onValueChange={(v) => setVolumeDays(Number(v))}>
                  <SelectTrigger className="h-9 w-36 text-sm font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="14">Last 14 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {volume.length === 0 ? (
                <Card className="p-6 text-base text-muted-foreground">
                  No sets logged in the selected range.
                </Card>
              ) : (
                <Card className="border-border/80 bg-card p-4">
                  <div style={{ height: Math.max(240, volume.length * 36) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={volume}
                        layout="vertical"
                        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                        <XAxis type="number" stroke={axisColor} fontSize={12} allowDecimals={false} />
                        <YAxis
                          type="category" dataKey="muscle"
                          stroke={axisColor} fontSize={12}
                          width={140}
                          tick={{ fill: "hsl(var(--foreground))" }}
                        />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--primary) / 0.08)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d: any = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-sm shadow-xl backdrop-blur">
                                <div className="font-extrabold text-foreground">{d.muscle}</div>
                                <div className="text-xs text-muted-foreground">
                                  {d.sets} {d.sets === 1 ? "set" : "sets"} · last {volumeDays} days
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="sets" fill={chartBar} radius={[0, 6, 6, 0]} />
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