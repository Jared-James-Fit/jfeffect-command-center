import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Camera, Check, ChevronRight, Clapperboard, Image as ImageIcon, Loader2, PenSquare, Share, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { isCrewAudience, postPointsHint } from "@/lib/community";
import { invalidateCommunity, saveCommunityPost, useCommunityActivity, useDeletePost, useMyPostForCompletion, usePostPointsStatus } from "@/lib/community.queries";
import { storyLookLabel } from "@/lib/quick-story";
import { QuickStorySheet, QuickStoryThumb, useQuickStory } from "@/components/community/quick-story";
import { ShareOutSheet } from "@/components/community/share-out-sheet";
import { promoLine, shareFileName, workoutShareCaption } from "@/lib/share-out";
import { canvasToBlob, ensureDisplayFont } from "@/lib/workout-share-card";
import { saveFiles } from "@/lib/file-share";
import { useChatSignedUrl } from "@/hooks/use-chat-signed-urls";
import { saveVideosLabel } from "@/lib/set-videos/save-offer";
import { recapStatus } from "@/lib/workouts/completion-screen";
import type { WorkoutFilm } from "@/lib/workout-film-client";
import type { SetVideoSaveTarget } from "@/components/workout-day/set-video-phone-copy";

/**
 * The recap's sharing for a finished client workout (Nov 25 2026): one
 * "Share workout" entry under the workout's numbers, opening one sheet (a
 * bottom sheet on a phone, a compact panel on a computer) with every way to
 * share it, and one quiet line saying where it already is ("✓ Shared to Crew ·
 * View"), said once.
 *
 * In the sheet:
 *   Share to Story   the quick share: painted for them already (the workout's
 *                    own numbers, its best look first: a PR leads with the
 *                    record), shown small; one tap on Share to Story posts it
 *                    (24 hours, the story rail only); a tap on the preview opens
 *                    it big to change the look, add a photo or words or keep it
 *                    to Close friends. Nothing goes up until they tap Share, and
 *                    Undo takes it back.
 *   Share to Crew    the session's film (its set videos) posted to Crew in a
 *                    tap, when there is one that isn't up yet.
 *   Create Crew Post the considered post: the full studio (photos and clips,
 *                    captions, GIF, voice memo, who sees it), with what it earns
 *                    in League points; posting there scores exactly as before.
 *   Share outside    Instagram, TikTok, the phone's share sheet (ShareOutSheet).
 *   Save summary     the workout's card to the phone (the share sheet's Save).
 *   Save videos      clips filmed in the app that aren't on the phone yet.
 *
 * Finishing never posts a story by itself; an older automatic story says so
 * with Hide it, and a story they make here takes its place.
 */
export function useRecapShare({
  completionId,
  completedAt,
  unit = "lb",
  workoutTitle,
  athleteName,
}: {
  completionId: string;
  completedAt?: string | Date | null;
  unit?: "kg" | "lb";
  workoutTitle?: string | null;
  athleteName?: string | null;
}) {
  const qc = useQueryClient();
  const { data: activity } = useCommunityActivity(true);
  const { data: existing } = useMyPostForCompletion(completionId);
  // Their lock-in for this session (a separate post): it carries the numbers until the finish is posted.
  const { data: lockIn } = useMyPostForCompletion(completionId, true, "lockin");
  const canPost = activity?.enabled !== false;
  const story = useQuickStory({ completionId, workoutTitle, athleteName, unit, enabled: canPost });
  // the story shared from here (Undo takes it back)
  const [storyId, setStoryId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  // the automatic story, hidden from here (only them now)
  const [hiddenHere, setHiddenHere] = useState(false);
  const [hiding, setHiding] = useState(false);
  const busy = useRef(false);
  const del = useDeletePost();

  const auto = !!existing?.auto_shared;
  const autoUp = auto && !hiddenHere && isCrewAudience(existing?.visibility);
  const hidden = hiddenHere || (auto && existing?.visibility === "private");
  // their own feed post for this session (made in the studio, or by their film)
  const inFeed = !!existing && !auto && isCrewAudience(existing.visibility);
  const { data: points } = usePostPointsStatus(canPost && !inFeed);
  const hint = postPointsHint(points, "community", inFeed, { completedAt: completedAt ? new Date(completedAt).toISOString() : null });
  const earn = hint?.tone === "earn" && points ? points.points : 0;

  // Take the automatic story out of Crew: only they can see it (their profile).
  const hideAuto = async (quiet = false) => {
    if (busy.current) return;
    busy.current = true;
    setHiding(true);
    try {
      await saveCommunityPost({ completionId, caption: "", visibility: "private", media: { action: "keep" } });
      setHiddenHere(true);
      invalidateCommunity(qc);
    } catch (e: any) {
      if (!quiet) toast.error(e?.message ?? "Couldn't hide it. Try again.");
    } finally {
      busy.current = false;
      setHiding(false);
    }
  };

  const shareStory = async () => {
    const replaces = autoUp;
    const id = await story.share();
    if (!id) return false;
    setStoryId(id);
    // the automatic story from this workout gives way to the one they made (never two of the same session)
    if (replaces) await hideAuto(true);
    toast.success(story.audience === "close_friends" ? "Added to your Close friends story" : "Added to your story", { description: "It's in the story row for 24 hours." });
    return true;
  };

  const undoStory = async () => {
    const id = storyId;
    if (!id || undoing) return;
    setUndoing(true);
    try {
      // its picture goes with it
      const { data } = await supabase.from("community_posts").select("media_path, media_thumb_path").eq("id", id).maybeSingle();
      await del.mutateAsync({ id, media_path: data?.media_path ?? null, media_thumb_path: data?.media_thumb_path ?? null, is_mine: true });
      setStoryId(null);
      toast("Taken off your story");
    } catch {
      toast.error("Couldn't take it down. Delete it from your story.");
    } finally {
      setUndoing(false);
    }
  };

  /** The workout's card as an image file (the story's look and shape). */
  const summaryFile = async (): Promise<File | null> => {
    await ensureDisplayFont();
    const c = document.createElement("canvas");
    try {
      if (!story.paint(c, { scale: 1, format: "story" })) return null;
      const b = await canvasToBlob(c, "image/jpeg", 0.92);
      return b ? new File([b], shareFileName("story", story.look), { type: "image/jpeg" }) : null;
    } finally {
      c.width = 0;
      c.height = 0;
    }
  };

  return {
    completionId,
    canPost,
    story,
    storyId,
    undoing,
    hiding,
    existing,
    lockIn,
    autoUp,
    hidden,
    inFeed,
    earn,
    hideAuto,
    shareStory,
    undoStory,
    summaryFile,
  };
}

export type RecapShareState = ReturnType<typeof useRecapShare>;

/** Where the workout already is, said once: "✓ Shared to Crew · View", "On your story", or the automatic story with Hide it. */
export function RecapShareStatus({ share, film, className }: { share: RecapShareState; film?: WorkoutFilm | null; className?: string }) {
  const navigate = useNavigate();
  const s = recapStatus({
    inFeed: share.inFeed,
    filmPosted: !!film?.posted,
    storyShared: !!share.storyId,
    autoUp: share.autoUp,
    hidden: share.hidden,
  });
  if (!s) return null;
  const postId = share.inFeed ? share.existing?.id ?? null : film?.postId ?? null;
  return (
    <p className={cn("flex flex-wrap items-center justify-center gap-x-1 text-center text-[13px] text-muted-foreground", className)} data-recap-status={s}>
      {s === "crew" || s === "crew+story" ? (
        <>
          <span className="inline-flex items-center gap-1 font-medium text-success">
            <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> Shared to Crew{s === "crew+story" ? " and your story" : ""}
          </span>
          {postId && (
            <>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => navigate({ to: "/portal/community", hash: `post=${postId}` })} className="font-semibold text-foreground active:opacity-60" data-recap-status-view>
                View
              </button>
            </>
          )}
        </>
      ) : s === "story" ? (
        <span className="inline-flex items-center gap-1 font-medium text-success">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> On your story
        </span>
      ) : s === "auto" ? (
        <>
          Posted to your story automatically ·{" "}
          <button type="button" onClick={() => void share.hideAuto()} disabled={share.hiding} className="font-semibold text-foreground underline underline-offset-2 active:opacity-60">
            {share.hiding ? "Hiding…" : "Hide it"}
          </button>
        </>
      ) : (
        "Hidden from Crew. Only you can see this session."
      )}
    </p>
  );
}

/**
 * The one way into sharing from the recap: "Share workout", opening the sheet
 * of every share (and the story editor / Share outside sheets it leads to).
 */
export function RecapShare({
  share,
  film,
  onFilmPost,
  videos,
  onSaveVideos,
  onWarmVideos,
  onStudio,
  className,
}: {
  share: RecapShareState;
  /** The session's film, when it has one (Share to Crew posts it). */
  film?: WorkoutFilm | null;
  onFilmPost?: () => Promise<void> | void;
  /** Clips filmed in the app not on the phone yet. */
  videos?: SetVideoSaveTarget[];
  onSaveVideos?: () => void;
  onWarmVideos?: () => void;
  /** Opens the full studio for a Crew post, carrying any words written for the story. */
  onStudio: (caption: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // Share outside the app: Instagram, TikTok, the phone's share sheet, Save, Copy caption
  const [sharingOut, setSharingOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const { story, storyId, inFeed, earn } = share;

  if (!share.canPost) {
    // No community on this account: the studio still makes a story / sends it to the coach.
    return (
      <Button type="button" variant="outline" className={cn("h-12 w-full rounded-xl text-[15px] font-semibold", className)} onClick={() => onStudio("")} data-recap-share>
        <Camera className="mr-1.5 h-4 w-4" />
        Share workout
      </Button>
    );
  }

  const lookName = story.look ? storyLookLabel(story.look, !!story.photo) : null;
  const filmToPost = !!film && film.postable > 0 && !film.posted && !film.uploading && !film.posting;
  const shareStory = async () => {
    if (await share.shareStory()) {
      setEditing(false);
      setOpen(false);
    }
  };
  const saveSummary = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const f = await share.summaryFile();
      if (!f) return void toast.error("Your workout card isn't ready yet. Try again in a moment.");
      const o = await saveFiles([f]);
      if (o === "failed") toast.error("Couldn't save it. Try Share outside the app.");
      else if (o === "again") toast("Tap Save summary again to open the share sheet.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("h-12 w-full gap-2 rounded-xl text-[15px] font-semibold", className)}
        onClick={() => setOpen(true)}
        data-recap-share
      >
        <Share className="h-4 w-4" />
        Share workout
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          swipeToClose
          className="max-h-[92svh] overflow-y-auto rounded-t-2xl px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-4"
          data-recap-share-sheet
        >
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted-foreground/25 sm:hidden" aria-hidden />
          <SheetTitle className="text-[17px] font-semibold">Share workout</SheetTitle>
          <SheetDescription className="sr-only">Every way to share this workout</SheetDescription>
          {share.lockIn && <div className="mt-1 text-[12px] text-muted-foreground">🔒 Your lock-in stays up. This shares the finish.</div>}

          {/* the story: painted already, one tap to post it, a tap on it to change it */}
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-2" data-recap-story={storyId ? "shared" : "ready"}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={!!storyId}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left active:opacity-70 disabled:active:opacity-100"
              aria-label={storyId ? "Your story" : "Edit your story: look, photo, words"}
            >
              <QuickStoryThumb story={story} className="h-[76px] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-tight">{storyId ? "On your story" : "Your story"}</span>
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {storyId ? (story.audience === "close_friends" ? "Close friends · 24 hours" : "Crew · 24 hours") : story.ready ? `${lookName} look` : "Getting it ready…"}
                </span>
                {!storyId && (
                  <span className="mt-1 inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-medium text-foreground" data-recap-story-edit>
                    Tap to edit <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
            </button>
            {storyId ? (
              <Button type="button" variant="outline" className="h-10 shrink-0 rounded-lg px-3 text-[13px] font-semibold" onClick={() => void share.undoStory()} disabled={share.undoing} data-recap-story-undo>
                {share.undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Undo"}
              </Button>
            ) : (
              <Button type="button" className="h-11 shrink-0 rounded-lg px-3.5 text-[14px] font-semibold" onClick={() => void shareStory()} disabled={!story.ready || story.busy} data-recap-share-story>
                {story.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share to Story"}
              </Button>
            )}
          </div>

          <div className="mt-2 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card">
            {filmToPost && (
              <ShareRow
                icon={<Users className="h-4 w-4" />}
                title="Share to Crew"
                sub={`Your film: ${film!.postable} ${film!.postable === 1 ? "set" : "sets"}`}
                onClick={() => {
                  setOpen(false);
                  void onFilmPost?.();
                }}
                data="crew"
              />
            )}
            <ShareRow
              icon={<PenSquare className="h-4 w-4" />}
              title={inFeed ? "Edit Crew post" : "Create Crew Post"}
              sub={earn > 0 ? `+${earn} league points` : inFeed ? "Photos, clips and words" : "Photos, clips, words, who sees it"}
              subTone={earn > 0 ? "earn" : undefined}
              onClick={() => {
                setOpen(false);
                onStudio(story.caption.trim());
              }}
              data="crew-post"
            />
            {story.ready && story.data && (
              <ShareRow icon={<Share className="h-4 w-4" />} title="Share outside the app" sub="Instagram, TikTok and more" onClick={() => setSharingOut(true)} data="share-out" />
            )}
            {story.ready && story.data && (
              <ShareRow icon={<ImageIcon className="h-4 w-4" />} title="Save workout summary" sub="The workout's card, to your phone" onClick={() => void saveSummary()} busy={saving} data="save-summary" />
            )}
            {!!videos?.length && (
              <ShareRow
                icon={<ArrowDownToLine className="h-4 w-4" />}
                title={saveVideosLabel(videos.length)}
                sub="Filmed in the app, they're only with your coach"
                onPointerDown={onWarmVideos}
                onClick={() => onSaveVideos?.()}
                data="save-videos"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {story.data && (
        <ShareOutSheet
          open={sharingOut}
          onOpenChange={setSharingOut}
          look={story.look}
          caption={workoutShareCaption({ workoutTitle: story.data.workoutTitle, lift: story.data.lift, isPr: story.data.isPr }, { promo: false })}
          promoLine={promoLine({ isPr: story.data.isPr, lift: story.data.lift })}
          make={async (format) => {
            await ensureDisplayFont();
            const c = document.createElement("canvas");
            try {
              if (!story.paint(c, { scale: 1, format })) return null;
              const b = await canvasToBlob(c, "image/jpeg", 0.92);
              return b ? new File([b], shareFileName(format, story.look), { type: "image/jpeg" }) : null;
            } finally {
              c.width = 0;
              c.height = 0;
            }
          }}
        />
      )}

      <QuickStorySheet
        open={editing}
        onClose={() => setEditing(false)}
        story={story}
        onShare={() => void shareStory()}
        onVideo={() => {
          setEditing(false);
          setOpen(false);
          onStudio(story.caption.trim());
        }}
      />
    </>
  );
}

function ShareRow({
  icon,
  title,
  sub,
  subTone,
  onClick,
  onPointerDown,
  busy,
  data,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  subTone?: "earn";
  onClick: () => void;
  onPointerDown?: () => void;
  busy?: boolean;
  data: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={busy}
      className="flex min-h-[56px] w-full items-center gap-3 px-3 text-left active:bg-muted disabled:opacity-60"
      data-recap-share-row={data}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground" aria-hidden>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        {sub && <span className={cn("mt-0.5 block truncate text-[12px]", subTone === "earn" ? "font-medium text-foreground" : "text-muted-foreground")}>{sub}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/** The film's one line on the recap: posters, "7 sets filmed", where it is, View. */
export function RecapFilmLine({ film, onRetry, className }: { film: WorkoutFilm; onRetry: () => void; className?: string }) {
  const navigate = useNavigate();
  const n = film.clips + film.uploading;
  if (!n) return null;
  let status: React.ReactNode = null;
  if (film.uploading > 0)
    status = (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {film.uploading} still uploading
      </span>
    );
  else if (film.posting)
    status = (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Posting your film…
      </span>
    );
  else if (film.error) status = <span className="text-destructive">{film.error}</span>;
  else if (!film.posted && film.autoOn === false && !film.hidden) status = "Coach only";
  return (
    <div className={cn("flex min-h-12 items-center gap-3", className)} data-recap-film={film.posted ? "posted" : film.uploading ? "uploading" : "ready"}>
      <FilmPosters paths={film.posterPaths} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">
          {n} {n === 1 ? "set" : "sets"} filmed
        </div>
        {status && <div className="truncate text-[12px] text-muted-foreground">{status}</div>}
      </div>
      {film.error ? (
        <Button type="button" variant="ghost" className="h-10 shrink-0 px-3" onClick={onRetry}>
          Try again
        </Button>
      ) : film.posted && film.postId ? (
        <Button type="button" variant="ghost" className="h-10 shrink-0 px-3" onClick={() => navigate({ to: "/portal/community", hash: `post=${film.postId}` })} data-recap-film-view>
          View
        </Button>
      ) : null}
    </div>
  );
}

function FilmPosters({ paths }: { paths: string[] }) {
  const p = paths[0];
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground" aria-hidden>
      {p ? <FilmPoster path={p} /> : <Clapperboard className="h-5 w-5" />}
    </span>
  );
}

function FilmPoster({ path }: { path: string }) {
  const url = useChatSignedUrl(path);
  return url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : <Clapperboard className="h-5 w-5" />;
}

