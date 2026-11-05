import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  Copy,
  Flag,
  Globe2,
  MoreHorizontal,
  Pencil,
  Play,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { UserAvatar } from "@/components/user-avatar";
import { ReportSheet } from "@/components/community/report-sheet";
import { StartPlanDialog, type StartPlanFn } from "@/components/programs/start-plan-dialog";
import { useServerFn } from "@tanstack/react-start";
import { startMyProgram } from "@/lib/athlete-programs.functions";
import { useServiceTier } from "@/lib/service-tier";
import { useClientImpersonation } from "@/lib/client-impersonation";
import {
  authorHandle,
  goalLabel,
  levelLabel,
  programError,
  programMeta,
  useProgram,
  useProgramActions,
  type ProgramDetail,
  type ProgramExercise,
} from "@/lib/athlete-programs";

/** One program: what's in it, who made it, and what you can do with it. */
export function ProgramDetailPage({
  programId,
  autoStart = false,
}: {
  programId: string;
  autoStart?: boolean;
}) {
  const { data: p, isLoading, isError, refetch } = useProgram(programId);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Program" backTo="/portal/programs" />
        <div className="space-y-3 px-4 py-3 md:px-8" aria-hidden>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (isError || !p) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Program" backTo="/portal/programs" />
        <div className="px-4 py-6 md:px-8">
          <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
            <div className="text-[16px] font-semibold">
              {isError ? "Couldn't load this program" : "This program isn't available"}
            </div>
            <p className="mx-auto mt-1 max-w-[300px] text-sm text-muted-foreground">
              {isError ? "Check your connection." : "It may have been made private or removed."}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              {isError && (
                <Button variant="secondary" onClick={() => refetch()}>
                  Try again
                </Button>
              )}
              <Button asChild variant={isError ? "ghost" : "default"}>
                <Link to="/portal/programs">Browse programs</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return <Loaded key={p.id} p={p} autoStart={autoStart} />;
}

function Loaded({ p, autoStart }: { p: ProgramDetail; autoStart: boolean }) {
  const navigate = useNavigate();
  const { isSelfServe } = useServiceTier();
  const { isImpersonating } = useClientImpersonation();
  const { share, copy, remove, moderate } = useProgramActions();
  const startFn = useServerFn(startMyProgram);
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [starting, setStarting] = useState(false);
  // "Save a copy and start" lands here on the new copy: open the days picker once the tier is known
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !autoStart || !p.is_mine || !isSelfServe || isImpersonating) return;
    autoOpened.current = true;
    setStarting(true);
  }, [autoStart, p.is_mine, isSelfServe, isImpersonating]);
  const tags = [goalLabel(p.goal), levelLabel(p.level)].filter(Boolean) as string[];
  const preview = isImpersonating;

  const onCopy = async (thenStart = false) => {
    if (preview) return toast.message("Preview only: this is how it looks to them.");
    try {
      const id = await copy.mutateAsync(p.id);
      toast.success(p.is_mine ? "Copied" : "Saved to your programs");
      navigate({
        to: "/portal/programs/$programId",
        params: { programId: id },
        search: thenStart ? { start: 1 } : {},
      } as any);
    } catch (e) {
      toast.error(programError(e, "Couldn't save a copy."));
    }
  };

  const onShare = async (shared: boolean) => {
    if (preview) return;
    try {
      await share.mutateAsync({ id: p.id, shared });
      toast.success(shared ? "Shared with the crew" : "Only you can see it now");
    } catch (e) {
      toast.error(programError(e, "Couldn't change sharing."));
    }
  };

  const onDelete = async () => {
    try {
      await remove.mutateAsync(p.id);
      toast.success("Program deleted");
      navigate({ to: "/portal/programs", replace: true });
    } catch (e) {
      toast.error(programError(e, "Couldn't delete it."));
    }
  };

  const onModerate = async (hide: boolean) => {
    try {
      await moderate.mutateAsync({
        id: p.id,
        hide,
        reason: hide ? "Taken down by the JF Effect team" : undefined,
      });
      toast.success(hide ? "Taken down" : "Back up");
    } catch (e) {
      toast.error(programError(e, "Couldn't change it."));
    }
  };

  // start opens the days picker; it reads like a library plan to the dialog
  const startPlan = { id: p.id, name: p.title, weeks: p.weeks, days_per_week: p.days_per_week };
  const startWith: StartPlanFn = (args) => startFn(args as any) as any;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      <PageHeader
        title={p.title}
        backTo="/portal/programs"
        actionsInline
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More" className="h-10 w-10">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {p.is_mine ? (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate({ to: "/portal/programs/new", search: { edit: p.id } } as any)
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onCopy()}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(true)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => setReporting(true)}>
                  <Flag className="mr-2 h-4 w-4" />
                  Report
                </DropdownMenuItem>
              )}
              {p.can_moderate && !p.is_mine && (
                <DropdownMenuItem onSelect={() => onModerate(!p.hidden)}>
                  <ShieldOff className="mr-2 h-4 w-4" />
                  {p.hidden ? "Put it back up" : "Take it down"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="space-y-5 px-4 py-2 md:px-8">
        <div className="flex items-center gap-2.5">
          <UserAvatar
            src={p.author?.avatar_url ?? null}
            name={p.author?.name ?? "?"}
            size={32}
            expandable={false}
          />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium">
              {p.is_mine ? "You" : authorHandle(p.author)}
            </div>
            <div className="text-[13px] text-muted-foreground">{programMeta(p)}</div>
          </div>
        </div>

        {p.forked_from?.author && (
          <p className="text-[13px] text-muted-foreground">
            Based on a program by {authorHandle(p.forked_from.author)}
          </p>
        )}

        {p.hidden && (
          <div className="rounded-xl border border-border bg-muted px-3 py-2 text-[13px]">
            {p.is_mine
              ? "The JF Effect team took this program down from the crew. You can still use it yourself."
              : "Taken down. Only staff and the author can see it."}
            {p.hidden_reason ? ` (${p.hidden_reason})` : ""}
          </div>
        )}

        {p.description && (
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{p.description}</p>
        )}

        {(tags.length > 0 || p.save_count > 0 || p.start_count > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                {t}
              </span>
            ))}
            {p.save_count > 0 && (
              <span className="inline-flex items-center gap-1 px-1 text-muted-foreground">
                <Bookmark className="h-3.5 w-3.5" aria-hidden />
                {p.save_count} saved
              </span>
            )}
            {p.start_count > 0 && (
              <span className="inline-flex items-center gap-1 px-1 text-muted-foreground">
                <Play className="h-3.5 w-3.5" aria-hidden />
                {p.start_count} started
              </span>
            )}
          </div>
        )}

        {/* the one main action */}
        {p.is_mine ? (
          <div className="space-y-3">
            {isSelfServe ? (
              <Button
                className="h-12 w-full text-[16px]"
                onClick={() => (preview ? null : setStarting(true))}
                disabled={preview}
              >
                <Play className="mr-2 h-4 w-4" aria-hidden />
                Start this program
              </Button>
            ) : (
              <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                Your coach writes the program on your calendar. Show them this one in Messages if
                you want it in your plan.
              </p>
            )}
            <label className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4">
              <span className="flex items-center gap-2 text-[15px]">
                <Globe2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                Share with the crew
              </span>
              <Switch
                checked={p.visibility === "community" && !p.hidden}
                disabled={share.isPending || preview || p.hidden}
                onCheckedChange={onShare}
                aria-label="Share with the crew"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              className="h-12 w-full text-[16px]"
              onClick={() => onCopy(isSelfServe)}
              disabled={copy.isPending}
            >
              <Bookmark className="mr-2 h-4 w-4" aria-hidden />
              {isSelfServe ? "Save a copy and start" : "Save a copy"}
            </Button>
            {isSelfServe && (
              <Button
                variant="secondary"
                className="h-11 w-full"
                onClick={() => onCopy(false)}
                disabled={copy.isPending}
              >
                Just save a copy
              </Button>
            )}
            <p className="text-center text-[12px] text-muted-foreground">
              {p.copied
                ? "You saved this before. A new copy is yours to change."
                : "Your copy is yours to change. The original stays as it is."}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {p.days.map((d, i) => (
            <section key={i} className="rounded-2xl border border-border bg-card">
              <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="truncate text-[16px] font-semibold">{d.title || `Day ${i + 1}`}</h2>
                <span className="shrink-0 text-[12px] text-muted-foreground">Day {i + 1}</span>
              </div>
              <ol className="divide-y divide-border">
                {d.exercises.map((e, j) => (
                  <li key={j} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium">{e.name ?? "Exercise"}</div>
                      {e.notes && (
                        <div className="mt-0.5 text-[13px] text-muted-foreground">{e.notes}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-[13px] tabular-nums">
                      {prescription(e)}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        {p.weeks > 1 && (
          <p className="text-center text-[13px] text-muted-foreground">
            This week repeats for {p.weeks} weeks. Add weight or reps as you go.
          </p>
        )}
      </div>

      <ReportSheet kind="program" targetId={p.id} open={reporting} onOpenChange={setReporting} />
      <StartPlanDialog
        plan={starting ? startPlan : null}
        open={starting}
        onOpenChange={setStarting}
        startWith={startWith}
      />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {p.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves your programs and the crew. Workouts you already logged stay in your
              history, and copies other people saved stay theirs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** "3 × 8-10 · RPE 8 · 2:00" */
export function prescription(
  e: Pick<ProgramExercise, "sets" | "reps" | "rpe" | "rest_seconds">,
): string {
  const parts = [`${e.sets} × ${e.reps}`];
  if (e.rpe) parts.push(`RPE ${e.rpe}`);
  if (e.rest_seconds) {
    const m = Math.floor(e.rest_seconds / 60);
    const s = e.rest_seconds % 60;
    parts.push(m ? `${m}:${String(s).padStart(2, "0")} rest` : `${s}s rest`);
  }
  return parts.join(" · ");
}
