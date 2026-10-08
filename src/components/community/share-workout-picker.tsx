import { Suspense, useMemo, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, buildShareCardFields, formatWorkoutDuration, groupSessions, lockInCameraCard, sessionDisplayTitle, sessionWhen, type CommunityVisibility } from "@/lib/community";
import { invalidateCommunity, shareToCommunity, useCompletionPreview, useDayPlan, useMyPostForCompletion, useRecentCompletions, useTodaySession, type RecentCompletion } from "@/lib/community.queries";
import { cameraLooks, type ShareTemplate } from "@/lib/workout-share-card";
import type { CameraCard, StudioPost } from "@/components/community/share-studio";
import { startWorkout as startWorkoutFn } from "@/lib/workout-completion.functions";
import { audienceDoneLabel } from "@/components/community/audience-picker";
import { CameraChip } from "@/components/community/camera-overlays";

const ShareComposer = lazyWithRetry(() => import("@/components/community/share-composer").then((m) => ({ default: m.ShareComposer })));
const ShareStudio = lazyWithRetry(() => import("@/components/community/share-studio").then((m) => ({ default: m.ShareStudio })));

type Mode = "lockin" | "workout";
type LockLook = Extract<ShareTemplate, "lockin" | "lockclock" | "lockplan">;

export const SHARE_GRADIENT = "bg-[linear-gradient(135deg,#f58529_0%,#dd2a7b_45%,#8134af_75%,#515bd4_100%)]";

/** What a fresh post says, by who it's for. */
export function postedToast(visibility: CommunityVisibility, lockIn: boolean, updated: boolean) {
  if (visibility === "coach") return { title: lockIn ? "Sent to your coach 🔒" : "Sent to your coach", description: "Only you and your coach can see it." };
  if (visibility === "private") return { title: "Saved to your profile", description: "Only you can see it." };
  if (lockIn) return { title: updated ? "Lock in updated 🔒" : "You're locked in 🔒", description: "The crew sees you showed up. Your numbers land on it when you finish." };
  return { title: updated ? "Post updated 🔥" : "You're in the feed 🔥", description: undefined };
}

/**
 * "+ Share" — the whole thing on one screen (ShareStudio). Opens straight to
 * the camera, the viewfinder already showing the card. Two modes: LOCK IN
 * (today's session: Locked in / Clock / Today's plan; posting starts the
 * session) and WORKOUT (a finished session: Photo, vs last time, Receipt,
 * Streak, Stats, Volume). The workout is picked for you (today's, else the
 * latest) in the chip above the shutter; tap it to change. Snap, the frame
 * freezes in place, add text or stickers, Post or Story. Done.
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // The session list (from the camera's chip).
  const [rawOpen, setRawOpen] = useState(false);
  const open = rawOpen && !previewOnly;
  const [capturing, setCapturing] = useState(false);
  const { data: sessions, isLoading } = useRecentCompletions(open || capturing);
  // The workout the shot is for: their pick, else the newest finished one.
  const [chosen, setChosen] = useState<RecentCompletion | null>(null);
  const target = chosen ?? sessions?.[0] ?? null;
  // A video from the library goes to the full editor (cards can't sit on video).
  const [videoFor, setVideoFor] = useState<{ session: RecentCompletion; file: File } | null>(null);
  // Fetched up front so the camera opens on the right mode.
  const { data: today } = useTodaySession(!previewOnly);
  // null = not picked yet: Lock in leads when there's a session to train today.
  const [mode, setMode] = useState<Mode | null>(null);
  const activeMode: Mode = today ? mode ?? "lockin" : "workout";
  const [startedId, setStartedId] = useState<string | null>(null);
  const lockCompletionId = today ? startedId ?? today.completionId : null;
  const { data: lockExisting } = useMyPostForCompletion(lockCompletionId, capturing && !!lockCompletionId);
  const { data: plan } = useDayPlan(capturing ? today?.dayId ?? null : null);
  const { data: targetPost } = useMyPostForCompletion(target?.completion_id, capturing && !!target);
  const startSrv = useServerFn(startWorkoutFn);

  // The look they're on (swipe to change).
  const [lockLook, setLockLook] = useState<LockLook>("lockin");
  const [workoutLook, setWorkoutLook] = useState<ShareTemplate | null>(null);
  const { data: targetStats } = useCompletionPreview(target?.completion_id ?? "", capturing && !!target);
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
  const lockCard = useMemo(() => (today ? lockInCameraCard({ workoutTitle: today.title, athleteName: today.athleteName, plan: plan ?? [] }) : null), [today, plan]);
  const cameraCard: CameraCard | null =
    activeMode === "lockin" && lockCard
      ? { data: lockCard.data, looks: lockCard.looks, look: lockCard.looks.includes(lockLook) ? lockLook : "lockin", onLook: (t) => setLockLook(t as LockLook) }
      : workoutCard && currentWorkoutLook
        ? { data: workoutCard.data, looks: workoutCard.looks, look: currentWorkoutLook, onLook: setWorkoutLook }
        : null;

  const begin = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    setMode(null);
    setChosen(null);
    setWorkoutLook(null);
    setCapturing(true);
  };

  const ensureStarted = async (): Promise<string | null> => {
    if (!today) return null;
    if (lockCompletionId) return lockCompletionId;
    const res = await startSrv({ data: { kind: "client" as const, dayId: today.dayId, scheduledWorkoutId: today.scheduledWorkoutId } });
    const id = (res as any)?.id ?? null;
    setStartedId(id);
    qc.invalidateQueries({ queryKey: ["pl-day-completion", today.dayId] });
    qc.invalidateQueries({ queryKey: ["community-today-session"] });
    return id;
  };

  const lockPost: StudioPost | null = today
    ? {
        key: `lock:${lockCompletionId ?? today.dayId}:${lockExisting?.id ?? ""}`,
        label: lockExisting ? "Update" : "Post",
        caption: lockExisting?.caption,
        visibility: lockExisting?.visibility,
        onPost: async (a) => {
          if (!user?.id) throw new Error("Sign in again to post");
          const id = await ensureStarted();
          if (!id) throw new Error("Couldn't start your session. Try again.");
          await shareToCommunity(qc, { userId: user.id, completionId: id, caption: a.caption, visibility: a.visibility, photo: a.photo, existing: lockExisting });
          const t = postedToast(a.visibility, true, !!lockExisting);
          toast.success(t.title, { description: t.description });
        },
      }
    : null;
  const workoutPost: StudioPost | null = target
    ? {
        key: `workout:${target.completion_id}:${targetPost?.id ?? ""}`,
        label: targetPost ? "Update" : "Post",
        caption: targetPost?.caption,
        visibility: targetPost?.visibility,
        hideLoads: targetPost?.hide_loads,
        showHideLoads: true,
        onPost: async (a) => {
          if (!user?.id) throw new Error("Sign in again to post");
          await shareToCommunity(qc, { userId: user.id, completionId: target.completion_id, caption: a.caption, visibility: a.visibility, hideLoads: a.hideLoads, photo: a.photo, existing: targetPost });
          const t = postedToast(a.visibility, false, !!targetPost);
          toast.success(t.title, { description: t.description, action: a.visibility === "community" ? { label: "View", onClick: () => navigate({ to: "/portal/community" }) } : undefined });
        },
      }
    : null;

  const changeTarget = () => setRawOpen(true);

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

      <Sheet open={open} onOpenChange={setRawOpen}>
        <SheetContent side="bottom" hideCloseButton className="max-h-[80dvh] rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
          <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
            <SheetTitle className="text-base font-black">Share a workout</SheetTitle>
            <SheetDescription className="text-xs">Which workout are you sharing?</SheetDescription>
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
                          setChosen(s);
                          setWorkoutLook(null);
                          setRawOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-muted",
                          today ? "mb-1 border border-primary/30 bg-primary/[0.06] hover:bg-primary/10" : "hover:bg-muted",
                          target?.completion_id === s.completion_id && "ring-2 ring-foreground",
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

      {videoFor && (
        <Suspense fallback={null}>
          <ShareComposer
            open={!!videoFor}
            onOpenChange={(o) => !o && setVideoFor(null)}
            completionId={videoFor.session.completion_id}
            athleteName={videoFor.session.athlete_name}
            workoutTitle={videoFor.session.title}
            unit={unit}
            initialFile={videoFor.file}
          />
        </Suspense>
      )}

      {capturing && (
        <Suspense fallback={null}>
          <ShareStudio
            open={capturing}
            onClose={() => setCapturing(false)}
            accept={activeMode === "lockin" ? "image/*" : "image/*,video/*"}
            onVideo={
              activeMode === "workout" && target
                ? (file) => {
                    setCapturing(false);
                    setVideoFor({ session: target, file });
                  }
                : undefined
            }
            modes={today ? [{ key: "lockin", label: "Lock in" }, { key: "workout", label: "Workout" }] : undefined}
            mode={activeMode}
            onMode={(k) => setMode(k as Mode)}
            canShoot={activeMode === "lockin" ? !!today : !!target && !!workoutCard}
            card={cameraCard}
            post={activeMode === "lockin" ? lockPost : workoutPost}
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
          />
        </Suspense>
      )}
    </>
  );
}
