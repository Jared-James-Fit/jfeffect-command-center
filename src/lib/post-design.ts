/**
 * The automated posts' design system (Nov 25 2026): one source for every
 * card the app paints for Crew and Instagram (decks, lessons, Wins, the
 * Recap, Tuesday's numbers, Thursday's feature, birthdays, words). Premium
 * athletic: black, off-white, graphite and the JF Effect red; a condensed
 * display face (Anton, bundled) in capitals for the line people read in the
 * grid, the phone's heavy sans for everything they read in the carousel;
 * no serif, no italics, no gradients or glows.
 *
 * Pure (no canvas): the tokens, the four surfaces, the type scale, and the
 * checks a card passes before it's shown (contrast, the size the headline
 * reads at in the three-across profile grid, nothing clipped or shrunk past
 * what reads). The painters are post-design-paint.ts, deck-cards.ts and
 * instagram-cards.ts; the server's pre-publish check on a deck's words is
 * `designProblems` here, run with the deck checks (post-deck-checks.ts).
 */

/** Bump when the look of any painted card changes: every post repaints (post-art.ts keys on it). */
export const POST_DESIGN_VERSION = 2;

/** The painted cards that are carousels, a picture per slide: a deck, Wins, the Recap. */
export const CAROUSEL_CARDS: ReadonlySet<string> = new Set(["deck", "wins", "recap"]);

/* ------------------------------------------------------------------ */
/*  Colour                                                             */
/* ------------------------------------------------------------------ */

export const COLOR = {
  black: "#111113",
  graphite: "#2a2b30",
  offwhite: "#f3f1ec",
  white: "#ffffff",
  /** The red as a surface (white words on it). */
  red: "#d42a36",
  /** The red as text or a mark on a dark surface. */
  redOnDark: "#ff5a65",
  /** The red as text or a mark on a light surface. */
  redOnLight: "#cf2733",
  /** A PR, a record: the one warm accent (never a gradient). */
  gold: "#f5b52e",
} as const;

export type SurfaceName = "black" | "graphite" | "offwhite" | "red";

/** A surface and everything drawn on it. Every pair is checked for contrast (surfaceContrast). */
export type Surface = {
  name: SurfaceName;
  bg: string;
  /** Headlines and the main words. */
  ink: string;
  /** Supporting words. */
  sub: string;
  /** The accent: a word picked out, a number, a bar. */
  accent: string;
  /** Words on an accent-filled shape. */
  onAccent: string;
  /** Hairlines, empty bar tracks. */
  line: string;
  /** A chart mark that isn't the highlight: a solid grey, never a faint wash. */
  bar: string;
  /** A panel behind a diagram or a group. */
  panel: string;
  dark: boolean;
};

export const SURFACES: Record<SurfaceName, Surface> = {
  black: { name: "black", bg: COLOR.black, ink: COLOR.offwhite, sub: "#a9a8ad", accent: COLOR.redOnDark, onAccent: COLOR.white, line: "rgba(243,241,236,0.16)", bar: "#56575c", panel: "rgba(243,241,236,0.06)", dark: true },
  graphite: { name: "graphite", bg: COLOR.graphite, ink: COLOR.white, sub: "#c2c1c6", accent: COLOR.redOnDark, onAccent: COLOR.white, line: "rgba(255,255,255,0.18)", bar: "#66676d", panel: "rgba(255,255,255,0.07)", dark: true },
  offwhite: { name: "offwhite", bg: COLOR.offwhite, ink: COLOR.black, sub: "#55545a", accent: COLOR.redOnLight, onAccent: COLOR.white, line: "rgba(17,17,19,0.14)", bar: "#b6b3ad", panel: "rgba(17,17,19,0.05)", dark: false },
  red: { name: "red", bg: COLOR.red, ink: COLOR.white, sub: "rgba(255,255,255,0.95)", accent: COLOR.black, onAccent: COLOR.white, line: "rgba(255,255,255,0.32)", bar: "#ec8f97", panel: "rgba(0,0,0,0.12)", dark: true },
};

/* ------------------------------------------------------------------ */
/*  Type                                                               */
/* ------------------------------------------------------------------ */

/**
 * Sizes on the 1080-wide card. The profile grid shows a card at about 129pt
 * wide on a 390pt phone (three across, 2pt gaps), about 0.12 of its size, so
 * the headline is never under GRID_MIN_HEADLINE (≈13pt in the grid); the
 * carousel shows a slide at the phone's width (~0.36), so supporting words
 * are never under BODY_MIN (≈15pt there).
 */
export const GRID_TILE_PT = 129;
export const CARD_W = 1080;
export const GRID_SCALE = GRID_TILE_PT / CARD_W;
export const FEED_SCALE = 390 / CARD_W;

export const TYPE = {
  /** The grid line: Anton, capitals. */
  hook: { start: 210, min: 112, lh: 0.93, maxLines: 5 },
  /** A number that is the point. */
  hero: { start: 330, min: 150 },
  /** A slide's title (sentence case, heavy sans). */
  title: { start: 116, min: 70, lh: 1.05 },
  /** Supporting words. */
  body: { start: 58, min: 44, lh: 1.28 },
  /** Small capitals over a block. */
  kicker: 34,
  label: 30,
} as const;

/** The smallest a headline may read in the grid (pt), and a slide's words in the feed. */
export const GRID_MIN_HEADLINE_PT = 12.5;
export const FEED_MIN_BODY_PT = 12;
/** Tracked capitals (a kicker, a date, "Swipe"): a label, read at a glance. */
export const FEED_MIN_LABEL_PT = 10.5;

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

/** Side margin; the grid's 3:4 tile crops ~34px off each side of the 4:5 card, so this keeps ~62px clear there. */
export const PAD_X = 96;
/** Room kept at the foot for the brand row. */
export const FOOT = 108;
/** Room at the top for the kicker (and the app's slide counter, top right). */
export const HEAD = 104;

/* ------------------------------------------------------------------ */
/*  Contrast                                                           */
/* ------------------------------------------------------------------ */

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** "#rrggbb" or "rgba(r,g,b,a)" over `under` (opaque) → [r, g, b]. */
export function parseColor(color: string, under: [number, number, number] = [255, 255, 255]): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color.trim());
  if (!m) throw new Error(`colour: ${color}`);
  const a = m[4] == null ? 1 : Number(m[4]);
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  return rgb.map((v, i) => Math.round(v * a + under[i] * (1 - a))) as [number, number, number];
}

export function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio of `fg` on `bg` (a translucent `fg` composited over `bg`). */
export function contrastRatio(fg: string, bg: string): number {
  const b = parseColor(bg);
  const f = parseColor(fg, b);
  const [l1, l2] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** What each role on a surface must reach: words people read 4.5, big type 3. */
export const CONTRAST_MIN = { ink: 4.5, sub: 4.5, accent: 3, onAccent: 3 } as const;

/** Every role on every surface against its minimum; empty when all pass. */
export function surfaceContrastProblems(): string[] {
  const out: string[] = [];
  for (const s of Object.values(SURFACES)) {
    const check = (role: keyof typeof CONTRAST_MIN, fg: string, bg: string) => {
      const r = contrastRatio(fg, bg);
      if (r < CONTRAST_MIN[role]) out.push(`${s.name} ${role} ${r.toFixed(2)} < ${CONTRAST_MIN[role]}`);
    };
    check("ink", s.ink, s.bg);
    check("sub", s.sub, s.bg);
    check("accent", s.accent, s.bg);
    check("onAccent", s.onAccent, s.accent === COLOR.black ? COLOR.black : s.accent);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  What a painted card reports, and what it must pass                 */
/* ------------------------------------------------------------------ */

export type TextRole = "hook" | "hero" | "title" | "body" | "label";

/** One run of words as it ended up on the card (its size after any shrinking). */
export type DrawnText = { role: TextRole; px: number; fg: string; bg: string };

export type PaintReport = {
  card: string;
  slide: number;
  texts: DrawnText[];
  /** How far a block had to be shrunk to fit (1 = as designed). */
  scale: number;
  /** A block that still didn't fit (scaled past the floor, or cut). */
  clipped: boolean;
};

/** The roles read in the grid (a cover's headline, a hero number). */
const GRID_ROLES = new Set<TextRole>(["hook", "hero"]);

/** What's wrong with a painted card, in words; empty when it reads in the grid and the feed. */
export function reportProblems(r: PaintReport): string[] {
  const out: string[] = [];
  if (r.clipped) out.push("content didn't fit");
  for (const t of r.texts) {
    const ratio = contrastRatio(t.fg, t.bg);
    const need = t.role === "body" || t.role === "label" ? CONTRAST_MIN.sub : CONTRAST_MIN.accent;
    if (ratio < need) out.push(`${t.role} contrast ${ratio.toFixed(2)}`);
    if (GRID_ROLES.has(t.role) && r.slide === 0 && t.px * GRID_SCALE < GRID_MIN_HEADLINE_PT - 0.05) out.push(`${t.role} reads at ${(t.px * GRID_SCALE).toFixed(1)}pt in the grid`);
    const floor = t.role === "body" ? FEED_MIN_BODY_PT : t.role === "label" ? FEED_MIN_LABEL_PT : 0;
    if (floor && t.px * FEED_SCALE < floor - 0.05) out.push(`${t.role} reads at ${(t.px * FEED_SCALE).toFixed(1)}pt in the feed`);
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ */
/*  Before publishing: will a deck's words fit the design?             */
/* ------------------------------------------------------------------ */

/**
 * Average advance of a character, as a share of the font size: Anton's
 * capitals and the heavy sans in sentence case. Measured on the bundled Anton
 * and on SF / Roboto Black; a conservative (wide) estimate, so a line that
 * passes here fits on every phone.
 */
export const CHAR_EM = { hookCaps: 0.5, title: 0.56, body: 0.5 } as const;

/** Lines `text` takes at `px` in a column `width` wide, word-wrapped by the average advance. */
export function estimateLines(text: string, px: number, width: number, em: number): number {
  const perLine = Math.max(1, Math.floor(width / (px * em)));
  let lines = 1;
  let used = 0;
  for (const word of text.replace(/\*/g, "").split(/\s+/).filter(Boolean)) {
    const len = word.length;
    if (used === 0) used = len;
    else if (used + 1 + len <= perLine) used += 1 + len;
    else {
      lines++;
      used = len;
    }
    while (used > perLine) {
      lines++;
      used -= perLine;
    }
  }
  return lines;
}

/** The biggest headline size (from the hook scale) at which `title` fits its lines, or null when it only fits under the grid's minimum. */
export function hookFit(title: string, width = CARD_W - PAD_X * 2): { px: number; lines: number } | null {
  for (let px: number = TYPE.hook.start; px >= TYPE.hook.min; px -= 2) {
    const lines = estimateLines(title.toUpperCase(), px, width, CHAR_EM.hookCaps);
    // the room under the kicker and over the brand: lines × leading must fit
    if (lines <= TYPE.hook.maxLines && lines * px * TYPE.hook.lh <= 1350 - HEAD - FOOT - 260) return { px, lines };
  }
  return null;
}

/** Headline problems that make a cover hard to read in the grid (the deck writer redrafts on these). */
export function designProblems(slides: readonly { type: string; title?: string; kicker?: string | null }[]): string[] {
  const out: string[] = [];
  const cover = slides[0];
  if (cover?.type === "cover" && cover.title) {
    const fit = hookFit(cover.title);
    if (!fit) out.push(`the cover headline is too long to read in the profile grid ("${cover.title.replace(/\*/g, "")}"): 7 words or fewer`);
    else if (fit.px < 128) out.push(`the cover headline only fits small (${fit.lines} lines): make it shorter`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Which surface a card gets                                          */
/* ------------------------------------------------------------------ */

/** FNV-1a, so the same post always gets the same look. */
export function seedHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
