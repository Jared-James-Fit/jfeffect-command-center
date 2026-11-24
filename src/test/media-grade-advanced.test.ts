import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADJUST_KEYS,
  FILTER_KEYS,
  FILTER_LABELS,
  HSL_RANGES,
  ONE_WAY,
  analyzePixels,
  applyHsl,
  cleanGrade,
  compileGrade,
  gradePixels,
  gradeRgb,
  hasOwnEdits,
  hslTable,
  hslWeight,
  hsvToRgb,
  isOriginal,
  rgbToHsv,
  withFilter,
  type MediaGrade,
} from "@/lib/media-grade";

/**
 * The colour engine's second pass (Nov 23 2026): the curated filters, the
 * advanced adjustments and HSL, held to the same rules as the first (one
 * engine for the preview, the export and a clip's re-encode).
 */
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
const graded = (d: Uint8ClampedArray, w: number, h: number, g: MediaGrade) => {
  const out = new Uint8ClampedArray(d);
  gradePixels(out, w, h, compileGrade(g));
  return out;
};
const FINE = picture(48, 48, (x, y) => [40 + ((x * 3) % 180), 50 + ((y * 3) % 170), 70 + (((x + y) * 2) % 150)]);
const GREY = picture(48, 48, () => [128, 128, 128]);
const stats = analyzePixels(FINE);
const channelMeans = (d: Uint8ClampedArray) => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return [r / n, g / n, b / n];
};

describe("the curated filters", () => {
  it("are the requested set, every one labelled, the stored keys of the first set kept", () => {
    expect(FILTER_KEYS).toEqual(expect.arrayContaining(["original", "auto", "cool", "warm", "neutral", "natural", "vibrant", "soft", "punch", "cinematic", "moody", "vintage", "film", "mono", "gritty", "shadow", "golden", "flash"]));
    for (const k of FILTER_KEYS) expect(FILTER_LABELS[k]).toBeTruthy();
    expect(FILTER_LABELS.auto).toBe("Auto Enhance");
    expect(FILTER_LABELS.shadow).toBe("Workout");
    expect(FILTER_LABELS.mono).toBe("Black & White");
    expect(FILTER_LABELS.punch).toBe("High Contrast");
  });
  it("every filter changes the picture, and keeps every channel's curve in order", () => {
    for (const f of FILTER_KEYS) {
      if (f === "original") continue;
      const c = compileGrade({ filter: f, intensity: 1, stats });
      expect(c.identity, f).toBe(false);
      for (let ch = 0; ch < 3; ch++) for (let i = 1; i < 256; i++) expect(c.lut[i * 4 + ch], `${f} ${ch} ${i}`).toBeGreaterThanOrEqual(c.lut[(i - 1) * 4 + ch]);
    }
  });
  it("Cool and Warm move the white balance, not a wash: grey stays nearly grey", () => {
    const cool = channelMeans(graded(GREY, 48, 48, { filter: "cool", intensity: 1, stats: analyzePixels(GREY) }));
    const warm = channelMeans(graded(GREY, 48, 48, { filter: "warm", intensity: 1, stats: analyzePixels(GREY) }));
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    // tasteful: a mid grey moves by less than ~10 levels between red and blue
    expect(cool[2] - cool[0]).toBeLessThan(12);
    expect(warm[0] - warm[2]).toBeLessThan(12);
  });
  it("Black & White has no colour left", () => {
    const d = graded(FINE, 48, 48, { filter: "mono", intensity: 1, stats });
    for (let i = 0; i < d.length; i += 4) {
      expect(Math.abs(d[i] - d[i + 1])).toBeLessThanOrEqual(1);
      expect(Math.abs(d[i + 1] - d[i + 2])).toBeLessThanOrEqual(1);
    }
  });
  it("intensity 0 is the original whatever the filter", () => {
    for (const f of FILTER_KEYS) expect(isOriginal({ filter: f, intensity: 0, stats })).toBe(true);
  });
});

describe("the advanced adjustments", () => {
  const lumMean = (d: Uint8ClampedArray) => {
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  };
  it("every one of them changes the picture (nothing on screen that does nothing)", () => {
    for (const k of ADJUST_KEYS) {
      const v = ONE_WAY.has(k) ? 80 : 60;
      const out = graded(FINE, 48, 48, { filter: "original", intensity: 1, adjust: { [k]: v } });
      expect(out, k).not.toEqual(FINE);
      if (!ONE_WAY.has(k)) expect(graded(FINE, 48, 48, { filter: "original", intensity: 1, adjust: { [k]: -60 } }), `${k} −`).not.toEqual(FINE);
    }
  });
  it("exposure and brightness both lighten, brightness holding black and white where they are", () => {
    const base = lumMean(FINE);
    expect(lumMean(graded(FINE, 48, 48, { filter: "original", intensity: 1, adjust: { exposure: 50 } }))).toBeGreaterThan(base);
    const c = compileGrade({ filter: "original", intensity: 1, adjust: { brightness: 60 } });
    expect(c.lut[0]).toBe(0);
    expect(c.lut[255 * 4]).toBe(255);
    expect(c.lut[128 * 4]).toBeGreaterThan(140);
  });
  it("whites and blacks move only the ends", () => {
    const b = compileGrade({ filter: "original", intensity: 1, adjust: { blacks: 100 } });
    const w = compileGrade({ filter: "original", intensity: 1, adjust: { whites: -100 } });
    expect(b.lut[10 * 4]).toBeGreaterThan(10);
    expect(Math.abs(b.lut[230 * 4] - 230)).toBeLessThanOrEqual(1);
    expect(w.lut[245 * 4]).toBeLessThan(245);
    expect(Math.abs(w.lut[20 * 4] - 20)).toBeLessThanOrEqual(1);
  });
  it("saturation −100 is black and white; vibrance lifts quiet colours more than loud ones", () => {
    const c = compileGrade({ filter: "original", intensity: 1, adjust: { saturation: -100 } });
    const [r, g, b] = gradeRgb(c, 0.8, 0.3, 0.2);
    expect(Math.abs(r - g)).toBeLessThan(0.01);
    expect(Math.abs(g - b)).toBeLessThan(0.01);
    const v = compileGrade({ filter: "original", intensity: 1, adjust: { vibrance: 80 } });
    const chroma = (x: number[]) => Math.max(...x) - Math.min(...x);
    const quiet = [0.45, 0.5, 0.55];
    const loud = [0.9, 0.2, 0.15];
    expect(chroma(gradeRgb(v, quiet[0], quiet[1], quiet[2])) / chroma(quiet)).toBeGreaterThan(chroma(gradeRgb(v, loud[0], loud[1], loud[2])) / chroma(loud));
  });
  it("the vignette darkens the corners and leaves the middle", () => {
    const out = graded(GREY, 48, 48, { filter: "original", intensity: 1, adjust: { vignette: 100 } });
    const at = (x: number, y: number) => out[(y * 48 + x) * 4];
    expect(at(24, 24)).toBe(128);
    expect(at(0, 0)).toBeLessThan(80);
  });
  it("grain is the same every time (the preview and the export agree), and averages out", () => {
    const a = graded(GREY, 48, 48, { filter: "original", intensity: 1, adjust: { grain: 100 } });
    const b = graded(GREY, 48, 48, { filter: "original", intensity: 1, adjust: { grain: 100 } });
    expect(a).toEqual(b);
    expect(a).not.toEqual(GREY);
    expect(Math.abs(lumMean(a) - 128)).toBeLessThan(3);
  });
  it("clarity adds local contrast at an edge, and negative clarity softens it", () => {
    const edge = picture(40, 8, (x) => (x < 20 ? [90, 90, 90] : [160, 160, 160]));
    const plus = graded(edge, 40, 8, { filter: "original", intensity: 1, adjust: { clarity: 100 } });
    const minus = graded(edge, 40, 8, { filter: "original", intensity: 1, adjust: { clarity: -100 } });
    const px = (d: Uint8ClampedArray, x: number) => d[(4 * 40 + x) * 4];
    expect(px(plus, 19)).toBeLessThan(90);
    expect(px(plus, 20)).toBeGreaterThan(160);
    expect(px(minus, 19)).toBeGreaterThan(90);
  });
});

describe("HSL", () => {
  it("the shader's colour wheel round-trips", () => {
    for (const [r, g, b] of [
      [0.9, 0.2, 0.1],
      [0.1, 0.7, 0.3],
      [0.2, 0.3, 0.9],
      [0.5, 0.5, 0.5],
    ]) {
      const [h, s, v] = rgbToHsv(r, g, b);
      const back = hsvToRgb(h, s, v);
      expect(back[0]).toBeCloseTo(r, 4);
      expect(back[1]).toBeCloseTo(g, 4);
      expect(back[2]).toBeCloseTo(b, 4);
    }
  });
  it("the eight ranges share every hue between them (the weights add up to 1)", () => {
    for (let h = 0; h < 1; h += 0.013) {
      let sum = 0;
      for (let i = 0; i < HSL_RANGES.length; i++) sum += hslWeight(h, i);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
  it("moving one colour leaves the others, and greys, alone", () => {
    const t = hslTable({ red: { s: -100 } })!;
    const red = applyHsl(t, 0.85, 0.15, 0.12);
    // (a pure red is nearly all Red; the little that's Orange keeps a trace)
    expect(Math.max(...red) - Math.min(...red)).toBeLessThan(0.08);
    const blue = applyHsl(t, 0.15, 0.25, 0.85);
    expect(blue[0]).toBeCloseTo(0.15, 2);
    expect(blue[2]).toBeCloseTo(0.85, 2);
    expect(applyHsl(t, 0.5, 0.5, 0.5)).toEqual([0.5, 0.5, 0.5]);
  });
  it("a hue turn moves that colour's hue, luminance makes it lighter or darker", () => {
    const turn = applyHsl(hslTable({ blue: { h: 100 } })!, 0.15, 0.3, 0.85);
    const [h0] = rgbToHsv(0.15, 0.3, 0.85);
    const [h1] = rgbToHsv(...turn);
    expect(h1).toBeGreaterThan(h0 + 0.03);
    const up = applyHsl(hslTable({ green: { l: 100 } })!, 0.2, 0.6, 0.25);
    expect(up[1]).toBeGreaterThan(0.6);
  });
  it("counts as an edit, and is part of the grade (not Original)", () => {
    const g: MediaGrade = { filter: "original", intensity: 1, hsl: { orange: { l: 20 } } };
    expect(isOriginal(g)).toBe(false);
    expect(hasOwnEdits(g)).toBe(true);
    expect(compileGrade(g).identity).toBe(false);
    expect(withFilter(g, "warm").hsl).toEqual(g.hsl);
    expect(cleanGrade(g)).toEqual({ filter: "original", intensity: 1, hsl: { orange: { l: 20 } } });
  });
});

describe("the GPU runs the same engine", () => {
  const gl = readFileSync("src/lib/media-grade-gl.ts", "utf8");
  it("the shader has every stage the pixel loop has", () => {
    for (const u of ["u_mono", "u_clar", "u_struct", "u_vig", "u_grain", "u_hsl[0]", "u_hslOn", "hash12", "rgb2hsv", "hsv2rgb", "hslWeight"]) expect(gl).toContain(u);
    // sized from the output, like the pixel loop (detailRadii / grainCells)
    expect(gl).toContain("const rad = detailRadii(W, H);");
    expect(gl).toContain("const cells = grainCells(W, H);");
  });
});
