import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, ChevronRight, Loader2, Pause, Pencil, Repeat, StopCircle } from "lucide-react";
import { toast } from "sonner";
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
import { useClientImpersonation } from "@/lib/client-impersonation";
import { programError } from "@/lib/athlete-programs";
import {
  endProgramCopy,
  endedToast,
  pausedToast,
  type EndCopy,
  type EndFacts,
} from "@/lib/my-program";
import { resumeMyProgram } from "@/lib/member-program-lifecycle.functions";
import { cn } from "@/lib/utils";
import { refreshAfterProgramChange, useEndProgram, type ProgramOriginInfo } from "./use-my-program";

const PREVIEW = "Preview only: this is how it looks to them.";

/**
 * The program on a member's calendar, managed in one sheet (Nov 20 2026): its
 * name and where it stands, then the everyday choices (edit a program they
 * built or see the JF Effect plan it came from, switch to another, pause it),
 * and End program on its own below them. Nothing here deletes anything:
 * pausing, ending and switching all move the program to their program
 * history (resume or start it over from there), and what they logged stays
 * in their history, PRs and progress. Pause and End each have Undo on the
 * toast after; End asks first, saying what comes off the calendar. Training
 * days live in Workouts' ⋯ (one door). Only for a program they own; a grip
 * and a swipe down close it.
 */
export function ManageProgramSheet({
  open,
  onOpenChange,
  name,
  progressLine,
  origin,
  onEnded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  progressLine?: string | null;
  origin: ProgramOriginInfo;
  /** after the program was paused or ended (the sheet is already closed) */
  onEnded?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const resumeFn = useServerFn(resumeMyProgram);
  const { isImpersonating } = useClientImpersonation();
  const { preview, end } = useEndProgram();
  const [confirm, setConfirm] = useState<{ facts: EndFacts; copy: EndCopy } | null>(null);
  const [pausing, setPausing] = useState(false);

  // Undo after a pause or an end: the same program, back where it was
  const undo = (key: string | null | undefined, label: string) =>
    key
      ? {
          action: {
            label: "Undo",
            onClick: () => {
              void resumeFn({ data: { key, startDate: null } })
                .then(() => {
                  refreshAfterProgramChange(qc);
                  toast.success(`${label} is back on your calendar.`);
                })
                .catch((e) =>
                  toast.error(
                    programError(e, "Couldn't undo. Resume it from your program history."),
                  ),
                );
            },
          },
        }
      : {};

  const askEnd = async () => {
    if (isImpersonating) return toast.message(PREVIEW);
    if (!origin.blockId) return;
    try {
      const facts = await preview.mutateAsync(origin.blockId);
      setConfirm({ facts, copy: endProgramCopy({ ...facts, name: facts.name || name }) });
    } catch (e) {
      toast.error(programError(e, "Couldn't check this program. Try again."));
    }
  };

  const doEnd = async () => {
    if (!origin.blockId || !confirm) return;
    try {
      const done = await end.mutateAsync({ blockId: origin.blockId, reason: "ended" });
      setConfirm(null);
      onOpenChange(false);
      const label = done.name || name;
      toast.success(endedToast({ name: label }), { duration: 8000, ...undo(done.key, label) });
      onEnded?.();
    } catch (e) {
      toast.error(programError(e, "Couldn't end it. Try again."));
    }
  };

  // Pausing is one tap: nothing is lost and Undo is right there
  const doPause = async () => {
    if (isImpersonating) return toast.message(PREVIEW);
    if (!origin.blockId) return;
    setPausing(true);
    try {
      const done = await end.mutateAsync({ blockId: origin.blockId, reason: "paused" });
      onOpenChange(false);
      const label = done.name || name;
      toast.success(pausedToast({ name: label, upcoming: done.upcoming }), {
        duration: 8000,
        ...undo(done.key, label),
      });
      onEnded?.();
    } catch (e) {
      toast.error(programError(e, "Couldn't pause it. Try again."));
    } finally {
      setPausing(false);
    }
  };

  const editable = origin.origin.kind === "own" && !!origin.programId;
  const planId = origin.origin.kind === "jf" ? origin.planId : null;
  const busy = pausing || preview.isPending || end.isPending;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <SheetContent
          side="bottom"
          hideCloseButton
          swipeToClose
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:mx-auto sm:max-w-lg"
          data-manage-program
        >
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-start gap-3 pb-4">
            <SheetHeader className="min-w-0 flex-1 space-y-0.5 p-0 text-left">
              <SheetTitle className="break-words text-[20px] font-semibold leading-tight">
                {name}
              </SheetTitle>
              <SheetDescription className="text-[13px] tabular-nums">
                {[origin.label, progressLine].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold text-foreground transition hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-manage-done
            >
              Done
            </button>
          </div>

          {/* The everyday choices. */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {editable && (
              <Row
                icon={Pencil}
                title="Edit program"
                sub="Upcoming workouts follow. Done ones stay."
                onClick={() => {
                  if (isImpersonating) return toast.message(PREVIEW);
                  onOpenChange(false);
                  navigate({
                    to: "/portal/programs/new",
                    search: { edit: origin.programId },
                  } as any);
                }}
              />
            )}
            {planId && (
              <Row
                icon={BookOpen}
                title="See the plan"
                asLink={{ to: "/portal/plans/$planId", params: { planId } }}
                onClick={() => onOpenChange(false)}
              />
            )}
            <Row
              icon={Repeat}
              title="Switch program"
              sub="Pick another. This one moves to your program history."
              asLink={{ to: "/portal/programs", search: { tab: "mine" } }}
              onClick={() => onOpenChange(false)}
            />
            <Row
              icon={Pause}
              title="Pause program"
              sub="Take a break, then resume right where you left off."
              pending={pausing}
              disabled={busy}
              onClick={() => void doPause()}
              data-manage-pause
            />
          </div>

          {/* Ending it, set apart from the rest. */}
          <div className="mt-6" data-manage-end>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <Row
                icon={StopCircle}
                title="End program"
                plain
                pending={preview.isPending}
                disabled={busy}
                onClick={() => void askEnd()}
              />
            </div>
            <p className="mt-2 px-1 text-[12px] leading-snug text-muted-foreground">
              It moves to your program history. Workouts you've logged stay in your history and PRs.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !end.isPending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.copy.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2" data-end-lines>
                {confirm?.copy.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={end.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={end.isPending}
              onClick={(e) => {
                e.preventDefault();
                void doEnd();
              }}
            >
              {end.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
              {confirm?.copy.action ?? "End program"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({
  icon: Icon,
  title,
  sub,
  onClick,
  asLink,
  plain,
  pending,
  disabled,
  ...rest
}: {
  icon: typeof Pencil;
  title: string;
  sub?: string;
  onClick?: () => void;
  asLink?: { to: string; params?: Record<string, string>; search?: Record<string, string> };
  /** an action that happens here (no chevron) */
  plain?: boolean;
  pending?: boolean;
  disabled?: boolean;
  "data-manage-pause"?: boolean;
}) {
  const body = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
        {pending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
        ) : (
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        {sub && <span className="block text-[13px] leading-snug text-muted-foreground">{sub}</span>}
      </span>
      {asLink && !plain && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );
  const cls = cn(
    "flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left transition last:border-b-0 hover:bg-secondary/40 active:bg-secondary/60 disabled:opacity-60",
  );
  if (asLink) {
    return (
      <Link
        to={asLink.to as any}
        params={asLink.params as any}
        search={asLink.search as any}
        onClick={onClick}
        className={cls}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={cls}
      {...rest}
    >
      {body}
    </button>
  );
}
