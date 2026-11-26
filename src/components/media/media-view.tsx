/**
 * How a GIF or sticker is drawn anywhere in the app (chat bubbles, comments,
 * posts, story replies, the picker grid).
 *
 * - Its own shape, reserved before it loads (no layout jump), never cropped.
 * - Stickers sit on nothing (transparency kept); GIFs get a soft tile.
 * - Loads only near the screen and stops animating when it scrolls away
 *   (swaps to a still frame where the provider gives one).
 * - Reduced motion: the still frame, tap to play.
 * - A dead link falls back to an emoji, never a broken image.
 */
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { fallbackEmoji } from "@/lib/gif-fallback";
import { displayBox, type MediaKind } from "@/lib/media/media";

/* ---- one shared observer for every tile / bubble ------------------------ */

type Cb = (near: boolean, visible: boolean) => void;
let nearObs: IntersectionObserver | null = null;
let visObs: IntersectionObserver | null = null;
const cbs = new WeakMap<Element, Cb>();
const state = new WeakMap<Element, { near: boolean; visible: boolean }>();

function observers() {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!nearObs) {
    const fire = (key: "near" | "visible") => (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        const s = state.get(e.target) ?? { near: false, visible: false };
        s[key] = e.isIntersecting;
        state.set(e.target, s);
        cbs.get(e.target)?.(s.near, s.visible);
      }
    };
    // start loading a screen ahead; animate only what's actually showing
    nearObs = new IntersectionObserver(fire("near"), { rootMargin: "600px 0px" });
    visObs = new IntersectionObserver(fire("visible"), { rootMargin: "0px", threshold: 0.01 });
  }
  return { nearObs, visObs: visObs! };
}

function useOnScreen(ref: React.RefObject<Element | null>) {
  const [s, set] = useState({ near: false, visible: false });
  useEffect(() => {
    const el = ref.current;
    const o = observers();
    if (!el || !o) {
      set({ near: true, visible: true });
      return;
    }
    cbs.set(el, (near, visible) => set((p) => (p.near === near && p.visible === visible ? p : { near: p.near || near, visible })));
    o.nearObs.observe(el);
    o.visObs.observe(el);
    return () => {
      o.nearObs.unobserve(el);
      o.visObs.unobserve(el);
      cbs.delete(el);
    };
  }, [ref]);
  return s;
}

/* ---- reduced motion ------------------------------------------------------ */

const RM = "(prefers-reduced-motion: reduce)";
const subRM = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const m = window.matchMedia(RM);
  m.addEventListener?.("change", cb);
  return () => m.removeEventListener?.("change", cb);
};
export function useReducedMotion() {
  return useSyncExternalStore(subRM, () => (typeof window !== "undefined" && !!window.matchMedia?.(RM).matches), () => false);
}

/* ---- the view ------------------------------------------------------------ */

export type MediaViewProps = {
  kind: MediaKind;
  /** Animated link shown when on screen. */
  src: string;
  /** Lighter animated link (used in place of src when small). */
  preview?: string | null;
  /** Still frame for reduced motion / offscreen. */
  still?: string | null;
  width?: number | null;
  height?: number | null;
  title?: string | null;
  category?: string | null;
  blur?: string | null;
  /** Largest side in px (bubbles 220, comments 180, picker uses `fill`). */
  max?: number;
  /** Fill the parent box instead of sizing itself (picker tiles). */
  fill?: boolean;
  /** Use `preview` rather than `src` (grids). */
  small?: boolean;
  className?: string;
};

export const MediaView = memo(function MediaView({
  kind, src, preview, still, width, height, title, category, blur, max = 220, fill, small, className,
}: MediaViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { near, visible } = useOnScreen(ref);
  const reduced = useReducedMotion();
  const [play, setPlay] = useState(false);
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const animated = (small ? preview || src : src) as string;
  const frozen = reduced && !play;
  // offscreen: the still if there is one (stops the animation); else keep the
  // last frame loaded rather than re-downloading on every scroll
  const url = !near ? null : frozen ? still ?? animated : !visible && still && loaded ? still : animated;
  const box = fill ? null : displayBox(width, height, max, kind);
  const sticker = kind === "sticker";

  useEffect(() => setErr(false), [src]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative overflow-hidden",
        fill ? "h-full w-full" : "max-w-full",
        sticker ? "bg-transparent" : "rounded-xl bg-muted",
        className,
      )}
      style={box ? { width: box.width, aspectRatio: `${box.width} / ${box.height}` } : undefined}
      onClick={frozen ? (e) => { e.stopPropagation(); setPlay(true); } : undefined}
    >
      {blur && !loaded && !sticker && <img src={blur} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />}
      {!loaded && !err && !blur && !sticker && <div className="absolute inset-0 jf-skeleton bg-muted" aria-hidden />}
      {url && !err && (
        <img
          src={url}
          alt={title ?? (sticker ? "Sticker" : "GIF")}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          width={box?.width}
          height={box?.height}
          onLoad={() => setLoaded(true)}
          onError={() => setErr(true)}
          className={cn(
            "absolute inset-0 h-full w-full select-none transition-opacity duration-150",
            fill && !sticker ? "object-cover" : "object-contain",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {err && (
        <div aria-label={title ?? "Unavailable"} className="absolute inset-0 grid place-items-center text-4xl">
          <span className="drop-shadow-sm">{fallbackEmoji(title, category)}</span>
        </div>
      )}
      {frozen && !err && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white">
          <Play className="ml-0.5 h-3 w-3 fill-current" />
        </span>
      )}
    </div>
  );
});

/** A sent GIF / sticker from its stored shape (message attachment, comment, post). */
export function SentMediaView({
  m, max, className,
}: {
  m: { kind?: string | null; url: string; preview?: string | null; still?: string | null; width?: number | null; height?: number | null; title?: string | null; name?: string | null; category?: string | null };
  max?: number;
  className?: string;
}) {
  return (
    <MediaView
      kind={m.kind === "sticker" ? "sticker" : "gif"}
      src={m.url}
      preview={m.preview}
      still={m.still}
      width={m.width}
      height={m.height}
      title={m.title ?? m.name}
      category={m.category}
      max={max}
      className={className}
    />
  );
}
