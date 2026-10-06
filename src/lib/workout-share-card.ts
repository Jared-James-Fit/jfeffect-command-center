/**
 * Share cards for a finished workout — the image an athlete posts outside the
 * app. Canvas only (no DOM, no network except the small brand mark).
 *
 *   MEDIA card  – the athlete's photo (or video frame) is the card. The
 *                 accomplishment sits in a quiet lower block over a gradient.
 *   DATA card   – no photo: a typography-only recap. Needs no media to look
 *                 good; a PR session gets a bolder "NEW PR" treatment.
 *
 * Hierarchy (on purpose): photo / performance → accomplishment → caption →
 * brand. The brand is a small footer line, never a banner.
 *
 * Two formats share one layout: "feed" 1080×1350 (4:5, Instagram's tallest
 * feed ratio) and "story" 1080×1920 (9:16, content kept inside the Story safe
 * zone so the header / reply bar never cover it).
 *
 * Always rendered dark: the image has to read the same wherever it's posted.
 */
import { ellipsize, fitFont, font, loadImage, roundRect } from "@/lib/workout-story-card";
import type { CardStat } from "@/lib/community";

export type ShareFormat = "feed" | "story";

export const SHARE_SIZES: Record<ShareFormat, { w: number; h: number; safeTop: number; safeBottom: number }> = {
  feed: { w: 1080, h: 1350, safeTop: 72, safeBottom: 72 },
  story: { w: 1080, h: 1920, safeTop: 250, safeBottom: 270 },
};

export type ShareCardMedia = CanvasImageSource & { width?: number; height?: number };

export type ShareCardData = {
  format: ShareFormat;
  /** First name only — the athlete should feel like it's theirs. */
  athleteName: string | null;
  workoutTitle: string;
  dateLabel: string | null;
  /** Featured lift, pre-formatted: `detail` = "220 kg × 3". `prLabel` set → PR treatment. */
  lift: { name: string; detail: string; prLabel: string | null } | null;
  stats: CardStat[];
  isPr: boolean;
  caption: string | null;
  media: ShareCardMedia | null;
};

const INK = "#ffffff";
const MUTED = "rgba(255,255,255,0.62)";
const RED = "#ef3340";
const GOLD_FROM = "#fde68a";
const GOLD_TO = "#f59e0b";

type Ctx = CanvasRenderingContext2D;

function setSpacing(ctx: Ctx, px: number) {
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  } catch {
    /* unsupported → no tracking, still fine */
  }
}

/** Greedy word wrap. Ellipsizes the last line if it overflows `maxLines`. */
export function wrapLines(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").split(" ").length;
    if (consumed < words.length) lines[maxLines - 1] = ellipsize(ctx, `${lines[maxLines - 1]} ${words.slice(consumed).join(" ")}`, maxWidth);
    else lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxWidth);
  }
  return lines;
}

function intrinsic(src: ShareCardMedia): { w: number; h: number } {
  const any = src as unknown as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  return {
    w: any.naturalWidth || any.videoWidth || any.width || 1,
    h: any.naturalHeight || any.videoHeight || any.height || 1,
  };
}

function drawCover(ctx: Ctx, src: ShareCardMedia, W: number, H: number) {
  const { w, h } = intrinsic(src);
  const s = Math.max(W / w, H / h);
  const dw = w * s;
  const dh = h * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function goldGradient(ctx: Ctx, x: number, w: number) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, GOLD_FROM);
  g.addColorStop(1, GOLD_TO);
  return g;
}

function drawBrandFooter(ctx: Ctx, logo: HTMLImageElement | null, x: number, y: number, align: "left" | "right", W: number, dateLabel: string | null) {
  // y = baseline. Subtle: small mark + wordmark, low contrast.
  const size = 34;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, 24);
  setSpacing(ctx, 4);
  const word = "JF EFFECT";
  const wordW = ctx.measureText(word).width;
  const total = (logo ? size + 14 : 0) + wordW;
  let bx = align === "left" ? x : x - total;
  if (logo) {
    ctx.globalAlpha = 0.85;
    ctx.save();
    roundRect(ctx, bx, y - size + 6, size, size, 9);
    ctx.clip();
    ctx.drawImage(logo, bx, y - size + 6, size, size);
    ctx.restore();
    bx += size + 14;
  }
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText(word, bx, y);
  setSpacing(ctx, 0);
  if (dateLabel) {
    ctx.globalAlpha = 0.5;
    ctx.font = font(700, 24);
    ctx.textAlign = align === "left" ? "right" : "left";
    ctx.fillText(dateLabel, align === "left" ? W - x : x, y);
  }
  ctx.restore();
}

function drawStatsRow(ctx: Ctx, stats: CardStat[], x: number, yTop: number, width: number, big: number): number {
  if (!stats.length) return 0;
  const colW = width / stats.length;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  stats.forEach((s, i) => {
    const cx = x + i * colW;
    if (i > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(cx - 24, yTop + 6, 2, big + 36);
    }
    ctx.fillStyle = INK;
    fitFont(ctx, s.value, colW - 56, 800, big, 40);
    ctx.fillText(s.value, cx, yTop + big);
    ctx.fillStyle = MUTED;
    ctx.font = font(700, 24);
    setSpacing(ctx, 3);
    ctx.fillText(s.label.toUpperCase(), cx, yTop + big + 38);
    setSpacing(ctx, 0);
  });
  return big + 38;
}

function prPill(ctx: Ctx, text: string, x: number, y: number): number {
  ctx.save();
  ctx.font = font(900, 26);
  setSpacing(ctx, 4);
  const w = ctx.measureText(text).width + 52;
  ctx.fillStyle = goldGradient(ctx, x, w);
  roundRect(ctx, x, y, w, 52, 26);
  ctx.fill();
  ctx.fillStyle = "#2b1700";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 26, y + 28);
  setSpacing(ctx, 0);
  ctx.restore();
  return w;
}

export async function drawWorkoutShareCard(canvas: HTMLCanvasElement, d: ShareCardData): Promise<void> {
  const { w: W, h: H, safeTop, safeBottom } = SHARE_SIZES[d.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const logo = await loadImage("/logo.png");
  const PAD = 72;
  const innerW = W - PAD * 2;
  const footerY = H - safeBottom;
  ctx.textBaseline = "alphabetic";

  if (d.media) {
    drawMediaCard(ctx, d, logo, { W, H, PAD, innerW, footerY, safeTop });
  } else {
    drawDataCard(ctx, d, logo, { W, H, PAD, innerW, footerY, safeTop });
  }
}

type Layout = { W: number; H: number; PAD: number; innerW: number; footerY: number; safeTop: number };

/* ------------------------------------------------------------------ */
/*  MEDIA card                                                         */
/* ------------------------------------------------------------------ */
function drawMediaCard(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, H, PAD, innerW, footerY } = L;
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, d.media!, W, H);

  // Bottom scrim sized to the content, plus a whisper at the top for the PR pill.
  const hasCaption = !!d.caption;
  const blockH = 330 + (d.lift ? 120 : 0) + (d.stats.length ? 150 : 0) + (hasCaption ? 120 : 0);
  const scrimTop = Math.max(H * 0.28, H - blockH - 220);
  const g = ctx.createLinearGradient(0, scrimTop, 0, H);
  g.addColorStop(0, "rgba(7,7,10,0)");
  g.addColorStop(0.45, "rgba(7,7,10,0.62)");
  g.addColorStop(1, "rgba(7,7,10,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, scrimTop, W, H - scrimTop);
  const tg = ctx.createLinearGradient(0, 0, 0, 260);
  tg.addColorStop(0, "rgba(7,7,10,0.45)");
  tg.addColorStop(1, "rgba(7,7,10,0)");
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, 260);

  if (d.isPr) prPill(ctx, d.lift?.prLabel ? `NEW ${d.lift.prLabel}` : "NEW PR", PAD, L.safeTop);

  // Build the text block bottom-up so it hugs the footer regardless of content.
  let y = footerY - 70;
  ctx.textAlign = "left";

  if (hasCaption) {
    ctx.font = font(500, 36);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const lines = wrapLines(ctx, d.caption!, innerW, 2);
    y -= (lines.length - 1) * 46;
    lines.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * 46));
    y -= 36 + 46;
    // keep clear air between caption and the stats above
  }

  if (d.stats.length) {
    const h = 56 + 38;
    drawStatsRow(ctx, d.stats, PAD, y - h, innerW, 56);
    y -= h + 44;
  }

  if (d.lift) {
    // name left, set right-aligned on the same line when it fits, else stacked
    ctx.font = font(800, 40);
    const nameW = ctx.measureText(d.lift.name).width;
    ctx.font = font(800, 52);
    const detailW = ctx.measureText(d.lift.detail).width;
    if (nameW + detailW + 40 <= innerW) {
      ctx.font = font(700, 40);
      ctx.fillStyle = MUTED;
      ctx.fillText(d.lift.name, PAD, y);
      ctx.font = font(800, 52);
      ctx.fillStyle = d.isPr ? GOLD_TO : INK;
      ctx.textAlign = "right";
      ctx.fillText(d.lift.detail, W - PAD, y + 4);
      ctx.textAlign = "left";
      y -= 78;
    } else {
      ctx.fillStyle = INK;
      ctx.font = font(800, 52);
      ctx.fillText(ellipsize(ctx, d.lift.detail, innerW), PAD, y);
      ctx.font = font(700, 36);
      ctx.fillStyle = MUTED;
      ctx.fillText(ellipsize(ctx, d.lift.name, innerW), PAD, y - 62);
      y -= 140;
    }
  }

  // Title (+ small first name above)
  ctx.fillStyle = INK;
  const titleSize = fitFont(ctx, d.workoutTitle, innerW, 900, 84, 44);
  ctx.fillText(ellipsize(ctx, d.workoutTitle, innerW), PAD, y);
  if (d.athleteName) {
    ctx.font = font(800, 28);
    setSpacing(ctx, 5);
    ctx.fillStyle = MUTED;
    ctx.fillText(d.athleteName.toUpperCase(), PAD, y - titleSize - 14);
    setSpacing(ctx, 0);
  }

  drawBrandFooter(ctx, logo, PAD, footerY, "left", W, d.dateLabel);
}

/* ------------------------------------------------------------------ */
/*  DATA card                                                          */
/* ------------------------------------------------------------------ */
/**
 * Lays out (or just measures, `dry`) the hero block of the data card and
 * returns its height. Measuring first lets the block sit optically centred in
 * the free space instead of hugging the top.
 */
function layoutDataHero(ctx: Ctx, d: ShareCardData, L: Layout, top: number, dry: boolean): number {
  const { PAD, innerW } = L;
  const text = (s: string, x: number, y: number) => {
    if (!dry) ctx.fillText(s, x, y);
  };
  let y = top;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Eyebrow: PR pill, or the athlete's first name.
  if (d.isPr) {
    if (!dry) prPill(ctx, d.lift?.prLabel ? `NEW ${d.lift.prLabel}` : "NEW PR", PAD, y);
    y += 52 + 64;
  } else if (d.athleteName) {
    ctx.font = font(800, 30);
    setSpacing(ctx, 6);
    ctx.fillStyle = RED;
    text(d.athleteName.toUpperCase(), PAD, y + 28);
    setSpacing(ctx, 0);
    y += 28 + 52;
  }

  if (d.isPr && d.lift) {
    // PR: the lift is the headline, the set is the hero number.
    ctx.fillStyle = INK;
    const nameSize = fitFont(ctx, d.lift.name, innerW, 900, 104, 52);
    const lines = wrapLines(ctx, d.lift.name, innerW, 2);
    lines.forEach((ln, i) => text(ln, PAD, y + nameSize * 0.85 + i * (nameSize + 6)));
    y += nameSize * 0.85 + (lines.length - 1) * (nameSize + 6) + 52;
    const detailSize = fitFont(ctx, d.lift.detail, innerW, 900, 164, 80);
    ctx.fillStyle = goldGradient(ctx, PAD, innerW);
    text(d.lift.detail, PAD, y + detailSize * 0.8);
    y += detailSize * 0.8 + detailSize * 0.22 + 30;
    ctx.font = font(700, 34);
    ctx.fillStyle = MUTED;
    text(ellipsize(ctx, d.workoutTitle, innerW), PAD, y + 28);
    y += 28 + 6;
  } else {
    // Everyday session: the workout name leads, the featured lift supports it.
    let size = 112;
    ctx.font = font(900, size);
    let lines = wrapLines(ctx, d.workoutTitle, innerW, 3);
    while (size > 64 && lines.length > 2) {
      size -= 8;
      ctx.font = font(900, size);
      lines = wrapLines(ctx, d.workoutTitle, innerW, 3);
    }
    ctx.fillStyle = INK;
    lines.forEach((ln, i) => text(ln, PAD, y + size * 0.85 + i * (size + 4)));
    y += size * 0.85 + (lines.length - 1) * (size + 4) + 56;
    if (d.lift) {
      ctx.font = font(700, 40);
      ctx.fillStyle = MUTED;
      text(ellipsize(ctx, d.lift.name, innerW), PAD, y + 34);
      ctx.font = font(900, 84);
      ctx.fillStyle = INK;
      text(ellipsize(ctx, d.lift.detail, innerW), PAD, y + 34 + 96);
      y += 34 + 96 + 24;
    }
  }

  // Caption: the athlete's own words, under the hero.
  if (d.caption) {
    ctx.font = font(500, 38);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    const lines = wrapLines(ctx, d.caption, innerW, 3);
    y += 36;
    lines.forEach((ln, i) => text(ln, PAD, y + 34 + i * 50));
    y += lines.length * 50 + 10;
  }
  return y - top;
}

function drawDataCard(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, H, PAD, innerW, footerY, safeTop } = L;

  // Background: near-black, one soft red glow (gold for PR), no pattern noise.
  ctx.fillStyle = "#08080b";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, -80, 20, W * 0.85, -80, H * 0.95);
  glow.addColorStop(0, d.isPr ? "rgba(245,158,11,0.34)" : "rgba(239,51,64,0.36)");
  glow.addColorStop(0.5, d.isPr ? "rgba(120,53,15,0.12)" : "rgba(127,29,29,0.14)");
  glow.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Stats are the only "data" the card carries, anchored above the footer.
  const rowH = 56 + 38;
  const statsTop = footerY - 70 - rowH;
  const dividerY = statsTop - 52;
  if (d.stats.length) {
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(PAD, dividerY, innerW, 2);
    drawStatsRow(ctx, d.stats, PAD, statsTop, innerW, 56);
  }

  // Hero block sits slightly above the optical centre of the free space.
  const regionTop = safeTop + 24;
  const regionBottom = (d.stats.length ? dividerY : footerY - 70) - 40;
  const heroH = layoutDataHero(ctx, d, L, 0, true);
  const slack = Math.max(0, regionBottom - regionTop - heroH);
  layoutDataHero(ctx, d, L, regionTop + slack * 0.38, false);

  drawBrandFooter(ctx, logo, PAD, footerY, "left", W, d.dateLabel);
}

/* ------------------------------------------------------------------ */
/*  Output helpers                                                     */
/* ------------------------------------------------------------------ */

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

/**
 * Hand the card to the OS share sheet (which is where Instagram, Messages,
 * etc. live). Falls back to a download — never pretends to share when the
 * device can't. Returns what actually happened.
 */
export type ShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

export async function shareCardImage(blob: Blob, opts: { filename: string; text?: string; title?: string }): Promise<ShareOutcome> {
  const file = new File([blob], opts.filename, { type: blob.type || "image/jpeg" });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: opts.title ?? "JF Effect workout", ...(opts.text ? { text: opts.text } : {}) });
      return "shared";
    }
  } catch (e: unknown) {
    if ((e as { name?: string })?.name === "AbortError") return "cancelled";
    // fall through to download
  }
  return downloadBlob(blob, opts.filename) ? "downloaded" : "failed";
}

export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}
