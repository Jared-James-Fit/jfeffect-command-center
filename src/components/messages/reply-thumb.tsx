import { Image as ImageIcon, Play, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReplyMedia } from "@/lib/messages";

/** Small square preview of the photo/video being replied to. */
export function ReplyThumb({
  media, signedUrl, className,
}: {
  media: ReplyMedia;
  /** Signed URL for `media.path`; ignored when the media has a public url. */
  signedUrl?: string;
  className?: string;
}) {
  const src = media.url ?? signedUrl;
  const isVideo = media.type === "video";
  return (
    <span
      className={cn("relative block h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black/25", className)}
      aria-hidden="true"
    >
      {src && !isVideo && (
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
      )}
      {src && isVideo && (
        <video
          src={src.includes("#") ? src : `${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          className="pointer-events-none h-full w-full object-cover"
        />
      )}
      {!src && (
        <span className="grid h-full w-full place-items-center text-white/70">
          {isVideo ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
        </span>
      )}
      {isVideo && src && (
        <span className="absolute inset-0 grid place-items-center">
          <Play className="h-3.5 w-3.5 fill-white text-white drop-shadow" />
        </span>
      )}
    </span>
  );
}
