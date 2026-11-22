import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Film, ImagePlus, Images, Loader2, PenLine, Star, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { CommunityVisibility } from "@/lib/community";
import { createCommunityPost } from "@/lib/community.queries";
import { canvasToBlob, cardLogo, ensureDisplayFont, paintShareCard, type ShareCardData, type ShareTemplate } from "@/lib/workout-share-card";
import { releaseCanvas } from "@/lib/canvas-memory";
import { CENTRED, STORY_ASPECT, type Framing } from "@/lib/photo-frame";
import { drawableSize, framedCanvas, lightCopy, type Drawable } from "@/lib/photo-frame-draw";
import { PhotoFramer } from "@/components/community/photo-framer";
import { useWorkoutStudio, type StudioWorkout } from "@/components/community/use-workout-studio";
import { QUICK_STORY_CAPTION_MAX, defaultStoryLook, fitStoryFrame, keepStoryLook, readStoryLook, storyLookLabel, storyLookOrder, storyLooks } from "@/lib/quick-story";

type Photo = { img: HTMLImageElement; url: string; file: File; w: number; h: number };
type StoryAudience = Extract<CommunityVisibility, "community" | "close_friends">;

/**
 * One finished workout's quick story, shared by the recap's thumbnail and
 * its editor so both always show the same thing: the card painted from the
 * workout (the smart look first), at most one photo under it (kept on the
 * phone, never uploaded until they share), an optional line of words and who
 * sees it. `share()` is the only thing that posts, and only once at a time.
 */
export function useQuickStory({
  completionId,
  workoutTitle,
  athleteName,
  unit,
  enabled,
}: {
  completionId: string;
  workoutTitle?: string | null;
  athleteName?: string | null;
  unit: "kg" | "lb";
  enabled: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const target = useMemo<StudioWorkout>(() => ({ completion_id: completionId, title: workoutTitle || "Workout", athlete_name: athleteName ?? null }), [completionId, workoutTitle, athleteName]);
  const studio = useWorkoutStudio(target, unit, enabled);
  const data = studio.card?.data ?? null;
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [framing, setFraming] = useState<Framing>(CENTRED);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<StoryAudience>("community");
  const [picked, setPicked] = useState<ShareTemplate | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [fontReady, setFontReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void ensureDisplayFont().then(() => alive && setFontReady(true));
    void cardLogo().then((l) => alive && setLogo(l));
    return () => {
      alive = false;
    };
  }, [enabled]);

  const looks = useMemo(() => storyLooks(studio.card?.looks ?? [], !!photo), [studio.card?.looks, photo]);
  // where it opens: worked out once from the workout (and the look they used last), so the row never reshuffles
  const opening = useMemo(
    () => (data ? defaultStoryLook(looks, { isPr: data.isPr, liftLoaded: !!data.lift?.alt }, readStoryLook(user?.id)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!data, looks.join(","), user?.id],
  );
  const look = picked && looks.includes(picked) ? picked : opening;
  const order = useMemo(() => storyLookOrder(looks, opening), [looks, opening]);
  // the photo, light enough to repaint on every move of a finger
  const light = useMemo(() => (photo ? lightCopy(photo.img) : null), [photo]);
  useEffect(() => () => light?.release(), [light]);
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const setPhotoFile = (file: File) => {
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      toast.error("Stories here take a photo", { description: "A video goes on a Crew post." });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const { w, h } = drawableSize(img as Drawable);
      setFraming(CENTRED);
      setPhoto({ img, url, file, w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Couldn't open that photo", { description: "Try a JPEG or PNG." });
    };
    img.src = url;
  };
  const removePhoto = () => {
    setPhoto(null);
    setFraming(CENTRED);
  };

  /** Paint the story as it'll post, into a canvas (the thumbnail, the editor, the file). */
  const paint = (canvas: HTMLCanvasElement, opts: { scale: number; live?: boolean; format?: "story" | "feed" }) => {
    if (!data || !look) return false;
    const feed = opts.format === "feed";
    const src = photo ? ((opts.live && light ? light.src : photo.img) as Drawable) : null;
    // the feed's 4:5 (shared to an Instagram post) is the same photo framed the same way, cut to its shape
    const media = src ? framedCanvas(src, framing, feed ? 4 / 5 : STORY_ASPECT, Math.max(270, Math.round(1080 * opts.scale))) : null;
    try {
      const card: ShareCardData = { ...data, format: feed ? "feed" : "story", template: look, media };
      paintShareCard(canvas, card, logo, opts.scale);
      return true;
    } finally {
      releaseCanvas(media);
    }
  };

  /** Post it to their story. Resolves to the new story's id, or null when it didn't go (the error is said). */
  const share = async (): Promise<string | null> => {
    if (busyRef.current || !data || !look) return null;
    if (!user?.id) {
      toast.error("Sign in again to share");
      return null;
    }
    busyRef.current = true;
    setBusy(true);
    const c = document.createElement("canvas");
    try {
      await ensureDisplayFont();
      if (!paint(c, { scale: 1 })) throw new Error("Your story isn't ready yet");
      const blob = await canvasToBlob(c, "image/jpeg", 0.92);
      if (!blob) throw new Error("Couldn't make the picture. Try again.");
      const file = new File([blob], `jf-story-${look}.jpg`, { type: "image/jpeg" });
      const id = await createCommunityPost(qc, { userId: user.id, caption: caption.trim(), visibility: audience, photo: file, story: true });
      keepStoryLook(user.id, look);
      return id;
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't share your story. Try again.");
      return null;
    } finally {
      releaseCanvas(c);
      busyRef.current = false;
      setBusy(false);
    }
  };

  return {
    ready: !!data && !!look && fontReady,
    data,
    looks: order,
    look,
    setLook: setPicked,
    photo,
    setPhotoFile,
    removePhoto,
    framing,
    setFraming,
    caption,
    setCaption,
    audience,
    setAudience,
    logo,
    paint,
    share,
    busy,
  };
}
export type QuickStory = ReturnType<typeof useQuickStory>;

/** The story as it'll post, small (the recap's thumbnail). */
export function QuickStoryThumb({ story, className }: { story: QuickStory; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !story.ready) return;
    const raf = requestAnimationFrame(() => {
      try {
        story.paint(c, { scale: 0.2 });
      } catch {
        /* a thumbnail that couldn't paint stays the placeholder */
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.ready, story.look, story.photo, story.framing, story.logo, story.data]);
  return (
    <span className={cn("relative block aspect-[9/16] overflow-hidden rounded-lg bg-muted", className)} data-quick-story-thumb>
      <canvas ref={ref} className={cn("h-full w-full", !story.ready && "invisible")} aria-hidden />
      {!story.ready && <span className="absolute inset-0 animate-pulse bg-muted" />}
    </span>
  );
}

/**
 * The quick story's editor: the story big (what's posted is exactly this:
 * the same painter at full size), the looks as one row of chips, one Add
 * photo (take one or pick one; a photo can be dragged and pinched), a line
 * of words, Crew or Close friends, and Share to Story. Closing it never posts;
 * everything stays as it was for the next time it opens.
 */
export function QuickStorySheet({
  open,
  onClose,
  story,
  onShare,
  onVideo,
}: {
  open: boolean;
  onClose: () => void;
  story: QuickStory;
  /** Share to Story was tapped (the caller posts through `story.share`). */
  onShare: () => void;
  /** They want a video: that's a Crew post (the full composer). */
  onVideo: () => void;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const [media, setMedia] = useState(false);
  const [writing, setWriting] = useState(false);
  const libRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!stage) return;
    const measure = () => setBox(fitStoryFrame({ w: stage.clientWidth, h: stage.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);

  // what's on screen is the file: the same painter, lighter only while a finger moves the photo
  useEffect(() => {
    if (!canvas || !story.ready || !box.w) return;
    const raf = requestAnimationFrame(() => {
      try {
        story.paint(canvas, { scale: live ? 0.5 : 1, live });
      } catch {
        /* the last good frame stays */
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, story.ready, story.look, story.photo, story.framing, story.logo, story.data, live, box.w]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) story.setPhotoFile(f);
  };
  const caption = story.caption.trim();

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="dark left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 text-white sm:left-1/2 sm:top-1/2 sm:h-[min(100dvh,900px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl [&>button]:hidden"
          data-quick-story
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Your story</DialogTitle>
          <DialogDescription className="sr-only">Pick a look, add a photo if you want, then share it to your story for 24 hours.</DialogDescription>
          <header className="flex shrink-0 items-center gap-2 px-2 pb-1" style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}>
            <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full active:bg-white/10" aria-label="Close without sharing">
              <X className="h-6 w-6" />
            </button>
            <span className="min-w-0 flex-1 text-center text-[16px] font-semibold">Your story</span>
            <span className="h-11 w-11" aria-hidden />
          </header>

          <div ref={setStage} className="relative min-h-0 flex-1 px-3 py-2">
            <div className="absolute inset-0 grid place-items-center">
              <div className="relative overflow-hidden rounded-xl bg-neutral-900" style={{ width: box.w, height: box.h }} data-quick-story-stage>
                <canvas ref={setCanvas} className={cn("absolute inset-0 h-full w-full", !story.ready && "invisible")} aria-label={story.look ? `${storyLookLabel(story.look, !!story.photo)} look` : undefined} />
                {!story.ready && (
                  <span className="absolute inset-0 grid place-items-center text-[13px] text-white/60">
                    <Loader2 className="h-6 w-6 animate-spin" aria-label="Getting your numbers" />
                  </span>
                )}
                {story.photo && box.w > 0 && (
                  <PhotoFramer
                    src={story.photo.url}
                    size={{ w: story.photo.w, h: story.photo.h }}
                    frame={box}
                    framing={story.framing}
                    onFraming={story.setFraming}
                    oneFinger
                    showImage={false}
                    onActive={setLive}
                  />
                )}
                {/* the words sit where the story shows them, over its bottom */}
                {caption && (
                  <p className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-3 whitespace-pre-wrap bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8 text-[13px] leading-snug" data-quick-story-caption>
                    {caption}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-3 px-3 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
            {story.looks.length > 1 && (
              <div className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Look" data-quick-story-looks>
                {story.looks.map((t) => {
                  const on = t === story.look;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => story.setLook(t)}
                      className={cn(
                        "h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition-colors active:scale-95",
                        on ? "bg-white text-black" : "bg-white/12 text-white/85",
                      )}
                    >
                      {storyLookLabel(t, !!story.photo)}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <ToolButton onClick={() => setMedia(true)} label={story.photo ? "Photo" : "Add photo"} on={!!story.photo} data-quick-story-media>
                {story.photo ? <img src={story.photo.url} alt="" className="h-5 w-5 rounded object-cover" /> : <ImagePlus className="h-5 w-5" />}
              </ToolButton>
              <ToolButton onClick={() => setWriting(true)} label={caption ? "Edit words" : "Add words"} on={!!caption}>
                <PenLine className="h-5 w-5" />
              </ToolButton>
              <ToolButton
                onClick={() => story.setAudience(story.audience === "community" ? "close_friends" : "community")}
                label={story.audience === "close_friends" ? "Close friends" : "Crew"}
                on={story.audience === "close_friends"}
                aria-label={story.audience === "close_friends" ? "Close friends see it. Tap for the crew" : "The crew sees it. Tap for Close friends"}
                data-quick-story-audience={story.audience}
              >
                {story.audience === "close_friends" ? <Star className="h-5 w-5 fill-current text-emerald-400" /> : <Users className="h-5 w-5" />}
              </ToolButton>
            </div>
            <button
              type="button"
              onClick={onShare}
              disabled={!story.ready || story.busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.99] disabled:opacity-60"
              data-quick-story-share
            >
              {story.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {story.busy ? "Sharing…" : "Share to Story"}
            </button>
            <p className="text-center text-[12px] text-white/55">Up for 24 hours. Nothing posts until you tap Share.</p>
          </div>

          <input ref={libRef} type="file" accept="image/*" hidden onChange={pick} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        </DialogContent>
      </Dialog>

      {/* one way to add media, the phone's own choices */}
      <Sheet open={media} onOpenChange={setMedia}>
        <SheetContent side="bottom" swipeToClose hideCloseButton className="gap-0 rounded-t-[22px] p-0 pb-[max(env(safe-area-inset-bottom),12px)] sm:mx-auto sm:max-w-[480px]" data-quick-story-media-sheet>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetHeader className="px-5 pb-2 pt-3 text-left">
            <SheetTitle className="text-[16px] font-semibold">{story.photo ? "Your photo" : "Add a photo"}</SheetTitle>
            <SheetDescription className="text-[13px]">One photo goes under your story. Drag and pinch it to place it.</SheetDescription>
          </SheetHeader>
          <div className="px-2">
            {/* the picker opens inside the tap (iOS), and the sheet goes, so cancelling lands back on the story */}
            <SheetRow
              icon={<Camera className="h-5 w-5" />}
              label="Take photo"
              onClick={() => {
                camRef.current?.click();
                setMedia(false);
              }}
            />
            <SheetRow
              icon={<Images className="h-5 w-5" />}
              label={story.photo ? "Choose another" : "Choose from library"}
              onClick={() => {
                libRef.current?.click();
                setMedia(false);
              }}
            />
            <SheetRow
              icon={<Film className="h-5 w-5" />}
              label="Post a video instead"
              sub="Videos go on a Crew post"
              onClick={() => {
                setMedia(false);
                onVideo();
              }}
            />
            {story.photo && (
              <SheetRow
                icon={<Trash2 className="h-5 w-5" />}
                label="Remove photo"
                destructive
                onClick={() => {
                  story.removePhoto();
                  setMedia(false);
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={writing} onOpenChange={setWriting}>
        <SheetContent
          side="bottom"
          swipeToClose
          hideCloseButton
          className="gap-0 rounded-t-[22px] p-0 pb-[max(env(safe-area-inset-bottom),12px)] sm:mx-auto sm:max-w-[480px]"
          data-quick-story-words
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetHeader className="px-5 pb-2 pt-3 text-left">
            <SheetTitle className="text-[16px] font-semibold">Words on your story</SheetTitle>
            <SheetDescription className="text-[13px]">Optional. They show along the bottom.</SheetDescription>
          </SheetHeader>
          <div className="px-5">
            <Textarea
              value={story.caption}
              maxLength={QUICK_STORY_CAPTION_MAX}
              onChange={(e) => story.setCaption(e.target.value.slice(0, QUICK_STORY_CAPTION_MAX))}
              placeholder="How'd it go?"
              // 16px keeps iOS from zooming in
              className="min-h-[88px] resize-none text-[16px]"
              aria-label="Words on your story"
              autoFocus
            />
            <div className="mt-1 text-right text-[11px] text-muted-foreground">{story.caption.length > 0 && `${story.caption.length}/${QUICK_STORY_CAPTION_MAX}`}</div>
            <button type="button" onClick={() => setWriting(false)} className="mt-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-lg bg-foreground text-[15px] font-semibold text-background active:scale-[0.99]">
              <Check className="h-4 w-4" /> Done
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ToolButton({ children, label, on, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; on?: boolean; [k: `data-${string}`]: unknown }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn("flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg bg-white/10 px-1 text-[12px] font-medium text-white/90 active:bg-white/15", on && "bg-white/15 text-white", className)}
    >
      {children}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function SheetRow({ icon, label, sub, onClick, destructive }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-[52px] w-full items-center gap-3.5 rounded-lg px-3 py-2 text-left active:bg-muted", destructive && "text-destructive")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {sub && <span className="block text-[12px] text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}
