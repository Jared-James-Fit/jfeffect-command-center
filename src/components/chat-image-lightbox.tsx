import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-screen in-app image viewer for chat attachments.
 *
 * Replaces the previous `<a href={src} target="_blank">` pattern which
 * navigated to the raw Supabase Storage URL (exposing the backend
 * domain and breaking the PWA session on mobile). Renders a fixed
 * overlay so we stay inside the conversation, preserve scroll position,
 * and keep signed-URL semantics — the URL passed in is already the
 * signed / authenticated download we would have opened externally.
 *
 * Native pinch-to-zoom keeps working because we render a plain <img>
 * with `touch-action: pinch-zoom` inside a scrollable container.
 */
export function ChatImageLightbox({
  src,
  alt,
  open,
  onClose,
}: {
  src: string | null | undefined;
  alt?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setErrored(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock background scroll while open so the chat doesn't jump.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? "Image"}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close image"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="relative flex h-full w-full items-center justify-center overflow-auto p-4"
        style={{ touchAction: "pinch-zoom" }}
        onClick={(e) => e.stopPropagation()}
      >
        {!loaded && !errored && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
            Loading image…
          </div>
        )}
        {errored ? (
          <div className="flex flex-col items-center gap-3 text-white/80">
            <div className="text-sm">Couldn’t load this image.</div>
            <button
              type="button"
              onClick={() => { setErrored(false); setLoaded(false); }}
              className="rounded-md border border-white/40 px-3 py-1 text-xs hover:bg-white/10"
            >
              Try again
            </button>
          </div>
        ) : (
          <img
            key={`${src}:${loaded ? "l" : "u"}`}
            src={src}
            alt={alt ?? ""}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className={cn(
              "max-h-full max-w-full select-none rounded object-contain",
              !loaded && "opacity-0",
            )}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}