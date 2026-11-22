import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSignedUrlCache, localSignedUrlStorage } from "@/lib/signed-url-cache";
import { cn } from "@/lib/utils";
import { AvatarImage } from "@/components/ui/avatar";
import { useMediaViewer } from "@/components/media-viewer";
import { fullAvatarPath } from "@/lib/photo-zoom";

/**
 * Photos' links (the private `avatars` bucket): signed for a day and kept on
 * the phone across launches, like Crew's (community-media.ts) and the chat's,
 * so a reopened app shows the same addresses from the phone's cache instead of
 * downloading every face again; and faces asked for in the same moment (the
 * story rail, a page of posts, a chat list) are signed in one request, never
 * one each. Refreshed an hour before they expire; cleared on sign-out.
 */
export const AVATAR_SIGN_SECONDS = 24 * 3600;
export const AVATAR_URLS_STORAGE_KEY = "jf-avatar-signed-urls-v1";
export const avatarUrlCache = createSignedUrlCache(
  async (paths) => {
    const { data, error } = await supabase.storage.from("avatars").createSignedUrls(paths, AVATAR_SIGN_SECONDS);
    if (error) throw error;
    const out: Record<string, string> = {};
    for (const row of data ?? []) if (row?.path && row.signedUrl) out[row.path] = row.signedUrl;
    return out;
  },
  { ttlMs: (AVATAR_SIGN_SECONDS - 3600) * 1000, storage: localSignedUrlStorage(AVATAR_URLS_STORAGE_KEY), maxStored: 400 },
);

/** Signed-in user changed (sign-out): forget every link, in memory and on disk. */
export function clearAvatarSignedUrls() {
  avatarUrlCache.clear();
}

let batch: Set<string> | null = null;
let batchDone: Promise<void> = Promise.resolve();
/** Faces asked for in the same moment go in one request. */
function signWithOthers(path: string): Promise<void> {
  if (!batch) {
    const b = new Set<string>();
    batch = b;
    batchDone = new Promise<void>((r) => setTimeout(r, 0)).then(() => {
      batch = null;
      return avatarUrlCache.ensure([...b]);
    });
  }
  batch.add(path);
  return batchDone;
}

const isLink = (v: string) => /^https?:\/\//i.test(v) || v.startsWith("data:");

async function resolveAvatarUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (isLink(value)) return value;
  const hit = avatarUrlCache.get(value);
  if (hit) return hit;
  await signWithOthers(value);
  return avatarUrlCache.get(value) ?? null;
}

/** A URL to show right away (a link as is, or a signed one still cached), else null. */
function readyAvatarUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  if (isLink(src)) return src;
  return avatarUrlCache.get(src) ?? null;
}

/** A photo's URL to show: a path in `avatars` signed (and cached), a link as is. */
export function useAvatarSrc(src: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => readyAvatarUrl(src));
  useEffect(() => {
    let cancelled = false;
    const ready = readyAvatarUrl(src);
    setUrl(ready);
    if (ready || !src) return;
    resolveAvatarUrl(src).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  return url;
}

/**
 * The photo inside a ui/avatar `<Avatar>` (its `AvatarFallback` shows until it
 * loads or when there's none). Photos are stored as paths in the private
 * `avatars` bucket, so a raw `<AvatarImage src={path}>` never loads.
 */
export function AvatarPhoto({ src, alt }: { src: string | null | undefined; alt: string }) {
  const url = useAvatarSrc(src);
  return url ? <AvatarImage src={url} alt={alt} /> : null;
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Tone = "neutral" | "primary" | "accent";

export interface UserAvatarProps {
  /** Storage path in the `avatars` bucket, OR an absolute URL, OR null. */
  src?: string | null;
  /** Full name — used for initials fallback and alt text. */
  name?: string | null;
  /** Pixel size of the circle. Defaults to 36. */
  size?: number;
  /** Visual tone for the initials fallback. */
  tone?: Tone;
  className?: string;
  /**
   * Tap the avatar to open the photo viewer (photo-viewer.tsx: full screen,
   * pinch and double-tap to zoom, swipe away). Default true; off where a tap
   * means something else (opens their profile, a story, a list row).
   */
  expandable?: boolean;
}

/**
 * Universal user avatar. Resolves Supabase storage paths to signed URLs,
 * accepts absolute URLs as-is, and falls back to clean circular initials
 * (never a broken-image icon).
 */
export function UserAvatar({
  src,
  name,
  size = 36,
  tone = "neutral",
  className,
  expandable = true,
}: UserAvatarProps) {
  const [url, setUrl] = useState<string | null>(() => readyAvatarUrl(src));
  const [failed, setFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const viewer = useMediaViewer();

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setImgLoaded(false);
    if (!src) {
      setUrl(null);
      return;
    }
    if (/^https?:\/\//i.test(src) || src.startsWith("data:")) {
      setUrl(src);
      return;
    }
    resolveAvatarUrl(src).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const initials = getInitials(name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  const toneClass =
    tone === "primary"
      ? "bg-primary/15 text-primary"
      : tone === "accent"
      ? "bg-accent/30 text-accent-foreground"
      : "bg-secondary text-foreground";

  const canExpand = expandable && !!url && !failed;
  const Tag: any = canExpand ? "button" : "div";

  const handleClick = canExpand
    ? (e: React.MouseEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        // where the face sits, without the press's own shrink
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const w = el.offsetWidth || r.width;
        const h = el.offsetHeight || r.height;
        const full = fullAvatarPath(src);
        viewer.open(url!, {
          alt: name ? `${name}'s photo` : "Profile photo",
          shape: "circle",
          from: { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h },
          caption: name ?? null,
          fallback: initials,
          // a Crew photo's full-size copy, when it has one (the 512 px face stays until it's in)
          better: full ? () => resolveAvatarUrl(full) : null,
        });
      }
    : undefined;

  return (
    <>
      <Tag
        type={canExpand ? "button" : undefined}
        onClick={handleClick}
        className={cn(
          "relative shrink-0 overflow-hidden rounded-full",
          canExpand &&
            "cursor-zoom-in transition-transform duration-150 hover:scale-[1.04] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className,
        )}
        style={{ width: size, height: size }}
        aria-label={canExpand ? (name ? `View ${name}'s photo` : "View profile photo") : name ?? "User"}
      >
        {/* Base initials — always rendered so there's never a blank state */}
        <div
          className={cn(
            "absolute inset-0 grid h-full w-full place-items-center font-bold leading-none",
            toneClass,
          )}
          style={{ fontSize }}
        >
          {initials}
        </div>

        {/* Subtle shimmer overlay while image is resolving/loading */}
        {url && !failed && !imgLoaded && (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0.18) 55%, transparent 60%)",
              backgroundSize: "200% 100%",
              animation: "avatar-shimmer 1.6s ease-in-out infinite",
              mixBlendMode: "overlay",
            }}
          />
        )}

        {/* Loaded image fades in on top */}
        {url && !failed && (
          <img
            src={url}
            alt={name ?? ""}
            loading={size >= 48 ? "eager" : "lazy"}
            decoding="async"
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
              imgLoaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={() => setImgLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </Tag>
    </>
  );
}
