import * as React from "react";
import { Suspense, createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { SaveItem } from "@/lib/save-media";
import type { FromRect } from "@/components/photo-viewer";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { runWhenIdle } from "@/lib/idle";

// The viewer itself (pinch-zoom photos, full-screen video, Save): its own chunk,
// fetched once the app has been idle a few seconds, so a tap opens it at once.
const Viewer = lazyWithRetry(() => import("@/components/media-viewer-surface"));

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

type OpenOptions = {
  alt?: string | null;
  previewSrc?: string | null;
  /** "video" plays the file full screen (autoplay with controls) instead of showing an image. */
  kind?: "image" | "video";
  /** Offer Save (top left), iMessage style: chat photos and videos. */
  save?: SaveItem | null;
  /** A profile photo: a big circle that grows out of the avatar tapped (`from`), with `caption` under it. */
  shape?: "circle" | "rect";
  from?: FromRect | null;
  caption?: string | null;
  /** Their initials, while the photo loads and if it can't. */
  fallback?: string | null;
  /** A sharper copy to swap in once loaded (a Crew photo's full-size file). */
  better?: (() => Promise<string | null>) | null;
};
export type ViewerState = {
  src: string;
  alt?: string | null;
  previewSrc?: string | null;
  kind: "image" | "video";
  save?: SaveItem | null;
  shape?: "circle" | "rect";
  from?: FromRect | null;
  caption?: string | null;
  fallback?: string | null;
  better?: (() => Promise<string | null>) | null;
} | null;

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
      open: (src, opts) =>
        setState({
          src,
          alt: opts?.alt ?? null,
          previewSrc: opts?.previewSrc ?? null,
          kind: opts?.kind ?? "image",
          save: opts?.save ?? null,
          shape: opts?.shape ?? "rect",
          from: opts?.from ?? null,
          caption: opts?.caption ?? null,
          fallback: opts?.fallback ?? null,
          better: opts?.better ?? null,
        }),
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
  useEffect(() => runWhenIdle(() => void Viewer.preload(), { after: 5000 }), []);
  if (!stateCtx || !api) return null;
  const { state } = stateCtx;
  if (typeof document === "undefined") return null;
  if (!state) return null;
  return createPortal(
    <Suspense fallback={null}>
      <Viewer state={state} onClose={api.close} />
    </Suspense>,
    document.body,
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
