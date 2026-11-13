import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/*
 * A stand-in for an iPhone's <video>: sound only once the element has been
 * played from a tap (`gesture`), muted play always allowed.
 */
let gesture = false;
class FakeVideo {
  muted = false;
  paused = true;
  preload = "";
  className = "";
  playsInline = false;
  loop = false;
  style: Record<string, string> = {};
  allowed = false;
  attrs = new Map<string, string>();
  events: string[] = [];
  private listeners = new Map<string, Set<() => void>>();
  set src(v: string) {
    this.attrs.set("src", v);
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  play() {
    if (!this.muted && !this.allowed && !gesture)
      return Promise.reject({ name: "NotAllowedError" });
    if (gesture) this.allowed = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  remove() {}
  addEventListener(k: string, f: () => void) {
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    this.listeners.get(k)!.add(f);
  }
  removeEventListener(k: string, f: () => void) {
    this.listeners.get(k)?.delete(f);
  }
  dispatchEvent(e: { type: string }) {
    this.events.push(e.type);
    this.listeners.get(e.type)?.forEach((f) => f());
    return true;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("feed clips play with their sound", () => {
  beforeEach(() => {
    gesture = false;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => new FakeVideo(),
    };
  });
  afterEach(async () => {
    const pool = await import("@/lib/video-pool");
    pool.resetVideoPool();
    pool.setSoundWanted(() => true);
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it("reuses a handful of elements for the feed and three for full screen", async () => {
    const pool = await import("@/lib/video-pool");
    const got = Array.from({ length: pool.FEED_POOL + 1 }, () => pool.acquireFeedVideo());
    expect(new Set(got).size).toBe(pool.FEED_POOL + 1);
    pool.releaseFeedVideo(got[0]);
    expect(pool.acquireFeedVideo()).toBe(got[0]);
    expect(pool.reelVideo(0)).toBe(pool.reelVideo(3));
    expect(pool.reelVideo(0)).not.toBe(pool.reelVideo(1));
    expect(pool.reelVideo(1).preload).toBe("auto");
  });

  it("a clip the phone won't let make sound plays muted, then gets its sound on the next tap anywhere", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    expect(v.muted).toBe(true);
    expect(v.paused).toBe(false);
    expect(pool.soundBlocked(v as unknown as HTMLVideoElement)).toBe(true);
    expect(v.events).toContain(pool.SOUND_BLOCKED_EVENT);
    gesture = true;
    pool.unlockVideoSound();
    gesture = false;
    expect(v.muted).toBe(false);
    expect(pool.soundBlocked(v as unknown as HTMLVideoElement)).toBe(false);
  });

  it("after one tap every pooled element may make sound, so the next clip starts with it", async () => {
    const pool = await import("@/lib/video-pool");
    gesture = true;
    pool.unlockVideoSound();
    gesture = false;
    await flush();
    const next = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(next as unknown as HTMLVideoElement, true);
    await flush();
    expect(next.muted).toBe(false);
    expect(pool.soundBlocked(next as unknown as HTMLVideoElement)).toBe(false);
  });

  it("speaker off: a tap leaves a held clip quiet; a tap on its own speaker decides for itself", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    pool.setSoundWanted(() => false);
    gesture = true;
    pool.unlockVideoSound();
    expect(v.muted).toBe(true);
    pool.setSoundWanted(() => true);
    pool.unlockVideoSound({ contains: (x: unknown) => x === v } as unknown as Element);
    gesture = false;
    expect(v.muted).toBe(true);
  });

  it("a swipe the phone doesn't count leaves the held clip playing muted, and swipes stop asking for the visit", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    expect(pool.swipeGivesSound()).toBe(null);
    pool.unlockVideoSound(null, true); // a swipe's end, no gesture
    await flush();
    await flush();
    expect(v.muted).toBe(true);
    expect(v.paused).toBe(false);
    expect(pool.soundBlocked(v as unknown as HTMLVideoElement)).toBe(true);
    expect(pool.swipeGivesSound()).toBe(false);
    // and it wasn't a tap for sound: the clip's own tap still pauses it
    expect(pool.justGaveSound()).toBe(false);
    // the listener asks swipes only until the phone says no
    expect(read("src/lib/video-pool.ts")).toContain("else if (start && t && swipeUnlocks !== false) unlockVideoSound(null, true);");
  });

  it("a swipe the phone does count gives the held clip its sound and every pooled element its sound after", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    gesture = true;
    pool.unlockVideoSound(null, true);
    gesture = false;
    await flush();
    expect(v.muted).toBe(false);
    expect(pool.soundBlocked(v as unknown as HTMLVideoElement)).toBe(false);
    expect(pool.swipeGivesSound()).toBe(true);
    const next = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(next as unknown as HTMLVideoElement, true);
    await flush();
    expect(next.muted).toBe(false);
  });

  it("the tap that gives a held clip its sound is only for the sound: it doesn't pause or mute the clip", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    gesture = true;
    pool.unlockVideoSound();
    gesture = false;
    expect(pool.justGaveSound()).toBe(true);
    expect(pool.justGaveSound(Date.now() + 1000)).toBe(false);
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("const forSound = justGaveSound();");
    expect(card).toContain("if (layout === \"page\") {\n      if (forSound) return;");
    expect(card).toContain("    if (forSound) return;\n    singleTimer.current = window.setTimeout(() => {\n      singleTimer.current = null;\n      toggleFeedSound();");
  });

  it("while the phone holds a clip's sound back, its speaker says Tap for sound", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("const askTap = sound && blocked;");
    expect(inline).toContain("{askTap && <span>Tap for sound</span>}");
    expect(inline).toContain('data-sound-held={askTap ? "" : undefined}');
  });

  it("on by default, Instagram's way: follows the silent switch and plays over their music unless turned on by hand", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain('let feedSoundMode: FeedSoundMode = "auto";');
    expect(inline).toContain('if (mode === "on") el.removeAttribute("data-ambient-audio");');
    expect(inline).toContain('if (mode === "auto") preferAmbientAudio();');
    expect(inline).not.toContain("setFeedSound(false);\n          v.muted = true;");
    const session = read("src/lib/audio-session.ts");
    expect(session).toContain('if (el.hasAttribute?.("data-ambient-audio")) return;');
    expect(session).toContain("export function preferAmbientAudio() {");
  });
});
