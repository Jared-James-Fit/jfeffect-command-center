import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Images, Play, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { MAX_SLIDES, fitSlides, slideThumbPath, type PostSlide } from "@/lib/community";
import { COMMUNITY_BUCKET, pickMedia, pickedSeconds, releasePicked, removeCommunityFiles, retrimPicked, uploadPicked, type PickedMedia } from "@/lib/community-media";
import { useSlideThumbUrls } from "@/lib/community.queries";
import { uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { CENTRED, clampFraming, frameFocus, type Framing } from "@/lib/photo-frame";
import { drawableSize, framedCanvas, type Drawable } from "@/lib/photo-frame-draw";
import { releaseCanvas } from "@/lib/canvas-memory";
import { formatClock, videoLimit, type VideoContext } from "@/lib/video-edit/limits";
import { looksLikeVideo } from "@/lib/video-edit/pick";
import { useVideoTrimmer } from "@/components/video-trimmer";

/** Uploads at once. Three keeps a phone connection busy without starving any one file. */
const PARALLEL = 3;

export type TrayItem = {
  id: string;
  kind: "image" | "video";
  status: "preparing" | "uploading" | "done" | "error";
  progress: number;
  /** Local preview (just picked / shot). */
  preview: string | null;
  /** A clip just picked or recorded: its local file, to play while you write the caption. */
  video?: string | null;
  /** The part of that clip that goes (null: all of it), and how long that runs. */
  trim?: { start: number; end: number } | null;
  seconds?: number | null;
  /** Once uploaded (or when it was already on the post). */
  slide: PostSlide | null;
  /** Already on the saved post: its files only go once the post is saved without it. */
  existing: boolean;
  /** Its size (px), once it's been read. */
  w?: number;
  h?: number;
  /** How it sits in the post's frame (drag / pinch in the studio; centred, just filling it, when unset). */
  framing?: Framing | null;
  /** A clip: the cover frame picked for it (replaces the automatic one when it's posted). */
  cover?: Blob | null;
};

/** A thumbnail's width at a shape: 720 px on its long side, like the ones picked photos get. */
const thumbWidth = (aspect: number) => Math.round(aspect >= 1 ? 720 : 720 * aspect);

/** A picked cover (a JPEG) as something a canvas can draw. */
function blobImage(b: Blob): Promise<{ img: HTMLImageElement; release: () => void } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(b);
    const img = new Image();
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

const jpeg = (c: HTMLCanvasElement, name: string) =>
  new Promise<File | null>((resolve) => c.toBlob((b) => resolve(b ? new File([b], name, { type: "image/jpeg" }) : null), "image/jpeg", 0.88));

/** A framed copy as a JPEG file (the canvas is released either way). */
async function framedFile(src: Drawable, framing: Framing, aspect: number, width: number, name: string): Promise<File | null> {
  const c = framedCanvas(src, framing, aspect, width);
  try {
    return await jpeg(c, name);
  } finally {
    releaseCanvas(c);
  }
}

/** A framed photo and its thumbnail: the big one cut once from the original, the small one drawn from it (one big canvas at a time). */
async function framedPhoto(src: Drawable, framing: Framing, aspect: number): Promise<{ main: File | null; thumb: File | null }> {
  const big = framedCanvas(src, framing, aspect, 1080);
  try {
    const main = await jpeg(big, "photo.jpg");
    const small = framedCanvas(big, { z: 1, cx: 0.5, cy: 0.5 }, aspect, thumbWidth(aspect));
    try {
      return { main, thumb: await jpeg(small, "thumb.jpg") };
    } finally {
      releaseCanvas(small);
    }
  } finally {
    releaseCanvas(big);
  }
}

/** Framed two at a time (a phone holds a few big canvases, not ten), kept in order. */
const FRAME_PARALLEL = 2;

type Job = { id: string; file?: File; picked?: PickedMedia; promise: Promise<PostSlide | null>; resolve: (s: PostSlide | null) => void; ctl?: AbortController };

/**
 * The carousel being built in the share studio: every slide after the
 * first. Each one starts uploading the moment it's added (three at a time),
 * so by the time the caption's written, Post only has to save. Remove one
 * and its upload is thrown away; close without posting and so is everything
 * new. Slides already on the post are kept until the post is saved without
 * them. A clip longer than its place allows opens the trimmer before it's
 * added; tap a clip in the strip to change which part goes (each clip keeps
 * its own selection).
 */
export function useSlideTray({ open, initial, resetKey, coverCount, videoContext = "post" }: { open: boolean; initial: PostSlide[] | null | undefined; resetKey: string; coverCount: number; videoContext?: VideoContext }) {
  const { user } = useAuth();
  const trimmer = useVideoTrimmer();
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
      const ctl = new AbortController();
      job.ctl = ctl;
      uploadPicked(job.picked, user.id, (pct) => patch(id, { progress: pct }), ctl.signal)
        .then(async (up) => {
          const slide: PostSlide = { path: up.media_path, thumb: up.media_thumb_path, type: up.media_type, width: up.media_width, height: up.media_height };
          // removed (or re-trimmed) while it was uploading: throw it away
          if (removed.current.has(id) || ctl.signal.aborted) {
            await removeCommunityFiles([slide.path, slide.thumb]);
            job.resolve(null);
            return;
          }
          patch(id, { status: "done", progress: 100, slide });
          job.resolve(slide);
        })
        .catch((e) => {
          // stopped on purpose: removed (nothing to wait for) or re-trimmed (the new selection's upload takes over)
          if (ctl.signal.aborted) {
            if (removed.current.has(id)) job.resolve(null);
            return;
          }
          patch(id, { status: "error" });
          if (job.picked?.kind === "video" && e?.message) toast.error(e.message);
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
      // read them one at a time (decoding is the heavy bit; a long clip opens the trimmer); each uploads as soon as it's ready
      const clips = fresh.filter((f) => f.kind === "video" || looksLikeVideo(f.file));
      for (const f of fresh) {
        const at = clips.indexOf(f);
        const res = await pickMedia(f.file, { context: videoContext, trim: trimmer.request, step: at >= 0 && clips.length > 1 ? { index: at + 1, count: clips.length } : undefined });
        if (removed.current.has(f.id)) {
          if (res.ok) releasePicked(res.media);
          jobs.current.get(f.id)?.resolve(null);
          continue;
        }
        if (!res.ok) {
          if (!res.cancelled) toast.error(res.reason);
          removed.current.add(f.id);
          jobs.current.get(f.id)?.resolve(null);
          setItems((list) => list.filter((it) => it.id !== f.id));
          continue;
        }
        patch(f.id, itemFields(res.media));
        enqueue(f.id, res.media);
      }
    },
    [coverCount, enqueue, patch, videoContext, trimmer.request],
  );

  /** Change which part of a clip goes: its upload restarts with the new selection. */
  const edit = useCallback(
    async (id: string) => {
      const job = jobs.current.get(id);
      const old = job?.picked;
      if (!job || !old?.video || removed.current.has(id)) return;
      const next = await retrimPicked(old, trimmer.request, videoContext);
      if (!next || removed.current.has(id)) {
        if (next) releasePicked(next);
        return;
      }
      // the old selection's upload stops; anything of it that landed goes
      job.ctl?.abort();
      const it = itemsRef.current.find((x) => x.id === id);
      if (it?.slide && !it.existing) void removeCommunityFiles([it.slide.path, it.slide.thumb]);
      if (it?.preview?.startsWith("blob:") && it.preview !== old.previewUrl) URL.revokeObjectURL(it.preview);
      releasePicked(old);
      // anything waiting on the old one (Post) waits on the new one instead
      const waiting = job.resolve;
      queue.current = queue.current.filter((q) => q !== id);
      const fresh = defer(id, next);
      void fresh.promise.then(waiting);
      // (a cover frame picked from the old selection gives way to the new one's first moment)
      patch(id, { ...itemFields(next), cover: null, slide: null, status: "preparing", progress: 0 });
      queue.current.push(id);
      pump();
    },
    [patch, pump, trimmer.request, videoContext],
  );

  // Somewhere stricter now (a post turned into a story): a clip that runs over its new limit opens the trimmer.
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(() => {
    const limit = videoLimit(videoContext);
    const over = itemsRef.current.filter((it) => it.video && it.seconds != null && it.seconds > limit + 0.25 && it.status !== "error");
    if (!over.length) return;
    void (async () => {
      for (const it of over) await editRef.current(it.id);
    })();
  }, [videoContext]);

  const remove = useCallback((id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it) return;
    removed.current.add(id);
    jobs.current.get(id)?.ctl?.abort();
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

  /** A clip's cover frame, picked by hand: shown in the strip now, uploaded with the post. */
  const setCover = useCallback(
    (id: string, cover: Blob) => {
      const it = itemsRef.current.find((x) => x.id === id);
      if (!it) return;
      const job = jobs.current.get(id);
      if (it.preview?.startsWith("blob:") && it.preview !== job?.picked?.previewUrl) URL.revokeObjectURL(it.preview);
      patch(id, { cover, preview: URL.createObjectURL(cover) });
    },
    [patch],
  );
  /** How a slide sits in the post's frame (drag / pinch in the studio). */
  const setFraming = useCallback((id: string, framing: Framing | null) => patch(id, { framing }), [patch]);

  /**
   * What's posted is what the studio's frame showed (Instagram's): a new photo
   * is baked to the post's shape (1080 wide, its thumbnail too) unless it's
   * already exactly that and untouched; a new clip goes up whole with its
   * frame (`focus`, framedMediaStyle shows just that part everywhere) and a
   * poster baked to it (the cover picked by hand, else its own first moment).
   * The files it replaces go. A slide already on the post stays as it is.
   * Anything that can't be made keeps the slide as it was uploaded.
   */
  const finish = useCallback(
    async (it: TrayItem, slide: PostSlide, shape: number | null): Promise<PostSlide> => {
      const uid = user?.id;
      if (it.existing || !uid) return slide;
      const picked = jobs.current.get(it.id)?.picked ?? null;
      const box = shape ? { w: shape, h: 1 } : null;
      const up = (file: File) => uploadLiftFileToStorage({ file, userId: uid, bucket: COMMUNITY_BUCKET }).then((r) => r.path);
      const done = (next: PostSlide) => {
        // posted again (a retry): nothing is made twice
        patch(it.id, { cover: null, framing: null, slide: next });
        return next;
      };
      try {
        if (it.kind === "image") {
          const src = picked?.drawable;
          if (!shape || !box || !src) return slide;
          const size = drawableSize(src);
          const f = clampFraming(it.framing ?? CENTRED, size, box);
          // already the post's shape and untouched: as it was uploaded
          if (Math.abs(size.w / size.h - shape) < 0.01 && f.z <= 1.001) return slide;
          const { main, thumb: small } = await framedPhoto(src, f, shape);
          if (!main) return slide;
          const [path, thumb] = await Promise.all([up(main), small ? up(small).catch(() => null) : Promise.resolve(null)]);
          void removeCommunityFiles([slide.path, slide.thumb]);
          return done({ ...slide, path, thumb, type: "image", width: 1080, height: Math.round(1080 / shape), focus: null });
        }
        // a clip: its cover (picked, else its own first moment), framed like the clip
        const own = it.cover ? await blobImage(it.cover) : null;
        const src: Drawable | null = own?.img ?? picked?.drawable ?? null;
        try {
          if (!shape || !box) {
            if (!it.cover) return slide;
            const thumb = await up(new File([it.cover], "cover.jpg", { type: "image/jpeg" }));
            if (slide.thumb) void removeCommunityFiles([slide.thumb]);
            return done({ ...slide, thumb });
          }
          const size = it.w && it.h ? { w: it.w, h: it.h } : src ? drawableSize(src) : { w: shape, h: 1 };
          const f = clampFraming(it.framing ?? CENTRED, size, box);
          const focus = frameFocus(f, shape);
          const poster = src ? await framedFile(src, f, shape, thumbWidth(shape), "poster.jpg") : null;
          const thumb = poster ? await up(poster).catch(() => null) : null;
          if (thumb && slide.thumb) void removeCommunityFiles([slide.thumb]);
          return done({ ...slide, thumb: thumb ?? slide.thumb, focus });
        } finally {
          own?.release();
        }
      } catch {
        // the slide still goes up as it was uploaded
        return slide;
      }
    },
    [patch, user?.id],
  );

  /**
   * Everything uploaded, in order (failed ones get one more go), each framed
   * at the post's shape (`shape`, w / h; null: a story's clip, as it is).
   * Throws if something still won't go up, so nothing is posted half done.
   */
  const ready = useCallback(
    async (shape: number | null = null): Promise<PostSlide[]> => {
      for (const it of itemsRef.current) if (it.status === "error") retry(it.id);
      // (in order; anything still being read or uploading is waited for)
      const list = itemsRef.current;
      const got: { it: TrayItem; slide: PostSlide }[] = [];
      let failed = 0;
      for (const it of list) {
        const s = it.slide ?? (await jobs.current.get(it.id)?.promise);
        if (s) got.push({ it: itemsRef.current.find((x) => x.id === it.id) ?? it, slide: s });
        else if (!removed.current.has(it.id)) failed += 1;
      }
      if (failed) throw new Error(failed === 1 ? "One photo didn't upload. Tap it to try again or remove it." : `${failed} didn't upload. Tap them to try again or remove them.`);
      // framed a couple at a time (each a small upload or two), kept in order
      const out: PostSlide[] = new Array(got.length);
      let next = 0;
      const worker = async () => {
        while (next < got.length) {
          const i = next++;
          out[i] = await finish(got[i].it, got[i].slide, shape);
        }
      };
      await Promise.all(Array.from({ length: Math.min(FRAME_PARALLEL, got.length) }, worker));
      return out;
    },
    [retry, finish],
  );

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

  /** Closed without posting: new uploads stop and go (landed now, in-flight when they land). */
  const discard = useCallback(() => {
    const landed = itemsRef.current.filter((it) => !it.existing && it.slide).flatMap((it) => [it.slide!.path, it.slide!.thumb]);
    for (const it of itemsRef.current) if (!it.existing && !it.slide) {
      removed.current.add(it.id);
      jobs.current.get(it.id)?.ctl?.abort();
    }
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
  return { items, add, remove, retry, edit, ready, commit, discard, setCover, setFraming, uploading, total: coverCount + items.length, full: coverCount + items.length >= MAX_SLIDES, trimmer: trimmer.element };
}

/** What the strip shows for a picked photo or clip. */
function itemFields(m: PickedMedia): Partial<TrayItem> {
  return {
    preview: m.kind === "image" ? m.previewUrl : (m.thumb ? URL.createObjectURL(m.thumb) : null),
    video: m.kind === "video" ? m.previewUrl : null,
    w: m.width,
    h: m.height,
    trim: m.video?.trim ?? null,
    seconds: pickedSeconds(m),
  };
}

export type SlideTrayState = ReturnType<typeof useSlideTray>;

/**
 * The strip under the photo: slide 1 (what's on screen), the rest, and
 * "+ Camera" / "+ Library" to add more (up to 10).
 */
export function SlideTray({
  tray,
  cover,
  onCamera,
  onLibrary,
  hasCover = true,
  selected = null,
  onSelect,
}: {
  tray: SlideTrayState;
  cover: string | null;
  onCamera: () => void;
  onLibrary: () => void;
  hasCover?: boolean;
  /** The slide being framed in the studio (null: slide 1). */
  selected?: string | null;
  /** Tap a slide to frame it (Instagram's): null is slide 1. Without it, a tap on a clip trims it. */
  onSelect?: (id: string | null) => void;
}) {
  const urls = useSlideThumbUrls(tray.items.filter((it) => it.existing && it.slide).map((it) => it.slide!));
  // a plain post of clips has no card or photo up front: its slides start at 1
  const first = hasCover ? 2 : 1;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-swipe-back>
      {hasCover && (
        <button
          type="button"
          onClick={() => onSelect?.(null)}
          className={cn("relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10", selected == null && "ring-2 ring-white")}
          aria-label={selected == null ? "Slide 1, on screen" : "Slide 1: tap to frame it"}
          aria-pressed={selected == null}
        >
          {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
          <span className="absolute left-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-black/60 px-1 text-[9px] font-bold">1</span>
        </button>
      )}
      {tray.items.map((it, i) => {
        const src = it.preview ?? (it.slide ? urls[slideThumbPath(it.slide) ?? ""] ?? null : null);
        const busy = it.status === "preparing" || it.status === "uploading";
        // a slide picked now can be framed (a tap puts it in the frame); one already on the post stays as it is
        const framable = !!onSelect && !it.existing && !!it.w && !!it.h && (it.kind === "image" ? !!it.preview : !!it.video);
        const on = selected === it.id;
        return (
          <div key={it.id} className="relative h-14 w-11 shrink-0">
            <button
              type="button"
              onClick={() => (it.status === "error" ? tray.retry(it.id) : framable ? onSelect?.(it.id) : it.video ? void tray.edit(it.id) : undefined)}
              className={cn("relative block h-full w-full overflow-hidden rounded-lg bg-white/10", on && "ring-2 ring-white")}
              aria-label={
                it.status === "error"
                  ? "Didn't upload. Tap to try again"
                  : framable
                    ? on
                      ? `Slide ${i + first}, on screen`
                      : `Slide ${i + first}: tap to frame it`
                    : it.video
                      ? `Clip ${i + first}: tap to trim`
                      : `Slide ${i + first}`
              }
              aria-pressed={framable ? on : undefined}
              data-tray-item={it.kind}
            >
              {src && <img src={src} alt="" className="h-full w-full object-cover" />}
              {it.kind === "video" &&
                (it.video && !framable ? (
                  <Scissors className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" />
                ) : (
                  <Play className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow" />
                ))}
              {it.seconds != null && !busy && it.status !== "error" && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-0.5 text-[8px] font-bold tabular-nums">{formatClock(it.seconds)}</span>}
              <span className="absolute left-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-black/60 px-1 text-[9px] font-bold">{i + first}</span>
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
            <button type="button" onClick={() => tray.remove(it.id)} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-black shadow" aria-label={`Remove slide ${i + first}`}>
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
