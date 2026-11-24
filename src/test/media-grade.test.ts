import { describe, expect, it } from "vitest";
import {
  ADJUST_KEYS,
  analyzePixels,
  cleanGrade,
  compileGrade,
  consistentStats,
  FILTER_KEYS,
  gradePixels,
  gradeRgb,
  isOriginal,
  ORIGINAL,
  skinness,
  withFilter,
  type MediaGrade,
  type MediaStats,
} from "@/lib/media-grade";

/** A w×h picture from a function of (x, y) → [r, g, b] (0…255). */
function picture(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  return d;
}
const lumaOf = (d: Uint8ClampedArray) => {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 4) out.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
  return out;
};
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const graded = (d: Uint8ClampedArray, w: number, h: number, g: MediaGrade) => {
  const out = new Uint8ClampedArray(d);
  gradePixels(out, w, h, compileGrade(g));
  return out;
};
const withStats = (g: MediaGrade, d: Uint8ClampedArray): MediaGrade => ({ ...g, stats: analyzePixels(d) });

// a dim gym: mostly dark, a lifter's skin, a bright window
const DIM = picture(64, 64, (x, y) => (y < 8 ? [230, 230, 235] : x > 24 && x < 40 && y > 20 && y < 44 ? [120, 78, 58] : [38 + (x % 8), 40 + (y % 6), 46]));
// a normal, well-exposed scene
const FINE = picture(64, 64, (x, y) => [40 + ((x * 3) % 180), 50 + ((y * 3) % 170), 70 + (((x + y) * 2) % 150)]);
// a blown-out one
const BRIGHT = picture(64, 64, (x, y) => [200 + (x % 55), 205 + (y % 50), 210 + ((x + y) % 45)]);

describe("media grade: Original and identity", () => {
  it("Original changes no pixel, and neither does a filter at 0", () => {
    expect(compileGrade(ORIGINAL).identity).toBe(true);
    expect(isOriginal(ORIGINAL)).toBe(true);
    expect(graded(FINE, 64, 64, ORIGINAL)).toEqual(FINE);
    const zero = withStats({ filter: "flash", intensity: 0 }, FINE);
    expect(isOriginal(zero)).toBe(true);
    expect(compileGrade(zero).identity).toBe(true);
  });
  it("an adjustment alone is not Original", () => {
    expect(isOriginal({ filter: "original", intensity: 1, adjust: { contrast: 20 } })).toBe(false);
    expect(compileGrade({ filter: "original", intensity: 1, adjust: { contrast: 20 } }).identity).toBe(false);
  });
});

describe("media grade: Auto reads the picture", () => {
  it("brightens a dim gym toward a natural midtone", () => {
    const before = mean(lumaOf(DIM));
    const after = mean(lumaOf(graded(DIM, 64, 64, withStats({ filter: "auto", intensity: 1 }, DIM))));
    expect(after).toBeGreaterThan(before + 0.05);
  });
  it("leaves a well-exposed picture nearly alone", () => {
    const before = lumaOf(FINE);
    const after = lumaOf(graded(FINE, 64, 64, withStats({ filter: "auto", intensity: 1 }, FINE)));
    expect(Math.abs(mean(after) - mean(before))).toBeLessThan(0.06);
  });
  it("brings a blown-out picture down, never up", () => {
    const after = mean(lumaOf(graded(BRIGHT, 64, 64, withStats({ filter: "auto", intensity: 1 }, BRIGHT))));
    expect(after).toBeLessThan(mean(lumaOf(BRIGHT)));
  });
  it("reads skin, levels and a colour cast", () => {
    const s = analyzePixels(DIM);
    expect(s.p02).toBeLessThan(s.p50);
    expect(s.p50).toBeLessThan(s.p98);
    expect(s.skin).toBeGreaterThan(0.05);
    const blue = analyzePixels(picture(32, 32, (x) => [120 + x, 130 + x, 160 + x]));
    // a blue cast: blue's gain below 1, red's above
    expect(blue.wb[2]).toBeLessThan(1);
    expect(blue.wb[0]).toBeGreaterThan(1);
  });
});

describe("media grade: the looks do what they say", () => {
  it("Flash adds punch (more contrast) without clipping the highlights white", () => {
    const g = graded(FINE, 64, 64, withStats({ filter: "flash", intensity: 1 }, FINE));
    expect(sd(lumaOf(g))).toBeGreaterThan(sd(lumaOf(FINE)));
    const whites = lumaOf(g).filter((v) => v >= 0.999).length;
    expect(whites / (64 * 64)).toBeLessThan(0.02);
  });
  it("Workout deepens the blacks but keeps detail in the shadows", () => {
    const g = analyzePixels(graded(DIM, 64, 64, withStats({ filter: "shadow", intensity: 1 }, DIM)));
    // the darkest tones are still separated (not crushed to one black)
    const lum = lumaOf(graded(DIM, 64, 64, withStats({ filter: "shadow", intensity: 1 }, DIM)));
    const darks = new Set(lum.filter((v) => v < 0.3).map((v) => Math.round(v * 255)));
    expect(darks.size).toBeGreaterThan(3);
    expect(g.p02).toBeLessThan(analyzePixels(graded(DIM, 64, 64, withStats({ filter: "auto", intensity: 1 }, DIM))).p02 + 0.001);
  });
  it("Bright livens quiet colours more than skin, which stays natural", () => {
    const c = compileGrade({ filter: "vibrant", intensity: 1, stats: { p02: 0.1, p10: 0.2, p50: 0.45, p90: 0.8, p98: 0.9, sat: 0.15, wb: [1, 1, 1], skin: 0.2 } });
    const chroma = (a: number[]) => Math.max(...a) - Math.min(...a);
    const skinIn = [150 / 255, 110 / 255, 90 / 255];
    const otherIn = [110 / 255, 120 / 255, 135 / 255];
    expect(skinness(skinIn[0], skinIn[1], skinIn[2])).toBeGreaterThan(0.5);
    const skinUp = chroma(gradeRgb(c, skinIn[0], skinIn[1], skinIn[2])) / chroma(skinIn);
    const otherUp = chroma(gradeRgb(c, otherIn[0], otherIn[1], otherIn[2])) / chroma(otherIn);
    expect(otherUp).toBeGreaterThan(skinUp + 0.1);
    expect(skinUp).toBeLessThan(1.15);
  });
  it("every filter keeps tones in order: no channel's curve ever turns back (no banding or inversions)", () => {
    for (const f of FILTER_KEYS) {
      for (const st of [DIM, FINE, BRIGHT].map((d) => analyzePixels(d))) {
        const c = compileGrade({ filter: f, intensity: 1, stats: st, adjust: { contrast: 60, shadows: 40, highlights: -50 } });
        for (let ch = 0; ch < 3; ch++)
          for (let i = 1; i < 256; i++) expect(c.lut[i * 4 + ch]).toBeGreaterThanOrEqual(c.lut[(i - 1) * 4 + ch]);
      }
    }
  });
  it("more intensity means more change", () => {
    const st = analyzePixels(DIM);
    const at = (t: number) => mean(lumaOf(graded(DIM, 64, 64, { filter: "vibrant", intensity: t, stats: st }))) - mean(lumaOf(DIM));
    expect(at(0.3)).toBeGreaterThan(0);
    expect(at(0.7)).toBeGreaterThan(at(0.3));
    expect(at(1)).toBeGreaterThan(at(0.7));
  });
});

describe("media grade: adjustments", () => {
  it("each slider moves the picture the way it says", () => {
    const base = mean(lumaOf(FINE));
    expect(mean(lumaOf(graded(FINE, 64, 64, { filter: "original", intensity: 1, adjust: { brightness: 50 } })))).toBeGreaterThan(base);
    expect(mean(lumaOf(graded(FINE, 64, 64, { filter: "original", intensity: 1, adjust: { brightness: -50 } })))).toBeLessThan(base);
    expect(sd(lumaOf(graded(FINE, 64, 64, { filter: "original", intensity: 1, adjust: { contrast: 60 } })))).toBeGreaterThan(sd(lumaOf(FINE)));
    const warm = graded(FINE, 64, 64, { filter: "original", intensity: 1, adjust: { warmth: 60 } });
    let rb0 = 0;
    let rb1 = 0;
    for (let i = 0; i < FINE.length; i += 4) {
      rb0 += FINE[i] - FINE[i + 2];
      rb1 += warm[i] - warm[i + 2];
    }
    expect(rb1).toBeGreaterThan(rb0);
  });
  it("sharpness adds local contrast at an edge", () => {
    const edge = picture(16, 4, (x) => (x < 8 ? [80, 80, 80] : [170, 170, 170]));
    const s = graded(edge, 16, 4, { filter: "original", intensity: 1, adjust: { sharpness: 100 } });
    expect(s[(1 * 16 + 7) * 4]).toBeLessThan(80);
    expect(s[(1 * 16 + 8) * 4]).toBeGreaterThan(170);
  });
});

describe("media grade: stored, defaults and carousels", () => {
  it("cleans what's stored: known filter, intensity 0…1, whole adjustments, nothing else", () => {
    expect(cleanGrade({ filter: "flash", intensity: 0.734, adjust: { contrast: 12.4, warmth: 0, bogus: 3 }, stats: { p50: 1 } })).toEqual({ filter: "flash", intensity: 0.73, adjust: { contrast: 12 } });
    expect(cleanGrade({ filter: "sepia" })).toBeNull();
    expect(cleanGrade(null)).toBeNull();
    expect(cleanGrade({ filter: "auto", intensity: 4 })).toEqual({ filter: "auto", intensity: 1 });
    expect(cleanGrade({ filter: "auto", adjust: { sharpness: -40 } })).toEqual({ filter: "auto", intensity: 1 });
    expect(ADJUST_KEYS).toHaveLength(17);
    // the one-way ones never go negative; HSL is kept as whole moves per range, empty ranges dropped
    expect(cleanGrade({ filter: "original", adjust: { grain: -20, vignette: 140, exposure: -150 } })).toEqual({ filter: "original", intensity: 1, adjust: { vignette: 100, exposure: -100 } });
    expect(cleanGrade({ filter: "cool", hsl: { blue: { h: 12.6, s: 0, l: -300 }, red: { h: 0 }, bogus: { h: 5 } } })).toEqual({ filter: "cool", intensity: 1, hsl: { blue: { h: 13, l: -100 } } });
  });
  it("a new filter keeps the intensity and adjustments already set", () => {
    expect(withFilter({ filter: "auto", intensity: 0.6, adjust: { contrast: 10 } }, "flash")).toMatchObject({ filter: "flash", intensity: 0.6, adjust: { contrast: 10 } });
    expect(withFilter(null, "natural")).toMatchObject({ filter: "natural", intensity: 1 });
  });
  it("a carousel's Auto pulls each slide toward the set, keeping most of its own read", () => {
    const a = analyzePixels(DIM);
    const b = analyzePixels(BRIGHT);
    const own = consistentStats(a, [a, b]) as MediaStats;
    expect(own.p50).toBeGreaterThan(a.p50);
    expect(own.p50).toBeLessThan((a.p50 + b.p50) / 2);
  });
});
