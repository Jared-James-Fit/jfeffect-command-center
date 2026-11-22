import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/*
 * An iPhone in Low Power Mode: no video starts by itself, not even muted, until
 * a tap has played that element (WebKit lifts its restriction then).
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
  lifted = false;
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
    if (gesture) this.lifted = true;
    if (!this.lifted) return Promise.reject({ name: "NotAllowedError" });
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  remove() {}
  contains() {
    return false;
  }
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

describe("Low Power Mode: a clip the phone won't start shows a play button, and a tap starts it", () => {
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

  it("refused even muted: marked refused (never a silent frozen frame)", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    await flush();
    expect(v.paused).toBe(true);
    expect(pool.playRefused(v as unknown as HTMLVideoElement)).toBe(true);
    expect(v.events).toContain(pool.PLAY_REFUSED_EVENT);
  });

  it("the next tap anywhere starts it, with its sound, and that tap does nothing else", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    await flush();
    gesture = true;
    pool.unlockVideoSound(null);
    gesture = false;
    await flush();
    expect(v.paused).toBe(false);
    expect(v.muted).toBe(false);
    expect(pool.playRefused(v as unknown as HTMLVideoElement)).toBe(false);
    expect(pool.justStartedPlay()).toBe(true);
    // later, a programmatic play on that element is allowed (the tap lifted it)
    v.pause();
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    expect(v.paused).toBe(false);
  });

  it("a clip that stops being wanted is never started by a tap", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    pool.playFeedVideo(v as unknown as HTMLVideoElement, true);
    await flush();
    await flush();
    pool.pauseFeedVideo(v as unknown as HTMLVideoElement);
    expect(pool.playRefused(v as unknown as HTMLVideoElement)).toBe(false);
    gesture = true;
    pool.unlockVideoSound(null);
    gesture = false;
    await flush();
    expect(v.paused).toBe(true);
  });

  it("the feed and the full-screen clips say so with a play button", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("data-video-refused");
    expect(inline).toContain("pauseFeedVideo(el);");
    expect(read("src/components/community/post-card.tsx")).toContain(
      "if (justStartedPlay()) return;",
    );
    expect(read("src/components/community/reels-viewer.tsx")).toContain("data-video-refused");
  });
});
