import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  BookOpen,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  StartPlanDialog,
  type StartablePlan,
  type StartPlanFn,
} from "@/components/programs/start-plan-dialog";
import { startMyProgram } from "@/lib/athlete-programs.functions";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useServiceTier } from "@/lib/service-tier";
import { todayLocalISO } from "@/lib/today";
import { cn } from "@/lib/utils";
import {
  historyActions,
  historyCompleted,
  historyNextLine,
  historyProgressLine,
  historyStatus,
  originLabel,
  removeFromHistoryCopy,
  type HistoryEntry,
} from "@/lib/my-program";
import { useHideFromHistory, useProgramHistory } from "./use-my-program";

const PREVIEW = "Preview only: this is how it looks to them.";

/** Where a past program came from, in the words every program uses. */
function originOf(e: HistoryEntry): string {
  return e.origin === "own"
    ? e.copied
      ? "Copied from the crew"
      : originLabel("own")
    : originLabel(e.origin);
}

/**
 * Program history: every program a member paused, ended or switched from,
 * newest first. A tap opens what they can do with it (Resume where they left
 * off, Start over from week 1, Remove from the list). Nothing here ever
 * touches a logged workout: removing only hides it from this list.
 */
export function ProgramHistoryPage() {
  const { isSelfServe, loading } = useServiceTier();
  const history = useProgramHistory(!loading && isSelfServe);
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const today = todayLocalISO();

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader title="Program history" backTo="/portal/programs" />
      <div className="space-y-4 px-4 py-3 md:px-8">
        <p className="px-1 text-[13px] leading-snug text-muted-foreground" data-history-intro>
          Programs you paused, ended or switched from. Resume one where you left off or start it
          over. What you logged always stays in your training history, PRs and progress.
        </p>

        {loading || history.isLoading ? (
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[104px] w-full rounded-2xl" />
            ))}
          </div>
        ) : !isSelfServe ? (
          <Empty
            title="Your coach manages your programs"
            body="Past programs your coach wrote are in your workout history."
          />
        ) : history.isError ? (
          <Empty
            title="Couldn't load your program history"
            body="Check your connection."
            action={
              <Button variant="secondary" onClick={() => history.refetch()}>
                Try again
              </Button>
            }
          />
        ) : !history.data?.length ? (
          <Empty
            title="No past programs yet"
            body="When you pause, end or switch a program, it lands here so you can pick it back up."
            action={
              <Button asChild variant="secondary">
                <Link to="/portal/programs" search={{ tab: "mine" } as any}>
                  Go to My programs
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3" data-history-list>
            {history.data.map((e) => (
              <li key={e.key}>
                <HistoryCard entry={e} today={today} onOpen={() => setOpen(e)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <HistoryEntrySheet entry={open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}

function HistoryCard({
  entry: e,
  today,
  onOpen,
}: {
  entry: HistoryEntry;
  today: string;
  onOpen: () => void;
}) {
  const paused = e.reason === "paused" && e.remaining > 0;
  const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border border-border bg-card p-4 text-left transition active:scale-[0.99]"
      data-history-entry={e.key}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-muted-foreground">{originOf(e)}</div>
          <div className="line-clamp-2 break-words text-[16px] font-semibold leading-snug">
            {e.name}
          </div>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
            paused ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
          )}
          data-history-status
        >
          {paused && <Pause className="h-3 w-3" aria-hidden />}
          {historyStatus(e, today)}
        </span>
      </div>
      <div className="mt-1 text-[13px] text-muted-foreground tabular-nums">
        {historyProgressLine(e, today)}
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/20"
          aria-hidden
        >
          <div
            className={cn(
              "h-full rounded-full",
              historyCompleted(e) ? "bg-success" : "bg-foreground",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    </button>
  );
}

/**
 * One past program's choices, in a sheet: Resume (where they left off),
 * Start over (from week 1, from its JF Effect plan or their own program while
 * it still exists), see where it came from, and Remove from history set apart
 * (asks first, Undo after; logged workouts never change).
 */
export function HistoryEntrySheet({
  entry,
  onOpenChange,
}: {
  entry: HistoryEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { isSelfServe } = useServiceTier();
  const { isImpersonating } = useClientImpersonation();
  const hide = useHideFromHistory();
  const startOver = useStartOver();
  const [resuming, setResuming] = useState<HistoryEntry | null>(null);
  const [removing, setRemoving] = useState<HistoryEntry | null>(null);
  const today = todayLocalISO();
  const e = entry;
  const acts = e ? historyActions(e, { member: isSelfServe }) : { resume: false, restart: null };
  const next = e ? historyNextLine(e) : null;

  const doRemove = async () => {
    const target = removing;
    if (!target) return;
    try {
      await hide.mutateAsync({ key: target.key, hidden: true });
      setRemoving(null);
      onOpenChange(false);
      toast.success(`${target.name} removed from your history.`, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () =>
            void hide
              .mutateAsync({ key: target.key, hidden: false })
              .then(() => toast.success(`${target.name} is back in your history.`))
              .catch(() => toast.error("Couldn't undo. Try again.")),
        },
      });
    } catch {
      toast.error("Couldn't remove it. Try again.");
    }
  };

  return (
    <>
      <Sheet open={!!e} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton
          swipeToClose
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:mx-auto sm:max-w-lg"
          data-history-sheet
        >
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
          {e && (
            <>
              <div className="flex items-start gap-3 pb-4">
                <SheetHeader className="min-w-0 flex-1 space-y-0.5 p-0 text-left">
                  <SheetTitle className="break-words text-[20px] font-semibold leading-tight">
                    {e.name}
                  </SheetTitle>
                  <SheetDescription className="text-[13px] tabular-nums">
                    {originOf(e)} · {historyStatus(e, today)}
                  </SheetDescription>
                </SheetHeader>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold text-foreground transition hover:bg-secondary"
                >
                  Done
                </button>
              </div>

              <div
                className="space-y-1 rounded-2xl bg-muted px-4 py-3 text-[14px] leading-snug"
                data-history-facts
              >
                <p className="font-medium tabular-nums">{historyProgressLine(e, today)}</p>
                {acts.resume && next && <p className="text-muted-foreground">{next}</p>}
                {!acts.resume && historyCompleted(e) && (
                  <p className="text-muted-foreground">Every workout done.</p>
                )}
                {!acts.resume && !historyCompleted(e) && (
                  <p className="text-muted-foreground">
                    Nothing left on its schedule.
                    {acts.restart ? " Start it over to run it again." : ""}
                  </p>
                )}
              </div>

              {(acts.resume || acts.restart) && (
                <div className="mt-4 space-y-2">
                  {acts.resume && (
                    <Button
                      className="h-12 w-full text-[16px]"
                      onClick={() => {
                        if (isImpersonating) return toast.message(PREVIEW);
                        onOpenChange(false);
                        setResuming(e);
                      }}
                      data-history-resume
                    >
                      <Play className="mr-2 h-4 w-4" aria-hidden />
                      Resume where you left off
                    </Button>
                  )}
                  {acts.restart && (
                    <Button
                      variant={acts.resume ? "secondary" : "default"}
                      className="h-12 w-full text-[16px]"
                      disabled={startOver.loading}
                      onClick={() => {
                        if (isImpersonating) return toast.message(PREVIEW);
                        onOpenChange(false);
                        void startOver.open(e);
                      }}
                      data-history-restart
                    >
                      {startOver.loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                      )}
                      Start over from week 1
                    </Button>
                  )}
                </div>
              )}

              {(e.plan_id || e.program_id) && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
                  <Link
                    to={
                      (e.plan_id ? "/portal/plans/$planId" : "/portal/programs/$programId") as any
                    }
                    params={
                      (e.plan_id ? { planId: e.plan_id } : { programId: e.program_id }) as any
                    }
                    onClick={() => onOpenChange(false)}
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition hover:bg-secondary/40"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
                      <BookOpen className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="flex-1 text-[15px] font-medium">
                      {e.plan_id ? "See the plan" : "See the program"}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Link>
                </div>
              )}

              <div className="mt-6">
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => (isImpersonating ? toast.message(PREVIEW) : setRemoving(e))}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-secondary/40"
                    data-history-remove
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-destructive">
                      <Trash2 className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="flex-1 text-[15px] font-medium text-destructive">
                      Remove from history
                    </span>
                  </button>
                </div>
                <p className="mt-2 px-1 text-[12px] leading-snug text-muted-foreground">
                  Only takes it off this list. Your logged workouts, PRs and progress stay.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!removing}
        onOpenChange={(o) => !o && !hide.isPending && setRemoving(null)}
      >
        <AlertDialogContent>
          {removing && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{removeFromHistoryCopy(removing).title}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    {removeFromHistoryCopy(removing).lines.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={hide.isPending}>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={hide.isPending}
                  onClick={(ev) => {
                    ev.preventDefault();
                    void doRemove();
                  }}
                >
                  {hide.isPending && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  )}
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <StartPlanDialog
        plan={null}
        resume={resuming}
        open={!!resuming}
        onOpenChange={(o) => !o && setResuming(null)}
      />
      {startOver.dialog}
    </>
  );
}

/**
 * Start a past program over from week 1: from its JF Effect plan (still in
 * the library) or their own program (still saved), through the same start
 * sheet as anywhere else.
 */
function useStartOver() {
  const startFn = useServerFn(startMyProgram);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<{ plan: StartablePlan; own: boolean } | null>(null);

  const open = async (e: HistoryEntry) => {
    setLoading(true);
    try {
      if (e.plan_id) {
        const { data } = await supabase
          .from("member_plans")
          .select("id, name, public_title, weeks, days_per_week")
          .eq("id", e.plan_id)
          .maybeSingle();
        if (!data) throw new Error("This plan isn't in the library any more.");
        setTarget({ plan: data as StartablePlan, own: false });
      } else if (e.program_id) {
        const { data } = await (supabase as any)
          .from("athlete_programs")
          .select("id, title, weeks, days_per_week")
          .eq("id", e.program_id)
          .maybeSingle();
        if (!data) throw new Error("This program isn't saved any more.");
        setTarget({
          plan: {
            id: data.id,
            name: data.title,
            weeks: data.weeks,
            days_per_week: data.days_per_week,
          },
          own: true,
        });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't open it. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const startWith: StartPlanFn = (args) => startFn(args as any) as any;
  const dialog = (
    <StartPlanDialog
      plan={target?.plan ?? null}
      open={!!target}
      onOpenChange={(o) => !o && setTarget(null)}
      startWith={target?.own ? startWith : undefined}
    />
  );
  return { open, loading, dialog };
}

/**
 * A paused program, offered back while nothing else is on their calendar
 * (Workouts and My programs): where it picks up, one Resume, and a quiet way
 * to pick something else.
 */
export function PausedProgramCard({
  entry: e,
  className,
  chooseAnother = true,
}: {
  entry: HistoryEntry;
  className?: string;
  /** the quiet way to pick something else (off on My programs, which lists them) */
  chooseAnother?: boolean;
}) {
  const { isImpersonating } = useClientImpersonation();
  const [resuming, setResuming] = useState(false);
  const today = todayLocalISO();
  const next = historyNextLine(e);
  return (
    <section
      className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}
      aria-label="Paused program"
      data-paused-program
    >
      <div className="p-4">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Pause className="h-3.5 w-3.5" aria-hidden />
          {historyStatus(e, today)} · {originOf(e)}
        </div>
        <div className="mt-0.5 line-clamp-2 break-words text-[17px] font-semibold leading-snug tracking-tight">
          {e.name}
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
          {[next, `${e.remaining} workout${e.remaining === 1 ? "" : "s"} left`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Button
          className="mt-3.5 h-12 w-full text-[16px]"
          onClick={() => (isImpersonating ? toast.message(PREVIEW) : setResuming(true))}
          data-paused-resume
        >
          <Play className="mr-2 h-4 w-4" aria-hidden />
          Resume program
        </Button>
      </div>
      {chooseAnother && (
        <Link
          to="/portal/programs"
          search={{ tab: "mine" } as any}
          className="flex min-h-12 items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-[14px] font-medium text-muted-foreground transition hover:bg-secondary/40"
        >
          <span>Choose another program</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
      <StartPlanDialog
        plan={null}
        resume={resuming ? e : null}
        open={resuming}
        onOpenChange={setResuming}
      />
    </section>
  );
}

/** The one row that opens Program history (My programs), with how many are in it. */
export function ProgramHistoryRow({ count }: { count: number }) {
  return (
    <Link
      to={"/portal/programs/history" as any}
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 transition hover:bg-secondary/40 active:bg-secondary/60"
      data-program-history-row
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
        <Archive className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">Program history</span>
        <span className="block text-[13px] text-muted-foreground">
          {count} past program{count === 1 ? "" : "s"} · resume or start over
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
      <div className="text-[16px] font-semibold">{title}</div>
      <p className="mx-auto mt-1 max-w-[320px] text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
