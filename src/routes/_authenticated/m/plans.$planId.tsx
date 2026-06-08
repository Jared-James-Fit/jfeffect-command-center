import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { startPlan } from "@/lib/member-plans.functions";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, PlayCircle, Calendar, Clock } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/m/plans/$planId")({ component: PlanDetail });

function PlanDetail() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const fetchMe = useServerFn(getCurrentMember);
  const start = useServerFn(startPlan);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const [conflict, setConflict] = useState(false);

  const { data: plan } = useQuery({
    queryKey: ["m-plan", planId],
    queryFn: async () => {
      const { data } = await supabase.from("member_plans").select("*").eq("id", planId).maybeSingle();
      return data as any;
    },
  });

  if (!plan) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const accessKeys = new Set((me?.access ?? []).map((a: any) => a.access_level_key));
  const unlocked = accessKeys.has(plan.required_access_level);
  const weeks = plan.published_payload?.weeks_data ?? [];

  const handleStart = async (confirmReplace = false) => {
    try {
      const res = await start({ data: { planId, confirmReplace } });
      if (res.conflict) { setConflict(true); return; }
      toast.success("Plan started");
      navigate({ to: "/m/my-plans/$enrollmentId", params: { enrollmentId: res.enrollmentId! } });
    } catch (e: any) { toast.error(e?.message ?? "Couldn't start plan"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={plan.name}
        subtitle={plan.description ?? undefined}
        actions={unlocked
          ? <Button onClick={() => handleStart(false)}><PlayCircle className="mr-2 h-4 w-4" />Start Plan</Button>
          : <Badge variant="secondary"><Lock className="mr-1 h-3.5 w-3.5" />Locked</Badge>}
      />
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Calendar className="h-4 w-4" />{plan.weeks} weeks · {plan.days_per_week}/wk</span>
        {plan.est_minutes_per_workout && <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />{plan.est_minutes_per_workout} min/workout</span>}
        <Badge variant="outline">{plan.training_style}</Badge>
        <Badge variant="outline">{plan.difficulty}</Badge>
      </div>
      {Array.isArray(plan.equipment_needed) && plan.equipment_needed.length > 0 && (
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Equipment</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {plan.equipment_needed.map((eq: string) => <Badge key={eq} variant="secondary">{eq}</Badge>)}
          </div>
        </Card>
      )}
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Weekly structure</div>
        <div className="mt-3 space-y-3">
          {weeks.map((w: any) => (
            <div key={w.week_index} className="rounded-md border p-3">
              <div className="text-sm font-semibold">Week {w.week_index}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(w.days ?? []).map((d: any) => (
                  <div key={d.day_index} className="rounded border bg-muted/30 p-2 text-sm">
                    <div className="font-medium">{d.title || `Day ${d.day_index}`}</div>
                    <div className="text-xs text-muted-foreground">{(d.rows?.length ?? 0)} exercises</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have an active plan</AlertDialogTitle>
            <AlertDialogDescription>Starting this plan will end your current one. Continue?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConflict(false); void handleStart(true); }}>Switch plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}