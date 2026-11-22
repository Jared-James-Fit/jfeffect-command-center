import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DECODED_LATE_MS, DECODED_LONG_SIDE, decodedSize, paceFrame } from "@/lib/decoded-clip";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("a decoded clip plays on time (decoded-clip.ts)", () => {
  it("a frame waits until it's due", () => {
    const clock = { wall: 1000, media: 2 };
    expect(paceFrame(clock, 2.5, 1100)).toEqual({ wait: 400, clock });
    expect(paceFrame(clock, 2.5, 1500).wait).toBe(0);
  });

  it("a frame a little late is drawn at once; one well late moves the clock (a stall slows it, never fast-forwards)", () => {
    const clock = { wall: 1000, media: 2 };
    expect(paceFrame(clock, 2.5, 1500 + DECODED_LATE_MS - 1)).toEqual({ wait: 0, clock });
    const late = paceFrame(clock, 2.5, 3000);
    expect(late.wait).toBe(0);
    expect(late.clock).toEqual({ wall: 3000, media: 2.5 });
    // the next frame is timed from there
    expect(paceFrame(late.clock, 2.6, 3000).wait).toBeCloseTo(100);
  });

  it("drawn at the clip's own shape, its long side at most 1280 (CSS fits it like the element)", () => {
    expect(decodedSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(decodedSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(decodedSize(540, 960)).toEqual({ width: 540, height: 960 });
    expect(decodedSize(0, 0).height).toBeGreaterThan(decodedSize(0, 0).width);
    expect(DECODED_LONG_SIDE).toBe(1280);
  });
});

/* An iPhone in Low Power Mode, with a clock: no video starts by itself until a tap has played that element. */
let gesture = false;
class FakeVideo {
  muted = false;
  paused = true;
  preload = "";
  className = "";
  playsInline = false;
  loop = false;
  currentTime = 0;
  style: Record<string, string> = {};
  lifted = false;
  attrs = new Map<string, string>();
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
    this.listeners.get(e.type)?.forEach((f) => f());
    return true;
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the tap hands a decoded clip to its element where it is", () => {
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

  it("starts at the decoded clip's time, with its sound, never back at its first frame", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    const el = v as unknown as HTMLVideoElement;
    pool.playFeedVideo(el, true);
    await flush();
    await flush();
    expect(pool.playRefused(el)).toBe(true);
    pool.setRefusedClock(el, () => 3.2);
    gesture = true;
    pool.unlockVideoSound(null);
    gesture = false;
    await flush();
    expect(v.paused).toBe(false);
    expect(v.muted).toBe(false);
    expect(v.currentTime).toBe(3.2);
  });

  it("an element given back to the pool forgets the clock", async () => {
    const pool = await import("@/lib/video-pool");
    const v = pool.acquireFeedVideo() as unknown as FakeVideo;
    const el = v as unknown as HTMLVideoElement;
    pool.setRefusedClock(el, () => 9);
    pool.releaseFeedVideo(el);
    const again = pool.acquireFeedVideo() as unknown as FakeVideo;
    expect(again).toBe(v);
    pool.playFeedVideo(again as unknown as HTMLVideoElement, true);
    await flush();
    await flush();
    gesture = true;
    pool.unlockVideoSound(null);
    gesture = false;
    await flush();
    expect(again.currentTime).toBe(0);
  });
});

describe("where it's wired", () => {
  const inline = read("src/components/community/inline-video.tsx");
  it("a refused feed clip plays decoded on a canvas in the element's place, muted, with Tap for sound", () => {
    expect(inline).toContain("const clip = startDecodedClip({");
    expect(inline).toContain('c.setAttribute("data-decoded-clip", "");');
    expect(inline).toContain("c.className = el.className;");
    expect(inline).toContain(
      "setRefusedClock(el, () => clipRef.current?.time() ?? decodedAt.current);",
    );
    expect(inline).toContain(
      'const askTap = sound && !silent && controls !== "corner" && (refused ? decodedNow : blocked);',
    );
    // the element's own play takes over; the play button only when decoding can't run (or is slow to start)
    expect(inline).toContain('["play", () => clipRef.current?.stop()],');
    expect(inline).toContain(
      "{refused && shouldPlay && (decodeFailed || (decodeSlow && !decodedNow)) && (",
    );
    expect(inline).toContain("if (el && playRefused(el)) return startRefused(el);");
  });

  it("a story clip plays decoded too, running the story's bar, its first minute only", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("until: STORY_CLIP_MAX_SECONDS,");
    expect(stories).toContain("if (length > 0) progressRef.current(Math.min(1, t / length));");
    // its Tap for sound sits above the reply bar's shade, which took the tap
    expect(stories).toContain('className="absolute bottom-24 left-1/2 z-40 inline-flex');
  });
});

describe("the story row is always there", () => {
  it("the coach's own Crew page leads it with Your story too", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("const canStory = canShare || !!coach;");
    expect(screen.match(/addStory=\{canStory \? \(t\) =>/g)?.length).toBe(2);
    expect(screen).not.toContain("addStory={canShare");
  });
});
