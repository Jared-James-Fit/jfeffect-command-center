/**
 * Crew → Rankings theme music: "Main Event", one track for the whole of
 * Rankings (Monthly League and Hall of Strength alike), so switching boards or
 * audiences never restarts it.
 *
 * The track: dark cinematic trap in C minor at 144 BPM, a 32-bar loop
 * (53.3 s) made for JF Effect from public-domain (CC0) orchestral recordings
 * and drums designed for it, so it's ours outright. How it was made and the
 * licences are in scripts/rankings-music/ and docs/licenses/rankings-music.md.
 *
 * This module is the one controller for it. Everything that plays it goes
 * through `setRankingsMusic(on, fade)`:
 *  - one voice at a time, ever: asking again while it plays (or while it's
 *    fading out) brings the same voice back up, never a second copy;
 *  - gapless: the file is decoded once into an AudioBuffer and looped by the
 *    audio thread between LOOP_START and LOOP_END (the file carries half a
 *    second of the loop either side, so decoder padding never makes a gap);
 *  - fades in on the way in (from the bar before the downbeat, so the first
 *    impact lands at full level), fades out on the way out, and picks up
 *    where it stopped when it comes back within RESUME_MS;
 *  - on the app's sound engine (app-sounds.ts): the same context, master
 *    volume and limiter, and the "ambient" audio session (mixes with the
 *    athlete's own music, follows the silent switch); when the browser wants a
 *    tap first it starts on the first tap anywhere;
 *  - the file is fetched once (kept in Cache Storage, so it plays offline) and
 *    decoded only when Rankings opens; the decoded copy (~20 MB) is let go a
 *    few minutes after Rankings closes.
 */
import trackUrl from "@/assets/music/main-event.m4a?url";
import { appAudioContext, appSoundBus, wakeAppAudio } from "@/lib/app-sounds";
import { installMediaMusicHold } from "@/lib/music-hold";

export const RANKINGS_TRACK = {
  /** Bump with the file: the Cache Storage entry is keyed by it. */
  id: "main-event-v1",
  title: "Main Event",
  url: trackUrl as string,
  bpm: 144,
  bars: 32,
  /** The loop, in the file's seconds (encode.py: 0.5 s pre-roll, 2,560,000 samples at 48 kHz). */
  loopStart: 0.5,
  loopEnd: 0.5 + 2_560_000 / 48_000,
  /**
   * The file starts this far into the music (encode.py puts the loop point on
   * its quietest instant, where the jump back is inaudible): the music's own
   * time t is at file time loopStart + (t - rotation), wrapped.
   */
  rotation: 265_755 / 48_000,
  /**
   * Playback level. The file is mastered to -16 LUFS; this puts it near -25
   * LUFS at the default app volume: under the screen and the app's own sounds.
   */
  gain: 0.45,
} as const;

/** One bar, in seconds. */
export const BAR_SECONDS = (60 / RANKINGS_TRACK.bpm) * 4;
export const FADE_IN = 1.4;
export const FADE_OUT = 0.7;
/** Back on Rankings within this long: carry on from where it was. */
export const RESUME_MS = 2 * 60_000;
/** Let the decoded audio go this long after it was last wanted. */
export const DROP_AFTER_MS = 3 * 60_000;
const CACHE = "jf-music";

export type RankingsMusicStatus = "off" | "loading" | "waiting" | "playing";

type Ctx = AudioContext;
type Voice = {
  c: Ctx;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** context time the source started, and where in the file it started */
  startedAt: number;
  offset: number;
  /** a fade-out in progress (its stop timer) */
  stopping: ReturnType<typeof setTimeout> | null;
};

let wanted = false;
let voice: Voice | null = null;
let bytes: ArrayBuffer | null = null;
let bytesP: Promise<ArrayBuffer | null> | null = null;
let buffer: AudioBuffer | null = null;
let bufferP: Promise<AudioBuffer | null> | null = null;
let dropTimer: ReturnType<typeof setTimeout> | null = null;
let waitingFor: { c: Ctx; on: () => void } | null = null;
let resumeAt: { offset: number; at: number } | null = null;
let status: RankingsMusicStatus = "off";
const listeners = new Set<(s: RankingsMusicStatus) => void>();

function setStatus(s: RankingsMusicStatus) {
  if (s === status) return;
  status = s;
  listeners.forEach((l) => l(s));
}
export function rankingsMusicStatus(): RankingsMusicStatus {
  return status;
}
export function subscribeRankingsMusic(fn: (s: RankingsMusicStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Where a voice is in the file now, looped into the loop's range. */
export function loopPosition(offset: number, elapsed: number, start = RANKINGS_TRACK.loopStart, end = RANKINGS_TRACK.loopEnd): number {
  const p = offset + Math.max(0, elapsed);
  if (p < end) return p;
  const len = end - start;
  return start + ((((p - start) % len) + len) % len);
}

/** The file's time for a moment of the music (seconds from its first downbeat). */
export function fileTimeOf(musicTime: number): number {
  const { loopStart, loopEnd, rotation } = RANKINGS_TRACK;
  const len = loopEnd - loopStart;
  return loopStart + ((((musicTime - rotation) % len) + len) % len);
}

/** Where a fresh start begins: the bar before the music's downbeat, so the impact on one lands as the fade ends. */
export function freshStartOffset(): number {
  return fileTimeOf(-BAR_SECONDS);
}

/** Where to start: where it left off if that was recent, else the lead-in. */
export function startOffset(now: number, last: { offset: number; at: number } | null): number {
  if (last && now - last.at <= RESUME_MS && last.offset >= RANKINGS_TRACK.loopStart && last.offset < RANKINGS_TRACK.loopEnd) return last.offset;
  return freshStartOffset();
}

// ── getting the file ────────────────────────────────────────────────────────

/** A slow or data-saving connection: don't fetch music ahead of time (it still plays when Rankings opens). */
export function preloadAllowed(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  const conn = (nav as unknown as { connection?: { saveData?: boolean; effectiveType?: string } } | undefined)?.connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  return !/(^|-)2g$/.test(conn.effectiveType ?? "");
}

async function fetchBytes(): Promise<ArrayBuffer | null> {
  if (bytes) return bytes;
  bytesP ??= (async () => {
    const url = RANKINGS_TRACK.url;
    let cache: Cache | null = null;
    try {
      cache = typeof caches !== "undefined" ? await caches.open(CACHE) : null;
      const hit = await cache?.match(url);
      if (hit) return await hit.arrayBuffer();
    } catch {
      cache = null;
    }
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return null;
      if (cache) {
        try {
          await cache.put(url, res.clone());
          // older versions of the track
          for (const req of await cache.keys()) if (req.url !== new URL(url, location.href).href) void cache.delete(req);
        } catch { /* storage full or private mode: the HTTP cache still has it */ }
      }
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  })().then((b) => {
    bytes = b;
    bytesP = null;
    return b;
  });
  return bytesP;
}

async function decode(c: Ctx): Promise<AudioBuffer | null> {
  if (buffer) return buffer;
  bufferP ??= (async () => {
    const b = await fetchBytes();
    if (!b) return null;
    try {
      // decodeAudioData detaches what it's given: keep our copy for next time
      const copy = b.slice(0);
      return await new Promise<AudioBuffer>((resolve, reject) => {
        const p = c.decodeAudioData(copy, resolve, reject);
        if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(resolve, reject);
      });
    } catch {
      return null;
    }
  })().then((buf) => {
    buffer = buf;
    bufferP = null;
    return buf;
  });
  return bufferP;
}

/**
 * Fetch the track ahead of time (on Crew, in idle time), without decoding it.
 * Skipped on a slow or data-saving connection.
 */
export function prefetchRankingsMusic(): void {
  if (!preloadAllowed()) return;
  void fetchBytes();
}

/** Get it decoded (the Rankings tab pressed): it's ready by the time the tab opens. */
export function warmRankingsMusic(): void {
  const c = appAudioContext();
  if (c) void decode(c);
}

// ── the voice ───────────────────────────────────────────────────────────────

function rampTo(g: GainNode, c: Ctx, target: number, seconds: number) {
  const now = c.currentTime;
  const p = g.gain;
  try {
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + Math.max(0.02, seconds));
  } catch { /* gone */ }
}

function begin(c: Ctx, buf: AudioBuffer) {
  if (!wanted || voice) return;
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = RANKINGS_TRACK.loopStart;
    // a decoder that trimmed more than expected must still never loop past the end
    src.loopEnd = Math.min(RANKINGS_TRACK.loopEnd, buf.duration);
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(appSoundBus(c));
    const offset = startOffset(Date.now(), resumeAt);
    const t = c.currentTime + 0.03;
    src.start(t, offset);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(RANKINGS_TRACK.gain, t + FADE_IN);
    voice = { c, src, gain, startedAt: t, offset, stopping: null };
    installMediaMusicHold();
    setStatus("playing");
  } catch {
    setStatus("off");
  }
}

function stopWaiting() {
  if (!waitingFor) return;
  waitingFor.c.removeEventListener?.("statechange", waitingFor.on);
  waitingFor = null;
}

function scheduleDrop() {
  if (dropTimer) clearTimeout(dropTimer);
  dropTimer = setTimeout(() => {
    dropTimer = null;
    if (!wanted && !voice) buffer = null;
  }, DROP_AFTER_MS);
}

/**
 * The one switch: on while Rankings is on screen and the music should be
 * heard, off otherwise. `fade` is how long the way out takes.
 */
export function setRankingsMusic(on: boolean, fade = FADE_OUT): void {
  if (on) {
    wanted = true;
    if (dropTimer) {
      clearTimeout(dropTimer);
      dropTimer = null;
    }
    if (voice) {
      // still playing (or fading out): bring the same voice back up
      if (voice.stopping) {
        clearTimeout(voice.stopping);
        voice.stopping = null;
      }
      rampTo(voice.gain, voice.c, RANKINGS_TRACK.gain, FADE_IN * 0.6);
      setStatus("playing");
      return;
    }
    const c = appAudioContext();
    if (!c) return setStatus("off");
    if (!buffer) setStatus("loading");
    void decode(c).then((buf) => {
      if (!wanted || voice) return;
      if (!buf) return setStatus("off");
      if (c.state === "running") return begin(c, buf);
      // the browser wants a tap first: start on the first one (app-sounds wakes the context on every tap)
      setStatus("waiting");
      stopWaiting();
      const onState = () => {
        if (c.state !== "running") return;
        stopWaiting();
        begin(c, buf);
      };
      waitingFor = { c, on: onState };
      c.addEventListener?.("statechange", onState);
      wakeAppAudio();
    });
    return;
  }

  wanted = false;
  stopWaiting();
  scheduleDrop();
  const v = voice;
  if (!v) return setStatus("off");
  if (v.stopping) return;
  const now = v.c.currentTime;
  // pick up from where the fade ends, next time
  resumeAt = { offset: loopPosition(v.offset, now - v.startedAt + fade), at: Date.now() };
  rampTo(v.gain, v.c, 0, fade);
  v.stopping = setTimeout(() => {
    if (voice !== v) return;
    voice = null;
    try {
      v.src.stop();
    } catch { /* already stopped */ }
    try {
      v.src.disconnect();
      v.gain.disconnect();
    } catch { /* gone */ }
  }, (fade + 0.08) * 1000);
  setStatus("off");
}

/** For tests: forget everything. */
export function resetRankingsMusicForTests() {
  if (voice?.stopping) clearTimeout(voice.stopping);
  if (dropTimer) clearTimeout(dropTimer);
  stopWaiting();
  wanted = false;
  voice = null;
  bytes = null;
  bytesP = null;
  buffer = null;
  bufferP = null;
  dropTimer = null;
  resumeAt = null;
  status = "off";
  listeners.clear();
}
