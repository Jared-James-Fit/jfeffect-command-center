import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/my-plans/$enrollmentId")({ component: EnrollmentView });

function EnrollmentView() {
  const { enrollmentId } = Route.useParams();

  const { data: enr } = useQuery({
    queryKey: ["m-enrollment", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(*)")
        .eq("id", enrollmentId).maybeSingle();
      return data as any;
    },
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["m-completions", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions").select("*")
        .eq("enrollment_id", enrollmentId);
      return (data ?? []) as any[];
    },
  });

  if (!enr) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const weeks = enr.member_plans?.published_payload?.weeks_data ?? [];
  const doneSet = new Set(completions.map((c: any) => `${c.week_index}:${c.day_index}`));
  const pct = Math.round(((enr.workouts_completed ?? 0) / Math.max(enr.workouts_total ?? 1, 1)) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title={enr.member_plans?.name}
        subtitle={`Week ${enr.current_week} · ${enr.workouts_completed}/${enr.workouts_total} workouts`}
        actions={<Badge>{enr.status}</Badge>}
      />
      <Progress value={pct} />
      <div className="space-y-4">
        {weeks.map((w: any) => (
          <Card key={w.week_index} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Week {w.week_index}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(w.days ?? []).map((d: any) => {
                const done = doneSet.has(`${w.week_index}:${d.day_index}`);
                return (
                  <Link
                    key={d.day_index}
                    to="/m/workouts/$enrollmentId/$week/$day"
                    params={{ enrollmentId, week: String(w.week_index), day: String(d.day_index) }}
                  >
                    <div className="flex items-center justify-between rounded-md border bg-card p-3 transition hover:bg-muted/40">
                      <div className="flex items-center gap-2">
                        {done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                        <div>
                          <div className="text-sm font-medium">{d.title || `Day ${d.day_index}`}</div>
                          <div className="text-xs text-muted-foreground">{(d.rows?.length ?? 0)} exercises</div>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}