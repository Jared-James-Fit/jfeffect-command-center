import { Suspense, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, formatWorkoutDuration, postTimeLabel } from "@/lib/community";
import { invalidateCommunity, useDayPlan, useMyPostForCompletion, useRecentCompletions, useTodaySession, type RecentCompletion } from "@/lib/community.queries";
import { startWorkout as startWorkoutFn } from "@/lib/workout-completion.functions";
import type { LockInPick } from "@/components/community/lock-in";
import { audienceDoneLabel } from "@/components/community/audience-picker";

const ShareComposer = lazyWithRetry(() => import("@/components/community/share-composer").then((m) => ({ default: m.ShareComposer })));
const CaptureFlow = lazyWithRetry(() => import("@/components/community/capture-flow").then((m) => ({ default: m.CaptureFlow })));
const LockInEditor = lazyWithRetry(() => import("@/components/community/lock-in-editor").then((m) => ({ default: m.LockInEditor })));

type Mode = "lockin" | "workout";

export const SHARE_GRADIENT = "bg-[linear-gradient(135deg,#f58529_0%,#dd2a7b_45%,#8134af_75%,#515bd4_100%)]";

/**
 * "+ Share" — opens straight to the camera, Instagram-style. Two modes:
 * LOCK IN (before today's session: the photo becomes a Locked in / Clock /
 * Today's plan card and starts the session) and WORKOUT (a finished session
 * from the last 30 days). Text and stickers go on the photo before either.
 * No photo is fine too: "No photo" skips straight to the cards.
 */
export function ShareWorkoutButton({
  unit,
  className,
  label = "Share a workout",
  variant = "pill",
  previewOnly = false,
}: {
  unit: "kg" | "lb";
  className?: string;
  label?: string;
  variant?: "pill" | "block" | "bubble";
  /** Coach viewing as a client: looks the same, but never posts as them. */
  previewOnly?: boolean;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const open = rawOpen && !previewOnly;
  const setOpen = (v: boolean) => {
    if (v && previewOnly) {
      toast.message(PREVIEW_ONLY_MESSAGE);
      return;
    }
    setRawOpen(v);
  };
  const [picked, setPicked] = useState<RecentCompletion | null>(null);
  const { data: sessions, isLoading } = useRecentCompletions(open);

  // Camera first
  const [capturing, setCapturing] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  // Fetched up front so the camera opens on the right mode.
  const { data: today } = useTodaySession(!previewOnly);
  // null = not picked yet: Lock in leads when there's a session to train today.
  const [mode, setMode] = useState<Mode | null>(null);
  // Lock in from here
  const [lockOpen, setLockOpen] = useState(false);
  const [lockPick, setLockPick] = useState<LockInPick | null>(null);
  const [startedId, setStartedId] = useState<string | null>(null);
  const seq = useRef(0);
  const lockCompletionId = today ? startedId ?? today.completionId : null;
  const { data: lockExisting } = useMyPostForCompletion(lockCompletionId, lockOpen && !!lockCompletionId);
  const { data: plan } = useDayPlan(lockOpen ? today?.dayId ?? null : null);
  const startSrv = useServerFn(startWorkoutFn);
  const qc = useQueryClient();

  const activeMode: Mode = today ? mode ?? "lockin" : "workout";

  const begin = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    setMode(null);
    setPhoto(null);
    setCapturing(true);
  };

  const afterCapture = (file: File | null, live: boolean) => {
    setCapturing(false);
    if (activeMode === "lockin" && today) {
      setLockPick(file ? { file, live, n: ++seq.current } : null);
      setLockOpen(true);
    } else {
      setPhoto(file);
      setRawOpen(true);
    }
  };

  const ensureStarted = async (): Promise<string | null> => {
    if (!today) return null;
    if (lockCompletionId) return lockCompletionId;
    const res = await startSrv({ data: { kind: "client" as const, dayId: today.dayId, scheduledWorkoutId: today.scheduledWorkoutId } });
    const id = (res as any)?.id ?? null;
    setStartedId(id);
    qc.invalidateQueries({ queryKey: ["pl-day-completion", today.dayId] });
    qc.invalidateQueries({ queryKey: ["community-today-session"] });
    invalidateCommunity(qc);
    return id;
  };

  return (
    <>
      {variant === "bubble" ? (
        // Instagram "your story" bubble: first item in the Home strip.
        <button type="button" onClick={begin} className={cn("flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95", className)} aria-label={label}>
          <span className={cn("grid h-[61px] w-[61px] place-items-center rounded-full text-white shadow-md shadow-fuchsia-500/20", SHARE_GRADIENT)}>
            <Plus className="h-6 w-6" strokeWidth={3} />
          </span>
          <span className="w-full truncate text-center text-[11px] font-bold">{label}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={begin}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 font-black text-white shadow-md shadow-fuchsia-500/20 transition active:scale-[0.97]",
            SHARE_GRADIENT,
            variant === "pill" ? "h-9 rounded-full px-4 text-[13px]" : "h-12 w-full rounded-2xl text-[15px]",
            className,
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
          {label}
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" hideCloseButton className="max-h-[80dvh] rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
          <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
            <SheetTitle className="text-base font-black">Share a workout</SheetTitle>
            <SheetDescription className="text-xs">{photo ? "Which session is this photo from?" : "Pick a session. You'll choose the card next."}</SheetDescription>
          </div>
                <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
            </SheetHeader>
          <div className="max-h-[60dvh] overflow-y-auto px-2 py-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : !sessions?.length ? (
              <div className="px-6 py-10 text-center text-[13px] text-muted-foreground">No finished workouts in the last 30 days. Finish one and it'll show up here.</div>
            ) : (
              sessions.map((s) => {
                const dur = formatWorkoutDuration(s.duration_min);
                return (
                  <button
                    key={s.completion_id}
                    type="button"
                    onClick={() => {
                      setPicked(s);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted active:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold">{s.title}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {new Date(s.completed_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                        {dur ? ` · ${dur}` : ""}
                        {` · ${postTimeLabel(s.completed_at)}`}
                      </div>
                    </div>
                    {s.post_id ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3 w-3" /> {audienceDoneLabel(s.visibility ?? "community")}
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      {picked && (
        <Suspense fallback={null}>
          <ShareComposer
            open={!!picked}
            onOpenChange={(o) => !o && setPicked(null)}
            completionId={picked.completion_id}
            athleteName={picked.athlete_name}
            workoutTitle={picked.title}
            unit={unit}
            initialFile={photo}
          />
        </Suspense>
      )}

      {capturing && (
        <Suspense fallback={null}>
          <CaptureFlow
            open={capturing}
            onClose={() => setCapturing(false)}
            onDone={(file, live) => afterCapture(file, live)}
            onSkip={() => afterCapture(null, false)}
            skipLabel="No photo"
            accept={activeMode === "lockin" ? "image/*" : "image/*,video/*"}
            workoutTitle={activeMode === "lockin" ? today?.title : null}
            modes={today && !lockOpen ? [{ key: "lockin", label: "Lock in" }, { key: "workout", label: "Workout" }] : undefined}
            mode={activeMode}
            onMode={(k) => setMode(k as Mode)}
            hint={activeMode === "lockin" && today ? `🔒 Lock in · ${today.title}` : "Share a finished workout"}
          />
        </Suspense>
      )}

      {lockOpen && today && (
        <Suspense fallback={null}>
          <LockInEditor
            open={lockOpen}
            onOpenChange={(o) => {
              setLockOpen(o);
              if (!o) setLockPick(null);
            }}
            completionId={lockCompletionId}
            ensureStarted={ensureStarted}
            workoutTitle={today.title}
            athleteName={today.athleteName}
            existing={lockExisting ?? null}
            pick={lockPick}
            onCamera={() => {
              setMode("lockin");
              setCapturing(true);
            }}
            onLibrary={() => {
              setMode("lockin");
              setCapturing(true);
            }}
            plan={plan ?? []}
          />
        </Suspense>
      )}
    </>
  );
}
