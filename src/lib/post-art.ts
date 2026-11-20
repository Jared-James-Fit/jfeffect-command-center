/**
 * An automated post's picture (postArtCard): its 4:5 Instagram card,
 * painted on the phone that shows it and kept, so it's painted once: in
 * memory for the visit and in the browser's Cache Storage for the next
 * ones, keyed by what's on it (a new caption or a new week's numbers make a
 * new picture; POST_ART_VERSION repaints everything after a change to the
 * cards' look). One paint at a time, a beat apart, and the feed's only while
 * the screen is still (no finger down, no scroll for STILL_MS), nearest the
 * screen first: painting a card holds the phone's main thread, and an iPhone
 * that's busy while a swipe lands leaves the rest of that post unpainted
 * (black) until it's free. The same File is what Save image and Share to
 * Instagram send (those ask `urgent`: painted at once, whatever the screen).
 *
 * Small on purpose (no painters here): the grid and Home's shelf read it.
 */
import type { CommunityPost } from "@/lib/community";
import { SERIES_LABEL, extraBirthday, extraFeature, extraHoliday } from "@/lib/community";
import { extraLesson } from "@/lib/lessons";
import type { IgCard } from "@/lib/instagram-export";

/** Bump when a card's look changes: every phone paints its pictures again. */
export const POST_ART_VERSION = 4;

export type PostArt = { key: string; url: string; file: File };

const CACHE_NAME = "jf-post-art";
const MAX_MEMORY = 80;
/** Pictures kept on the phone between visits (about 200 KB each). */
const MAX_STORED = 160;

/**
 * Cards that can fall back to the viewer's unit: only a workout's, and only for
 * a weight its stats don't say the unit of. Every weight a card shows is in the
 * unit it was typed in with the other beside it, the same for everyone; the
 * crew's totals (Wins, the Recap) lead with the crew's unit (dual-weight.ts).
 */
const UNIT_CARDS: ReadonlySet<IgCard> = new Set<IgCard>(["workout"]);

/** FNV-1a, as base36: enough to tell two versions of a post apart. */
export function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Which picture this is: the post, its card, the unit (only where it shows), and a hash of everything painted on it. */
export function postArtKey(post: CommunityPost, card: IgCard, unit: "kg" | "lb"): string {
  const content = JSON.stringify([
    post.caption ?? null,
    post.quote ?? null,
    post.quote_author ?? null,
    post.series ?? null,
    post.series_data ?? null,
    post.series_extra ?? null,
    (post.mentions ?? []).map((m) => [m.user_id, m.name]),
  ]);
  return `v${POST_ART_VERSION}.${post.id}.${card}${UNIT_CARDS.has(card) ? `.${unit}` : ""}.${hashText(content)}`;
}

/** A words card's headline: the quote, else the caption's first line. */
function wordsHead(post: CommunityPost): string {
  if (post.quote?.trim()) return `“${post.quote.trim()}”`;
  const line = (post.caption ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  if (line) return line;
  return post.series && post.series !== "holiday" && post.series !== "daily_visual" ? SERIES_LABEL[post.series].name : "Coach post";
}

/** What the picture says, for screen readers. */
export function postArtAlt(post: CommunityPost, card: IgCard): string {
  switch (card) {
    case "lesson":
      return extraLesson(post)?.title ?? wordsHead(post);
    case "wins":
      return "Wednesday Wins: the crew's week in numbers";
    case "recap":
      return "Sunday Recap: the crew's week";
    case "feature":
      return extraFeature(post.series_extra)?.title ?? SERIES_LABEL.try_it_thursday.name;
    case "birthday": {
      const name = extraBirthday(post)?.name;
      return name ? `Happy birthday ${name}` : "Happy birthday";
    }
    case "holiday":
      return extraHoliday(post.series_extra)?.name ?? "Holiday";
    case "scene":
      return SERIES_LABEL.saturday_spirit.name;
    default:
      return wordsHead(post);
  }
}

/* ------------------------------------------------------------------ */
/*  Memory                                                             */
/* ------------------------------------------------------------------ */

const memory = new Map<string, PostArt>();

function remember(art: PostArt): PostArt {
  memory.delete(art.key);
  memory.set(art.key, art);
  while (memory.size > MAX_MEMORY) {
    const [oldest] = memory.keys();
    const gone = memory.get(oldest);
    memory.delete(oldest);
    // a picture already on screen keeps showing (it's decoded); a new one is read again
    if (gone) URL.revokeObjectURL(gone.url);
  }
  return art;
}

/** The picture, if it's ready right now (Save image needs it inside the tap). */
export function peekPostArt(key: string): PostArt | null {
  const art = memory.get(key);
  if (!art) return null;
  memory.delete(key);
  memory.set(key, art);
  return art;
}

function toArt(key: string, blob: Blob, name: string): PostArt {
  const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || "image/jpeg" });
  return remember({ key, url: URL.createObjectURL(file), file });
}

/* ------------------------------------------------------------------ */
/*  On the phone, between visits                                       */
/* ------------------------------------------------------------------ */

const cacheUrl = (key: string) => `${typeof location === "undefined" ? "https://app.invalid" : location.origin}/__post-art/${encodeURIComponent(key)}.jpg`;

let storeOpen: Promise<Cache | null> | null = null;

function store(): Promise<Cache | null> {
  if (storeOpen) return storeOpen;
  storeOpen = (async () => {
    try {
      if (typeof caches === "undefined") return null;
      const cache = await caches.open(CACHE_NAME);
      // once a visit: old versions out, and only the newest MAX_STORED kept
      void cache
        .keys()
        .then(async (reqs) => {
          const current = reqs.filter((r) => r.url.includes(`/__post-art/v${POST_ART_VERSION}.`));
          const stale = reqs.filter((r) => !current.includes(r));
          const extra = current.slice(0, Math.max(0, current.length - MAX_STORED));
          await Promise.all([...stale, ...extra].map((r) => cache.delete(r)));
        })
        .catch(() => undefined);
      return cache;
    } catch {
      // a private window, blocked site data: memory only
      return null;
    }
  })();
  return storeOpen;
}

async function readStored(key: string): Promise<Blob | null> {
  try {
    const cache = await store();
    const res = await cache?.match(cacheUrl(key));
    if (!res?.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

function keepStored(key: string, blob: Blob) {
  void store()
    .then((cache) => cache?.put(cacheUrl(key), new Response(blob, { headers: { "content-type": blob.type || "image/jpeg" } })))
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/*  Waiting for a still screen                                         */
/* ------------------------------------------------------------------ */

/** How long the screen has to be still (no finger down, no scroll) before the feed paints a card. */
export const STILL_MS = 250;
/** A finger "down" this long with nothing moving is a lost touchend (a system gesture took it): not a finger. */
const FINGER_STALE_MS = 4000;

let lastMove = Number.NEGATIVE_INFINITY;
let fingers = 0;
let watching = false;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Listen (once, passively) for what moves the screen: a scroll anywhere, a wheel, a finger. */
function watchMotion() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const moved = () => {
    lastMove = now();
  };
  const touch = (e: TouchEvent) => {
    fingers = e.touches.length;
    lastMove = now();
  };
  const opts = { passive: true, capture: true } as const;
  window.addEventListener("scroll", moved, opts);
  window.addEventListener("wheel", moved, opts);
  window.addEventListener("touchstart", touch, opts);
  window.addEventListener("touchmove", moved, opts);
  window.addEventListener("touchend", touch, opts);
  window.addEventListener("touchcancel", touch, opts);
}

/** Whether nothing is moving the screen and it's showing: no finger down and STILL_MS since the last scroll or touch (`at`, `last`: ms). */
export function stillScreen(at: number, last: number, down: number, hidden: boolean): boolean {
  if (hidden) return false;
  if (down > 0 && at - last < FINGER_STALE_MS) return false;
  return at - last >= STILL_MS;
}

function screenIsStill(): boolean {
  watchMotion();
  return stillScreen(now(), lastMove, fingers, typeof document !== "undefined" && document.hidden);
}

/** When to look again while the screen is moving: once it may have settled. */
function retryIn(): number {
  if (fingers > 0 || (typeof document !== "undefined" && document.hidden)) return 120;
  return Math.max(16, STILL_MS - (now() - lastMove));
}

/** Resolves once the screen has been still for STILL_MS. */
export function whenStill(): Promise<void> {
  watchMotion();
  return new Promise((done) => {
    const check = () => {
      if (screenIsStill()) return done();
      setTimeout(check, retryIn());
    };
    check();
  });
}

/* ------------------------------------------------------------------ */
/*  Painting                                                           */
/* ------------------------------------------------------------------ */

type Waiting = {
  /** Asked for by a tap (Save image, Share to Instagram): painted next, whatever the screen is doing. */
  urgent: boolean;
  /** How far its picture is from the screen, in px (0 on it); read when it's time to pick. */
  rank?: () => number;
  run: () => void;
};

/**
 * Which waiting paint goes next: anything asked for by a tap first (in the
 * order asked); else, only while the screen is still, the one nearest the
 * screen (the order asked breaks a tie). -1: nothing yet.
 */
export function nextPaint(list: readonly Pick<Waiting, "urgent" | "rank">[], still: boolean): number {
  const urgent = list.findIndex((w) => w.urgent);
  if (urgent >= 0) return urgent;
  if (!still || !list.length) return -1;
  let best = 0;
  let bestRank = Number.POSITIVE_INFINITY;
  list.forEach((w, i) => {
    let r = Number.POSITIVE_INFINITY;
    try {
      r = w.rank ? w.rank() : Number.POSITIVE_INFINITY;
    } catch {
      // its picture is gone from the page: last
    }
    if (!(r >= 0)) r = Number.POSITIVE_INFINITY;
    if (r < bestRank) {
      bestRank = r;
      best = i;
    }
  });
  return best;
}

const waiting: Waiting[] = [];
const waitingByKey = new Map<string, Waiting>();
let running = false;
let tick: ReturnType<typeof setTimeout> | null = null;

/** One paint at a time, a frame apart; the feed's wait for a still screen. */
function pump() {
  if (running || tick !== null || !waiting.length) return;
  tick = setTimeout(() => {
    tick = null;
    if (running || !waiting.length) return;
    const i = nextPaint(waiting, screenIsStill());
    if (i < 0) {
      // the screen is moving: look again once it may have settled
      tick = setTimeout(() => {
        tick = null;
        pump();
      }, retryIn());
      return;
    }
    const [job] = waiting.splice(i, 1);
    running = true;
    job.run();
  }, 16);
}

function schedule<T>(key: string, job: () => Promise<T>, opts: PaintOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const entry: Waiting = {
      urgent: !opts.whenStill,
      rank: opts.rank,
      run: () => {
        waitingByKey.delete(key);
        Promise.resolve()
          .then(job)
          .then(resolve, reject)
          .finally(() => {
            running = false;
            pump();
          });
      },
    };
    waiting.push(entry);
    waitingByKey.set(key, entry);
    pump();
  });
}

const pending = new Map<string, Promise<PostArt | null>>();

/** The picture from memory or the phone's store, without painting; null when it has to be painted. */
export function findPostArt(key: string, name: string): Promise<PostArt | null> {
  const hit = peekPostArt(key);
  if (hit) return Promise.resolve(hit);
  return readStored(key).then((blob) => (blob ? peekPostArt(key) ?? toArt(key, blob, name) : null));
}

export type PaintOptions = {
  /** The feed's own paint: only while the screen is still (no finger down, no scroll). Off: right away (a tap asked). */
  whenStill?: boolean;
  /** How far its picture is from the screen (px, 0 on it): the nearest is painted first. */
  rank?: () => number;
};

/**
 * The picture: from memory, the phone's store, or painted (`paint`, queued).
 * Asked twice at once, it's made once; asked by a tap while the feed's paint
 * of it waits for a still screen, it goes next. null when painting failed.
 */
export function loadPostArt(key: string, name: string, paint: () => Promise<Blob | null>, opts: PaintOptions = {}): Promise<PostArt | null> {
  const hit = peekPostArt(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) {
    const queued = waitingByKey.get(key);
    if (queued && !opts.whenStill) {
      queued.urgent = true;
      pump();
    }
    return inflight;
  }
  const job = (async () => {
    const stored = await readStored(key);
    if (stored) return peekPostArt(key) ?? toArt(key, stored, name);
    const blob = await schedule(key, paint, opts).catch(() => null);
    if (!blob) return null;
    keepStored(key, blob);
    return toArt(key, blob, name);
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** For tests: forget everything kept in memory. */
export function resetPostArt() {
  memory.forEach((a) => URL.revokeObjectURL(a.url));
  memory.clear();
  pending.clear();
  storeOpen = null;
  waiting.length = 0;
  waitingByKey.clear();
  running = false;
  if (tick !== null) clearTimeout(tick);
  tick = null;
  lastMove = Number.NEGATIVE_INFINITY;
  fingers = 0;
}
