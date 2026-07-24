import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Global full-screen media viewer.
 *
 * A single instance is mounted at the app root (see __root.tsx via
 * <MediaViewerProvider>+<MediaViewerRoot />). Callers open images through
 * `useMediaViewer().open(src, { alt, previewSrc })`. Opening a second image
 * REPLACES the current one — the viewer never stacks two modals.
 *
 * Rendered via createPortal to document.body so it is guaranteed to sit
 * above the message list, sticky headers, composer, and bottom nav
 * regardless of any `transform`/`filter` ancestors that would otherwise
 * anchor a `position: fixed` element to the wrong containing block.
 */

type OpenOptions = { alt?: string | null; previewSrc?: string | null };
type ViewerState = { src: string; alt?: string | null; previewSrc?: string | null } | null;

type Ctx = {
  open: (src: string, opts?: OpenOptions) => void;
  close: () => void;
};

const MediaViewerCtx = createContext<Ctx | null>(null);

export function useMediaViewer(): Ctx {
  const ctx = useContext(MediaViewerCtx);
  if (ctx) return ctx;
  // Provider missing (e.g. isolated test render) — no-op fallback keeps UI alive.
  return { open: () => {}, close: () => {} };
}

const StateCtx = createContext<{
  state: ViewerState;
  setState: React.Dispatch<React.SetStateAction<ViewerState>>;
} | null>(null);

export function MediaViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ViewerState>(null);
  const api = useMemo<Ctx>(
    () => ({
      open: (src, opts) => setState({ src, alt: opts?.alt ?? null, previewSrc: opts?.previewSrc ?? null }),
      close: () => setState(null),
    }),
    [],
  );
  return (
    <MediaViewerCtx.Provider value={api}>
      <StateCtx.Provider value={{ state, setState }}>{children}</StateCtx.Provider>
    </MediaViewerCtx.Provider>
  );
}

export function MediaViewerRoot() {
  const stateCtx = useContext(StateCtx);
  const api = useContext(MediaViewerCtx);
  if (!stateCtx || !api) return null;
  const { state } = stateCtx;
  if (typeof document === "undefined") return null;
  if (!state) return null;
  return createPortal(<Viewer state={state} onClose={api.close} />, document.body);
}

function Viewer({ state, onClose }: { state: NonNullable<ViewerState>; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [retry, setRetry] = useState(0);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);

  // Reset per-image state when the src changes (opening a second image replaces the first).
  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    setRetry(0);
  }, [state.src]);

  // Escape closes + prevent background scroll while open.
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

  const src = retry > 0 ? `${state.src}${state.src.includes("?") ? "&" : "?"}_r=${retry}` : state.src;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={state.alt ?? "Image"}
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
        // Downward swipe (>80px, mostly vertical) closes.
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
        aria-label="Close image"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-3 top-3 z-10 inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/70 text-white shadow-lg ring-1 ring-white/20 hover:bg-black/90"
        style={{ top: "calc(env(safe-area-inset-top) + 12px)", right: "calc(env(safe-area-inset-right) + 12px)" }}
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ touchAction: "pinch-zoom" }}
      >
        {/* Blurred thumbnail preview while full-res loads */}
        {!loaded && !errored && state.previewSrc && (
          <img
            src={state.previewSrc}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute max-h-full max-w-full object-contain opacity-70 blur-md"
            draggable={false}
          />
        )}

        {!loaded && !errored && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/85">
            Loading image…
          </div>
        )}

        {errored ? (
          <div className="flex flex-col items-center gap-3 text-white/85">
            <div className="text-sm">Image couldn't load</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setErrored(false);
                setLoaded(false);
                setRetry((r) => r + 1);
              }}
              className="rounded-md border border-white/40 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-white/10"
            >
              Retry
            </button>
          </div>
        ) : (
          <img
            key={src}
            src={src}
            alt={state.alt ?? ""}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className={cn(
              "max-h-full max-w-full select-none object-contain transition-opacity",
              loaded ? "opacity-100" : "opacity-0",
            )}
            style={{ imageOrientation: "from-image" as any }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Aspect ratio cache ------------------------------- */

/**
 * Reserves layout space for chat thumbnails so images don't reflow the
 * thread as they decode. Keyed by storage_path (falls back to URL). A
 * lightweight LRU (~500 entries) is persisted to localStorage so revisiting
 * a conversation keeps the reserved boxes correctly sized.
 */

const RATIO_KEY = "jf:chat:img:ratio:v1";
const RATIO_MAX = 500;
type RatioMap = Record<string, number>;

let ratioCache: RatioMap | null = null;

function loadCache(): RatioMap {
  if (ratioCache) return ratioCache;
  if (typeof window === "undefined") {
    ratioCache = {};
    return ratioCache;
  }
  try {
    const raw = window.localStorage.getItem(RATIO_KEY);
    ratioCache = raw ? (JSON.parse(raw) as RatioMap) : {};
  } catch {
    ratioCache = {};
  }
  return ratioCache;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (typeof window === "undefined" || !ratioCache) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const c = ratioCache!;
      const keys = Object.keys(c);
      if (keys.length > RATIO_MAX) {
        // Simple LRU: keep the last RATIO_MAX inserted keys.
        const trimmed: RatioMap = {};
        for (const k of keys.slice(-RATIO_MAX)) trimmed[k] = c[k];
        ratioCache = trimmed;
      }
      window.localStorage.setItem(RATIO_KEY, JSON.stringify(ratioCache));
    } catch {
      /* quota / private mode — ignore */
    }
  }, 500);
}

export function getCachedRatio(key: string | undefined | null): number | null {
  if (!key) return null;
  const c = loadCache();
  const v = c[key];
  return typeof v === "number" && v > 0 ? v : null;
}

export function setCachedRatio(key: string | undefined | null, ratio: number) {
  if (!key || !ratio || !Number.isFinite(ratio)) return;
  const c = loadCache();
  if (c[key] === ratio) return;
  // Re-insert to bump recency for the naive LRU.
  delete c[key];
  c[key] = ratio;
  scheduleSave();
}
