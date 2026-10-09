import { useRef } from "react";
import { AlertCircle, ImagePlus, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_SLIDES, MAX_SLIDE_VIDEOS, slideThumbPath, type PostSlide } from "@/lib/community";
import { removeCommunityFiles } from "@/lib/community-media";
import { useSlideThumbUrls } from "@/lib/community.queries";
import { useSlideTray, type SlideTrayState } from "@/components/community/slide-tray";

/**
 * Photos and videos for a post being written or edited (coach posts,
 * scheduled birthday and daily posts, swapping the photos on your own post).
 * Same rules as sharing a workout: up to 10, at most 3 videos, each starts
 * uploading as soon as it's picked.
 */
export function useMediaDraft({ open, initial, key }: { open: boolean; initial: PostSlide[] | null | undefined; key: string }) {
  const tray = useSlideTray({ open, initial, resetKey: key, coverCount: 0 });
  const startPaths = (initial ?? []).flatMap((s) => [s.path, s.thumb]).filter((p): p is string => !!p);
  const changed = tray.items.some((it) => !it.existing) || tray.items.length !== (initial ?? []).length
    || tray.items.some((it, i) => it.slide?.path !== initial?.[i]?.path);
  return {
    tray,
    changed,
    /** Wait for every upload, save with the final list, then tidy: files the post no longer uses go. */
    async save(write: (media: PostSlide[]) => Promise<unknown>) {
      const media = await tray.ready();
      await write(media);
      const keep = new Set(media.flatMap((s) => [s.path, s.thumb]));
      const gone = startPaths.filter((p) => !keep.has(p));
      tray.commit();
      // (only your own uploads can be deleted; anyone else's simply stay put)
      if (gone.length) void removeCommunityFiles(gone);
      return media;
    },
    /** Closed without saving: new uploads are thrown away, the post keeps what it had. */
    discard: () => tray.discard(),
  };
}

export function MediaStrip({ tray, className, label = "Photos & videos" }: { tray: SlideTrayState; className?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const urls = useSlideThumbUrls(tray.items.filter((it) => it.existing && it.slide).map((it) => it.slide!));
  const videos = tray.items.filter((it) => it.kind === "video").length;
  return (
    <div className={cn("space-y-2", className)} data-media-strip>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {tray.total}/{MAX_SLIDES} · up to {MAX_SLIDE_VIDEOS} videos{videos ? ` (${videos})` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-swipe-back data-swipe-ignore>
        {tray.items.map((it, i) => {
          const src = it.preview ?? (it.slide ? urls[slideThumbPath(it.slide) ?? ""] ?? null : null);
          const busy = it.status === "preparing" || it.status === "uploading";
          return (
            <div key={it.id} className="relative h-20 w-16 shrink-0">
              <button
                type="button"
                onClick={() => it.status === "error" && tray.retry(it.id)}
                className="relative block h-full w-full overflow-hidden rounded-xl bg-muted"
                aria-label={it.status === "error" ? "Didn't upload. Tap to try again" : `${it.kind === "video" ? "Video" : "Photo"} ${i + 1}`}
              >
                {src && <img src={src} alt="" className="h-full w-full object-cover" />}
                {it.kind === "video" && <Play className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow" />}
                {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-black text-white">Cover</span>}
                {busy && (
                  <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/40">
                    <span className="block h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.max(8, it.progress)}%` }} />
                  </span>
                )}
                {it.status === "error" && (
                  <span className="absolute inset-0 grid place-items-center bg-black/55">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => tray.remove(it.id)}
                className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-foreground text-background shadow"
                aria-label={`Remove ${it.kind === "video" ? "video" : "photo"} ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" strokeWidth={3} />
              </button>
            </div>
          );
        })}
        {!tray.full && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground active:scale-95"
            aria-label="Add photos or videos"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-[10px] font-bold">Add</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void tray.add(files);
        }}
      />
    </div>
  );
}
