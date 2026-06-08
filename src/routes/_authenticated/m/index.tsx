import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BookOpen, ClipboardCheck, FolderOpen, Wrench, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/")({ component: MemberHome });

function MemberHome() {
  const fetchMe = useServerFn(getCurrentMember);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });

  const { data: activeEnrollment } = useQuery({
    queryKey: ["m-active", me?.member?.id],
    enabled: !!me?.member?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(id,name,weeks,days_per_week,cover_image_url)")
        .eq("member_id", me!.member!.id)
        .eq("status", "Active")
        .maybeSingle();
      return data as any;
    },
  });

  const accessKeys = new Set((me?.access ?? []).map((a: any) => a.access_level_key));
  const subscriptionStatus = me?.member?.status ?? "—";
  const progress = activeEnrollment
    ? Math.round(((activeEnrollment.workouts_completed ?? 0) / Math.max(activeEnrollment.workouts_total ?? 1, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome${me?.member?.full_name ? `, ${me.member.full_name.split(" ")[0]}` : ""}`}
        subtitle="Your training, plans, and resources."
        actions={<Badge variant="outline">{subscriptionStatus}</Badge>}
      />
      {activeEnrollment ? (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
              <div className="mt-1 text-lg font-bold">{activeEnrollment.member_plans?.name}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                Week {activeEnrollment.current_week} · {activeEnrollment.workouts_completed} of {activeEnrollment.workouts_total} workouts
              </div>
            </div>
            <Link to="/m/my-plans/$enrollmentId" params={{ enrollmentId: activeEnrollment.id }}>
              <Button><PlayCircle className="mr-2 h-4 w-4" />Continue</Button>
            </Link>
          </div>
          <Progress value={progress} className="mt-4" />
        </Card>
      ) : (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">You don't have an active plan yet.</div>
          <Link to="/m/plans" className="mt-3 inline-block">
            <Button><BookOpen className="mr-2 h-4 w-4" />Browse Program Library</Button>
          </Link>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <QuickCard to="/m/my-plans" icon={ClipboardCheck} label="My Plans" />
        <QuickCard to="/m/plans" icon={BookOpen} label="Program Library" />
        <QuickCard to="/m/resources" icon={FolderOpen} label="Resources" />
        <QuickCard to="/m/tools" icon={Wrench} label="Tools" />
      </div>
      <Card className="p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Your access</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {accessKeys.size ? Array.from(accessKeys).map((k) => (
            <Badge key={String(k)} variant="secondary">{String(k)}</Badge>
          )) : (
            <div className="text-sm text-muted-foreground">No active access yet. Contact support.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function QuickCard({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link to={to}>
      <Card className="p-5 transition hover:bg-muted/40">
        <Icon className="h-5 w-5 text-primary" />
        <div className="mt-3 text-sm font-semibold">{label}</div>
      </Card>
    </Link>
  );
}