import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CARDIO_PHRASES,
  buildCardioStory,
  cardioDayStreak,
  cardioMetrics,
  cleanPlace,
  defaultCardioPhrase,
  placeBox,
  stopwatchFace,
  weekStartISO,
} from "@/lib/cardio-story";
import { FILTER_GROUPS, STORY_FILTERS, drawStoryFilter, filterRow, groupOrder, templateWords, type FilterContext } from "@/lib/story-filters";
import { sheetDragCloses, sheetDragIntent } from "@/lib/post-sheet";

const NOW = new Date(2026, 10, 25, 8, 0); // Wed
const base: FilterContext = { now: NOW, firstName: null, session: null, finished: null, block: null, fuel: null };
const row = (o: Partial<Parameters<typeof buildCardioStory>[0]["completions"][number]> = {}) => ({ completed_date: "2026-11-25", completed: true, skipped: false, ...o });

describe("cardio story phrases", () => {
  it("has the coach's lines, every one", () => {
    expect(CARDIO_PHRASES.locked).toHaveLength(8);
    expect(CARDIO_PHRASES.funny).toHaveLength(10);
    expect(CARDIO_PHRASES.aesthetic).toHaveLength(8);
    expect(CARDIO_PHRASES.locked).toContain("CARDIO. NO EXCUSES.");
    expect(CARDIO_PHRASES.aesthetic.every((p) => p === p.toLowerCase())).toBe(true);
  });
  it("starts on one of the tone's lines and moves on each day", () => {
    const a = defaultCardioPhrase("funny", NOW);
    expect(CARDIO_PHRASES.funny).toContain(a);
    expect(defaultCardioPhrase("funny", new Date(2026, 10, 26))).not.toBe(a);
  });
});

describe("cardio metrics never invent a number", () => {
  it("shows nothing without data", () => {
    expect(cardioMetrics(null)).toEqual([]);
    expect(buildCardioStory({ completions: [], targets: [], now: NOW })).toBeNull();
    expect(buildCardioStory({ completions: [row({ completed: false })], targets: [], now: NOW })).toBeNull();
  });
  it("leaves out what the session didn't record, and what the athlete hides", () => {
    const d = buildCardioStory({ completions: [row({ duration_minutes: 30, incline: 8, avg_speed: 3.2, distance_unit: "mi" })], targets: [], now: NOW })!;
    const ids = cardioMetrics(d).map((m) => m.id);
    expect(ids).toContain("duration");
    expect(ids).toContain("incline");
    expect(ids).toContain("speed");
    expect(ids).not.toContain("heartRate");
    expect(ids).not.toContain("steps");
    expect(ids).not.toContain("zone");
    expect(cardioMetrics(d, ["incline"]).map((m) => m.id)).not.toContain("incline");
  });
  it("shows speed in the athlete's unit (mph stored)", () => {
    const mi = buildCardioStory({ completions: [row({ avg_speed: 3, distance_unit: "mi" })], targets: [], now: NOW })!;
    expect(cardioMetrics(mi).find((m) => m.id === "speed")).toMatchObject({ value: "3", unit: "MPH" });
    const km = buildCardioStory({ completions: [row({ avg_speed: 3, distance_unit: "km" })], targets: [], now: NOW })!;
    expect(cardioMetrics(km).find((m) => m.id === "speed")).toMatchObject({ value: "4.8", unit: "KM/H" });
  });
  it("steps, heart rate and zone only when they exist", () => {
    const d = buildCardioStory({ completions: [row({ steps: 8421, avg_heart_rate: 128, cardio_target_id: "t1" })], targets: [{ id: "t1", heart_rate_zone: "Zone 2" }], now: NOW })!;
    const m = cardioMetrics(d);
    expect(m.find((x) => x.id === "steps")?.value).toBe("8,421");
    expect(m.find((x) => x.id === "heartRate")?.value).toBe("128");
    expect(m.find((x) => x.id === "zone")?.value).toBe("ZONE 2");
  });
  it("this week: minutes and done of prescribed", () => {
    expect(weekStartISO(NOW)).toBe("2026-11-23");
    const d = buildCardioStory({
      completions: [row({ completed_date: "2026-11-24", duration_minutes: 30 }), row({ duration_minutes: 40 }), row({ completed_date: "2026-11-20", duration_minutes: 99 })],
      targets: [{ id: "a", frequency_per_week: 3 }, { id: "b", frequency_per_week: 2 }],
      now: NOW,
    })!;
    expect(d.week).toEqual({ minutes: 70, done: 2, prescribed: 5 });
    expect(cardioMetrics(d).find((m) => m.id === "sessions")?.value).toBe("2/5");
    const none = buildCardioStory({ completions: [row({ duration_minutes: 10 })], targets: [], now: NOW })!;
    expect(cardioMetrics(none).some((m) => m.id === "sessions")).toBe(false);
  });
  it("streak counts consecutive days and shows from two", () => {
    const c = [row(), row({ completed_date: "2026-11-24" }), row({ completed_date: "2026-11-22" })];
    expect(cardioDayStreak(c, NOW)).toBe(2);
    expect(cardioDayStreak([row({ completed_date: "2026-11-24" })], NOW)).toBe(1);
    expect(cardioDayStreak([row({ completed_date: "2026-11-10" })], NOW)).toBe(0);
    expect(cardioMetrics(buildCardioStory({ completions: [row()], targets: [], now: NOW })!).some((m) => m.id === "streak")).toBe(false);
  });
  it("a session from today or yesterday is fresh", () => {
    expect(buildCardioStory({ completions: [row()], targets: [], now: NOW })!.fresh).toBe(true);
    expect(buildCardioStory({ completions: [row({ completed_date: "2026-11-24" })], targets: [], now: NOW })!.fresh).toBe(true);
    expect(buildCardioStory({ completions: [row({ completed_date: "2026-11-20" })], targets: [], now: NOW })!.fresh).toBe(false);
  });
  it("the stopwatch face is the duration, or nothing", () => {
    expect(stopwatchFace(32)).toBe("32:00");
    expect(stopwatchFace(65)).toBe("1:05:00");
    expect(stopwatchFace(null)).toBeNull();
    expect(stopwatchFace(0)).toBeNull();
  });
});

describe("cardio overlay place stays inside the safe area", () => {
  const area = { left: 80, right: 1000, top: 250, bottom: 1640 };
  it("whatever the place says", () => {
    for (const p of [{ x: 0, y: 0, s: 1 }, { x: 1, y: 1, s: 1 }, { x: 5, y: -3, s: 9 }, { x: 0.5, y: 0.5, s: 0.1 }, undefined]) {
      const b = placeBox(area, 920, 600, p);
      expect(b.x).toBeGreaterThanOrEqual(area.left - 0.001);
      expect(b.y).toBeGreaterThanOrEqual(area.top - 0.001);
      expect(b.x + b.w).toBeLessThanOrEqual(area.right + 0.001);
      expect(b.y + b.h).toBeLessThanOrEqual(area.bottom + 0.001);
    }
  });
  it("is smaller when asked, and cleaned", () => {
    expect(placeBox(area, 920, 600, { s: 0.6 }).w).toBeLessThan(placeBox(area, 920, 600, { s: 1 }).w);
    expect(cleanPlace({ x: NaN, s: 7 })).toMatchObject({ x: 0.5, s: 1 });
  });
});

describe("cardio in the story filter system", () => {
  it("is a group with four styles, each with a quiet variant, each with its own look", () => {
    expect(FILTER_GROUPS.some((g) => g.key === "cardio")).toBe(true);
    const ids = STORY_FILTERS.filter((f) => f.group === "cardio").map((f) => f.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    for (const s of ["treadmill", "stopwatch", "heartrate", "editorial"]) {
      expect(ids).toContain(`cardio_${s}`);
      expect(ids).toContain(`cardio_${s}_mono`);
    }
    expect(filterRow(base).filter((f) => f.group === "cardio")).toHaveLength(8);
  });
  it("leads when a session was just completed, else keeps its place", () => {
    const d = buildCardioStory({ completions: [row({ duration_minutes: 30 })], targets: [], now: NOW });
    expect(groupOrder({ ...base, cardio: d })[0]).toBe("cardio");
    expect(groupOrder(base)[0]).not.toBe("cardio");
  });
  it("the words are the athlete's when typed, else today's pick (empty default)", () => {
    const f = STORY_FILTERS.find((x) => x.id === "cardio_stopwatch")!;
    expect(templateWords(f, base).title).toBe("");
    expect(templateWords(f, { ...base, custom: { cardio_stopwatch: { title: "My line" } } }).title).toBe("My line");
  });
});

describe("the Filters / Adjust / Colour panel closes with one swipe down", () => {
  const studio = readFileSync("src/components/community/share-studio.tsx", "utf8");
  const panel = readFileSync("src/components/community/filter-panel.tsx", "utf8");
  it("uses the app's one sheet gesture, and keeps Done", () => {
    expect(studio).toMatch(/useSwipeDownToClose\(enhanceNode, enhancing, \(\) => setEnhancing\(false\)\)/);
    expect(studio).toContain("ref={setEnhanceNode}");
    expect(panel).toContain("data-studio-enhance-done");
  });
  it("its rules: down closes, sideways and up are the panel's own, sliders opt out", () => {
    expect(sheetDragIntent(2, 20)).toBe("drag");
    expect(sheetDragIntent(30, 5)).toBe("pass");
    expect(sheetDragIntent(0, -20)).toBe("pass");
    expect(sheetDragCloses({ dy: 200, ms: 400, height: 300 })).toBe(true);
    expect(sheetDragCloses({ dy: 10, ms: 400, height: 300 })).toBe(false);
  });
  it("the action row no longer clips Set as default", () => {
    expect(panel).toContain("data-filter-actions");
    expect(panel).not.toMatch(/h-9 items-center gap-0\.5 overflow-x-auto/);
  });
});

describe("every cardio overlay draws, with and without data, inside the safe band", () => {
  function fake() {
    const ys: number[] = [];
    const base: Record<string, unknown> = {
      font: "10px sans-serif",
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillText: () => ys.push(1),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createPattern: () => null,
    };
    const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: (t, k, v) => ((t[k as string] = v), true) });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ys };
  }
  const full = buildCardioStory({
    completions: [row({ duration_minutes: 45, incline: 10, avg_speed: 3.1, avg_heart_rate: 131, steps: 6000, distance: 2.4, distance_unit: "mi", cardio_target_id: "t" }), row({ completed_date: "2026-11-24", duration_minutes: 30 })],
    targets: [{ id: "t", frequency_per_week: 4, heart_rate_zone: "Zone 2" }],
    now: NOW,
  });
  it("draws with full data, no data, and everything hidden", () => {
    for (const f of STORY_FILTERS.filter((x) => x.group === "cardio")) {
      for (const cardio of [full, null]) {
        for (const hide of [[], ["duration", "incline", "speed", "heartRate", "zone", "steps", "distance", "week", "sessions", "streak"]]) {
          const { ctx, ys } = fake();
          expect(() => drawStoryFilter(ctx, f, { ...base, cardio, custom: { [f.id]: { hide } } }, null, null, "story")).not.toThrow();
          expect(ys.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
