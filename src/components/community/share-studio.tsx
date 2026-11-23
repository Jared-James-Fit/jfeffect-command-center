import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNoAutoZoom } from "@/hooks/use-no-auto-zoom";
import { AtSign, Camera, Check, ImageOff, SlidersHorizontal, Zap, ZapOff, Expand, Shrink, ChevronLeft, Download, EyeOff, Film, Images, Lock, PenLine, RectangleHorizontal, RectangleVertical, RefreshCcw, Scissors, Send, Smartphone, Smile, Square, Star, Timer, Type, User, Users, Volume2, VolumeX, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { pickerAudience, type CommunityAuthor, type CommunityVisibility } from "@/lib/community";
import { useFollowState } from "@/lib/community-social";
import { TEMPLATE_LABEL, canvasToBlob, cardLogo, ensureDisplayFont, shareCardImage, type ShareCardData, type ShareCardMedia, type ShareFormat, type ShareTemplate } from "@/lib/workout-share-card";
import { CaptionEditor, CaptionField, captionThumb } from "@/components/community/caption-editor";
import { AttachButtons, AttachGifPicker, AttachPreview, usePostAttach, type PostAttachInitial } from "@/components/community/post-attach";
import { SlideTray, useSlideTray, type TrayItem } from "@/components/community/slide-tray";
import { MAX_SLIDES, type PostSlide } from "@/lib/community";
import { StickerLayer, drawStickers, SHARE_CARD_ID, mentionStickerItem, responseCardItem, type StickerItem, type StickerRequest } from "@/components/community/sticker-layer";
import { TagPeopleSheet } from "@/components/community/tag-people-sheet";
import { tagHandle, uniqueTags, withTags } from "@/lib/crew-tags";
import { paintReplyBackdrop } from "@/lib/story-reply";
import { StickerEditorSheet } from "@/components/community/sticker-editor";
import { StickerPreview } from "@/components/community/story-sticker";
import { STICKER_Y_MAX, STICKER_Y_MIN, stickerY, type StickerSpec, type StickerType } from "@/lib/lessons";
import { setPostSticker } from "@/lib/lessons.queries";
import { context2d, releaseCanvas } from "@/lib/canvas-memory";
import { clearDraft, draftWorthKeeping, loadDraft, saveDraft } from "@/lib/post-draft";
import { getPlatform, iosAppTooOldForCamera, isNative, openAppSettings, openTestFlight } from "@/platform";
import { reportCameraTrouble } from "@/lib/camera-report";
import { LookCarousel, lookItems, type LookGroup, type LookItem } from "@/components/community/look-carousel";
import { canRecordClips, useClipRecorder } from "@/components/community/clip-recorder";
import { readFilmSettings } from "@/lib/camera/film-settings";
import { studioCameraAsk, takePrimedCamera } from "@/lib/camera/camera-prime";
import { createCommunityPost, useHintsSeen, useMarkHintSeen } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import {
  CENTRED,
  POST_ASPECTS,
  POST_ASPECT_LABEL,
  STORY_ASPECT,
  storyCanFit,
  storyStartsWhole,
  wholeRect,
  startAspect,
  framingFromGuide,
  slideAspect,
  guideBand,
  nextAspect,
  type Framing,
  type PostAspect,
} from "@/lib/photo-frame";
import { drawableSize, framedCanvas, lightCopy, wholeStoryCanvas, type Drawable } from "@/lib/photo-frame-draw";
import { FilterPanel } from "@/components/community/filter-panel";
import { ShareOutSheet } from "@/components/community/share-out-sheet";
import { JF_HANDLE, promoLine, shareFileName, workoutShareCaption } from "@/lib/share-out";
import { GradedLayer } from "@/components/community/graded-layer";
import { statsFor, useGradeSource, loadGradeSource } from "@/components/community/use-grade-source";
import { useFilterDefaults } from "@/lib/media-filter-prefs";
import { compiledFor, type MediaGrade } from "@/lib/media-grade";
import { sharedGradeGL } from "@/lib/media-grade-gl";
import { PhotoFramer } from "@/components/community/photo-framer";
import { CoverPicker } from "@/components/community/cover-picker";
import { TrimmedVideo } from "@/components/video-trimmer";
import { useSoundFlash } from "@/components/community/clip-gestures";
import { CAMERA_MODES, ModeSelector } from "@/components/community/mode-selector";
import { DiscardConfirm } from "@/components/community/discard-confirm";
import { phoneLayoutNow } from "@/lib/portrait-only";
import { CAMERA_ENTER_EVENT, CAMERA_LEAVE_EVENT } from "@/lib/swipe-to-create";
import { SCREEN_FLASH_MS, TORCH_SETTLE_MS, switchTorch, torchSupported } from "@/lib/camera/torch";
import { preloadMediaTools } from "@/lib/community-media";
import { formatClock, type VideoContext } from "@/lib/video-edit/limits";
import { feedback } from "@/lib/feedback";
import { paintCard } from "@/components/community/card-paint";

/**
 * What you're making, along the bottom like Instagram's POST / STORY: a post
 * (the feed and your profile grid, 9:16 to fill its screen in the Crew feed,
 * or 4:5 / 1:1 / 16:9) or a story (24h in the story rail, 9:16). The filters (Normal, a meal's looks, a lock in's,
 * a workout's) are the circles around the shutter.
 */
export type ShareKind = "post" | "story";
/** How long the camera takes to slide back out to the feed. */
const LEAVE_MS = 280;
/** How long the camera takes to come in from the left (the + and Your story). */
const ENTER_MS = 320;
/** How long the rail's names show before it folds to icons. */
const RAIL_LABELS_MS = 2600;
const SLIDE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/** A card in a post fills its screen (9:16, the "full" card), or the feed's 4:5 when picked. */
const FEED_CARD_ASPECT = 4 / 5;

/** The card painted on the viewfinder; swipe sideways to change the look. */
export type CameraCard = {
  data: Omit<ShareCardData, "media" | "template">;
  looks: ShareTemplate[];
  look: ShareTemplate;
  onLook: (t: ShareTemplate) => void;
  /**
   * A story filter's own painter (story-filters.ts) in place of the share
   * card's: the picture (`media`, the camera or the frozen shot) and the
   * filter on it, at the format's size × `scale`.
   */
  paint?: (canvas: HTMLCanvasElement, media: ShareCardMedia | null, format: ShareFormat | { w: number; h: number }, scale: number, logo: HTMLImageElement | null) => void;
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
  /**
   * A finished workout: a post to anyone but them needs a photo or clip of
   * their own (Crew is what people post, not an activity log); the card on
   * its own can still go on their story (community_save_post refuses it too).
   */
  needsMedia?: boolean;
};

/** A reply to a question response (ShareStudio's `reply`). */
export type StudioReply = { question: string; answer: string; onPosted: (postId: string) => Promise<void> };
/** Add to your story (ShareStudio's `share`): the post it shares and its card (null while it's drawn). */
export type StudioShare = { postId: string; item: StickerItem | null };

type Shot = { src: HTMLCanvasElement | HTMLImageElement; file: File | null; live: boolean; at: Date };
/** Who can see a story: the crew (followers, on a private account) or Close friends. */
const STORY_AUDIENCE: CommunityVisibility[] = ["community", "close_friends"];

const CARD_W = 1080;
const CARD_H = 1920;
const LIVE_SCALE = 0.72;
const FRAME_MS = 33;
/** A finger resting this long on the picture being edited is a peek under the filter row. */
const PEEK_MS = 180;
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
 * at its shape (9:16 to start, filling its screen in the Crew feed: the
 * camera shows all of it; then drag and pinch, with a rule-of-thirds grid
 * while your finger's on it, and 4:5 / 1:1 / 16:9 a tap away)
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
  videoContext = "post",
  startAs = "post",
  onKind,
  reply = null,
  share = null,
  filterGroups,
  onPostFlow,
  tagPeople = false,
  entry = "pop",
  modeFrom = null,
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
  /** Where a post's clips go (a workout recap: 90 s; a post: 3 min; on Story always 60 s). Longer ones are trimmed first. */
  videoContext?: VideoContext;
  /** What it opens on: a post, or (from Your story) a story. */
  startAs?: ShareKind;
  /** Post or Story, as it opens and whenever it's switched (the caller's default filter follows it). */
  onKind?: (kind: ShareKind) => void;
  /**
   * Replying to a question response with a story (Instagram's Share
   * response): opens on Story, on a backdrop with the response card on it
   * and the text tool open; posting hands the new story to `onPosted`.
   */
  reply?: StudioReply | null;
  /**
   * Add to your story (Instagram's, from a post's ✈️): opens on Story, on a
   * backdrop with the post's card on it; the story keeps which post it shares.
   */
  share?: StudioShare | null;
  /** The chips over the filters (story-filters.ts' groups), in the row's order. */
  filterGroups?: LookGroup[];
  /** Post is its own screen (PostComposer, Instagram's New post): tapping Post here goes there. */
  onPostFlow?: () => void;
  /** A story can tag people: an @ sticker on it, and the tag on the story (tappable for the crew). */
  tagPeople?: boolean;
  /**
   * How it comes in: "slide" from the left on a phone (the camera sits left of
   * the feed, where Crew's + is), "fade" in place (switched to from the New
   * post screen), "none" (the feed's swipe already slid its stand-in in),
   * "pop" (everything else).
   */
  entry?: "pop" | "slide" | "fade" | "none";
  /** The mode the last screen was on (Post): the selector opens there and slides to Story. */
  modeFrom?: ShareKind | null;
}) {
  // No iOS focus-zoom anywhere in the studio: it left the editor zoomed and off-centre.
  useNoAutoZoom(open);
  const [phase, setPhase] = useState<"shoot" | "edit">("shoot");
  // POST or STORY (the row under the camera)
  const [kind, setKind] = useState<ShareKind>(startAs);
  const story = kind === "story";
  const onKindRef = useRef(onKind);
  onKindRef.current = onKind;
  useEffect(() => {
    if (open) onKindRef.current?.(kind);
  }, [open, kind]);
  // a post's photo: its shape and how it sits in it (baked in when it's posted)
  const [aspect, setAspect] = useState<PostAspect>("full");
  // the shape was picked by hand: the first photo or clip no longer sets it
  const aspectPicked = useRef(false);
  // the slide being framed in the editor (a photo or clip in the strip); null: slide 1
  const [sel, setSel] = useState<string | null>(null);
  const [framing, setFraming] = useState<Framing>(CENTRED);
  // a finger is on it: the card repaints at preview quality until it lifts
  const [framingLive, setFramingLive] = useState(false);
  // the photo's filter (media-grade.ts), its panel, and a finger on one of its sliders (the card repaints lighter)
  const [shotGrade, setShotGrade] = useState<MediaGrade | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [gradeLive, setGradeLive] = useState(false);
  // a story's photo shown whole over a blur of itself (storyStartsWhole), else filling the story
  const [shotWhole, setShotWhole] = useState(false);
  const { defaults: filterDefaults, setDefault: setFilterDefault } = useFilterDefaults(open);
  const defaultsRef = useRef(filterDefaults);
  defaultsRef.current = filterDefaults;
  const [shapeFlash, setShapeFlash] = useState(0);
  // the clip on the stage plays with its sound once the speaker turned it on (a tap: the phone allows it)
  const [hear, setHear] = useState(false);
  const [soundFlash, flashSound] = useSoundFlash();
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
  // the flash: the back camera's light when it has one, the screen itself for a selfie; never offered where it can't fire
  const [flashOn, setFlashOn] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const torchOn = useRef(false);
  // leaving: the camera slides back out the way it came (the feed's on its right)
  const [leaving, setLeaving] = useState(false);
  // a words story (the rail's Type, Instagram's Create): words on a colour, posted as the story's picture
  const [typed, setTyped] = useState(false);
  // the rail's labels show as it opens, then fold to icons (Instagram's)
  const [railLabels, setRailLabels] = useState(true);
  useEffect(() => {
    if (!open || phase !== "shoot") return;
    setRailLabels(true);
    const t = window.setTimeout(() => setRailLabels(false), RAIL_LABELS_MS);
    return () => window.clearTimeout(t);
  }, [open, phase]);
  // the one question before work is thrown away
  const [discard, setDiscard] = useState<null | { title: string; body: string; action: string; run: () => void }>(null);
  // (posting leaves the same way, from its own callbacks)
  const leaveRef = useRef<() => void>(() => undefined);
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [count, setCount] = useState<number | null>(null);
  const [lookFlash, setLookFlash] = useState<string | null>(null);
  const [cardFailed, setCardFailed] = useState(false);
  const [items, setItems] = useState<StickerItem[]>([]);
  const [request, setRequest] = useState<StickerRequest>(null);
  // a story's tags: the people on it (their @ sticker on a photo, the tag itself on the story's caption)
  const [tags, setTags] = useState<CommunityAuthor[]>([]);
  const [tagging, setTagging] = useState(false);
  // a tag's sticker binned: they're untagged too
  const mentionIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(items.filter((i) => i.mention).map((i) => i.mention!.userId));
    const gone = [...mentionIds.current].filter((id) => !now.has(id));
    mentionIds.current = now;
    if (gone.length) setTags((t) => t.filter((a) => !gone.includes(a.user_id)));
  }, [items]);
  // replying to a response: which backdrop colour it's on
  const [backdrop, setBackdrop] = useState(0);
  // a story's live sticker (Questions, Poll, Slider): shown where it'll sit, put on once the story's up
  const [live, setLive] = useState<StickerSpec | null>(null);
  const [liveForm, setLiveForm] = useState<StickerSpec | null>(null);
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
  // a story's clip runs up to 60 s (switching to Story with a longer one opens the trimmer on it)
  const tray = useSlideTray({ open, initial: post?.extras, resetKey: post?.key ?? "", coverCount: card || shot ? 1 : 0, videoContext: story ? "story" : videoContext });
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
    setKind(startAs);
    setLeaving(false);
    setDiscard(null);
    setTyped(false);
    setRailLabels(true);
    setFlashOn(false);
    setScreenFlash(false);
    setAspect("full");
    aspectPicked.current = false;
    setSel(null);
    setFraming(CENTRED);
    setCoverFor(null);
    setLive(null);
    setLiveForm(null);
    setTags([]);
    setTagging(false);
    if (reply) {
      // straight into the editor: the backdrop, the response card on it, the keyboard up for the answer
      setKind("story");
      setBackdrop(0);
      freeze({ src: paintReplyBackdrop(0), file: null, live: false, at: new Date() });
      setItems([responseCardItem(reply.question, reply.answer)]);
      setRequest({ kind: "text", n: Date.now() });
    } else if (share) {
      // the post's card on a backdrop, ready to write on or post as it is
      setKind("story");
      setBackdrop(0);
      freeze({ src: paintReplyBackdrop(0), file: null, live: false, at: new Date() });
      if (share.item) setItems([share.item]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Add to your story: the post's card lands once it's drawn (its pictures load first)
  const shareItem = share?.item ?? null;
  useEffect(() => {
    if (!open || !shareItem) return;
    setItems((cur) => (cur.some((i) => i.id === shareItem.id) ? cur : [shareItem, ...cur]));
  }, [open, shareItem]);
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
    if (!open || !post || reply || share || restoredFor.current === post.key) return;
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
    if (!open || !post || reply || share || posted || busy || draftOff.current || restoring.current) return;
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
  // The editor's frame is what's posted: a story's 9:16; a post's card, 9:16
  // filling its screen in the Crew feed (or the feed's 4:5, picked with the
  // shape button: a card is drawn at those two only); any other post, the one
  // shape every slide takes (9:16 / 4:5 / 1:1 / 16:9, Instagram's carousel
  // rule), 9:16 to start and set from its first photo or clip until it's
  // picked by hand (startAspect). The camera is 9:16.
  const clip0 = phase === "edit" && !card && !shot ? tray.items[0] ?? null : null;
  // a story's clip: whole over a blur of itself when it's much wider or taller than the story, else filling it (Fill / Fit switches)
  const clipWhole = !!clip0 && (clip0.whole ?? storyStartsWhole({ w: clip0.w ?? 9, h: clip0.h ?? 16 }));
  const cardPost = !!card && !cardFailed;
  const cardShape: "full" | "portrait" = aspect === "portrait" ? "portrait" : "full";
  const frameAspect = story ? STORY_ASPECT : cardPost ? (cardShape === "portrait" ? FEED_CARD_ASPECT : STORY_ASPECT) : POST_ASPECTS[aspect];
  // a post with nothing up front (no card, no photo): its first photo or clip sets the shape (one already on
  // the post, being edited: the shape it shows at, so what's added matches it)
  const first = !card && !shot ? tray.items[0] : undefined;
  const firstShape = first ? (first.existing && first.slide ? slideAspect(first.slide) : first.w && first.h ? first.w / first.h : null) : null;
  useEffect(() => {
    if (aspectPicked.current || !firstShape) return;
    setAspect(startAspect(firstShape, 1));
  }, [firstShape]);
  // The slide being framed: the one picked in the strip, else (no card or photo up front) the first.
  // Only a photo or clip picked now can be framed (one already on the post stays as it is).
  const framable = (it: TrayItem | undefined | null): it is TrayItem =>
    !!it && !it.existing && it.status !== "error" && !!it.w && !!it.h && (it.kind === "image" ? !!it.preview : !!it.video);
  const selItem =
    phase === "edit" && !story ? ((sel ? tray.items.find((x) => x.id === sel && framable(x)) : null) ?? (!card && !shot ? (tray.items.find(framable) ?? null) : null)) : null;
  // the shape's button: a post's photo or slide being framed (a card goes 9:16 ↔ 4:5, the two it's drawn at)
  const shapeable = phase === "edit" && !story && (!!shot || !!selItem) && !(cardPost && (adding || !!selItem));
  const shapeOf = (a: PostAspect): PostAspect => (cardPost && !selItem ? (a === "portrait" ? "full" : "portrait") : nextAspect(a));
  const shownShape: PostAspect = cardPost && !selItem ? cardShape : aspect;
  const coverClip = selItem?.kind === "video" ? selItem : null;
  // the clip goes as just its lift: cut with the chip (held to the post's limit, so maybe a moment shorter), or in the trimmer
  const liftOn =
    !!coverClip?.lift &&
    (coverClip.liftBefore !== undefined ||
      (!!coverClip.trim && Math.abs(coverClip.trim.start - coverClip.lift.start) < 0.06 && Math.abs(coverClip.trim.end - coverClip.lift.end) < 0.06));
  const trimClip = story ? (clip0?.video && clip0.status !== "error" ? clip0 : null) : coverClip;
  const boxAspect = phase === "shoot" ? CARD_W / CARD_H : frameAspect;
  const box = useMemo(() => {
    const w = fullScreen ? areaSize.w : Math.min(areaSize.w, areaSize.h * boxAspect);
    return { w: Math.floor(w), h: Math.floor(w / boxAspect) };
  }, [areaSize, fullScreen, boxAspect]);
  // a post on the camera: the part of it the post's shape keeps (the rest is dimmed), what the photo starts framed as;
  // at 9:16 (where a post starts) that's the whole camera
  const guideAspect = story ? STORY_ASPECT : cardPost ? (cardShape === "portrait" ? FEED_CARD_ASPECT : STORY_ASPECT) : POST_ASPECTS[aspect];
  const band = useMemo(() => (story ? { x: 0, y: 0, w: box.w, h: box.h } : guideBand(box, guideAspect)), [story, box, guideAspect]);
  // a story's card; a post's full-screen card (its words clear of the feed's bars and buttons), or the feed's 4:5
  const cardFormat: ShareFormat = story ? "story" : cardShape === "portrait" ? "feed" : "full";

  /* ---- camera ------------------------------------------------------- */
  const cancelCount = () => {
    if (countRef.current) clearInterval(countRef.current);
    countRef.current = null;
    setCount(null);
  };
  const stop = () => {
    cancelCount();
    torchOn.current = false;
    setTorchOk(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Drop the element's hold on the stream too, so the camera light goes off.
    if (video) video.srcObject = null;
  };

  const shooting = open && phase === "shoot" && !reply && !share;
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
      { video: studioCameraAsk(facing), audio: false },
      { video: { facingMode: facing }, audio: false },
      { video: true, audio: false },
    ];
    const openCamera = async (): Promise<MediaStream> => {
      let last: unknown = null;
      // The tap that opened the studio may have asked already (camera-prime.ts): on an iPhone only a
      // request from a tap reuses an "Allow" once the camera's been off a minute, so that answer is taken.
      const primed = takePrimedCamera(studioCameraAsk(facing));
      if (primed && "released" in primed) await primed.released;
      for (const [i, ask] of asks.entries()) {
        try {
          if (i === 0 && primed && "stream" in primed) return await primed.stream;
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
        setTorchOk(torchSupported(stream.getVideoTracks()[0]));
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
  // Editing a picture: the camera's own row of filters over its foot (chips, the ring, the name), so a
  // photo you took or picked is changed exactly the way the camera picks one. A story's photo walks the
  // whole row; otherwise a card's looks. Never on a clip, a reply's or a shared post's backdrop.
  const editRing: { looks: LookItem[]; look: string | null; onLook: (k: string) => void; groups?: LookGroup[] } | null =
    phase !== "edit" || reply || share || typed || adding || selItem || enhancing
      ? null
      : story && !!shot && filters && filters.length > 1 && onFilter
        ? { looks: filters, look: filter ?? null, onLook: onFilter, groups: filterGroups }
        : card && !cardFailed && card.looks.length > 1
          ? { looks: lookItems(card.looks)!, look: card.look, onLook: (k) => card.onLook(k as ShareTemplate) }
          : null;
  // it steps aside while a finger rests on the picture (a peek at what's under it), frames it, or drags a sticker to the bin
  const [peek, setPeek] = useState(false);
  const [stickerDrag, setStickerDrag] = useState(false);
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
        // a post's card is 9:16 like a story's (its words clear of the feed's bars and buttons), or 4:5 in the middle of the camera
        paintCard(cardEl, c, media, cardFormat, lockedIn, logo, LIVE_SCALE);
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
  const shotCompiled = compiledFor(shotGrade);
  /** The photo as it goes under a card or posts: whole over its blur (a story's, when picked) or framed; its filter on it. */
  const shotMedia = (src: Drawable, aspect: number, width: number) =>
    story && shotWhole && Math.abs(aspect - STORY_ASPECT) < 0.01 ? wholeStoryCanvas(src, width, shotCompiled) : framedCanvas(src, framing, aspect, width, shotCompiled);
  // a clip's filter is previewed by the GPU and re-encoded into it: only offered where WebGL is there
  const gradeGpu = useMemo(() => typeof window !== "undefined" && !!sharedGradeGL(), []);
  // what Enhance works on: the photo up front, or a story's clip (one this phone can re-encode)
  const enhanceTarget: "shot" | "clip" | null =
    phase !== "edit" || reply || share || typed || adding || selItem
      ? null
      : shot
        ? "shot"
        : story && clip0?.video && clip0.canGrade !== false && !clip0.existing && gradeGpu
          ? "clip"
          : null;
  // Fill / Fit: only on a story whose picture isn't already its shape
  const fitTarget: "whole" | "fill" | null =
    phase !== "edit" || !story || reply || share || adding
      ? null
      : shot && shotSize
        ? storyCanFit(shotSize)
          ? shotWhole
            ? "whole"
            : "fill"
          : null
        : !shot && clip0?.video && clip0.w && clip0.h && storyCanFit({ w: clip0.w, h: clip0.h })
          ? clipWhole
            ? "whole"
            : "fill"
          : null;
  useEffect(() => {
    if (!enhanceTarget) setEnhancing(false);
  }, [enhanceTarget]);
  // a new clip or slide starts with the person's default filter (stories' for a story, posts' otherwise)
  const defaulted = useRef(new Set<string>());
  useEffect(() => {
    const d = filterDefaults[story ? "story" : "post"];
    for (const it of tray.items) {
      if (defaulted.current.has(it.id)) continue;
      if (it.existing || it.grade !== undefined || !d || it.canGrade === false || (it.kind === "video" && !gradeGpu)) {
        defaulted.current.add(it.id);
        continue;
      }
      if (!it.preview) continue;
      defaulted.current.add(it.id);
      void loadGradeSource(it.preview).then((r) => tray.setGrade(it.id, { ...d, stats: r?.stats ?? null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tray.items, filterDefaults, story]);

  // Frozen: the card over the photo as it's framed, full res once a finger lifts.
  useEffect(() => {
    if (phase !== "edit" || !cardEl || !card || !logo) return;
    let raf = 0;
    raf = requestAnimationFrame(() => {
      const quick = framingLive || gradeLive;
      const media = shot ? shotMedia(quick && light ? light.src : shot.src, frameAspect, quick ? 540 : 1080) : null;
      try {
        paintCard(cardEl, card, media, cardFormat, frozenLockedIn(card.data), logo, quick ? 0.6 : 1);
      } catch {
        setCardFailed(true);
      } finally {
        releaseCanvas(media);
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cardEl, card?.look, card?.data, card?.paint, shot, logo, framing, framingLive, cardFormat, frameAspect, shotGrade, gradeLive, shotWhole]);

  const changeLook = (dir: 1 | -1) => {
    // on the camera, a swipe walks the whole row of filters (Normal, meal, lock in, workout); a story's
    // photo, after the shot, too (Instagram's: swipe the filters over what you took)
    if ((phase === "shoot" || (story && !!shot && !reply && !share)) && filters && filters.length > 1 && onFilter) {
      const i = Math.max(0, filters.findIndex((f) => f.key === filter));
      const next = filters[(i + dir + filters.length) % filters.length];
      onFilter(next.key);
      if (phase === "edit") {
        feedback("detent");
        // the ring under it says which (and glides there)
        if (!editRing) setLookFlash(next.label);
      }
      return;
    }
    if (!card || card.looks.length < 2) return;
    const i = Math.max(0, card.looks.indexOf(card.look));
    const next = card.looks[(i + dir + card.looks.length) % card.looks.length];
    card.onLook(next);
    // shooting, the looks' row shows it; editing, the ring does too (else a quick name on the card)
    if (phase === "edit" && !editRing) setLookFlash(TEMPLATE_LABEL[next]);
  };
  useEffect(() => {
    if (!lookFlash) return;
    const t = setTimeout(() => setLookFlash(null), 900);
    return () => clearTimeout(t);
  }, [lookFlash]);
  const [pinchHint, setPinchHint] = useState(false);
  // a story's photo walks the filters with one finger (so moving it is two), card or not
  const storySwipe = story && !!filters && filters.length > 1 && !!onFilter && !reply && !share;
  const hasCard = !!card || storySwipe;
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
    // a new photo starts with the person's default filter (Auto reads this photo); a story's wide or tall one starts whole
    const d = defaultsRef.current[story ? "story" : "post"];
    setShotGrade(d && !reply && !share ? { ...d, stats: statsFor(s.src as Drawable) } : null);
    setShotWhole(story && !reply && !share && storyStartsWhole(drawableSize(s.src as Drawable)));
    // the camera's shot was framed by its guide (the post's shape: 9:16 to start); a photo from the library starts at 9:16
    // when it's upright, else the shape closest to its own (startAspect)
    const own = drawableSize(s.src as Drawable);
    if (!s.live) {
      setAspect(startAspect(own.w, own.h));
      aspectPicked.current = false;
    }
    setSel(null);
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
    // framed the way the camera showed it: the post's part of it (with a card on it, the card's own framing: centred)
    const view = { w: box.w, h: box.h };
    freeze({ src: c, file: null, live: true, at: new Date() }, card ? CENTRED : framingFromGuide({ w: c.width, h: c.height }, view, { w: band.w, h: band.h }));
  };
  const backToPost = () => {
    cancelCount();
    setAdding(false);
    setPhase("edit");
  };
  /** The camera's light on or off for a moment (a photo) or a clip (filming). */
  const torch = (on: boolean) => {
    if (on === torchOn.current) return Promise.resolve(on);
    torchOn.current = on;
    return switchTorch(streamRef.current?.getVideoTracks()[0], on);
  };
  /** The photo, with the flash when it's on: the back camera's light a moment first, or the screen white for a selfie. */
  const snap = () => {
    if (!flashOn || status !== "live") return capture();
    if (facing === "user") {
      setScreenFlash(true);
      window.setTimeout(() => {
        capture();
        window.setTimeout(() => setScreenFlash(false), 90);
      }, SCREEN_FLASH_MS);
      return;
    }
    if (!torchOk) return capture();
    void torch(true).then((on) =>
      window.setTimeout(
        () => {
          capture();
          void torch(false);
        },
        on ? TORCH_SETTLE_MS : 0,
      ),
    );
  };
  // Hold the shutter to film a clip (a plain post: looks and cards are painted on photos)
  const recordable = useMemo(() => canRecordClips(), []) && !card && status === "live" && canShoot && count == null;
  const hints = useHintsSeen();
  const markHint = useMarkHintSeen();
  const recorder = useClipRecorder({
    getStream: () => streamRef.current,
    // sound only when it's switched on in the camera's settings (off on a phone), so their music keeps playing
    withSound: () => readFilmSettings().sound,
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
  // the light goes off with the clip
  useEffect(() => {
    if (!recorder.recording && torchOn.current) void torch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recording]);
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
    if (!timer) return snap();
    let n = timer;
    setCount(n);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        cancelCount();
        snap();
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
    // a story's filters are painted on photos: a clip goes on as it is (the row back on Normal)
    if (heroAt === -1 && story && card && filters?.length && onFilter) {
      onFilter(filters[0].key);
      skipPhoto();
      void tray.add(files);
      return;
    }
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
    setTyped(false);
    dropShot(shotRef.current);
    setShot(null);
    setItems([]);
    setPosted(false);
    setPhase("shoot");
  };

  const flip = () => status === "live" && setFacing((f) => (f === "user" ? "environment" : "user"));
  /** Type (Instagram's Create): a story of words on a colour, the keyboard up; the colour wheel changes the colour. */
  const startTyped = () => {
    cancelCount();
    setTyped(true);
    setBackdrop(0);
    freeze({ src: paintReplyBackdrop(0), file: null, live: false, at: new Date() });
    // a colour is the picture as it is: no filter, never shown whole over a blur
    setShotGrade(null);
    setShotWhole(false);
    setRequest({ kind: "text", n: Date.now() });
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button, input, textarea")) return void (swipe.current = null);
    swipe.current = { x: e.clientX, y: e.clientY };
    if (editRing) startPeek(e.clientX, e.clientY);
  };
  /** A finger held still on the picture hides the ring until it lifts (a swipe keeps it: the ring follows the swipe). */
  const startPeek = (x: number, y: number) => {
    const t = setTimeout(() => setPeek(true), PEEK_MS);
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x, ev.clientY - y) > 10) clearTimeout(t);
    };
    const end = () => {
      clearTimeout(t);
      setPeek(false);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
    // on the window, in capture: a sticker or the framer keeping the finger never strands it hidden
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
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
    const c = shotMedia(shot.src as Drawable, frameShape, 1080);
    try {
      if (items.length) drawStickers(context2d(c), items, c.width, c.height);
      const b = await canvasToBlob(c, "image/jpeg", 0.92);
      return b ? new File([b], name, { type: "image/jpeg" }) : null;
    } finally {
      releaseCanvas(c);
    }
  };
  const finalPhoto = () => framedFile(frameAspect, shot?.live ? "jf-live.jpg" : "jf-photo.jpg");
  /** The card as it's shown (a post's 9:16 or 4:5, a story's 9:16), over the photo as it's framed, stickers on top. */
  const cardImage = async (fmt: ShareFormat): Promise<Blob | null> => {
    if (!card) return null;
    const c = document.createElement("canvas");
    const media = shot ? shotMedia(shot.src as Drawable, fmt === "feed" ? FEED_CARD_ASPECT : STORY_ASPECT, 1080) : null;
    try {
      paintCard(c, card, media, fmt, frozenLockedIn(card.data), logo, 1);
      drawStickers(context2d(c), items, c.width, c.height);
      return await canvasToBlob(c, "image/jpeg", 0.92);
    } finally {
      releaseCanvas(media);
      releaseCanvas(c);
    }
  };
  const cardBlob = () => cardImage(cardFormat);

  // What gets posted is what you see: the look you're on, as the post's card (9:16 filling its screen, or 4:5).
  // "No filter" posts the photo itself; so does Hide weights, so a card never
  // shows your numbers. With no photo, a carousel opens on the card itself
  // (what you see as slide 1).
  const postPhoto = async (carousel: boolean): Promise<File | null> => {
    if (!card) return finalPhoto();
    // a story filter is a "plain" card with its own painter: it goes as painted, never as the bare photo
    const bare = (card.look === "plain" && !card.paint) || (post?.showHideLoads && hideLoads && !card.paint);
    // editing without a new photo: the post keeps the one it has (a bare card never replaces it)
    if (!shot && post?.hasCover) return null;
    if (!shot && (!carousel || bare)) return null;
    if (shot && bare) return finalPhoto();
    const b = await cardImage("feed");
    return b ? new File([b], `jf-${card.look}.jpg`, { type: "image/jpeg" }) : finalPhoto();
  };
  /** A story's picture: the card (9:16) or the framed photo; null for a clip (it goes up as it is). */
  const storyPhoto = async (): Promise<File | null> => {
    if (card && !(card.look === "plain" && !card.paint && shot)) {
      const b = await cardImage("story");
      return b ? new File([b], `jf-story-${card.look}.jpg`, { type: "image/jpeg" }) : finalPhoto();
    }
    return finalPhoto();
  };

  // what the frame shows now, small (the strip's slide 1, the caption screen)
  const smallFrame = (extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    if (cardEl) return captionThumb(cardEl, extra) ?? null;
    if (!shot) return null;
    const c = shotMedia((light?.src ?? shot.src) as Drawable, frameAspect, 378);
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
  }, [phase, cardEl, card?.look, card?.paint, shot, framing, framingLive, frameAspect, shotGrade, shotWhole]);

  // The caption screen's preview: the card as it is now, stickers and all, small.
  const openCaption = () => {
    setThumb(smallFrame((ctx, w, h) => drawStickers(ctx, items, w, h)));
    setCaptioning(true);
  };

  // something to post: the card, or (a plain post) a photo or a slide
  const hasContent = !!card || !!shot || tray.items.length > 0;
  // a workout's post to the crew needs a photo or clip of their own: the card alone is a story's
  const needsMedia = !story && !!post?.needsMedia && visibility !== "private" && !shot && tray.items.length === 0 && !post.hasCover;
  const qc = useQueryClient();
  const { user } = useAuth();
  /** Tag or untag someone on the story: their @ sticker goes on a photo (a clip just carries the tag). */
  const toggleTag = (a: CommunityAuthor) => {
    setPosted(false);
    if (tags.some((t) => t.user_id === a.user_id)) {
      setTags((t) => t.filter((x) => x.user_id !== a.user_id));
      setItems((list) => list.filter((i) => i.mention?.userId !== a.user_id));
      return;
    }
    setTags((t) => uniqueTags([...t, a]));
    if (card || shot) setItems((list) => [...list, mentionStickerItem(a.user_id, tagHandle(a), list.filter((i) => i.mention).length)]);
  };

  /** STORY: the picture (or the clip) goes to your story, never the feed. */
  const postStory = async () => {
    if (!user?.id) throw new Error("Sign in again to post");
    const photo = await storyPhoto();
    // a clip story: the clip itself (it's been uploading since it was picked)
    // (a clip filling the story goes with its 9:16 frame and a poster baked to it; one shown whole goes as it is)
    const storyClip = tray.items[0];
    const fill = !!storyClip && storyClip.kind === "video" && !(storyClip.whole ?? storyStartsWhole({ w: storyClip.w ?? 9, h: storyClip.h ?? 16 }));
    const extras = photo ? [] : (await tray.ready(fill ? STORY_ASPECT : null)).slice(0, 1);
    if (!photo && !extras.length) throw new Error("Add a photo or a clip to your story");
    await post?.beforeStory?.();
    // (the button only offers the crew or Close friends; whatever the post it's for had, a story is one of those)
    const audience: CommunityVisibility = STORY_AUDIENCE.includes(visibility) ? visibility : "community";
    // (a shared post's story links to it while its card is on it)
    const sharedPostId = share && items.some((i) => i.id === SHARE_CARD_ID) ? share.postId : null;
    // the people tagged ride on its caption (the database reads them into its mentions; the story shows them, tappable)
    const id = await createCommunityPost(qc, { userId: user.id, caption: withTags("", tags), visibility: audience, photo, extras, story: true, sharedPostId });
    if (!photo) tray.commit();
    else tray.discard();
    if (live) {
      try {
        await setPostSticker(id, live);
      } catch (e: any) {
        toast.warning("Your story is up without the sticker", { description: e?.message ?? "Add it again from your story." });
      }
    }
    if (reply) {
      try {
        await reply.onPosted(id);
        toast.success("Answered on your story", { description: "It's marked answered in your responses." });
      } catch (e: any) {
        toast.warning("It's on your story", { description: e?.message ?? "It couldn't be marked answered." });
      }
      return;
    }
    toast.success(audience === "close_friends" ? "Added to your Close friends story" : "Added to your story", { description: "It's in the story row for 24 hours." });
  };
  const doPost = async () => {
    if (!post || busy || posted || !hasContent || needsMedia) return;
    setBusy("post");
    try {
      if (story) {
        await postStory();
        void clearDraft();
        draftOff.current = true;
        setPosted(true);
        setTimeout(() => leaveRef.current(), 900);
        return;
      }
      // the extras have been uploading all along; this only waits for any still going, and frames each at the post's shape
      const extras = await tray.ready(frameAspect);
      await post.onPost({ photo: await postPhoto(extras.length > 0), live: !!shot?.live, caption: caption.trim(), visibility, hideLoads, look: card?.look ?? "plain", extras, attach: att.save });
      tray.commit();
      // posted: the draft is done with (a lock in's key can change while it posts, so not by key)
      void clearDraft();
      draftOff.current = true;
      setPosted(true);
      setTimeout(() => leaveRef.current(), 900);
    } catch (e: any) {
      if (e?.posted) {
        // the post is up (only the GIF / voice memo missed): its photos are the post's now
        tray.commit();
        void clearDraft();
        draftOff.current = true;
        setPosted(true);
        setTimeout(() => leaveRef.current(), 900);
        toast.warning(e.message);
      } else toast.error(e?.message ?? "Couldn't post. Try again.");
    } finally {
      setBusy(null);
    }
  };
  // Save the card to the phone. On phones that's the system sheet (its "Save
  // Image" puts it in Photos); elsewhere it downloads.
  // Share outside the app / Save: the card (or photo) as it's shown, at the shape where it's going
  const [sharingOut, setSharingOut] = useState(false);
  const makeShareFile = async (format: "feed" | "story"): Promise<File | null> => {
    if (card) {
      const b = await cardImage(format);
      return b ? new File([b], shareFileName(format, card.look), { type: "image/jpeg" }) : null;
    }
    if (!shot) return null;
    return framedFile(format === "feed" ? FEED_CARD_ASPECT : STORY_ASPECT, shareFileName(format));
  };
  const shareCaptionSrc = card?.data && (card.data.lift || card.data.workoutTitle) && card.look !== "plain" ? { workoutTitle: card.data.workoutTitle, lift: card.data.lift, isPr: card.data.isPr, hideLoads: !!(post?.showHideLoads && hideLoads) } : null;

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
  /**
   * Back to where it came from: on a phone the feed slides back in from the
   * right over it (CAMERA_LEAVE_EVENT; the camera moves slower under it, its
   * edge always the feed's), then it closes.
   */
  const leave = () => {
    if (leaving) return;
    cancelCount();
    const ms = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : LEAVE_MS;
    if (phone && entry !== "pop") window.dispatchEvent(new CustomEvent(CAMERA_LEAVE_EVENT, { detail: { ms } }));
    setLeaving(true);
    window.setTimeout(onClose, ms);
  };
  leaveRef.current = leave;
  // what closing would lose: their own photo or clip, words or stickers on it, a caption (a reply's backdrop is ours, not theirs)
  const unsaved = phase === "edit" && !posted && ((!!shot && !reply && !share && !typed) || items.length > 0 || caption.trim().length > 0 || tray.items.length > 0);
  const requestLeave = () => {
    if (busy) return;
    if (!unsaved) return leave();
    setDiscard({ title: story ? "Discard story?" : "Discard post?", body: "If you leave now, you'll lose your edits.", action: "Discard", run: leave });
  };
  /** Back to the camera: a photo with words or stickers on it asks first (Retake is a tap from losing them). */
  const requestRetake = () => {
    if (!items.length) return retake();
    setDiscard({ title: "Discard edits?", body: "Your text and stickers on this photo will be lost.", action: "Retake", run: retake });
  };
  // a phone's camera comes in from the left and goes back out that way; anywhere else (and a camera opened
  // from somewhere other than the feed, a story reply) it fades
  const phone = useMemo(() => (typeof window === "undefined" ? true : phoneLayoutNow()), [open]);
  // the + / Your story: the feed slides off to the right as the camera comes in under it (swipe-to-create.tsx)
  useEffect(() => {
    if (!open || entry !== "slide" || !phone) return;
    const ms = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : ENTER_MS;
    window.dispatchEvent(new CustomEvent(CAMERA_ENTER_EVENT, { detail: { ms } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // (a push: the camera a third slower than the feed and clipped at the feed's edge, swipe-to-create.ts cameraUnderFeed)
  const motion: React.CSSProperties | undefined = leaving
    ? phone && entry !== "pop"
      ? { transform: "translate3d(-30%,0,0)", clipPath: "inset(0 70% 0 0)", transition: `transform ${LEAVE_MS}ms ${SLIDE_EASE}, clip-path ${LEAVE_MS}ms ${SLIDE_EASE}` }
      : { opacity: 0, transition: `opacity ${LEAVE_MS}ms ease-out` }
    : entry === "slide" && phone
      ? { animation: `jf-camera-in ${ENTER_MS}ms ${SLIDE_EASE} both` }
      : entry === "fade"
        ? { animation: "jf-create-fade 200ms ease-out both" }
        : entry === "none"
          ? { animation: "none" }
          : undefined;
  const pickKind = (k: ShareKind) => {
    cancelCount();
    // a post is the New post screen's (the composer): leave the camera for it
    if (k === "post" && onPostFlow) return onPostFlow();
    setKind(k);
    if (k === "story" && !STORY_AUDIENCE.includes(visibility)) setVisibility("community");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestLeave()}>
      <DialogContent
        ref={setScreenEl}
        style={motion}
        // on a phone the camera is the whole screen; its dim would only darken the feed it pushes aside
        overlayStyle={phone ? { opacity: 0 } : leaving ? { opacity: 0, transition: `opacity ${LEAVE_MS}ms ease-out` } : undefined}
        data-share-studio={kind}
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Share</DialogTitle>
        <DialogDescription className="sr-only">Take a photo, add text or stickers, then post it to the community or share it to your story.</DialogDescription>
        <input ref={libRef} type="file" accept={accept} multiple hidden onChange={(e) => fromInput(e, false)} onClick={() => accept.includes("video") && preloadMediaTools()} />
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
            className={cn("relative shrink-0", phase === "edit" && "transition-[width,height] duration-300 ease-out")}
            style={{ width: box.w, height: box.h }}
            data-studio-frame
          >
            <div
              className="absolute inset-0 touch-pan-y select-none overflow-hidden rounded-[22px] bg-zinc-900"
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
                  // a post's 4:5 card sits in the middle: the camera shows (dimmed) around it
                  className={cn("absolute inset-0 h-full w-full object-cover", status === "live" && (!showCard || !story) ? "opacity-100" : "opacity-0", facing === "user" && "-scale-x-100")}
                />
              )}
              {/* a post on the camera: what's outside the post's shape is dimmed (none at 9:16, where a post starts) */}
              {phase === "shoot" && !story && status === "live" && !adding && band.y > 1 && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/60" style={{ height: band.y }} aria-hidden data-post-band="top" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60" style={{ height: Math.max(0, box.h - band.y - band.h) }} aria-hidden data-post-band="bottom" />
                </>
              )}
              {/* a story's clip: the whole picture, as the story viewer shows it (a lift is never cropped off) */}
              {story && clip0?.video ? (
                <StoryClipStage
                  it={clip0}
                  box={box}
                  whole={clipWhole}
                  sound={hear && !clip0.muted}
                  grade={compiledFor(clip0.grade)}
                  onFraming={(f) => tray.setFraming(clip0.id, f)}
                  onClaim={() => (swipe.current = null)}
                />
              ) : (
                !story && !selItem && clip0?.preview && <img src={clip0.preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              {showCard && (
                <canvas
                  ref={setCardEl}
                  className={cn("pointer-events-none absolute", selItem && "invisible")}
                  style={phase === "shoot" ? { left: band.x, top: band.y, width: band.w, height: band.h } : { inset: 0, width: "100%", height: "100%" }}
                  aria-label={card ? `${TEMPLATE_LABEL[card.look]} look` : undefined}
                />
              )}
              {/* the photo, framed: drag and pinch (a card on it: two fingers, one swipes the looks). Over the card, so its grid shows; the card paints the photo itself */}
              {/* a story's photo shown whole, over a blur of itself (no card on it: the card paints the same) */}
              {phase === "edit" && shot && story && shotWhole && !showCard && !selItem && <WholePreview src={(gradeLive && light ? light.src : shot.src) as Drawable} grade={shotCompiled} quick={gradeLive} />}
              {phase === "edit" && shot && shotSize && !selItem && !(story && shotWhole) && (
                <PhotoFramer
                  grade={!showCard ? shotCompiled : null}
                  src={shotUrl}
                  size={shotSize}
                  frame={box}
                  framing={framing}
                  onFraming={setFraming}
                  oneFinger={!showCard && !storySwipe}
                  showImage={!showCard}
                  gridPreview={!story}
                  flash={shapeFlash}
                  onActive={setFramingLive}
                  onClaim={() => (swipe.current = null)}
                />
              )}
              {/* a photo or clip from the strip, in the post's shape: drag to place it, pinch to size it (a clip plays, muted, just the part that goes) */}
              {selItem && (
                <PhotoFramer
                  key={selItem.id}
                  src={selItem.kind === "image" ? selItem.preview : null}
                  video={selItem.kind === "video" && selItem.video ? { src: selItem.video, trim: selItem.trim, poster: selItem.preview ?? undefined, sound: hear && !selItem.muted } : null}
                  size={{ w: selItem.w ?? 4, h: selItem.h ?? 5 }}
                  frame={box}
                  framing={selItem.framing ?? CENTRED}
                  grade={compiledFor(selItem.grade)}
                  onFraming={(f) => tray.setFraming(selItem.id, f)}
                  oneFinger
                  gridPreview
                  flash={shapeFlash}
                  onClaim={() => (swipe.current = null)}
                />
              )}
              {/* bottom left: the post's shape (9:16 / 4:5 / 1:1 / 16:9, Instagram's corner button: every slide takes it) and a clip's cover */}
              {(shapeable || coverClip) && (
                <div className="absolute bottom-2.5 left-2.5 z-[5] flex gap-2">
                  {shapeable && (
                    <button
                      type="button"
                      onClick={() => {
                        aspectPicked.current = true;
                        setAspect(shapeOf(shownShape));
                        setShapeFlash((n) => n + 1);
                        feedback("tap");
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-bold text-white backdrop-blur active:scale-95"
                      aria-label={`Shape ${POST_ASPECT_LABEL[shownShape]}. Tap for ${POST_ASPECT_LABEL[shapeOf(shownShape)]}`}
                      data-frame-shape={shownShape}
                    >
                      {shownShape === "full" ? (
                        <Smartphone className="h-4 w-4" />
                      ) : shownShape === "portrait" ? (
                        <RectangleVertical className="h-4 w-4" />
                      ) : shownShape === "square" ? (
                        <Square className="h-4 w-4" />
                      ) : (
                        <RectangleHorizontal className="h-4 w-4" />
                      )}
                      {POST_ASPECT_LABEL[shownShape]}
                    </button>
                  )}
                  {/* a clip on a post: its cover (what shows before it plays, and on your profile grid) */}
                  {coverClip && (
                    <button
                      type="button"
                      onClick={() => setCoverFor(coverClip.id)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-bold text-white backdrop-blur active:scale-95"
                      data-edit-cover
                    >
                      <Film className="h-4 w-4" /> Cover
                    </button>
                  )}
                </div>
              )}
              {/* a clip in a post: the lift, found on the phone, one tap away (and the whole clip one tap back) */}
              {coverClip?.lift && !coverClip.existing && !(liftOn && coverClip.liftBefore === undefined) && (
                <div className="absolute inset-x-0 top-2.5 z-[5] flex justify-center px-14" data-studio-lift={liftOn ? "on" : "off"}>
                  {liftOn ? (
                    <span className="jf-arrive inline-flex h-9 items-center gap-1 rounded-full bg-black/55 pl-3 pr-1 text-[12px] font-bold text-white backdrop-blur">
                      <Scissors className="h-4 w-4" />
                      <span className="ml-0.5">Trimmed to the lift</span>
                      <button type="button" onClick={() => tray.undoLift(coverClip.id)} className="ml-1 h-7 rounded-full bg-white/20 px-2.5 text-[12px] font-bold active:scale-95" data-studio-whole>
                        Whole clip
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => tray.trimToLift(coverClip.id)}
                      className="jf-arrive inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12px] font-bold text-black active:scale-95"
                      data-studio-trim-lift
                    >
                      <Scissors className="h-4 w-4" /> Trim to the lift · {formatClock(coverClip.lift.end - coverClip.lift.start)}
                    </button>
                  )}
                </div>
              )}
              {/* a clip: its sound on or off (one tap, said in the middle), and one tap to change which part goes */}
              {trimClip && (
                <div className="absolute bottom-2.5 right-2.5 z-[5] flex gap-2">
                  {trimClip.audio && !trimClip.existing && (
                    <button
                      type="button"
                      onClick={(e) => {
                        const on = !!trimClip.muted;
                        tray.setSound(trimClip.id, on);
                        setHear(on);
                        flashSound(on);
                        // inside the tap, so the phone lets the stage play it with its sound
                        const v = (e.currentTarget.closest('[role="dialog"]') ?? document).querySelector<HTMLVideoElement>("video[data-framed-clip], video[data-studio-clip]");
                        if (v) {
                          v.muted = !on;
                          if (on)
                            void v.play().catch(() => {
                              v.muted = true;
                            });
                        }
                      }}
                      className="grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur active:scale-95"
                      aria-label={trimClip.muted ? "No sound. Tap to post it with sound" : "Sound on. Tap to post it with no sound"}
                      aria-pressed={!trimClip.muted}
                      data-studio-sound={trimClip.muted ? "off" : "on"}
                    >
                      {trimClip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void tray.edit(trimClip.id)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-bold text-white backdrop-blur active:scale-95"
                    data-studio-trim
                  >
                    <Scissors className="h-4 w-4" /> Trim{trimClip.seconds != null ? ` · ${formatClock(trimClip.seconds)}` : ""}
                  </button>
                </div>
              )}
              {soundFlash}

              {phase === "shoot" && status === "fallback" && (
                <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center", showCard && "bg-black/55 backdrop-blur-[2px]")} data-camera-fallback={oldApp ? "old-app" : camWhy ?? "other"}>
                  {oldApp ? (
                    // the phone's camera would close this version of the app: update first, or pick a photo
                    <>
                      <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10">
                        <Camera className="h-9 w-9" />
                      </div>
                      <div className="text-[17px] font-bold">Update JF Effect to use the camera</div>
                      <p className="max-w-[270px] text-[13px] text-white/75">This version of the app can't open the camera. Get the latest one in TestFlight and it opens right here.</p>
                      <button type="button" onClick={openTestFlight} className="h-11 rounded-full bg-white px-6 text-[15px] font-bold text-black active:scale-95">
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
                      <div className="text-[17px] font-bold">Camera is off for JF Effect</div>
                      <p className="max-w-[270px] text-[13px] text-white/75">
                        {/* iOS restarts an app when its camera permission changes, so it's "open it again", not "come back" */}
                        {getPlatform() === "ios" ? "Turn on Camera, then open Post again. From then on it opens right here." : "Allow the camera for JF Effect in your phone's settings and come back. It opens right here."}
                      </p>
                      {getPlatform() === "ios" && (
                        <button type="button" onClick={openAppSettings} className="h-11 rounded-full bg-white px-6 text-[15px] font-bold text-black active:scale-95" data-camera-settings>
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
                      <div className="text-[15px] font-bold">Take a photo</div>
                      <p className="max-w-[260px] text-[12px] text-white/70">The live camera didn't start here, so this opens your phone's camera.</p>
                    </>
                  )}
                </div>
              )}

              {phase === "edit" && (
                <StickerLayer
                  items={items}
                  setItems={setItems}
                  width={box.w}
                  height={box.h}
                  context={stickerContext}
                  request={request}
                  // a story (on a picture) can carry one Questions, Poll or Slider; picking another replaces it
                  interactive={story && shot ? { onPick: (type) => setLiveForm(live?.type === type ? live : blankSticker(type)) } : undefined}
                  onDragging={setStickerDrag}
                />
              )}
              {phase === "edit" && story && live && (
                <LiveStickerSpot
                  sticker={live}
                  height={box.h}
                  onMove={(y) => {
                    setLive((cur) => (cur ? { ...cur, y } : cur));
                    setPosted(false);
                  }}
                  onEdit={() => setLiveForm(live)}
                />
              )}

              {count != null && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span key={count} className="font-display animate-in zoom-in-50 fade-in text-[140px] leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]">{count}</span>
                </div>
              )}
              {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
              {/* a card on a photo: one finger swipes the looks, so moving the photo is two fingers (said once per shot) */}
              {pinchHint && !(story && shotWhole) && (
                <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center" data-pinch-hint>
                  <span className="animate-in fade-in rounded-full bg-black/55 px-3 py-1 text-[12px] font-bold backdrop-blur">Two fingers to move or zoom the photo</span>
                </div>
              )}
              {lookFlash && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span key={lookFlash} className="font-display animate-in fade-in zoom-in-95 rounded-2xl bg-black/35 px-5 py-2 text-[34px] uppercase leading-none backdrop-blur-sm">{lookFlash}</span>
                </div>
              )}
              {phase === "edit" && !editRing && card && card.looks.length > 1 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5" aria-hidden>
                  {card.looks.map((t) => (
                    <span key={t} className={cn("h-1.5 rounded-full transition-all", t === card.look ? "w-5 bg-white" : "w-1.5 bg-white/45")} />
                  ))}
                </div>
              )}

              {/* the camera's tools down the left (Instagram's rail): each one's name as the camera opens, then just the icons */}
              {phase === "shoot" && !recorder.recording && count == null && (
                <CameraRail
                  labels={railLabels}
                  tools={[
                    story && !card && canShoot && !adding && !reply && !share
                      ? { key: "type", icon: <Type className="h-7 w-7" strokeWidth={1.9} />, label: "Type", onClick: startTyped }
                      : null,
                    status === "live"
                      ? {
                          key: "timer",
                          icon: <Timer className="h-7 w-7" strokeWidth={1.9} />,
                          label: timer ? `Timer · ${timer}s` : "Timer",
                          on: !!timer,
                          onClick: () => {
                            feedback("toggle");
                            setTimer((t) => (t === 0 ? 3 : t === 3 ? 10 : 0));
                          },
                        }
                      : null,
                    canShoot && !adding && card && allowNoPhoto
                      ? { key: "nophoto", icon: <ImageOff className="h-7 w-7" strokeWidth={1.9} />, label: "No photo", onClick: skipPhoto }
                      : canShoot && !adding && !card && onWrite && !story
                        ? { key: "write", icon: <PenLine className="h-7 w-7" strokeWidth={1.9} />, label: "Write", onClick: onWrite }
                        : null,
                  ]}
                />
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
                      <button type="button" onClick={requestLeave} className={pill} aria-label="Close" data-studio-close>
                        <X className="h-6 w-6" />
                      </button>
                    )}
                    {/* the flash, in the middle (Instagram's): the back camera's light where it has one, the screen for a selfie */}
                    {status === "live" && (facing === "user" || torchOk) && (
                      <button
                        type="button"
                        onClick={() => {
                          feedback("toggle");
                          setFlashOn((l) => !l);
                        }}
                        className={cn("absolute left-1/2 top-2.5 -translate-x-1/2", pill, flashOn && "bg-white text-black")}
                        aria-label={flashOn ? "Flash on" : "Flash off"}
                        aria-pressed={flashOn}
                        data-studio-flash={flashOn ? "on" : "off"}
                      >
                        {flashOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {reply || share ? (
                      <>
                        <button type="button" onClick={requestLeave} className={pill} aria-label="Close">
                          <X className="h-6 w-6" />
                        </button>
                        {/* the backdrop's colour, Instagram's colour wheel */}
                        <button
                          type="button"
                          onClick={() => {
                            const next = backdrop + 1;
                            setBackdrop(next);
                            dropShot(shotRef.current);
                            setShot({ src: paintReplyBackdrop(next), file: null, live: false, at: new Date() });
                            setPosted(false);
                          }}
                          className={pill}
                          aria-label="Change the background colour"
                          data-reply-backdrop
                        >
                          <span className="h-6 w-6 rounded-full border-2 border-white bg-[conic-gradient(#ef3340,#f97316,#facc15,#22c55e,#2563eb,#a855f7,#ef3340)]" />
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={requestRetake} className={pill} aria-label={shot ? "Retake" : "Back to the camera"}>
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                    )}
                    {/* a words story: its colour, Instagram's colour wheel */}
                    {typed && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = backdrop + 1;
                          setBackdrop(next);
                          dropShot(shotRef.current);
                          setShot({ src: paintReplyBackdrop(next), file: null, live: false, at: new Date() });
                          setPosted(false);
                        }}
                        className={pill}
                        aria-label="Change the background colour"
                        data-studio-typed-colour
                      >
                        <span className="h-6 w-6 rounded-full border-2 border-white bg-[conic-gradient(#ef3340,#f97316,#facc15,#22c55e,#2563eb,#a855f7,#ef3340)]" />
                      </button>
                    )}
                    {/* Enhance: the photo's or clip's filter and adjustments; Fill / Fit: a story's picture filling it or whole */}
                    {enhanceTarget && (
                      <button type="button" onClick={() => setEnhancing((e) => !e)} className={cn(pill, "ml-auto", enhancing && "bg-white text-black")} aria-pressed={enhancing} aria-label="Enhance: filters and adjustments" data-studio-enhance>
                        <SlidersHorizontal className="h-5 w-5" />
                      </button>
                    )}
                    {fitTarget && (
                      <button
                        type="button"
                        onClick={() => {
                          feedback("tap");
                          if (shot) setShotWhole((w) => !w);
                          else if (clip0) tray.setWhole(clip0.id, !clipWhole);
                        }}
                        className={cn(pill, !enhanceTarget && "ml-auto")}
                        aria-label={fitTarget === "whole" ? "Fill the story" : "Show it whole"}
                        data-studio-fit={fitTarget}
                      >
                        {fitTarget === "whole" ? <Expand className="h-5 w-5" /> : <Shrink className="h-5 w-5" />}
                      </button>
                    )}
                    {/* text and stickers go on a card or a photo (never on a clip) */}
                    {(card || shot) && (
                      <>
                        <button type="button" onClick={() => setRequest({ kind: "text", n: Date.now() })} className={cn(pill, !enhanceTarget && !fitTarget && "ml-auto")} aria-label="Add text">
                          <Type className="h-5 w-5" />
                        </button>
                        <button type="button" onClick={() => setRequest({ kind: "stickers", n: Date.now() })} className={pill} aria-label="Add a sticker">
                          <Smile className="h-5 w-5" />
                        </button>
                      </>
                    )}
                    {/* a story tags people (a photo gets their @ sticker; a clip just carries the tag) */}
                    {story && tagPeople && (card || shot || !!clip0) && (
                      <button
                        type="button"
                        onClick={() => setTagging(true)}
                        className={cn(pill, "relative", !(card || shot) && !enhanceTarget && !fitTarget && "ml-auto")}
                        aria-label={tags.length ? `Tagged ${tags.length}. Tap to change` : "Tag people"}
                        data-story-tag
                      >
                        <AtSign className="h-5 w-5" />
                        {tags.length > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-black animate-in zoom-in-50">{tags.length}</span>
                        )}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Enhance: the filters and adjustments over the picture's foot (the picture shows every change at once) */}
            {enhancing && enhanceTarget && (
              <div className="absolute inset-x-0 bottom-0 z-[7] rounded-t-2xl bg-black/85 px-4 pb-3 pt-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200" data-studio-enhance-panel>
                <StudioEnhance
                  target={enhanceTarget}
                  grade={enhanceTarget === "shot" ? shotGrade : (clip0?.grade ?? null)}
                  shotSrc={shot ? (light?.src ?? shot.src) as Drawable : null}
                  clipPoster={clip0?.preview ?? null}
                  onChange={(g) => (enhanceTarget === "shot" ? setShotGrade(g) : clip0 && tray.setGrade(clip0.id, g))}
                  onLive={setGradeLive}
                  defaultGrade={filterDefaults[story ? "story" : "post"]}
                  onSaveDefault={(g) => {
                    setFilterDefault(story ? "story" : "post", g);
                    toast.message(g && g.filter !== "original" ? `Saved as your default for ${story ? "stories" : "posts"}` : "No default filter", { description: "New photos and clips start with it. Changing this one never changes it." });
                  }}
                  onClearDefault={() => {
                    setFilterDefault(story ? "story" : "post", null);
                    toast.message("Default removed", { description: "New photos and clips start as shot." });
                  }}
                  onDone={() => setEnhancing(false)}
                />
              </div>
            )}
            {/* editing: the camera's filter row over the picture's foot (the ring shows what's on; swipe or tap a circle) */}
            {editRing && (
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 z-[6] pb-2 transition-opacity duration-200",
                  peek || framingLive || stickerDrag ? "pointer-events-none opacity-0" : "animate-in fade-in-0 slide-in-from-bottom-2 opacity-100",
                )}
                data-edit-filters
              >
                <LookCarousel looks={editRing.looks} groups={editRing.groups} look={editRing.look} onLook={editRing.onLook} />
              </div>
            )}
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
                  groups={filterGroups}
                  look={filters ? (filter ?? null) : (card?.look ?? null)}
                  onLook={(k) => (filters ? onFilter?.(k) : card?.onLook(k as ShareTemplate))}
                  onShoot={shoot}
                  disabled={!canShoot}
                  counting={count != null}
                  showName={fullScreen}
                  hold={
                    recordable || recorder.recording
                      ? {
                          onStart: () => {
                            // the flash on a clip: the light stays on while it films (a selfie keeps the screen for the picture)
                            if (flashOn && facing === "environment" && torchOk) void torch(true);
                            void recorder.start();
                          },
                          onEnd: recorder.release,
                          progress: recorder.recording ? recorder.progress : null,
                          seconds: recorder.seconds,
                        }
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
                  {/* what you're making: Post or Story (Instagram's row: tap or swipe it); the filters are the circles above */}
                  {storyable && !adding && !recorder.recording && <ModeSelector modes={CAMERA_MODES} value={kind} onChange={(k) => pickKind(k as ShareKind)} enterFrom={modeFrom} />}
                </div>
                {/* flip, where the thumb is (Instagram's); a double tap on the camera flips too. Its spot is kept so the row's middle stays under the shutter */}
                {status === "live" && !recorder.recording ? (
                  <button type="button" onClick={flip} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Flip camera" data-studio-flip>
                    <RefreshCcw className="h-5 w-5" />
                  </button>
                ) : (
                  <span className="h-11 w-11 shrink-0" aria-hidden />
                )}
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
                    selected={selItem?.id ?? null}
                    onSelect={setSel}
                    onCamera={() => {
                      setAdding(true);
                      setPhase("shoot");
                    }}
                    onLibrary={() => libRef.current?.click()}
                  />
                  <AttachPreview a={att} dark />
                  {needsMedia && (
                    <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-3.5 py-2.5" data-studio-needs-media>
                      <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/85">
                        Add a photo or clip to post this to Crew. The card on its own can go on your story.
                      </p>
                      {storyable && (
                        <button type="button" onClick={() => pickKind("story")} className="h-9 shrink-0 rounded-full bg-white px-3.5 text-[13px] font-bold text-black active:scale-95">
                          Your story
                        </button>
                      )}
                    </div>
                  )}
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
                  onClick={() => setSharingOut(true)}
                  className="grid h-14 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 active:scale-[0.97] disabled:opacity-60"
                  aria-label="Share outside the app, or save it"
                  data-studio-share-out
                >
                  {busy === "save" ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Download className="h-6 w-6" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVisibility(audList[(audList.indexOf(audBase) + 1) % audList.length].key);
                    setPosted(false);
                  }}
                  className="inline-flex h-14 shrink-0 items-center gap-1.5 rounded-2xl bg-white/10 px-3 text-[13px] font-bold active:scale-95"
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
                  disabled={!!busy || posted || !post || !hasContent || needsMedia || att.recorder.recording}
                  onClick={() => void doPost()}
                  className={cn(
                    // the app's own primary button: JF red, solid
                    "inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl text-[16px] font-bold shadow-lg shadow-primary/25 active:scale-[0.98] disabled:opacity-100",
                    posted ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground",
                    (!post || needsMedia) && "opacity-60",
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
              range={it.trim}
              size={{ w: it.w ?? 9, h: it.h ?? 16 }}
              aspect={frameAspect}
              framing={it.framing ?? CENTRED}
              onCancel={() => setCoverFor(null)}
              onDone={(cover) => {
                if (cover) tray.setCover(it.id, cover);
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
        {story && tagPeople && <TagPeopleSheet open={tagging} onClose={() => setTagging(false)} tagged={tags} onToggle={toggleTag} dark />}
        {/* a story's Questions / Poll / Slider: write it, it goes where it's dragged */}
        <StickerEditorSheet
          open={!!liveForm}
          initial={liveForm}
          title="Story sticker"
          onClose={() => setLiveForm(null)}
          onSave={(sticker) => {
            setLive({ ...sticker, y: live?.y ?? sticker.y ?? 0.5 });
            setLiveForm(null);
            setPosted(false);
          }}
          onRemove={
            live
              ? () => {
                  setLive(null);
                  setLiveForm(null);
                }
              : undefined
          }
        />
        {/* a clip that's too long (or tapped in the strip) is trimmed here, on top of the studio */}
        {tray.trimmer}
        <ShareOutSheet
          open={sharingOut}
          onOpenChange={setSharingOut}
          look={`${card?.look ?? "photo"}:${shotGrade?.filter ?? ""}:${shotWhole}`}
          caption={shareCaptionSrc ? workoutShareCaption(shareCaptionSrc, { promo: false }) : ""}
          promoLine={shareCaptionSrc ? promoLine(shareCaptionSrc) : JF_HANDLE}
          make={makeShareFile}
        />
        {/* a selfie's flash: the screen, white and bright, a moment before the photo */}
        {screenFlash && <div className="pointer-events-none absolute inset-0 z-[80] bg-white" aria-hidden data-studio-screen-flash />}
        {discard && (
          <DiscardConfirm
            tag="studio-discard"
            title={discard.title}
            body={discard.body}
            action={discard.action}
            onConfirm={() => {
              const run = discard.run;
              setDiscard(null);
              run();
            }}
            onCancel={() => setDiscard(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A new live sticker of this kind, ready to write. */
function blankSticker(type: StickerType): StickerSpec {
  return type === "poll" ? { type, q: "", options: [{ label: "Yes" }, { label: "No" }] } : type === "slider" ? { type, q: "", emoji: "🔥" } : { type, q: "" };
}

/**
 * A story's Questions / Poll / Slider in the editor, where the crew will see
 * it (its middle at `y` of the story's height, the same band the story keeps
 * it to): drag it up or down, tap it to change or remove it. It's never
 * drawn into the picture; the story shows the real one, live.
 */
function LiveStickerSpot({ sticker, height, onMove, onEdit }: { sticker: StickerSpec; height: number; onMove: (y: number) => void; onEdit: () => void }) {
  const drag = useRef<{ y0: number; at0: number; moved: boolean } | null>(null);
  const at = stickerY(sticker.y) ?? 0.5;
  return (
    <div
      className="absolute inset-x-0 z-[6] touch-none"
      style={{ top: at * height, transform: "translateY(-50%)" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { y0: e.clientY, at0: at, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !height) return;
        const dy = e.clientY - d.y0;
        if (Math.abs(dy) > 4) d.moved = true;
        if (d.moved) onMove(Math.min(STICKER_Y_MAX, Math.max(STICKER_Y_MIN, d.at0 + dy / height)));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) onEdit();
      }}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onMove(Math.min(STICKER_Y_MAX, Math.max(STICKER_Y_MIN, at + (e.key === "ArrowUp" ? -0.04 : 0.04))));
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Your story sticker. Drag to move it, tap to change it"
      data-studio-live-sticker={sticker.type}
    >
      <StickerPreview sticker={sticker} />
    </div>
  );
}

type RailTool = { key: string; icon: ReactNode; label: string; onClick: () => void; on?: boolean };

/**
 * The camera's tools down the left of the picture (Instagram's rail): an icon
 * each, its name beside it as the camera opens, then just the icons so the
 * picture stays clear. Only the tools that work right now are there.
 */
function CameraRail({ tools, labels }: { tools: (RailTool | null)[]; labels: boolean }) {
  const list = tools.filter((t): t is RailTool => !!t);
  if (!list.length) return null;
  return (
    <div className="absolute left-1.5 top-[38%] z-[5] flex flex-col gap-2" data-studio-rail>
      {list.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.onClick}
          aria-label={t.label}
          aria-pressed={t.on}
          className="group flex h-12 items-center gap-2.5 pr-3 text-white active:scale-95"
          data-studio-tool={t.key}
        >
          <span className={cn("grid h-11 w-11 place-items-center rounded-full [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]", t.on && "bg-white text-black [filter:none]")}>{t.icon}</span>
          <span className={cn("whitespace-nowrap text-[15px] font-semibold transition-opacity duration-300 [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]", labels ? "opacity-100" : "opacity-0")} aria-hidden>
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Enhance in the studio: the photo's or a story clip's filter (FilterPanel)
 * over the picture's foot, with Done. Auto reads the picture itself (the photo,
 * or the clip's poster), and the export bakes exactly what's shown.
 */
function StudioEnhance({
  target,
  grade,
  shotSrc,
  clipPoster,
  onChange,
  onLive,
  defaultGrade,
  onSaveDefault,
  onClearDefault,
  onDone,
}: {
  target: "shot" | "clip";
  grade: MediaGrade | null;
  shotSrc: Drawable | null;
  clipPoster: string | null;
  onChange: (g: MediaGrade) => void;
  onLive: (on: boolean) => void;
  defaultGrade: MediaGrade | null;
  onSaveDefault: (g: MediaGrade | null) => void;
  onClearDefault: () => void;
  onDone: () => void;
}) {
  const poster = useGradeSource(target === "clip" ? clipPoster : null);
  const shotStats = useMemo(() => (target === "shot" && shotSrc ? statsFor(shotSrc) : null), [target, shotSrc]);
  const source = target === "shot" ? shotSrc : poster.img;
  const size = source ? drawableSize(source as Drawable) : null;
  return (
    <div className="text-white">
      <FilterPanel
        grade={grade}
        stats={target === "shot" ? shotStats : poster.stats}
        onChange={onChange}
        onLive={onLive}
        source={source as CanvasImageSource | null}
        sourceSize={size}
        defaultGrade={defaultGrade}
        onSaveDefault={() => onSaveDefault(grade)}
        onClearDefault={onClearDefault}
      />
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onDone} className="h-9 rounded-full bg-white px-5 text-[13px] font-semibold text-black active:scale-95" data-studio-enhance-done>
          Done
        </button>
      </div>
    </div>
  );
}

/** A story's photo shown whole over a blur of itself (wholeStoryCanvas): exactly what's posted. */
function WholePreview({ src, grade, quick }: { src: Drawable; grade: ReturnType<typeof compiledFor>; quick: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const out = ref.current;
    if (!out) return;
    const raf = requestAnimationFrame(() => {
      const c = wholeStoryCanvas(src, quick ? 540 : 1080, grade);
      try {
        out.width = c.width;
        out.height = c.height;
        out.getContext("2d")?.drawImage(c, 0, 0);
      } finally {
        releaseCanvas(c);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [src, grade, quick]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" data-story-whole />;
}

/**
 * A story's clip on the stage, as the story will show it: filling the story
 * (drag and pinch to frame it, posted with that frame) or whole over a blur of
 * its poster. Its filter is graded live over it.
 */
function StoryClipStage({
  it,
  box,
  whole,
  sound,
  grade,
  onFraming,
  onClaim,
}: {
  it: TrayItem;
  box: { w: number; h: number };
  whole: boolean;
  sound: boolean;
  grade: ReturnType<typeof compiledFor>;
  onFraming: (f: Framing) => void;
  onClaim: () => void;
}) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const size = { w: it.w ?? 9, h: it.h ?? 16 };
  if (!whole)
    return (
      <PhotoFramer
        key={it.id}
        src={null}
        video={it.video ? { src: it.video, trim: it.trim, poster: it.preview ?? undefined, sound } : null}
        size={size}
        frame={box}
        framing={it.framing ?? CENTRED}
        onFraming={onFraming}
        oneFinger
        grade={grade}
        onClaim={onClaim}
      />
    );
  const r = wholeRect(size, box);
  const at: React.CSSProperties = { position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h };
  return (
    <div className="absolute inset-0 overflow-hidden bg-black" data-studio-clip data-story-clip-fit="whole">
      {it.preview && <img src={it.preview} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl" />}
      {it.video && <TrimmedVideo key={it.video} src={it.video} trim={it.trim} poster={it.preview ?? undefined} sound={sound} videoRef={setEl} style={at} className={cn("max-w-none object-fill", grade && "opacity-0")} />}
      {grade && <GradedLayer source={el} grade={grade} style={at} />}
    </div>
  );
}
