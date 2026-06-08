import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Activity, FileText, Dumbbell, ChevronRight } from "lucide-react";
import { getClientWorkouts, durationRange } from "@/lib/pl-programs";

export const Route = createFileRoute("/_authenticated/portal/workouts")({ component: WorkoutsPage });

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-workouts", client?.id],
    enabled: !!client?.id,
    queryFn: () => getClientWorkouts(client!.id),
  });

  const groups = new Map<string, { block: any; entries: any[] }>();
  for (const it of items as any[]) {
    const k = it.block?.id ?? "none";
    if (!groups.has(k)) groups.set(k, { block: it.block, entries: [] });
    groups.get(k)!.entries.push(it);
  }

  return (
    <>
      <PageHeader title="Workouts" subtitle="Your assigned training" />
      <div className="p-6 md:p-8 space-y-6">
        <div className="grid gap-2 sm:grid-cols-2">
          <Link to="/portal/program">
            <Card className="flex items-center justify-between p-3 hover:bg-secondary/30">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-bold">My Program</div>
                  <div className="text-[11px] text-muted-foreground">Current phase, prep & program sheet</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Card>
          </Link>
          <Link to="/portal/exercises">
            <Card className="flex items-center justify-between p-3 hover:bg-secondary/30">
              <div className="flex items-center gap-3">
                <Dumbbell className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-bold">Exercise Library</div>
                  <div className="text-[11px] text-muted-foreground">Demos & technique videos</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Card>
          </Link>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : groups.size === 0 ? (
          <Card className="p-10 text-center">
            <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No workouts assigned yet. Your coach will publish your block soon.</p>
          </Card>
        ) : (
          [...groups.values()].map(({ block, entries }) => (
            <section key={block?.id ?? "none"}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">{block?.name ?? "Workouts"}</h2>
              <div className="grid gap-2">
                {entries.map((it) => (
                  <Link key={it.day.id} to="/portal/workouts/$dayId" params={{ dayId: it.day.id }}>
                    <Card className="p-3 flex items-center justify-between hover:bg-secondary/30">
                      <div>
                        <div className="font-bold">{it.day.title || `Day ${it.day.day_index}`}</div>
                        <div className="text-xs text-muted-foreground">Week {it.week?.week_index} {it.day.focus ? `· ${it.day.focus}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {it.completion ? (
                          <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10"><CheckCircle2 className="mr-1 h-3 w-3" /> Done</Badge>
                        ) : (
                          <Badge variant="outline"><Clock className="mr-1 h-3 w-3" /> {durationRange(it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60)}</Badge>
                        )}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}