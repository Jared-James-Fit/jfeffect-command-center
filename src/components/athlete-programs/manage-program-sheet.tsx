import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Loader2, Pencil, Repeat, StopCircle } from "lucide-react";
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
 * sheet: edit it (a program they built; the workouts they haven't done
 * follow), see the JF Effect plan it came from, switch to another, or end it
 * (logged workouts stay in their history). Only for a program they own.
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
  /** after the program ended (the sheet is already closed) */
  onEnded?: () => void;
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
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-[24px] px-0 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-5 sm:mx-auto sm:max-w-lg"
          data-manage-program
        >
          <SheetHeader className="space-y-1 px-5 pb-4 text-left">
            <div className="text-[13px] font-medium text-muted-foreground">{origin.label}</div>
            <SheetTitle className="pr-8 text-xl leading-tight">{name}</SheetTitle>
            {progressLine ? (
              <SheetDescription className="tabular-nums">{progressLine}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Manage your program</SheetDescription>
            )}
          </SheetHeader>

          <div className="border-t border-border">
            {editable && (
              <Row
                icon={Pencil}
                title="Edit program"
                sub="Your upcoming workouts change with it. Ones you've done stay."
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
                sub="What's in it, week by week"
                asLink={{ to: "/portal/plans/$planId", params: { planId } }}
                onClick={() => onOpenChange(false)}
              />
            )}
            <Row
              icon={Repeat}
              title="Switch program"
              sub="Pick another one. Starting it ends this one."
              asLink={{ to: "/portal/programs" }}
              onClick={() => onOpenChange(false)}
            />
            <Row
              icon={StopCircle}
              title="End program"
              sub="Take it off your calendar. Logged workouts stay."
              destructive
              pending={preview.isPending}
              onClick={() => void askEnd()}
            />
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
  onClick,
  asLink,
  destructive,
  pending,
}: {
  icon: typeof Pencil;
  title: string;
  sub: string;
  onClick?: () => void;
  asLink?: { to: string; params?: Record<string, string>; search?: Record<string, string> };
  destructive?: boolean;
  pending?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted",
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
        <span className={cn("block text-[16px] font-medium", destructive && "text-destructive")}>
          {title}
        </span>
        <span className="block text-[13px] leading-snug text-muted-foreground">{sub}</span>
      </span>
      {!destructive && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );
  const cls =
    "flex min-h-[64px] w-full items-center gap-3 border-b border-border px-5 py-3 text-left transition last:border-b-0 hover:bg-secondary/40 active:bg-secondary/60 disabled:opacity-60";
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
