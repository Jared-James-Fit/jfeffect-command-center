// Result cards painted on canvas: sports-poster type (Anton), flat colour,
// the JF mark, the athlete's verified score and rank, and a QR code back to
// the challenge. Story 9:16, portrait 4:5 and square 1:1, in four looks.
// A photo only ever sits under a scrim; nothing else uses a gradient.
import QRCode from "qrcode";
import type { CardInput } from "./share";
import { initials } from "./share";

export type CardFormat = "story" | "portrait" | "square";
export type CardStyle = "championship" | "spotlight" | "paper" | "red";

export const CARD_SIZES: Record<CardFormat, [number, number]> = {
  story: [1080, 1920],
  portrait: [1080, 1350],
  square: [1080, 1080],
};

export const CARD_FORMATS: { value: CardFormat; label: string; hint: string }[] = [
  { value: "story", label: "Story", hint: "9:16" },
  { value: "portrait", label: "Post", hint: "4:5" },
  { value: "square", label: "Square", hint: "1:1" },
];

export const CARD_STYLES: { value: CardStyle; label: string }[] = [
  { value: "championship", label: "Championship" },
  { value: "spotlight", label: "Spotlight" },
  { value: "paper", label: "Clean" },
  { value: "red", label: "Bold" },
];

interface Palette {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  chip: string;
  chipInk: string;
  qrDark: string;
  qrLight: string;
  line: string;
}

const RED = "#e0262f";
const GOLD = "#f5b301";

function palette(style: CardStyle, gold: boolean): Palette {
  switch (style) {
    case "paper":
      return { bg: "#f4f1ea", ink: "#121212", muted: "rgba(18,18,18,0.58)", accent: gold ? "#b7791f" : "#c81e28", chip: "#121212", chipInk: "#ffffff", qrDark: "#121212", qrLight: "#f4f1ea", line: "rgba(18,18,18,0.14)" };
    case "red":
      return { bg: "#c8141f", ink: "#ffffff", muted: "rgba(255,255,255,0.78)", accent: gold ? GOLD : "#111111", chip: "#111111", chipInk: "#ffffff", qrDark: "#111111", qrLight: "#ffffff", line: "rgba(255,255,255,0.28)" };
    default:
      return { bg: "#0e0e10", ink: "#ffffff", muted: "rgba(255,255,255,0.6)", accent: gold ? GOLD : RED, chip: gold ? GOLD : RED, chipInk: gold ? "#111111" : "#ffffff", qrDark: "#0a0a0a", qrLight: "#ffffff", line: "rgba(255,255,255,0.14)" };
  }
}

const DISPLAY = `"Anton", "Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif`;
const BODY = `Inter, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

let fontReady: Promise<void> | null = null;
function ensureFont(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    try {
      if (typeof document === "undefined" || !document.fonts) return;
      await document.fonts.load(`400 100px "Anton"`);
      if (document.fonts.check(`400 100px "Anton"`)) return;
      const face = new FontFace("Anton", "url(/fonts/anton-latin-400.woff2)", { weight: "400", style: "normal" });
      await face.load();
      document.fonts.add(face);
    } catch {
      /* a system condensed face is fine */
    }
  })();
  return fontReady;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const hit = imageCache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, family = DISPLAY, weight = 400) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
}
function spacing(ctx: Ctx, px: number) {
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  } catch {
    /* older browsers: no tracking */
  }
}
/** Largest size ≤ start where `text` fits `width`. */
function fit(ctx: Ctx, text: string, width: number, start: number, min: number, family = DISPLAY, weight = 400): number {
  let s = start;
  font(ctx, s, family, weight);
  while (s > min && ctx.measureText(text).width > width) {
    s -= 2;
    font(ctx, s, family, weight);
  }
  return s;
}
/** Break `text` into at most `maxLines` lines at `size`, shrinking until it fits. */
function wrap(ctx: Ctx, text: string, width: number, start: number, min: number, maxLines: number): { lines: string[]; size: number } {
  const words = text.split(/\s+/).filter(Boolean);
  for (let s = start; s >= min; s -= 4) {
    font(ctx, s);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= width || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= width)) return { lines, size: s };
  }
  font(ctx, min);
  return { lines: [text], size: min };
}
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawCover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * s;
  const ih = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

async function qrImage(url: string, p: Palette): Promise<HTMLImageElement | null> {
  try {
    const data = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: p.qrDark, light: p.qrLight } });
    return await loadImage(data);
  } catch {
    return null;
  }
}

interface Block {
  h: number;
  /** Lower drops first when space runs out (undefined = never). */
  drop?: number;
  draw: (y: number) => void;
}

/** Paint a card. Never throws for a missing photo or QR; it just leaves them out. */
export async function paintChallengeCard(input: CardInput, format: CardFormat, style: CardStyle): Promise<HTMLCanvasElement> {
  await ensureFont();
  const [W, H] = CARD_SIZES[format];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const [logo, photo] = await Promise.all([loadImage("/icon-1024.png"), loadImage(input.photoUrl)]);
  const spot = style === "spotlight" && !!photo;
  const p = palette(spot ? "championship" : style === "spotlight" ? "championship" : style, !!input.gold);
  const qr = await qrImage(input.qrUrl, spot ? palette("championship", false) : p);
  const PAD = format === "square" ? 64 : 80;
  const inner = W - PAD * 2;
  const k = format === "story" ? 1 : format === "portrait" ? 0.82 : 0.7;

  // ── background ──
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  if (spot && photo) {
    drawCover(ctx, photo, 0, 0, W, H);
    // scrims under the type (the only gradients on a card)
    let g = ctx.createLinearGradient(0, 0, 0, H * 0.22);
    g.addColorStop(0, "rgba(0,0,0,0.62)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.22);
    g = ctx.createLinearGradient(0, H * 0.3, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.45, "rgba(0,0,0,0.72)");
    g.addColorStop(1, "rgba(0,0,0,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.3, W, H * 0.7);
  }

  ctx.textBaseline = "alphabetic";

  // ── header: JF mark + name, badge on the right ──
  const headH = Math.round(84 * k + 8);
  const headY = PAD;
  const logoS = Math.round(84 * k);
  if (logo) {
    ctx.save();
    roundRect(ctx, PAD, headY, logoS, logoS, logoS * 0.22);
    ctx.clip();
    ctx.drawImage(logo, PAD, headY, logoS, logoS);
    ctx.restore();
  }
  font(ctx, 46 * k);
  spacing(ctx, 1);
  ctx.fillStyle = p.ink;
  ctx.textAlign = "left";
  ctx.fillText("JF EFFECT", PAD + logoS + 20, headY + logoS / 2 + 17 * k);
  spacing(ctx, 0);
  // badge
  font(ctx, 26 * k, BODY, 800);
  spacing(ctx, 2);
  const bt = input.badge.text;
  const btw = ctx.measureText(bt).width;
  const dot = input.badge.live ? 22 * k : 0;
  const bw = btw + 44 * k + dot;
  const bh = 52 * k;
  const bx = W - PAD - bw;
  const by = headY + (logoS - bh) / 2;
  ctx.fillStyle = input.badge.live ? RED : p.chip;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  if (input.badge.live) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(bx + 22 * k + 6, by + bh / 2, 7 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = input.badge.live ? "#ffffff" : p.chipInk;
  ctx.fillText(bt, bx + 22 * k + dot, by + bh / 2 + 9 * k);
  spacing(ctx, 0);

  // ── footer: QR + where to find it ──
  const qrS = Math.round((format === "square" ? 170 : 210) * (format === "story" ? 1.05 : 1));
  const footH = qrS;
  const footY = H - PAD - footH;
  if (qr) {
    ctx.fillStyle = spot ? "#ffffff" : p.qrLight;
    roundRect(ctx, PAD, footY, qrS, qrS, 18);
    ctx.fill();
    ctx.drawImage(qr, PAD + 10, footY + 10, qrS - 20, qrS - 20);
  }
  const fx = PAD + (qr ? qrS + 32 : 0);
  ctx.textAlign = "left";
  ctx.fillStyle = p.ink;
  const scanLine = input.kind === "result" ? "SCAN TO TAKE ME ON" : "SCAN TO ENTER";
  font(ctx, 44 * k);
  spacing(ctx, 1);
  ctx.fillText(scanLine, fx, footY + qrS / 2 - 6);
  spacing(ctx, 0);
  const urlSize = fit(ctx, input.displayUrl, W - PAD - fx, 30 * k, 18, BODY, 600);
  font(ctx, urlSize, BODY, 600);
  ctx.fillStyle = p.muted;
  ctx.fillText(input.displayUrl, fx, footY + qrS / 2 + 40 * k);
  if (input.sponsor) {
    font(ctx, 24 * k, BODY, 600);
    ctx.fillText(`Presented with ${input.sponsor}`, fx, footY + qrS / 2 + 80 * k);
  }

  // ── the middle: a stack of blocks, centred, fitted to the room left ──
  const top = headY + headH + 40 * k;
  const bottom = footY - 40 * k;
  const room = bottom - top;
  const cx = W / 2;
  ctx.textAlign = "center";

  const blocks: Block[] = [];
  const title = input.title.toUpperCase();
  const t = wrap(ctx, title, inner, 132 * k, 56 * k, format === "square" ? 2 : 3);
  const titleLine = t.size * 1.02;
  blocks.push({
    h: t.lines.length * titleLine,
    draw: (y) => {
      font(ctx, t.size);
      ctx.fillStyle = p.ink;
      t.lines.forEach((l, i) => ctx.fillText(l, cx, y + titleLine * (i + 1) - t.size * 0.12));
    },
  });
  if (input.detail) {
    const ds = fit(ctx, input.detail, inner, 34 * k, 20, BODY, 700);
    blocks.push({
      h: ds * 1.5,
      drop: 3,
      draw: (y) => {
        font(ctx, ds, BODY, 700);
        spacing(ctx, 3);
        ctx.fillStyle = spot ? "rgba(255,255,255,0.78)" : p.muted;
        ctx.fillText(input.detail, cx, y + ds * 1.1);
        spacing(ctx, 0);
      },
    });
  }

  // avatar (not on spotlight: the photo is the card)
  if (input.name && !spot && input.kind !== "event") {
    const d = Math.round((format === "story" ? 300 : format === "portrait" ? 200 : 150));
    blocks.push({
      h: d,
      drop: 1,
      draw: (y) => {
        const r = d / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, y + r, r, 0, Math.PI * 2);
        ctx.closePath();
        if (photo) {
          ctx.clip();
          drawCover(ctx, photo, cx - r, y, d, d);
        } else {
          ctx.fillStyle = style === "paper" ? "#e4dfd3" : style === "red" ? "#a80f19" : "#1d1d21";
          ctx.fill();
          font(ctx, d * 0.42);
          ctx.fillStyle = p.ink;
          ctx.fillText(initials(input.name ?? ""), cx, y + r + d * 0.15);
        }
        ctx.restore();
        ctx.lineWidth = 8;
        ctx.strokeStyle = p.accent;
        ctx.beginPath();
        ctx.arc(cx, y + r, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      },
    });
  }

  if (input.name && input.kind !== "event") {
    const ns = fit(ctx, input.name.toUpperCase(), inner, 104 * k, 44 * k);
    blocks.push({
      h: ns * 1.05,
      draw: (y) => {
        font(ctx, ns);
        spacing(ctx, 1);
        ctx.fillStyle = p.ink;
        ctx.fillText(input.name!.toUpperCase(), cx, y + ns * 0.95);
        spacing(ctx, 0);
      },
    });
  }

  if (input.kind === "result" && input.score) {
    const sv = input.score.value;
    const vs = fit(ctx, sv, inner * 0.9, (format === "story" ? 380 : format === "portrait" ? 300 : 230), 120);
    const us = Math.round(vs * 0.24);
    blocks.push({
      h: vs * 0.98 + (input.score.unit ? us * 1.2 : 0),
      draw: (y) => {
        font(ctx, vs);
        ctx.fillStyle = p.ink;
        ctx.fillText(sv, cx, y + vs * 0.93);
        if (input.score!.unit) {
          font(ctx, us);
          spacing(ctx, 6);
          ctx.fillStyle = p.accent;
          ctx.fillText(input.score!.unit.toUpperCase(), cx, y + vs * 0.98 + us * 1.05);
          spacing(ctx, 0);
        }
      },
    });
  }

  if (input.kind === "result" && input.rank) {
    const rs = format === "story" ? 120 : format === "portrait" ? 96 : 78;
    const sub = [input.rank.of ? `OF ${input.rank.of}` : null, input.rank.division ? input.rank.division.toUpperCase() : null].filter(Boolean).join(" · ");
    blocks.push({
      h: rs * 1.08,
      draw: (y) => {
        // "#2" then "OF 47" set side by side, centred as a pair
        font(ctx, rs);
        const a = ctx.measureText(input.rank!.label).width;
        font(ctx, rs * 0.36, BODY, 800);
        spacing(ctx, 2);
        const b = sub ? ctx.measureText(sub).width + 24 : 0;
        spacing(ctx, 0);
        const start = cx - (a + b) / 2;
        ctx.textAlign = "left";
        font(ctx, rs);
        ctx.fillStyle = p.accent;
        ctx.fillText(input.rank!.label, start, y + rs * 0.95);
        if (sub) {
          font(ctx, rs * 0.36, BODY, 800);
          spacing(ctx, 2);
          ctx.fillStyle = spot ? "rgba(255,255,255,0.85)" : p.muted;
          ctx.fillText(sub, start + a + 24, y + rs * 0.95);
          spacing(ctx, 0);
        }
        ctx.textAlign = "center";
      },
    });
  }

  if ((input.kind === "event" || input.kind === "entered") && input.facts?.length) {
    const fs = format === "story" ? 64 : format === "portrait" ? 54 : 44;
    blocks.push({
      h: fs * 1.25 * input.facts.length + 10,
      draw: (y) => {
        input.facts!.forEach((f, i) => {
          font(ctx, fit(ctx, f, inner, fs, 30));
          ctx.fillStyle = i === input.facts!.length - 1 ? p.accent : p.ink;
          ctx.fillText(f, cx, y + fs * 1.25 * (i + 1) - fs * 0.2);
        });
      },
    });
  }

  if (input.headline) {
    const hs = fit(ctx, input.headline, inner, (format === "story" ? 112 : format === "portrait" ? 92 : 74), 40);
    blocks.push({
      h: hs * 1.15,
      draw: (y) => {
        font(ctx, hs);
        spacing(ctx, 1);
        ctx.fillStyle = input.kind === "result" ? p.accent : p.ink;
        if (style === "red" && input.kind === "result") ctx.fillStyle = "#ffffff";
        ctx.fillText(input.headline, cx, y + hs);
        spacing(ctx, 0);
      },
    });
  }

  // drop optional blocks until they fit, then spread the room
  let active = blocks.slice();
  const total = () => active.reduce((s, b) => s + b.h, 0);
  const minGap = 18 * k;
  while (total() + minGap * (active.length - 1) > room) {
    const droppable = active.filter((b) => b.drop != null).sort((a, b) => (a.drop ?? 0) - (b.drop ?? 0));
    if (!droppable.length) break;
    active = active.filter((b) => b !== droppable[0]);
  }
  const free = Math.max(0, room - total());
  const gap = Math.min(free / Math.max(1, active.length + (spot ? 0 : 1)), 90 * k);
  // spotlight sits the stack low over the photo; the others centre it
  let y = spot ? bottom - total() - gap * (active.length - 1) : top + (room - total() - gap * (active.length - 1)) / 2;
  for (const b of active) {
    b.draw(y);
    y += b.h + gap;
  }

  return canvas;
}

export function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: "image/png" })) : reject(new Error("Couldn't make the image"))),
      "image/png",
    );
  });
}

export function cardFileName(slug: string, who: string | null | undefined, format: CardFormat): string {
  return `${slug}${who ? `-${who}` : ""}-${format}.png`;
}
