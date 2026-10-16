import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, formatWorkoutDuration, groupSessions, lockInCameraCard, mealCameraCard, mealFuelMoment, sessionDisplayTitle, sessionWhen } from "@/lib/community";
import { createCommunityPost, shareToCommunity, useCreateCommunityPost, useDayPlan, useMyPostForCompletion, usePublicSessionTitle, useRecentCompletions, useTodaySession, type RecentCompletion } from "@/lib/community.queries";
import { TEMPLATE_LABEL, type ShareTemplate } from "@/lib/workout-share-card";
import type { CameraCard, StudioPost } from "@/components/community/share-studio";
import type { LookItem } from "@/components/community/look-carousel";
import { startWorkout as startWorkoutFn } from "@/lib/workout-completion.functions";
import { audienceDoneLabel } from "@/components/community/audience-picker";
import { CameraChip } from "@/components/community/camera-overlays";
import { postedToast, useWorkoutStudio } from "@/components/community/use-workout-studio";

import { NoteEditor, ShareComposer, ShareStudio, StudioShell, preloadStudio, usePreloadStudio } from "@/components/community/studio-chunks";

type Mode = "post" | "meal" | "lockin" | "workout";
/** A plain post (any photo or video, no workout on it): one per person at a time while it's being made. */
const plainKey = (userId: string | undefined) => `post:new:${userId ?? ""}`;
/** A meal photo: its own draft, so a half-made workout post isn't touched. */
const mealKey = (userId: string | undefined) => `meal:new:${userId ?? ""}`;
type MealLook = Extract<ShareTemplate, "mealprep" | "onplan" | "fuel" | "highday" | "cheat" | "plain">;
type LockLook = Extract<ShareTemplate, "lockin" | "lockclock" | "lockplan">;
/** A filter's name over the shutter, where the card's own name alone would be unclear in one long row. */
const FILTER_LABEL: Partial<Record<Exclude<Mode, "post">, Partial<Record<ShareTemplate, string>>>> = {
  lockin: { lockclock: "Lock in clock", lockplan: "Today's plan" },
  workout: { photo: "Workout photo", stats: "Workout stats" },
};

/** The app's own red for the one action we want people to take. */
export const SHARE_GRADIENT = "bg-primary";

/**
 * "+ Post" — the whole thing on one screen (ShareStudio), Instagram-style:
 * one tap and the camera is up. Along the bottom, what you're making (Post /
 * Story, Instagram's row); around the shutter, the filters, one row of
 * circles (swipe the camera or the row):
 *   Normal   any photo, carousel or clip, words optional; or Write for a
 *            words-first post. Nothing to do with a workout (no points).
 *   Lock in  today's session (Locked in / Clock / Today's plan); posting
 *            starts the session.
 *   Workout  a finished session with its card (Workout photo, vs last time,
 *            Receipt, Streak, Stats, Volume); the chip above the shutter
 *            picks which session.
 *   Meal     a food photo with a look: Meal prep, On plan, Fuel, High day,
 *            Cheat meal. A plain post too (no points).
 * It opens on whatever fits right now: Lock in when there's a session to
 * start, Workout when one finished in the last day, else Normal. Snap, the
 * frame freezes in place, frame it, add text or stickers, a caption, Post.
 * Every post is kept as a draft on the phone until it's up.
 */
export function ShareWorkoutButton({
  unit,
  className,
  label = "Post",
  variant = "pill",
  previewOnly = false,
  labelClassName,
  trigger,
  story = false,
}: {
  unit: "kg" | "lb";
  className?: string;
  label?: string;
  /** Its own button instead of the built-in looks (handed the one tap that opens the camera). */
  trigger?: (begin: () => void) => React.ReactNode;
  /** e.g. hide the words on small phones (the button keeps them as its name) */
  labelClassName?: string;
  variant?: "pill" | "block" | "bubble" | "tile";
  /** Coach viewing as a client: looks the same, but never posts as them. */
  previewOnly?: boolean;
  /** Opened from "Your story": its clips are trimmed to a story's 60 seconds. */
  story?: boolean;
}) {
  const { user } = useAuth();
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
  // what it opens on: a session to start, else a workout from the last day, else a plain post
  const freshWorkout = !!target && Date.now() - new Date(target.completed_at).getTime() < 86_400_000;
  const fallbackMode: Mode = today ? "lockin" : freshWorkout ? "workout" : "post";
  const activeMode: Mode = mode === "lockin" && !today ? fallbackMode : mode === "workout" && !target && !isLoading ? fallbackMode : mode ?? fallbackMode;
  const [writing, setWriting] = useState(false);
  const createPost = useCreateCommunityPost();
  usePreloadStudio(!previewOnly);
  const [startedId, setStartedId] = useState<string | null>(null);
  const lockCompletionId = today ? startedId ?? today.completionId : null;
  const lockExistingQ = useMyPostForCompletion(lockCompletionId, capturing && !!lockCompletionId, "lockin");
  const lockExisting = lockExistingQ.data;
  // a session not started yet has no post to wait for
  const lockKnown = !lockCompletionId || lockExisting !== undefined;
  const { data: plan } = useDayPlan(capturing ? today?.dayId ?? null : null);
  const startSrv = useServerFn(startWorkoutFn);

  // The look they're on (swipe to change).
  const [lockLook, setLockLook] = useState<LockLook>("lockin");
  const [mealLook, setMealLook] = useState<MealLook>("mealprep");
  const fuel = mealFuelMoment({ lastFinishedAt: target?.completed_at ?? null, sessionToday: !!today });
  const mealCard = useMemo(() => mealCameraCard({ athleteName: today?.athleteName ?? target?.athlete_name ?? null, fuel }), [today?.athleteName, target?.athlete_name, fuel]);
  const workout = useWorkoutStudio(target, unit, capturing);
  const { data: publicTitle } = usePublicSessionTitle({ dayId: today?.dayId }, !!today);
  const lockCard = useMemo(() => (today ? lockInCameraCard({ workoutTitle: publicTitle ?? "Workout", athleteName: today.athleteName, plan: plan ?? [] }) : null), [today, plan, publicTitle]);
  const cameraCard: CameraCard | null =
    activeMode === "meal"
      ? { data: mealCard.data, looks: mealCard.looks, look: mealLook, onLook: (t) => setMealLook(t as MealLook) }
      : activeMode === "lockin" && lockCard
        ? { data: lockCard.data, looks: lockCard.looks, look: lockCard.looks.includes(lockLook) ? lockLook : "lockin", onLook: (t) => setLockLook(t as LockLook) }
        : workout.card;

  const begin = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    preloadStudio();
    setMode(null);
    setChosen(null);
    workout.resetLook();
    setCapturing(true);
  };

  // Locking in IS starting the session (same server path as the first logged
  // set). A row can exist without being started (a placeholder made ahead of
  // time); posting needs it started, so only skip this when it really is.
  const ensureStarted = async (): Promise<string | null> => {
    if (!today) return null;
    if (startedId) return startedId;
    if (today.completionId && today.started) return today.completionId;
    const res = await startSrv({ data: { kind: "client" as const, dayId: today.dayId, scheduledWorkoutId: today.scheduledWorkoutId } });
    const id = (res as any)?.id ?? null;
    setStartedId(id);
    qc.invalidateQueries({ queryKey: ["pl-day-completion", today.dayId] });
    qc.invalidateQueries({ queryKey: ["community-today-session"] });
    return id;
  };

  const lockPost: StudioPost | null = today && lockKnown
    ? {
        key: `lock:${lockCompletionId ?? today.dayId}:${lockExisting?.id ?? ""}`,
        label: lockExisting ? "Update" : "Post",
        // a lock in on your story starts the session too
        beforeStory: async () => {
          if (!(await ensureStarted())) throw new Error("Couldn't start your session. Try again.");
        },
        caption: lockExisting?.caption,
        visibility: lockExisting?.visibility,
        extras: lockExisting?.extra_media ?? null,
        attach: lockExisting,
        hasCover: !!lockExisting?.media_path,
        onPost: async (a) => {
          if (!user?.id) throw new Error("Sign in again to post");
          const id = await ensureStarted();
          if (!id) throw new Error("Couldn't start your session. Try again.");
          await shareToCommunity(qc, { userId: user.id, completionId: id, caption: a.caption, visibility: a.visibility, photo: a.photo, existing: lockExisting, extras: a.extras, lockIn: true, attach: a.attach });
          const t = postedToast(a.visibility, true, !!lockExisting);
          toast.success(t.title, { description: t.description });
        },
      }
    : null;
  const changeTarget = () => setRawOpen(true);

  // POST: any photo or clip, no workout card on it
  const plainPost: StudioPost = {
    key: plainKey(user?.id),
    label: "Post",
    onPost: async (a) => {
      if (!user?.id) throw new Error("Sign in again to post");
      await createCommunityPost(qc, { userId: user.id, caption: a.caption, visibility: a.visibility, photo: a.photo, extras: a.extras, attach: a.attach });
      const t = postedToast(a.visibility, false, false);
      toast.success(t.title, { description: t.description });
    },
  };
  // MEAL: a food photo with a look on it (the photo already carries the look)
  const mealPost: StudioPost = {
    key: mealKey(user?.id),
    label: "Post",
    onPost: async (a) => {
      if (!user?.id) throw new Error("Sign in again to post");
      await createCommunityPost(qc, { userId: user.id, caption: a.caption, visibility: a.visibility, photo: a.photo, extras: a.extras, attach: a.attach });
      const t = postedToast(a.visibility, false, false);
      toast.success(t.title, { description: t.description });
    },
  };
  // The filters around the shutter: Normal, then what fits right now (today's
  // lock in, the workout just finished), then the meal looks. "No filter"
  // inside a card's own looks stays a swipe away once the photo's taken.
  const named = (m: Exclude<Mode, "post">, t: ShareTemplate): LookItem => ({ key: `${m}:${t}`, look: t, label: FILTER_LABEL[m]?.[t] ?? TEMPLATE_LABEL[t] });
  // a card's own "No filter" only shows in the row while it's the one you're on (swiped to after a shot)
  const group = (m: Exclude<Mode, "post">, looks: ShareTemplate[]) =>
    looks.filter((t) => t !== "plain" || (activeMode === m && cameraCard?.look === "plain")).map((t) => named(m, t));
  const filters: LookItem[] = [
    { key: "post:normal", look: "plain", label: "Normal" },
    ...(today && lockCard ? group("lockin", lockCard.looks) : []),
    ...(target || isLoading
      ? workout.card
        ? group("workout", workout.card.looks)
        : [{ key: "workout:pending", look: "photo" as ShareTemplate, label: "Workout" }]
      : []),
    ...group("meal", mealCard.looks),
  ];
  const filterOn =
    activeMode === "post" ? "post:normal" : activeMode === "workout" && !workout.card ? "workout:pending" : cameraCard ? `${activeMode}:${cameraCard.look}` : "post:normal";
  const onFilter = (key: string) => {
    const [m, look] = key.split(":") as [Mode, string];
    setMode(m);
    if (m === "meal") setMealLook(look as MealLook);
    else if (m === "lockin") setLockLook(look as LockLook);
    else if (m === "workout" && look !== "pending") workout.card?.onLook(look as ShareTemplate);
  };

  return (
    <>
      {trigger ? (
        trigger(begin)
      ) : variant === "tile" ? (
        // First in Home's shelf: quieter than the posts, but always there.
        <button type="button" onClick={begin} className={cn("flex h-[140px] w-[84px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/40 px-2 active:scale-95", className)} aria-label={label}>
          <span className={cn("grid h-11 w-11 place-items-center rounded-full text-white shadow-md shadow-primary/25", SHARE_GRADIENT)}>
            <Plus className="h-5 w-5" strokeWidth={3} />
          </span>
          <span className="text-center text-[11px] font-bold leading-tight">{label}</span>
        </button>
      ) : variant === "bubble" ? (
        // Instagram "your story" bubble: first item in the Home strip.
        <button type="button" onClick={begin} className={cn("flex w-[64px] shrink-0 flex-col items-center gap-1 active:scale-95", className)} aria-label={label}>
          <span className={cn("grid h-[61px] w-[61px] place-items-center rounded-full text-white shadow-md shadow-primary/25", SHARE_GRADIENT)}>
            <Plus className="h-6 w-6" strokeWidth={3} />
          </span>
          <span className="w-full truncate text-center text-[11px] font-bold">{label}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={begin}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 font-black text-white shadow-md shadow-primary/25 transition active:scale-[0.97]",
            SHARE_GRADIENT,
            variant === "pill" ? "h-9 rounded-full px-4 text-[13px]" : "h-12 w-full rounded-2xl text-[15px]",
            className,
          )}
          aria-label={labelClassName ? label : undefined}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
          {labelClassName ? <span className={labelClassName}>{label}</span> : label}
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
                          workout.resetLook();
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
        <StudioShell onClose={() => setVideoFor(null)}>
          <ShareComposer
            open={!!videoFor}
            onOpenChange={(o) => !o && setVideoFor(null)}
            completionId={videoFor.session.completion_id}
            athleteName={videoFor.session.athlete_name}
            workoutTitle={videoFor.session.title}
            unit={unit}
            initialFile={videoFor.file}
            videoContext="workout"
          />
        </StudioShell>
      )}

      {capturing && (
        <StudioShell onClose={() => setCapturing(false)}>
          <ShareStudio
            open={capturing}
            onClose={() => setCapturing(false)}
            accept={activeMode === "lockin" || activeMode === "meal" ? "image/*" : "image/*,video/*"}
            onWrite={activeMode === "post" ? () => setWriting(true) : undefined}
            onVideo={
              activeMode === "workout" && target
                ? (file) => {
                    setCapturing(false);
                    setVideoFor({ session: target, file });
                  }
                : undefined
            }
            filters={filters}
            filter={filterOn}
            onFilter={onFilter}
            // opened from Your story: straight onto Story (its clips are trimmed to a story's 60 s)
            startAs={story ? "story" : "post"}
            videoContext={activeMode === "workout" ? "workout" : "post"}
            // shoot straight away: the card's numbers land on the photo when they arrive
            canShoot={activeMode === "post" || activeMode === "meal" ? true : activeMode === "lockin" ? !!today : !!target}
            allowNoPhoto={activeMode !== "meal"}
            card={activeMode === "post" ? null : cameraCard}
            post={activeMode === "post" ? plainPost : activeMode === "meal" ? mealPost : activeMode === "lockin" ? lockPost : workout.post}
            // Normal and Meal need no chip (the filter's name is over the shutter, and a chip sat on the card's words)
            chip={
              activeMode === "post" || activeMode === "meal" ? undefined : activeMode === "lockin" && today ? (
                <CameraChip icon="🔒" title={sessionDisplayTitle(today.title)} sub={lockExisting ? "Update your lock in" : today.started ? "In progress" : "Posting it starts your session"} />
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
                <CameraChip icon="🏁" title="Finish a workout to share it" sub="Or post a photo instead" tone="muted" />
              )
            }
          />
        </StudioShell>
      )}

      {/* POST → Write: a words-first post (photos optional) */}
      {writing && (
        <StudioShell onClose={() => setWriting(false)}>
          <NoteEditor
            open={writing}
            title="New post"
            saveLabel="Post"
            wordsOptional
            initial=""
            saving={createPost.isPending}
            media={{ initial: null, key: "member-write", hint: "Add photos or a clip" }}
            onClose={() => setWriting(false)}
            onSave={async (body, _poll, media) => {
              const id = await createPost.mutateAsync({ caption: body, media });
              toast.success("You're in the feed 🔥");
              setWriting(false);
              setCapturing(false);
              return id;
            }}
          />
        </StudioShell>
      )}
    </>
  );
}
