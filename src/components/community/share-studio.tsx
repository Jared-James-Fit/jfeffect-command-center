import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, Check, ChevronLeft, Download, EyeOff, Images, Lock, RefreshCcw, Send, Smile, Timer, Type, User, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CommunityVisibility } from "@/lib/community";
import { TEMPLATE_LABEL, canvasToBlob, cardLogo, ensureDisplayFont, paintShareCard, shareCardImage, type ShareCardData, type ShareTemplate } from "@/lib/workout-share-card";
import { CaptionInput } from "@/components/community/caption-input";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { StickerLayer, bakeStickers, drawStickers, remapStickers, type StickerItem, type StickerRequest } from "@/components/community/sticker-layer";

export type CameraMode = { key: string; label: string };

/** The card painted on the viewfinder; swipe sideways to change the look. */
export type CameraCard = {
  data: Omit<ShareCardData, "media" | "template">;
  looks: ShareTemplate[];
  look: ShareTemplate;
  onLook: (t: ShareTemplate) => void;
};

export type StudioPostArgs = { photo: File | null; live: boolean; caption: string; visibility: CommunityVisibility; hideLoads: boolean; look: ShareTemplate };
export type StudioPost = {
  /** Changes when the post it's for changes (resets the caption etc.). */
  key: string;
  label: string;
  caption?: string | null;
  visibility?: CommunityVisibility | null;
  hideLoads?: boolean;
  showHideLoads?: boolean;
  onPost: (a: StudioPostArgs) => Promise<void>;
};

type Shot = { src: HTMLCanvasElement | HTMLImageElement; file: File | null; live: boolean; at: Date };

const CARD_W = 1080;
const CARD_H = 1920;
const LIVE_SCALE = 0.72;
const FRAME_MS = 33;
const AUDIENCE: { key: CommunityVisibility; label: string; icon: typeof Users }[] = [
  { key: "community", label: "JF crew", icon: Users },
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
 */
export function ShareStudio({
  open,
  onClose,
  modes,
  mode,
  onMode,
  chip,
  card,
  canShoot = true,
  accept = "image/*",
  onVideo,
  post,
}: {
  open: boolean;
  onClose: () => void;
  modes?: CameraMode[];
  mode?: string;
  onMode?: (key: string) => void;
  chip?: ReactNode;
  card: CameraCard | null;
  /** False while there's nothing to share yet (the chip says why). */
  canShoot?: boolean;
  accept?: string;
  /** A video picked from the library (cards can't be painted on video). */
  onVideo?: (file: File) => void;
  post: StudioPost | null;
}) {
  const [phase, setPhase] = useState<"shoot" | "edit">("shoot");
  const [shot, setShot] = useState<Shot | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState<"starting" | "live" | "fallback">("starting");
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
  // While the keyboard is up (caption or text), fit the whole studio into
  // the part of the screen you can see: iOS otherwise slides the page up and
  // cuts off the top. The card shrinks to fit; the text editor (fixed inside
  // this dialog) fills it too. Phones only: the desktop dialog is centred.
  const view = useVisualViewportBox(open && phase === "edit");
  const fitView = view?.keyboard && typeof window !== "undefined" && window.innerWidth < 640 ? { top: view.top, height: view.height } : undefined;
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

  // Fresh every time it opens.
  useEffect(() => {
    if (!open) return;
    setPhase("shoot");
    setShot(null);
    setItems([]);
    setPosted(false);
    setBusy(null);
  }, [open]);
  // The post it's for: start from what's already there (editing, not duplicating).
  // Not while posting: saving changes the post's key, and the caption must not blink.
  const postingRef = useRef(false);
  postingRef.current = !!busy || posted;
  useEffect(() => {
    if (!open || !post || postingRef.current) return;
    setCaption(post.caption ?? "");
    setVisibility(post.visibility ?? "community");
    setHideLoads(!!post.hideLoads);
    setPosted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.key]);

  useEffect(() => {
    void Promise.all([ensureDisplayFont(), cardLogo()]).then(([, l]) => setLogo(l));
  }, []);

  // The card: as big as fits, exactly 9:16, so what you see is what you share.
  useEffect(() => {
    if (!area || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setAreaSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(area);
    return () => ro.disconnect();
  }, [area]);
  const box = useMemo(() => {
    const w = Math.min(areaSize.w, (areaSize.h * CARD_W) / CARD_H);
    return { w: Math.floor(w), h: Math.floor((w * CARD_H) / CARD_W) };
  }, [areaSize]);
  // The card's full size (not the shrunken one while the keyboard is up), so
  // the text editor previews text at its real size.
  const [fullW, setFullW] = useState(0);
  const fitted = !!fitView;
  useEffect(() => {
    if (!fitted && box.w) setFullW(box.w);
  }, [fitted, box.w]);

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
  useEffect(() => {
    if (!shooting || !video) return;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("fallback");
      return;
    }
    setStatus("starting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        stop();
        streamRef.current = stream;
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* muted + inline: only fails if it was closed */
        }
        if (!cancelled) setStatus("live");
      })
      .catch(() => !cancelled && setStatus("fallback"));
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shooting, video, facing]);
  useEffect(() => {
    if (!open) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ---- the card ----------------------------------------------------- */
  const showCard = !!card && !cardFailed;
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
        paintShareCard(cardEl, { ...c.data, lockedIn, template: c.look, media }, logo, LIVE_SCALE);
      } catch {
        alive = false;
        setCardFailed(true);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [shooting, cardEl, showCard, logo, status, video, facing]);

  // Frozen: paint once per change, full res.
  useEffect(() => {
    if (phase !== "edit" || !cardEl || !card || !logo) return;
    try {
      paintShareCard(cardEl, { ...card.data, lockedIn: frozenLockedIn(card.data), template: card.look, media: shot?.src ?? null }, logo, 1);
    } catch {
      setCardFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cardEl, card?.look, card?.data, shot, logo]);

  const changeLook = (dir: 1 | -1) => {
    if (!card || card.looks.length < 2) return;
    const i = Math.max(0, card.looks.indexOf(card.look));
    const next = card.looks[(i + dir + card.looks.length) % card.looks.length];
    card.onLook(next);
    setLookFlash(TEMPLATE_LABEL[next]);
  };
  useEffect(() => {
    if (!lookFlash) return;
    const t = setTimeout(() => setLookFlash(null), 900);
    return () => clearTimeout(t);
  }, [lookFlash]);

  /* ---- shoot -------------------------------------------------------- */
  const freeze = (s: Shot) => {
    stop();
    setShot(s);
    setItems([]);
    setPhase("edit");
  };
  const capture = () => {
    if (!video || status !== "live" || !video.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d")!;
    // The selfie preview is mirrored; keep it the way it looked.
    if (facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, c.width, c.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    freeze({ src: c, file: null, live: true, at: new Date() });
  };
  const shoot = () => {
    if (!canShoot) return;
    if (status !== "live") return capRef.current?.click();
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
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type.startsWith("video/")) {
      if (onVideo) {
        stop();
        onVideo(f);
      } else toast.error("Pick a photo for this one");
      return;
    }
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
    setShot(null);
    setItems([]);
    setPhase("edit");
  };
  const retake = () => {
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
  const finalPhoto = async (): Promise<File | null> => {
    if (!shot) return null;
    if (items.length) {
      const b = await bakeStickers(shot.src, items);
      if (b) return new File([b], "jf-photo.jpg", { type: "image/jpeg" });
    }
    if (shot.file) return shot.file;
    const b = await canvasToBlob(shot.src as HTMLCanvasElement, "image/jpeg", 0.92);
    return b ? new File([b], "jf-live.jpg", { type: "image/jpeg" }) : null;
  };
  const cardBlob = async (): Promise<Blob | null> => {
    if (!card) return null;
    const c = document.createElement("canvas");
    paintShareCard(c, { ...card.data, lockedIn: frozenLockedIn(card.data), template: card.look, media: shot?.src ?? null }, logo, 1);
    drawStickers(c.getContext("2d")!, items, CARD_W, CARD_H);
    return canvasToBlob(c, "image/jpeg", 0.92);
  };

  // What gets posted is what you see: the look you're on, as a 4:5 feed card
  // (stickers moved onto the same spot of the photo). "No filter" posts the
  // photo itself; so does Hide weights, so a card never shows your numbers.
  const postPhoto = async (): Promise<File | null> => {
    if (!shot || !card) return null;
    if (card.look === "plain" || (post?.showHideLoads && hideLoads)) return finalPhoto();
    const FEED_H = 1350;
    const c = document.createElement("canvas");
    paintShareCard(c, { ...card.data, format: "feed", lockedIn: frozenLockedIn(card.data), template: card.look, media: shot.src }, logo, 1);
    drawStickers(c.getContext("2d")!, remapStickers(items, shot.src, { w: CARD_W, h: CARD_H }, { w: CARD_W, h: FEED_H }), CARD_W, FEED_H);
    const b = await canvasToBlob(c, "image/jpeg", 0.92);
    return b ? new File([b], `jf-${card.look}.jpg`, { type: "image/jpeg" }) : finalPhoto();
  };

  const doPost = async () => {
    if (!post || busy || posted || !card) return;
    setBusy("post");
    try {
      await post.onPost({ photo: await postPhoto(), live: !!shot?.live, caption: caption.trim(), visibility, hideLoads, look: card.look });
      setPosted(true);
      setTimeout(onClose, 900);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't post. Try again.");
    } finally {
      setBusy(null);
    }
  };
  // Save the card to the phone. On phones that's the system sheet (its "Save
  // Image" puts it in Photos); elsewhere it downloads.
  const doSave = async () => {
    if (busy || !card) return;
    setBusy("save");
    try {
      const blob = await cardBlob();
      if (!blob) throw new Error("Couldn't build the card");
      const outcome = await shareCardImage(blob, { filename: `jf-effect-${card.look}.jpg`, title: "JF Effect" });
      if (outcome === "downloaded") toast.success("Saved to your phone");
      else if (outcome === "failed") toast.error("Couldn't save on this device");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the card");
    } finally {
      setBusy(null);
    }
  };

  const aud = AUDIENCE.find((a) => a.key === visibility) ?? AUDIENCE[0];
  const AudIcon = aud.icon;
  const stickerContext = useMemo(
    () => ({ time: timeLabel(shot?.at ?? new Date()), date: card?.data.dateLabel ?? new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), workoutTitle: card?.data.workoutTitle ?? null }),
    [shot, card?.data.dateLabel, card?.data.workoutTitle],
  );
  const pill = "grid h-11 w-11 place-items-center rounded-full bg-black/40 backdrop-blur active:scale-95";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={fitView}
      >
        <DialogTitle className="sr-only">Share</DialogTitle>
        <DialogDescription className="sr-only">Take a photo, add text or stickers, then post it to the community or share it to your story.</DialogDescription>
        <input ref={libRef} type="file" accept={accept} hidden onChange={(e) => fromInput(e, false)} />
        <input ref={capRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromInput(e, true)} />

        <div ref={setArea} className="flex min-h-0 flex-1 items-center justify-center px-2" style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}>
          <div
            className="relative touch-pan-y select-none overflow-hidden rounded-[22px] bg-zinc-900"
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
                className={cn("absolute inset-0 h-full w-full object-cover", status === "live" && !showCard ? "opacity-100" : "opacity-0", facing === "user" && "-scale-x-100")}
              />
            )}
            {phase === "edit" && !showCard && shot && <img src={shot.src instanceof HTMLImageElement ? shot.src.src : (shot.src as HTMLCanvasElement).toDataURL("image/jpeg", 0.8)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            {showCard && <canvas ref={setCardEl} className="pointer-events-none absolute inset-0 h-full w-full" aria-label={card ? `${TEMPLATE_LABEL[card.look]} look` : undefined} />}

            {phase === "shoot" && status === "fallback" && (
              <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center", showCard && "bg-black/55 backdrop-blur-[2px]")}>
                <button type="button" disabled={!canShoot} onClick={() => capRef.current?.click()} className="grid h-24 w-24 place-items-center rounded-full bg-white text-black shadow-xl active:scale-95 disabled:opacity-40" aria-label="Open the camera">
                  <Camera className="h-10 w-10" />
                </button>
                <div className="text-[15px] font-black">Take a photo</div>
                <p className="max-w-[260px] text-[12px] text-white/70">The live camera isn't on here, so this opens your phone's camera. Allow camera access in settings to shoot right in the app.</p>
              </div>
            )}

            {phase === "edit" && <StickerLayer items={items} setItems={setItems} width={box.w} height={box.h} editorWidth={fullW || box.w} context={stickerContext} request={request} />}

            {count != null && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span key={count} className="font-display animate-in zoom-in-50 fade-in text-[140px] leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]">{count}</span>
              </div>
            )}
            {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
            {lookFlash && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span key={lookFlash} className="font-display animate-in fade-in zoom-in-95 rounded-2xl bg-black/35 px-5 py-2 text-[34px] uppercase leading-none backdrop-blur-sm">{lookFlash}</span>
              </div>
            )}
            {card && card.looks.length > 1 && (
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
                  <button type="button" onClick={onClose} className={pill} aria-label="Close">
                    <X className="h-6 w-6" />
                  </button>
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
                  {canShoot && (
                    <button type="button" onClick={skipPhoto} className="ml-auto h-10 rounded-full bg-black/40 px-4 text-[13px] font-bold backdrop-blur active:scale-95">
                      No photo
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" onClick={retake} className={pill} aria-label={shot ? "Retake" : "Back to the camera"}>
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button type="button" onClick={() => setRequest({ kind: "text", n: Date.now() })} className={cn(pill, "ml-auto")} aria-label="Add text">
                    <Type className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => setRequest({ kind: "stickers", n: Date.now() })} className={pill} aria-label="Add a sticker">
                    <Smile className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: shoot controls, or caption + post */}
        <div className="shrink-0 px-4 pt-2.5" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
          {chip && <div className="mb-2.5 flex justify-center">{chip}</div>}
          {phase === "shoot" ? (
            <>
              <div className="flex items-center justify-between px-2">
                <button type="button" disabled={!canShoot} onClick={() => libRef.current?.click()} className="grid h-12 w-12 place-items-center rounded-xl border-2 border-white/80 bg-white/10 active:scale-95 disabled:opacity-30" aria-label="Choose from your library">
                  <Images className="h-6 w-6" />
                </button>
                <button type="button" disabled={!canShoot} onClick={shoot} className="grid h-[76px] w-[76px] place-items-center rounded-full border-[5px] border-white active:scale-95 disabled:opacity-30" aria-label={count != null ? "Cancel timer" : "Take photo"}>
                  <span className={cn("block rounded-full transition-all", count != null ? "h-7 w-7 rounded-md bg-red-500" : "h-[60px] w-[60px] bg-white")} />
                </button>
                <button type="button" disabled={status !== "live"} onClick={flip} className="grid h-12 w-12 place-items-center rounded-full bg-white/10 active:scale-95 disabled:opacity-30" aria-label="Flip camera">
                  <RefreshCcw className="h-6 w-6" />
                </button>
              </div>
              {modes && modes.length > 1 && (
                <div className="mx-auto mt-3 flex w-max gap-1 rounded-full bg-white/10 p-1" role="tablist" aria-label="What you're sharing">
                  {modes.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="tab"
                      aria-selected={mode === m.key}
                      onClick={() => {
                        cancelCount();
                        onMode?.(m.key);
                      }}
                      className={cn("h-9 rounded-full px-5 text-[13px] font-black uppercase tracking-[0.12em] transition-colors", mode === m.key ? "bg-white text-black" : "text-white/60")}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {/* full width, and it grows as you write, so you can read it back like a text */}
              <CaptionInput
                value={caption}
                onChange={(v) => {
                  setCaption(v);
                  setPosted(false);
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!!busy || !card}
                  onClick={() => void doSave()}
                  className="grid h-14 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 active:scale-[0.97] disabled:opacity-60"
                  aria-label="Save image"
                >
                  {busy === "save" ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Download className="h-6 w-6" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVisibility(AUDIENCE[(AUDIENCE.indexOf(aud) + 1) % AUDIENCE.length].key);
                    setPosted(false);
                  }}
                  className="inline-flex h-14 shrink-0 items-center gap-1.5 rounded-2xl bg-white/10 px-3 text-[13px] font-black active:scale-95"
                  aria-label={`Who sees it: ${aud.label}. Tap to change`}
                >
                  <AudIcon className="h-4 w-4" /> {aud.label}
                </button>
                {post?.showHideLoads && (
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
                  disabled={!!busy || posted || !post || !card}
                  onClick={() => void doPost()}
                  className={cn(
                    // the app's own primary button: JF red, solid
                    "inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl text-[16px] font-black shadow-lg shadow-primary/25 active:scale-[0.98] disabled:opacity-100",
                    posted ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground",
                    !post && "opacity-60",
                  )}
                >
                  {posted ? <Check className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                  {busy === "post" ? "Posting…" : posted ? "Posted" : post?.label ?? "Post"}
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
