import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNoAutoZoom } from "@/hooks/use-no-auto-zoom";
import { Camera, Check, ChevronLeft, Download, EyeOff, Film, Images, Lock, PenLine, RectangleHorizontal, RectangleVertical, RefreshCcw, Send, Smile, Square, Star, Timer, Type, User, Users, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { pickerAudience, type CommunityVisibility } from "@/lib/community";
import { useFollowState } from "@/lib/community-social";
import { TEMPLATE_LABEL, canvasToBlob, cardLogo, ensureDisplayFont, paintShareCard, shareCardImage, type ShareCardData, type ShareFormat, type ShareTemplate } from "@/lib/workout-share-card";
import { CaptionEditor, CaptionField, captionThumb } from "@/components/community/caption-editor";
import { AttachButtons, AttachGifPicker, AttachPreview, usePostAttach, type PostAttachInitial } from "@/components/community/post-attach";
import { SlideTray, useSlideTray } from "@/components/community/slide-tray";
import { MAX_SLIDES, type PostSlide } from "@/lib/community";
import { StickerLayer, drawStickers, type StickerItem, type StickerRequest } from "@/components/community/sticker-layer";
import { context2d, releaseCanvas } from "@/lib/canvas-memory";
import { clearDraft, draftWorthKeeping, loadDraft, saveDraft } from "@/lib/post-draft";
import { getPlatform, iosAppTooOldForCamera, isNative, openAppSettings, openTestFlight } from "@/platform";
import { reportCameraTrouble } from "@/lib/camera-report";
import { LookCarousel, lookItems, type LookItem } from "@/components/community/look-carousel";
import { canRecordClips, useClipRecorder } from "@/components/community/clip-recorder";
import { createCommunityPost, useHintsSeen, useMarkHintSeen } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import {
  CENTRED,
  CENTRE_FOCUS,
  POST_ASPECTS,
  POST_ASPECT_LABEL,
  STORY_ASPECT,
  feedAspect,
  focusPosition,
  framingFromGuide,
  guideBand,
  nextAspect,
  type Framing,
  type PostAspect,
} from "@/lib/photo-frame";
import { drawableSize, framedCanvas, lightCopy, type Drawable } from "@/lib/photo-frame-draw";
import { FocusFramer, PhotoFramer } from "@/components/community/photo-framer";
import { CoverPicker } from "@/components/community/cover-picker";

/**
 * What you're making, along the bottom like Instagram's POST / STORY: a post
 * (the feed and your profile grid, framed 4:5 / 1:1 / 16:9) or a story (24h
 * in the story rail, 9:16). The filters (Normal, a meal's looks, a lock in's,
 * a workout's) are the circles around the shutter.
 */
export type ShareKind = "post" | "story";
type CameraMode = { key: string; label: string };
const KINDS: { key: ShareKind; label: string }[] = [
  { key: "post", label: "Post" },
  { key: "story", label: "Story" },
];
/** A card in a post is the feed's 4:5. */
const FEED_CARD_ASPECT = 4 / 5;

/** The card painted on the viewfinder; swipe sideways to change the look. */
export type CameraCard = {
  data: Omit<ShareCardData, "media" | "template">;
  looks: ShareTemplate[];
  look: ShareTemplate;
  onLook: (t: ShareTemplate) => void;
};

export type StudioPostArgs = {
  photo: File | null;
  live: boolean;
  caption: string;
  visibility: CommunityVisibility;
  hideLoads: boolean;
  look: ShareTemplate;
  /** Slides 2..10, already uploaded, in order. */
  extras: PostSlide[];
  /** Puts the GIF / voice memo on the saved post (a no-op when they didn't change). */
  attach: (postId: string) => Promise<void>;
};
export type StudioPost = {
  /** Changes when the post it's for changes (resets the caption etc.). */
  key: string;
  label: string;
  caption?: string | null;
  visibility?: CommunityVisibility | null;
  hideLoads?: boolean;
  showHideLoads?: boolean;
  /** The post's other slides already (editing it). */
  extras?: PostSlide[] | null;
  /** The post's GIF and voice memo already (editing it). */
  attach?: PostAttachInitial | null;
  /** Editing a post that already has a photo / card up front: no new photo keeps it. */
  hasCover?: boolean;
  onPost: (a: StudioPostArgs) => Promise<void>;
  /** Off where this can only be a post (e.g. updating one that's already up). */
  allowStory?: boolean;
  /** Runs before a story goes up (a lock in's story starts the session, like its post does). */
  beforeStory?: () => Promise<void>;
};

type Shot = { src: HTMLCanvasElement | HTMLImageElement; file: File | null; live: boolean; at: Date };
/** Who can see a story: the crew (followers, on a private account) or Close friends. */
const STORY_AUDIENCE: CommunityVisibility[] = ["community", "close_friends"];

const CARD_W = 1080;
const CARD_H = 1920;
const LIVE_SCALE = 0.72;
const FRAME_MS = 33;
const AUDIENCE: { key: CommunityVisibility; label: string; icon: typeof Users }[] = [
  { key: "community", label: "JF crew", icon: Users },
  { key: "close_friends", label: "Close friends", icon: Star },
  { key: "coach", label: "My coach", icon: User },
  { key: "private", label: "Only me", icon: Lock },
];
const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The whole share, on one screen, story-camera style. The viewfinder IS
 * the card: the real share card painted live on the camera. Swipe for the
 * next look. Tap the shutter and the frame freezes right there; the same
 * screen becomes the editor — text and stickers on the card, a caption, who
 * sees it, then Post (JF community) or save the card to the phone. No second
 * screen, nothing reloads, no blank.
 *
 * No live camera (permission denied, old webview)? It falls back to the
 * phone's own camera and picker, and carries on from the frozen frame.
 *
 * Carousels: up to 10 on a post. The camera still comes first; the library
 * button picks several at once (the first photo gets the card, the rest
 * follow it), and the strip above the caption adds more from the camera or
 * the library. Each extra starts uploading the moment it's added.
 *
 * POST or STORY (the row under the camera, Instagram's): a post is framed
 * at the feed's shape (the camera shows the 4:5 part; then drag and pinch,
 * with a rule-of-thirds grid while your finger's on it, and 4:5 / 1:1 / 16:9)
 * and baked into the photo, so the feed, the post and the 3:4 profile grid
 * show exactly that. A clip keeps its whole picture: drag it to choose what
 * the feed and grid show, and pick its cover frame. A story is 9:16 and goes
 * to the story rail only.
 */
export function ShareStudio({
  open,
  onClose,
  filters,
  filter,
  onFilter,
  chip,
  card,
  canShoot = true,
  allowNoPhoto = true,
  accept = "image/*",
  onVideo,
  post,
  onWrite,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * The circles around the shutter when there's more than one card to choose
   * from (Normal, a meal's looks, a lock in's, a workout's): keys are the
   * caller's. Without them, the card's own looks.
   */
  filters?: LookItem[] | null;
  filter?: string | null;
  onFilter?: (key: string) => void;
  chip?: ReactNode;
  card: CameraCard | null;
  /** False while there's nothing to share yet (the chip says why). */
  canShoot?: boolean;
  /** "No photo" (post the card on the brand glow); off where the photo is the point (a meal). */
  allowNoPhoto?: boolean;
  accept?: string;
  /** A video picked from the library (cards can't be painted on video). */
  onVideo?: (file: File) => void;
  post: StudioPost | null;
  /** A words-first post instead (shown where "No photo" is, when there's no card). */
  onWrite?: () => void;
}) {
  // No iOS focus-zoom anywhere in the studio: it left the editor zoomed and off-centre.
  useNoAutoZoom(open);
  const [phase, setPhase] = useState<"shoot" | "edit">("shoot");
  // POST or STORY (the row under the camera)
  const [kind, setKind] = useState<ShareKind>("post");
  const story = kind === "story";
  // a post's photo: its shape and how it sits in it (baked in when it's posted)
  const [aspect, setAspect] = useState<PostAspect>("portrait");
  const [framing, setFraming] = useState<Framing>(CENTRED);
  // a finger is on it: the card repaints at preview quality until it lifts
  const [framingLive, setFramingLive] = useState(false);
  const [shapeFlash, setShapeFlash] = useState(0);
  // Edit cover (a clip on a post)
  const [coverFor, setCoverFor] = useState<string | null>(null);
  // Shooting another slide for the carousel (plain camera, no card on it).
  const [adding, setAdding] = useState(false);
  const [coverThumb, setCoverThumb] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState<"starting" | "live" | "fallback">("starting");
  // Why the live camera isn't on: switched off for the app ("denied"), or something else.
  const [camWhy, setCamWhy] = useState<"denied" | "other" | null>(null);
  // An iPhone app from before the camera worked in it: it has to be updated first.
  const [oldApp, setOldApp] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [flash, setFlash] = useState(false);
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [count, setCount] = useState<number | null>(null);
  const [lookFlash, setLookFlash] = useState<string | null>(null);
  const [cardFailed, setCardFailed] = useState(false);
  const [items, setItems] = useState<StickerItem[]>([]);
  const [request, setRequest] = useState<StickerRequest>(null);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("community");
  const [hideLoads, setHideLoads] = useState(false);
  const [busy, setBusy] = useState<null | "post" | "save">(null);
  const [posted, setPosted] = useState(false);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  // Writing the caption happens on its own screen (with a preview of the post).
  const [captioning, setCaptioning] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  const [cardEl, setCardEl] = useState<HTMLCanvasElement | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const libRef = useRef<HTMLInputElement | null>(null);
  const capRef = useRef<HTMLInputElement | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTap = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef(card);
  cardRef.current = card;
  const tray = useSlideTray({ open, initial: post?.extras, resetKey: post?.key ?? "", coverCount: card || shot ? 1 : 0 });
  const att = usePostAttach({ initial: post?.attach, key: post?.key ?? "", open });
  useEffect(() => {
    if (!open) att.discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const postedRef = useRef(false);
  postedRef.current = posted;

  // Fresh every time it opens.
  useEffect(() => {
    if (!open) {
      // closed without posting: new uploads are thrown away
      if (!postedRef.current) tray.discard();
      return;
    }
    setPhase("shoot");
    setAdding(false);
    setShot(null);
    setItems([]);
    setPosted(false);
    setBusy(null);
    setKind("post");
    setAspect("portrait");
    setFraming(CENTRED);
    setCoverFor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // The post it's for: start from what's already there (editing, not duplicating).
  // Not while posting: saving changes the post's key, and the caption must not blink.
  const postingRef = useRef(false);
  postingRef.current = !!busy || posted;
  useEffect(() => {
    if (!open || !post || postingRef.current) return;
    setCaption(post.caption ?? "");
    setVisibility(pickerAudience(post.visibility));
    setHideLoads(!!post.hideLoads);
    setPosted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.key]);

  /* ---- the draft: never lose the post ------------------------------- */
  // Kept on the phone while it's being made (photo, caption, audience, look).
  // Opening the same post again (after a failed post, a crash, a reload, or
  // iOS dropping the app while the camera was open) picks it up again.
  const draftOff = useRef(false);
  const restoredFor = useRef<string | null>(null);
  const photoBlob = useRef<{ shot: Shot; blob: Promise<Blob | null> } | null>(null);
  // nothing is saved over the draft until it's been read back
  const restoring = useRef(false);
  useEffect(() => {
    if (!open || !post || restoredFor.current === post.key) return;
    restoredFor.current = post.key;
    draftOff.current = false;
    const key = post.key;
    restoring.current = true;
    void loadDraft(key).then((d) => {
      restoring.current = false;
      if (!d || restoredFor.current !== key || postingRef.current) return;
      if (d.caption) setCaption(d.caption);
      if (d.visibility === "community" || d.visibility === "close_friends" || d.visibility === "coach" || d.visibility === "private") setVisibility(d.visibility);
      if (d.look && cardRef.current?.looks.includes(d.look as ShareTemplate)) cardRef.current.onLook(d.look as ShareTemplate);
      const startOver = () => {
        void clearDraft(key);
        retake();
        setCaption(post.caption ?? "");
      };
      if (!d.photo) {
        if (d.caption) toast.message("Your caption is back", { action: { label: "Clear", onClick: () => setCaption(post.caption ?? "") } });
        return;
      }
      const url = URL.createObjectURL(d.photo);
      const img = new Image();
      img.onload = () => {
        freeze({ src: img, file: new File([d.photo!], "jf-photo.jpg", { type: d.photo!.type || "image/jpeg" }), live: d.live, at: new Date(d.at) });
        toast.message("Picked up where you left off", { action: { label: "Start over", onClick: startOver } });
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.key]);
  useEffect(() => {
    if (!open) restoredFor.current = null;
  }, [open]);
  // Save as it changes (a beat after the last change). The photo is encoded once per shot.
  useEffect(() => {
    if (!open || !post || posted || busy || draftOff.current || restoring.current) return;
    const key = post.key;
    const t = setTimeout(async () => {
      let photo: Blob | null = null;
      if (shot) {
        if (photoBlob.current?.shot !== shot) {
          photoBlob.current = {
            shot,
            blob: shot.file ? Promise.resolve(shot.file) : shot.src instanceof HTMLCanvasElement ? canvasToBlob(shot.src, "image/jpeg", 0.9) : Promise.resolve(null),
          };
        }
        photo = await photoBlob.current.blob;
      }
      if (draftOff.current) return;
      const d = { key, caption, visibility, look: card?.look ?? null, photo, live: !!shot?.live, at: (shot?.at ?? new Date()).getTime() };
      if (draftWorthKeeping(d)) void saveDraft(d);
      else void clearDraft(key);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.key, shot, caption, visibility, card?.look, posted, busy]);

  useEffect(() => {
    void Promise.all([ensureDisplayFont(), cardLogo()]).then(([, l]) => setLogo(l));
  }, []);

  // The camera: exactly 9:16. Shooting, it's edge to edge like Instagram's
  // camera (the shutter and looks sit over its foot, the bar under it); a
  // screen too short for that (a laptop) fits it. Editing, the frame is the
  // post's own shape (below), so what you see is what you share.
  useEffect(() => {
    if (!area || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setAreaSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(area);
    return () => ro.disconnect();
  }, [area]);
  // the whole screen and the bar under the camera: full screen when the camera fits above the bar
  // (every recent phone); a shorter one (an SE, a laptop) keeps the camera above the controls
  const [screenEl, setScreenEl] = useState<HTMLDivElement | null>(null);
  const [screenSize, setScreenSize] = useState({ w: 0, h: 0, top: 0 });
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const [barH, setBarH] = useState(0);
  useEffect(() => {
    if (!screenEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const top = area ? parseFloat(getComputedStyle(area).paddingTop) || 0 : 0;
      setScreenSize({ w: e.contentRect.width, h: e.contentRect.height, top });
    });
    ro.observe(screenEl);
    return () => ro.disconnect();
  }, [screenEl, area]);
  useEffect(() => {
    if (!barEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBarH(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height));
    ro.observe(barEl);
    return () => ro.disconnect();
  }, [barEl]);
  const fullScreen = phase === "shoot" && screenSize.w > 0 && barH > 0 && screenSize.h - screenSize.top - (screenSize.w * CARD_H) / CARD_W >= barH - 2;
  // The editor's frame is what's posted: a story's 9:16; a post's card, the
  // feed's 4:5; a post's photo, the shape picked (4:5 / 1:1 / 16:9); a post
  // of clips, the shape the feed shows the first one at. The camera is 9:16.
  const clip0 = phase === "edit" && !card && !shot ? tray.items[0] ?? null : null;
  const frameAspect = story
    ? STORY_ASPECT
    : card && !cardFailed
      ? FEED_CARD_ASPECT
      : shot
        ? POST_ASPECTS[aspect]
        : clip0?.w && clip0?.h
          ? feedAspect(clip0.w, clip0.h)
          : FEED_CARD_ASPECT;
  const boxAspect = phase === "shoot" ? CARD_W / CARD_H : frameAspect;
  const box = useMemo(() => {
    const w = fullScreen ? areaSize.w : Math.min(areaSize.w, areaSize.h * boxAspect);
    return { w: Math.floor(w), h: Math.floor(w / boxAspect) };
  }, [areaSize, fullScreen, boxAspect]);
  // a post on the camera: the 4:5 part of it (the rest is dimmed), what the photo starts framed as
  const band = useMemo(() => (story ? { x: 0, y: 0, w: box.w, h: box.h } : guideBand(box, FEED_CARD_ASPECT)), [story, box]);
  const cardFormat: ShareFormat = story ? "story" : "feed";

  /* ---- camera ------------------------------------------------------- */
  const cancelCount = () => {
    if (countRef.current) clearInterval(countRef.current);
    countRef.current = null;
    setCount(null);
  };
  const stop = () => {
    cancelCount();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Drop the element's hold on the stream too, so the camera light goes off.
    if (video) video.srcObject = null;
  };

  const shooting = open && phase === "shoot";
  // Bumped to start the camera again (iOS ends it when you switch apps or lock the phone).
  const [camTry, setCamTry] = useState(0);
  const restarts = useRef(0);
  useEffect(() => {
    if (!open) return;
    restarts.current = 0;
    let gone = false;
    void iosAppTooOldForCamera().then((old) => !gone && setOldApp(old));
    return () => {
      gone = true;
    };
  }, [open]);
  const restartCamera = () => {
    if (restarts.current >= 3) return setStatus("fallback");
    restarts.current += 1;
    setCamTry((n) => n + 1);
  };
  // Why the live camera didn't start, reported once per open (phone app only).
  const reported = useRef(false);
  useEffect(() => {
    if (open) reported.current = false;
  }, [open]);
  const report = (reason: string, extra?: Record<string, unknown>) => {
    if (reported.current) return;
    reported.current = true;
    void reportCameraTrouble(reason, { facing, ...extra });
  };
  useEffect(() => {
    if (!shooting || !video) return;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      report("no camera API in this web view");
      setStatus("fallback");
      return;
    }
    setStatus("starting");
    let step = "asking";
    // still nothing after a while (a stuck camera): the phone's own camera instead; a late start still goes live
    const slow = setTimeout(() => {
      if (cancelled || statusRef.current !== "starting") return;
      report(`timed out (${step})`);
      setStatus("fallback");
    }, 8000);
    // The full-quality ask first; a camera that can't do it gets simpler ones
    // (a refusal is final: asking again only repeats it).
    const asks: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },
      { video: { facingMode: facing }, audio: false },
      { video: true, audio: false },
    ];
    const openCamera = async (): Promise<MediaStream> => {
      let last: unknown = null;
      for (const ask of asks) {
        try {
          return await navigator.mediaDevices.getUserMedia(ask);
        } catch (e) {
          last = e;
          const name = (e as { name?: string } | null)?.name;
          if (name === "NotAllowedError" || name === "SecurityError") break;
        }
      }
      throw last;
    };
    openCamera()
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        stop();
        step = "showing";
        streamRef.current = stream;
        // iOS plays a camera inline only when the element is muted + playsinline as attributes
        video.muted = true;
        video.setAttribute("muted", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.srcObject = stream;
        // ended by the system (not by us: stop() doesn't fire this): start again once we're back on screen
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled && streamRef.current === stream && document.visibilityState === "visible") restartCamera();
        });
        // Live as soon as frames arrive; never wait on play() itself, which can
        // stay pending in an app's web view even while the picture is showing.
        const live = () => {
          if (cancelled || streamRef.current !== stream) return;
          clearTimeout(slow);
          setCamWhy(null);
          setStatus("live");
        };
        if (video.readyState >= 2) live();
        else {
          video.addEventListener("loadeddata", live, { once: true });
          video.addEventListener("playing", live, { once: true });
        }
        void video.play().then(live, () => {
          /* muted + inline: only fails if it was closed */
        });
      })
      .catch((e: unknown) => {
        clearTimeout(slow);
        if (cancelled) return;
        const err = e as { name?: string; message?: string } | null;
        const name = err?.name;
        setCamWhy(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "other");
        setStatus("fallback");
        if (name !== "NotAllowedError") report(`${name ?? "error"}: ${err?.message ?? String(e)}`);
      });
    return () => {
      cancelled = true;
      clearTimeout(slow);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shooting, video, facing, camTry]);
  // Back from another app: a camera the system ended starts again, a paused one plays on.
  useEffect(() => {
    if (!shooting) return;
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      // back from Settings (camera just switched on) or any other app: try the live camera again
      if (statusRef.current === "fallback") {
        restarts.current = 0;
        return restartCamera();
      }
      if (!streamRef.current) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (!track || track.readyState === "ended") restartCamera();
      else if (video?.paused) void video.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shooting, video]);
  useEffect(() => {
    if (!open) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ---- the card ----------------------------------------------------- */
  const showCard = !!card && !cardFailed && !adding;
  const frozenLockedIn = (d: CameraCard["data"]) =>
    d.lockedIn?.live ? { time: timeLabel(shot?.at ?? new Date()), live: !!shot?.live } : d.lockedIn;

  // Live: ~30 fps on the camera feed, a lighter-res preview.
  useEffect(() => {
    if (!shooting || !cardEl || !showCard || !logo) return;
    let raf = 0;
    let last = 0;
    let alive = true;
    const mirror = document.createElement("canvas");
    const frame = (t: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (t - last < FRAME_MS) return;
      last = t;
      const c = cardRef.current;
      if (!c) return;
      let media: ShareCardData["media"] = null;
      if (status === "live" && video && video.videoWidth) {
        if (facing === "user") {
          const w = Math.min(960, video.videoWidth);
          const h = Math.round((w * video.videoHeight) / video.videoWidth);
          if (mirror.width !== w) mirror.width = w;
          if (mirror.height !== h) mirror.height = h;
          const m = mirror.getContext("2d")!;
          m.setTransform(-1, 0, 0, 1, w, 0);
          m.drawImage(video, 0, 0, w, h);
          media = mirror;
        } else media = video;
      }
      const lockedIn = c.data.lockedIn?.live ? { time: timeLabel(new Date()), live: true } : c.data.lockedIn;
      try {
        // a post's card is the feed's 4:5 (in the middle of the camera), a story's the full 9:16
        paintShareCard(cardEl, { ...c.data, format: cardFormat, lockedIn, template: c.look, media }, logo, LIVE_SCALE);
      } catch {
        alive = false;
        setCardFailed(true);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      releaseCanvas(mirror);
    };
  }, [shooting, cardEl, showCard, logo, status, video, facing, cardFormat]);

  // The frozen shot, light enough to repaint a card on every move of a finger.
  const light = useMemo(() => (shot ? lightCopy(shot.src) : null), [shot]);
  useEffect(() => () => light?.release(), [light]);
  const shotSize = useMemo(() => (shot ? drawableSize(shot.src) : null), [shot]);

  // Frozen: the card over the photo as it's framed, full res once a finger lifts.
  useEffect(() => {
    if (phase !== "edit" || !cardEl || !card || !logo) return;
    let raf = 0;
    raf = requestAnimationFrame(() => {
      const media = shot ? framedCanvas(framingLive && light ? light.src : shot.src, framing, frameAspect, framingLive ? 540 : 1080) : null;
      try {
        paintShareCard(cardEl, { ...card.data, format: cardFormat, lockedIn: frozenLockedIn(card.data), template: card.look, media }, logo, framingLive ? 0.6 : 1);
      } catch {
        setCardFailed(true);
      } finally {
        releaseCanvas(media);
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cardEl, card?.look, card?.data, shot, logo, framing, framingLive, cardFormat, frameAspect]);

  const changeLook = (dir: 1 | -1) => {
    // on the camera, a swipe walks the whole row of filters (Normal, meal, lock in, workout)
    if (phase === "shoot" && filters && filters.length > 1 && onFilter) {
      const i = Math.max(0, filters.findIndex((f) => f.key === filter));
      onFilter(filters[(i + dir + filters.length) % filters.length].key);
      return;
    }
    if (!card || card.looks.length < 2) return;
    const i = Math.max(0, card.looks.indexOf(card.look));
    const next = card.looks[(i + dir + card.looks.length) % card.looks.length];
    card.onLook(next);
    // shooting, the looks' row shows it; editing, a quick name on the card
    if (phase === "edit") setLookFlash(TEMPLATE_LABEL[next]);
  };
  useEffect(() => {
    if (!lookFlash) return;
    const t = setTimeout(() => setLookFlash(null), 900);
    return () => clearTimeout(t);
  }, [lookFlash]);
  const [pinchHint, setPinchHint] = useState(false);
  const hasCard = !!card;
  useEffect(() => {
    if (phase !== "edit" || !shot || !hasCard || cardFailed) return setPinchHint(false);
    setPinchHint(true);
    const t = setTimeout(() => setPinchHint(false), 2600);
    return () => clearTimeout(t);
  }, [phase, shot, hasCard, cardFailed]);
  // the hint goes the moment they do it
  useEffect(() => {
    if (framingLive) setPinchHint(false);
  }, [framingLive]);

  /* ---- shoot -------------------------------------------------------- */
  // a camera frame is a full-size canvas: hand its memory back the moment it's replaced or done with
  const dropShot = (s: Shot | null) => {
    if (s?.src instanceof HTMLCanvasElement) releaseCanvas(s.src);
    if (s?.src instanceof HTMLImageElement && s.src.src.startsWith("blob:")) URL.revokeObjectURL(s.src.src);
  };
  const shotRef = useRef<Shot | null>(null);
  shotRef.current = shot;
  useEffect(() => {
    if (open) return;
    dropShot(shotRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /** The shot freezes into the editor, framed as `f` (what the camera showed of it, else centred). */
  const freeze = (s: Shot, f: Framing = CENTRED) => {
    stop();
    if (shotRef.current && shotRef.current !== s) dropShot(shotRef.current);
    setShot(s);
    setItems([]);
    setFraming(f);
    setAspect("portrait");
    setPhase("edit");
  };
  const capture = () => {
    if (!video || status !== "live" || !video.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) {
      releaseCanvas(c);
      return void toast.error("Your phone ran out of memory for photos. Close a few apps and try again.");
    }
    // The selfie preview is mirrored; keep it the way it looked.
    if (facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, c.width, c.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    if (adding) {
      // another slide: straight into the strip, back to the post
      void canvasToBlob(c, "image/jpeg", 0.92).then((b) => {
        releaseCanvas(c);
        if (b) void tray.add([new File([b], `jf-live-${Date.now()}.jpg`, { type: "image/jpeg" })]);
      });
      backToPost();
      return;
    }
    // framed the way the camera showed it: a post's 4:5 part (with a card on it, the card's own framing: centred)
    const view = { w: box.w, h: box.h };
    freeze({ src: c, file: null, live: true, at: new Date() }, card ? CENTRED : framingFromGuide({ w: c.width, h: c.height }, view, { w: band.w, h: band.h }));
  };
  const backToPost = () => {
    cancelCount();
    setAdding(false);
    setPhase("edit");
  };
  // Hold the shutter to film a clip (a plain post: looks and cards are painted on photos)
  const recordable = useMemo(() => canRecordClips(), []) && !card && status === "live" && canShoot && count == null;
  const hints = useHintsSeen();
  const markHint = useMarkHintSeen();
  const recorder = useClipRecorder({
    getStream: () => streamRef.current,
    onClip: (file) => {
      markHint("hold_to_film");
      // a clip is the post (or the next slide): it starts uploading now, and plays while you write the caption
      if (adding) {
        void tray.add([file]);
        backToPost();
        return;
      }
      skipPhoto();
      void tray.add([file]);
    },
  });
  // off the camera, or onto a mode with a card, mid-clip: it's thrown away
  useEffect(() => {
    if (recorder.recording && (!shooting || !recordable)) recorder.stop(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shooting, recordable, recorder.recording]);
  const shoot = () => {
    // filming that kept going after the mic question: a tap stops it
    if (recorder.recording) return recorder.stop();
    if (!canShoot) return;
    // the camera's still coming up: a tap here must not throw you into the phone's camera
    if (status === "starting") return;
    // no live camera: the phone's own (never on an iPhone app too old for it: that would close the app)
    if (status !== "live") return oldApp ? libRef.current?.click() : capRef.current?.click();
    if (count != null) return cancelCount();
    if (!timer) return capture();
    let n = timer;
    setCount(n);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        cancelCount();
        capture();
      } else setCount(n);
    }, 1000);
  };
  const fromInput = (e: React.ChangeEvent<HTMLInputElement>, live: boolean) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    // adding to the carousel (from the strip, or the camera while adding)
    if (phase === "edit" || adding) {
      void tray.add(files);
      if (adding) backToPost();
      return;
    }
    const isVideo = (x: File) => x.type.startsWith("video/");
    // a story is one photo or one clip
    if (story && files.length > 1) {
      toast.message("A story is one photo or clip", { description: "The first one you picked is in." });
      files.splice(1);
    }
    const heroAt = files.findIndex((x) => !isVideo(x));
    if (heroAt === -1) {
      // a plain post (no card): the clips are the post
      if (!card) {
        skipPhoto();
        void tray.add(files);
        return;
      }
      if (!onVideo) return void toast.error("Pick a photo for this one");
      // one video: the video editor, as before. Several: the card leads, the clips follow.
      if (files.length === 1) {
        stop();
        onVideo(files[0]);
        return;
      }
      skipPhoto();
      void tray.add(files);
      return;
    }
    // the first photo gets the card; everything else follows it, in order
    const f = files[heroAt];
    const rest = files.filter((_, i) => i !== heroAt);
    if (rest.length) void tray.add(rest);
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => freeze({ src: img, file: f, live, at: new Date() });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Couldn't open that photo");
    };
    img.src = url;
  };
  const skipPhoto = () => {
    stop();
    dropShot(shotRef.current);
    setShot(null);
    setItems([]);
    setPhase("edit");
  };
  const retake = () => {
    dropShot(shotRef.current);
    setShot(null);
    setItems([]);
    setPosted(false);
    setPhase("shoot");
  };

  const flip = () => status === "live" && setFacing((f) => (f === "user" ? "environment" : "user"));
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button, input, textarea")) return void (swipe.current = null);
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: React.PointerEvent) => {
    const st = swipe.current;
    swipe.current = null;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) changeLook(dx < 0 ? 1 : -1);
    else if (phase === "shoot" && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTap.current < 300) flip();
      lastTap.current = now;
    }
  };

  /* ---- export ------------------------------------------------------- */
  // What's posted is what the frame shows: the photo cut to the frame (1080
  // wide, the shape picked), stickers where they sit. No re-mapping between
  // shapes any more: the editor already shows the post's own shape.
  const framedFile = async (frameShape: number, name: string): Promise<File | null> => {
    if (!shot) return null;
    const c = framedCanvas(shot.src as Drawable, framing, frameShape);
    try {
      if (items.length) drawStickers(context2d(c), items, c.width, c.height);
      const b = await canvasToBlob(c, "image/jpeg", 0.92);
      return b ? new File([b], name, { type: "image/jpeg" }) : null;
    } finally {
      releaseCanvas(c);
    }
  };
  const finalPhoto = () => framedFile(frameAspect, shot?.live ? "jf-live.jpg" : "jf-photo.jpg");
  /** The card as it's shown (a post's 4:5 or a story's 9:16), over the photo as it's framed, stickers on top. */
  const cardImage = async (fmt: ShareFormat): Promise<Blob | null> => {
    if (!card) return null;
    const c = document.createElement("canvas");
    const media = shot ? framedCanvas(shot.src as Drawable, framing, fmt === "feed" ? FEED_CARD_ASPECT : STORY_ASPECT) : null;
    try {
      paintShareCard(c, { ...card.data, format: fmt, lockedIn: frozenLockedIn(card.data), template: card.look, media }, logo, 1);
      drawStickers(context2d(c), items, c.width, c.height);
      return await canvasToBlob(c, "image/jpeg", 0.92);
    } finally {
      releaseCanvas(media);
      releaseCanvas(c);
    }
  };
  const cardBlob = () => cardImage(cardFormat);

  // What gets posted is what you see: the look you're on, as the 4:5 feed card.
  // "No filter" posts the photo itself; so does Hide weights, so a card never
  // shows your numbers. With no photo, a carousel opens on the card itself
  // (what you see as slide 1).
  const postPhoto = async (carousel: boolean): Promise<File | null> => {
    if (!card) return finalPhoto();
    const bare = card.look === "plain" || (post?.showHideLoads && hideLoads);
    // editing without a new photo: the post keeps the one it has (a bare card never replaces it)
    if (!shot && post?.hasCover) return null;
    if (!shot && (!carousel || bare)) return null;
    if (shot && bare) return finalPhoto();
    const b = await cardImage("feed");
    return b ? new File([b], `jf-${card.look}.jpg`, { type: "image/jpeg" }) : finalPhoto();
  };
  /** A story's picture: the card (9:16) or the framed photo; null for a clip (it goes up as it is). */
  const storyPhoto = async (): Promise<File | null> => {
    if (card && !(card.look === "plain" && shot)) {
      const b = await cardImage("story");
      return b ? new File([b], `jf-story-${card.look}.jpg`, { type: "image/jpeg" }) : finalPhoto();
    }
    return finalPhoto();
  };

  // what the frame shows now, small (the strip's slide 1, the caption screen)
  const smallFrame = (extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    if (cardEl) return captionThumb(cardEl, extra) ?? null;
    if (!shot) return null;
    const c = framedCanvas((light?.src ?? shot.src) as Drawable, framing, frameAspect, 378);
    try {
      return captionThumb(c, extra) ?? null;
    } finally {
      releaseCanvas(c);
    }
  };
  // Slide 1 in the strip: the card or photo as it is now, small.
  useEffect(() => {
    if (phase !== "edit" || framingLive) return;
    const t = setTimeout(() => setCoverThumb(smallFrame()), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cardEl, card?.look, shot, framing, framingLive, frameAspect]);

  // The caption screen's preview: the card as it is now, stickers and all, small.
  const openCaption = () => {
    setThumb(smallFrame((ctx, w, h) => drawStickers(ctx, items, w, h)));
    setCaptioning(true);
  };

  // something to post: the card, or (a plain post) a photo or a slide
  const hasContent = !!card || !!shot || tray.items.length > 0;
  const qc = useQueryClient();
  const { user } = useAuth();
  /** STORY: the picture (or the clip) goes to your story, never the feed. */
  const postStory = async () => {
    if (!user?.id) throw new Error("Sign in again to post");
    const photo = await storyPhoto();
    // a clip story: the clip itself (it's been uploading since it was picked)
    const extras = photo ? [] : (await tray.ready()).slice(0, 1);
    if (!photo && !extras.length) throw new Error("Add a photo or a clip to your story");
    await post?.beforeStory?.();
    // (the button only offers the crew or Close friends; whatever the post it's for had, a story is one of those)
    const audience: CommunityVisibility = STORY_AUDIENCE.includes(visibility) ? visibility : "community";
    await createCommunityPost(qc, { userId: user.id, caption: "", visibility: audience, photo, extras, story: true });
    if (!photo) tray.commit();
    else tray.discard();
    toast.success(audience === "close_friends" ? "Added to your Close friends story" : "Added to your story", { description: "It's in the story row for 24 hours." });
  };
  const doPost = async () => {
    if (!post || busy || posted || !hasContent) return;
    setBusy("post");
    try {
      if (story) {
        await postStory();
        void clearDraft();
        draftOff.current = true;
        setPosted(true);
        setTimeout(onClose, 900);
        return;
      }
      // the extras have been uploading all along; this only waits for any still going
      const extras = await tray.ready();
      await post.onPost({ photo: await postPhoto(extras.length > 0), live: !!shot?.live, caption: caption.trim(), visibility, hideLoads, look: card?.look ?? "plain", extras, attach: att.save });
      tray.commit();
      // posted: the draft is done with (a lock in's key can change while it posts, so not by key)
      void clearDraft();
      draftOff.current = true;
      setPosted(true);
      setTimeout(onClose, 900);
    } catch (e: any) {
      if (e?.posted) {
        // the post is up (only the GIF / voice memo missed): its photos are the post's now
        tray.commit();
        void clearDraft();
        draftOff.current = true;
        setPosted(true);
        setTimeout(onClose, 900);
        toast.warning(e.message);
      } else toast.error(e?.message ?? "Couldn't post. Try again.");
    } finally {
      setBusy(null);
    }
  };
  // Save the card to the phone. On phones that's the system sheet (its "Save
  // Image" puts it in Photos); elsewhere it downloads.
  const doSave = async () => {
    if (busy || (!card && !shot)) return;
    setBusy("save");
    try {
      const blob = card ? await cardBlob() : await finalPhoto();
      if (!blob) throw new Error("Couldn't build the card");
      const outcome = await shareCardImage(blob, { filename: `jf-effect-${card?.look ?? "photo"}.jpg`, title: "JF Effect" });
      if (outcome === "downloaded") toast.success("Saved to your phone");
      else if (outcome === "failed") toast.error("Couldn't save on this device");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the card");
    } finally {
      setBusy(null);
    }
  };

  // The frozen photo shown bare (no card on it): encoded once, not on every keystroke of the caption.
  const shotUrl = useMemo(() => {
    if (phase !== "edit" || showCard || !shot) return null;
    return shot.src instanceof HTMLImageElement ? shot.src.src : (shot.src as HTMLCanvasElement).toDataURL("image/jpeg", 0.8);
  }, [phase, showCard, shot]);
  const { data: follows } = useFollowState();
  // a story goes to the crew or Close friends (a story only you or your coach could see would show nowhere)
  const audList = story ? AUDIENCE.filter((a) => STORY_AUDIENCE.includes(a.key)) : AUDIENCE;
  const audBase = audList.find((a) => a.key === visibility) ?? audList[0];
  // a private account's crew choice reaches its followers
  const aud = audBase.key === "community" && follows?.is_private ? { ...audBase, label: "Followers" } : audBase;
  const AudIcon = aud.icon;
  const stickerContext = useMemo(
    () => ({ time: timeLabel(shot?.at ?? new Date()), date: card?.data.dateLabel ?? new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), workoutTitle: card?.data.workoutTitle ?? null }),
    [shot, card?.data.dateLabel, card?.data.workoutTitle],
  );
  const pill = "grid h-11 w-11 place-items-center rounded-full bg-black/40 backdrop-blur active:scale-95";
  // Post or Story (Story is off only where this can only update a post that's already up)
  const storyable = post?.allowStory !== false;
  const pickKind = (k: ShareKind) => {
    cancelCount();
    setKind(k);
    if (k === "story" && !STORY_AUDIENCE.includes(visibility)) setVisibility("community");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        ref={setScreenEl}
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Share</DialogTitle>
        <DialogDescription className="sr-only">Take a photo, add text or stickers, then post it to the community or share it to your story.</DialogDescription>
        <input ref={libRef} type="file" accept={accept} multiple hidden onChange={(e) => fromInput(e, false)} />
        {/* the phone's own camera (no live camera here): a plain post can film too */}
        <input ref={capRef} type="file" accept={card ? "image/*" : "image/*,video/*"} capture="environment" hidden onChange={(e) => fromInput(e, true)} />

        <div
          ref={setArea}
          className={cn("flex min-h-0 flex-1 justify-center", fullScreen ? "items-start" : "items-center px-2")}
          style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
          data-camera-full={fullScreen ? "" : undefined}
        >
          <div
            // the shot settles into the editor (opening and retaking snap straight to full screen)
            className={cn("relative shrink-0 touch-pan-y select-none overflow-hidden rounded-[22px] bg-zinc-900", phase === "edit" && "transition-[width,height] duration-300 ease-out")}
            style={{ width: box.w, height: box.h }}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerCancel={() => (swipe.current = null)}
          >
            {phase === "shoot" && (
              <video
                ref={setVideo}
                playsInline
                muted
                autoPlay
                // a post's card sits in the middle 4:5: the camera shows (dimmed) around it
                className={cn("absolute inset-0 h-full w-full object-cover", status === "live" && (!showCard || !story) ? "opacity-100" : "opacity-0", facing === "user" && "-scale-x-100")}
              />
            )}
            {/* a post on the camera: what's outside the post's 4:5 is dimmed (Instagram's post camera) */}
            {phase === "shoot" && !story && status === "live" && !adding && band.y > 1 && (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/60" style={{ height: band.y }} aria-hidden data-post-band="top" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60" style={{ height: Math.max(0, box.h - band.y - band.h) }} aria-hidden data-post-band="bottom" />
              </>
            )}
            {/* a plain post of clips: the first one, up front (a clip plays, muted, while you write the caption); drag it to choose what the feed shows */}
            {clip0?.video ? (
              story ? (
                <video key={clip0.video} src={clip0.video} poster={clip0.preview ?? undefined} muted loop autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" data-studio-clip />
              ) : (
                // (no grid-tile outline here: a clip's tile is its cover, shown for real in Edit cover)
                <FocusFramer size={{ w: clip0.w ?? 9, h: clip0.h ?? 16 }} frame={box} focus={clip0.focus ?? CENTRE_FOCUS} onFocus={(f) => tray.setFocus(clip0.id, f)}>
                  <video
                    key={clip0.video}
                    src={clip0.video}
                    poster={clip0.preview ?? undefined}
                    muted
                    loop
                    autoPlay
                    playsInline
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    style={{ objectPosition: focusPosition(clip0.focus) }}
                    data-studio-clip
                  />
                </FocusFramer>
              )
            ) : (
              clip0?.preview && <img src={clip0.preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {showCard && (
              <canvas
                ref={setCardEl}
                className="pointer-events-none absolute"
                style={phase === "shoot" ? { left: band.x, top: band.y, width: band.w, height: band.h } : { inset: 0, width: "100%", height: "100%" }}
                aria-label={card ? `${TEMPLATE_LABEL[card.look]} look` : undefined}
              />
            )}
            {/* the photo, framed: drag and pinch (a card on it: two fingers, one swipes the looks). Over the card, so its grid shows; the card paints the photo itself */}
            {phase === "edit" && shot && shotSize && (
              <PhotoFramer
                src={shotUrl}
                size={shotSize}
                frame={box}
                framing={framing}
                onFraming={setFraming}
                oneFinger={!showCard}
                showImage={!showCard}
                gridPreview={!story}
                flash={shapeFlash}
                onActive={setFramingLive}
                onClaim={() => (swipe.current = null)}
              />
            )}
            {/* the post's shape (4:5 / 1:1 / 16:9), Instagram's corner button */}
            {phase === "edit" && !story && shot && !showCard && (
              <button
                type="button"
                onClick={() => {
                  setAspect(nextAspect(aspect));
                  setShapeFlash((n) => n + 1);
                }}
                className="absolute bottom-2.5 left-2.5 z-[5] inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-black text-white backdrop-blur active:scale-95"
                aria-label={`Shape ${POST_ASPECT_LABEL[aspect]}. Tap for ${POST_ASPECT_LABEL[nextAspect(aspect)]}`}
                data-frame-shape={aspect}
              >
                {aspect === "portrait" ? <RectangleVertical className="h-4 w-4" /> : aspect === "square" ? <Square className="h-4 w-4" /> : <RectangleHorizontal className="h-4 w-4" />}
                {POST_ASPECT_LABEL[aspect]}
              </button>
            )}
            {/* a clip on a post: its cover (what shows before it plays, and on your profile grid) */}
            {phase === "edit" && !story && clip0?.video && clip0.status !== "error" && (
              <button
                type="button"
                onClick={() => setCoverFor(clip0.id)}
                className="absolute bottom-2.5 left-2.5 z-[5] inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-black text-white backdrop-blur active:scale-95"
                data-edit-cover
              >
                <Film className="h-4 w-4" /> Cover
              </button>
            )}

            {phase === "shoot" && status === "fallback" && (
              <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center", showCard && "bg-black/55 backdrop-blur-[2px]")} data-camera-fallback={oldApp ? "old-app" : camWhy ?? "other"}>
                {oldApp ? (
                  // the phone's camera would close this version of the app: update first, or pick a photo
                  <>
                    <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10">
                      <Camera className="h-9 w-9" />
                    </div>
                    <div className="text-[17px] font-black">Update JF Effect to use the camera</div>
                    <p className="max-w-[270px] text-[13px] text-white/75">This version of the app can't open the camera. Get the latest one in TestFlight and it opens right here.</p>
                    <button type="button" onClick={openTestFlight} className="h-11 rounded-full bg-white px-6 text-[15px] font-black text-black active:scale-95">
                      Update in TestFlight
                    </button>
                    <button type="button" disabled={!canShoot} onClick={() => libRef.current?.click()} className="text-[14px] font-bold text-white/80 underline-offset-4 active:underline disabled:opacity-40">
                      Choose a photo instead
                    </button>
                  </>
                ) : camWhy === "denied" && isNative() ? (
                  // switched off for the app: one tap to its Settings page (Android: back here, it retries by itself)
                  <>
                    <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10">
                      <Camera className="h-9 w-9" />
                    </div>
                    <div className="text-[17px] font-black">Camera is off for JF Effect</div>
                    <p className="max-w-[270px] text-[13px] text-white/75">
                      {/* iOS restarts an app when its camera permission changes, so it's "open it again", not "come back" */}
                      {getPlatform() === "ios" ? "Turn on Camera, then open Post again. From then on it opens right here." : "Allow the camera for JF Effect in your phone's settings and come back. It opens right here."}
                    </p>
                    {getPlatform() === "ios" && (
                      <button type="button" onClick={openAppSettings} className="h-11 rounded-full bg-white px-6 text-[15px] font-black text-black active:scale-95" data-camera-settings>
                        Turn on camera
                      </button>
                    )}
                    <button type="button" disabled={!canShoot} onClick={() => capRef.current?.click()} className="text-[14px] font-bold text-white/80 underline-offset-4 active:underline disabled:opacity-40">
                      Use the phone's camera instead
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={!canShoot} onClick={() => capRef.current?.click()} className="grid h-24 w-24 place-items-center rounded-full bg-white text-black shadow-xl active:scale-95 disabled:opacity-40" aria-label="Open the camera">
                      <Camera className="h-10 w-10" />
                    </button>
                    <div className="text-[15px] font-black">Take a photo</div>
                    <p className="max-w-[260px] text-[12px] text-white/70">The live camera didn't start here, so this opens your phone's camera.</p>
                  </>
                )}
              </div>
            )}

            {phase === "edit" && <StickerLayer items={items} setItems={setItems} width={box.w} height={box.h} context={stickerContext} request={request} />}

            {count != null && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span key={count} className="font-display animate-in zoom-in-50 fade-in text-[140px] leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]">{count}</span>
              </div>
            )}
            {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
            {/* a card on a photo: one finger swipes the looks, so moving the photo is two fingers (said once per shot) */}
            {pinchHint && (
              <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center" data-pinch-hint>
                <span className="animate-in fade-in rounded-full bg-black/55 px-3 py-1 text-[12px] font-bold backdrop-blur">Two fingers to move or zoom the photo</span>
              </div>
            )}
            {lookFlash && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span key={lookFlash} className="font-display animate-in fade-in zoom-in-95 rounded-2xl bg-black/35 px-5 py-2 text-[34px] uppercase leading-none backdrop-blur-sm">{lookFlash}</span>
              </div>
            )}
            {phase === "edit" && card && card.looks.length > 1 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5" aria-hidden>
                {card.looks.map((t) => (
                  <span key={t} className={cn("h-1.5 rounded-full transition-all", t === card.look ? "w-5 bg-white" : "w-1.5 bg-white/45")} />
                ))}
              </div>
            )}

            {/* Top bar, on the card */}
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-2.5">
              {phase === "shoot" ? (
                <>
                  {adding ? (
                    <button type="button" onClick={backToPost} className={pill} aria-label="Back to your post">
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                  ) : (
                    <button type="button" onClick={onClose} className={pill} aria-label="Close">
                      <X className="h-6 w-6" />
                    </button>
                  )}
                  {status === "live" && (
                    <button
                      type="button"
                      onClick={() => setTimer((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))}
                      className={cn("inline-flex h-11 items-center gap-1 rounded-full px-3 text-[13px] font-black backdrop-blur active:scale-95", timer ? "bg-white text-black" : "bg-black/40")}
                      aria-label={timer ? `Self-timer ${timer} seconds` : "Self-timer off"}
                    >
                      <Timer className="h-5 w-5" />
                      {timer ? `${timer}s` : null}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {canShoot && !adding && (card && allowNoPhoto ? (
                      <button type="button" onClick={skipPhoto} className="h-10 rounded-full bg-black/40 px-4 text-[13px] font-bold backdrop-blur active:scale-95">
                        No photo
                      </button>
                    ) : onWrite && !story ? (
                      <button type="button" onClick={onWrite} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-black/40 px-4 text-[13px] font-bold backdrop-blur active:scale-95">
                        <PenLine className="h-4 w-4" /> Write
                      </button>
                    ) : null)}
                    {/* up here (Snapchat / TikTok's spot) so every mode fits along the bottom; double-tap the camera flips too */}
                    {status === "live" && (
                      <button type="button" onClick={flip} className={pill} aria-label="Flip camera">
                        <RefreshCcw className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <button type="button" onClick={retake} className={pill} aria-label={shot ? "Retake" : "Back to the camera"}>
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  {/* text and stickers go on a card or a photo (never on a clip) */}
                  {(card || shot) && (
                    <>
                      <button type="button" onClick={() => setRequest({ kind: "text", n: Date.now() })} className={cn(pill, "ml-auto")} aria-label="Add text">
                        <Type className="h-5 w-5" />
                      </button>
                      <button type="button" onClick={() => setRequest({ kind: "stickers", n: Date.now() })} className={pill} aria-label="Add a sticker">
                        <Smile className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: shoot controls over the camera's foot (Instagram's), or caption + post */}
        <div
          className={phase !== "shoot" ? "shrink-0 px-4 pt-2.5" : fullScreen ? "pointer-events-none absolute inset-x-0 bottom-0 z-10" : "shrink-0 pt-2"}
          style={phase === "shoot" ? undefined : { paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
          data-camera-controls={phase === "shoot" ? (fullScreen ? "over" : "under") : undefined}
        >
          {adding ? (
            <div className="mb-2.5 flex justify-center">
              <span className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-black/45 px-3.5 text-[12px] font-bold backdrop-blur">
                Adding slide {tray.total + 1} of up to {MAX_SLIDES}
              </span>
            </div>
          ) : (
            // (hidden while filming: the clip's timer sits there)
            chip && !recorder.recording && (
              <div className="pointer-events-none mb-2 flex justify-center px-4">
                {/* over the camera it needs a backing to read on any picture */}
                <div className={cn("pointer-events-auto max-w-full rounded-full", phase === "shoot" && fullScreen && "bg-black/45 backdrop-blur-md")}>{chip}</div>
              </div>
            )
          )}
          {phase === "shoot" ? (
            <>
              <div className="pointer-events-auto">
                {/* first time on a plain post's camera: how to film, until the first clip */}
                {recordable && !recorder.recording && hints.data && !hints.data.includes("hold_to_film") && (
                  <div className="pointer-events-none mb-1 text-center text-[12px] font-bold text-white/80 [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]" data-hold-hint>
                    Tap for a photo, hold for video
                  </div>
                )}
                <LookCarousel
                  // the whole row of filters (Normal, meal, lock in, workout), else this card's looks
                  looks={filters ?? lookItems(card?.looks)}
                  look={filters ? (filter ?? null) : (card?.look ?? null)}
                  onLook={(k) => (filters ? onFilter?.(k) : card?.onLook(k as ShareTemplate))}
                  onShoot={shoot}
                  disabled={!canShoot}
                  counting={count != null}
                  showName={fullScreen}
                  hold={
                    recordable || recorder.recording
                      ? { onStart: () => void recorder.start(), onEnd: recorder.release, progress: recorder.recording ? recorder.progress : null, seconds: recorder.seconds }
                      : undefined
                  }
                />
              </div>
              {/* under the camera: the library, then everything you can share, all in view */}
              <div ref={setBarEl} className="pointer-events-auto mt-2 flex items-center gap-2 bg-black px-4 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.6rem)" }} data-camera-bar>
                <button type="button" disabled={!canShoot} onClick={() => libRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-white/85 bg-white/10 active:scale-95 disabled:opacity-30" aria-label="Choose from your library">
                  <Images className="h-5 w-5" />
                </button>
                <div className="flex min-w-0 flex-1 justify-center">
                  {/* what you're making: Post or Story (Instagram's row); the filters are the circles above */}
                  {storyable && !adding && !recorder.recording && <ModeTabs modes={KINDS} mode={kind} onMode={(k) => pickKind(k as ShareKind)} />}
                </div>
                {/* keeps the row's middle under the shutter */}
                <span className="h-11 w-11 shrink-0" aria-hidden />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {/* a story is one picture with its words on it: no slides, caption, GIF or voice memo */}
              {!story && (
                <>
                  <SlideTray
                    tray={tray}
                    hasCover={!!card || !!shot}
                    cover={coverThumb}
                    onCamera={() => {
                      setAdding(true);
                      setPhase("shoot");
                    }}
                    onLibrary={() => libRef.current?.click()}
                  />
                  <AttachPreview a={att} dark />
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <CaptionField value={caption} onOpen={openCaption} />
                    </div>
                    <AttachButtons a={att} dark />
                  </div>
                  <AttachGifPicker a={att} />
                </>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!!busy || (!card && !shot)}
                  onClick={() => void doSave()}
                  className="grid h-14 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 active:scale-[0.97] disabled:opacity-60"
                  aria-label="Save image"
                >
                  {busy === "save" ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Download className="h-6 w-6" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVisibility(audList[(audList.indexOf(audBase) + 1) % audList.length].key);
                    setPosted(false);
                  }}
                  className="inline-flex h-14 shrink-0 items-center gap-1.5 rounded-2xl bg-white/10 px-3 text-[13px] font-black active:scale-95"
                  aria-label={`Who sees it: ${aud.label}. Tap to change`}
                >
                  <AudIcon className="h-4 w-4" /> {aud.label}
                </button>
                {post?.showHideLoads && !story && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!hideLoads) toast.message("Weights hidden", { description: "Your post will be just the photo, no numbers." });
                      setHideLoads(!hideLoads);
                      setPosted(false);
                    }}
                    className={cn("grid h-14 w-12 shrink-0 place-items-center rounded-2xl active:scale-95", hideLoads ? "bg-white text-black" : "bg-white/10")}
                    aria-label={hideLoads ? "Weights hidden. Tap to show" : "Hide my weights"}
                    aria-pressed={hideLoads}
                  >
                    <EyeOff className="h-5 w-5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!busy || posted || !post || !hasContent || att.recorder.recording}
                  onClick={() => void doPost()}
                  className={cn(
                    // the app's own primary button: JF red, solid
                    "inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl text-[16px] font-black shadow-lg shadow-primary/25 active:scale-[0.98] disabled:opacity-100",
                    posted ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground",
                    !post && "opacity-60",
                  )}
                >
                  {posted ? <Check className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                  {busy === "post"
                    ? tray.uploading
                      ? `Uploading ${tray.items.length - tray.uploading + 1}/${tray.items.length}…`
                      : "Posting…"
                    : posted
                      ? story
                        ? "Shared"
                        : "Posted"
                      : story
                        ? "Your story"
                        : (post?.label ?? "Post")}
                </button>
              </div>
            </div>
          )}
        </div>
        {coverFor && (() => {
          const it = tray.items.find((x) => x.id === coverFor);
          if (!it?.video) return null;
          return (
            <CoverPicker
              src={it.video}
              size={{ w: it.w ?? 9, h: it.h ?? 16 }}
              aspect={feedAspect(it.w, it.h)}
              focus={it.focus ?? CENTRE_FOCUS}
              onCancel={() => setCoverFor(null)}
              onDone={(cover, focus) => {
                if (cover) tray.setCover(it.id, cover);
                tray.setFocus(it.id, focus);
                setCoverFor(null);
                setPosted(false);
              }}
            />
          );
        })()}
        {captioning && (
          <CaptionEditor
            value={caption}
            onChange={(v) => {
              setCaption(v);
              setPosted(false);
            }}
            onDone={() => setCaptioning(false)}
            thumb={thumb}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What you're making, under the camera like Instagram's POST / STORY: every
 * one is in view; only a screen too narrow for them all scrolls, and then it
 * keeps the one you're on in view.
 */
function ModeTabs({ modes, mode, onMode }: { modes: CameraMode[]; mode?: string; onMode: (key: string) => void }) {
  const row = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setOver(el.scrollWidth > el.clientWidth + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = row.current;
    const on = el?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!el || !on || el.scrollWidth <= el.clientWidth + 1) return;
    on.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [mode]);
  return (
    <div
      ref={row}
      className={cn("min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", over && "[mask-image:linear-gradient(90deg,#000_88%,transparent)]")}
      role="tablist"
      aria-label="Post or story"
      data-modes-over={over ? "" : undefined}
    >
      <div className="mx-auto flex w-max">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => onMode(m.key)}
            className={cn("h-10 shrink-0 px-[6px] text-[12px] font-black uppercase tracking-[0.06em] transition-colors min-[375px]:px-[7px] min-[375px]:text-[13px] min-[385px]:px-2 min-[420px]:px-3", mode === m.key ? "text-white" : "text-white/50")}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
