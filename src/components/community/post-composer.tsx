import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AtSign, BarChart3, Camera, Check, ChevronLeft, ChevronRight, Dumbbell, Film, Images, Loader2, Lock, Maximize2, PenLine, Play,
  Blend, Scissors, SlidersHorizontal, Smile, Star, Type, UserRound, Users, Volume2, VolumeX, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useNoAutoZoom } from "@/hooks/use-no-auto-zoom";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, cleanPollOptions, pickerAudience, type CommunityAuthor, type CommunityVisibility, type PostSlide } from "@/lib/community";
import { MAX_SLIDES } from "@/lib/community";
import { pickMedia, releasePicked, uploadPicked } from "@/lib/community-media";
import { CENTRED, POST_ASPECTS, POST_ASPECT_LABEL, startAspect, nextAspect, placement, clampFraming, type PostAspect } from "@/lib/photo-frame";
import { drawableSize, framedCanvas, lightCopy, type Drawable } from "@/lib/photo-frame-draw";
import { canvasToBlob, cardLogo, ensureDisplayFont } from "@/lib/workout-share-card";
import { releaseCanvas, context2d } from "@/lib/canvas-memory";
import { formatClock, type VideoContext } from "@/lib/video-edit/limits";
import { clearDraft, loadDraft, saveDraft } from "@/lib/post-draft";
import { feedback } from "@/lib/feedback";
import { tagSummary, uniqueTags, withTags } from "@/lib/crew-tags";
import { useSlideTray, type TrayItem } from "@/components/community/slide-tray";
import { PhotoFramer } from "@/components/community/photo-framer";
import { StickerLayer, drawStickers, type StickerItem, type StickerRequest } from "@/components/community/sticker-layer";
import { AttachButtons, AttachGifPicker, AttachPreview, usePostAttach } from "@/components/community/post-attach";
import { MentionSuggestBar } from "@/components/community/mentions";
import { TagPeopleSheet } from "@/components/community/tag-people-sheet";
import { useAudiences } from "@/components/community/audience-picker";
import { LookCarousel, type LookGroup, type LookItem } from "@/components/community/look-carousel";
import { CoverPicker } from "@/components/community/cover-picker";
import { TrimmedVideo } from "@/components/video-trimmer";
import { paintCard } from "@/components/community/card-paint";
import { FilterPanel } from "@/components/community/filter-panel";
import { GradedLayer } from "@/components/community/graded-layer";
import { loadGradeSource, useGradeSource } from "@/components/community/use-grade-source";
import { useFilterDefaults, type FilterDefaults, type FilterKind } from "@/lib/media-filter-prefs";
import { compiledFor, consistentStats, ORIGINAL, type MediaGrade } from "@/lib/media-grade";
import { sharedGradeGL } from "@/lib/media-grade-gl";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { CameraCard, StudioPost } from "@/components/community/share-studio";
import { CAMERA_MODES, ModeSelector } from "@/components/community/mode-selector";
import { DiscardConfirm } from "@/components/community/discard-confirm";

/**
 * New post, Instagram's way (Nov 22 2026): the + opens the phone's photo
 * library in the same tap, and what's picked lands here in three steps that
 * slide one into the next:
 *
 *   1. New post: the picks in a grid (numbered in post order; hold one and
 *      drag to reorder), the one in focus big at the post's shape (drag and
 *      pinch to frame it, the corner button for 4:5 · 9:16 · 1:1 · 16:9),
 *      Camera and Library to add more, and Post · Story along the bottom.
 *   2. Edit: the slides full width (swipe between them); on the first photo
 *      Filters (Normal, the looks, the cards: a workout, a lock in, a meal),
 *      Text, Stickers; on a clip Trim, Sound and Cover.
 *   3. The caption and the details as rows: Tag people, who sees it, the
 *      workout it's for, Hide my weights; a poll, a GIF or a voice memo. Then
 *      Share, with its progress in the button.
 *
 * Every pick starts uploading the moment it's added (useSlideTray), so Share
 * only saves. A filter or stickers on the first photo re-draw it at the
 * post's shape (that one goes up as drawn); everything else goes as the
 * tray framed it. What's posted is exactly what the edit step shows.
 */
export type ComposerFilters = {
  /** Normal first, then the looks (each with its group for the chips). */
  items: LookItem[];
  groups?: LookGroup[];
  /** The key of the one on. */
  on: string;
  pick: (key: string) => void;
  /** The one on, as a painter for the first photo (null: Normal). */
  card: CameraCard | null;
  /** The one on only grades the picture (any shape takes it). */
  gradeOnly?: boolean;
};

export type ComposerWorkout = {
  title: string;
  sub: string;
  /** Linked: the post is that workout's (League points, its numbers on its recap). */
  on: boolean;
  /** A workout card is on the photo: it can't come off without the card. */
  locked?: boolean;
  onToggle: (on: boolean) => void;
  /** More than one to choose from. */
  onChange?: () => void;
};

type ComposerTool = "filters" | "enhance" | null;
type Step = "select" | "edit" | "details";
const STEPS: Step[] = ["select", "edit", "details"];
const EASE = "cubic-bezier(0.32,0.72,0,1)";
/** A member's caption; a coach's post (community_create_note) takes 1–1200 characters. */
const CAPTION_MAX = 2200;
const COACH_CAPTION_MAX = 1200;

const PANE = "absolute inset-0 flex min-w-0 flex-col motion-reduce:!transition-none";
/** A step's place: on screen with no transform at all, the others a screen to either side. */
const pane = (i: number, at: number): React.CSSProperties => ({
  transform: i === at ? "none" : `translate3d(${(i - at) * 100}%,0,0)`,
  transition: `transform 380ms ${EASE}`,
});

const AUD_ICON: Record<CommunityVisibility, typeof Users> = { community: Users, followers: Users, close_friends: Star, coach: UserRound, private: Lock };

export function PostComposer({
  open,
  onClose,
  incoming,
  onPick,
  filters,
  post,
  plainPost,
  coach,
  onStory,
  modeFrom = null,
  entry = "rise",
  workout,
  points,
  videoContext = "post",
  allowWrite = true,
  startWriting = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Files picked in the tap that opened it, or added since (`n` bumps each time). */
  incoming: { files: File[]; live: boolean; n: number } | null;
  /** Open the phone's library or camera (their files come back through `incoming`). */
  onPick: (how: "library" | "camera") => void;
  filters: ComposerFilters;
  /** What Share does (a member): the post the filter and workout link make it. */
  post: StudioPost | null;
  /** A words-only post (Write): always a plain one. */
  plainPost?: StudioPost | null;
  /** The coach: a post to the crew from the coach's account (a poll allowed). Resolves with its id. */
  coach?: { save: (a: { caption: string; poll?: string[]; media: PostSlide[] }) => Promise<string | void> } | null;
  /** Story along the bottom: leaves for the story camera. */
  onStory?: () => void;
  /** The mode the last screen was on (the camera's Story): the selector opens there and slides to Post. */
  modeFrom?: string | null;
  /** How it comes in: rising from the bottom (from +), or fading in place (switched to from the camera). */
  entry?: "rise" | "fade";
  workout?: ComposerWorkout | null;
  /** What posting earns, for who sees it. */
  points?: (v: CommunityVisibility) => { tone: "earn" | "muted"; text: string } | null;
  videoContext?: VideoContext;
  allowWrite?: boolean;
  /** Open straight on Write (no photo). */
  startWriting?: boolean;
}) {
  useNoAutoZoom(open);
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("select");
  const [writing, setWriting] = useState(false);
  const [closing, setClosing] = useState(false);
  // the one question before work is thrown away: leaving, or switching to Story with photos picked
  const [confirm, setConfirm] = useState<null | "close" | "story">(null);
  const draftKey = `composer:${coach ? "coach" : "member"}:${user?.id ?? ""}`;
  const tray = useSlideTray({ open, initial: null, resetKey: draftKey, coverCount: 0, videoContext });
  const att = usePostAttach({ initial: null, key: draftKey, open });
  const [focus, setFocus] = useState<string | null>(null);
  // a post starts at 9:16, filling its screen in the Crew feed (startAspect)
  const [aspect, setAspect] = useState<PostAspect>("full");
  const aspectPicked = useRef(false);
  const [gridFlash, setGridFlash] = useState(0);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("community");
  const [hideLoads, setHideLoads] = useState(false);
  const [tags, setTags] = useState<CommunityAuthor[]>([]);
  const [tagging, setTagging] = useState(false);
  const [audOpen, setAudOpen] = useState(false);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [items, setItems] = useState<StickerItem[]>([]);
  const [request, setRequest] = useState<StickerRequest>(null);
  const [tool, setTool] = useState<ComposerTool>("filters");
  // the person's default filter for posts: on every new photo or clip (never one already on the post)
  const { defaults: filterDefaults, setDefault: setFilterDefault } = useFilterDefaults(open);
  const [slide, setSlide] = useState(0);
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const [coverLive, setCoverLive] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const capMax = coach ? COACH_CAPTION_MAX : CAPTION_MAX;

  // fresh every time it opens
  useEffect(() => {
    if (!open) return;
    setStep(startWriting ? "details" : "select");
    setWriting(startWriting);
    setClosing(false);
    setConfirm(null);
    setFocus(null);
    setAspect("full");
    aspectPicked.current = false;
    setCaption("");
    setVisibility(pickerAudience(post?.visibility ?? "community"));
    setHideLoads(!!post?.hideLoads);
    setTags([]);
    setPoll(null);
    setItems([]);
    setTool("filters");
    setSlide(0);
    setBusy(false);
    setPosted(false);
    setCoverLive(false);
    // a caption written before (the app closed, a post that didn't go) comes back
    void loadDraft(draftKey).then((d) => {
      if (!d?.caption) return;
      setCaption(d.caption);
      toast.message("Your caption is back", { action: { label: "Clear", onClick: () => setCaption("") } });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // the caption is kept on the phone until it's posted (a beat after the last key)
  useEffect(() => {
    if (!open || posted) return;
    const t = setTimeout(() => {
      if (caption.trim()) void saveDraft({ key: draftKey, caption, visibility, look: null, photo: null, live: false, at: Date.now() });
    }, 700);
    return () => clearTimeout(t);
  }, [open, caption, visibility, draftKey, posted]);

  // picks land in the tray (each starts uploading now); the first one's shape is the post's until it's picked by hand
  const lastN = useRef(0);
  // mounted again (the crash screen's Try again, React's dev double mount): the tray starts empty, so the picks go in again
  useEffect(
    () => () => {
      lastN.current = 0;
    },
    [],
  );
  useEffect(() => {
    if (!open || !incoming || incoming.n === lastN.current) return;
    lastN.current = incoming.n;
    if (!tray.items.length && incoming.live) setCoverLive(true);
    const room = MAX_SLIDES - tray.items.length;
    if (room <= 0) return void toast.message(`A post holds ${MAX_SLIDES}`, { description: "Remove one to add another." });
    void tray.add(incoming.files);
    setWriting(false);
    if (step === "details" && writing) setStep("select");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, incoming?.n]);
  useEffect(() => {
    if (!open) {
      if (!posted) tray.discard();
      att.discard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const list = tray.items;
  const focused = (focus && list.find((x) => x.id === focus)) || list[0] || null;
  const cover = list[0] ?? null;
  const coverImage = cover && cover.kind === "image" ? cover : null;
  const first = cover;
  useEffect(() => {
    if (aspectPicked.current || !first?.w || !first?.h) return;
    setAspect(startAspect(first.w, first.h));
  }, [first?.id, first?.w, first?.h]);

  // a design on the first photo (a card, a story filter's words) is drawn at 9:16 (the full-screen card, its words
  // clear of the feed's bars and buttons) or 4:5
  const card = coverImage ? filters.card : null;
  const design = !!card && !filters.gradeOnly;
  useEffect(() => {
    if (design && aspect !== "portrait" && aspect !== "full") setAspect("full");
  }, [design, aspect]);
  const shape = POST_ASPECTS[aspect];
  const cycleAspect = () => {
    aspectPicked.current = true;
    setAspect((a) => (design ? (a === "portrait" ? "full" : "portrait") : nextAspect(a)));
    setGridFlash((n) => n + 1);
    feedback("tap");
  };

  /* ---- the first photo, drawn with its filter --------------------------- */
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!open) return;
    void Promise.all([ensureDisplayFont(), cardLogo()]).then(([, l]) => setLogo(l));
  }, [open]);
  const coverDrawable = coverImage ? tray.drawable(coverImage.id) : null;
  const light = useMemo(() => (coverDrawable ? lightCopy(coverDrawable as Drawable) : null), [coverDrawable]);
  useEffect(() => () => light?.release(), [light]);
  const coverFraming = coverImage?.framing ?? CENTRED;
  const lockedIn = useMemo(() => {
    const d = card?.data.lockedIn;
    if (!d?.live) return d ?? null;
    return { time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), live: coverLive };
  }, [card?.data.lockedIn, coverLive]);
  const useCard = !!card && !(post?.showHideLoads && hideLoads && !card.paint);

  /** The first photo as it'll be posted (or shown, smaller): framed at the post's shape, its filter on it. */
  const drawCover = (out: HTMLCanvasElement, width: number, src: Drawable) => {
    const media = framedCanvas(src, clampFraming(coverFraming, drawableSize(src), { w: shape, h: 1 }), shape, width, compiledFor(coverImage?.grade));
    try {
      if (useCard && card) {
        const size = aspect === "full" ? "full" : aspect === "portrait" ? "feed" : { w: 1080, h: Math.round(1080 / shape) };
        paintCard(out, card, media, size, lockedIn, logo, width / 1080);
      } else {
        out.width = media.width;
        out.height = media.height;
        context2d(out).drawImage(media, 0, 0);
      }
    } finally {
      releaseCanvas(media);
    }
  };
  const [coverEl, setCoverEl] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!coverEl || !light || step === "select") return;
    const raf = requestAnimationFrame(() => {
      try {
        drawCover(coverEl, 720, light.src);
      } catch {
        /* a filter that can't paint here leaves the photo as it was */
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverEl, light, step, card, useCard, coverFraming, aspect, lockedIn, logo, coverImage?.grade]);

  // a new photo or clip starts with the person's default filter (read from the picture itself for Auto)
  const defaulted = useRef(new Set<string>());
  useEffect(() => {
    const d = filterDefaults.post;
    for (const it of list) {
      if (defaulted.current.has(it.id)) continue;
      if (it.existing || it.grade !== undefined || !d || it.canGrade === false || (it.kind === "video" && !videoGradeReady())) {
        defaulted.current.add(it.id);
        continue;
      }
      if (!it.preview) continue;
      defaulted.current.add(it.id);
      void loadGradeSource(it.preview).then((r) => tray.setGrade(it.id, { ...d, stats: r?.stats ?? null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, filterDefaults.post]);

  const needsRender = !!coverImage && (useCard || items.length > 0);

  /* ---- steps ------------------------------------------------------------ */
  const go = (s: Step) => {
    feedback("tap");
    setStep(s);
  };
  const toDetails = () => {
    // the details' preview: the first slide as it'll go
    setThumb(null);
    if (coverImage && light) {
      const c = document.createElement("canvas");
      try {
        drawCover(c, 360, light.src);
        if (items.length) drawStickers(context2d(c), items, c.width, c.height);
        setThumb(c.toDataURL("image/jpeg", 0.8));
      } catch {
        setThumb(coverImage.preview);
      } finally {
        releaseCanvas(c);
      }
    } else setThumb(cover?.preview ?? null);
    go("details");
  };
  const dirty = tray.items.length > 0 || caption.trim().length > 0 || !!poll;
  const requestClose = () => {
    if (busy) return;
    if (dirty && !posted) return setConfirm("close");
    close();
  };
  /** Story along the bottom: the story camera (asked first when photos or words would be lost). */
  const toStory = () => {
    if (busy || !onStory) return;
    if (dirty && !posted) return setConfirm("story");
    onStory();
  };
  const close = () => {
    setConfirm(null);
    setClosing(true);
    window.setTimeout(onClose, 240);
  };
  const back = () => {
    if (step === "details") return writing ? requestClose() : go("edit");
    if (step === "edit") return go("select");
    requestClose();
  };

  /* ---- share ------------------------------------------------------------ */
  const pollCheck = poll ? cleanPollOptions(poll) : null;
  const pollReady = !pollCheck || pollCheck.ok;
  const words = writing || !tray.items.length;
  const canShare =
    !busy &&
    !posted &&
    pollReady &&
    !att.recorder.recording &&
    // a coach's post always has words (the question, on a poll); a member's needs words or something picked
    (coach ? caption.trim().length > 0 : words ? caption.trim().length > 0 : tray.items.length > 0) &&
    (!!coach || !!(words ? plainPost ?? post : post));
  const progress = useMemo(() => {
    if (!tray.items.length) return 0;
    const done = tray.items.reduce((a, it) => a + (it.status === "done" ? 100 : it.progress), 0);
    return Math.round(done / tray.items.length);
  }, [tray.items]);

  const renderCoverFile = async (): Promise<File | null> => {
    if (!coverImage) return null;
    const src = tray.drawable(coverImage.id);
    if (!src) return null;
    const c = document.createElement("canvas");
    try {
      drawCover(c, 1080, src as Drawable);
      if (items.length) drawStickers(context2d(c), items, c.width, c.height);
      const b = await canvasToBlob(c, "image/jpeg", 0.92);
      return b ? new File([b], `jf-post-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
    } finally {
      releaseCanvas(c);
    }
  };
  const uploadFile = async (file: File): Promise<PostSlide> => {
    if (!user?.id) throw new Error("Sign in again to post");
    const res = await pickMedia(file);
    if (!res.ok) throw new Error(res.reason);
    try {
      const up = await uploadPicked(res.media, user.id);
      return { path: up.media_path, thumb: up.media_thumb_path, type: up.media_type, width: up.media_width, height: up.media_height };
    } finally {
      releasePicked(res.media);
    }
  };

  const share = async () => {
    if (!canShare) return;
    setBusy(true);
    const text = withTags(caption.trim(), tags);
    const coverId = needsRender ? coverImage!.id : null;
    try {
      if (coach) {
        const media: PostSlide[] = [];
        if (!words) {
          if (coverId) {
            const f = await renderCoverFile();
            if (f) media.push(await uploadFile(f));
          }
          media.push(...(await tray.ready(shape, coverId)));
        }
        const options = pollCheck?.ok ? pollCheck.options : undefined;
        const id = await coach.save({ caption: text, poll: options, media });
        if (id) await att.save(id);
      } else {
        const target = words ? (plainPost ?? post)! : post!;
        const photo = !words && coverId ? await renderCoverFile() : null;
        const extras = words ? [] : await tray.ready(shape, coverId);
        await target.onPost({ photo, live: coverLive, caption: text, visibility, hideLoads, look: useCard && card ? card.look : "plain", extras, attach: att.save });
      }
      done(coverId);
    } catch (e) {
      const err = e as { posted?: boolean; message?: string } | null;
      // up, only the GIF / voice memo missed: it's posted
      if (err?.posted) {
        done(coverId);
        toast.warning(err.message ?? "Posted, but the GIF or voice memo didn't attach.");
      } else toast.error(err?.message ?? "Couldn't share. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const done = (coverId: string | null) => {
    // the first photo went up as drawn: its plain copy goes
    if (coverId) tray.remove(coverId);
    tray.commit();
    void clearDraft(draftKey);
    setPosted(true);
    window.setTimeout(close, 650);
  };

  /* ---- render ----------------------------------------------------------- */
  const at = STEPS.indexOf(step);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-50 flex flex-col overflow-clip bg-black text-white outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px]",
            "duration-300 motion-reduce:duration-0",
            closing ? "translate-y-full opacity-0 transition-all ease-in sm:translate-y-[60%]" : entry === "fade" ? "animate-in fade-in-0 duration-200" : "animate-in slide-in-from-bottom-[40%] fade-in-0",
          )}
          style={{ transitionTimingFunction: EASE }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          data-post-composer={step}
        >
          <DialogPrimitive.Title className="sr-only">New post</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Pick photos or videos, edit them, write a caption and share to the crew.</DialogPrimitive.Description>
          {/* the steps slide one into the next; the one on screen rests with no transform, so the text
              editor and the sticker tray (fixed overlays inside it) cover the screen, not the pane */}
          <div className="relative min-h-0 flex-1 overflow-clip">
            {/* 1. New post */}
            <section className={PANE} style={pane(0, at)} inert={step !== "select"} aria-hidden={step !== "select"} data-composer-step="select">
              <Header
                left={
                  <IconButton label="Close" onClick={requestClose}>
                    <X className="h-6 w-6" />
                  </IconButton>
                }
                title="New post"
                right={
                  <NextButton disabled={!list.length || list.every((it) => it.status === "preparing" && !it.preview)} onClick={() => go("edit")} />
                }
              />
              <SelectStep
                tray={tray}
                list={list}
                focused={focused}
                onFocus={(id) => {
                  setFocus(id);
                  feedback("tap");
                }}
                aspect={aspect}
                onAspect={cycleAspect}
                gridFlash={gridFlash}
                onPick={onPick}
                onWrite={
                  allowWrite
                    ? () => {
                        setWriting(true);
                        go("details");
                      }
                    : undefined
                }
              />
              {onStory && (
                // Post · Story (Instagram's floating pill): tap or swipe it; Story is the story camera
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }} data-composer-modes>
                  <ModeSelector variant="pill" modes={CAMERA_MODES} value="post" onChange={(k) => k === "story" && toStory()} enterFrom={modeFrom} className="pointer-events-auto" />
                </div>
              )}
            </section>

            {/* 2. Edit */}
            <section className={PANE} style={pane(1, at)} inert={step !== "edit"} aria-hidden={step !== "edit"} data-composer-step="edit">
              <Header
                left={
                  <IconButton label="Back" onClick={() => go("select")}>
                    <ChevronLeft className="h-7 w-7" />
                  </IconButton>
                }
                title="Edit"
                right={<NextButton onClick={toDetails} disabled={!list.length} />}
              />
              {list.length > 0 && (
                <EditStep
                  active={step === "edit"}
                  tray={tray}
                  list={list}
                  aspect={aspect}
                  slide={slide}
                  onSlide={setSlide}
                  coverEl={setCoverEl}
                  coverImage={coverImage}
                  items={items}
                  setItems={setItems}
                  request={request}
                  setRequest={setRequest}
                  tool={tool}
                  setTool={setTool}
                  filters={filters}
                  design={design}
                  onAspect={cycleAspect}
                  onCover={(id) => setCoverFor(id)}
                  onAdd={() => onPick("library")}
                  onTag={() => setTagging(true)}
                  tags={tags.length}
                  hideLoadsOn={!!post?.showHideLoads && hideLoads && !!card && !card.paint}
                  filterDefaults={filterDefaults}
                  setFilterDefault={setFilterDefault}
                />
              )}
            </section>

            {/* 3. Caption and details (the app's own colours, Instagram's light screen) */}
            <section className={cn(PANE, "bg-background text-foreground")} style={pane(2, at)} inert={step !== "details"} aria-hidden={step !== "details"} data-composer-step="details">
              <Header
                light
                left={
                  <IconButton label="Back" onClick={back} light>
                    {writing ? <X className="h-6 w-6" /> : <ChevronLeft className="h-7 w-7" />}
                  </IconButton>
                }
                title={writing ? "Write a post" : "New post"}
                right={<span className="w-11" />}
              />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {!writing && (thumb || cover?.preview) && (
                  <div className="flex justify-center px-4 pt-3">
                    <div className="relative overflow-hidden rounded-xl bg-muted shadow-sm" style={{ height: 230, aspectRatio: String(shape) }} data-composer-preview>
                      <img src={thumb ?? cover?.preview ?? ""} alt="" className="h-full w-full object-cover" />
                      {list.length > 1 && (
                        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">1/{list.length}</span>
                      )}
                      {cover?.kind === "video" && <Play className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow" />}
                    </div>
                  </div>
                )}
                <div className="px-4 pt-3">
                  <textarea
                    ref={captionRef}
                    value={caption}
                    onChange={(e) => {
                      setCaption(e.target.value.slice(0, capMax));
                      setPosted(false);
                    }}
                    rows={writing ? 6 : 3}
                    placeholder={poll ? "Ask the crew something…" : writing ? "Write something…" : "Add a caption…"}
                    className="block w-full resize-none bg-transparent text-[16px] leading-snug outline-none placeholder:text-muted-foreground"
                    style={{ minHeight: writing ? 140 : 76 }}
                    aria-label={poll ? "Poll question" : "Caption"}
                    data-composer-caption
                  />
                  <MentionSuggestBar value={caption} onChange={(v) => setCaption(v.slice(0, capMax))} inputRef={captionRef} />
                  {coach && !caption.trim() && !poll && <p className="pb-1 text-[12px] text-muted-foreground">A coach's post needs a caption.</p>}
                </div>
                {/* extras, Instagram's chips under the caption */}
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-1">
                  {coach && !poll && (
                    <button type="button" onClick={() => setPoll(["", ""])} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-[14px] font-semibold active:scale-95" data-composer-poll>
                      <BarChart3 className="h-4 w-4" /> Poll
                    </button>
                  )}
                  <AttachButtons a={att} small />
                </div>
                <AttachPreview a={att} className="mx-4 mb-3" />
                <AttachGifPicker a={att} />
                {poll && <PollEditor poll={poll} setPoll={setPoll} check={pollCheck} />}
                <div className="mt-1 border-t border-border">
                  {!writing && (
                    <Row icon={<AtSign className="h-5 w-5" />} label="Tag people" value={tagSummary(tags)} onClick={() => setTagging(true)} data-composer-tag />
                  )}
                  {!coach && (
                    <AudienceRow value={visibility} onClick={() => setAudOpen(true)} />
                  )}
                  {!coach && !writing && workout && (
                    <div className="flex items-center gap-3 px-4 py-3" data-composer-workout>
                      <Dumbbell className="h-5 w-5 shrink-0" />
                      <button type="button" onClick={workout.onChange} disabled={!workout.onChange} className="min-w-0 flex-1 text-left">
                        <span className="block text-[15px] font-medium">Workout</span>
                        <span className="block truncate text-[13px] text-muted-foreground">
                          {workout.title} · {workout.sub}
                          {workout.onChange ? " · change" : ""}
                        </span>
                      </button>
                      <Switch checked={workout.on} disabled={workout.locked} onCheckedChange={(v) => workout.onToggle(v)} aria-label="Post this as that workout" />
                    </div>
                  )}
                  {!coach && !writing && post?.showHideLoads && (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="grid h-5 w-5 shrink-0 place-items-center text-[13px] font-bold">kg</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">Hide my weights</span>
                        <span className="block text-[13px] text-muted-foreground">Reps, sets and PRs still show. Only you see the weights.</span>
                      </span>
                      <Switch checked={hideLoads} onCheckedChange={setHideLoads} aria-label="Hide my weights" />
                    </div>
                  )}
                </div>
                {(() => {
                  const hint = !coach && !writing ? points?.(visibility) : null;
                  return hint ? <p className={cn("px-4 pb-2 pt-1 text-[13px]", hint.tone === "earn" ? "font-semibold text-foreground" : "text-muted-foreground")}>{hint.text}</p> : null;
                })()}
                {post?.label === "Update" && !writing && <p className="px-4 pb-2 text-[13px] text-muted-foreground">This updates the post you shared for it: these photos take the old ones' place.</p>}
                <div className="h-28" />
              </div>
              <div className="shrink-0 border-t border-border bg-background px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}>
                <ShareButton busy={busy} posted={posted} disabled={!canShare} progress={words ? 100 : progress} uploading={tray.uploading} onClick={() => void share()} label={coach ? (poll ? "Share poll" : "Share") : post?.label === "Update" ? "Update post" : "Share"} />
              </div>
            </section>
          </div>

          {confirm && (
            <DiscardConfirm
              tag="composer-discard"
              title="Discard post?"
              body={confirm === "story" ? "Switching to Story leaves this post. You'll lose what you've picked and written." : "If you leave now, you'll lose your edits."}
              onConfirm={() => {
                if (confirm === "story") {
                  setConfirm(null);
                  // inside this tap: the story camera's ask goes out from it
                  onStory?.();
                } else close();
              }}
              onCancel={() => setConfirm(null)}
            />
          )}
          {coverFor &&
            (() => {
              const it = tray.items.find((x) => x.id === coverFor);
              if (!it?.video) return null;
              return (
                <CoverPicker
                  src={it.video}
                  range={it.trim}
                  size={{ w: it.w ?? 9, h: it.h ?? 16 }}
                  aspect={shape}
                  framing={it.framing ?? CENTRED}
                  onCancel={() => setCoverFor(null)}
                  onDone={(c) => {
                    if (c) tray.setCover(it.id, c);
                    setCoverFor(null);
                  }}
                />
              );
            })()}
          {tray.trimmer}
          <TagPeopleSheet
            open={tagging}
            onClose={() => setTagging(false)}
            tagged={tags}
            onToggle={(a) => setTags((t) => (t.some((x) => x.user_id === a.user_id) ? t.filter((x) => x.user_id !== a.user_id) : uniqueTags([...t, a])))}
          />
          <AudienceSheet open={audOpen} onClose={() => setAudOpen(false)} value={visibility} onChange={(v) => setVisibility(v)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  Pieces                                                             */
/* ------------------------------------------------------------------ */

function Header({ left, title, right, light = false }: { left: ReactNode; title: string; right: ReactNode; light?: boolean }) {
  return (
    <div className={cn("relative flex shrink-0 items-center justify-between px-2 pb-1.5", light && "border-b border-border")} style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}>
      {left}
      <span className="pointer-events-none absolute inset-x-0 bottom-1.5 flex h-11 items-center justify-center text-[17px] font-semibold">{title}</span>
      {right}
    </div>
  );
}

function IconButton({ label, onClick, children, light = false }: { label: string; onClick: () => void; children: ReactNode; light?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn("relative z-10 grid h-11 w-11 place-items-center rounded-full active:scale-95", light ? "active:bg-muted" : "active:bg-white/10")}>
      {children}
    </button>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative z-10 h-10 rounded-full bg-white/10 px-4 text-[15px] font-semibold text-white transition-[opacity,transform] active:scale-95 disabled:opacity-35"
      data-composer-next
    >
      Next
    </button>
  );
}

/** The space a stage gets: the biggest box at the post's shape that fits. */
function useStage(aspect: number, maxH: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const box = useMemo(() => {
    const h = Math.min(size.h || maxH, maxH);
    const w = Math.min(size.w, h * aspect);
    return { w: Math.floor(w), h: Math.floor(w / aspect) };
  }, [size, aspect, maxH]);
  return { ref: setEl, box, width: size.w };
}

function SelectStep({
  tray,
  list,
  focused,
  onFocus,
  aspect,
  onAspect,
  gridFlash,
  onPick,
  onWrite,
}: {
  tray: ReturnType<typeof useSlideTray>;
  list: TrayItem[];
  focused: TrayItem | null;
  onFocus: (id: string) => void;
  aspect: PostAspect;
  onAspect: () => void;
  gridFlash: number;
  onPick: (how: "library" | "camera") => void;
  onWrite?: () => void;
}) {
  const shape = POST_ASPECTS[aspect];
  const [vh, setVh] = useState(800);
  useEffect(() => setVh(window.innerHeight), []);
  const stage = useStage(shape, Math.round(vh * 0.5));
  const framable = focused && focused.w && focused.h && (focused.kind === "image" ? focused.preview : focused.video);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={stage.ref} className="relative flex shrink-0 items-center justify-center bg-zinc-950" style={{ height: Math.round(vh * 0.5) }} data-composer-stage>
        {!focused ? (
          <div className="flex flex-col items-center gap-4 px-8 text-center animate-in fade-in-0 duration-300">
            <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-white/80">
              <Images className="h-9 w-9" />
            </div>
            <div>
              <div className="text-[19px] font-semibold">Share a photo or video</div>
              <p className="mt-1 text-[13px] text-white/60">Up to {MAX_SLIDES} in one post.</p>
            </div>
            <button type="button" onClick={() => onPick("library")} className="h-11 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground active:scale-[0.97]" data-composer-open-library>
              Choose from library
            </button>
            {onWrite && (
              <button type="button" onClick={onWrite} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-white/80 active:opacity-60" data-composer-write>
                <PenLine className="h-4 w-4" /> Write a post instead
              </button>
            )}
          </div>
        ) : (
          <div key={focused.id} className="relative overflow-hidden bg-black animate-in fade-in-0 duration-200" style={{ width: stage.box.w, height: stage.box.h }}>
            {framable ? (
              <PhotoFramer
                src={focused.kind === "image" ? focused.preview : null}
                video={focused.kind === "video" && focused.video ? { src: focused.video, trim: focused.trim, poster: focused.preview ?? undefined, sound: false } : null}
                size={{ w: focused.w!, h: focused.h! }}
                frame={stage.box}
                framing={focused.framing ?? CENTRED}
                onFraming={(f) => tray.setFraming(focused.id, f)}
                oneFinger
                gridPreview
                flash={gridFlash}
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <Loader2 className="h-7 w-7 animate-spin text-white/60" />
              </div>
            )}
            <button
              type="button"
              onClick={onAspect}
              className="absolute bottom-3 left-3 z-[5] inline-flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-[12px] font-bold backdrop-blur active:scale-95"
              aria-label={`Shape ${POST_ASPECT_LABEL[aspect]}. Tap to change`}
              data-composer-ratio={aspect}
            >
              <Maximize2 className="h-4 w-4" /> {POST_ASPECT_LABEL[aspect]}
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[17px] font-semibold">
          {list.length ? "Selected" : "Recents"}
          {list.length > 0 && <span className="ml-1.5 text-[14px] font-medium text-white/50">{list.length}/{MAX_SLIDES}</span>}
        </span>
        {list.length > 1 && <span className="text-[12px] text-white/50">Hold one and drag to reorder</span>}
      </div>
      <PickGrid tray={tray} list={list} focused={focused?.id ?? null} onFocus={onFocus} onPick={onPick} />
    </div>
  );
}

/**
 * The picks as Instagram's grid: Camera and Library first, then each pick
 * with its number in the post (hold and drag to move it), the one in focus
 * dimmed with a ✕ to take it off.
 */
function PickGrid({ tray, list, focused, onFocus, onPick }: { tray: ReturnType<typeof useSlideTray>; list: TrayItem[]; focused: string | null; onFocus: (id: string) => void; onPick: (how: "library" | "camera") => void }) {
  const grid = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: number } | null>(null);
  const hold = useRef<{ id: string; t: number; x0: number; y0: number } | null>(null);
  // while a tile is held and dragged, a finger moving up or down drags it, never scrolls the grid
  const dragging = useRef(false);
  dragging.current = !!drag;
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);
  const overIndex = (x: number, y: number) => {
    const tiles = Array.from(grid.current?.querySelectorAll<HTMLElement>("[data-pick-tile]") ?? []);
    let best = -1;
    let bestD = Infinity;
    tiles.forEach((t, i) => {
      const r = t.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  const full = list.length >= MAX_SLIDES;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24" data-no-swipe-back>
      <div ref={grid} className="grid grid-cols-4 gap-[2px]">
        <button type="button" disabled={full} onClick={() => onPick("camera")} className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 bg-zinc-900 text-white/85 active:bg-zinc-800 disabled:opacity-30" aria-label="Take a photo or video" data-composer-camera-tile>
          <Camera className="h-7 w-7" />
          <span className="text-[11px] font-semibold">Camera</span>
        </button>
        <button type="button" disabled={full} onClick={() => onPick("library")} className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 bg-zinc-900 text-white/85 active:bg-zinc-800 disabled:opacity-30" aria-label="Choose from your library" data-composer-library-tile>
          <Images className="h-7 w-7" />
          <span className="text-[11px] font-semibold">Library</span>
        </button>
        {list.map((it, i) => {
          const on = it.id === focused;
          const busy = it.status === "preparing" || it.status === "uploading";
          const dragging = drag?.id === it.id;
          return (
            <div
              key={it.id}
              data-pick-tile
              className={cn("relative aspect-[3/4] touch-pan-y overflow-hidden bg-zinc-900 animate-in fade-in-0 zoom-in-95 duration-200", dragging && "z-20 scale-105 opacity-90 shadow-2xl", drag && !dragging && drag.over === i && "ring-2 ring-white")}
              style={dragging ? { transform: `translate(${drag!.x}px, ${drag!.y}px) scale(1.06)` } : undefined}
              onPointerDown={(e) => {
                if (list.length < 2) return;
                hold.current = { id: it.id, t: window.setTimeout(() => {
                  feedback("press");
                  setDrag({ id: it.id, x: 0, y: 0, over: i });
                }, 380), x0: e.clientX, y0: e.clientY };
              }}
              onPointerMove={(e) => {
                const h = hold.current;
                if (!h) return;
                if (!drag && Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > 8) {
                  clearTimeout(h.t);
                  hold.current = null;
                  return;
                }
                if (drag?.id === it.id) {
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  setDrag({ id: it.id, x: e.clientX - h.x0, y: e.clientY - h.y0, over: overIndex(e.clientX, e.clientY) });
                }
              }}
              onPointerUp={() => {
                const h = hold.current;
                hold.current = null;
                if (h) clearTimeout(h.t);
                if (drag) {
                  if (drag.over >= 0 && drag.over !== i) {
                    tray.move(drag.id, drag.over);
                    feedback("detent");
                  }
                  setDrag(null);
                }
              }}
              onPointerCancel={() => {
                if (hold.current) clearTimeout(hold.current.t);
                hold.current = null;
                setDrag(null);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                type="button"
                onClick={() => (it.status === "error" ? tray.retry(it.id) : onFocus(it.id))}
                className="block h-full w-full select-none [-webkit-touch-callout:none]"
                aria-label={it.status === "error" ? "Didn't upload. Tap to try again" : `${it.kind === "video" ? "Clip" : "Photo"} ${i + 1}${on ? ", showing" : ""}`}
                aria-pressed={on}
              >
                {it.preview ? <img src={it.preview} alt="" draggable={false} className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-zinc-800" />}
              </button>
              {on && <span className="pointer-events-none absolute inset-0 bg-white/25" />}
              <span key={`${i}-${list.length}`} className="pointer-events-none absolute right-1.5 top-1.5 grid h-[22px] min-w-[22px] place-items-center rounded-full border-[1.5px] border-white bg-primary px-1 text-[12px] font-bold text-white shadow animate-in zoom-in-50 duration-200">
                {i + 1}
              </span>
              {it.kind === "video" && it.seconds != null && <span className="pointer-events-none absolute bottom-1 right-1.5 text-[12px] font-semibold tabular-nums drop-shadow">{formatClock(it.seconds)}</span>}
              {busy && (
                <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/50">
                  <span className="block h-full rounded-full bg-white transition-[width] duration-300" style={{ width: `${Math.max(8, it.progress)}%` }} />
                </span>
              )}
              {it.status === "error" && <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 text-[11px] font-bold text-red-300">Retry</span>}
              {on && (
                <button type="button" onClick={() => tray.remove(it.id)} className="absolute left-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/65 active:scale-90" aria-label={`Remove ${it.kind === "video" ? "clip" : "photo"} ${i + 1}`} data-composer-remove>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditStep({
  active,
  tray,
  list,
  aspect,
  slide,
  onSlide,
  coverEl,
  coverImage,
  items,
  setItems,
  request,
  setRequest,
  tool,
  setTool,
  filters,
  design,
  onAspect,
  onCover,
  onAdd,
  onTag,
  tags,
  hideLoadsOn,
  filterDefaults,
  setFilterDefault,
}: {
  active: boolean;
  tray: ReturnType<typeof useSlideTray>;
  list: TrayItem[];
  aspect: PostAspect;
  slide: number;
  onSlide: (i: number) => void;
  coverEl: (el: HTMLCanvasElement | null) => void;
  coverImage: TrayItem | null;
  items: StickerItem[];
  setItems: React.Dispatch<React.SetStateAction<StickerItem[]>>;
  request: StickerRequest;
  setRequest: (r: StickerRequest) => void;
  tool: ComposerTool;
  setTool: (t: ComposerTool) => void;
  filters: ComposerFilters;
  design: boolean;
  onAspect: () => void;
  onCover: (id: string) => void;
  onAdd: () => void;
  onTag: () => void;
  tags: number;
  hideLoadsOn: boolean;
  filterDefaults: FilterDefaults;
  setFilterDefault: (kind: FilterKind, g: MediaGrade | null) => void;
}) {
  const shape = POST_ASPECTS[aspect];
  const enhanceable = (it: TrayItem | null | undefined): it is TrayItem => !!it && !it.existing && it.canGrade !== false && (it.kind === "image" || videoGradeReady());
  const [vh, setVh] = useState(800);
  useEffect(() => setVh(window.innerHeight), []);
  const stage = useStage(shape, Math.round(vh * 0.56));
  const row = useRef<HTMLDivElement | null>(null);
  const cur = list[Math.min(slide, list.length - 1)] ?? null;
  const onCoverSlide = !!coverImage && cur?.id === coverImage.id;
  // swiping the row of slides moves the counter
  const onScroll = () => {
    const el = row.current;
    if (!el || !stage.box.w) return;
    const i = Math.round(el.scrollLeft / (stage.box.w + 12));
    if (i !== slide) onSlide(Math.max(0, Math.min(list.length - 1, i)));
  };
  const goTo = (i: number) => {
    const el = row.current;
    if (!el) return;
    el.scrollTo({ left: i * (stage.box.w + 12), behavior: "smooth" });
    onSlide(i);
  };
  useEffect(() => {
    if (slide > list.length - 1) onSlide(Math.max(0, list.length - 1));
  }, [list.length, slide, onSlide]);
  const stickerContext = useMemo(
    () => ({ time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), date: new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), workoutTitle: null }),
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={stage.ref} className="relative flex shrink-0 items-center justify-center" style={{ height: Math.round(vh * 0.56) }}>
        <div
          ref={row}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ width: stage.width, gap: 12, paddingInline: Math.max(0, (stage.width - stage.box.w) / 2) }}
          data-composer-slides
        >
          {list.map((it, i) => (
            <div key={it.id} className="relative shrink-0 snap-center overflow-hidden rounded-md bg-zinc-900" style={{ width: stage.box.w, height: stage.box.h }}>
              {coverImage && it.id === coverImage.id ? (
                <>
                  <canvas ref={coverEl} className="absolute inset-0 h-full w-full" data-composer-cover />
                  <StickerLayer items={items} setItems={setItems} width={stage.box.w} height={stage.box.h} context={stickerContext} request={request} />
                </>
              ) : (
                <SlideView it={it} box={stage.box} shape={shape} playing={active && i === slide} />
              )}
            </div>
          ))}
        </div>
        {list.length > 1 && (
          <span className="pointer-events-none absolute right-4 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-bold tabular-nums" data-composer-counter>
            {Math.min(slide, list.length - 1) + 1}/{list.length}
          </span>
        )}
        {hideLoadsOn && onCoverSlide && (
          <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] font-bold">Weights hidden: posts the photo</span>
        )}
      </div>

      {/* the tools for what's on screen */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {onCoverSlide && tool === "filters" && filters.items.length > 1 && (
          // the camera's own row (chips, the ring, the name): a photo picked here is filtered exactly the way the camera picks one
          <div className="pt-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200" data-composer-filters>
            <LookCarousel looks={filters.items} groups={filters.groups} look={filters.on} onLook={filters.pick} />
          </div>
        )}
        {tool === "enhance" && enhanceable(cur) && <EnhanceTool tray={tray} it={cur} list={list} defaults={filterDefaults} setDefault={setFilterDefault} />}
        {cur?.kind === "video" && tool !== "enhance" && <ClipTools tray={tray} it={cur} onCover={() => onCover(cur.id)} />}
      </div>
      <div className="shrink-0 px-3 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
        <div className="flex justify-around pb-3">
          {enhanceable(cur) && <Tool icon={<SlidersHorizontal className="h-5 w-5" />} label="Enhance" on={tool === "enhance"} onClick={() => setTool(tool === "enhance" ? null : "enhance")} />}
          {onCoverSlide && filters.items.length > 1 && <Tool icon={<Blend className="h-5 w-5" />} label="Filter" on={tool === "filters"} onClick={() => setTool(tool === "filters" ? null : "filters")} />}
          {onCoverSlide && <Tool icon={<Type className="h-5 w-5" />} label="Text" onClick={() => setRequest({ kind: "text", n: Date.now() })} />}
          {onCoverSlide && <Tool icon={<Smile className="h-5 w-5" />} label="Stickers" onClick={() => setRequest({ kind: "stickers", n: Date.now() })} />}
          <Tool icon={<AtSign className="h-5 w-5" />} label={tags ? `Tagged ${tags}` : "Tag"} on={tags > 0} onClick={onTag} />
          <Tool icon={<Maximize2 className="h-5 w-5" />} label={design ? `${POST_ASPECT_LABEL[aspect]}` : "Ratio"} onClick={onAspect} />
        </div>
        {/* every slide, small: tap to go to it, + to add more */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {list.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => goTo(i)}
              className={cn("relative h-12 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800 transition-[box-shadow,transform] duration-200", i === slide && "scale-105 ring-2 ring-white")}
              aria-label={`Slide ${i + 1}`}
              aria-pressed={i === slide}
            >
              {it.preview && <img src={it.preview} alt="" className="h-full w-full object-cover" />}
              {it.kind === "video" && <Play className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 fill-white text-white" />}
            </button>
          ))}
          {!tray.full && (
            <button type="button" onClick={onAdd} className="grid h-12 w-10 shrink-0 place-items-center rounded-md bg-zinc-800 active:scale-95" aria-label="Add more">
              <span className="text-[22px] leading-none">+</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A slide that isn't the first photo: framed as it'll go (a clip plays, muted, only while it's on screen). */
function SlideView({ it, box, shape, playing }: { it: TrayItem; box: { w: number; h: number }; shape: number; playing: boolean }) {
  if (!it.w || !it.h) return <div className="grid h-full w-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-white/60" /></div>;
  const size = { w: it.w, h: it.h };
  const f = clampFraming(it.framing ?? CENTRED, size, { w: shape, h: 1 });
  const p = placement(f, size, box);
  const style = { position: "absolute" as const, width: p.w, height: p.h, left: p.x, top: p.y, maxWidth: "none" };
  return <SlideMedia it={it} style={style} playing={playing} />;
}

/** A slide's photo or clip, its filter graded live over it (the same program the post bakes in). */
function SlideMedia({ it, style, playing }: { it: TrayItem; style: React.CSSProperties; playing: boolean }) {
  const [el, setEl] = useState<HTMLImageElement | HTMLVideoElement | null>(null);
  const grade = compiledFor(it.grade);
  const media =
    it.kind === "video" && it.video && playing ? (
      <TrimmedVideo key={it.video} src={it.video} trim={it.trim} poster={it.preview ?? undefined} style={style} className={cn("object-cover", grade && "opacity-0")} videoRef={setEl} />
    ) : it.preview ? (
      <img ref={setEl} src={it.preview} alt="" style={style} className={cn("object-cover", grade && "opacity-0")} draggable={false} />
    ) : null;
  return (
    <>
      {media}
      {grade && media && <GradedLayer source={el} grade={grade} style={style} />}
    </>
  );
}

/** A clip's filter is shown live by the GPU and re-encoded into it: only offered where WebGL is there. */
function videoGradeReady(): boolean {
  return typeof window !== "undefined" && !!sharedGradeGL();
}

/**
 * Enhance: the photo's or clip's filter and adjustments (FilterPanel), its
 * default for posts, and putting the same filter on other slides (Auto reads
 * each picture, pulled a little toward the set so the post looks like one).
 */
function EnhanceTool({ tray, it, list, defaults, setDefault }: { tray: ReturnType<typeof useSlideTray>; it: TrayItem; list: TrayItem[]; defaults: FilterDefaults; setDefault: (kind: FilterKind, g: MediaGrade | null) => void }) {
  const { img, stats } = useGradeSource(it.preview);
  const others = list.filter((x) => !x.existing && x.canGrade !== false && (x.kind === "image" || videoGradeReady()));
  const applyTo = async (ids: string[]) => {
    const g = it.grade ?? ORIGINAL;
    const targets = others.filter((x) => ids.includes(x.id));
    const read = await Promise.all(targets.map((x) => (x.preview ? loadGradeSource(x.preview) : Promise.resolve(null))));
    const all = read.map((r) => r?.stats ?? null);
    targets.forEach((x, i) => tray.setGrade(x.id, { filter: g.filter, intensity: g.intensity, adjust: g.adjust, stats: g.filter === "auto" ? consistentStats(all[i], all) : all[i] }));
    toast.message(targets.length === others.length ? "On every slide" : `On ${targets.length} slide${targets.length === 1 ? "" : "s"}`, { description: "Change any one on its own any time." });
  };
  return (
    <div className="px-4 pt-3 animate-in fade-in-0 duration-200" data-composer-enhance>
      <FilterPanel
        grade={it.grade ?? null}
        stats={stats}
        onChange={(g) => tray.setGrade(it.id, g)}
        source={img}
        sourceSize={img ? { w: img.naturalWidth, h: img.naturalHeight } : null}
        defaultGrade={defaults.post}
        onSaveDefault={() => {
          setDefault("post", it.grade ?? null);
          toast.message(it.grade && it.grade.filter !== "original" ? "Saved as your default for posts" : "No default filter for posts", { description: "New photos and clips start with it. This post's own changes never change it." });
        }}
        onClearDefault={() => {
          setDefault("post", null);
          toast.message("Default removed", { description: "New photos and clips start as shot." });
        }}
        scope={others.length > 1 ? { items: others.map((x) => ({ id: x.id, thumb: x.preview })), currentId: it.id, onApply: (ids) => void applyTo(ids) } : null}
      />
    </div>
  );
}

/** A clip's tools: trim it, sound on or off, its cover, the lift found in it. */
function ClipTools({ tray, it, onCover }: { tray: ReturnType<typeof useSlideTray>; it: TrayItem; onCover: () => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 px-4 pt-3 animate-in fade-in-0 duration-200">
      <button type="button" onClick={() => void tray.edit(it.id)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-semibold active:scale-95" data-composer-trim>
        <Scissors className="h-4 w-4" /> Trim{it.seconds != null ? ` · ${formatClock(it.seconds)}` : ""}
      </button>
      {it.audio && (
        <button type="button" onClick={() => tray.setSound(it.id, !!it.muted)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-semibold active:scale-95" aria-pressed={!it.muted} data-composer-sound>
          {it.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} {it.muted ? "No sound" : "Sound on"}
        </button>
      )}
      <button type="button" onClick={onCover} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-semibold active:scale-95" data-composer-cover-pick>
        <Film className="h-4 w-4" /> Cover
      </button>
      {it.lift && (
        <button
          type="button"
          onClick={() => (it.liftBefore !== undefined ? tray.undoLift(it.id) : tray.trimToLift(it.id))}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black active:scale-95"
        >
          <Scissors className="h-4 w-4" /> {it.liftBefore !== undefined ? "Whole clip" : `Trim to the lift · ${formatClock(it.lift.end - it.lift.start)}`}
        </button>
      )}
    </div>
  );
}

function Tool({ icon, label, onClick, on = false }: { icon: ReactNode; label: string; onClick: () => void; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex min-w-[56px] flex-col items-center gap-1 active:scale-95" aria-pressed={on}>
      <span className={cn("grid h-11 w-11 place-items-center rounded-xl transition-colors", on ? "bg-white text-black" : "bg-white/10")}>{icon}</span>
      <span className={cn("text-[11px] font-semibold", on ? "text-white" : "text-white/70")}>{label}</span>
    </button>
  );
}

function Row({ icon, label, value, onClick, ...rest }: { icon: ReactNode; label: string; value?: string; onClick: () => void } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted" {...rest}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 text-[15px] font-medium">{label}</span>
      {value && <span className="max-w-[50%] truncate text-[14px] text-muted-foreground">{value}</span>}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function AudienceRow({ value, onClick }: { value: CommunityVisibility; onClick: () => void }) {
  const audiences = useAudiences();
  const a = audiences.find((x) => x.key === pickerAudience(value)) ?? audiences[0];
  const Icon = AUD_ICON[a.key];
  return <Row icon={<Icon className="h-5 w-5" />} label="Audience" value={a.label} onClick={onClick} data-composer-audience />;
}

function AudienceSheet({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: CommunityVisibility; onChange: (v: CommunityVisibility) => void }) {
  const audiences = useAudiences();
  const picked = pickerAudience(value);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="gap-0 rounded-t-[22px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[520px]">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden />
        <div className="px-4 pb-1 pt-3">
          <SheetTitle className="text-[16px] font-semibold">Who can see it</SheetTitle>
          <SheetDescription className="sr-only">Pick who sees this post.</SheetDescription>
        </div>
        {audiences.map((a) => {
          const Icon = AUD_ICON[a.key];
          const on = picked === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                feedback("tap");
                onChange(a.key);
                onClose();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted"
              aria-pressed={on}
            >
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted", a.key === "close_friends" && "text-emerald-600")}>
                <Icon className={cn("h-5 w-5", a.key === "close_friends" && "fill-current")} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{a.label}</span>
                {a.hint && <span className="block text-[13px] leading-snug text-muted-foreground">{a.hint}</span>}
              </span>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors", on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50")}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </SheetContent>
    </Sheet>
  );
}

function PollEditor({ poll, setPoll, check }: { poll: string[]; setPoll: (p: string[] | null) => void; check: ReturnType<typeof cleanPollOptions> | null }) {
  return (
    <div className="mx-4 mb-3 space-y-2 rounded-2xl border border-border p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200" data-composer-poll-editor>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted-foreground">Poll</span>
        <button type="button" onClick={() => setPoll(null)} className="text-[13px] font-semibold text-muted-foreground active:opacity-60">
          Remove
        </button>
      </div>
      {poll.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={o}
            onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value.slice(0, POLL_OPTION_MAX) : x)))}
            placeholder={`Option ${i + 1}`}
            aria-label={`Option ${i + 1}`}
            className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3 text-[16px] outline-none focus:border-foreground"
          />
          {poll.length > 2 && (
            <button type="button" onClick={() => setPoll(poll.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {poll.length < POLL_MAX_OPTIONS && (
        <button type="button" onClick={() => setPoll([...poll, ""])} className="text-[14px] font-semibold active:opacity-60">
          + Add option
        </button>
      )}
      {check && !check.ok && poll.some((x) => x.trim()) && <p className="text-[12px] text-muted-foreground">{check.reason}</p>}
    </div>
  );
}

/** Share, with what's still uploading in the button itself, then a tick. */
function ShareButton({ busy, posted, disabled, progress, uploading, onClick, label }: { busy: boolean; posted: boolean; disabled: boolean; progress: number; uploading: number; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !busy && !posted}
      className={cn(
        "relative h-12 w-full overflow-hidden rounded-xl text-[16px] font-semibold transition-[background-color,transform] duration-300 active:scale-[0.99] disabled:opacity-45",
        posted ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground",
      )}
      data-composer-share
    >
      {busy && <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-500 ease-out" style={{ width: `${Math.max(12, progress)}%` }} aria-hidden />}
      <span className="relative inline-flex items-center gap-2">
        {posted ? (
          <>
            <Check className="h-5 w-5 animate-in zoom-in-50 duration-300" strokeWidth={3} /> Shared
          </>
        ) : busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> {uploading ? `Uploading… ${progress}%` : "Sharing…"}
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}
