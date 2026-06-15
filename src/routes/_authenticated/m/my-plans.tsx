import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlayCircle, RotateCcw, BookOpen, Eye, Plus, Calendar, Clock } from "lucide-react";
import { restartPlan } from "@/lib/member-plans.functions";
import { listMembershipLibrary, enrollLibraryPlan } from "@/lib/membership-library.functions";
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
      <PageHeader title="Training" subtitle="Your plans and the full Program Library." />
      <Tabs defaultValue="my-plans" className="space-y-6">
        <TabsList>
          <TabsTrigger value="my-plans">My Plans</TabsTrigger>
          <TabsTrigger value="library">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" />
            Program Library
          </TabsTrigger>
        </TabsList>
        <TabsContent value="my-plans" className="space-y-6">
          <Section title="Active">
        {active.length === 0 && (
          <Empty
            msg="No active plan."
            action={
                <Button variant="outline" size="sm">
                  <BookOpen className="mr-2 h-4 w-4" />
                  Browse Program Library
                </Button>
            }
          />
        )}
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
        </TabsContent>
        <TabsContent value="library" className="space-y-3">
          <LibraryTab onEnrolled={refetch} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LibraryTab({ onEnrolled }: { onEnrolled?: () => void }) {
  const fetchLibrary = useServerFn(listMembershipLibrary);
  const enroll = useServerFn(enrollLibraryPlan);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["m-membership-library"],
    queryFn: () => fetchLibrary(),
  });
  const plans = (data?.plans ?? []) as any[];

  const handleAdd = async (planId: string, confirmReplace = false) => {
    try {
      const res = await enroll({ data: { planId, importMode: "full", confirmReplace } });
      if (res.conflict) {
        const ok = window.confirm(
          "You already have an active plan. Starting this one will end your current plan. Continue?"
        );
        if (ok) return handleAdd(planId, true);
        return;
      }
      toast.success("Program added to your training");
      qc.invalidateQueries({ queryKey: ["m-enrollments"] });
      onEnrolled?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add program");
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading programs…</div>;
  }
  if (plans.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No programs are available in your library yet. Check back soon.
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((p) => (
        <Card key={p.id} className="flex flex-col overflow-hidden p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.public_title || p.name}</div>
              <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                {p.training_style ?? "custom"} · {p.difficulty ?? "All Levels"}
              </div>
            </div>
            {p.featured && <Badge>Featured</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {p.weeks ?? "—"}w · {p.days_per_week ?? "—"}/wk
            </span>
            {p.est_minutes_per_workout && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />{p.est_minutes_per_workout} min
              </span>
            )}
          </div>
          {p.description && (
            <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
          )}
          <div className="mt-auto flex gap-2 pt-4">
            <Link to="/m/plans/$planId" params={{ planId: p.id }} className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                <Eye className="mr-1 h-3.5 w-3.5" /> Preview
              </Button>
            </Link>
            <Button size="sm" className="flex-1" onClick={() => handleAdd(p.id)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add to My Training
            </Button>
          </div>
        </Card>
      ))}
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