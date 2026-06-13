import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, AlertTriangle, CheckCircle2, MessageCircle, Star } from "lucide-react";
import { getCompletedHistory } from "@/lib/pl-programs";
import { ProgressComparison } from "@/components/progress-comparison";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/history")({ component: HistoryPage });

function HistoryPage() {
  const { clientId } = Route.useParams();
  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => (await supabase.from("clients").select("id, full_name, preferred_weight_unit").eq("id", clientId).maybeSingle()).data,
  });
  const { data: history } = useQuery({
    queryKey: ["pl-history", clientId],
    queryFn: () => getCompletedHistory(clientId),
  });
  // Build per-exercise summary from this client's logged results so the
  // coach can search and drill into any single exercise's set history.
  const { data: results = [] } = useQuery({
    queryKey: ["pl-results-summary", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pl_row_results")
        .select("id, completed_at, pl_exercise_rows!inner(exercise_id, exercises(id, name))")
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const exerciseSummary = useMemo(() => {
    const map = new Map<string, { id: string; name: string; sets: number; last: string | null }>();
    for (const r of results as any[]) {
      const ex = r.pl_exercise_rows?.exercises;
      if (!ex?.id) continue;
      const cur = map.get(ex.id) ?? { id: ex.id, name: ex.name ?? "Exercise", sets: 0, last: null };
      cur.sets += 1;
      if (!cur.last || (r.completed_at && r.completed_at > cur.last)) cur.last = r.completed_at;
      map.set(ex.id, cur);
    }
    return [...map.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));
  }, [results]);
  const [query, setQuery] = useState("");
  const [openEx, setOpenEx] = useState<{ id: string; name: string } | null>(null);
  const filteredExercises = exerciseSummary.filter((e) =>
    !query.trim() || e.name.toLowerCase().includes(query.toLowerCase()),
  );
  const displayUnit: "kg" | "lb" = (client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb";

  const preps = history?.preps ?? [];
  const blocks = history?.blocks ?? [];

  return (
    <>
      <PageHeader title="Program History" subtitle={client?.full_name ?? ""} />
      <div className="p-6 md:p-8 space-y-6">
        <Link to="/admin/client-programs/$clientId" params={{ clientId }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to programs
        </Link>

        <WorkoutFeedbackSection clientId={clientId} />

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Exercise Set History</h2>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search exercises…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          {filteredExercises.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No logged sets yet.</Card>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {filteredExercises.slice(0, 60).map((ex) => (
                <Card key={ex.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{ex.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {ex.sets} sets · last {ex.last ? new Date(ex.last).toLocaleDateString() : "—"}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setOpenEx({ id: ex.id, name: ex.name })}>
                      View
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {openEx && (
            <ExerciseHistorySheet
              open={!!openEx}
              onOpenChange={(v) => !v && setOpenEx(null)}
              clientId={clientId}
              exerciseId={openEx.id}
              exerciseName={openEx.name}
              displayUnit={displayUnit}
            />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Compare Progress</h2>
          <ProgressComparison clientId={clientId} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Completed Preps</h2>
          {preps.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No completed preps yet.</Card> : (
            <div className="grid gap-2 md:grid-cols-2">
              {preps.map((p: any) => (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.goal_type}</div>
                      {p.event_name && <div className="mt-1 text-xs">{p.event_name} · {p.event_date}</div>}
                    </div>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Completed Blocks</h2>
          {blocks.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No completed blocks yet.</Card> : (
            <div className="grid gap-2">
              {blocks.map((b: any) => (
                <Link key={b.id} to="/admin/blocks/$blockId" params={{ blockId: b.id }}>
                  <Card className="p-3 flex items-center justify-between hover:bg-secondary/30">
                    <div>
                      <div className="font-bold">{b.name}</div>
                      <div className="text-xs text-muted-foreground">{b.weeks} weeks · {b.training_focus ?? "—"}</div>
                    </div>
                    <Badge variant="outline">{b.status}</Badge>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function WorkoutFeedbackSection({ clientId }: { clientId: string }) {
  const { data: rows = [], refetch } = useQuery({
    queryKey: ["pl-workout-feedback-history", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pl_workout_feedback")
        .select(`
          id, completion_id, day_id, overall_rating, session_rpe,
          pain, pain_level, pain_area, pain_note, client_note,
          reviewed_at, reviewed_by, created_at,
          pl_day_completions(completed_at),
          pl_days(title, week_id, pl_weeks(week_index, block_id, pl_blocks(name)))
        `)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const markReviewed = async (id: string) => {
    const { error } = await (supabase as any).rpc("mark_workout_feedback_reviewed", {
      _feedback_id: id,
    });
    if (error) {
      toast.error("Couldn't mark reviewed", { description: error.message });
      return;
    }
    toast.success("Marked reviewed");
    refetch();
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Recent Workout Feedback</h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {rows.filter((r: any) => !r.reviewed_at).length} new
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No feedback submitted yet.</Card>
      ) : (
        <div className="grid gap-2">
          {rows.map((r: any) => {
            const dayTitle = r.pl_days?.title ?? "Workout";
            const blockName = r.pl_days?.pl_weeks?.pl_blocks?.name ?? "—";
            const weekIdx = r.pl_days?.pl_weeks?.week_index;
            const completedAt = r.pl_day_completions?.completed_at ?? r.created_at;
            const hard = (r.session_rpe ?? 0) >= 9;
            return (
              <Card
                key={r.id}
                className={
                  r.pain
                    ? "p-4 border-amber-500/40 bg-amber-500/5"
                    : "p-4"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{dayTitle}</span>
                      <span className="text-xs text-muted-foreground">
                        {blockName}{weekIdx ? ` · Week ${weekIdx}` : ""}
                      </span>
                      {r.reviewed_at && (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Reviewed
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {completedAt ? new Date(completedAt).toLocaleString() : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="font-bold">
                      <Star className="mr-1 h-3 w-3" /> {r.overall_rating}/5
                    </Badge>
                    <Badge
                      variant="outline"
                      className={hard ? "border-amber-500/50 text-amber-700 dark:text-amber-300 font-bold" : "font-bold"}
                    >
                      RPE {r.session_rpe}/10
                    </Badge>
                    {r.pain && (
                      <Badge className="border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 font-bold">
                        <AlertTriangle className="mr-1 h-3 w-3" /> Pain {r.pain_level ? `${r.pain_level}/10` : ""}
                      </Badge>
                    )}
                  </div>
                </div>
                {(r.pain || r.client_note) && (
                  <div className="mt-3 space-y-1.5 text-sm">
                    {r.pain && (r.pain_area || r.pain_note) && (
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Pain</span>
                        <div>
                          {r.pain_area ?? "Unspecified area"}
                          {r.pain_note ? ` — ${r.pain_note}` : ""}
                        </div>
                      </div>
                    )}
                    {r.client_note && (
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Note</span>
                        <p className="whitespace-pre-wrap text-foreground">{r.client_note}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!r.reviewed_at && (
                    <Button size="sm" variant="default" onClick={() => markReviewed(r.id)}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark reviewed
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/admin/messages">
                      <MessageCircle className="mr-1 h-3.5 w-3.5" /> Message client
                    </Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}