import { Suspense, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, buildShareCardFields, formatWorkoutDuration, groupSessions, lockInCameraCard, sessionDisplayTitle, sessionWhen } from "@/lib/community";
import { invalidateCommunity, useCompletionPreview, useDayPlan, useMyPostForCompletion, useRecentCompletions, useTodaySession, type RecentCompletion } from "@/lib/community.queries";
import { cameraLooks, type ShareTemplate } from "@/lib/workout-share-card";
import type { CameraCard } from "@/components/community/share-camera";
import type { LockTemplate } from "@/components/community/lock-in-editor";
import { startWorkout as startWorkoutFn } from "@/lib/workout-completion.functions";
import type { LockInPick } from "@/components/community/lock-in";
import { audienceDoneLabel } from "@/components/community/audience-picker";
import { CameraChip } from "@/components/community/camera-overlays";

const ShareComposer = lazyWithRetry(() => import("@/components/community/share-composer").then((m) => ({ default: m.ShareComposer })));
const CaptureFlow = lazyWithRetry(() => import("@/components/community/capture-flow").then((m) => ({ default: m.CaptureFlow })));
const LockInEditor = lazyWithRetry(() => import("@/components/community/lock-in-editor").then((m) => ({ default: m.LockInEditor })));

type Mode = "lockin" | "workout";

export const SHARE_GRADIENT = "bg-[linear-gradient(135deg,#f58529_0%,#dd2a7b_45%,#8134af_75%,#515bd4_100%)]";

/**
 * "+ Share" — opens straight to the camera, Instagram-style. Two modes:
 * LOCK IN (before today's session: the photo becomes a Locked in / Clock /
 * Today's plan card and starts the session) and WORKOUT (a finished session
 * from the last 30 days). The workout is picked for you (today's, else the
 * latest) and shown in a chip above the shutter: tap it to change, otherwise
 * snap and go, no list in the way. Text and stickers go on the photo first.
 * "No photo" skips straight to the cards.
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
  // Camera first
  const [capturing, setCapturing] = useState(false);
  const { data: sessions, isLoading } = useRecentCompletions(open || capturing);
  // The workout the shot is for: their pick, else the newest finished one.
  const [chosen, setChosen] = useState<RecentCompletion | null>(null);
  const target = chosen ?? sessions?.[0] ?? null;
  // The list opened from the camera's chip just changes `chosen`.
  const [choosing, setChoosing] = useState(false);
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
  const { data: plan } = useDayPlan(lockOpen || capturing ? today?.dayId ?? null : null);
  const startSrv = useServerFn(startWorkoutFn);
  const qc = useQueryClient();

  const activeMode: Mode = today ? mode ?? "lockin" : "workout";

  // The look they're on in the camera (swipe to change), carried into the editor.
  const [lockLook, setLockLook] = useState<LockTemplate>("lockin");
  const [workoutLook, setWorkoutLook] = useState<ShareTemplate | null>(null);
  // Snapshot at the shutter: the editor opens on exactly what they shot.
  const [pickedLook, setPickedLook] = useState<ShareTemplate | null>(null);
  const { data: targetStats } = useCompletionPreview(target?.completion_id ?? "", capturing && activeMode === "workout" && !!target);
  const workoutCard = useMemo(() => {
    if (!targetStats || !target) return null;
    const data = {
      format: "story" as const,
      ...buildShareCardFields({
        stats: targetStats,
        unit,
        athleteName: (target.athlete_name ?? "").trim().split(/\s+/)[0] || null,
        workoutTitle: target.title,
        dateLabel: format(new Date(targetStats.completed_at), "EEE, MMM d"),
      }),
    };
    return { data, looks: cameraLooks(data) };
  }, [targetStats, target, unit]);
  const currentWorkoutLook = workoutCard ? (workoutLook && workoutCard.looks.includes(workoutLook) ? workoutLook : workoutCard.looks[0]) : null;
  const lockCard = today ? lockInCameraCard({ workoutTitle: today.title, athleteName: today.athleteName, plan: plan ?? [] }) : null;
  const cameraCard: CameraCard | null =
    activeMode === "lockin" && lockCard
      ? { data: lockCard.data, looks: lockCard.looks, look: lockCard.looks.includes(lockLook) ? lockLook : "lockin", onLook: (t) => setLockLook(t as LockTemplate) }
      : workoutCard && currentWorkoutLook
        ? { data: workoutCard.data, looks: workoutCard.looks, look: currentWorkoutLook, onLook: setWorkoutLook }
        : null;

  const begin = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    setMode(null);
    setPhoto(null);
    setChosen(null);
    setWorkoutLook(null);
    setCapturing(true);
  };

  const afterCapture = (file: File | null, live: boolean) => {
    setCapturing(false);
    if (activeMode === "lockin" && today) {
      setLockPick(file ? { file, live, n: ++seq.current } : null);
      setLockOpen(true);
    } else {
      setPhoto(file);
      setPickedLook(currentWorkoutLook);
      if (target) setPicked(target);
      else setRawOpen(true);
    }
  };

  const changeTarget = () => {
    setChoosing(true);
    setRawOpen(true);
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

      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setChoosing(false);
        }}
      >
        <SheetContent side="bottom" hideCloseButton className="max-h-[80dvh] rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
          <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
            <SheetTitle className="text-base font-black">Share a workout</SheetTitle>
            <SheetDescription className="text-xs">{photo || choosing ? "Which workout is this photo from?" : "Which workout are you sharing?"}</SheetDescription>
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
              groupSessions(sessions).map((g) => (
                <section key={g.key} className="pb-1">
                  <div className={cn("px-3 pb-1 pt-2 text-[11px] font-black uppercase tracking-[0.14em]", g.key === "today" ? "text-primary" : "text-muted-foreground")}>{g.label}</div>
                  {g.items.map(({ session: s, when }) => {
                    const dur = formatWorkoutDuration(s.duration_min);
                    const today = g.key === "today";
                    return (
                      <button
                        key={s.completion_id}
                        type="button"
                        onClick={() => {
                          if (choosing) setChosen(s);
                          else {
                            setPicked(s);
                            if (!photo) setPickedLook(null);
                          }
                          setChoosing(false);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-muted",
                          today ? "mb-1 border border-primary/30 bg-primary/[0.06] hover:bg-primary/10" : "hover:bg-muted",
                          choosing && target?.completion_id === s.completion_id && "ring-2 ring-foreground",
                        )}
                      >
                        {today && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-[15px] font-bold leading-snug">{sessionDisplayTitle(s.title)}</div>
                          <div className={cn("mt-0.5 text-[12px]", today ? "font-semibold text-foreground/80" : "text-muted-foreground")}>
                            {when}
                            {dur ? ` · ${dur} session` : ""}
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
                  })}
                </section>
              ))
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
            initialTemplate={pickedLook}
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
            workoutTitle={activeMode === "lockin" ? today?.title : target ? sessionDisplayTitle(target.title) : null}
            modes={today && !lockOpen ? [{ key: "lockin", label: "Lock in" }, { key: "workout", label: "Workout" }] : undefined}
            mode={activeMode}
            onMode={(k) => setMode(k as Mode)}
            canShoot={activeMode === "lockin" || isLoading || !!target}
            chip={
              activeMode === "lockin" && today ? (
                <CameraChip icon="🔒" title={today.title} sub={today.completionId ? "In progress · update your lock in" : "Posting it starts your session"} />
              ) : target ? (
                <CameraChip
                  icon={sessionWhen(target.completed_at).group === "today" ? "🔥" : "🏋️"}
                  title={sessionDisplayTitle(target.title)}
                  sub={[sessionWhen(target.completed_at).when, (sessions?.length ?? 0) > 1 ? "tap to change" : null].filter(Boolean).join(" · ")}
                  onPress={(sessions?.length ?? 0) > 1 ? changeTarget : undefined}
                />
              ) : isLoading ? (
                <CameraChip icon="⏳" title="Finding your workout…" tone="muted" />
              ) : (
                <CameraChip icon="🏁" title="Finish a workout to share it" sub="Or lock in before your next one" tone="muted" />
              )
            }
            card={cameraCard}
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
            initialTemplate={lockLook}
          />
        </Suspense>
      )}
    </>
  );
}
