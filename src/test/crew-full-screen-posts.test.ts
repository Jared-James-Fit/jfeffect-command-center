import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCREEN_ZONES, screenFit, startAspect, STORY_ASPECT } from "@/lib/photo-frame";
import { FULL_SAFE, SHARE_SIZES, balancedLines, cardLayout, paintShareCard, type ShareCardData, type ShareTemplate } from "@/lib/workout-share-card";
import { STORY_FILTERS, drawStoryFilter, filterArea, type FilterContext } from "@/lib/story-filters";
import { AMBIENT_SHADE, AMBIENT_SIZE } from "@/lib/ambient-fill";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** About the width of a capital in the cards' faces (Anton, the system bold): the fake only measures roughly. */
const EM = 0.45;

type Word = { text: string; x: number; y: number; w: number; align: string; transformed: boolean };

/** A 2D context that only measures (roughly) and remembers every word it was asked to draw; any other call does nothing. */
function fakeCtx() {
  const words: Word[] = [];
  let depth = 0;
  const stack: number[] = [];
  const size = (f: string) => Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 10);
  const base: Record<string, unknown> = {
    font: "10px sans-serif",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    letterSpacing: "0px",
    globalCompositeOperation: "source-over",
    measureText: (t: string) => ({ width: t.length * size(String(base.font)) * EM, actualBoundingBoxAscent: size(String(base.font)) * 0.7 }),
    fillText: (t: string, x: number, y: number) => words.push({ text: t, x, y, w: t.length * size(String(base.font)) * EM, align: String(base.textAlign), transformed: depth > 0 }),
    strokeText: (t: string, x: number, y: number) => words.push({ text: t, x, y, w: t.length * size(String(base.font)) * EM, align: String(base.textAlign), transformed: depth > 0 }),
    save: () => stack.push(depth),
    restore: () => {
      depth = stack.pop() ?? 0;
    },
    translate: () => void (depth += 1),
    rotate: () => void (depth += 1),
    scale: () => void (depth += 1),
    setTransform: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => null,
  };
  const ctx = new Proxy(base, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, words };
}

/** Where a word's box sits (its baseline is `y`). */
const span = (w: Word) => {
  const left = w.align === "center" ? w.x - w.w / 2 : w.align === "right" || w.align === "end" ? w.x - w.w : w.x;
  return { left, right: left + w.w };
};

/** What covers a full-screen post on its screen in the feed, in a 1080×1920 card's pixels. */
const W = 1080;
const H = 1920;
const COVER = {
  barBottom: H * SCREEN_ZONES.top,
  wordsTop: H * (1 - SCREEN_ZONES.bottom),
  buttonsTop: H * SCREEN_ZONES.buttonsTop,
  buttonsLeft: W * (1 - SCREEN_ZONES.right),
};

function expectClear(words: Word[], label: string) {
  expect(words.length, `${label} drew words`).toBeGreaterThan(0);
  for (const w of words.filter((x) => !x.transformed && x.text.trim())) {
    const { left, right } = span(w);
    const at = `${label} "${w.text}" at ${Math.round(w.x)},${Math.round(w.y)}`;
    expect(left, at).toBeGreaterThanOrEqual(-2);
    expect(right, at).toBeLessThanOrEqual(W + 2);
    // under Crew's bar or under the post's words: never
    expect(w.y, at).toBeGreaterThan(COVER.barBottom);
    expect(w.y, at).toBeLessThan(COVER.wordsTop);
    // down the right from halfway: clear of the buttons
    if (w.y >= COVER.buttonsTop) expect(right, at).toBeLessThanOrEqual(COVER.buttonsLeft);
  }
}

const data = (template: ShareTemplate): ShareCardData => ({
  format: "full",
  template,
  athleteName: "Fionna",
  workoutTitle: "Block 3 · Week 3",
  dateLabel: "Sun, Nov 22",
  lift: { name: "Wide-Grip Lat Pulldown", detail: "40 lb × 12", prLabel: template === "pr" ? "12-rep PR" : null, alt: "18.1 kg" },
  stats: [
    { value: "1h 33m", label: "Time" },
    { value: "18", label: "Working sets" },
    { value: "2", label: "PRs" },
  ],
  isPr: template === "pr",
  exercises: [
    { name: "Wide-Grip Lat Pulldown", detail: "40 lb × 12", pr: true, alt: "18.1 kg" },
    { name: "Seated Cable Row", detail: "70 lb × 10", pr: false, alt: "31.8 kg" },
    { name: "Dumbbell Romanian Deadlift", detail: "45 lb × 10", pr: false, alt: "20.4 kg" },
    { name: "Hip Thrust", detail: "185 lb × 8", pr: true, alt: "83.9 kg" },
  ],
  volume: "17,902 lb",
  volumeOther: "8,120 kg",
  sessionLine: "Session 6 this month",
  media: null,
  lockedIn: { time: "6:42 PM", live: true },
  extras: {
    timeLabel: "9:17 PM",
    sets: 18,
    reps: 180,
    duration: "1h 33m",
    workoutNumber: 6,
    compare: "+1,240 lb vs last time",
    receipt: [
      { name: "Wide-Grip Lat Pulldown", sets: 3, detail: "40 lb × 12", other: "18.1 kg", pr: true },
      { name: "Seated Cable Row", sets: 3, detail: "70 lb × 10", other: "31.8 kg", pr: false },
    ],
    streak: {
      weeks: 6,
      trained: 14,
      cells: Array.from({ length: 28 }, (_, i) => ({ date: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`, state: i % 3 === 0 ? ("rest" as const) : ("trained" as const), today: i === 27 })),
    },
    progress: {
      headline: "More weight moved",
      sub: "than last Sunday",
      bars: [
        { label: "Last time", value: "16,662 lb", other: "7,558 kg", share: 0.93, today: false },
        { label: "Today", value: "17,902 lb", other: "8,120 kg", share: 1, today: true },
      ],
      lift: "Wide-Grip Lat Pulldown",
    },
  },
});

const TEMPLATES: ShareTemplate[] = ["pr", "photo", "stats", "volume", "receipt", "streak", "progress", "lockin", "lockclock", "lockplan", "mealprep", "onplan", "fuel", "highday", "cheat"];

describe("a post fills its screen in the Crew feed (Nov 23 2026)", () => {
  it("an upright picture starts at 9:16, and a 9:16 post fills its screen", () => {
    expect(startAspect(3024, 4032)).toBe("full");
    // a 1080×1920 post on a home-screen iPhone's post screen (393 × ~709) and in Safari (393 × ~659) fills it
    expect(screenFit({ type: "image", width: 1080, height: 1920 }, 393 / 709)).toBe("cover");
    expect(screenFit({ type: "image", width: 1080, height: 1920 }, 393 / 659)).toBe("cover");
    // a 4:5 post never fills it (cropping would cut its card's words); it shows whole over a soft copy of itself
    expect(screenFit({ type: "image", width: 1080, height: 1350 }, 393 / 709)).toBe("contain");
  });

  it("a full-screen card is a story's size, its room worked out from what covers the feed", () => {
    expect(SHARE_SIZES.full.w / SHARE_SIZES.full.h).toBeCloseTo(STORY_ASPECT, 5);
    expect(FULL_SAFE.top).toBeGreaterThan(H * SCREEN_ZONES.top);
    expect(FULL_SAFE.bottom).toBeGreaterThan(H * SCREEN_ZONES.bottom);
    expect(FULL_SAFE.right).toBeGreaterThan(W * SCREEN_ZONES.right);
    const L = cardLayout("full");
    expect(L.R).toBe(W - FULL_SAFE.right);
    expect(L.innerW).toBe(L.R - L.PAD);
    expect(L.story).toBe(true);
    // the story and the 4:5 post are laid out exactly as before
    expect(cardLayout("story")).toMatchObject({ PAD: 80, R: 1000, innerW: 920, top: 250, bottom: 1640, story: true });
    expect(cardLayout("feed")).toMatchObject({ PAD: 80, R: 1000, innerW: 920, top: 80, bottom: 1270, story: false });
  });

  it("every workout, lock in and meal card keeps its words clear of Crew's bar, the post's words and the buttons", () => {
    for (const t of TEMPLATES) {
      const { ctx, words } = fakeCtx();
      const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
      paintShareCard(canvas, data(t), null, 1);
      expect(canvas.width, t).toBe(W);
      expect(canvas.height, t).toBe(H);
      expectClear(words, t);
    }
  });

  it("a title that takes two lines splits evenly, never a word left alone under the rest", () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D;
    // "BLOCK 3 · WEEK 3" (160) in 120: never "BLOCK 3 · WEEK" over "3", and the dot at the split goes
    expect(balancedLines(ctx, "BLOCK 3 · WEEK 3", 120)).toEqual(["BLOCK 3", "WEEK 3"]);
    expect(balancedLines(ctx, "PUSH DAY", 200)).toEqual(["PUSH DAY"]);
    expect(balancedLines(ctx, "SUPERCALIFRAGILISTIC", 50)).toEqual(["SUPERCALIFRAGILISTIC"]);
    expect(balancedLines(ctx, "LOWER BODY STRENGTH DAY", 150)).toEqual(["LOWER BODY", "STRENGTH DAY"]);
  });

  it("every story filter does too, laid out across the room left of the buttons", () => {
    const NOW = new Date(2026, 10, 22, 18, 42);
    const c: FilterContext = {
      now: NOW,
      firstName: "Fionna",
      session: { title: "Block 3 · Week 3", started: true },
      finished: { title: "Block 3 · Week 3", duration: "1h 33m", sets: 18, volume: "17,902 lb", lift: { name: "Wide-Grip Lat Pulldown", detail: "40 lb × 12", alt: "18.1 kg", pr: true }, workoutNumber: 6, streakWeeks: 6 },
      block: { block: 3, week: 3 },
      fuel: "post",
    };
    const A = filterArea("full");
    expect(A.W).toBe(W);
    expect(A.H).toBe(H);
    expect(A.SW - A.PAD).toBe(W - FULL_SAFE.right);
    expect(A.story).toBe(true);
    // a story's and a 4:5 post's are as before (laid out across the whole width)
    expect(filterArea("story").SW).toBe(1080);
    expect(filterArea("feed").SW).toBe(1080);
    for (const f of STORY_FILTERS) {
      if (!f.over || (f.when && !f.when(c))) continue;
      const { ctx, words } = fakeCtx();
      drawStoryFilter(ctx, f, c, null, null, "full");
      if (!words.length) continue;
      expectClear(words, f.id);
    }
  });

  it("both ways of making a post paint the full-screen card at 9:16", () => {
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain('const cardFormat: ShareFormat = story ? "story" : cardShape === "portrait" ? "feed" : "full";');
    // a card goes 9:16 ↔ 4:5 (the two it's drawn at); the camera shows all of a 9:16 post
    expect(studio).toContain('const shapeOf = (a: PostAspect): PostAspect => (cardPost && !selItem ? (a === "portrait" ? "full" : "portrait") : nextAspect(a));');
    expect(studio).toContain("guideBand(box, guideAspect)");
    const composer = read("src/components/community/post-composer.tsx");
    expect(composer).toContain('const size = aspect === "full" ? "full" : aspect === "portrait" ? "feed"');
    // a story filter's own painter gets the full-screen size too
    expect(read("src/components/community/card-paint.ts")).toContain("if (c.paint) return c.paint(canvas, media, format, scale, logo);");
  });

  it("an older post that doesn't fill its screen sits over a soft, dark copy of itself, never black bands", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("<AmbientFill src={thumbUrl ?? src} />");
    expect(card).toContain("{page && !shrunk && <AmbientFill src={thumbUrl ?? src} />}");
    // a tiny canvas the screen stretches: no CSS filter or extra layer while the feed scrolls
    expect(card).toContain("data-ambient-fill");
    expect(card).not.toMatch(/data-ambient-fill[^>]*filter/);
    expect(AMBIENT_SIZE.w * AMBIENT_SIZE.h).toBeLessThan(4000);
    // darkest under Crew's bar and the post's words
    expect(AMBIENT_SHADE.top).toBeGreaterThan(AMBIENT_SHADE.middle);
    expect(AMBIENT_SHADE.bottom).toBeGreaterThan(AMBIENT_SHADE.middle);
  });
});
