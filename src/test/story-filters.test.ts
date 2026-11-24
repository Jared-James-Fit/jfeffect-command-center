import { describe, expect, it } from "vitest";
import {
  FILTER_GROUPS,
  STORY_FILTERS,
  drawStoryFilter,
  filterArea,
  filterLabel,
  filterRow,
  groupOrder,
  isGrade,
  readBlockWeek,
  type FilterContext,
} from "@/lib/story-filters";

/** A 2D context that does nothing but measure (roughly) and remember every word it was asked to draw. */
function fakeCtx() {
  const words: { text: string; x: number; y: number; w: number; align: string; transformed: boolean }[] = [];
  let depth = 0;
  const stack: number[] = [];
  const size = (f: string) => Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 10);
  const ctx: any = {
    font: "10px sans-serif",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    measureText: (t: string) => ({ width: t.length * size(ctx.font) * 0.56 }),
    fillText: (t: string, x: number, y: number) => words.push({ text: t, x, y, w: t.length * size(ctx.font) * 0.56, align: ctx.textAlign, transformed: depth > 0 }),
    strokeText: (t: string, x: number, y: number) => words.push({ text: t, x, y, w: t.length * size(ctx.font) * 0.56, align: ctx.textAlign, transformed: depth > 0 }),
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
  for (const m of ["beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "strokeRect", "clearRect", "clip", "drawImage", "putImageData"]) ctx[m] = () => undefined;
  return { ctx: ctx as CanvasRenderingContext2D, words };
}

const NOW = new Date(2026, 10, 22, 18, 42);
const empty: FilterContext = { now: NOW, firstName: null, session: null, finished: null, block: null, fuel: null };
const full: FilterContext = {
  now: NOW,
  firstName: "Jared",
  session: { title: "Block 5 · Week 1", started: true },
  finished: {
    title: "Block 5 · Week 1",
    duration: "1h 42m",
    sets: 18,
    volume: "17,902 lb",
    lift: { name: "Competition Deadlift", detail: "529 lb × 1", alt: "240 kg", pr: true },
    workoutNumber: 9,
    streakWeeks: 12,
  },
  block: { block: 5, week: 3 },
  fuel: "post",
};

describe("story filters", () => {
  it("are plenty, each one named once, in groups that all have something", () => {
    expect(STORY_FILTERS.length).toBeGreaterThanOrEqual(40);
    const ids = STORY_FILTERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // (Favorites is the person's own: it fills from the others)
    for (const g of FILTER_GROUPS) if (g.key !== "fav") expect(STORY_FILTERS.some((f) => f.group === g.key)).toBe(true);
  });

  it("paint in a story and a feed post, with and without anything on file", () => {
    for (const f of STORY_FILTERS) {
      for (const c of [empty, full]) {
        if (f.when && !f.when(c)) continue;
        for (const fmt of ["story", "feed"] as const) {
          const { ctx } = fakeCtx();
          expect(() => drawStoryFilter(ctx, f, c, null, null, fmt), `${f.id} ${fmt}`).not.toThrow();
        }
      }
    }
  });

  it("keep their words on the picture and clear of the story's own bars", () => {
    for (const f of STORY_FILTERS) {
      if (f.when && !f.when(full)) continue;
      for (const fmt of ["story", "feed"] as const) {
        const A = filterArea(fmt);
        const { ctx, words } = fakeCtx();
        drawStoryFilter(ctx, f, full, null, null, fmt);
        for (const w of words.filter((x) => !x.transformed)) {
          const left = w.align === "center" ? w.x - w.w / 2 : w.align === "right" ? w.x - w.w : w.x;
          expect(left, `${f.id} ${fmt} "${w.text}"`).toBeGreaterThanOrEqual(-2);
          expect(left + w.w, `${f.id} ${fmt} "${w.text}"`).toBeLessThanOrEqual(A.W + 2);
          expect(w.y, `${f.id} ${fmt} "${w.text}"`).toBeGreaterThanOrEqual(A.top);
          expect(w.y, `${f.id} ${fmt} "${w.text}"`).toBeLessThanOrEqual(A.bottom + 2);
        }
      }
    }
  });

  it("offer the ones that need data only when it's there", () => {
    const none = filterRow(empty).map((f) => f.id);
    expect(none).not.toContain("done");
    expect(none).not.toContain("topset");
    expect(none).not.toContain("blockweek");
    // nothing to train today: the generic Locked in stands in for the session's own
    expect(none).toContain("lockedin");
    const all = filterRow(full).map((f) => f.id);
    expect(all).toContain("done");
    expect(all).toContain("blockweek");
    expect(all).not.toContain("lockedin");
  });

  it("put what fits right now first", () => {
    expect(groupOrder(full)[0]).toBe("today");
    expect(groupOrder({ ...empty, session: { title: "Friday session", started: false } })[0]).toBe("lockin");
    // a PR leads Today
    expect(filterRow(full)[0].id).toBe("topset");
    // 6 AM: the club leads Time, with its hour in its name
    const dawn = { ...empty, now: new Date(2026, 10, 22, 6, 5) };
    const time = filterRow(dawn).filter((f) => f.group === "time");
    expect(time[0].id).toBe("earlyclub");
    expect(filterLabel(time[0], dawn)).toBe("6 AM club");
    // the evening: late night before morning
    const night = filterRow({ ...empty, now: new Date(2026, 10, 22, 21, 0) }).filter((f) => f.group === "time").map((f) => f.id);
    expect(night.indexOf("latenight")).toBeLessThan(night.indexOf("morning"));
    expect(night).not.toContain("earlyclub");
  });

  it("read the block and week from the public title, never a guess", () => {
    expect(readBlockWeek("Block 5 · Week 1")).toEqual({ block: 5, week: 1 });
    expect(readBlockWeek("Week 3")).toEqual({ block: null, week: 3 });
    expect(readBlockWeek("Friday session")).toBeNull();
    expect(readBlockWeek(null)).toBeNull();
  });

  it("grades are the only ones a square or landscape post can take", () => {
    expect(STORY_FILTERS.filter(isGrade).every((f) => f.group === "vibe")).toBe(true);
    expect(filterArea({ w: 1080, h: 1920 }).story).toBe(true);
    expect(filterArea({ w: 1080, h: 1080 }).bottom).toBe(1020);
  });
});
