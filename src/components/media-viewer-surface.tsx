import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, X } from "lucide-react";
import { useSaveMedia } from "@/components/messages/save-media";
import { saveLabel, warmSave, type SaveItem } from "@/lib/save-media";
import { PhotoViewer } from "@/components/photo-viewer";
import type { ViewerState } from "@/components/media-viewer";

/**
 * What the global media viewer draws once something is open (media-viewer.tsx
 * holds the state and the API): the photo viewer, or a video full screen. Its
 * own chunk, so the pinch-zoom viewer and the save button never load with the
 * app (or the landing page); media-viewer.tsx fetches it in idle time.
 */
export default function Viewer({ state, onClose }: { state: NonNullable<ViewerState>; onClose: () => void }) {
  if (state.kind === "video") return <VideoViewer state={state} onClose={onClose} />;
  // the app's one photo viewer (pinch, double-tap, pull away), photo-viewer.tsx
  return (
    <PhotoViewer
      key={state.src}
      src={state.src}
      alt={state.alt}
      previewSrc={state.previewSrc}
      shape={state.shape}
      from={state.from}
      caption={state.caption}
      fallback={state.fallback}
      better={state.better}
      topLeft={state.save ? <ViewerSaveButton item={state.save} /> : null}
      onClose={onClose}
    />
  );
}

/**
 * Save, top left across from the close button: the photo or video on screen
 * goes to the share sheet (Save Image / Save Video) or downloads. The photo is
 * the one already loading here, so it's usually in hand before the tap.
 */
function ViewerSaveButton({ item }: { item: SaveItem }) {
  const save = useSaveMedia();
  useEffect(() => { warmSave([item], { cheap: true }); }, [item]);
  const label = saveLabel([item]);
  return (
    <button
      type="button"
      aria-label={label}
      data-viewer-save
      onPointerDown={(e) => { e.stopPropagation(); warmSave([item]); }}
      onClick={(e) => { e.stopPropagation(); void save([item]); }}
      className="absolute left-3 top-3 z-10 inline-flex h-11 min-h-[44px] items-center gap-1.5 rounded-full bg-black/70 px-4 text-sm font-semibold text-white shadow-lg ring-1 ring-white/20 hover:bg-black/90"
      style={{ top: "calc(env(safe-area-inset-top) + 12px)", left: "calc(env(safe-area-inset-left) + 12px)" }}
    >
      <ArrowDownToLine className="h-4 w-4" /> Save
    </button>
  );
}

/**
 * Full-screen video, iMessage style: tapping a video bubble lands here and it
 * starts playing at once. The tap that opened it counts as the user gesture
 * iOS needs to allow sound; if autoplay is still refused the native controls
 * are right there. Swipe down or tap the backdrop/X to close.
 */
function VideoViewer({ state, onClose }: { state: NonNullable<ViewerState>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [errored, setErrored] = useState(false);
  const [retry, setRetry] = useState(0);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    setErrored(false);
    const v = videoRef.current;
    if (!v) return;
    // Don't leave a stream running behind a closed viewer.
    return () => { try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* noop */ } };
  }, [state.src, retry]);

  const src = retry > 0 ? `${state.src}${state.src.includes("?") ? "&" : "?"}_r=${retry}` : state.src;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={state.alt ?? "Video"}
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black"
      onClick={onClose}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      }}
      onTouchEnd={(e) => {
        const s = touchStart.current;
        touchStart.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        const dy = t.clientY - s.y;
        const dx = Math.abs(t.clientX - s.x);
        if (dy > 80 && dx < 60 && Date.now() - s.t < 700) onClose();
      }}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <button
        type="button"
        aria-label="Close video"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-3 top-3 z-10 inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/70 text-white shadow-lg ring-1 ring-white/20 hover:bg-black/90"
        style={{ top: "calc(env(safe-area-inset-top) + 12px)", right: "calc(env(safe-area-inset-right) + 12px)" }}
      >
        <X className="h-5 w-5" />
      </button>
      {state.save && <ViewerSaveButton item={state.save} />}
      <div className="relative flex h-full w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {errored ? (
          <div className="flex flex-col items-center gap-3 text-white/85">
            <div className="text-sm">Video couldn't load</div>
            <button
              type="button"
              onClick={() => setRetry((r) => r + 1)}
              className="rounded-md border border-white/40 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-white/10"
            >
              Retry
            </button>
          </div>
        ) : (
          <video
            key={src}
            ref={videoRef}
            src={src}
            poster={state.previewSrc ?? undefined}
            controls
            autoPlay
            playsInline
            onError={() => setErrored(true)}
            onLoadedMetadata={(e) => {
              // Belt and braces: some iOS builds ignore autoplay on a freshly mounted element.
              void e.currentTarget.play().catch(() => { /* controls are visible */ });
            }}
            className="max-h-full max-w-full bg-black object-contain"
          />
        )}
      </div>
    </div>
  );
}

