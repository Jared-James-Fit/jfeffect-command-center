import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { AlertCircle, Calendar, Check, Loader2, Sparkles } from "lucide-react";
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
import { SHORT_DAY, WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { normalizeCommittedDays } from "@/lib/committed-schedule-realign";
import { fitTrainingDays, listDays, weekOnePreview, type DaysFit } from "@/lib/plan-days-fit";

export type StartablePlan = {
  id: string;
  name: string;
  public_title?: string | null;
  weeks?: number | null;
  days_per_week?: number | null;
};

/**
 * A member starts a library plan: the days they train come in from their
 * committed schedule, fitted to the plan's workouts a week (every workout
 * gets its own day), and those days become their committed schedule, so the
 * plan and the schedule start in sync. The plan is copied into their own
 * program (the same engine a coach uses), then they land on Workouts with
 * Week 1 on the calendar.
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
  const today = toLocalISO(localStartOfToday());
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState<WeekDay[]>([]);
  const [fit, setFit] = useState<DaysFit | null>(null);
  const [pending, setPending] = useState(false);
  const [replaceName, setReplaceName] = useState<string | null>(null);

  // their committed training days (the setup wizard's copy if the schedule has none yet)
  const { data: committed } = useQuery({
    queryKey: ["my-committed-days", clientId],
    enabled: !!clientId && open,
    queryFn: async () => {
      const own = ((await supabase.from("clients").select("committed_training_days, user_id").eq("id", clientId!).maybeSingle())
        .data ?? null) as { committed_training_days: string[] | null; user_id: string | null } | null;
      let list = normalizeCommittedDays(own?.committed_training_days);
      if (!list.length && own?.user_id) {
        const m = (await supabase.from("app_members").select("committed_training_days").eq("user_id", own.user_id).maybeSingle())
          .data as { committed_training_days: string[] | null } | null;
        list = normalizeCommittedDays(m?.committed_training_days);
      }
      return list;
    },
  });

  const title = plan ? plan.public_title || plan.name : "";
  const perWeek = plan?.days_per_week ?? null;
  const mine = committed ?? [];

  useEffect(() => {
    if (!open) return;
    setStartDate(today);
    const f = fitTrainingDays(mine, perWeek);
    setDays(f.days);
    setFit(f.added.length || f.dropped.length ? f : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, committed, perWeek]);

  const toggleDay = (d: WeekDay) => {
    setFit(null);
    setDays((cur) => WEEK_DAYS.filter((x) => (x === d ? !cur.includes(d) : cur.includes(x))));
  };

  const short = perWeek ? perWeek - days.length : 0;
  const daysReady = perWeek ? short === 0 : true;
  const changesSchedule = mine.length > 0 && days.length > 0 && days.join() !== mine.join();
  const preview = useMemo(() => weekOnePreview(startDate, days), [startDate, days]);

  const submit = async (confirmReplace = false) => {
    if (!plan || !daysReady) return;
    setPending(true);
    try {
      const res = await start({ data: { planId: plan.id, startDate: startDate || null, trainingDays: days, confirmReplace } });
      if (res.conflict) {
        setReplaceName(res.currentName ?? "your current plan");
        return;
      }
      onOpenChange(false);
      setReplaceName(null);
      toast.success(
        days.length ? `${title} is on your calendar: ${listDays(days)}. Let's go.` : `${title} is on your calendar. Let's go.`,
      );
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
              {perWeek ? ` · ${perWeek} workouts a week` : ""}. Each workout gets one of your training days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-sm font-semibold">Days you train</Label>
                {perWeek ? (
                  <span className={cn("text-xs font-semibold tabular-nums", daysReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                    {days.length} of {perWeek}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1.5" role="group" aria-label="Days you train">
                {WEEK_DAYS.map((d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={d}
                      onClick={() => toggleDay(d)}
                      className={cn(
                        "flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/30 text-muted-foreground",
                      )}
                    >
                      {SHORT_DAY[d].slice(0, 2)}
                    </button>
                  );
                })}
              </div>
              <DaysNote
                perWeek={perWeek}
                days={days}
                mine={mine}
                fit={fit}
                short={short}
                changesSchedule={changesSchedule}
              />
            </div>

            <div>
              <Label className="text-sm font-semibold" htmlFor="plan-start-date">Start date</Label>
              <Input
                id="plan-start-date"
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value < today ? today : e.target.value)}
                className="mt-2"
              />
            </div>

            {daysReady && preview.length > 0 && (
              <div>
                <p className="text-sm font-semibold">Week 1</p>
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {preview.map((p) => (
                    <li key={p.date} className="rounded-lg border bg-secondary/30 px-2.5 py-1.5 text-xs">
                      <span className="font-semibold">Day {p.day}</span>{" "}
                      <span className="text-muted-foreground">{format(parseISO(p.date), "EEE d")}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {isImpersonating && (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                You're viewing as this member. Only they can start a plan.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void submit(false)} disabled={pending || isImpersonating || !plan || !daysReady}>
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

/** One line under the days: what we fitted, what's missing, or what changes. */
function DaysNote({
  perWeek, days, mine, fit, short, changesSchedule,
}: {
  perWeek: number | null;
  days: WeekDay[];
  mine: WeekDay[];
  fit: DaysFit | null;
  short: number;
  changesSchedule: boolean;
}) {
  const base = "mt-2 flex items-start gap-1.5 text-xs leading-snug";
  if (perWeek && short > 0) {
    return (
      <p className={cn(base, "font-medium text-amber-700 dark:text-amber-400")}>
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
        Pick {short} more day{short === 1 ? "" : "s"}. This plan has {perWeek} workouts a week.
      </p>
    );
  }
  if (perWeek && short < 0) {
    return (
      <p className={cn(base, "font-medium text-amber-700 dark:text-amber-400")}>
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
        Take off {-short} day{short === -1 ? "" : "s"}. This plan has {perWeek} workouts a week.
      </p>
    );
  }
  if (!perWeek && days.length === 0) {
    return <p className={cn(base, "text-muted-foreground")}>Skip this and the plan keeps its own weekly pattern.</p>;
  }
  if (fit && fit.added.length) {
    return (
      <p className={cn(base, "text-muted-foreground")}>
        <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          You train {mine.length} day{mine.length === 1 ? "" : "s"} a week{mine.length ? "" : " so far"}, so we
          {mine.length ? " added " : " picked "}
          <strong className="text-foreground">{listDays(mine.length ? fit.added : fit.days)}</strong>. Tap any day to change it.
          {mine.length ? " Your training schedule updates to match." : ""}
        </span>
      </p>
    );
  }
  if (fit && fit.dropped.length) {
    return (
      <p className={cn(base, "text-muted-foreground")}>
        <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          We kept <strong className="text-foreground">{listDays(fit.days)}</strong> from your days. Tap any day to change it.
          Your training schedule updates to match.
        </span>
      </p>
    );
  }
  if (changesSchedule) {
    return (
      <p className={cn(base, "text-muted-foreground")}>
        <Calendar className="mt-px h-3.5 w-3.5 shrink-0" />
        Your training schedule updates to {listDays(days)}.
      </p>
    );
  }
  return (
    <p className={cn(base, "text-muted-foreground")}>
      <Check className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
      {mine.length ? "Matches your training schedule." : "These become your training schedule."} Move any workout later from your calendar.
    </p>
  );
}
