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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { startLibraryPlan } from "@/lib/member-plan-start.functions";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { switchCopy } from "@/lib/my-program";
import { useMyCurrentProgram } from "@/components/athlete-programs/use-my-program";
import { programName } from "@/components/workouts/program-roadmap";
import { useServiceTier } from "@/lib/service-tier";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import { cn } from "@/lib/utils";
import { SHORT_DAY, WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { normalizeCommittedDays } from "@/lib/committed-schedule-realign";
import { fitTrainingDays, listDays, weekOnePreview, type DaysFit } from "@/lib/plan-days-fit";

export type StartPlanFn = (args: {
  data: { planId: string; startDate: string | null; trainingDays: WeekDay[]; confirmReplace: boolean };
}) => Promise<{ conflict: boolean; currentName?: string | null }>;

export type StartablePlan = {
  id: string;
  name: string;
  public_title?: string | null;
  weeks?: number | null;
  days_per_week?: number | null;
};

/**
 * The one sheet that puts a program on a member's calendar, for a JF Effect
 * plan or one they built or copied (`startWith`), whether it's their first,
 * a switch, or the same one again. It knows what's on their calendar now
 * (useMyCurrentProgram) and says before the tap what happens to it
 * (`switchCopy`: what ends, how many upcoming workouts come off, that what
 * they finished stays, from member_program_end's read-only preview), so a
 * switch is one confirmation, never a second "Switch plans?" after the tap.
 * The days they train come in from their committed schedule, fitted to the
 * program's workouts a week (every workout gets its own day), and become
 * their committed schedule. Then they land on Workouts with Week 1 on it.
 */
export function StartPlanDialog({
  plan, open, onOpenChange, startWith,
}: {
  plan: StartablePlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start something other than a library plan (a program they built or copied): same days, same replace check. */
  startWith?: StartPlanFn;
}) {
  const startLibrary = useServerFn(startLibraryPlan);
  const start: StartPlanFn = startWith ?? startLibrary;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();
  const { clientId } = useServiceTier();
  const userId = usePortalUserId();
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

  // what's on their calendar now, and what switching does to it (read-only preview)
  const current = useMyCurrentProgram(open ? clientId : null, userId);
  // only a program they started themselves makes way (the start functions archive their own blocks)
  const currentName = current.roadmap && current.origin.owned ? programName(current.roadmap.program) : null;
  const ownedBlock = current.origin.owned ? current.origin.blockId : null;
  const { data: facts } = useQuery({
    queryKey: ["member-program-end-preview", ownedBlock],
    enabled: open && !!ownedBlock,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("member_program_end", { _block_id: ownedBlock, _confirm: false });
      if (error) return null;
      return data as { logged: number; upcoming: number } | null;
    },
  });

  const title = plan ? plan.public_title || plan.name : "";
  const perWeek = plan?.days_per_week ?? null;
  const mine = committed ?? [];
  const same =
    !!plan &&
    ((current.origin.origin.kind === "own" && current.origin.origin.programId === plan.id) ||
      (current.origin.origin.kind === "jf" && current.origin.planId === plan.id));
  const copy = switchCopy({
    title,
    current: currentName,
    same,
    currentFinished: current.roadmap?.program.status === "completed",
    logged: facts?.logged ?? null,
    upcoming: facts?.upcoming ?? null,
  });

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
  // starting the plan they're already running is starting it over
  const sameAgain = !!replaceName && replaceName.trim().toLowerCase() === title.trim().toLowerCase();

  const submit = async (confirmReplace = false) => {
    if (!plan || !daysReady) return;
    setPending(true);
    try {
      // the sheet already said what this replaces: that was the confirmation
      const res = await start({
        data: { planId: plan.id, startDate: startDate || null, trainingDays: days, confirmReplace: confirmReplace || copy.kind !== "start" },
      });
      if (res.conflict) {
        // something we didn't know about is running: ask once
        setReplaceName(res.currentName ?? "your current plan");
        return;
      }
      onOpenChange(false);
      setReplaceName(null);
      const when = preview[0] ? format(parseISO(preview[0].date), "EEE, MMM d") : null;
      const ended = copy.kind === "switch" && currentName ? ` ${currentName} ended; your finished workouts stay in your history.` : "";
      toast.success(
        `${title} is on your calendar${days.length ? `: ${listDays(days)}` : ""}${when ? `, from ${when}` : ""}.${ended}`,
        { duration: 7000 },
      );
      // a new program touches the schedule, today, workouts, analytics. The
      // program list is dropped, not just marked old: Workouts shows its
      // placeholder until the new program is in, never the old one's days.
      void qc.resetQueries({ queryKey: ["my-workouts"] });
      void qc.invalidateQueries();
      // replace this page: Back from Workouts never returns to a program you just started
      navigate({ to: "/portal/workouts", replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't start this plan");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
        <SheetContent
          side="bottom"
          className="flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
          data-start-program-sheet
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
            <SheetHeader className="space-y-0.5 pr-2 text-left">
              <SheetTitle className="text-left text-lg leading-tight">{copy.title}</SheetTitle>
              <SheetDescription className="text-left">
                {plan?.weeks ? `${plan.weeks} weeks` : "Your plan"}
                {perWeek ? ` · ${perWeek} workouts a week` : ""}
              </SheetDescription>
            </SheetHeader>

            {copy.lines.length > 0 && (
              <div className="mt-4 space-y-1 rounded-xl bg-muted px-3.5 py-3 text-[14px] leading-snug" data-switch-note>
                {copy.lines.map((l, i) => (
                  <p key={l} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                    {l}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-5">
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-[15px] font-semibold">Days you train</Label>
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
                        on ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground",
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

            <div className="mt-5">
              <Label className="text-[15px] font-semibold" htmlFor="plan-start-date">Starts</Label>
              <Input
                id="plan-start-date"
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value < today ? today : e.target.value)}
                className="mt-2 h-11 text-base"
              />
            </div>

            {daysReady && preview.length > 0 && (
              <div className="mt-5">
                <p className="text-[15px] font-semibold">Week 1</p>
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {preview.map((p) => (
                    <li key={p.date} className="rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                      <span className="font-semibold">Day {p.day}</span>{" "}
                      <span className="text-muted-foreground">{format(parseISO(p.date), "EEE d")}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {isImpersonating && (
              <p className="mt-4 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                You're viewing as this member. Only they can start a plan.
              </p>
            )}
          </div>
          <div className="border-t border-border px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
            <Button
              className="h-12 w-full text-[16px]"
              onClick={() => void submit(false)}
              disabled={pending || isImpersonating || !plan || !daysReady}
            >
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {copy.action}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!replaceName} onOpenChange={(o) => !o && setReplaceName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{sameAgain ? "Start over from week 1?" : "Switch plans?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {sameAgain ? (
                <>
                  <strong>{title}</strong> starts again from week 1 on the date you picked. Every workout you've logged
                  stays in your history and PRs.
                </>
              ) : (
                <>
                  You're running <strong>{replaceName}</strong>. Starting <strong>{title}</strong> ends it. Every
                  workout you've logged stays in your history and PRs.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit(true)}>{sameAgain ? "Start over" : "Switch plan"}</AlertDialogAction>
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
        <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" />
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
        <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" />
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
      <Check className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      {mine.length ? "Matches your training schedule." : "These become your training schedule."} Move any workout later from your calendar.
    </p>
  );
}
