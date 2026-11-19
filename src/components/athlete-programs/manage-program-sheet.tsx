import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, CalendarDays, ChevronRight, Loader2, Pencil, Repeat, StopCircle } from "lucide-react";
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
import { endProgramCopy, endedToast, type EndCopy, type EndFacts } from "@/lib/my-program";
import { cn } from "@/lib/utils";
import { useEndProgram, type ProgramOriginInfo } from "./use-my-program";

const PREVIEW = "Preview only: this is how it looks to them.";

/**
 * Everything a member can do with the program on their calendar, in one
 * sheet (Nov 19 2026): the program's name and where it stands at the top,
 * then what changes it safely (edit a program they built, where the upcoming
 * workouts follow; see the JF Effect plan it came from; their training days;
 * switch to another), and End program on its own below them, so a thumb
 * reaching for Switch never lands on it; ending still asks first and says
 * what stays (logged workouts stay in their history). Only for a program they
 * own. A grip and a swipe down close it, like every sheet with one.
 */
export function ManageProgramSheet({
  open,
  onOpenChange,
  name,
  progressLine,
  origin,
  onEnded,
  onTrainingDays,
  daysLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  progressLine?: string | null;
  origin: ProgramOriginInfo;
  /** after the program ended (the sheet is already closed) */
  onEnded?: () => void;
  /** Opens the training days editor in place; without it the row goes to Workouts' own editor. */
  onTrainingDays?: () => void;
  /** Their days, beside the row ("Mon, Wed, Fri"). */
  daysLabel?: string | null;
}) {
  const navigate = useNavigate();
  const { isImpersonating } = useClientImpersonation();
  const { preview, end } = useEndProgram();
  const [confirm, setConfirm] = useState<{ facts: EndFacts; copy: EndCopy } | null>(null);

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
      const done = await end.mutateAsync(origin.blockId);
      setConfirm(null);
      onOpenChange(false);
      toast.success(endedToast({ name: done.name || name, logged: done.logged }), {
        action: { label: "Pick a program", onClick: () => navigate({ to: "/portal/programs" }) },
      });
      onEnded?.();
    } catch (e) {
      toast.error(programError(e, "Couldn't end it. Try again."));
    }
  };

  const editable = origin.origin.kind === "own" && !!origin.programId;
  const planId = origin.origin.kind === "jf" ? origin.planId : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
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
              <SheetTitle className="break-words text-[20px] font-semibold leading-tight">{name}</SheetTitle>
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

          {/* What changes it, safely. */}
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
              icon={CalendarDays}
              title="Training days"
              value={daysLabel ?? null}
              {...(onTrainingDays
                ? {
                    onClick: () => {
                      onOpenChange(false);
                      onTrainingDays();
                    },
                  }
                : { asLink: { to: "/portal/workouts", search: { days: "1" } }, onClick: () => onOpenChange(false) })}
            />
            <Row
              icon={Repeat}
              title="Switch program"
              sub="Starting another one ends this one."
              asLink={{ to: "/portal/programs" }}
              onClick={() => onOpenChange(false)}
            />
          </div>

          {/* Ending it, set apart from the rest. */}
          <div className="mt-6" data-manage-end>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <Row
                icon={StopCircle}
                title="End program"
                destructive
                pending={preview.isPending}
                onClick={() => void askEnd()}
              />
            </div>
            <p className="mt-2 px-1 text-[12px] leading-snug text-muted-foreground">
              Takes it off your calendar. Workouts you've logged stay in your history and PRs.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.copy.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {confirm?.copy.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={end.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
  value,
  onClick,
  asLink,
  destructive,
  pending,
}: {
  icon: typeof Pencil;
  title: string;
  sub?: string;
  /** what it's set to, on the right ("Mon, Wed, Fri") */
  value?: string | null;
  onClick?: () => void;
  asLink?: { to: string; params?: Record<string, string>; search?: Record<string, string> };
  destructive?: boolean;
  pending?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted",
          destructive ? "text-destructive" : "text-foreground",
        )}
      >
        {pending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
        ) : (
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[15px] font-medium", destructive && "text-destructive")}>
          {title}
        </span>
        {sub && <span className="block text-[13px] leading-snug text-muted-foreground">{sub}</span>}
      </span>
      {value && <span className="max-w-[45%] truncate text-[13px] text-muted-foreground">{value}</span>}
      {!destructive && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );
  const cls =
    "flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left transition last:border-b-0 hover:bg-secondary/40 active:bg-secondary/60 disabled:opacity-60";
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
    <button type="button" onClick={onClick} disabled={pending} className={cls}>
      {body}
    </button>
  );
}
