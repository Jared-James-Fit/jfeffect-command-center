/**
 * An automated post's picture (postArtCard): its 4:5 Instagram card,
 * painted on the phone that shows it and kept, so it's painted once: in
 * memory for the visit and in the browser's Cache Storage for the next
 * ones, keyed by what's on it (a new caption or a new week's numbers make a
 * new picture; POST_ART_VERSION repaints everything after a change to the
 * cards' look). One paint at a time, in the order asked, a beat apart, so a
 * fast scroll never stacks them up or holds a frame. The same File is what
 * Save image and Share to Instagram send.
 *
 * Small on purpose (no painters here): the grid and Home's shelf read it.
 */
import type { CommunityPost } from "@/lib/community";
import { SERIES_LABEL, extraBirthday, extraFeature, extraHoliday } from "@/lib/community";
import { extraLesson } from "@/lib/lessons";
import type { IgCard } from "@/lib/instagram-export";

/** Bump when a card's look changes: every phone paints its pictures again. */
export const POST_ART_VERSION = 1;

export type PostArt = { key: string; url: string; file: File };

const CACHE_NAME = "jf-post-art";
const MAX_MEMORY = 80;
/** Pictures kept on the phone between visits (about 200 KB each). */
const MAX_STORED = 160;

/** Cards whose numbers are in the viewer's unit. */
const UNIT_CARDS: ReadonlySet<IgCard> = new Set<IgCard>(["wins", "recap", "workout"]);

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
  return post.series && post.series !== "holiday" ? SERIES_LABEL[post.series].name : "Coach post";
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
/*  Painting                                                           */
/* ------------------------------------------------------------------ */

let chain: Promise<unknown> = Promise.resolve();

/** One paint at a time, a frame apart. */
function queue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(
    () => new Promise<void>((r) => setTimeout(r, 16)).then(job),
    () => job(),
  );
  chain = run.catch(() => undefined);
  return run;
}

const pending = new Map<string, Promise<PostArt | null>>();

/** The picture from memory or the phone's store, without painting; null when it has to be painted. */
export function findPostArt(key: string, name: string): Promise<PostArt | null> {
  const hit = peekPostArt(key);
  if (hit) return Promise.resolve(hit);
  return readStored(key).then((blob) => (blob ? peekPostArt(key) ?? toArt(key, blob, name) : null));
}

/**
 * The picture: from memory, the phone's store, or painted (`paint`, queued).
 * Asked twice at once, it's made once. null when painting failed.
 */
export function loadPostArt(key: string, name: string, paint: () => Promise<Blob | null>): Promise<PostArt | null> {
  const hit = peekPostArt(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const job = (async () => {
    const stored = await readStored(key);
    if (stored) return peekPostArt(key) ?? toArt(key, stored, name);
    const blob = await queue(paint).catch(() => null);
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
  chain = Promise.resolve();
}
