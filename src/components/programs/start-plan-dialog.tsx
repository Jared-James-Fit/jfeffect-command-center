import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { startLibraryPlan } from "@/lib/member-plan-start.functions";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useServiceTier } from "@/lib/service-tier";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import { cn } from "@/lib/utils";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type StartablePlan = {
  id: string;
  name: string;
  public_title?: string | null;
  weeks?: number | null;
  days_per_week?: number | null;
};

/**
 * A member starts a library plan: pick the start date and the days they
 * train, and the plan is copied into their own program (the same engine a
 * coach uses), then they land on Workouts with Week 1 on the calendar.
 */
export function StartPlanDialog({
  plan, open, onOpenChange,
}: {
  plan: StartablePlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const start = useServerFn(startLibraryPlan);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();
  const { clientId } = useServiceTier();
  const [startDate, setStartDate] = useState(() => toLocalISO(localStartOfToday()));
  const [days, setDays] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [replaceName, setReplaceName] = useState<string | null>(null);

  // their usual training days, if they've set them
  const { data: committed } = useQuery({
    queryKey: ["my-committed-days", clientId],
    enabled: !!clientId && open,
    queryFn: async () =>
      (((await supabase.from("clients").select("committed_training_days").eq("id", clientId!).maybeSingle()).data as any)
        ?.committed_training_days ?? []) as string[],
  });
  useEffect(() => {
    if (!open) return;
    setStartDate(toLocalISO(localStartOfToday()));
    const short = (committed ?? []).map((d) => d.slice(0, 3)).filter((d) => (WEEK_DAYS as readonly string[]).includes(d));
    setDays(short);
  }, [open, committed]);

  const title = plan ? plan.public_title || plan.name : "";
  const perWeek = plan?.days_per_week ?? null;
  const toggleDay = (d: string) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const submit = async (confirmReplace = false) => {
    if (!plan) return;
    setPending(true);
    try {
      const res = await start({ data: { planId: plan.id, startDate: startDate || null, trainingDays: days, confirmReplace } });
      if (res.conflict) {
        setReplaceName(res.currentName ?? "your current plan");
        return;
      }
      onOpenChange(false);
      setReplaceName(null);
      toast.success(`${title} is on your calendar. Let's go.`);
      // a new program touches the schedule, today, workouts, analytics
      void qc.invalidateQueries();
      navigate({ to: "/portal/workouts" });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start this plan");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start {title}</DialogTitle>
            <DialogDescription>
              {plan?.weeks ? `${plan.weeks} weeks` : "Your plan"}
              {perWeek ? ` · ${perWeek} workouts a week` : ""}. Pick your days and Week 1 lands on your calendar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs" htmlFor="plan-start-date">Start date</Label>
              <Input id="plan-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Days you train</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEK_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={days.includes(d)}
                    onClick={() => toggleDay(d)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "bg-secondary/30",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {perWeek && days.length > 0 && days.length !== perWeek
                  ? `This plan has ${perWeek} workouts a week. Pick ${perWeek} days so each one has a day.`
                  : days.length === 0
                    ? "Skip this and the plan keeps its own weekly pattern."
                    : "Move any workout later from your calendar."}
              </p>
            </div>
            {isImpersonating && (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                You're viewing as this member. Only they can start a plan.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void submit(false)} disabled={pending || isImpersonating || !plan}>
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Start plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!replaceName} onOpenChange={(o) => !o && setReplaceName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch plans?</AlertDialogTitle>
            <AlertDialogDescription>
              You're running <strong>{replaceName}</strong>. Starting <strong>{title}</strong> ends it. Every workout
              you've logged stays in your history and PRs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit(true)}>Switch plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
