import { useState } from "react";
import { cn } from "@/lib/utils";
import { fallbackEmoji } from "@/lib/gif-fallback";

export function GifThumb({
  src,
  title,
  category,
  fallback,
  className,
  emojiClassName,
  alt,
}: {
  src?: string | null;
  title?: string | null;
  category?: string | null;
  fallback?: string | null;
  className?: string;
  emojiClassName?: string;
  alt?: string;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(src ? "loading" : "error");
  const emoji = fallback || fallbackEmoji(title, category);

  const showImg = !!src && state !== "error";
  const showSkeleton = showImg && state === "loading";
  const showEmoji = !showImg || state === "error";

  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-secondary/60 to-secondary/30", className)}>
      {showImg && (
        <img
          src={src!}
          alt={alt ?? title ?? ""}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-200",
            state === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {showSkeleton && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-secondary/80 via-secondary/40 to-secondary/80" />
      )}
      {showEmoji && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center select-none motion-safe:animate-[gif-bounce_1.8s_ease-in-out_infinite]",
            emojiClassName ?? "text-5xl",
          )}
        >
          <span className="drop-shadow-sm">{emoji}</span>
        </div>
      )}
    </div>
  );
}