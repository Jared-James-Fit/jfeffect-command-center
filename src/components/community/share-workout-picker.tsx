import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, POST_POINTS_RECENT_DAYS, formatWorkoutDuration, groupSessions, lockInCameraCard, mealCameraCard, mealFuelMoment, postPointsHint, sessionDisplayTitle, sessionWhen } from "@/lib/community";
import { createCommunityPost, shareToCommunity, useDayPlan, useMyPostForCompletion, usePostPointsStatus, usePublicSessionTitle, useRecentCompletions, useTodaySession, type RecentCompletion } from "@/lib/community.queries";
import { TEMPLATE_LABEL, type ShareTemplate } from "@/lib/workout-share-card";
import type { CameraCard, ShareKind, StudioPost } from "@/components/community/share-studio";
import type { LookItem } from "@/components/community/look-carousel";
import { startWorkout as startWorkoutFn } from "@/lib/workout-completion.functions";
import { audienceDoneLabel } from "@/components/community/audience-picker";
import { CameraChip } from "@/components/community/camera-overlays";
import { postedToast, useWorkoutStudio } from "@/components/community/use-workout-studio";

import { PostComposer, ShareComposer, ShareStudio, StudioShell, preloadStudio, usePreloadStudio } from "@/components/community/studio-chunks";
import { opensLibraryOnTap, useComposerPicker } from "@/components/community/composer-pick";
import { NORMAL_KEY, buildFilterRow, fxCard, isFxKey, useFilterContext } from "@/components/community/crew-filters";
import { primeCamera, studioCameraAsk } from "@/lib/camera/camera-prime";

type Mode = "post" | "meal" | "lockin" | "workout" | "fx";
/** A plain post (any photo or video, no workout on it): one per person at a time while it's being made. */
const plainKey = (userId: string | undefined) => `post:new:${userId ?? ""}`;
/** A meal photo: its own draft, so a half-made workout post isn't touched. */
const mealKey = (userId: string | undefined) => `meal:new:${userId ?? ""}`;
type MealLook = Extract<ShareTemplate, "mealprep" | "onplan" | "fuel" | "highday" | "cheat" | "plain">;
type LockLook = Extract<ShareTemplate, "lockin" | "lockclock" | "lockplan">;
/** A filter's name over the shutter, where the card's own name alone would be unclear in one long row. */
const FILTER_LABEL: Partial<Record<Exclude<Mode, "post" | "fx">, Partial<Record<ShareTemplate, string>>>> = {
  lockin: { lockclock: "Lock in clock", lockplan: "Today's plan" },
  workout: { photo: "Workout photo", stats: "Workout stats" },
};

/** The app's own red for the one action we want people to take. */
export const SHARE_GRADIENT = "bg-primary";

/**
 * "+": Instagram's two ways to share, Nov 22 2026.
 *
 *   Post   the New post screen (PostComposer): the tap on + opens the
 *          phone's photo library (a finger) and what's picked lands there:
 *          frame it, a filter on the first photo (Normal, the looks, today's
 *          lock in, the workout's cards, a meal's), text and stickers, then
 *          the caption, tags, who sees it and the workout it's for.
 *   Story  the story camera (ShareStudio): the filters around the shutter,
 *          in groups (Today · Lock in · Train · Block · Fuel · Time ·
 *          Mindset · Vibe, story-filters.ts), and @ to tag people.
 *
 * Which post a filter makes: today's lock in starts the session, a workout
 * card (or the Workout row switched on) posts that workout (League points),
 * a meal look or any other filter is a plain post. Post · Story along the
 * bottom of each moves to the other.
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
  /** Opened from "Your story": the story camera, its clips trimmed to a story's 60 seconds. */
  story?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // The session list (from the camera's chip, or the New post screen's Workout row).
  const [rawOpen, setRawOpen] = useState(false);
  const open = rawOpen && !previewOnly;
  // the story camera / the New post screen
  const [capturing, setCapturing] = useState(false);
  const [composing, setComposing] = useState(false);
  const active = capturing || composing;
  const { data: sessions, isLoading } = useRecentCompletions(open || active);
  // The workout the shot is for: their pick, else the newest finished one.
  const [chosen, setChosen] = useState<RecentCompletion | null>(null);
  const target = chosen ?? sessions?.[0] ?? null;
  // A video from the library on a workout card (the camera): the full editor (cards can't sit on video).
  const [videoFor, setVideoFor] = useState<{ session: RecentCompletion; file: File } | null>(null);
  // Fetched up front so the camera opens on the right mode.
  const { data: today } = useTodaySession(!previewOnly);
  // null = not picked yet: the story camera and the New post screen both start on Normal
  const [mode, setMode] = useState<Mode | null>(null);
  const [fx, setFx] = useState<string | null>(null);
  const freshWorkout = !!target && Date.now() - new Date(target.completed_at).getTime() < 86_400_000;
  const activeMode: Mode = mode === "lockin" && !today ? "post" : mode === "workout" && !target && !isLoading ? "post" : mode ?? "post";
  usePreloadStudio(!previewOnly);
  const [startedId, setStartedId] = useState<string | null>(null);
  const lockCompletionId = today ? startedId ?? today.completionId : null;
  const lockExistingQ = useMyPostForCompletion(lockCompletionId, active && !!lockCompletionId, "lockin");
  const lockExisting = lockExistingQ.data;
  // a session not started yet has no post to wait for
  const lockKnown = !lockCompletionId || lockExisting !== undefined;
  const { data: plan } = useDayPlan(active ? today?.dayId ?? null : null);
  const startSrv = useServerFn(startWorkoutFn);
  // the New post screen: posted as the workout (League points), on by default for a fresh one not shared yet
  const [linked, setLinked] = useState<boolean | null>(null);
  const workoutLinked = activeMode === "workout" || (linked ?? (freshWorkout && !target?.post_id));
  const { data: pointsStatus } = usePostPointsStatus(composing);

  // The look they're on (swipe to change).
  const [lockLook, setLockLook] = useState<LockLook>("lockin");
  const [mealLook, setMealLook] = useState<MealLook>("mealprep");
  const fuel = mealFuelMoment({ lastFinishedAt: target?.completed_at ?? null, sessionToday: !!today });
  const mealCard = useMemo(() => mealCameraCard({ athleteName: today?.athleteName ?? target?.athlete_name ?? null, fuel }), [today?.athleteName, target?.athlete_name, fuel]);
  const workout = useWorkoutStudio(target, unit, active);
  const { data: publicTitle } = usePublicSessionTitle({ dayId: today?.dayId }, !!today);
  const { data: finishedTitle } = usePublicSessionTitle({ completionId: target?.completion_id }, active && !!target && !today);
  const lockCard = useMemo(() => (today ? lockInCameraCard({ workoutTitle: publicTitle ?? "Workout", athleteName: today.athleteName, plan: plan ?? [] }) : null), [today, plan, publicTitle]);

  // What the story filters can show (story-filters.ts): the athlete's own, already-public things.
  const wd = workout.card?.data;
  const filterCtx = useFilterContext({
    enabled: active,
    firstName: (today?.athleteName ?? target?.athlete_name ?? "").trim().split(/\s+/)[0] || null,
    session: today ? { title: publicTitle ?? "Today's session", started: today.started } : null,
    finished:
      freshWorkout && wd
        ? {
            title: wd.workoutTitle,
            duration: wd.extras?.duration ?? null,
            sets: wd.extras?.sets ?? null,
            volume: wd.volume,
            lift: wd.lift ? { name: wd.lift.name, detail: wd.lift.detail, alt: wd.lift.alt ?? null, pr: !!wd.lift.prLabel } : null,
            workoutNumber: wd.extras?.workoutNumber ?? null,
            streakWeeks: wd.extras?.streak?.weeks ?? null,
          }
        : null,
    blockTitle: publicTitle ?? finishedTitle ?? null,
    fuel,
  });
  // (kept while the filter and the minute hold, so the editors only repaint when something changed)
  const fxOn = useMemo(() => (activeMode === "fx" && fx ? fxCard(fx, filterCtx, mealCard.data) : null), [activeMode, fx, filterCtx, mealCard.data]);

  const cameraCard: CameraCard | null = useMemo(
    () =>
      activeMode === "fx"
        ? fxOn?.card ?? null
        : activeMode === "meal"
          ? { data: mealCard.data, looks: mealCard.looks, look: mealLook, onLook: (t) => setMealLook(t as MealLook) }
          : activeMode === "lockin" && lockCard
            ? { data: lockCard.data, looks: lockCard.looks, look: lockCard.looks.includes(lockLook) ? lockLook : "lockin", onLook: (t) => setLockLook(t as LockLook) }
            : activeMode === "workout"
              ? workout.card
              : null,
    [activeMode, fxOn, mealCard, mealLook, lockCard, lockLook, workout.card],
  );

  const reset = () => {
    setMode(null);
    setFx(null);
    setChosen(null);
    setLinked(null);
    workout.resetLook();
  };

  // the phone's library and camera, in the page so the tap on + can open them
  const [incoming, setIncoming] = useState<{ files: File[]; live: boolean; n: number } | null>(null);
  const n = useRef(0);
  const picker = useComposerPicker((files, live) => {
    n.current += 1;
    setIncoming({ files, live, n: n.current });
    setComposing(true);
  });

  /** Post: the New post screen (a finger: the library opens in the same tap, Instagram's). */
  const beginPost = (pickNow = opensLibraryOnTap()) => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    preloadStudio();
    reset();
    setIncoming(null);
    setCapturing(false);
    setComposing(true);
    if (pickNow) picker.library();
  };
  /** Story: the camera, its filters around the shutter. */
  const beginStory = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    // the studio's camera asked for in this tap, so a camera already allowed opens without asking again
    primeCamera(studioCameraAsk("environment"));
    preloadStudio();
    reset();
    setComposing(false);
    setCapturing(true);
  };
  const begin = () => (story ? beginStory() : beginPost());

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

  // POST: any photo or clip, no workout on it
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

  // The filters, one row (Normal, then the groups in the order that fits right now): the cards a lock in,
  // a workout and a meal have lead their groups; the story filters fill every group.
  const named = (m: Exclude<Mode, "post" | "fx">, t: ShareTemplate): LookItem => ({ key: `${m}:${t}`, look: t, label: FILTER_LABEL[m]?.[t] ?? TEMPLATE_LABEL[t] });
  const group = (m: Exclude<Mode, "post" | "fx">, looks: ShareTemplate[]) => looks.filter((t) => t !== "plain").map((t) => named(m, t));
  const row = useMemo(
    () =>
      buildFilterRow(filterCtx, {
        lockin: today && lockCard ? group("lockin", lockCard.looks) : [],
        today: target || isLoading
          ? workout.card
            ? group("workout", workout.card.looks)
            : target || isLoading
              ? [{ key: "workout:pending", look: "photo" as ShareTemplate, label: "Workout" }]
              : []
          : [],
        fuel: group("meal", mealCard.looks),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterCtx, today, lockCard, target, isLoading, workout.card?.looks.join("|"), mealCard.looks.join("|")],
  );
  const filterOn =
    activeMode === "post"
      ? NORMAL_KEY
      : activeMode === "fx" && fx
        ? fx
        : activeMode === "workout" && !workout.card
          ? "workout:pending"
          : cameraCard
            ? `${activeMode}:${cameraCard.look}`
            : NORMAL_KEY;
  const onFilter = (key: string) => {
    if (key === NORMAL_KEY) {
      setMode("post");
      setFx(null);
      return;
    }
    if (isFxKey(key)) {
      setMode("fx");
      setFx(key);
      return;
    }
    const [m, look] = key.split(":") as [Mode, string];
    setMode(m);
    setFx(null);
    if (m === "meal") setMealLook(look as MealLook);
    else if (m === "lockin") setLockLook(look as LockLook);
    else if (m === "workout" && look !== "pending") workout.card?.onLook(look as ShareTemplate);
  };

  // the post a New post screen makes: the lock in, the workout (its card, or the Workout row on), else plain / meal
  const composerPost: StudioPost | null =
    activeMode === "lockin" ? lockPost : workoutLinked && target ? workout.post : activeMode === "meal" ? mealPost : plainPost;
  const composerPoints = (v: Parameters<typeof postPointsHint>[1]) =>
    activeMode === "lockin"
      ? postPointsHint(pointsStatus, v, !!lockExisting, { lockIn: true })
      : workoutLinked && target
        ? postPointsHint(pointsStatus, v, !!target.post_id, { completedAt: target.completed_at })
        : null;
  const recentEnough = !!target && Date.now() - new Date(target.completed_at).getTime() < POST_POINTS_RECENT_DAYS * 86_400_000;

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
            "inline-flex items-center justify-center gap-1.5 font-bold text-white shadow-md shadow-primary/25 transition active:scale-[0.97]",
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
            <SheetTitle className="text-base font-bold">Share a workout</SheetTitle>
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
                  <div className={cn("px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em]", g.key === "today" ? "text-primary" : "text-muted-foreground")}>{g.label}</div>
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

      {/* the library and camera the New post screen opens (always here, so the + tap can open them) */}
      {picker.inputs}

      {composing && (
        <StudioShell onClose={() => setComposing(false)}>
          <PostComposer
            open={composing}
            onClose={() => setComposing(false)}
            incoming={incoming}
            onPick={(how) => (how === "camera" ? picker.camera() : picker.library())}
            filters={{ items: row.items, groups: row.groups, on: filterOn, pick: onFilter, card: cameraCard, gradeOnly: fxOn?.grade ?? false }}
            post={composerPost}
            plainPost={plainPost}
            onStory={beginStory}
            points={composerPoints}
            videoContext={workoutLinked && target ? "workout" : "post"}
            workout={
              target && recentEnough
                ? {
                    title: sessionDisplayTitle(target.title),
                    sub: sessionWhen(target.completed_at).when,
                    on: workoutLinked,
                    locked: activeMode === "workout",
                    onToggle: (on) => setLinked(on),
                    onChange: (sessions?.length ?? 0) > 1 ? changeTarget : undefined,
                  }
                : null
            }
          />
        </StudioShell>
      )}

      {capturing && (
        <StudioShell onClose={() => setCapturing(false)}>
          <ShareStudio
            open={capturing}
            onClose={() => setCapturing(false)}
            accept={activeMode === "lockin" || activeMode === "meal" ? "image/*" : "image/*,video/*"}
            onVideo={
              activeMode === "workout" && target
                ? (file) => {
                    setCapturing(false);
                    setVideoFor({ session: target, file });
                  }
                : undefined
            }
            filters={row.items}
            filterGroups={row.groups}
            filter={filterOn}
            onFilter={onFilter}
            // the story camera (Post is the New post screen's, a tap away along the bottom)
            startAs="story"
            onPostFlow={() => beginPost(true)}
            tagPeople
            videoContext={activeMode === "workout" ? "workout" : "post"}
            // shoot straight away: the card's numbers land on the photo when they arrive
            canShoot={activeMode === "lockin" ? !!today : activeMode === "workout" ? !!target : true}
            allowNoPhoto={activeMode !== "meal" && activeMode !== "fx"}
            card={activeMode === "post" ? null : cameraCard}
            post={activeMode === "lockin" ? lockPost : activeMode === "workout" ? workout.post : activeMode === "meal" ? mealPost : plainPost}
            // the lock in's and the workout's say what they're for; the rest need no chip (the filter's name is over the shutter)
            chip={
              activeMode === "lockin" && today ? (
                <CameraChip icon="🔒" title={sessionDisplayTitle(today.title)} sub={lockExisting ? "Update your lock in" : today.started ? "In progress" : "Your story starts your session"} />
              ) : activeMode !== "workout" ? undefined : target ? (
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
    </>
  );
}
