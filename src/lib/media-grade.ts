/**
 * Photo and video filters for Crew posts and stories (Nov 22 2026): one
 * colour engine, pure and tested, that the studio's preview (WebGL, the GPU),
 * the export (the same shader at full size) and a phone without WebGL (this
 * file's own pixel loop) all read, so what's saved is what was on screen.
 *
 * A grade is a filter (Original, Auto, Flash, Workout, Bright, Natural+), how
 * strong it is, and the person's own adjustments (brightness, contrast,
 * saturation, highlights, shadows, warmth, sharpness). It compiles to a small
 * program: per-channel gains (white balance), a 256-step tone curve per
 * channel (exposure, contrast, shadows, highlights, black and white points,
 * split toning), a saturation stage that protects skin, and a sharpen. Auto
 * and the presets read the picture first (`analyzePixels`: a tiny copy's
 * levels, colour cast, saturation and skin), so a dark gym and a bright one
 * each get what they need instead of the same numbers. No model, no network.
 */

/**
 * The colour filters, in the order the row shows them (Nov 23 2026: the
 * curated set). Keys are what's stored (a saved default, a story's
 * attribution), so a key is never renamed: Workout is `shadow`, Bright is
 * `vibrant`, Natural+ is `natural`.
 */
export const FILTER_KEYS = [
  "original",
  "auto",
  "cool",
  "warm",
  "neutral",
  "natural",
  "vibrant",
  "soft",
  "punch",
  "cinematic",
  "moody",
  "vintage",
  "film",
  "mono",
  "gritty",
  "shadow",
  "golden",
  "flash",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const FILTER_LABELS: Record<FilterKey, string> = {
  original: "Original",
  auto: "Auto Enhance",
  cool: "Cool",
  warm: "Warm",
  neutral: "Natural",
  natural: "Natural+",
  vibrant: "Bright",
  soft: "Soft",
  punch: "High Contrast",
  cinematic: "Cinematic",
  moody: "Moody",
  vintage: "Vintage",
  film: "Film",
  mono: "Black & White",
  gritty: "Gritty",
  shadow: "Workout",
  golden: "Golden Hour",
  flash: "Flash",
};

/**
 * The person's own adjustments: each -100…100, or 0…100 for the ones that only
 * go one way (`ONE_WAY`); 0 leaves it alone. Every one changes the picture in
 * the preview, the export and a clip's re-encode alike (one engine).
 */
export const ADJUST_KEYS = [
  "exposure",
  "brightness",
  "contrast",
  "saturation",
  "vibrance",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "warmth",
  "tint",
  "sharpness",
  "clarity",
  "structure",
  "fade",
  "vignette",
  "grain",
] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
export type Adjustments = Partial<Record<AdjustKey, number>>;
/** Adjustments that only go up from 0 (there's no "negative grain"). */
export const ONE_WAY: ReadonlySet<AdjustKey> = new Set<AdjustKey>(["sharpness", "structure", "fade", "vignette", "grain"]);

export const ADJUST_LABELS: Record<AdjustKey, string> = {
  exposure: "Exposure",
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  vibrance: "Vibrance",
  highlights: "Highlights",
  shadows: "Shadows",
  whites: "Whites",
  blacks: "Blacks",
  warmth: "Temperature",
  tint: "Tint",
  sharpness: "Sharpness",
  clarity: "Clarity",
  structure: "Structure",
  fade: "Fade",
  vignette: "Vignette",
  grain: "Grain",
};

/** The colour ranges HSL moves on their own (Lightroom's eight). */
export const HSL_RANGES = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslRange = (typeof HSL_RANGES)[number];
export const HSL_LABELS: Record<HslRange, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  aqua: "Aqua",
  blue: "Blue",
  purple: "Purple",
  magenta: "Magenta",
};
/** Each range's middle hue (0…1 around the wheel). */
export const HSL_CENTRES: Record<HslRange, number> = {
  red: 0,
  orange: 30 / 360,
  yellow: 60 / 360,
  green: 120 / 360,
  aqua: 180 / 360,
  blue: 225 / 360,
  purple: 270 / 360,
  magenta: 315 / 360,
};
/** A swatch for each range (the panel's dots). */
export const HSL_SWATCH: Record<HslRange, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#f5d90a",
  green: "#30a46c",
  aqua: "#12a594",
  blue: "#3e63dd",
  purple: "#8e4ec6",
  magenta: "#d6409f",
};
/** One range's moves, each -100…100: hue (±30° at the ends), saturation, luminance. */
export type HslShift = { h?: number; s?: number; l?: number };
export type HslAdjust = Partial<Record<HslRange, HslShift>>;
/** How far a range's hue turns at ±100 (degrees). */
export const HSL_HUE_DEG = 30;

/** What a picture looks like, measured once on a tiny copy (`analyzePixels`). */
export type MediaStats = {
  /** Luminance percentiles, 0…1 sRGB. */
  p02: number;
  p10: number;
  p50: number;
  p90: number;
  p98: number;
  /** Mean saturation (0…1). */
  sat: number;
  /** White-balance gains that would neutralise the midtones' cast (each ~0.85…1.15). */
  wb: [number, number, number];
  /** Share of pixels that read as skin (0…1). */
  skin: number;
};

export type MediaGrade = {
  filter: FilterKey;
  /** 0…1: how much of the filter (the adjustments are on top, at full strength). */
  intensity: number;
  adjust?: Adjustments;
  /** The colour ranges moved on their own (on top of everything else). */
  hsl?: HslAdjust;
  /** The picture's own measurements, kept with the grade so the export reads exactly what the preview did. */
  stats?: MediaStats | null;
};

export const ORIGINAL: MediaGrade = { filter: "original", intensity: 1 };

/** The develop parameters every filter and adjustment is written in. */
export type DevelopParams = {
  /** Stops of exposure, applied in linear light with a soft shoulder. */
  exposure: number;
  /** -1…1: an S-curve around the midpoint. */
  contrast: number;
  /** -1…1: lift (+) or deepen (-) the shadows. */
  shadows: number;
  /** -1…1: brighten (+) or recover (-) the highlights. */
  highlights: number;
  /** Black / white points (0…0.2 / 0.8…1 after the curve). */
  blacks: number;
  whites: number;
  /** -1…1: cool to warm, and green to magenta. */
  warmth: number;
  tint: number;
  /** Saturation multiplier offset (-1…1) and vibrance (boosts quiet colours more). */
  saturation: number;
  vibrance: number;
  /** 0…1: how much skin keeps its own saturation when the rest moves. */
  skinProtect: number;
  /** 0…1. */
  sharpen: number;
  /** Split toning: shadows' and highlights' colour (an RGB offset at full strength). */
  shadowTone: [number, number, number];
  highlightTone: [number, number, number];
  /** White balance gains from the picture (Auto's correction). */
  wb: [number, number, number];
  /** -1…1: the midtones lighter or darker (a gamma), the ends held. */
  brightness: number;
  /** -1…1: the very darkest and very brightest tones moved on their own (Lightroom's Blacks / Whites). */
  blacksAdj: number;
  whitesAdj: number;
  /** 0…1: how much of the picture goes black and white. */
  mono: number;
  /** -1…1: local contrast in the midtones (negative: a soft glow). */
  clarity: number;
  /** 0…1: fine detail brought out (a wider sharpen). */
  structure: number;
  /** 0…1: the corners darkened. */
  vignette: number;
  /** 0…1: film grain. */
  grain: number;
};

const NEUTRAL: DevelopParams = {
  exposure: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  blacks: 0,
  whites: 1,
  warmth: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  skinProtect: 0,
  sharpen: 0,
  shadowTone: [0, 0, 0],
  highlightTone: [0, 0, 0],
  wb: [1, 1, 1],
  brightness: 0,
  blacksAdj: 0,
  whitesAdj: 0,
  mono: 0,
  clarity: 0,
  structure: 0,
  vignette: 0,
  grain: 0,
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** How skin-like a colour is (0…1): warm hue, moderate saturation, not too dark or bright. */
export function skinness(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0.08 || max - min < 0.04) return 0;
  if (!(r >= g && g >= b * 0.9)) return 0;
  const s = (max - min) / max;
  // hue of r ≥ g ≥ b: 0° red … 60° yellow
  const h = 60 * ((g - b) / (max - min));
  const hueW = h < 5 ? h / 5 : h <= 38 ? 1 : h < 52 ? (52 - h) / 14 : 0;
  const satW = s < 0.12 ? s / 0.12 : s <= 0.6 ? 1 : s < 0.8 ? (0.8 - s) / 0.2 : 0;
  const lumW = max < 0.2 ? (max - 0.08) / 0.12 : max > 0.97 ? 0.5 : 1;
  return clamp(hueW * satW * lumW, 0, 1);
}

/**
 * A picture's measurements from its RGBA pixels (a tiny copy is plenty:
 * `ANALYSIS_SIZE` on the long side). Percentiles of luminance, mean
 * saturation, the share that reads as skin, and the white balance that
 * would neutralise the midtones' cast (gray world over the quiet midtones,
 * skin left out, so a warm face isn't "corrected" blue).
 */
export const ANALYSIS_SIZE = 96;
export function analyzePixels(data: ArrayLike<number>, stride = 4): MediaStats {
  const hist = new Uint32Array(256);
  let n = 0;
  let satSum = 0;
  let skinN = 0;
  let wr = 0;
  let wg = 0;
  let wbb = 0;
  let wn = 0;
  for (let i = 0; i + 2 < data.length; i += stride) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    if (stride === 4 && data[i + 3] < 8) continue;
    const L = luma(r, g, b);
    hist[Math.min(255, Math.round(L * 255))]++;
    n++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const s = max > 0 ? (max - min) / max : 0;
    satSum += s;
    const sk = skinness(r, g, b);
    if (sk > 0.5) skinN++;
    if (L > 0.18 && L < 0.85 && s < 0.35 && sk < 0.3) {
      wr += r;
      wg += g;
      wbb += b;
      wn++;
    }
  }
  if (!n) return { p02: 0, p10: 0.1, p50: 0.5, p90: 0.9, p98: 1, sat: 0.2, wb: [1, 1, 1], skin: 0 };
  const pct = (p: number) => {
    const target = p * n;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  let wb: [number, number, number] = [1, 1, 1];
  if (wn > n * 0.04) {
    const mr = wr / wn;
    const mg = wg / wn;
    const mb = wbb / wn;
    const gray = (mr + mg + mb) / 3;
    // only the cast, never more than ~12% a channel
    wb = [clamp(gray / mr, 0.88, 1.12), clamp(gray / mg, 0.88, 1.12), clamp(gray / mb, 0.88, 1.12)];
  }
  return { p02: pct(0.02), p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p98: pct(0.98), sat: satSum / n, wb, skin: skinN / n };
}

/** Averages several measurements (a clip's frames, or a carousel for consistency). */
export function mergeStats(list: (MediaStats | null | undefined)[], weights?: number[]): MediaStats | null {
  const items = list.map((s, i) => [s, weights?.[i] ?? 1] as const).filter((x): x is readonly [MediaStats, number] => !!x[0] && x[1] > 0);
  if (!items.length) return null;
  const total = items.reduce((a, [, w]) => a + w, 0);
  const avg = (f: (s: MediaStats) => number) => items.reduce((a, [s, w]) => a + f(s) * w, 0) / total;
  return {
    p02: avg((s) => s.p02),
    p10: avg((s) => s.p10),
    p50: avg((s) => s.p50),
    p90: avg((s) => s.p90),
    p98: avg((s) => s.p98),
    sat: avg((s) => s.sat),
    skin: avg((s) => s.skin),
    wb: [avg((s) => s.wb[0]), avg((s) => s.wb[1]), avg((s) => s.wb[2])],
  };
}

/**
 * A carousel graded with Auto: each picture keeps most of its own reading
 * (`CAROUSEL_OWN`), pulled toward the set's average so the slides still look
 * like one post.
 */
export const CAROUSEL_OWN = 0.7;
export function consistentStats(own: MediaStats | null | undefined, all: (MediaStats | null | undefined)[]): MediaStats | null {
  if (!own) return null;
  const avg = mergeStats(all);
  if (!avg) return own;
  return mergeStats([own, avg], [CAROUSEL_OWN, 1 - CAROUSEL_OWN]);
}

/**
 * The correction a picture needs, read from its measurements: exposure toward
 * a natural midtone, the black and white points stretched part of the way,
 * shadows lifted when they're crushed, highlights recovered when they clip,
 * contrast for a flat picture, vibrance for a dull one, the cast taken out.
 * Every move is limited, so a picture that's already right is left alone.
 */
export function autoCorrection(st: MediaStats): Partial<DevelopParams> {
  const midLin = Math.max(0.005, srgbToLinear(clamp(st.p50, 0.01, 0.99)));
  const exposure = clamp(Math.log2(0.19 / midLin) * 0.55, -0.6, 0.9);
  const range = st.p98 - st.p02;
  const contrast = range < 0.55 ? clamp((0.55 - range) * 0.8, 0, 0.28) : range > 0.92 ? -0.05 : 0;
  const shadows = st.p10 < 0.07 ? clamp((0.07 - st.p10) * 5, 0, 0.35) : 0;
  const highlights = st.p98 > 0.97 || st.p90 > 0.9 ? -clamp((Math.max(st.p98 - 0.95, st.p90 - 0.88)) * 6, 0, 0.4) : 0;
  const blacks = st.p02 > 0.06 ? clamp((st.p02 - 0.03) * 0.6, 0, 0.08) : 0;
  const whites = st.p98 < 0.9 ? clamp(1 - (0.94 - st.p98) * 0.5, 0.88, 1) : 1;
  const vibrance = st.sat < 0.18 ? clamp((0.18 - st.sat) * 2, 0, 0.3) : 0;
  // a face in the frame keeps its warmth: the correction is gentler the more skin there is
  const wbStrength = 0.55 * (1 - clamp(st.skin * 2, 0, 0.6));
  const wb: [number, number, number] = [lerp(1, st.wb[0], wbStrength), lerp(1, st.wb[1], wbStrength), lerp(1, st.wb[2], wbStrength)];
  return { exposure, contrast, shadows, highlights, blacks, whites, vibrance, wb, skinProtect: 0.7 };
}

type Preset = {
  /** How much of the picture's own correction comes first (0 none, 1 all of it). */
  auto: number;
  look: Partial<DevelopParams>;
};

/**
 * The filters, as looks on top of the picture's own correction (each reads the
 * picture first, `auto`, so a dark gym and a bright one both land well):
 *
 *   Auto Enhance  the correction alone.
 *   Cool / Warm   a white-balance move with the tones kept clean (never a
 *                 blue or orange wash): skin keeps its saturation, the
 *                 highlights and shadows take a touch of the temperature.
 *   Natural       a gentle correction, true to life. Natural+ a little more,
 *                 with clarity.
 *   Bright        clear and lively, skin natural. Soft: lower contrast, held
 *                 highlights, a faint glow. High Contrast: punch and depth.
 *   Cinematic     restrained teal shadows and warm highlights, a soft vignette.
 *   Moody         darker, desaturated, lifted blacks. Vintage: faded, warm,
 *                 grain. Film: a portrait stock (soft blacks, gentle colour,
 *                 grain).
 *   Black & White a red-leaning mono mix (kind to skin) with contrast.
 *   Gritty        detail and texture, colour pulled back, vignette.
 *   Workout       a cinematic gym. Golden Hour: low warm sun. Flash: direct
 *                 flash, crisp and punchy.
 */
const PRESETS: Record<Exclude<FilterKey, "original">, Preset> = {
  auto: { auto: 1, look: { sharpen: 0.12, skinProtect: 0.7 } },
  neutral: { auto: 0.55, look: { contrast: 0.02, vibrance: 0.04, skinProtect: 0.85 } },
  natural: { auto: 0.7, look: { contrast: 0.06, vibrance: 0.08, sharpen: 0.15, clarity: 0.08, skinProtect: 0.8 } },
  cool: {
    auto: 0.55,
    look: { warmth: -0.34, tint: -0.02, contrast: 0.06, highlights: -0.08, saturation: -0.03, shadowTone: [-0.005, 0.002, 0.012], highlightTone: [-0.003, 0.001, 0.006], skinProtect: 0.9 },
  },
  warm: {
    auto: 0.55,
    look: { warmth: 0.32, tint: 0.025, shadows: 0.05, highlights: -0.06, saturation: 0.03, vibrance: 0.04, shadowTone: [0.005, 0.002, -0.005], highlightTone: [0.01, 0.005, -0.008], skinProtect: 0.9 },
  },
  vibrant: {
    auto: 0.7,
    look: { exposure: 0.22, contrast: 0.1, shadows: 0.22, highlights: -0.16, saturation: 0.06, vibrance: 0.34, warmth: 0.04, sharpen: 0.15, skinProtect: 0.9 },
  },
  soft: {
    auto: 0.6,
    look: { exposure: 0.06, contrast: -0.2, highlights: -0.22, shadows: 0.16, blacks: 0.03, whites: 0.98, saturation: -0.08, vibrance: 0.05, clarity: -0.16, skinProtect: 0.9 },
  },
  punch: {
    auto: 0.6,
    look: { contrast: 0.5, highlights: -0.12, shadows: -0.04, blacksAdj: -0.25, whitesAdj: 0.15, saturation: 0.05, clarity: 0.25, sharpen: 0.2, skinProtect: 0.75 },
  },
  cinematic: {
    auto: 0.6,
    look: {
      contrast: 0.22,
      shadows: 0.08,
      highlights: -0.26,
      blacks: 0.015,
      saturation: -0.08,
      shadowTone: [-0.03, 0.008, 0.032],
      highlightTone: [0.028, 0.012, -0.022],
      vignette: 0.25,
      skinProtect: 0.85,
    },
  },
  moody: {
    auto: 0.5,
    look: { exposure: -0.18, contrast: 0.18, highlights: -0.3, shadows: -0.02, blacks: 0.035, saturation: -0.3, clarity: 0.15, shadowTone: [-0.008, 0.004, 0.018], vignette: 0.35, skinProtect: 0.7 },
  },
  vintage: {
    auto: 0.45,
    look: {
      contrast: -0.08,
      blacks: 0.07,
      whites: 0.95,
      saturation: -0.16,
      warmth: 0.18,
      tint: 0.05,
      shadowTone: [0.0, 0.014, 0.022],
      highlightTone: [0.028, 0.018, -0.022],
      grain: 0.25,
      vignette: 0.22,
      skinProtect: 0.7,
    },
  },
  film: {
    auto: 0.6,
    look: { contrast: 0.08, blacks: 0.03, whites: 0.97, saturation: -0.06, vibrance: 0.08, warmth: 0.08, highlightTone: [0.014, 0.008, -0.01], shadowTone: [-0.004, 0.004, 0.01], grain: 0.32, skinProtect: 0.9 },
  },
  mono: { auto: 0.6, look: { mono: 1, contrast: 0.2, clarity: 0.12, blacksAdj: -0.15 } },
  gritty: {
    auto: 0.5,
    look: { contrast: 0.36, clarity: 0.55, structure: 0.5, saturation: -0.35, highlights: -0.25, shadows: 0.14, blacksAdj: -0.2, vignette: 0.3, grain: 0.18, sharpen: 0.2 },
  },
  shadow: {
    auto: 0.6,
    look: {
      exposure: -0.08,
      contrast: 0.4,
      shadows: 0.16,
      highlights: -0.32,
      blacks: -0.035,
      saturation: -0.14,
      sharpen: 0.28,
      shadowTone: [-0.02, 0.0, 0.035],
      highlightTone: [0.03, 0.012, -0.02],
      skinProtect: 0.6,
    },
  },
  golden: {
    auto: 0.55,
    look: { exposure: 0.06, warmth: 0.46, tint: 0.04, highlights: -0.12, shadows: 0.1, saturation: 0.04, vibrance: 0.12, highlightTone: [0.036, 0.018, -0.026], vignette: 0.12, skinProtect: 0.92 },
  },
  flash: {
    auto: 0.5,
    look: { exposure: 0.12, contrast: 0.32, highlights: -0.28, shadows: -0.06, whites: 0.98, saturation: 0.04, vibrance: 0.06, warmth: -0.06, sharpen: 0.38, skinProtect: 0.75 },
  },
};

/** Adds two parameter sets (gains multiply, tones add). */
function combine(a: DevelopParams, b: Partial<DevelopParams>): DevelopParams {
  const add = (k: keyof DevelopParams) => (b[k] == null ? 0 : (b[k] as number));
  return {
    exposure: a.exposure + add("exposure"),
    contrast: a.contrast + add("contrast"),
    shadows: a.shadows + add("shadows"),
    highlights: a.highlights + add("highlights"),
    blacks: a.blacks + add("blacks"),
    whites: b.whites == null ? a.whites : a.whites * b.whites,
    warmth: a.warmth + add("warmth"),
    tint: a.tint + add("tint"),
    saturation: a.saturation + add("saturation"),
    vibrance: a.vibrance + add("vibrance"),
    skinProtect: Math.max(a.skinProtect, b.skinProtect ?? 0),
    sharpen: a.sharpen + add("sharpen"),
    shadowTone: b.shadowTone ? [a.shadowTone[0] + b.shadowTone[0], a.shadowTone[1] + b.shadowTone[1], a.shadowTone[2] + b.shadowTone[2]] : a.shadowTone,
    highlightTone: b.highlightTone
      ? [a.highlightTone[0] + b.highlightTone[0], a.highlightTone[1] + b.highlightTone[1], a.highlightTone[2] + b.highlightTone[2]]
      : a.highlightTone,
    wb: b.wb ? [a.wb[0] * b.wb[0], a.wb[1] * b.wb[1], a.wb[2] * b.wb[2]] : a.wb,
    brightness: a.brightness + add("brightness"),
    blacksAdj: a.blacksAdj + add("blacksAdj"),
    whitesAdj: a.whitesAdj + add("whitesAdj"),
    mono: Math.max(a.mono, b.mono ?? 0),
    clarity: a.clarity + add("clarity"),
    structure: a.structure + add("structure"),
    vignette: a.vignette + add("vignette"),
    grain: a.grain + add("grain"),
  };
}

/** Scales a parameter set toward neutral (intensity). */
function scaleParams(p: Partial<DevelopParams>, t: number): Partial<DevelopParams> {
  const out: Partial<DevelopParams> = {};
  for (const [k, v] of Object.entries(p) as [keyof DevelopParams, unknown][]) {
    if (k === "whites") out.whites = lerp(1, v as number, t);
    else if (k === "skinProtect") out.skinProtect = v as number;
    else if (k === "wb") out.wb = (v as number[]).map((x) => lerp(1, x, t)) as [number, number, number];
    else if (Array.isArray(v)) (out as Record<string, unknown>)[k] = v.map((x: number) => x * t);
    else (out as Record<string, unknown>)[k] = (v as number) * t;
  }
  return out;
}

/** The person's adjustments as develop parameters (each slider's full travel is a strong but sane move). */
export function adjustParams(a: Adjustments | undefined): Partial<DevelopParams> {
  if (!a) return {};
  const v = (k: AdjustKey) => clamp(a[k] ?? 0, ONE_WAY.has(k) ? 0 : -100, 100) / 100;
  const sat = v("saturation");
  const fade = v("fade");
  return {
    exposure: v("exposure") * 1.2,
    brightness: v("brightness") * 0.8,
    contrast: v("contrast") * 0.5 - fade * 0.1,
    // -100 is black and white, like Instagram's
    saturation: sat < 0 ? sat : sat * 0.7,
    vibrance: v("vibrance") * 0.8,
    highlights: v("highlights") * 0.6,
    shadows: v("shadows") * 0.6,
    whitesAdj: v("whites"),
    blacksAdj: v("blacks"),
    warmth: v("warmth") * 0.6,
    tint: v("tint") * 0.6,
    sharpen: v("sharpness"),
    clarity: v("clarity") * 0.8,
    structure: v("structure"),
    blacks: fade * 0.12,
    ...(fade > 0 ? { whites: 1 - fade * 0.04 } : {}),
    vignette: v("vignette"),
    grain: v("grain"),
  };
}

/** The HSL moves as 8 × [hue turn (0…1 of the wheel), saturation, luminance], or null when there are none. */
export function hslTable(h: HslAdjust | undefined): Float32Array | null {
  if (!h) return null;
  const out = new Float32Array(HSL_RANGES.length * 3);
  let any = false;
  HSL_RANGES.forEach((r, i) => {
    const x = h[r];
    if (!x) return;
    const hu = clamp(x.h ?? 0, -100, 100) / 100;
    const sa = clamp(x.s ?? 0, -100, 100) / 100;
    const lu = clamp(x.l ?? 0, -100, 100) / 100;
    out[i * 3] = (hu * HSL_HUE_DEG) / 360;
    out[i * 3 + 1] = sa;
    out[i * 3 + 2] = lu;
    if (hu || sa || lu) any = true;
  });
  return any ? out : null;
}

/** A grade is Original when nothing in it would change a pixel. */
export function isOriginal(g: MediaGrade | null | undefined): boolean {
  if (!g) return true;
  const adj = g.adjust ? ADJUST_KEYS.some((k) => (g.adjust?.[k] ?? 0) !== 0) : false;
  return (g.filter === "original" || g.intensity <= 0) && !adj && !hslTable(g.hsl);
}

/** The develop parameters a grade means for a picture with these measurements. */
export function gradeParams(g: MediaGrade): DevelopParams {
  let p = { ...NEUTRAL };
  if (g.filter !== "original" && g.intensity > 0) {
    const preset = PRESETS[g.filter];
    const t = clamp(g.intensity, 0, 1);
    if (preset.auto > 0 && g.stats) p = combine(p, scaleParams(autoCorrection(g.stats), preset.auto * t));
    p = combine(p, scaleParams(preset.look, t));
  }
  return combine(p, adjustParams(g.adjust));
}

export type CompiledGrade = {
  /** White balance + warmth / tint gains. */
  gains: [number, number, number];
  /** 256 steps per channel, interleaved RGBA bytes (alpha 255), ready for a texture. */
  lut: Uint8Array;
  saturation: number;
  vibrance: number;
  skinProtect: number;
  sharpen: number;
  /** The rest of the look, after the colour (each 0 = off). */
  mono: number;
  clarity: number;
  structure: number;
  vignette: number;
  grain: number;
  /** 8 × [hue turn, saturation, luminance] (hslTable), or null. */
  hsl: Float32Array | null;
  identity: boolean;
};

/** The black-and-white mix: a little more red than plain luminance, so skin reads light and clean (a red filter's way). */
export const MONO_MIX: [number, number, number] = [0.36, 0.53, 0.11];

/** The tone curve for one value of one channel. */
function tone(v: number, p: DevelopParams, ch: 0 | 1 | 2): number {
  // exposure in linear light with a soft shoulder (no hard clip when brightening)
  let lin = srgbToLinear(clamp(v, 0, 1)) * Math.pow(2, p.exposure);
  if (p.exposure > 0 && lin > 0.8) lin = 0.8 + (1 - 0.8) * (1 - Math.exp(-(lin - 0.8) / (1 - 0.8)));
  let x = linearToSrgb(clamp(lin, 0, 1));
  // brightness: the midtones by a gamma, black and white held where they are
  if (p.brightness) x = Math.pow(x, Math.pow(2, -clamp(p.brightness, -1, 1) * 0.9));
  // shadows / highlights: lifts weighted toward each end
  const ws = (1 - x) * (1 - x) * x * 4.5;
  const wh = x * x * (1 - x) * 4.5;
  x += p.shadows * 0.28 * ws + p.highlights * 0.28 * wh;
  // whites / blacks: only the very ends (never past where the next tone in sits: the curve stays in order)
  x = clamp(x, 0, 1);
  x += clamp(p.blacksAdj, -1, 1) * 0.12 * (1 - x) * (1 - x) * (1 - x) + clamp(p.whitesAdj, -1, 1) * 0.12 * x * x * x;
  // contrast: an S-curve around the middle
  const k = Math.pow(2, clamp(p.contrast, -0.9, 1.5));
  x = clamp(x, 0, 1);
  x = x < 0.5 ? 0.5 * Math.pow(2 * x, k) : 1 - 0.5 * Math.pow(2 * (1 - x), k);
  // black and white points
  x = p.blacks + x * (p.whites - p.blacks);
  // split toning: each end its own colour, fading to nothing in the middle
  const sh = Math.max(0, 1 - x * 2.2);
  const hi = Math.max(0, x * 2.2 - 1.2);
  x += p.shadowTone[ch] * sh + p.highlightTone[ch] * hi;
  return clamp(x, 0, 1);
}

/** A grade compiled for the GPU and the pixel loop alike. */
export function compileGrade(g: MediaGrade | null | undefined): CompiledGrade {
  const p = g ? gradeParams(g) : NEUTRAL;
  const lut = new Uint8Array(256 * 4);
  let identity = true;
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    for (let c = 0; c < 3; c++) {
      const out = Math.round(tone(v, p, c as 0 | 1 | 2) * 255);
      lut[i * 4 + c] = out;
      if (out !== i) identity = false;
    }
    lut[i * 4 + 3] = 255;
  }
  const w = clamp(p.warmth, -1, 1);
  const t = clamp(p.tint, -1, 1);
  const gains: [number, number, number] = [p.wb[0] * (1 + 0.11 * w + 0.02 * t), p.wb[1] * (1 - 0.04 * t), p.wb[2] * (1 - 0.12 * w + 0.02 * t)];
  const saturation = clamp(1 + p.saturation, 0, 2.5);
  const vibrance = clamp(p.vibrance, -1, 1.5);
  const sharpen = clamp(p.sharpen, 0, 1.5);
  const mono = clamp(p.mono, 0, 1);
  const clarity = clamp(p.clarity, -1, 1.2);
  const structure = clamp(p.structure, 0, 1.2);
  const vignette = clamp(p.vignette, 0, 1.2);
  const grain = clamp(p.grain, 0, 1);
  const hsl = g ? hslTable(g.hsl) : null;
  if (
    gains.some((x) => Math.abs(x - 1) > 1e-3) ||
    Math.abs(saturation - 1) > 1e-3 ||
    Math.abs(vibrance) > 1e-3 ||
    sharpen > 1e-3 ||
    mono > 1e-3 ||
    Math.abs(clarity) > 1e-3 ||
    structure > 1e-3 ||
    vignette > 1e-3 ||
    grain > 1e-3 ||
    hsl
  )
    identity = false;
  return { gains, lut, saturation, vibrance, skinProtect: clamp(p.skinProtect, 0, 1), sharpen, mono, clarity, structure, vignette, grain, hsl, identity };
}

const compiled = new WeakMap<MediaGrade, CompiledGrade>();
/** `compileGrade`, once per grade object (grades are replaced, never changed in place). */
export function compiledFor(g: MediaGrade | null | undefined): CompiledGrade | null {
  if (!g || isOriginal(g)) return null;
  let c = compiled.get(g);
  if (!c) {
    c = compileGrade(g);
    compiled.set(g, c);
  }
  return c.identity ? null : c;
}

/* ---- the colour wheel (mirrored exactly by the shader in media-grade-gl.ts) ---- */

const fract = (x: number) => x - Math.floor(x);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** RGB → HSV (h 0…1), the branch-free form the shader uses. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const p = g >= b ? [g, b, 0, -1 / 3] : [b, g, -1, 2 / 3];
  const q = r >= p[0] ? [r, p[1], p[2], p[0]] : [p[0], p[1], p[3], r];
  const d = q[0] - Math.min(q[3], q[1]);
  const e = 1e-10;
  return [Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e)), d / (q[0] + e), q[0]];
}

/** HSV → RGB, the shader's form. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const ch = (k: number) => {
    const p = Math.abs(fract(h + k) * 6 - 3);
    return v * lerp(1, clamp(p - 1, 0, 1), s);
  };
  return [ch(1), ch(2 / 3), ch(1 / 3)];
}

const CENTRES = HSL_RANGES.map((r) => HSL_CENTRES[r]);
/** How much of each range a hue is (triangles on the eight centres: they always add up to 1). */
export function hslWeight(h: number, i: number): number {
  const n = CENTRES.length;
  const c = CENTRES[i];
  const prev = CENTRES[(i + n - 1) % n];
  const next = CENTRES[(i + 1) % n];
  let d = h - c;
  d -= Math.floor(d + 0.5);
  let right = next - c;
  if (right <= 0) right += 1;
  let left = c - prev;
  if (left <= 0) left += 1;
  return d >= 0 ? Math.max(0, 1 - d / right) : Math.max(0, 1 + d / left);
}

/** A colour through the HSL table (hslTable): each range's turn, saturation and luminance, by how much of it the colour is. */
export function applyHsl(t: Float32Array, r: number, g: number, b: number): [number, number, number] {
  const [h, s, v] = rgbToHsv(r, g, b);
  // a grey has no hue to move: the moves fade in with saturation
  const amt = smoothstep(0.02, 0.2, s);
  if (amt <= 0) return [r, g, b];
  let dh = 0;
  let ds = 0;
  let dl = 0;
  for (let i = 0; i < CENTRES.length; i++) {
    const w = hslWeight(h, i);
    if (w <= 0) continue;
    dh += t[i * 3] * w;
    ds += t[i * 3 + 1] * w;
    dl += t[i * 3 + 2] * w;
  }
  const [r2, g2, b2] = hsvToRgb(fract(h + dh * amt), clamp(s * (1 + ds * amt), 0, 1), v);
  const k = 1 + dl * 0.35 * s * amt;
  return [clamp(r2 * k, 0, 1), clamp(g2 * k, 0, 1), clamp(b2 * k, 0, 1)];
}

/**
 * One pixel through a compiled grade's colour (white balance, the tone curve,
 * saturation, HSL, black and white). Detail, the vignette and grain need its
 * place in the picture: `gradePixels`.
 */
export function gradeRgb(c: CompiledGrade, r0: number, g0: number, b0: number): [number, number, number] {
  const look = (v: number, ch: number) => {
    const x = clamp(v, 0, 1) * 255;
    const i = Math.floor(x);
    const f = x - i;
    const a = c.lut[Math.min(255, i) * 4 + ch];
    const b = c.lut[Math.min(255, i + 1) * 4 + ch];
    return (a + (b - a) * f) / 255;
  };
  let r = look(r0 * c.gains[0], 0);
  let g = look(g0 * c.gains[1], 1);
  let b = look(b0 * c.gains[2], 2);
  const L = luma(r, g, b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const s = max > 0 ? (max - min) / max : 0;
  let k = c.saturation * (1 + c.vibrance * (1 - s) * (1 - s));
  // skin keeps (most of) its own saturation: whatever the rest gets, it moves at most a little
  const sk = c.skinProtect > 0 ? skinness(r0, g0, b0) * c.skinProtect : 0;
  if (sk > 0) k = lerp(k, clamp(k, 0.92, 1.06), sk);
  r = clamp(L + (r - L) * k, 0, 1);
  g = clamp(L + (g - L) * k, 0, 1);
  b = clamp(L + (b - L) * k, 0, 1);
  if (c.hsl) [r, g, b] = applyHsl(c.hsl, r, g, b);
  if (c.mono > 0) {
    const m = r * MONO_MIX[0] + g * MONO_MIX[1] + b * MONO_MIX[2];
    r = lerp(r, m, c.mono);
    g = lerp(g, m, c.mono);
    b = lerp(b, m, c.mono);
  }
  return [r, g, b];
}

/** The detail radii for a picture of this size (px): a wider sharpen (structure) and local contrast (clarity). */
export function detailRadii(w: number, h: number): { structure: number; clarity: number } {
  const S = Math.min(w, h);
  return { structure: Math.max(1, S / 400), clarity: Math.max(2, S / 90) };
}
/** Grain cells across the picture (about 1.5 px each at 1080). */
export function grainCells(w: number, h: number): [number, number] {
  const cell = Math.max(1, Math.min(w, h) / 720);
  return [w / cell, h / cell];
}
/** The grain's noise for a cell: Dave Hoskins' hash12, exactly as the shader has it. */
export function grainHash(px: number, py: number): number {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1031);
  let z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  return fract((x + y) * z);
}
/** How much the vignette darkens a point (u, v 0…1 across the picture). */
export function vignetteAt(c: CompiledGrade, u: number, v: number): number {
  if (c.vignette <= 0) return 1;
  const qx = (u - 0.5) * 2;
  const qy = (v - 0.5) * 2;
  const r = Math.sqrt(qx * qx + qy * qy) / Math.SQRT2;
  return 1 - c.vignette * 0.7 * smoothstep(0.3, 1, r);
}
const RING8: [number, number][] = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

/**
 * The whole picture through a grade, in place (RGBA, `w`×`h`): the pixel loop
 * the GPU shader mirrors, for a phone without WebGL and for the tests.
 */
export function gradePixels(data: Uint8ClampedArray, w: number, h: number, c: CompiledGrade): void {
  if (c.identity) return;
  const detail = c.sharpen > 0 || c.structure > 0 || c.clarity !== 0;
  const src = detail ? new Uint8ClampedArray(data) : data;
  const lumAt = (xx: number, yy: number) => {
    const j = ((Math.min(h - 1, Math.max(0, Math.round(yy))) * w + Math.min(w - 1, Math.max(0, Math.round(xx)))) * 4) | 0;
    return luma(src[j] / 255, src[j + 1] / 255, src[j + 2] / 255);
  };
  const rad = detailRadii(w, h);
  const [gx, gy] = grainCells(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let [r, g, b] = gradeRgb(c, src[i] / 255, src[i + 1] / 255, src[i + 2] / 255);
      if (detail) {
        const l0 = lumAt(x, y);
        let d = 0;
        if (c.sharpen > 0) d += clamp(l0 - (lumAt(x, y - 1) + lumAt(x, y + 1) + lumAt(x - 1, y) + lumAt(x + 1, y)) / 4, -0.12, 0.12) * c.sharpen * 1.6;
        if (c.structure > 0) {
          const R = rad.structure;
          d += clamp(l0 - (lumAt(x, y - R) + lumAt(x, y + R) + lumAt(x - R, y) + lumAt(x + R, y)) / 4, -0.15, 0.15) * c.structure * 1.4;
        }
        if (c.clarity !== 0) {
          const R = rad.clarity;
          let sum = 0;
          for (const [ox, oy] of RING8) sum += lumAt(x + ox * R, y + oy * R);
          const L = luma(r, g, b);
          const mid = 1 - (2 * L - 1) * (2 * L - 1);
          d += clamp(l0 - sum / 8, -0.25, 0.25) * c.clarity * 1.2 * mid;
        }
        r = clamp(r + d, 0, 1);
        g = clamp(g + d, 0, 1);
        b = clamp(b + d, 0, 1);
      }
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      if (c.vignette > 0) {
        const f = vignetteAt(c, u, v);
        r *= f;
        g *= f;
        b *= f;
      }
      if (c.grain > 0) {
        const L = luma(r, g, b);
        const mid = 1 - (2 * L - 1) * (2 * L - 1);
        const n = (grainHash(Math.floor(u * gx), Math.floor(v * gy)) - 0.5) * c.grain * 0.18 * (0.35 + 0.65 * mid);
        r = clamp(r + n, 0, 1);
        g = clamp(g + n, 0, 1);
        b = clamp(b + n, 0, 1);
      }
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
    }
  }
}

/** A grade with nothing in it but the filter (a fresh pick keeps the person's intensity, adjustments and colour moves). */
export function withFilter(g: MediaGrade | null | undefined, filter: FilterKey): MediaGrade {
  return { filter, intensity: g?.intensity ?? 1, adjust: g?.adjust, hsl: g?.hsl, stats: g?.stats ?? null };
}

/** The HSL moves as they're stored: whole numbers -100…100, ranges with nothing moved left out. */
export function cleanHsl(raw: unknown): HslAdjust | null {
  if (!raw || typeof raw !== "object") return null;
  const out: HslAdjust = {};
  for (const r of HSL_RANGES) {
    const x = (raw as Record<string, unknown>)[r];
    if (!x || typeof x !== "object") continue;
    const shift: HslShift = {};
    for (const k of ["h", "s", "l"] as const) {
      const v = (x as Record<string, unknown>)[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const n = clamp(Math.round(v), -100, 100);
      if (n !== 0) shift[k] = n;
    }
    if (Object.keys(shift).length) out[r] = shift;
  }
  return Object.keys(out).length ? out : null;
}

/** A grade as it's stored (account default, a preset, a post's record): only what changes a pixel, rounded. */
export function cleanGrade(g: unknown): MediaGrade | null {
  if (!g || typeof g !== "object") return null;
  const r = g as Record<string, unknown>;
  const filter = typeof r.filter === "string" && (FILTER_KEYS as readonly string[]).includes(r.filter) ? (r.filter as FilterKey) : null;
  if (!filter) return null;
  const intensity = typeof r.intensity === "number" && Number.isFinite(r.intensity) ? clamp(Math.round(r.intensity * 100) / 100, 0, 1) : 1;
  const adjust: Adjustments = {};
  if (r.adjust && typeof r.adjust === "object") {
    for (const k of ADJUST_KEYS) {
      const v = (r.adjust as Record<string, unknown>)[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const n = clamp(Math.round(v), ONE_WAY.has(k) ? 0 : -100, 100);
      if (n !== 0) adjust[k] = n;
    }
  }
  const hsl = cleanHsl(r.hsl);
  return { filter, intensity, ...(Object.keys(adjust).length ? { adjust } : {}), ...(hsl ? { hsl } : {}) };
}

/** Anything in the grade beyond the filter itself (the panel's Reset, and "edited" on its tab). */
export function hasOwnEdits(g: MediaGrade | null | undefined): boolean {
  if (!g) return false;
  return ADJUST_KEYS.some((k) => (g.adjust?.[k] ?? 0) !== 0) || !!hslTable(g.hsl);
}
