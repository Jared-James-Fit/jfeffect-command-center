import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RELOAD_GAP_MS,
  RESUME_DELAY_MS,
  RESUME_MAX,
  STALL_MS,
  WAIT_SHOW_MS,
  keepPlaying,
  type KeepPlayingVideo,
} from "@/lib/video-keep-playing";

const read = (p: string) => readFileSync(p, "utf8");

class FakeVideo extends EventTarget implements KeepPlayingVideo {
  paused = true;
  currentTime = 0;
  currentSrc = "https://x/clip.mp4";
  loads = 0;
  getAttribute(name: string) {
    return name === "src" ? this.currentSrc : null;
  }
  load() {
    this.loads += 1;
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
  // EventTarget's own signatures are wider; the helper only adds and removes plain listeners
  addEventListener(type: string, fn: () => void, opts?: unknown) {
    super.addEventListener(type, fn as EventListener, opts as AddEventListenerOptions);
  }
  removeEventListener(type: string, fn: () => void, opts?: unknown) {
    super.removeEventListener(type, fn as EventListener, opts as EventListenerOptions);
  }
}

class FakeDoc extends EventTarget {
  visibilityState = "visible";
  addEventListener(type: string, fn: () => void) {
    super.addEventListener(type, fn as EventListener);
  }
  removeEventListener(type: string, fn: () => void) {
    super.removeEventListener(type, fn as EventListener);
  }
}

function setup(opts: { wanted?: () => boolean } = {}) {
  vi.useFakeTimers();
  const v = new FakeVideo();
  const doc = new FakeDoc();
  const win = new FakeDoc();
  const resume = vi.fn(() => {
    v.paused = false;
  });
  const onWaiting = vi.fn();
  const onFailed = vi.fn();
  let wanted = true;
  const stop = keepPlaying(
    v,
    { wanted: opts.wanted ?? (() => wanted), resume, onWaiting, onFailed },
    { doc, win, now: () => Date.now() },
  );
  return {
    v,
    doc,
    win,
    resume,
    onWaiting,
    onFailed,
    stop,
    setWanted: (w: boolean) => (wanted = w),
  };
}

afterEach(() => vi.useRealTimers());

describe("a clip that should be playing keeps playing (video-keep-playing.ts)", () => {
  it("plays again after a pause nobody here asked for (the phone, a call, an audio change)", () => {
    const t = setup();
    t.v.paused = true;
    t.v.fire("pause");
    expect(t.resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RESUME_DELAY_MS);
    expect(t.resume).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("never plays one the caller paused (off screen, held, scrubbed)", () => {
    const t = setup();
    t.setWanted(false);
    t.v.fire("pause");
    vi.advanceTimersByTime(RESUME_DELAY_MS * 4);
    expect(t.resume).not.toHaveBeenCalled();
    t.stop();
  });

  it("doesn't fight a phone that keeps stopping it", () => {
    const t = setup();
    for (let i = 0; i < RESUME_MAX + 3; i++) {
      t.v.paused = true;
      t.v.fire("pause");
      vi.advanceTimersByTime(RESUME_DELAY_MS);
    }
    expect(t.resume).toHaveBeenCalledTimes(RESUME_MAX);
    t.stop();
  });

  it("back in the app: a wanted clip that's paused plays again; never while the app is hidden", () => {
    const t = setup();
    t.doc.visibilityState = "hidden";
    t.v.paused = true;
    t.v.fire("pause");
    vi.advanceTimersByTime(RESUME_DELAY_MS);
    expect(t.resume).not.toHaveBeenCalled();
    t.doc.visibilityState = "visible";
    t.doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(RESUME_DELAY_MS);
    expect(t.resume).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("waiting on data: says so after a moment, quiet again once frames move", () => {
    const t = setup();
    t.v.paused = false;
    t.v.fire("waiting");
    vi.advanceTimersByTime(WAIT_SHOW_MS - 1);
    expect(t.onWaiting).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.onWaiting).toHaveBeenLastCalledWith(true);
    t.v.currentTime = 0.5;
    t.v.fire("timeupdate");
    expect(t.onWaiting).toHaveBeenLastCalledWith(false);
    t.stop();
  });

  it("stuck with no new frame: reloaded where it was, at most once in a while", () => {
    const t = setup();
    t.v.paused = false;
    t.v.currentTime = 4.2;
    t.v.fire("waiting");
    vi.advanceTimersByTime(STALL_MS);
    expect(t.v.loads).toBe(1);
    t.v.fire("loadedmetadata");
    expect(t.v.currentTime).toBe(4.2);
    expect(t.resume).toHaveBeenCalled();
    // stuck again straight away: not reloaded again until the gap's passed
    t.v.fire("playing");
    t.v.fire("waiting");
    vi.advanceTimersByTime(STALL_MS);
    expect(t.v.loads).toBe(1);
    t.v.fire("playing");
    vi.advanceTimersByTime(RELOAD_GAP_MS);
    t.v.fire("waiting");
    vi.advanceTimersByTime(STALL_MS);
    expect(t.v.loads).toBe(2);
    t.stop();
  });

  it("an error is tried once more before it's called failed", () => {
    const t = setup();
    t.v.fire("error");
    expect(t.onFailed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(t.v.loads).toBe(1);
    t.v.fire("error");
    expect(t.onFailed).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("stops listening when it's let go of", () => {
    const t = setup();
    t.stop();
    t.v.paused = true;
    t.v.fire("pause");
    vi.advanceTimersByTime(RESUME_DELAY_MS * 2);
    expect(t.resume).not.toHaveBeenCalled();
  });
});

describe("feed clips use it, and a carousel's neighbours stay warm", () => {
  it("the feed's clip and the full-screen clips play again when the phone stopped them", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("return keepPlaying(el, {");
    expect(inline).toContain("wanted: () => playingWanted.current");
    expect(inline).toContain("data-video-buffering");
    const reels = read("src/components/community/reels-viewer.tsx");
    expect(reels).toContain("return keepPlaying(v, {");
  });

  it("the slides either side of the one showing keep their element (a swipe never starts cold)", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain(
      'warm={i === index + 1 ? "next" : i === index - 1 ? "prev" : undefined}',
    );
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("const holding = inRange || warmNow;");
    expect(inline).toContain('closest("[data-carousel]")');
    expect(inline).toContain('(warmNow && warm === "next")');
  });
});
