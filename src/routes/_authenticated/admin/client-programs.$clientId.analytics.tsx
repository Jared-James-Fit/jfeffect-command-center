import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, TrendingUp, Trophy, Dumbbell } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from "recharts";
import { getClientResults, buildExerciseHistory, weeklyMuscleVolume, recentPRs } from "@/lib/pl-programs";
import { format } from "date-fns";

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
                  {prs.map((p: any) => (
                    <Card key={p.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-bold">{p.exercise_name}</div>
                        <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10">+{p.delta.toFixed(1)}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{format(new Date(p.date), "MMM d, yyyy")}</div>
                      <div className="mt-2 text-2xl font-black">{p.est_1rm} <span className="text-xs font-normal text-muted-foreground">est 1RM</span></div>
                      <div className="mt-1 text-xs text-muted-foreground">{p.load} × {p.reps} (prev best {p.prior_est})</div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  <TrendingUp className="h-4 w-4" /> Estimated 1RM Progress
                </h2>
                <Select value={activeEx} onValueChange={setSelectedEx}>
                  <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {history.map((h) => <SelectItem key={h.name} value={h.name}>{h.name} ({h.pr?.est_1rm})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {activeSeries && (
                <Card className="p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>PR: <span className="font-bold text-foreground">{activeSeries.pr?.est_1rm}</span> on {activeSeries.pr?.date && format(new Date(activeSeries.pr.date), "MMM d")}</span>
                    <span>{activeSeries.points.length} logged sets</span>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={activeSeries.points.map((p) => ({ date: format(new Date(p.date), "MMM d"), est: p.est_1rm }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Line type="monotone" dataKey="est" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
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
              {volume.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No sets logged in the last 7 days.</Card> : (
                <Card className="p-4">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={volume}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="muscle" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Bar dataKey="sets" fill="hsl(var(--primary))" />
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