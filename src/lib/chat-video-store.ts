// Chat videos kept on the phone, iMessage style.
//
// Streaming a clip on tap means the player has to connect, find the video's
// index and buffer enough to play without stalling before anything moves, and
// it does that again on every replay. iMessage plays instantly because the clip
// is already on the phone. Same here: clips up to PREFETCH_MAX_BYTES download
// quietly, one at a time, while they're on screen, are kept on disk (Cache
// Storage, keyed by storage path so the daily link refresh doesn't matter),
// and a tap plays the local copy. Bigger clips (old full-size uploads) still
// stream as before. A clip you send is kept from the file you picked, so it
// never downloads at all.
//
// A tap must start playback synchronously (iOS only allows fullscreen + sound
// inside the tap), so the local copy has to be an object URL ready BEFORE the
// tap: warmChatVideo() prepares it when the tile nears the screen, and
// localChatVideoUrl() hands it over at tap time.

export const PREFETCH_MAX_BYTES = 40 * 1024 * 1024;
const DISK_BUDGET_BYTES = 400 * 1024 * 1024;
/** Object URLs held ready for a tap; least recently used are released first. */
const MEMORY_BUDGET_BYTES = 120 * 1024 * 1024;
// NOT "jf-…": registerServiceWorker() deletes every "jf-" cache on launch.
// Sign-out clears this one explicitly (clearChatVideos).
const CACHE_NAME = "chat-videos-v1";
const INDEX_KEY = "jf-chat-videos-index-v1";
// Cache Storage keys must be URLs; this one never hits the network.
const KEY_ORIGIN = "https://chat-video.local/";

type Ready = { url: string; bytes: number; usedAt: number };
type IndexEntry = { bytes: number; usedAt: number };

const ready = new Map<string, Ready>();
const warming = new Map<string, Promise<void>>();
/** Turned out too big to keep (older full-size uploads): don't ask again this session. */
const tooBig = new Set<string>();
const listeners = new Set<() => void>();

type Job = { path: string; url: string; size?: number };
const queue: Job[] = [];
let active: { job: Job; abort: AbortController } | null = null;
let pausedUntil = 0;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

export function subscribeChatVideos(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Same as localChatVideoUrl, for rendering: doesn't count as a play. */
export function peekChatVideo(path?: string | null): string | undefined {
  return path ? ready.get(path)?.url : undefined;
}

/** The on-phone copy of this clip, ready to play, if there is one. */
export function localChatVideoUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  const r = ready.get(path);
  if (!r) return undefined;
  r.usedAt = Date.now();
  touchIndex(path, r.bytes);
  return r.url;
}

/** Skip downloads when the person asked the phone to save data. */
function dataSaver(): boolean {
  const c = (typeof navigator !== "undefined" ? (navigator as any).connection : null) as
    | { saveData?: boolean; effectiveType?: string }
    | null;
  return !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g");
}

/** Worth downloading ahead: small enough (or size unknown, checked when the download starts). */
export function shouldPrefetch(size: number | undefined, saveData = dataSaver()): boolean {
  if (saveData) return false;
  return size === undefined || (size > 0 && size <= PREFETCH_MAX_BYTES);
}

/**
 * Which held URLs to release to get back under `budget`, least recently used
 * first. Anything used in the last `graceMs` stays (it may be playing).
 */
export function pickReleases(
  entries: Array<[string, { bytes: number; usedAt: number }]>,
  budget: number,
  now: number,
  graceMs = 10 * 60_000,
): string[] {
  let total = entries.reduce((n, [, e]) => n + e.bytes, 0);
  const out: string[] = [];
  for (const [path, e] of [...entries].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
    if (total <= budget) break;
    if (now - e.usedAt < graceMs) continue;
    out.push(path);
    total -= e.bytes;
  }
  return out;
}

function hold(path: string, url: string, bytes: number) {
  const prev = ready.get(path);
  if (prev && prev.url !== url) URL.revokeObjectURL(prev.url);
  ready.set(path, { url, bytes, usedAt: Date.now() });
  for (const p of pickReleases(Array.from(ready.entries()), MEMORY_BUDGET_BYTES, Date.now())) {
    const r = ready.get(p);
    if (r) URL.revokeObjectURL(r.url);
    ready.delete(p);
  }
  notify();
}

/* ------------------------------ disk (Cache Storage) ------------------------------ */

function hasCacheStorage(): boolean {
  return typeof caches !== "undefined" && typeof caches.open === "function";
}
const keyFor = (path: string) => KEY_ORIGIN + encodeURI(path);

function readIndex(): Record<string, IndexEntry> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(INDEX_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeIndex(index: Record<string, IndexEntry>) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* noop */ }
}
function touchIndex(path: string, bytes: number) {
  const index = readIndex();
  if (!index[path]) return;
  index[path] = { bytes, usedAt: Date.now() };
  writeIndex(index);
}

async function saveToDisk(path: string, blob: Blob) {
  if (!hasCacheStorage()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(keyFor(path), new Response(blob, {
      headers: { "content-type": blob.type || "video/mp4", "content-length": String(blob.size) },
    }));
    const index = readIndex();
    index[path] = { bytes: blob.size, usedAt: Date.now() };
    // Keep the disk copy bounded: drop the clips watched longest ago.
    for (const p of pickReleases(Object.entries(index), DISK_BUDGET_BYTES, Date.now(), 0)) {
      delete index[p];
      void cache.delete(keyFor(p));
    }
    writeIndex(index);
  } catch { /* storage full or unavailable: it just streams next time */ }
}

async function loadFromDisk(path: string): Promise<boolean> {
  if (!hasCacheStorage() || !readIndex()[path]) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(keyFor(path));
    if (!res) return false;
    const blob = await res.blob();
    if (!blob.size) return false;
    hold(path, URL.createObjectURL(blob), blob.size);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ downloads ------------------------------ */

function pump() {
  if (active || !queue.length) return;
  const wait = pausedUntil - Date.now();
  if (wait > 0) {
    if (!resumeTimer) resumeTimer = setTimeout(() => { resumeTimer = null; pump(); }, wait);
    return;
  }
  // Newest request first: the clips at the bottom of the chat are the ones being looked at.
  const job = queue.pop()!;
  if (ready.has(job.path)) { pump(); return; }
  const abort = new AbortController();
  active = { job, abort };
  void download(job, abort.signal).finally(() => {
    active = null;
    pump();
  });
}

async function download(job: Job, signal: AbortSignal) {
  try {
    const res = await fetch(job.url, { signal, priority: "low" } as RequestInit);
    if (!res.ok) return;
    const len = Number(res.headers.get("content-length") || 0);
    // Size wasn't known up front (older clips): don't pull a huge original.
    if (len > PREFETCH_MAX_BYTES) {
      tooBig.add(job.path);
      try { await res.body?.cancel(); } catch { /* noop */ }
      return;
    }
    const blob = await res.blob();
    if (blob.size > PREFETCH_MAX_BYTES) tooBig.add(job.path);
    if (signal.aborted || !blob.size || blob.size > PREFETCH_MAX_BYTES) return;
    hold(job.path, URL.createObjectURL(blob), blob.size);
    void saveToDisk(job.path, blob);
  } catch {
    // Aborted (someone started streaming a clip) or offline: it goes back in line on the next look.
  }
}

/**
 * Make this clip play from the phone. Uses the disk copy if there is one,
 * otherwise queues a background download (when small enough). Safe to call
 * repeatedly; the tile calls it when it comes near the screen.
 */
export function warmChatVideo(path: string | null | undefined, opts: { url?: string; size?: number }) {
  if (!path || ready.has(path) || warming.has(path) || tooBig.has(path)) return;
  if (typeof window === "undefined" || typeof URL.createObjectURL !== "function") return;
  const p = (async () => {
    if (await loadFromDisk(path)) return;
    if (!opts.url || opts.url.startsWith("blob:") || !shouldPrefetch(opts.size)) return;
    if (queue.some((j) => j.path === path) || active?.job.path === path) return;
    queue.push({ path, url: opts.url, size: opts.size });
    pump();
  })().finally(() => warming.delete(path));
  warming.set(path, p);
}

/** The sender's own clip: keep the picked file, so it plays (and replays) without downloading. */
export function keepChatVideo(path: string, file: Blob) {
  if (typeof window === "undefined" || typeof URL.createObjectURL !== "function") return;
  if (!file.size || file.size > PREFETCH_MAX_BYTES) return;
  hold(path, URL.createObjectURL(file), file.size);
  void saveToDisk(path, file);
}

/**
 * Someone is about to stream a clip that isn't local yet: stop background
 * downloads for a while so they don't compete for the connection.
 */
export function pauseChatVideoPrefetch(ms = 20_000) {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
  if (active) {
    const { job, abort } = active;
    abort.abort();
    // Back in line (first after the pause); it restarts from the beginning then.
    queue.push(job);
  }
}

/** Sign-out: forget every clip, in memory and on disk. */
export function clearChatVideos() {
  for (const r of ready.values()) URL.revokeObjectURL(r.url);
  ready.clear();
  tooBig.clear();
  queue.length = 0;
  active?.abort.abort();
  try { localStorage.removeItem(INDEX_KEY); } catch { /* noop */ }
  if (hasCacheStorage()) void caches.delete(CACHE_NAME).catch(() => {});
  notify();
}
