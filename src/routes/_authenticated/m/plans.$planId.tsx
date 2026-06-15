import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  recordPreviewEvent, savePlanForLater, unsavePlan, listSavedPlans,
  downloadLibraryPdf, enrollLibraryPlan,
} from "@/lib/membership-library.functions";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, PlayCircle, Calendar, Clock, Bookmark, BookmarkCheck, Download } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/m/plans/$planId")({ component: PlanDetail });

const WEEK_DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function PlanDetail() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchMe = useServerFn(getCurrentMember);
  const enroll       = useServerFn(enrollLibraryPlan);
  const recordView   = useServerFn(recordPreviewEvent);
  const saveFn       = useServerFn(savePlanForLater);
  const unsaveFn     = useServerFn(unsavePlan);
  const fetchSaved   = useServerFn(listSavedPlans);
  const downloadFn   = useServerFn(downloadLibraryPdf);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const [conflict, setConflict] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState<string[]>([]);

  const { data: plan } = useQuery({
    queryKey: ["m-plan", planId],
    queryFn: async () => {
      const { data } = await supabase.from("member_plans").select("*").eq("id", planId).maybeSingle();
      return data as any;
    },
  });

  const { data: saved } = useQuery({
    queryKey: ["m-saved-plans"],
    queryFn: () => fetchSaved(),
  });
  const isSaved = (saved?.ids ?? []).includes(planId);

  useEffect(() => {
    if (plan?.status === "Published") {
      recordView({ data: { planId } }).catch(() => {});
    }
  }, [plan?.id, plan?.status]);

  if (!plan) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const accessKeys = new Set((me?.access ?? []).map((a: any) => a.access_level_key));
  const unlocked = plan.audience_mode === "all_active" || accessKeys.has(plan.required_access_level);
  const weeks = plan.published_payload?.weeks_data ?? [];

  const submitStart = async (confirmReplace = false) => {
    const res = await enroll({ data: {
      planId,
      startDate: startDate || null,
      trainingDays: days,
      importMode: "full",
      confirmReplace,
    } });
    if (res.conflict) { setConflict(true); return; }
    setStartOpen(false);
    qc.invalidateQueries({ queryKey: ["m-saved-plans"] });
    navigate({ to: "/m/my-plans/$enrollmentId", params: { enrollmentId: res.enrollmentId! } });
  };

  const toggleDay = (d: string) => setDays((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]);

  const toggleSave = async () => {
    try {
      if (isSaved) { await unsaveFn({ data: { planId } }); toast.success("Removed from saved"); }
      else { await saveFn({ data: { planId } }); toast.success("Saved for later"); }
      qc.invalidateQueries({ queryKey: ["m-saved-plans"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const handleDownload = async () => {
    try {
      const { filename, base64 } = await downloadFn({ data: { planId } });
      const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error(e?.message ?? "Download unavailable"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={plan.public_title || plan.name}
        subtitle={plan.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={toggleSave}>
              {isSaved ? <><BookmarkCheck className="mr-1 h-4 w-4" /> Saved</> : <><Bookmark className="mr-1 h-4 w-4" /> Save for Later</>}
            </Button>
            {plan.allow_pdf_download && (
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="mr-1 h-4 w-4" /> PDF
              </Button>
            )}
            {unlocked && plan.allow_full_program !== false && (
              <Button size="sm" onClick={() => setStartOpen(true)}>
                <PlayCircle className="mr-1 h-4 w-4" /> Add Program
              </Button>
            )}
            {!unlocked && <Badge variant="secondary"><Lock className="mr-1 h-3.5 w-3.5" />Locked</Badge>}
          </div>
        }
      />
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Calendar className="h-4 w-4" />{plan.weeks} weeks · {plan.days_per_week}/wk</span>
        {plan.est_minutes_per_workout && <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />{plan.est_minutes_per_workout} min/workout</span>}
        <Badge variant="outline">{plan.training_style}</Badge>
        <Badge variant="outline">{plan.difficulty}</Badge>
        {plan.goal && <Badge variant="outline">{plan.goal}</Badge>}
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

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to your account</DialogTitle>
            <DialogDescription>
              Choose when to start. By default this saves to <strong>My Plans</strong> — it won't replace any current coached program.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Preferred training days</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEK_DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`rounded-full border px-3 py-1 text-xs ${days.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/30"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStartOpen(false)}>Cancel</Button>
            <Button onClick={() => submitStart(false)}>Save to My Plans</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have an active plan</AlertDialogTitle>
            <AlertDialogDescription>
              Starting this plan will end your current one. Your past workout logs and completed workouts will be preserved. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConflict(false); void submitStart(true); }}>Switch plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}