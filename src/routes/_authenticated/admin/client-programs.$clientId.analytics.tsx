import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp, Trophy, Dumbbell } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell } from "recharts";
import { getClientResults, buildExerciseHistory, weeklyMuscleVolume, recentPRs } from "@/lib/pl-programs";
import { format } from "date-fns";
import { SearchableSelect, type SearchableOption } from "@/components/analytics/searchable-select";
import { ANALYTICS_COLORS, exerciseColor, exerciseGroup, fmtNum, fmtDelta, muscleColor, shortMuscleLabel } from "@/lib/analytics-format";

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/analytics")({ component: AnalyticsPage });

function AnalyticsPage() {
  const { clientId } = Route.useParams();
  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("id", clientId).maybeSingle()).data,
  });
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results", clientId],
    queryFn: () => getClientResults(clientId),
  });

  const history = useMemo(() => buildExerciseHistory(results as any), [results]);
  const volume = useMemo(() => weeklyMuscleVolume(results as any[], 7), [results]);
  const prs = useMemo(() => recentPRs(results as any[], 30), [results]);
  const [selectedEx, setSelectedEx] = useState<string>("");
  const activeEx = selectedEx || history[0]?.name || "";
  const activeSeries = history.find((h) => h.name === activeEx);
  const activeColor = exerciseColor(activeEx, activeSeries?.points?.[0]?.muscle_group);

  const exerciseOptions: SearchableOption[] = useMemo(
    () =>
      history.map((h: any) => ({
        value: h.name,
        label: h.name,
        group: exerciseGroup(h.name, h.points?.[0]?.category),
        hint: `${fmtNum(h.pr?.est_1rm ?? 0)}`,
        color: exerciseColor(h.name, h.points?.[0]?.muscle_group),
      })),
    [history],
  );

  const volumeData = useMemo(
    () => {
      // Merge raw muscle_group strings that collapse to the same short label
      // (e.g. "Lats, upper back, biceps" and "Lats, upper back, rear delts, biceps" → "Lats").
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

  const gridStroke = "color-mix(in oklab, var(--border) 60%, transparent)";
  const axisColor = "var(--muted-foreground)";

  return (
    <>
      <PageHeader title="Training Analytics" subtitle={client?.full_name ?? ""} />
      <div className="p-6 md:p-8 space-y-6">
        <Link to="/admin/client-programs/$clientId" params={{ clientId }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to programs
        </Link>

        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (results as any[]).length === 0 ? (
          <Card className="p-10 text-center">
            <Dumbbell className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No logged sets yet. Analytics appear once the client starts logging workouts.</p>
          </Card>
        ) : (
          <>
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <Trophy className="h-4 w-4" /> Recent PRs (last 30 days)
              </h2>
              {prs.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No new PRs in the last 30 days.</Card> : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {prs.map((p: any) => {
                    const color = exerciseColor(p.exercise_name, p.muscle_group);
                    return (
                      <Card key={p.id} className="p-4" style={{ borderLeft: `4px solid ${color}` }}>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <div className="min-w-0 truncate font-bold">{p.exercise_name}</div>
                          <Badge variant="outline" className="shrink-0 border-transparent" style={{ background: `color-mix(in oklab, ${ANALYTICS_COLORS.green} 18%, transparent)`, color: ANALYTICS_COLORS.green }}>
                            {fmtDelta(p.delta, "")}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{format(new Date(p.date), "MMM d, yyyy")}</div>
                        <div className="mt-2 text-2xl font-black">{fmtNum(p.est_1rm)} <span className="text-xs font-normal text-muted-foreground">est 1RM</span></div>
                        <div className="mt-1 text-xs text-muted-foreground">{fmtNum(p.load)} × {p.reps} · prev best {fmtNum(p.prior_est)}</div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  <TrendingUp className="h-4 w-4" /> Estimated 1RM Progress
                </h2>
                <div className="w-full sm:w-72">
                  <SearchableSelect
                    options={exerciseOptions}
                    value={activeEx}
                    onChange={setSelectedEx}
                    placeholder="Select exercise"
                    searchPlaceholder="Search exercise…"
                    triggerClassName="h-9"
                    ariaLabel="Select exercise"
                  />
                </div>
              </div>
              {activeSeries && (
                <Card className="p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>PR: <span className="font-bold text-foreground">{fmtNum(activeSeries.pr?.est_1rm)}</span> on {activeSeries.pr?.date && format(new Date(activeSeries.pr.date), "MMM d")}</span>
                    <span>{activeSeries.points.length} logged sets</span>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={activeSeries.points.map((p) => ({ date: format(new Date(p.date), "MMM d"), est: Number(p.est_1rm.toFixed(1)), load: Number(p.load.toFixed(1)), reps: p.reps }))} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="date" stroke={axisColor} fontSize={11} minTickGap={20} />
                        <YAxis stroke={axisColor} fontSize={11} tickFormatter={(v) => fmtNum(v)} width={40} />
                        <Tooltip
                          wrapperStyle={{ outline: "none" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d: any = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-xl">
                                <div className="text-xs font-bold uppercase text-muted-foreground">{d.date}</div>
                                <div className="mt-1 font-extrabold text-foreground">{fmtNum(d.est)} <span className="text-xs font-medium text-muted-foreground">est 1RM</span></div>
                                <div className="text-xs text-muted-foreground">{fmtNum(d.load)} × {d.reps}</div>
                              </div>
                            );
                          }}
                        />
                        <Line type="monotone" dataKey="est" stroke={activeColor} strokeWidth={2.5} dot={{ r: 3, fill: activeColor, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}
            </section>

            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <Dumbbell className="h-4 w-4" /> Weekly Volume by Muscle Group (last 7 days)
              </h2>
              {volumeData.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No sets logged in the last 7 days.</Card> : (
                <Card className="p-4">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={volumeData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                        <XAxis type="number" stroke={axisColor} fontSize={11} allowDecimals={false} />
                        <YAxis type="category" dataKey="label" stroke={axisColor} fontSize={12} width={96} interval={0} tick={{ fill: "var(--foreground)" }} />
                        <Tooltip
                          wrapperStyle={{ outline: "none" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d: any = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-xl">
                                <div className="flex items-center gap-2 font-extrabold text-foreground"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: d.color }} />{d.muscle}</div>
                                <div className="text-xs text-muted-foreground">{d.sets} {d.sets === 1 ? "set" : "sets"}</div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="sets" radius={[0, 6, 6, 0]}>
                          {volumeData.map((d, i) => <Cell key={i} fill={d.color} />)}
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