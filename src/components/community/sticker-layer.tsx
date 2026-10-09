import { useEffect, useMemo, useRef, useState } from "react";
import { useNoAutoZoom } from "@/hooks/use-no-auto-zoom";
import { Check, TextAlignCenter, TextAlignEnd, TextAlignStart, Trash2 } from "lucide-react";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { cn } from "@/lib/utils";

/**
 * Text and stickers, Instagram-style, placed right on the share card: text
 * (4 styles, 5 colours) and stickers (LOCKED IN, the time, the date, JF
 * EFFECT, the workout, a couple of lines, emoji). Drag to move, pinch to
 * resize and rotate (second finger anywhere), drop on the bin to delete, tap
 * text to edit it.
 *
 * Items live in card space (fractions of the 1080×1920 story card), so the
 * preview, the Instagram story (drawn on top of the card) and the community
 * photo (baked into the photo through the card's crop) all match.
 */

const REF = 1080; // card width; item sizes are designed against it
const CARD_H = 1920;
/** Where new items land (fractions of the card): the upper half, clear of the card's own text. */
const SLOTS = [[0.5, 0.36], [0.5, 0.24], [0.5, 0.48], [0.32, 0.3], [0.68, 0.42], [0.5, 0.14]] as const;
// Bitmap density (bitmap px per card px). 2x by default; items are re-rendered
// denser when pinched bigger so they never go soft. Renderers are synchronous,
// so `atDensity` can set it around one render.
let PX = 2;
function atDensity<T>(px: number, fn: () => T): T {
  const prev = PX;
  PX = px;
  try {
    return fn();
  } finally {
    PX = prev;
  }
}
const DISPLAY = `"Anton", "Impact", "Arial Narrow Bold", sans-serif`;
const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif`;
const RED = "#ef3340";
export const TEXT_COLORS = ["#ffffff", "#000000", RED, "#facc15", "#22c55e"] as const;
export const TEXT_STYLES = ["Bold", "Box", "Display", "Outline", "Highlight"] as const;
/** The order the Aa button steps through (Highlight sits next to Box). */
const STYLE_CYCLE = [0, 1, 4, 2, 3];
export const nextTextStyle = (s: number) => STYLE_CYCLE[(STYLE_CYCLE.indexOf(s) + 1) % STYLE_CYCLE.length];
export type TextAlign = "center" | "left" | "right";
const ALIGN_CYCLE: TextAlign[] = ["center", "left", "right"];
export const nextTextAlign = (a: TextAlign) => ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(a) + 1) % ALIGN_CYCLE.length];
/** The size slider's range, × the style's base size (1 = default). */
export const TEXT_SIZE = { min: 0.5, max: 2.5 } as const;
const EMOJI = ["🔥", "💪", "🏋️", "⚡", "🎯", "😤", "🫡", "🏆"] as const;

export type DecorContext = { time: string; date: string; workoutTitle?: string | null };

export type StickerItem = {
  id: number;
  kind: "text" | "sticker";
  text?: string;
  style?: number;
  color?: string;
  /** Text size (× the style's base) and alignment. */
  size?: number;
  align?: TextAlign;
  sticker?: string;
  /** The rendered bitmap, drawn straight onto the card or photo. */
  canvas: HTMLCanvasElement;
  url: string;
  bw: number;
  bh: number;
  /** Bitmap px per card px (2 at rest, more once pinched bigger). */
  res: number;
  /** Re-render at another density (sharp at any size). */
  make: (px: number) => Bitmap;
  /** Centre, as fractions of the card. */
  x: number;
  y: number;
  s: number;
  r: number;
};
type Item = StickerItem;

type Bitmap = { url: string; bw: number; bh: number; canvas: HTMLCanvasElement; px: number };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A clear margin round every bitmap, so edges stay smooth when rotated. */
function finish(c: HTMLCanvasElement): Bitmap {
  const m = Math.ceil(3 * PX);
  const p = document.createElement("canvas");
  p.width = c.width + m * 2;
  p.height = c.height + m * 2;
  const ctx = p.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, m, m);
  return { canvas: p, url: p.toDataURL("image/png"), bw: p.width, bh: p.height, px: PX };
}

function readable(bg: string) {
  return bg === "#ffffff" || bg === "#facc15" || bg === "#22c55e" ? "#0a0a0a" : "#ffffff";
}

/** Longest text a text item takes (it wraps, so long notes are fine). */
export const TEXT_MAX = 400;
/** Text wraps at this width on the 1080px card, in the editor and on the card alike. */
const WRAP = 900;

/**
 * One set of metrics (card px) for each text style, used by both the canvas
 * bitmap and the live editor, so what you type is exactly what lands on the
 * card: same font, size, line height, padding and wrapping.
 */
export function textMetrics(style: number, scale = 1) {
  const display = style === 2;
  return {
    display,
    size: (display ? 104 : 68) * scale,
    lineH: display ? 1.0 : 1.18,
    // Highlight: padding round each line (it hugs every line on its own)
    padX: (style === 1 ? 34 : style === 4 ? 24 : 18) * scale,
    padY: (style === 1 ? 20 : style === 4 ? 8 : 14) * scale,
    radius: (style === 4 ? 20 : 26) * scale,
    stroke: 9 * scale,
    shadow: 14 * scale,
    drop: 3 * scale,
    family: display ? DISPLAY : SANS,
    weight: display ? 400 : 800,
  };
}

/** A rect with its own radius per corner (tl, tr, br, bl). */
function cornerRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) {
  ctx.moveTo(x + tl, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

/**
 * Instagram's "background" text: a box that hugs each line on its own.
 * Lines touch; where one sticks out past the next, it keeps round outer
 * corners and the shorter one gets a smooth inside curve. Edges within a
 * corner's width of each other line up, so they don't stair-step. Works per
 * side, so left / right aligned text gets a straight edge on that side.
 * A blank line is a clean gap: no box, and the lines either side of it
 * round off as if it were the end.
 * Pure geometry (x from 0 to the canvas width) so it's checked without a canvas.
 */
export function highlightShape(lineWidths: number[], o: { lineH: number; padX: number; padY: number; r: number; align?: TextAlign; width?: number }) {
  const { lineH, padX, padY, r } = o;
  const align = o.align ?? "center";
  const gap = lineWidths.map((w) => w < 0.5);
  const bw = lineWidths.map((w) => w + padX * 2);
  const W = o.width ?? Math.max(...bw);
  // a gap sits "inside" everything, so its neighbours see open space
  const L = bw.map((b, i) => (gap[i] ? Infinity : align === "left" ? 0 : align === "right" ? W - b : (W - b) / 2));
  const R = L.map((l, i) => (gap[i] ? -Infinity : l + bw[i]));
  const settle = (e: number[], out: (a: number, b: number) => number) => {
    for (let pass = 0; pass < e.length; pass++) {
      let changed = false;
      for (let i = 0; i < e.length - 1; i++)
        if (e[i] !== e[i + 1] && Math.abs(e[i] - e[i + 1]) < r * 2) {
          e[i] = e[i + 1] = out(e[i], e[i + 1]);
          changed = true;
        }
      if (!changed) break;
    }
  };
  settle(L, Math.min);
  settle(R, Math.max);
  const n = bw.length;
  const boxes = L.flatMap((left, i) => {
    if (gap[i]) return [];
    const right = R[i];
    const first = i === 0 || gap[i - 1];
    const last = i === n - 1 || gap[i + 1];
    // the ends of each run get the outer padding (into the gap, for a blank line)
    const top = padY + i * lineH - (first ? padY : 0);
    const bottom = padY + (i + 1) * lineH + (last ? padY : 0);
    const rr = Math.min(r, (bottom - top) / 2);
    // corners: top-left, top-right, bottom-right, bottom-left — round where nothing sits outside them
    const radii = [first || L[i - 1] > left ? rr : 0, first || R[i - 1] < right ? rr : 0, last || R[i + 1] < right ? rr : 0, last || L[i + 1] > left ? rr : 0];
    return [{ left, right, top, bottom, radii }];
  });
  // inside curves where a shorter edge meets a longer one, on the short line's side of the seam
  const fillets: { x: number; y: number; r: number; down: boolean; side: 1 | -1 }[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (gap[i] || gap[i + 1]) continue;
    const y = padY + (i + 1) * lineH;
    if (R[i] !== R[i + 1]) fillets.push({ x: Math.min(R[i], R[i + 1]), y, r: Math.min(r, Math.abs(R[i] - R[i + 1]) / 2, lineH / 2), down: R[i + 1] < R[i], side: 1 });
    if (L[i] !== L[i + 1]) fillets.push({ x: Math.max(L[i], L[i + 1]), y, r: Math.min(r, Math.abs(L[i] - L[i + 1]) / 2, lineH / 2), down: L[i + 1] > L[i], side: -1 });
  }
  return { boxes, fillets };
}

function drawHighlight(ctx: CanvasRenderingContext2D, lines: string[], o: { width: number; align: TextAlign; lineH: number; padX: number; padY: number; r: number; color: string }) {
  const { boxes, fillets } = highlightShape(lines.map((l) => ctx.measureText(l).width), o);
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.beginPath();
  for (const b of boxes) cornerRect(ctx, b.left, b.top, b.right - b.left, b.bottom - b.top, b.radii);
  ctx.fill();
  for (const f of fillets) {
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + f.side * f.r, f.y);
    ctx.arcTo(f.x, f.y, f.x, f.y + (f.down ? f.r : -f.r), f.r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Word-wrap like the browser does: on spaces, breaking words longer than a line. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width <= max) {
        line = tryLine;
        continue;
      }
      if (line) out.push(line);
      // a single word wider than the line: break it by characters
      let w = word;
      while (ctx.measureText(w).width > max && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && ctx.measureText(w.slice(0, n)).width > max) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Text in one of the styles, rendered to a bitmap (2x), wrapped like the editor. */
/** Biggest bitmap we draw (px): under iOS Safari's canvas limit, with room to spare. */
const MAX_AREA = 12_000_000;

export function renderText(text: string, style: number, color: string, opts: { size?: number; align?: TextAlign } = {}): Bitmap {
  const align = opts.align ?? "center";
  const m = textMetrics(style, opts.size ?? 1);
  const size = m.size * PX;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const f = `${m.weight} ${size}px ${m.family}`;
  ctx.font = f;
  const raw = (text.replace(/\s+$/g, "") || " ").slice(0, TEXT_MAX);
  const lines = wrapText(ctx, m.display ? raw.toUpperCase() : raw, WRAP * PX).slice(0, 40);
  const lineH = size * m.lineH;
  const padX = m.padX * PX;
  const padY = m.padY * PX;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2);
  const h = Math.ceil(lineH * lines.length + padY * 2);
  // big text drawn dense would blow past the canvas limit (and come out blank): draw it less dense
  if (w * h > MAX_AREA) return atDensity(PX * Math.sqrt(MAX_AREA / (w * h)) * 0.98, () => renderText(text, style, color, opts));
  c.width = Math.max(w, 2);
  c.height = Math.max(h, 2);
  ctx.font = f;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const tx = align === "left" ? padX : align === "right" ? c.width - padX : c.width / 2;
  if (style === 4) drawHighlight(ctx, lines, { width: c.width, align, lineH, padX, padY, r: m.radius * PX, color });
  if (style === 1) {
    ctx.fillStyle = color;
    roundRect(ctx, 0, 0, c.width, c.height, m.radius * PX);
    ctx.fill();
  }
  lines.forEach((l, i) => {
    const y = padY + lineH * (i + 0.5);
    if (style === 3) {
      ctx.lineJoin = "round";
      ctx.lineWidth = m.stroke * PX;
      ctx.strokeStyle = color === "#000000" ? "#ffffff" : "#000000";
      ctx.strokeText(l, tx, y);
      ctx.fillStyle = color;
      ctx.fillText(l, tx, y);
    } else if (style === 1 || style === 4) {
      ctx.fillStyle = readable(color);
      ctx.fillText(l, tx, y);
    } else {
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = m.shadow * PX;
      ctx.shadowOffsetY = m.drop * PX;
      ctx.fillStyle = color;
      ctx.fillText(l, tx, y);
      ctx.shadowColor = "transparent";
    }
  });
  return finish(c);
}

function pillSticker(text: string, opts: { bg: string; ink: string; display?: boolean; size?: number; icon?: (ctx: CanvasRenderingContext2D, x: number, cy: number, s: number) => number; logo?: HTMLImageElement | null; stroke?: string }) {
  const size = (opts.size ?? (opts.display ? 84 : 46)) * PX;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const f = opts.display ? `400 ${size}px ${DISPLAY}` : `900 ${size}px ${SANS}`;
  ctx.font = f;
  try {
    (ctx as any).letterSpacing = opts.display ? "0px" : `${3 * PX}px`;
  } catch {
    /* fine without tracking */
  }
  const tw = ctx.measureText(text).width;
  const iconW = opts.icon || opts.logo ? size * 1.15 : 0;
  const padX = size * 0.62;
  const h = Math.round(size * (opts.display ? 1.45 : 1.9));
  c.width = Math.ceil(tw + padX * 2 + iconW);
  c.height = h;
  ctx.font = f;
  try {
    (ctx as any).letterSpacing = opts.display ? "0px" : `${3 * PX}px`;
  } catch {
    /* fine */
  }
  if (opts.bg !== "transparent") {
    ctx.fillStyle = opts.bg;
    roundRect(ctx, 0, 0, c.width, h, h / 2);
    ctx.fill();
  }
  let x = padX;
  if (opts.logo) {
    const s = size * 0.95;
    ctx.save();
    roundRect(ctx, x, (h - s) / 2, s, s, s * 0.22);
    ctx.clip();
    ctx.drawImage(opts.logo, x, (h - s) / 2, s, s);
    ctx.restore();
    x += iconW;
  } else if (opts.icon) x += opts.icon(ctx, x, h / 2, size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (opts.stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = 8 * PX;
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, h / 2 + size * 0.04);
  }
  ctx.fillStyle = opts.ink;
  ctx.fillText(text, x, h / 2 + size * 0.04);
  return finish(c);
}

function clockIcon(ctx: CanvasRenderingContext2D, x: number, cy: number, s: number) {
  const r = s * 0.42;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.arc(x + r, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r, cy);
  ctx.lineTo(x + r, cy - r * 0.6);
  ctx.moveTo(x + r, cy);
  ctx.lineTo(x + r + r * 0.45, cy + r * 0.2);
  ctx.stroke();
  ctx.restore();
  return s * 1.15;
}

function emojiSticker(e: string): Bitmap {
  const size = 150 * PX;
  const c = document.createElement("canvas");
  c.width = Math.round(size * 1.25);
  c.height = Math.round(size * 1.25);
  const ctx = c.getContext("2d")!;
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(e, c.width / 2, c.height / 2 + size * 0.06);
  return finish(c);
}

export type StickerDef = { key: string; label: string; render: (logo: HTMLImageElement | null) => Bitmap };

/** Render at a density; returns the bitmap plus how to redo it at another one. */
function made(fn: () => Bitmap, px = 2) {
  const b = atDensity(px, fn);
  return { b, make: (d: number) => atDensity(d, fn) };
}

/** The density an item needs at scale `s`: sharp on this screen and in the export, within canvas limits. */
export function densityFor(s: number, k: number, dpr: number, baseW: number) {
  const want = Math.max(2, s * Math.max(1, k * dpr) * 1.15);
  const cap = Math.max(2, Math.min(8, 4096 / Math.max(1, baseW)));
  return Math.min(cap, Math.ceil(want * 2) / 2);
}

/** Snap rotation to straight (0 / 90 / 180 / 270°) when it's within ~3°. */
export function snapAngle(r: number, within = 0.055): { r: number; snapped: boolean } {
  const q = Math.PI / 2;
  const n = Math.round(r / q) * q;
  return Math.abs(r - n) < within ? { r: n, snapped: true } : { r, snapped: false };
}

/** The sticker tray, built from what's true right now. */
export function stickerDefs(ctx: DecorContext): StickerDef[] {
  const defs: StickerDef[] = [
    { key: "lockedin", label: "LOCKED IN", render: () => pillSticker("LOCKED IN", { bg: RED, ink: "#ffffff", display: true }) },
    { key: "time", label: ctx.time, render: () => pillSticker(ctx.time.toUpperCase(), { bg: "rgba(10,10,13,0.72)", ink: "#ffffff", icon: clockIcon }) },
    { key: "date", label: ctx.date, render: () => pillSticker(ctx.date.toUpperCase(), { bg: "#ffffff", ink: "#0a0a0a" }) },
    { key: "jf", label: "JF EFFECT", render: (logo) => pillSticker("JF EFFECT", { bg: "#0a0a0d", ink: "#ffffff", logo }) },
  ];
  if (ctx.workoutTitle) defs.push({ key: "workout", label: ctx.workoutTitle, render: () => pillSticker(ctx.workoutTitle!.toUpperCase().slice(0, 32), { bg: "rgba(255,255,255,0.92)", ink: "#0a0a0a" }) });
  defs.push(
    { key: "letsgo", label: "LET'S GO", render: () => pillSticker("LET'S GO", { bg: "transparent", ink: "#facc15", display: true, size: 120, stroke: "#0a0a0a" }) },
    { key: "nodaysoff", label: "NO DAYS OFF", render: () => pillSticker("NO DAYS OFF", { bg: "#ffffff", ink: RED, display: true, size: 70 }) },
    ...EMOJI.map((e) => ({ key: `emoji:${e}`, label: e, render: () => emojiSticker(e) })),
  );
  return defs;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draw the items on a card-sized context (W×H = the card). */
export function drawStickers(ctx: CanvasRenderingContext2D, items: StickerItem[], W = REF, H = CARD_H) {
  for (const it of items) {
    const w = (it.bw / it.res) * (W / REF) * it.s;
    const h = (it.bh / it.res) * (W / REF) * it.s;
    ctx.save();
    ctx.translate(it.x * W, it.y * H);
    ctx.rotate(it.r);
    ctx.drawImage(it.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

/**
 * Bake card-space items into the photo itself (for the community post), via
 * the same cover crop the card uses. Longest side capped at 2048px.
 */
export function bakeStickers(src: CanvasImageSource & { width?: number; height?: number }, items: StickerItem[]): Promise<Blob | null> {
  const any = src as unknown as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const nw = any.naturalWidth || any.width || 1;
  const nh = any.naturalHeight || any.height || 1;
  const k = Math.min(1, 2048 / Math.max(nw, nh));
  const W = Math.round(nw * k);
  const H = Math.round(nh * k);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, W, H);
  // card → photo: the card shows the photo cover-cropped to 1080×1920
  const s = Math.max(REF / W, CARD_H / H);
  const ox = (REF - W * s) / 2;
  const oy = (CARD_H - H * s) / 2;
  for (const it of items) {
    const w = ((it.bw / it.res) * it.s) / s;
    const h = ((it.bh / it.res) * it.s) / s;
    ctx.save();
    ctx.translate((it.x * REF - ox) / s, (it.y * CARD_H - oy) / s);
    ctx.rotate(it.r);
    ctx.drawImage(it.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", 0.9));
}

/**
 * Move items from one card format to another (story 1080×1920 → feed
 * 1080×1350) so each stays on the same spot of the photo and the same size
 * relative to it. Kept inside the card.
 */
export function remapStickers(
  items: StickerItem[],
  src: CanvasImageSource & { width?: number; height?: number },
  from: { w: number; h: number },
  to: { w: number; h: number },
): StickerItem[] {
  const any = src as unknown as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const nw = any.naturalWidth || any.width || 1;
  const nh = any.naturalHeight || any.height || 1;
  const sf = Math.max(from.w / nw, from.h / nh);
  const st = Math.max(to.w / nw, to.h / nh);
  const clamp = (v: number) => Math.min(0.96, Math.max(0.04, v));
  return items.map((it) => {
    const px = (it.x * from.w - (from.w - nw * sf) / 2) / sf;
    const py = (it.y * from.h - (from.h - nh * sf) / 2) / sf;
    return {
      ...it,
      x: clamp((px * st + (to.w - nw * st) / 2) / to.w),
      y: clamp((py * st + (to.h - nh * st) / 2) / to.h),
      s: it.s * (st / sf) * (from.w / to.w),
    };
  });
}

export type StickerRequest = { kind: "text" | "stickers"; n: number } | null;

type TextDraft = { id: number | null; text: string; style: number; color: string; size: number; align: TextAlign };

/**
 * The editable layer over the card. The parent sizes it to the card (absolute
 * inset-0 inside the card box) and opens the text editor / tray via `request`.
 */
export function StickerLayer({
  items,
  setItems,
  width,
  height,
  context,
  request,
}: {
  items: StickerItem[];
  setItems: React.Dispatch<React.SetStateAction<StickerItem[]>>;
  /** On-screen size of the card. */
  width: number;
  height: number;
  context: DecorContext;
  request: StickerRequest;
}) {
  const [tray, setTray] = useState(false);
  const [editing, setEditing] = useState<TextDraft | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  const stickers = useMemo(() => stickerDefs(context), [context]);

  useEffect(() => {
    void loadImage("/logo.png").then(setLogo);
  }, []);
  useEffect(() => {
    if (!request) return;
    if (request.kind === "text") setEditing({ id: null, text: "", style: 0, color: "#ffffff", size: 1, align: "center" });
    else setTray(true);
  }, [request]);

  const place = (cur: Item[]) => SLOTS[cur.length % SLOTS.length];
  const addSticker = (d: StickerDef) => {
    const { b, make } = made(() => d.render(logo));
    const id = nextId.current++;
    setItems((cur) => {
      const [x, y] = place(cur);
      return [...cur, { id, kind: "sticker", sticker: d.key, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh, res: b.px, make, x, y, s: d.key.startsWith("emoji:") ? 0.9 : 1, r: 0 }];
    });
    setTray(false);
  };

  const saveText = () => {
    if (!editing) return;
    const text = editing.text.replace(/\s+$/g, "");
    if (!text.trim()) {
      if (editing.id != null) setItems((cur) => cur.filter((i) => i.id !== editing.id));
      setEditing(null);
      return;
    }
    const { style, color, size, align } = editing;
    const old = editing.id != null ? items.find((i) => i.id === editing.id) : null;
    const { b, make } = made(() => renderText(text, style, color, { size, align }), old?.res ?? 2);
    if (old) {
      setItems((cur) => cur.map((i) => (i.id === old.id ? { ...i, text, style, color, size, align, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh, res: b.px, make } : i)));
    } else {
      const id = nextId.current++;
      setItems((cur) => {
        const [x, y] = place(cur);
        return [...cur, { id, kind: "text", text, style, color, size, align, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh, res: b.px, make, x, y, s: 1, r: 0 }];
      });
    }
    setEditing(null);
  };

  // ---- gestures: one finger drags, two pinch + rotate, drop on the bin deletes.
  // Snaps: the card's centre lines (with a guide) and straight angles.
  const g = useRef<{
    id: number;
    pointers: Map<number, { x: number; y: number }>;
    start: { x: number; y: number; s: number; r: number };
    p0: { x: number; y: number };
    pinch0?: { d: number; a: number };
    moved: boolean;
    t0: number;
  } | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean; angle: boolean }>({ v: false, h: false, angle: false });
  const snapRef = useRef({ v: false, h: false, angle: false });
  const buzz = () => {
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no haptics here */
    }
  };

  const trashHit = (clientX: number, clientY: number) => {
    const b = root.current?.getBoundingClientRect();
    if (!b) return false;
    return Math.hypot(clientX - (b.left + b.width / 2), clientY - (b.bottom - 52)) < 60;
  };

  const addPointer = (e: React.PointerEvent, id: number) => {
    const st = g.current!;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pointers.size === 2) {
      const [a, b] = [...st.pointers.values()];
      const cur = items.find((i) => i.id === id)!;
      st.start = { x: cur.x, y: cur.y, s: cur.s, r: cur.r };
      st.p0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      st.pinch0 = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) };
      st.moved = true;
    }
  };

  const onItemDown = (e: React.PointerEvent, it: Item) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!g.current || g.current.id !== it.id) {
      g.current = { id: it.id, pointers: new Map(), start: { x: it.x, y: it.y, s: it.s, r: it.r }, p0: { x: e.clientX, y: e.clientY }, moved: false, t0: Date.now() };
    }
    addPointer(e, it.id);
    setDragging(it.id);
  };

  // While an item is held, the layer takes the whole card, so a second finger
  // anywhere pinches it (and the card underneath doesn't swipe).
  const onRootDown = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || st.pointers.size !== 1) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    addPointer(e, st.id);
  };

  const SNAP_PX = 9;
  const onMove = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || !st.pointers.has(e.pointerId) || !width || !height) return;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...st.pointers.values()];
    let nx = st.start.x;
    let ny = st.start.y;
    let ns = st.start.s;
    let nr = st.start.r;
    if (pts.length >= 2 && st.pinch0) {
      const [a, b] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      nx += (mid.x - st.p0.x) / width;
      ny += (mid.y - st.p0.y) / height;
      ns = Math.min(8, Math.max(0.2, st.start.s * (Math.hypot(b.x - a.x, b.y - a.y) / st.pinch0.d)));
      nr = st.start.r + (Math.atan2(b.y - a.y, b.x - a.x) - st.pinch0.a);
    } else {
      nx += (pts[0].x - st.p0.x) / width;
      ny += (pts[0].y - st.p0.y) / height;
    }
    if (Math.hypot(pts[0].x - st.p0.x, pts[0].y - st.p0.y) > 6) st.moved = true;
    // centre lines: snap within a few px, show the guide
    const v = Math.abs(nx - 0.5) * width < SNAP_PX;
    const h = Math.abs(ny - 0.5) * height < SNAP_PX;
    if (v) nx = 0.5;
    if (h) ny = 0.5;
    const ang = pts.length >= 2 ? snapAngle(nr) : { r: nr, snapped: snapRef.current.angle };
    nr = ang.r;
    const next = { v, h, angle: ang.snapped };
    const was = snapRef.current;
    if ((next.v && !was.v) || (next.h && !was.h) || (next.angle && !was.angle)) buzz();
    if (next.v !== was.v || next.h !== was.h || next.angle !== was.angle) {
      snapRef.current = next;
      setGuides(next);
    }
    setOverTrash(pts.length === 1 && trashHit(pts[0].x, pts[0].y));
    setItems((cur) => cur.map((i) => (i.id === st.id ? { ...i, x: nx, y: ny, s: ns, r: nr } : i)));
  };

  // After a pinch, redraw the item at the density its new size needs (sharp, not stretched).
  const sharpen = (id: number) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2;
    const need = densityFor(it.s, width / REF, dpr, it.bw / it.res);
    if (need <= it.res * 1.1) return;
    const b = it.make(need);
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, canvas: b.canvas, url: b.url, bw: b.bw, bh: b.bh, res: b.px } : i)));
  };

  const onUp = (e: React.PointerEvent) => {
    const st = g.current;
    if (!st || !st.pointers.has(e.pointerId)) return;
    e.stopPropagation();
    st.pointers.delete(e.pointerId);
    if (st.pointers.size === 1) {
      const [p] = [...st.pointers.values()];
      const cur = items.find((i) => i.id === st.id);
      if (cur) {
        st.start = { x: cur.x, y: cur.y, s: cur.s, r: cur.r };
        st.p0 = { x: p.x, y: p.y };
        st.pinch0 = undefined;
      }
      return;
    }
    if (st.pointers.size === 0) {
      const it = items.find((i) => i.id === st.id);
      if (trashHit(e.clientX, e.clientY)) setItems((cur) => cur.filter((i) => i.id !== st.id));
      else if (!st.moved && Date.now() - st.t0 < 300 && it?.kind === "text") setEditing({ id: it.id, text: it.text ?? "", style: it.style ?? 0, color: it.color ?? "#ffffff", size: it.size ?? 1, align: it.align ?? "center" });
      else sharpen(st.id);
      g.current = null;
      setDragging(null);
      setOverTrash(false);
      snapRef.current = { v: false, h: false, angle: false };
      setGuides(snapRef.current);
    }
  };

  const k = width / REF;
  // Highlight's carved boxes can't be done in CSS, so the editor shows the
  // card's own render of it (at screen density) under a see-through textarea.
  const hlText = editing?.style === 4 ? editing.text || "Type something" : null;
  const hlColor = editing?.color;
  const hlSize = editing?.size ?? 1;
  const hlAlign = editing?.align ?? "center";
  const highlight = useMemo(() => {
    if (hlText == null || !hlColor || typeof document === "undefined") return null;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return atDensity(Math.min(4, Math.max(1, Math.ceil(k * dpr * 2) / 2)), () => renderText(hlText, 4, hlColor, { size: hlSize, align: hlAlign }));
  }, [hlText, hlColor, hlSize, hlAlign, k]);
  // iOS doesn't shrink the screen for the keyboard (it slides the page up
  // instead), so the editor pins itself to the part you can see: the top
  // bar stays put and the colours sit right on the keyboard.
  const view = useVisualViewportBox(!!editing);
  // Small text sizes put the textarea under 16px: keep iOS from zooming the page in.
  useNoAutoZoom(!!editing);

  return (
    <>
      <div
        ref={root}
        className={cn("absolute inset-0 touch-none", dragging == null && "pointer-events-none")}
        onPointerDown={onRootDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* Centre guides while you move something; bright when it's snapped */}
        {dragging != null && (
          <>
            <div className={cn("pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-opacity", guides.v ? "bg-[#ffd400] opacity-100" : "bg-white opacity-25")} />
            <div className={cn("pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-opacity", guides.h ? "bg-[#ffd400] opacity-100" : "bg-white opacity-25")} />
          </>
        )}
        {items.map((it) => (
          <img
            key={it.id}
            src={it.url}
            alt={it.text ?? it.sticker ?? ""}
            draggable={false}
            onPointerDown={(e) => onItemDown(e, it)}
            className={cn("pointer-events-auto absolute left-0 top-0 max-w-none origin-center cursor-grab touch-none select-none [backface-visibility:hidden]", dragging === it.id && overTrash && "opacity-50")}
            // Position, size and angle all on the GPU (smooth); the bitmap is
            // redrawn denser after a pinch so it stays sharp.
            style={{
              width: (it.bw / it.res) * k,
              transform: `translate3d(${it.x * width}px, ${it.y * height}px, 0) translate(-50%, -50%) rotate(${it.r}rad) scale(${it.s})`,
              willChange: dragging === it.id ? "transform" : undefined,
            }}
          />
        ))}
        {dragging != null && guides.angle && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-[#ffd400] px-2 py-0.5 text-[11px] font-black text-black">Straight</div>
        )}
        {dragging != null && (
          <div className={cn("pointer-events-none absolute bottom-6 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full border-2 transition-all", overTrash ? "scale-125 border-red-500 bg-red-500 text-white" : "border-white/70 bg-black/50 text-white")}>
            <Trash2 className="h-6 w-6" />
          </div>
        )}
      </div>

      {/* Text editor — over the visible screen (fixed inside the dialog) */}
      {editing && (
        <div
          className="fixed inset-x-0 z-[70] flex flex-col bg-black/70 text-white backdrop-blur-sm"
          style={{ top: view?.keyboard ? view.top : 0, height: view?.keyboard ? view.height : "100%", paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
        >
          <div className="flex items-center justify-between gap-2 px-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                // keep the keyboard up: don't take focus from the text
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEditing({ ...editing, style: nextTextStyle(editing.style) })}
                className="h-10 rounded-full bg-white/15 px-4 text-[13px] font-black"
                aria-label="Text style"
              >
                Aa · {TEXT_STYLES[editing.style]}
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEditing({ ...editing, align: nextTextAlign(editing.align) })}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/15"
                aria-label={`Align ${editing.align}`}
              >
                {editing.align === "left" ? <TextAlignStart className="h-5 w-5" /> : editing.align === "right" ? <TextAlignEnd className="h-5 w-5" /> : <TextAlignCenter className="h-5 w-5" />}
              </button>
            </div>
            <button type="button" onClick={saveText} className="inline-flex h-10 items-center gap-1 rounded-full bg-white px-4 text-[14px] font-black text-black">
              <Check className="h-4 w-4" /> Done
            </button>
          </div>
          {/* True size: the card's scale, font, padding and wrap width, so it looks
              exactly like it will on the card while you type. */}
          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-3 py-4">
              {(() => {
                const m = textMetrics(editing.style, editing.size);
                const font = { fontFamily: m.family, fontWeight: m.weight, fontSize: m.size * k, lineHeight: m.lineH, textAlign: editing.align, textTransform: m.display ? ("uppercase" as const) : undefined };
                if (editing.style === 4) {
                  return (
                    <div className="relative inline-grid shrink-0" style={{ maxWidth: (WRAP + m.padX * 2) * k, padding: `${m.padY * k}px ${m.padX * k}px` }}>
                      {highlight && (
                        <img
                          src={highlight.url}
                          alt=""
                          draggable={false}
                          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
                          style={{ width: (highlight.bw / highlight.px) * k, opacity: editing.text ? 1 : 0.55 }}
                        />
                      )}
                      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre-wrap [overflow-wrap:anywhere]" style={font}>
                        {(editing.text || "Type something") + " "}
                      </span>
                      <textarea
                        autoFocus
                        value={editing.text}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, TEXT_MAX) })}
                        maxLength={TEXT_MAX}
                        rows={1}
                        cols={1}
                        aria-label="Text"
                        // the letters you see are the render under it; this only carries the caret
                        style={{ ...font, color: "transparent", caretColor: readable(editing.color) }}
                        className="relative col-start-1 row-start-1 h-full min-h-0 w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent p-0 outline-none [overflow-wrap:anywhere]"
                      />
                    </div>
                  );
                }
                const look =
                  editing.style === 1
                    ? { background: editing.color, color: readable(editing.color), borderRadius: m.radius * k }
                    : editing.style === 3
                      ? { color: editing.color, WebkitTextStroke: `${m.stroke * k}px ${editing.color === "#000000" ? "#fff" : "#000"}`, paintOrder: "stroke fill" as const }
                      : { color: editing.color, textShadow: `0 ${m.drop * k}px ${m.shadow * k}px rgba(0,0,0,0.45)` };
                return (
                  <div className="inline-grid shrink-0" style={{ ...look, maxWidth: (WRAP + m.padX * 2) * k, padding: `${m.padY * k}px ${m.padX * k}px` }}>
                    <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre-wrap [overflow-wrap:anywhere]" style={font}>
                      {(editing.text || "Type something") + " "}
                    </span>
                    <textarea
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, TEXT_MAX) })}
                      maxLength={TEXT_MAX}
                      rows={1}
                      cols={1}
                      placeholder="Type something"
                      aria-label="Text"
                      // inline font beats the global 16px input rule (iOS zoom guard)
                      style={{ ...font, color: "inherit" }}
                      className="col-start-1 row-start-1 h-full min-h-0 w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent p-0 outline-none [overflow-wrap:anywhere] placeholder:text-current placeholder:opacity-40"
                    />
                  </div>
                );
              })()}
            </div>
            <SizeSlider value={editing.size} onChange={(size) => setEditing((cur) => (cur ? { ...cur, size } : cur))} />
          </div>
          {editing.text.length > TEXT_MAX - 60 && <div className="pb-2 text-center text-[11px] tabular-nums text-white/55">{editing.text.length}/{TEXT_MAX}</div>}
          <div
            className="flex justify-center gap-3 pt-1"
            style={{ paddingBottom: view?.keyboard ? "0.625rem" : "max(env(safe-area-inset-bottom), 1.5rem)" }}
            role="group"
            aria-label="Text colour"
          >
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEditing({ ...editing, color: c })}
                className={cn("h-9 w-9 rounded-full border-2", editing.color === c ? "scale-110 border-white" : "border-white/40")}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sticker tray */}
      {tray && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/50 text-white" onClick={() => setTray(false)}>
          <div className="max-h-[62%] overflow-y-auto rounded-t-[24px] bg-[#16161a] p-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <div className="grid grid-cols-2 gap-2.5">
              {stickers
                .filter((s) => !s.key.startsWith("emoji:"))
                .map((s) => (
                  <StickerButton key={s.key} def={s} logo={logo} onPick={() => addSticker(s)} />
                ))}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2.5">
              {stickers
                .filter((s) => s.key.startsWith("emoji:"))
                .map((s) => (
                  <button key={s.key} type="button" onClick={() => addSticker(s)} className="grid h-16 place-items-center rounded-2xl bg-white/[0.06] text-[34px] active:scale-95" aria-label={`Sticker ${s.label}`}>
                    {s.label}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Instagram's text size slider: a tapered track down the left edge, drag the
 * dot up for bigger text. The text re-wraps as it grows (the wrap width is
 * fixed), exactly as it will on the card. Taps don't take focus, so the
 * keyboard stays up.
 */
function SizeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const track = useRef<HTMLDivElement | null>(null);
  const t = (value - TEXT_SIZE.min) / (TEXT_SIZE.max - TEXT_SIZE.min);
  const set = (clientY: number) => {
    const b = track.current?.getBoundingClientRect();
    if (!b || !b.height) return;
    const f = 1 - Math.min(1, Math.max(0, (clientY - b.top) / b.height));
    onChange(Math.round((TEXT_SIZE.min + f * (TEXT_SIZE.max - TEXT_SIZE.min)) * 100) / 100);
  };
  return (
    <div
      role="slider"
      aria-label="Text size"
      aria-orientation="vertical"
      aria-valuemin={TEXT_SIZE.min}
      aria-valuemax={TEXT_SIZE.max}
      aria-valuenow={value}
      className="absolute left-0 top-1/2 z-10 flex h-[min(15rem,70%)] w-11 -translate-y-1/2 touch-none justify-center py-3"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        set(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) set(e.clientY);
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={track} className="relative h-full w-4">
        <div className="absolute inset-0 bg-white/45" style={{ clipPath: "polygon(0 0, 100% 0, 64% 100%, 36% 100%)", borderRadius: 3 }} />
        <div className="absolute left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,0.55)]" style={{ top: `${(1 - t) * 100}%` }} />
      </div>
    </div>
  );
}

function StickerButton({ def, logo, onPick }: { def: StickerDef; logo: HTMLImageElement | null; onPick: () => void }) {
  const url = useMemo(() => def.render(logo).url, [def, logo]);
  return (
    <button type="button" onClick={onPick} className="grid h-20 place-items-center rounded-2xl bg-white/[0.06] px-3 active:scale-95" aria-label={`Sticker ${def.label}`}>
      <img src={url} alt="" className="max-h-12 max-w-full object-contain" />
    </button>
  );
}
