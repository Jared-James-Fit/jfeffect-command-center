import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, RotateCcw, BookOpen } from "lucide-react";
import { restartPlan } from "@/lib/member-plans.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/m/my-plans")({ component: MyPlans });

function MyPlans() {
  const fetchMe = useServerFn(getCurrentMember);
  const restart = useServerFn(restartPlan);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });

  const { data: enrollments = [], refetch } = useQuery({
    queryKey: ["m-enrollments", me?.member?.id],
    enabled: !!me?.member?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(name, weeks, days_per_week, cover_image_url)")
        .eq("member_id", me!.member!.id)
        .order("started_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const active = enrollments.filter((e) => e.status === "Active");
  const completed = enrollments.filter((e) => e.status === "Completed");
  const abandoned = enrollments.filter((e) => e.status === "Abandoned");

  const onRestart = async (id: string) => {
    try { await restart({ data: { enrollmentId: id } }); toast.success("Plan restarted"); await refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't restart"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="My Plans" subtitle="Your active and completed training plans." />
      <Section title="Active">
        {active.length === 0 && <Empty msg="No active plan. Browse the library to start one." />}
        {active.map((e) => <EnrollmentCard key={e.id} e={e} primary />)}
      </Section>
      <Section title="Completed">
        {completed.length === 0 && <Empty msg="Nothing here yet." />}
        {completed.map((e) => <EnrollmentCard key={e.id} e={e} onRestart={() => onRestart(e.id)} />)}
      </Section>
      {abandoned.length > 0 && (
        <Section title="Abandoned">
          {abandoned.map((e) => <EnrollmentCard key={e.id} e={e} onRestart={() => onRestart(e.id)} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
function Empty({ msg, action }: { msg: string; action?: React.ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground sm:col-span-2 space-y-2">
      <div>{msg}</div>
      {action}
    </div>
  );
}
function EnrollmentCard({ e, primary, onRestart }: { e: any; primary?: boolean; onRestart?: () => void }) {
  const pct = Math.round(((e.workouts_completed ?? 0) / Math.max(e.workouts_total ?? 1, 1)) * 100);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{e.member_plans?.name ?? "Plan"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Week {e.current_week} · {e.workouts_completed}/{e.workouts_total} workouts
          </div>
        </div>
        <Badge variant={e.status === "Completed" ? "default" : e.status === "Active" ? "secondary" : "outline"}>{e.status}</Badge>
      </div>
      <Progress value={pct} className="mt-3" />
      <div className="mt-4 flex gap-2">
        <Link to="/m/my-plans/$enrollmentId" params={{ enrollmentId: e.id }} className="flex-1">
          <Button variant={primary ? "default" : "outline"} className="w-full">
            <PlayCircle className="mr-2 h-4 w-4" />{e.status === "Active" ? "Continue" : "View"}
          </Button>
        </Link>
        {onRestart && (
          <Button variant="ghost" size="icon" onClick={onRestart} title="Restart">
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}