/**
 * The canvas side of the automated posts' design system (post-design.ts):
 * the type, blocks and marks every painted card is made of, so a deck slide,
 * a lesson, Wins and the Recap read as one family. Each run of words it
 * draws is noted in the card's PaintReport (its size after any shrinking,
 * its colours), which the harness and the admin preview check with
 * reportProblems before a design ships.
 */
import { font, roundRect } from "@/lib/workout-story-card";
import { brandRow, display, setSpacing } from "@/lib/workout-share-card";
import { emphasisRuns } from "@/lib/post-decks";
import { SURFACES, TYPE, type DrawnText, type PaintReport, type Surface, type SurfaceName, type TextRole } from "@/lib/post-design";

export type Ctx = CanvasRenderingContext2D;
export type Picture = CanvasImageSource & { width: number; height: number };
export type CardLayout = { W: number; H: number; top: number; bottom: number };

export { SURFACES, TYPE };
export type { Surface, SurfaceName };

/* ------------------------------------------------------------------ */
/*  The report                                                         */
/* ------------------------------------------------------------------ */

let current: PaintReport | null = null;
/** Words drawn inside a block that's still being fitted: scaled once the block's size is known (place). */
let pending: DrawnText[] | null = null;
let last: PaintReport | null = null;

export function beginReport(card: string, slide: number) {
  current = { card, slide, texts: [], scale: 1, clipped: false };
  pending = null;
}

/** The report of the card just painted (null before any). */
export function lastPaintReport(): PaintReport | null {
  return last;
}

export function endReport(): PaintReport | null {
  last = current;
  current = null;
  pending = null;
  return last;
}

function note(role: TextRole, px: number, fg: string, bg: string) {
  const t = { role, px, fg, bg };
  if (pending) pending.push(t);
  else current?.texts.push(t);
}

/* ------------------------------------------------------------------ */
/*  Type                                                               */
/* ------------------------------------------------------------------ */

export type FontFn = (size: number) => string;
export const sans = (weight: number): FontFn => (size) => font(weight, size);
/** The grid line and the big numbers: Anton. */
export const hookFace: FontFn = (size) => display(size);

/** A word and its run (accented or not); `glue`: no space before it ("again" + "."). */
type Token = { text: string; accent: boolean; glue?: boolean };
export type Line = Token[];

const piece = (t: Token, i: number) => (i && !t.glue ? ` ${t.text}` : t.text);

function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let endsWithSpace = true;
  for (const r of emphasisRuns(text)) {
    const glued = tokens.length > 0 && !endsWithSpace && !/^\s/.test(r.text);
    endsWithSpace = /\s$/.test(r.text);
    const words = r.text.split(/\s+/).filter(Boolean);
    // a short accented phrase ("1 g/lb", "two left") stays on one line
    if (r.accent && words.length > 1 && words.join(" ").length <= 16) tokens.push({ text: words.join(" "), accent: true, glue: glued });
    else words.forEach((w, i) => tokens.push({ text: w, accent: r.accent, glue: i === 0 && glued }));
  }
  return tokens;
}

function lineWidth(c: Ctx, line: Line, f: FontFn, size: number): number {
  c.font = f(size);
  return line.reduce((w, t, i) => w + c.measureText(piece(t, i)).width, 0);
}

export function wrapRuns(c: Ctx, text: string, maxWidth: number, f: FontFn, size: number): Line[] {
  const tokens = tokensOf(text);
  const lines: Line[] = [];
  let cur: Line = [];
  for (const t of tokens) {
    const next = [...cur, t];
    if (!cur.length || t.glue || lineWidth(c, next, f, size) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = [t];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** The biggest size (start → min) at which the text wraps into `maxLines` with no word too wide; at min it takes what it needs. */
export function fitRuns(c: Ctx, text: string, maxWidth: number, f: FontFn, start: number, min: number, maxLines: number): { lines: Line[]; size: number } {
  for (let size = start; size >= min; size -= 2) {
    const lines = wrapRuns(c, text, maxWidth, f, size);
    const widest = Math.max(...lines.map((l) => lineWidth(c, l, f, size)));
    if (lines.length <= maxLines && widest <= maxWidth) return { lines, size };
  }
  return { lines: wrapRuns(c, text, maxWidth, f, min), size: min };
}

/** Draws wrapped runs from `top` (their top edge); returns the bottom edge. Noted in the report under `role`. */
export function drawRuns(c: Ctx, lines: Line[], x: number, top: number, size: number, lh: number, f: FontFn, color: string, accent: string, role: TextRole, bg: string, tracking = 0): number {
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  setSpacing(c, tracking * size);
  c.font = f(size);
  let y = top;
  let accented = false;
  for (const line of lines) {
    let cx = x;
    // a capital face sits on the line with no descender room: its baseline is lower in the line box
    const base = y + size * (f === hookFace ? 0.92 : 0.86);
    line.forEach((t, i) => {
      const p = piece(t, i);
      c.fillStyle = t.accent ? accent : color;
      if (t.accent) accented = true;
      c.fillText(p, cx, base);
      cx += c.measureText(p).width;
    });
    y += size * lh;
  }
  setSpacing(c, 0);
  note(role, size, color, bg);
  if (accented) note(role, size, accent, bg);
  return y;
}

/** Fit and draw in one go. */
export function text(c: Ctx, words: string, x: number, top: number, width: number, opts: { f: FontFn; start: number; min: number; lines: number; lh: number; color: string; accent: string; role: TextRole; bg: string; caps?: boolean; tracking?: number }): number {
  const t = fitRuns(c, opts.caps ? words.toUpperCase() : words, width, opts.f, opts.start, opts.min, opts.lines);
  return drawRuns(c, t.lines, x, top, t.size, opts.lh, opts.f, opts.color, opts.accent, opts.role, opts.bg, opts.tracking ?? 0);
}

/** Small tracked capitals (a kicker), optionally with the accent bar before it. Returns its bottom. */
export function kicker(c: Ctx, words: string, x: number, top: number, s: Surface, opts: { color?: string; size?: number; bar?: boolean; align?: "left" | "right"; maxWidth?: number } = {}): number {
  const size = opts.size ?? TYPE.kicker;
  c.save();
  c.font = font(800, size);
  setSpacing(c, size * 0.16);
  c.textAlign = opts.align ?? "left";
  c.textBaseline = "alphabetic";
  let tx = x;
  if (opts.bar && opts.align !== "right") {
    c.fillStyle = s.accent;
    c.fillRect(x, top + size * 0.28, 40, size * 0.32);
    tx += 58;
  }
  // on the red surface the accent is black, which small type can't carry: the kicker is the ink there
  const color = opts.color ?? (s.name === "red" ? s.ink : s.accent);
  c.fillStyle = color;
  let t = words.toUpperCase();
  if (opts.maxWidth) while (t.length > 4 && c.measureText(t).width > opts.maxWidth - (tx - x)) t = `${t.slice(0, -2).trimEnd()}…`;
  c.fillText(t, tx, top + size * 0.82);
  setSpacing(c, 0);
  c.restore();
  note("label", size, color, s.bg);
  return top + size;
}

/* ------------------------------------------------------------------ */
/*  Blocks                                                             */
/* ------------------------------------------------------------------ */

const SHRINK = [1, 0.93, 0.86, 0.8, 0.74];

/**
 * A block drawn at a fixed width and any height, set into its room. Too
 * tall: drawn again a step smaller (the words re-wrap to the wider room at a
 * smaller size, never a squashed picture), down to 74%; past that, scaled to
 * fit and reported as clipped. Placed at the top, the bottom or the optical
 * middle. Returns the size it was drawn at (1 = as designed).
 */
export function place(ctx: Ctx, draw: (c: Ctx, w: number) => number, x: number, top: number, width: number, maxH: number, valign: "top" | "middle" | "bottom" = "middle"): number {
  const off = document.createElement("canvas");
  off.width = width;
  off.height = 3600;
  const c = off.getContext("2d");
  if (!c) return 1;
  let k = 1;
  let h = 0;
  let drawn: DrawnText[] = [];
  for (const step of SHRINK) {
    k = step;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, off.width, off.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    const outer = pending;
    pending = [];
    h = Math.max(1, Math.ceil(draw(c, width / k) * k));
    drawn = pending;
    pending = outer;
    if (h <= maxH) break;
  }
  const s = Math.min(1, maxH / h);
  const y = valign === "middle" ? top + (maxH - h * s) * 0.44 : valign === "bottom" ? top + maxH - h * s : top;
  ctx.drawImage(off, 0, 0, width, h, x, y, width * s, h * s);
  off.width = 0;
  off.height = 0;
  const scale = k * s;
  for (const t of drawn) note(t.role, t.px * scale, t.fg, t.bg);
  if (current) {
    current.scale = Math.min(current.scale, scale);
    if (s < 0.97) current.clipped = true;
  }
  return scale;
}

/** A card's background: the surface, flat. */
export function surfaceFill(ctx: Ctx, s: Surface, W: number, H: number) {
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, W, H);
}

/** The brand row at the foot, in the surface's ink. */
export function brand(ctx: Ctx, logo: HTMLImageElement | null, x: number, y: number, W: number, s: Surface, label: string | null = null) {
  brandRow(ctx, logo, x, y, W, label, 0.85, s.ink);
}

/** A thick accent rule (under a headline). Returns its bottom. */
export function rule(c: Ctx, x: number, y: number, s: Surface, w = 96, h = 14): number {
  c.fillStyle = s.accent;
  c.fillRect(x, y, w, h);
  return y + h;
}

export function hairline(c: Ctx, x: number, y: number, w: number, s: Surface): number {
  c.fillStyle = s.line;
  c.fillRect(x, y, w, 2);
  return y + 2;
}

/** A tick, a cross or a number in a circle: a list's marker. */
export function marker(c: Ctx, kind: "check" | "cross" | "number", n: number, x: number, y: number, d: number, s: Surface, filled: boolean) {
  c.save();
  c.beginPath();
  c.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  if (filled) {
    c.fillStyle = s.accent;
    c.fill();
  } else {
    c.strokeStyle = s.accent;
    c.lineWidth = 5;
    c.stroke();
  }
  const ink = filled ? s.onAccent : s.accent;
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.lineWidth = d * 0.12;
  if (kind === "check") {
    c.beginPath();
    c.moveTo(x + d * 0.29, y + d * 0.53);
    c.lineTo(x + d * 0.44, y + d * 0.67);
    c.lineTo(x + d * 0.72, y + d * 0.36);
    c.stroke();
  } else if (kind === "cross") {
    c.beginPath();
    c.moveTo(x + d * 0.34, y + d * 0.34);
    c.lineTo(x + d * 0.66, y + d * 0.66);
    c.moveTo(x + d * 0.66, y + d * 0.34);
    c.lineTo(x + d * 0.34, y + d * 0.66);
    c.stroke();
  } else {
    c.font = display(d * 0.58);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(n), x + d / 2, y + d / 2 + d * 0.03);
  }
  c.restore();
}

/** The cover's "Swipe" and its arrow, under the headline (a carousel only). Returns its bottom. */
export function swipeCue(c: Ctx, x: number, top: number, s: Surface): number {
  const size = 32;
  c.save();
  c.font = font(800, size);
  setSpacing(c, size * 0.16);
  c.fillStyle = s.ink;
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  c.fillText("SWIPE", x, top + size * 0.82);
  const w = c.measureText("SWIPE").width;
  setSpacing(c, 0);
  const y = top + size * 0.5;
  const x0 = x + w + 18;
  c.strokeStyle = s.accent;
  c.lineWidth = 5;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(x0, y);
  c.lineTo(x0 + 60, y);
  c.moveTo(x0 + 42, y - 16);
  c.lineTo(x0 + 60, y);
  c.lineTo(x0 + 42, y + 16);
  c.stroke();
  c.restore();
  note("label", size, s.ink, s.bg);
  return top + size;
}

/** A big number in the display face, as wide as `w` allows (start → min). Returns its bottom. */
export function heroNumber(c: Ctx, value: string, x: number, top: number, w: number, s: Surface, opts: { start?: number; min?: number; color?: string; align?: "left" | "right" } = {}): { bottom: number; size: number; width: number } {
  let size = opts.start ?? TYPE.hero.start;
  const min = opts.min ?? TYPE.hero.min;
  c.font = display(size);
  while (size > min && c.measureText(value).width > w) c.font = display((size -= 6));
  const color = opts.color ?? s.accent;
  c.fillStyle = color;
  c.textAlign = opts.align ?? "left";
  c.textBaseline = "alphabetic";
  const width = c.measureText(value).width;
  c.fillText(value, opts.align === "right" ? x + w : x - size * 0.02, top + size * 0.9);
  c.textAlign = "left";
  note("hero", size, color, s.bg);
  return { bottom: top + size * 0.9, size, width };
}

/** A pill: words on a filled shape. Returns its right edge. */
export function pill(c: Ctx, words: string, x: number, y: number, fill: string, ink: string, bg: string, size = 30): number {
  c.font = font(800, size);
  const w = c.measureText(words).width + size * 1.4;
  const h = size * 1.75;
  c.fillStyle = fill;
  roundRect(c, x, y, w, h, h / 2);
  c.fill();
  c.fillStyle = ink;
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.fillText(words, x + size * 0.7, y + h / 2 + 1);
  c.textBaseline = "alphabetic";
  note("label", size, ink, fill.startsWith("#") ? fill : bg);
  return x + w;
}

/** Vertical bars (a week by day, weeks by count): the one that matters in the accent, its number over it. */
export function columns(c: Ctx, w: number, top: number, height: number, data: { share: number; hot: boolean; value?: string; label: string }[], s: Surface): number {
  const gap = data.length > 7 ? 14 : 22;
  const bw = (w - gap * (data.length - 1)) / data.length;
  const labelH = 58;
  const valueH = 64;
  const room = height - labelH - valueH;
  data.forEach((b, i) => {
    const x = i * (bw + gap);
    const h = Math.max(10, Math.round(b.share * room));
    const y = top + valueH + room - h;
    c.fillStyle = b.hot ? s.accent : s.bar;
    roundRect(c, x, y, bw, h, Math.min(10, bw / 4));
    c.fill();
    if (b.value != null) {
      c.font = display(48);
      c.fillStyle = b.hot ? s.accent : s.sub;
      c.textAlign = "center";
      c.fillText(b.value, x + bw / 2, y - 14);
    }
    c.font = font(800, 30);
    c.fillStyle = b.hot ? s.ink : s.sub;
    c.textAlign = "center";
    c.fillText(b.label, x + bw / 2, top + height - 12);
  });
  c.textAlign = "left";
  note("label", 30, s.sub, s.bg);
  return top + height;
}

/** A horizontal bar with what it is and its number: two of them read as a comparison at a glance. */
export function hbar(c: Ctx, w: number, top: number, label: string, value: string, share: number, lead: boolean, s: Surface, sub?: string): number {
  c.font = font(800, 44);
  c.fillStyle = lead ? s.ink : s.sub;
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  c.fillText(label, 0, top + 40);
  note("body", 44, lead ? s.ink : s.sub, s.bg);
  c.font = display(76);
  c.textAlign = "right";
  c.fillStyle = lead ? s.accent : s.sub;
  c.fillText(value, w, top + 62);
  note("title", 76, lead ? s.accent : s.sub, s.bg);
  c.textAlign = "left";
  let y = top + 84;
  if (sub) {
    c.font = font(600, 38);
    c.fillStyle = s.sub;
    c.fillText(sub, 0, y + 14);
    note("body", 38, s.sub, s.bg);
    y += 30;
  }
  y += 18;
  c.fillStyle = s.panel;
  roundRect(c, 0, y, w, 36, 18);
  c.fill();
  c.fillStyle = lead ? s.accent : s.bar;
  roundRect(c, 0, y, Math.max(36, w * Math.min(1, Math.max(0, share))), 36, 18);
  c.fill();
  return y + 36;
}
