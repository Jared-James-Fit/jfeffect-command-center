import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  END_ROOM_SECONDS,
  PREVIEW_STALL_MS,
  SCRUB_BAND_PX,
  SCRUB_TAP_PX,
  TAP_MAX_MS,
  clipClock,
  clipClockText,
  clipLength,
  inScrubBand,
  isBarTap,
  makeScrubSeeker,
  rangesOf,
  ratioAt,
  scrubIntent,
  seekTarget,
  type SeekableVideo,
} from "@/lib/video-scrub";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("a clip's length, when it can be known", () => {
  it("is its duration, else the end of what it can seek (a recording with no length in its header), else unknown", () => {
    expect(clipLength(45.2, [])).toBe(45.2);
    // a MediaRecorder WebM reads Infinity until it's all loaded: the seekable end stands in
    expect(clipLength(Infinity, [[0, 31.5]])).toBe(31.5);
    expect(clipLength(Number.NaN, [[0, 4], [6, 12]])).toBe(12);
    // nothing known yet (before its header): no bar
    expect(clipLength(Number.NaN, [])).toBeNull();
    expect(clipLength(Infinity, [[0, Infinity]])).toBeNull();
    // too short to scrub
    expect(clipLength(0.2, [])).toBeNull();
  });

  it("reads TimeRanges as pairs, and none as none", () => {
    const tr = { length: 2, start: (i: number) => [0, 10][i], end: (i: number) => [5, 20][i] };
    expect(rangesOf(tr)).toEqual([
      [0, 5],
      [10, 20],
    ]);
    expect(rangesOf(null)).toEqual([]);
    const broken = { length: 2, start: () => 0, end: (i: number) => (i ? (() => { throw new Error("gone"); })() : 3) };
    expect(rangesOf(broken)).toEqual([[0, 3]]);
  });
});

describe("where a finger can take it", () => {
  it("stays inside the clip, a hair before its end (a looping clip sent to its very end wraps to the start)", () => {
    expect(seekTarget(-3, 30)).toBe(0);
    expect(seekTarget(12.5, 30)).toBe(12.5);
    expect(seekTarget(30, 30)).toBeCloseTo(30 - END_ROOM_SECONDS);
    expect(seekTarget(Number.NaN, 30)).toBe(0);
  });

  it("goes only where the browser says it can seek: inside a range, else the nearest edge of the nearest one", () => {
    expect(seekTarget(8, 30, [[0, 30]])).toBe(8);
    // a restricted range (only the first 10s can be sought yet): as far as it goes
    expect(seekTarget(20, 30, [[0, 10]])).toBe(10);
    // a gap between two ranges: the nearer edge
    expect(seekTarget(11, 30, [[0, 10], [15, 30]])).toBe(10);
    expect(seekTarget(14, 30, [[0, 10], [15, 30]])).toBe(15);
    // an empty or broken list doesn't hold it back
    expect(seekTarget(8, 30, [[Number.NaN, 4]])).toBe(8);
  });

  it("maps a finger along the bar to 0 … 1, never past either end", () => {
    expect(ratioAt(50, 0, 200)).toBe(0.25);
    expect(ratioAt(-20, 0, 200)).toBe(0);
    expect(ratioAt(260, 10, 200)).toBe(1);
    expect(ratioAt(10, 10, 0)).toBe(0);
  });

  it("says the time the way a clip shows it", () => {
    expect(clipClock(7.9)).toBe("0:07");
    expect(clipClock(62)).toBe("1:02");
    expect(clipClock(3723)).toBe("1:02:03");
    // a clip an hour or longer shows hours from the start
    expect(clipClock(5, 3700)).toBe("0:00:05");
    expect(clipClock(Number.NaN)).toBe("0:00");
    expect(clipClockText(12, 45)).toBe("0:12 of 0:45");
  });
});

describe("what a finger on the bar means", () => {
  it("sideways first scrubs, up or down first is the feed's swipe, a hair either way waits", () => {
    expect(scrubIntent(5, 1)).toBe("scrub");
    expect(scrubIntent(-6, -4)).toBe("scrub");
    expect(scrubIntent(1, -9)).toBe("swipe");
    expect(scrubIntent(2, 3)).toBe("wait");
    // exactly diagonal past the scrub distance: the bar's (it was aimed at the bar)
    expect(scrubIntent(5, 5)).toBe("scrub");
  });

  it("a touch that stays put and lifts is a tap (it jumps there); one that moved isn't", () => {
    expect(isBarTap(2, 1, 120)).toBe(true);
    expect(isBarTap(0, 0, 400)).toBe(true);
    expect(isBarTap(9, 0, 120)).toBe(false);
    expect(isBarTap(0, 0, TAP_MAX_MS)).toBe(false);
  });

  it("is bigger for a finger than it looks: a drag starts anywhere in the bottom 44px across its width, a tap on its own 24px strip", () => {
    expect(SCRUB_BAND_PX).toBe(44);
    expect(SCRUB_TAP_PX).toBeLessThan(SCRUB_BAND_PX);
    // the bar's strip on a 393pt phone, its bottom on the tab bar at 802pt
    const zone = { left: 0, right: 393, top: 802 - SCRUB_TAP_PX, bottom: 802 };
    expect(inScrubBand(200, 801, zone)).toBe(true);
    expect(inScrubBand(200, 802 - 43, zone)).toBe(true);
    expect(inScrubBand(200, 802 - 45, zone)).toBe(false);
    expect(inScrubBand(200, 803, zone)).toBe(false);
    expect(inScrubBand(-1, 790, zone)).toBe(false);
    expect(inScrubBand(393, 790, zone)).toBe(true);
  });
});

/** A video that seeks when told and says so when asked to. */
function fakeVideo(withFast: boolean) {
  const listeners = new Set<() => void>();
  const log: { kind: "fast" | "exact"; t: number }[] = [];
  const v: SeekableVideo & { log: typeof log; done: () => void } = {
    currentTime: 0,
    log,
    addEventListener: (_k, fn) => listeners.add(fn),
    removeEventListener: (_k, fn) => listeners.delete(fn),
    done: () => listeners.forEach((l) => l()),
  };
  Object.defineProperty(v, "currentTime", {
    get: () => log.at(-1)?.t ?? 0,
    set: (t: number) => log.push({ kind: "exact", t }),
  });
  if (withFast) v.fastSeek = (t: number) => log.push({ kind: "fast", t });
  return v;
}

describe("seeking while a finger drags", () => {
  it("previews with a fast seek where there is one, one at a time, the newest wanted going next", () => {
    let clock = 1000;
    const v = fakeVideo(true);
    const s = makeScrubSeeker(v, () => clock);
    s.preview(2);
    s.preview(3);
    s.preview(4);
    // only the first is in flight; 3 was overtaken by 4
    expect(v.log).toEqual([{ kind: "fast", t: 2 }]);
    clock += 50;
    v.done();
    expect(v.log).toEqual([
      { kind: "fast", t: 2 },
      { kind: "fast", t: 4 },
    ]);
    // a move too small to matter isn't another seek
    v.done();
    s.preview(4.01);
    expect(v.log).toHaveLength(2);
    // release: the exact time, whatever was waiting
    s.preview(9);
    s.commit(8.5);
    expect(v.log.at(-1)).toEqual({ kind: "exact", t: 8.5 });
    v.done();
    expect(v.log.at(-1)).toEqual({ kind: "exact", t: 8.5 });
    s.dispose();
  });

  it("without a fast seek (Chrome) it sets the time, and a seek that never says it's done stops holding the next one back", () => {
    let clock = 0;
    const v = fakeVideo(false);
    const s = makeScrubSeeker(v, () => clock);
    s.preview(1);
    s.preview(2);
    expect(v.log).toEqual([{ kind: "exact", t: 1 }]);
    clock += PREVIEW_STALL_MS + 1;
    s.preview(3);
    expect(v.log.at(-1)).toEqual({ kind: "exact", t: 3 });
    s.dispose();
    // gone: a late "seeked" does nothing
    v.done();
    expect(v.log.at(-1)).toEqual({ kind: "exact", t: 3 });
  });
});

describe("the bar on every Crew clip, and nothing it does reaches the post", () => {
  const bar = read("src/components/community/video-scrubber.tsx");
  const inline = read("src/components/community/inline-video.tsx");
  const card = read("src/components/community/post-card.tsx");
  const reels = read("src/components/community/reels-viewer.tsx");

  it("is the feed's own clip element (the pool's), on the feed's clips and the full-screen ones, never a second player", () => {
    expect(inline).toContain("<VideoScrubber video={el} onHold={setScrubbing} enabled={active} disabled={failed} />");
    expect(reels).toContain("video={attached}");
    expect(reels).not.toContain("bar.current");
    expect(bar).not.toContain("document.createElement");
  });

  it("swipes up and down still page the feed, sideways is the bar's, and its taps and drags never reach the clip under it", () => {
    expect(bar).toContain("touch-pan-y");
    expect(bar).toContain('z.addEventListener("pointerdown", onDown);');
    expect(bar).toContain('z.addEventListener("click", onClick);');
    expect(bar).toContain("const onClick = (e: MouseEvent) => e.stopPropagation();");
    // fingers are read on the band's root (a post's screen, a full-screen clip), so a drag can start over the words
    expect(bar).toContain('const root = (z.closest("[data-scrub-band]") as HTMLElement | null) ?? z.parentElement ?? z;');
    // once in hand, a thumb drifting up never scrolls the feed
    expect(bar).toContain('root.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });');
    expect(card).toContain("data-scrub-band");
    expect(reels).toContain("data-scrub-band");
    // a finger resting in the band is the bar's, never the clip's press-and-hold pause
    expect(card).toContain("!inClipScrubBand(clip, e.clientX, e.clientY)");
    expect(reels).toContain('inClipScrubBand(t?.closest?.("[data-reel]"), e.clientX, e.clientY)');
  });

  it("is a thin line, no handle and no bubble: thicker with its time only while it's in hand", () => {
    expect(bar).not.toContain("rounded-full bg-white shadow");
    expect(bar).not.toContain("bg-black/55");
    expect(bar).toContain("inset-x-3 bottom-1.5 overflow-hidden rounded-full");
    // 2px at rest, 4px awake, 6px in hand (Reels')
    expect(bar).toContain('? "h-1.5 bg-white/35"');
    expect(bar).toContain(': "h-0.5 bg-white/25');
    expect(bar).toContain('mode === "scrub" ? "opacity-100" : "opacity-0"');
    // a clip post's words sit a lane above the bar's strip
    expect(read("src/styles.css")).toContain("[data-feed-page-post][data-has-clip] { --feed-scrub-lane: 12px; }");
  });

  it("shows the frame under the finger above it, Reels', from the clip's own frame (never a second video)", () => {
    expect(bar).toContain('c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);');
    expect(bar).toContain("data-scrub-preview");
    expect(bar).not.toContain("<video");
    // drawn as each seek lands, a frame at most per animation frame
    expect(bar).toContain("if (grip?.scrubbing) drawPreview();");
    expect(bar).toContain("if (!drawRaf) drawRaf = requestAnimationFrame(drawNow);");
    // it and its time ride above the finger, never past the clip's sides
    expect(bar).toContain("f.style.transform = `translate3d(${Math.round(left)}px,0,0)`;");
  });

  it("holds the clip still while it's in hand and plays it on after only if it was playing", () => {
    expect(inline).toContain("!holdPaused && !scrubbing && !!el && (auto || tapped) && !failed");
    expect(reels).toContain("!paused && !scrubbing && !failed");
    // paused (held or scrubbed), the frame it's on shows, never its cover again
    expect(inline).toContain('shown ? "opacity-0" : "opacity-100"');
    expect(reels).toContain('shown ? "opacity-0" : "opacity-100"');
  });

  it("puts the post's words and buttons away while it scrubs, like a held clip", () => {
    expect(card).toContain("const holding = layout === \"page\" && (hold.holding || scrubbing);");
    expect(card).toContain("a.addEventListener(CLIP_SCRUB_EVENT, on);");
    expect(reels).toContain("(hold.holding || scrubShown) && \"opacity-0 [&_*]:pointer-events-none\"");
  });

  it("paints progress straight onto the bar, never through React state a frame at a time", () => {
    expect(bar).toContain("fill.current.style.transform = `scaleX(${p})`;");
    expect(bar).toContain("raf = requestAnimationFrame(frame);");
    // its only state: how long the clip is, and whether it's in hand
    expect(bar.match(/= useState/g)).toHaveLength(2);
    expect(bar).toContain("setMode(m);");
  });
});
