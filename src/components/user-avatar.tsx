import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Module-level signed URL cache so list views with many avatars don't refetch.
const cache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string | null>>();
const TTL_MS = 55 * 60 * 1000; // refresh just before the 60-min signed URL expires

async function resolveAvatarUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  const now = Date.now();
  const hit = cache.get(value);
  if (hit && hit.expiresAt > now) return hit.url;
  if (inflight.has(value)) return inflight.get(value)!;
  const p = (async () => {
    const { data } = await supabase.storage.from("avatars").createSignedUrl(value, 60 * 60);
    const url = data?.signedUrl ?? null;
    if (url) cache.set(value, { url, expiresAt: now + TTL_MS });
    inflight.delete(value);
    return url;
  })();
  inflight.set(value, p);
  return p;
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
  /** Add a thin border ring. */
  ring?: boolean;
  className?: string;
  /** Tap the avatar to open a full-size lightbox. Default true. */
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
  ring = false,
  className,
  expandable = true,
}: UserAvatarProps) {
  const [url, setUrl] = useState<string | null>(() => {
    if (!src) return null;
    if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
    const hit = cache.get(src);
    return hit && hit.expiresAt > Date.now() ? hit.url : null;
  });
  const [failed, setFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [open, setOpen] = useState(false);

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
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    : undefined;

  return (
    <>
      <Tag
        type={canExpand ? "button" : undefined}
        onClick={handleClick}
        className={cn(
          "relative shrink-0 overflow-hidden rounded-full",
          ring && "ring-1 ring-border",
          canExpand &&
            "cursor-zoom-in transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className,
        )}
        style={{ width: size, height: size }}
        aria-label={canExpand ? `View ${name ?? "profile"} photo` : name ?? "User"}
      >
        {url && !failed ? (
          <img
            src={url}
            alt={name ?? ""}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className={cn(
              "grid h-full w-full place-items-center font-bold leading-none",
              toneClass,
            )}
            style={{ fontSize }}
          >
            {initials}
          </div>
        )}
      </Tag>
      {canExpand && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-[92vw] border-0 bg-transparent p-0 shadow-none sm:max-w-lg">
            <img
              src={url!}
              alt={name ?? "Profile picture"}
              className="mx-auto max-h-[80vh] w-auto rounded-2xl object-contain shadow-2xl"
            />
            {name && (
              <div className="mt-3 text-center text-sm font-semibold text-white drop-shadow">
                {name}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
