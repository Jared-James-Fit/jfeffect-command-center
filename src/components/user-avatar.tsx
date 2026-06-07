import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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
}: UserAvatarProps) {
  const [url, setUrl] = useState<string | null>(() => {
    if (!src) return null;
    if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
    const hit = cache.get(src);
    return hit && hit.expiresAt > Date.now() ? hit.url : null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
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

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full",
        ring && "ring-1 ring-border",
        className
      )}
      style={{ width: size, height: size }}
      aria-label={name ?? "User"}
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
            toneClass
          )}
          style={{ fontSize }}
        >
          {initials}
        </div>
      )}
    </div>
  );
}
