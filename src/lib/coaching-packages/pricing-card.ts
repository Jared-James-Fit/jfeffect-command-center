/**
 * The coaching pricing cards (admin → Sales → Coaching packages → Share
 * cards), painted on a canvas from the packages themselves, so a card always
 * says what the site says. The preview is the very canvas that's exported
 * (PNG, PDF), at Instagram's sizes: a post (4:5), a square, a story (9:16).
 *
 * The brand's look: clean paper, dark ink, the brand red for the one thing
 * that matters (the recommended package, the checks), big type that reads on
 * a phone at a third of its size. A draft is stamped DRAFT across it and
 * can't be shared from the toolkit (pricing nobody approved never leaves).
 */
import {
  TAX_NOTE,
  callsLine,
  intervalLabel,
  priceLabel,
  type PublicPackage,
} from "./packages";

export type CardFormat = "post" | "square" | "story";
export type CardLayout = "single" | "compare";

export const CARD_SIZES: Record<CardFormat, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: "Post 4:5" },
  square: { w: 1080, h: 1080, label: "Square" },
  story: { w: 1080, h: 1920, label: "Story 9:16" },
};

export const PAPER = "#f6f3ee";
export const INK = "#141417";
export const ACCENT = "#e42f3d";
const SUB = "rgba(20,20,23,0.62)";
const LINE = "rgba(20,20,23,0.14)";
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Inter, Arial, sans-serif';

function font(weight: number, size: number): string {
  return `${weight} ${Math.round(size)}px ${FONT}`;
}

/** Greedy word wrap; at most `max` lines, the last ending in "…" if cut. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= width || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === max) break;
    }
  }
  if (lines.length < max && cur) lines.push(cur);
  const used = lines.join(" ").split(/\s+/).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1]!;
    while (last && ctx.measureText(`${last}…`).width > width) last = last.replace(/\s*\S+$/, "");
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function check(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.14);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.52);
  ctx.lineTo(x + size * 0.38, y + size * 0.86);
  ctx.lineTo(x + size, y + size * 0.12);
  ctx.stroke();
  ctx.restore();
}

let logoPromise: Promise<HTMLImageElement | null> | null = null;
/** The JF Effect mark (null when it can't load: the card still paints). */
export function loadLogo(src = "/logo.png"): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  if (!logoPromise) {
    logoPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  return logoPromise;
}

export type PaintInput = {
  format: CardFormat;
  layout: CardLayout;
  packages: PublicPackage[];
  /** Any package here that isn't live: stamped DRAFT. */
  draft?: boolean;
  logo?: HTMLImageElement | null;
  /** The line at the foot ("jfeffect.com/coaching"). */
  site?: string;
};

/** A package's features plus its calls line, as the card lists them. */
export function cardFeatures(p: PublicPackage): string[] {
  const calls = callsLine(p);
  const out = [...p.features];
  if (calls && !out.some((f) => /call/i.test(f))) out.push(calls);
  return out;
}

/**
 * Paints the card onto `canvas` (sized here). Pure drawing: the same input
 * always paints the same picture.
 */
export function paintPricingCard(canvas: HTMLCanvasElement, input: PaintInput): void {
  const { w, h } = CARD_SIZES[input.format];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const pad = 88;
  const safeTop = input.format === "story" ? 220 : pad;
  const safeBottom = input.format === "story" ? 260 : pad;
  const packages = input.packages.slice(0, input.layout === "single" ? 1 : 4);

  // The brand row
  let y = safeTop;
  const logoSize = 72;
  if (input.logo) {
    ctx.drawImage(input.logo, pad, y, logoSize, logoSize);
  }
  ctx.fillStyle = INK;
  ctx.font = font(700, 34);
  ctx.fillText("JF Effect Coaching", pad + (input.logo ? logoSize + 22 : 0), y + logoSize / 2 + 12);
  y += logoSize + 48;

  const footH = 120;
  const bottom = h - safeBottom - footH;

  if (input.layout === "single" && packages[0]) {
    paintSingle(ctx, packages[0], { x: pad, y, w: w - pad * 2, bottom, format: input.format });
  } else {
    paintCompare(ctx, packages, { x: pad, y, w: w - pad * 2, bottom, format: input.format });
  }

  // The foot: where to apply, and the tax line once for every price on the card
  const fy = h - safeBottom - footH + 36;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, fy - 30);
  ctx.lineTo(w - pad, fy - 30);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = font(700, 36);
  ctx.fillText(`Apply at ${input.site ?? "jfeffect.com/coaching"}`, pad, fy + 20);
  ctx.fillStyle = SUB;
  ctx.font = font(500, 26);
  ctx.fillText(`Prices in ${TAX_NOTE}. Applying is free.`, pad, fy + 62);

  if (input.draft) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 9);
    ctx.font = font(800, 220);
    ctx.fillStyle = "rgba(228,47,61,0.16)";
    ctx.textAlign = "center";
    ctx.fillText("DRAFT", 0, 70);
    ctx.restore();
  }
}

type Box = { x: number; y: number; w: number; bottom: number; format: CardFormat };

function paintSingle(ctx: CanvasRenderingContext2D, p: PublicPackage, box: Box) {
  // Try big, step down until it fits the room above the foot.
  for (let s = 1; s >= 0.55; s -= 0.05) {
    if (layoutSingle(ctx, p, box, s, false) <= box.bottom) {
      layoutSingle(ctx, p, box, s, true);
      return;
    }
  }
  layoutSingle(ctx, p, box, 0.55, true);
}

/** Lays the one package out at scale `s`; draws only when `draw`. Returns the bottom it reaches. */
function layoutSingle(ctx: CanvasRenderingContext2D, p: PublicPackage, box: Box, s: number, draw: boolean): number {
  const { x, w } = box;
  let y = box.y;
  if (p.recommended) {
    ctx.font = font(700, 28 * s);
    const label = "Recommended";
    const tw = ctx.measureText(label).width;
    if (draw) {
      ctx.fillStyle = ACCENT;
      roundRect(ctx, x, y, tw + 40 * s, 52 * s, 26 * s);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 20 * s, y + 36 * s);
    }
    y += 52 * s + 28 * s;
  }
  ctx.font = font(800, 76 * s);
  for (const line of wrap(ctx, p.name, w, 2)) {
    y += 76 * s;
    if (draw) {
      ctx.fillStyle = INK;
      ctx.fillText(line, x, y);
    }
    y += 8 * s;
  }
  if (p.tagline) {
    ctx.font = font(500, 36 * s);
    y += 12 * s;
    for (const line of wrap(ctx, p.tagline, w, 2)) {
      y += 40 * s;
      if (draw) {
        ctx.fillStyle = SUB;
        ctx.fillText(line, x, y);
      }
      y += 6 * s;
    }
  }
  // The price
  y += 56 * s;
  const price = p.kind === "free" ? "$0" : p.priceCents ? priceLabel(p.priceCents) : "No price";
  ctx.font = font(800, 168 * s);
  const pw = ctx.measureText(price).width;
  y += 140 * s;
  if (draw) {
    ctx.fillStyle = INK;
    ctx.fillText(price, x, y);
    ctx.font = font(600, 48 * s);
    ctx.fillStyle = SUB;
    ctx.fillText(intervalLabel(p), x + pw + 12 * s, y);
  }
  y += 48 * s;
  // What's included
  const feats = cardFeatures(p);
  const fs = 36 * s;
  const ck = 30 * s;
  ctx.font = font(500, fs);
  for (const f of feats) {
    const lines = wrap(ctx, f, w - ck - 26 * s, 2);
    y += 20 * s;
    if (draw) check(ctx, x, y + 4 * s, ck, ACCENT);
    for (const line of lines) {
      y += fs * 1.05;
      if (draw) {
        ctx.fillStyle = INK;
        ctx.fillText(line, x + ck + 26 * s, y);
      }
      y += fs * 0.22;
    }
  }
  return y;
}

function paintCompare(ctx: CanvasRenderingContext2D, ps: PublicPackage[], box: Box) {
  for (let s = 1; s >= 0.5; s -= 0.05) {
    if (layoutCompare(ctx, ps, box, s, false) <= box.bottom) {
      layoutCompare(ctx, ps, box, s, true);
      return;
    }
  }
  layoutCompare(ctx, ps, box, 0.5, true);
}

function layoutCompare(ctx: CanvasRenderingContext2D, ps: PublicPackage[], box: Box, s: number, draw: boolean): number {
  const { x, w } = box;
  let y = box.y;
  ctx.font = font(800, 64 * s);
  y += 64 * s;
  if (draw) {
    ctx.fillStyle = INK;
    ctx.fillText("Coaching packages", x, y);
  }
  y += 40 * s;
  const maxFeatures = box.format === "story" ? 4 : ps.length > 2 ? 2 : 3;
  for (const p of ps) {
    const featured = p.recommended && p.kind !== "free";
    const inner = 40 * s;
    const top = y;
    const feats = cardFeatures(p).slice(0, maxFeatures);
    // measure the block
    let by = top + inner;
    ctx.font = font(800, 46 * s);
    by += 46 * s;
    if (featured) by += 40 * s;
    ctx.font = font(500, 30 * s);
    const featLines = feats.map((f) => wrap(ctx, f, w - inner * 2 - 36 * s, 2));
    for (const lines of featLines) by += 14 * s + lines.length * 30 * s * 1.25;
    by += inner;
    const height = by - top;
    if (draw) {
      ctx.fillStyle = featured ? INK : "#ffffff";
      roundRect(ctx, x, top, w, height, 32 * s);
      ctx.fill();
      if (!featured) {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const fg = featured ? PAPER : INK;
      const sub = featured ? "rgba(246,243,238,0.7)" : SUB;
      let ty = top + inner + 46 * s;
      // price on the right
      const price = p.kind === "free" ? "$0" : p.priceCents ? priceLabel(p.priceCents) : "No price";
      ctx.font = font(800, 56 * s);
      const pw = ctx.measureText(price).width;
      ctx.font = font(600, 26 * s);
      const iw = ctx.measureText(intervalLabel(p)).width;
      const priceX = x + w - inner - pw - iw - 6 * s;
      ctx.font = font(800, 46 * s);
      const nameW = priceX - (x + inner) - 24 * s;
      const name = wrap(ctx, p.name, nameW, 1)[0] ?? p.name;
      ctx.fillStyle = fg;
      ctx.fillText(name, x + inner, ty);
      ctx.font = font(800, 56 * s);
      ctx.fillText(price, priceX, ty + 6 * s);
      ctx.font = font(600, 26 * s);
      ctx.fillStyle = sub;
      ctx.fillText(intervalLabel(p), priceX + pw + 6 * s, ty + 6 * s);
      if (featured) {
        ty += 10 * s;
        ctx.font = font(700, 22 * s);
        ctx.fillStyle = ACCENT;
        ctx.fillText("RECOMMENDED", x + inner, ty + 30 * s);
        ty += 30 * s;
      }
      ctx.font = font(500, 30 * s);
      for (const lines of featLines) {
        ty += 14 * s;
        check(ctx, x + inner, ty + 6 * s, 22 * s, featured ? PAPER : ACCENT);
        for (const line of lines) {
          ty += 30 * s * 1.05;
          ctx.fillStyle = fg;
          ctx.fillText(line, x + inner + 36 * s, ty);
          ty += 30 * s * 0.2;
        }
      }
    }
    y = top + height + 24 * s;
  }
  return y;
}

/** The painted card as a PNG file (what's shared or saved). */
export function canvasPng(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(new File([b], name, { type: "image/png" })) : reject(new Error("Couldn't make the image."))),
      "image/png",
    );
  });
}

/** The same card as a one-page PDF (the page is the card's own shape). */
export async function canvasPdf(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const { jsPDF } = await import("jspdf");
  const pw = canvas.width * 0.5;
  const ph = canvas.height * 0.5;
  const doc = new jsPDF({ unit: "pt", format: [pw, ph], orientation: pw > ph ? "landscape" : "portrait", compress: true });
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pw, ph);
  const blob = doc.output("blob");
  return new File([blob], name, { type: "application/pdf" });
}

/** "jf-effect-complete-online-coaching-post.png" */
export function cardFileName(packages: PublicPackage[], layout: CardLayout, format: CardFormat, ext: "png" | "pdf"): string {
  const base = layout === "compare" ? "coaching-packages" : (packages[0]?.slug ?? "coaching");
  return `jf-effect-${base}-${format}.${ext}`;
}
