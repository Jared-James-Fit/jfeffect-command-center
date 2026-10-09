import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Images, Play, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { MAX_SLIDES, fitSlides, slideThumbPath, type PostSlide } from "@/lib/community";
import { pickMedia, releasePicked, removeCommunityFiles, uploadPicked, type PickedMedia } from "@/lib/community-media";
import { useSlideThumbUrls } from "@/lib/community.queries";

/** Uploads at once. Three keeps a phone connection busy without starving any one file. */
const PARALLEL = 3;

export type TrayItem = {
  id: string;
  kind: "image" | "video";
  status: "preparing" | "uploading" | "done" | "error";
  progress: number;
  /** Local preview (just picked / shot). */
  preview: string | null;
  /** Once uploaded (or when it was already on the post). */
  slide: PostSlide | null;
  /** Already on the saved post: its files only go once the post is saved without it. */
  existing: boolean;
};

type Job = { id: string; file?: File; picked?: PickedMedia; promise: Promise<PostSlide | null>; resolve: (s: PostSlide | null) => void };

/**
 * The carousel being built in the share studio: every slide after the
 * first. Each one starts uploading the moment it's added (three at a time),
 * so by the time the caption's written, Post only has to save. Remove one
 * and its upload is thrown away; close without posting and so is everything
 * new. Slides already on the post are kept until the post is saved without
 * them.
 */
export function useSlideTray({ open, initial, resetKey, coverCount }: { open: boolean; initial: PostSlide[] | null | undefined; resetKey: string; coverCount: number }) {
  const { user } = useAuth();
  const [items, setItems] = useState<TrayItem[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const removed = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback((id: string, p: Partial<TrayItem>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  // Start from the post's own slides (editing, not duplicating). Fresh per post.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!open || seeded.current === resetKey) return;
    seeded.current = resetKey;
    // (anything added while the post was still loading stays, after its slides)
    setItems((list) => [
      ...(initial ?? []).map((s, i): TrayItem => ({ id: `existing-${i}-${s.path}`, kind: s.type, status: "done", progress: 100, preview: null, slide: s, existing: true })),
      ...list.filter((it) => !it.existing),
    ]);
  }, [open, resetKey, initial]);

  const pump = useCallback(() => {
    while (active.current < PARALLEL && queue.current.length) {
      const id = queue.current.shift()!;
      const job = jobs.current.get(id);
      if (!job?.picked || removed.current.has(id) || !user?.id) {
        job?.resolve(null);
        continue;
      }
      active.current += 1;
      patch(id, { status: "uploading", progress: 0 });
      uploadPicked(job.picked, user.id, (pct) => patch(id, { progress: pct }))
        .then(async (up) => {
          const slide: PostSlide = { path: up.media_path, thumb: up.media_thumb_path, type: up.media_type, width: up.media_width, height: up.media_height };
          // removed while it was uploading: throw it away
          if (removed.current.has(id)) {
            await removeCommunityFiles([slide.path, slide.thumb]);
            job.resolve(null);
            return;
          }
          patch(id, { status: "done", progress: 100, slide });
          job.resolve(slide);
        })
        .catch(() => {
          patch(id, { status: "error" });
          job.resolve(null);
        })
        .finally(() => {
          active.current -= 1;
          pump();
        });
    }
  }, [patch, user?.id]);

  /** A slide's "done" promise exists from the moment it's added, so Post can wait on one still being read. */
  const defer = (id: string, picked?: PickedMedia): Job => {
    let resolve!: (s: PostSlide | null) => void;
    const promise = new Promise<PostSlide | null>((r) => (resolve = r));
    const job: Job = { id, picked, promise, resolve };
    jobs.current.set(id, job);
    return job;
  };
  const enqueue = useCallback(
    (id: string, picked: PickedMedia) => {
      const job = jobs.current.get(id);
      // a retry gets a fresh promise; the first go uses the one made when it was added
      if (!job || job.picked) defer(id, picked);
      else job.picked = picked;
      queue.current.push(id);
      pump();
    },
    [pump],
  );

  /** Add photos / videos (in the order given), up to 10 on the post and 3 videos. */
  const add = useCallback(
    async (files: File[]) => {
      const current = [...Array.from({ length: coverCount }, () => ({ kind: "image" as const })), ...itemsRef.current.map((it) => ({ kind: it.kind }))];
      const tagged = files.map((file) => ({ file, kind: (file.type.startsWith("video/") ? "video" : "image") as "image" | "video" }));
      const fit = fitSlides(current, tagged);
      if (fit.reason) toast.message(fit.reason, { description: fit.dropped === 1 ? "One wasn't added." : `${fit.dropped} weren't added.` });
      const fresh = fit.take.map(({ file, kind }) => ({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, kind }));
      setItems((list) => [...list, ...fresh.map((f) => ({ id: f.id, kind: f.kind, status: "preparing" as const, progress: 0, preview: null, slide: null, existing: false }))]);
      for (const f of fresh) defer(f.id);
      // read them one at a time (decoding is the heavy bit); each uploads as soon as it's ready
      for (const f of fresh) {
        const res = await pickMedia(f.file);
        if (removed.current.has(f.id)) {
          if (res.ok) releasePicked(res.media);
          jobs.current.get(f.id)?.resolve(null);
          continue;
        }
        if (!res.ok) {
          toast.error(res.reason);
          removed.current.add(f.id);
          jobs.current.get(f.id)?.resolve(null);
          setItems((list) => list.filter((it) => it.id !== f.id));
          continue;
        }
        patch(f.id, { preview: res.media.kind === "image" ? res.media.previewUrl : (res.media.thumb ? URL.createObjectURL(res.media.thumb) : null) });
        enqueue(f.id, res.media);
      }
    },
    [coverCount, enqueue, patch],
  );

  const remove = useCallback((id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it) return;
    removed.current.add(id);
    if (it.status === "preparing" || it.status === "error") jobs.current.get(id)?.resolve(null);
    setItems((list) => list.filter((x) => x.id !== id));
    // a new upload that already landed goes now; one still going is thrown away when it lands
    if (!it.existing && it.status === "done" && it.slide) void removeCommunityFiles([it.slide.path, it.slide.thumb]);
    const job = jobs.current.get(id);
    if (it.preview?.startsWith("blob:") && it.preview !== job?.picked?.previewUrl) URL.revokeObjectURL(it.preview);
    if (job?.picked) releasePicked(job.picked);
  }, []);

  const retry = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (!job?.picked) return;
      enqueue(id, job.picked);
    },
    [enqueue],
  );

  /**
   * Everything uploaded, in order (failed ones get one more go). Throws if
   * something still won't go up, so nothing is posted half done.
   */
  const ready = useCallback(async (): Promise<PostSlide[]> => {
    for (const it of itemsRef.current) if (it.status === "error") retry(it.id);
    // (in order; anything still being read or uploading is waited for)
    const list = itemsRef.current;
    const out: PostSlide[] = [];
    let failed = 0;
    for (const it of list) {
      if (it.slide) {
        out.push(it.slide);
        continue;
      }
      const s = await jobs.current.get(it.id)?.promise;
      if (s) out.push(s);
      else if (!removed.current.has(it.id)) failed += 1;
    }
    if (failed) throw new Error(failed === 1 ? "One photo didn't upload. Tap it to try again or remove it." : `${failed} didn't upload. Tap them to try again or remove them.`);
    return out;
  }, [retry]);

  const releaseAll = useCallback(() => {
    for (const job of jobs.current.values()) if (job.picked) releasePicked(job.picked);
    for (const it of itemsRef.current) if (it.preview?.startsWith("blob:")) URL.revokeObjectURL(it.preview);
    jobs.current.clear();
    queue.current = [];
  }, []);

  /** Posted: the files belong to the post now. */
  const commit = useCallback(() => {
    releaseAll();
    removed.current.clear();
    seeded.current = null;
    // now, not on the next render: nothing may treat these as leftovers
    itemsRef.current = [];
    setItems([]);
  }, [releaseAll]);

  /** Closed without posting: new uploads go (landed now, in-flight when they land). */
  const discard = useCallback(() => {
    const landed = itemsRef.current.filter((it) => !it.existing && it.slide).flatMap((it) => [it.slide!.path, it.slide!.thumb]);
    for (const it of itemsRef.current) if (!it.existing && !it.slide) removed.current.add(it.id);
    if (landed.length) void removeCommunityFiles(landed);
    releaseAll();
    seeded.current = null;
    itemsRef.current = [];
    setItems([]);
  }, [releaseAll]);

  // Unmounted without posting (some screens drop the studio instead of closing it): same as closing.
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useEffect(() => () => discardRef.current(), []);

  const uploading = items.filter((it) => it.status === "preparing" || it.status === "uploading").length;
  return { items, add, remove, retry, ready, commit, discard, uploading, total: coverCount + items.length, full: coverCount + items.length >= MAX_SLIDES };
}

export type SlideTrayState = ReturnType<typeof useSlideTray>;

/**
 * The strip under the photo: slide 1 (what's on screen), the rest, and
 * "+ Camera" / "+ Library" to add more (up to 10).
 */
export function SlideTray({ tray, cover, onCamera, onLibrary }: { tray: SlideTrayState; cover: string | null; onCamera: () => void; onLibrary: () => void }) {
  const urls = useSlideThumbUrls(tray.items.filter((it) => it.existing && it.slide).map((it) => it.slide!));
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-swipe-back>
      <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10 ring-2 ring-white" aria-label="Slide 1, on screen">
        {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
        <span className="absolute left-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-black/60 px-1 text-[9px] font-black">1</span>
      </div>
      {tray.items.map((it, i) => {
        const src = it.preview ?? (it.slide ? urls[slideThumbPath(it.slide) ?? ""] ?? null : null);
        const busy = it.status === "preparing" || it.status === "uploading";
        return (
          <div key={it.id} className="relative h-14 w-11 shrink-0">
            <button
              type="button"
              onClick={() => it.status === "error" && tray.retry(it.id)}
              className="relative block h-full w-full overflow-hidden rounded-lg bg-white/10"
              aria-label={it.status === "error" ? "Didn't upload. Tap to try again" : `Slide ${i + 2}`}
            >
              {src && <img src={src} alt="" className="h-full w-full object-cover" />}
              {it.kind === "video" && <Play className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow" />}
              <span className="absolute left-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-black/60 px-1 text-[9px] font-black">{i + 2}</span>
              {busy && (
                <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/50">
                  <span className="block h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.max(8, it.progress)}%` }} />
                </span>
              )}
              {it.status === "error" && (
                <span className="absolute inset-0 grid place-items-center bg-black/55">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                </span>
              )}
            </button>
            <button type="button" onClick={() => tray.remove(it.id)} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-black shadow" aria-label={`Remove slide ${i + 2}`}>
              <X className="h-3 w-3" strokeWidth={3} />
            </button>
          </div>
        );
      })}
      {!tray.full && (
        <>
          <button type="button" onClick={onCamera} className="grid h-14 w-11 shrink-0 place-items-center rounded-lg border border-dashed border-white/40 text-white/80 active:scale-95" aria-label="Add a photo with the camera">
            <Camera className="h-5 w-5" />
          </button>
          <button type="button" onClick={onLibrary} className="grid h-14 w-11 shrink-0 place-items-center rounded-lg border border-dashed border-white/40 text-white/80 active:scale-95" aria-label="Add from your library">
            <Images className="h-5 w-5" />
          </button>
        </>
      )}
      <span className={cn("shrink-0 pl-1 text-[11px] font-bold tabular-nums", tray.full ? "text-white" : "text-white/50")}>
        {tray.total}/{MAX_SLIDES}
      </span>
    </div>
  );
}
