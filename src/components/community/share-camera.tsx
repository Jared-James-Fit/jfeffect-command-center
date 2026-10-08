import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Images, RefreshCcw, Timer, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TEMPLATE_LABEL, cardLogo, ensureDisplayFont, paintShareCard, type ShareCardData, type ShareTemplate } from "@/lib/workout-share-card";

export type CameraMode = { key: string; label: string };

/** A card painted live over the viewfinder; swipe sideways to change the look. */
export type CameraCard = {
  data: Omit<ShareCardData, "media" | "template">;
  looks: ShareTemplate[];
  look: ShareTemplate;
  onLook: (t: ShareTemplate) => void;
};

const PREVIEW_SCALE = 0.72;
const FRAME_MS = 33;

/**
 * Camera-first share, Instagram-style: opens straight to a live camera with
 * the shutter in the middle, the photo library on the left and flip on the
 * right. Where the browser won't give us a live camera (permission denied,
 * old webview, no camera), it falls back to the phone's own camera and
 * picker. A web page can't read the camera roll, so the library button
 * opens the system picker rather than showing thumbnails.
 *
 * `chip` (what this becomes, tap to change) sits above the shutter. With a
 * `card`, the viewfinder IS the card: the real share card painted live on the
 * camera feed, Snapchat-style — swipe left/right to flip through the looks,
 * and the one you shoot on is the one you get. Self-timer (3s / 10s) for a phone propped on a rack;
 * double-tap the viewfinder to flip.
 */
export function ShareCamera({
  open,
  onClose,
  onPhoto,
  onSkip,
  skipLabel = "No photo",
  modes,
  mode,
  onMode,
  hint,
  chip,
  card,
  canShoot = true,
  accept = "image/*",
}: {
  open: boolean;
  onClose: () => void;
  /** `live` is true for a photo taken right now (the LIVE stamp on lock-in). */
  onPhoto: (file: File, live: boolean) => void;
  onSkip?: () => void;
  skipLabel?: string;
  modes?: CameraMode[];
  mode?: string;
  onMode?: (key: string) => void;
  hint?: string | null;
  chip?: ReactNode;
  card?: CameraCard | null;
  /** False while there's nothing to share yet (the chip says why). */
  canShoot?: boolean;
  accept?: string;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState<"starting" | "live" | "fallback">("starting");
  const [flash, setFlash] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const libRef = useRef<HTMLInputElement | null>(null);
  const capRef = useRef<HTMLInputElement | null>(null);
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [count, setCount] = useState<number | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTap = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [cardEl, setCardEl] = useState<HTMLCanvasElement | null>(null);
  const [lookFlash, setLookFlash] = useState<string | null>(null);
  // If a phone ever can't paint the live card, fall back to the plain camera.
  const [cardFailed, setCardFailed] = useState(false);
  const cardRef = useRef(card);
  cardRef.current = card;

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

  useEffect(() => {
    if (!open || !video) return;
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
          /* autoplay is muted + inline, so this only fails if it was closed */
        }
        if (!cancelled) setStatus("live");
      })
      .catch(() => !cancelled && setStatus("fallback"));
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, video, facing]);

  useEffect(() => {
    if (!open) stop();
  }, [open]);

  // Paint the card on the live feed (~30 fps, a lighter-res preview).
  const hasCard = !!card && !cardFailed;
  useEffect(() => {
    if (!open || !cardEl || !hasCard) return;
    let raf = 0;
    let last = 0;
    let alive = true;
    let logo: HTMLImageElement | null = null;
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
      const lockedIn = c.data.lockedIn?.live ? { time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), live: true } : c.data.lockedIn;
      try {
        paintShareCard(cardEl, { ...c.data, lockedIn, template: c.look, media }, logo, PREVIEW_SCALE);
      } catch {
        alive = false;
        setCardFailed(true);
      }
    };
    void Promise.all([ensureDisplayFont(), cardLogo()]).then(([, l]) => {
      logo = l;
      if (alive) raf = requestAnimationFrame(frame);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [open, cardEl, hasCard, status, video, facing]);

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

  const capture = () => {
    if (!video || status !== "live" || !video.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d")!;
    // The selfie preview is mirrored; save it the way it looked.
    if (facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, c.width, c.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    c.toBlob(
      (b) => {
        if (!b) return;
        stop();
        onPhoto(new File([b], "jf-live.jpg", { type: "image/jpeg" }), true);
      },
      "image/jpeg",
      0.92,
    );
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

  const flip = () => status === "live" && setFacing((f) => (f === "user" ? "environment" : "user"));
  const onViewfinderTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) flip();
    lastTap.current = now;
  };
  // Swipe sideways = next look; a small movement is a tap (double-tap flips).
  const onDown = (e: React.PointerEvent) => {
    // Buttons on the viewfinder (close, timer, no photo) aren't swipes or taps.
    if ((e.target as Element).closest("button")) return void (swipe.current = null);
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: React.PointerEvent) => {
    const st = swipe.current;
    swipe.current = null;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) changeLook(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) onViewfinderTap();
  };

  const fromInput = (e: React.ChangeEvent<HTMLInputElement>, live: boolean) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    stop();
    onPhoto(f, live);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Camera</DialogTitle>
        <DialogDescription className="sr-only">Take a photo, pick one from your library, or continue without one.</DialogDescription>
        <input ref={libRef} type="file" accept={accept} hidden onChange={(e) => fromInput(e, false)} />
        <input ref={capRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromInput(e, true)} />

        <div className="relative min-h-0 flex-1 touch-pan-y select-none overflow-hidden rounded-b-[28px] bg-zinc-900 sm:rounded-[28px]" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (swipe.current = null)}>
          <video
            ref={setVideo}
            playsInline
            muted
            autoPlay
            className={cn("absolute inset-0 h-full w-full object-cover transition-opacity", status === "live" && !hasCard ? "opacity-100" : "opacity-0", facing === "user" && "-scale-x-100")}
          />
          {hasCard && card && <canvas ref={setCardEl} className="pointer-events-none absolute inset-0 h-full w-full object-cover" aria-label={`${TEMPLATE_LABEL[card.look]} look`} />}
          {status === "fallback" && (
            <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center", card && "bg-black/55 backdrop-blur-[2px]")}>
              <button type="button" onClick={() => capRef.current?.click()} className="grid h-24 w-24 place-items-center rounded-full bg-white text-black shadow-xl active:scale-95" aria-label="Open the camera">
                <Camera className="h-10 w-10" />
              </button>
              <div className="text-[15px] font-black">Take a photo</div>
              <p className="max-w-[260px] text-[12px] text-white/60">The live camera isn't available here, so this opens your phone's camera. Allow camera access in settings to shoot right in the app.</p>
            </div>
          )}
          {card && card.looks.length > 1 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden>
              {card.looks.map((t) => (
                <span key={t} className={cn("h-1.5 rounded-full transition-all", t === card.look ? "w-5 bg-white" : "w-1.5 bg-white/45")} />
              ))}
            </div>
          )}
          {lookFlash && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span key={lookFlash} className="font-display animate-in fade-in zoom-in-95 rounded-2xl bg-black/35 px-5 py-2 text-[34px] uppercase leading-none backdrop-blur-sm">{lookFlash}</span>
            </div>
          )}
          {count != null && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span key={count} className="font-display animate-in zoom-in-50 fade-in text-[140px] leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]">{count}</span>
            </div>
          )}
          {flash && <div className="absolute inset-0 bg-white/80" />}

          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="grid h-11 w-11 place-items-center rounded-full bg-black/40 backdrop-blur active:scale-95" aria-label="Close">
              <X className="h-6 w-6" />
            </button>
            {status === "live" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTimer((t) => (t === 0 ? 3 : t === 3 ? 10 : 0));
                }}
                className={cn("ml-2 mr-auto inline-flex h-11 items-center gap-1 rounded-full px-3 text-[13px] font-black backdrop-blur active:scale-95", timer ? "bg-white text-black" : "bg-black/40")}
                aria-label={timer ? `Self-timer ${timer} seconds` : "Self-timer off"}
              >
                <Timer className="h-5 w-5" />
                {timer ? `${timer}s` : null}
              </button>
            )}
            {onSkip && canShoot && (
              <button type="button" onClick={(e) => { e.stopPropagation(); stop(); onSkip(); }} className="h-10 rounded-full bg-black/40 px-4 text-[13px] font-bold backdrop-blur active:scale-95">
                {skipLabel}
              </button>
            )}
          </div>
          {hint && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
              <span className="max-w-full truncate rounded-full bg-black/45 px-3 py-1.5 text-[12px] font-bold backdrop-blur">{hint}</span>
            </div>
          )}
        </div>

        <div className="shrink-0 px-6 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}>
          {chip && <div className="mb-3 flex justify-center">{chip}</div>}
          <div className="flex items-center justify-between">
            <button type="button" disabled={!canShoot} onClick={() => libRef.current?.click()} className="grid h-12 w-12 place-items-center rounded-xl border-2 border-white/80 bg-white/10 active:scale-95 disabled:opacity-30" aria-label="Choose from your library">
              <Images className="h-6 w-6" />
            </button>
            <button
              type="button"
              disabled={!canShoot}
              onClick={shoot}
              className="grid h-[78px] w-[78px] place-items-center rounded-full border-[5px] border-white active:scale-95 disabled:opacity-30"
              aria-label={count != null ? "Cancel timer" : "Take photo"}
            >
              <span className={cn("block rounded-full transition-all", count != null ? "h-7 w-7 rounded-md bg-red-500" : "h-[62px] w-[62px] bg-white")} />
            </button>
            <button
              type="button"
              disabled={status !== "live"}
              onClick={flip}
              className="grid h-12 w-12 place-items-center rounded-full bg-white/10 active:scale-95 disabled:opacity-30"
              aria-label="Flip camera"
            >
              <RefreshCcw className="h-6 w-6" />
            </button>
          </div>
          {modes && modes.length > 1 && (
            <div className="mx-auto mt-4 flex w-max gap-1 rounded-full bg-white/10 p-1" role="tablist" aria-label="What you're sharing">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
