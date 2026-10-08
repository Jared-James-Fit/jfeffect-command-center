/**
 * Share cards for a finished workout — the image an athlete posts outside the
 * app. Canvas only (no DOM, no network except the font + small brand mark).
 *
 * Templates (swipeable in the share editor):
 *   pr       – "NEW PR": the lift and the number, huge, in gold. Shown first
 *              whenever the workout earned a record.
 *   photo    – the athlete's photo/video frame IS the card; the session sits
 *              in a quiet lower block.
 *   stats    – the receipt: workout name, three big numbers and the top lifts.
 *   sticker  – transparent PNG to paste on top of your own photo in an
 *              Instagram Story (the Strava move).
 *   volume   – one giant number: total weight moved.
 *   lockin   – "LOCKED IN": the gym photo (or the brand glow) with the
 *              time and the session, posted when someone shows up, before
 *              any numbers exist. Not in the finished-workout carousel.
 *
 * Hierarchy (on purpose): photo / performance → accomplishment → brand. The
 * brand is a small footer mark, never a banner.
 *
 * Formats share one layout: "story" 1080×1920 (default — that's where
 * post-workout shares go; content stays inside Instagram's safe zone) and
 * "feed" 1080×1350 (4:5, Instagram's tallest feed ratio). Stickers are sized
 * to their content.
 *
 * Always rendered dark: the image has to read the same wherever it's posted.
 */
import { ellipsize, fitFont as fitSystemFont, font, loadImage, roundRect } from "@/lib/workout-story-card";
import type { CardStat, ShareCardExtras } from "@/lib/community";

export type ShareFormat = "feed" | "story";
export type ShareTemplate = "pr" | "photo" | "stats" | "sticker" | "volume" | "receipt" | "streak" | "progress" | "lockin" | "lockclock" | "lockplan" | "plain";

export const SHARE_SIZES: Record<ShareFormat, { w: number; h: number; safeTop: number; safeBottom: number }> = {
  feed: { w: 1080, h: 1350, safeTop: 80, safeBottom: 80 },
  story: { w: 1080, h: 1920, safeTop: 250, safeBottom: 280 },
};

export const TEMPLATE_LABEL: Record<ShareTemplate, string> = {
  pr: "PR",
  photo: "Photo",
  stats: "Stats",
  sticker: "Sticker",
  volume: "Volume",
  receipt: "Receipt",
  streak: "Streak",
  progress: "vs last time",
  lockin: "Locked in",
  lockclock: "Clock",
  lockplan: "Today's plan",
  plain: "No filter",
};

export type ShareCardMedia = CanvasImageSource & { width?: number; height?: number };

export type ShareCardExercise = { name: string; detail: string; pr: boolean };

export type ShareCardData = {
  format: ShareFormat;
  template: ShareTemplate;
  /** First name only — the athlete should feel like it's theirs. */
  athleteName: string | null;
  workoutTitle: string;
  dateLabel: string | null;
  /** Featured lift, pre-formatted: `detail` = "220 kg × 3". `prLabel` set → it's a record. */
  lift: { name: string; detail: string; prLabel: string | null } | null;
  stats: CardStat[];
  isPr: boolean;
  /** Top lifts for the stats card, pre-formatted, programmed order. */
  exercises: ShareCardExercise[];
  /** "12,450 kg" — null when nothing with external load was lifted. */
  volume: string | null;
  /** "Session 12 this month" */
  sessionLine: string | null;
  media: ShareCardMedia | null;
  /** When they locked in ("6:42 PM"); `live` = the photo was just taken in-app. */
  lockedIn?: { time: string; live: boolean } | null;
  /** Receipt / streak / vs-last-time numbers (composer preview only). */
  extras?: ShareCardExtras | null;
};

/** Templates worth offering for this workout, best first. */
export function availableTemplates(d: Pick<ShareCardData, "isPr" | "exercises" | "volume" | "media"> & { extras?: ShareCardExtras | null }): ShareTemplate[] {
  const out: ShareTemplate[] = [];
  const x = d.extras;
  if (d.isPr) out.push("pr");
  if (d.media) out.push("photo");
  if (x?.progress) out.push("progress");
  if (x?.receipt.length) out.push("receipt");
  if (x?.streak) out.push("streak");
  if (d.exercises.length) out.push("stats");
  if (!d.media) out.push("photo");
  if (d.volume) out.push("volume");
  out.push("sticker");
  return out;
}

/** The looks you can swipe through on the camera: every card that sits on a photo. */
export function cameraLooks(d: Pick<ShareCardData, "isPr" | "exercises" | "volume"> & { extras?: ShareCardExtras | null }): ShareTemplate[] {
  // last: just the photo, nothing on it
  return [...availableTemplates({ ...d, media: {} as ShareCardMedia }).filter((t) => t !== "sticker"), "plain"];
}

const INK = "#ffffff";
const MUTED = "rgba(255,255,255,0.62)";
const RED = "#ef3340";
const GOLD_FROM = "#fde68a";
const GOLD_TO = "#f59e0b";
const DISPLAY_FAMILY = `"Anton", "Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif`;

type Ctx = CanvasRenderingContext2D;

/* ------------------------------------------------------------------ */
/*  Font                                                               */
/* ------------------------------------------------------------------ */

let fontPromise: Promise<void> | null = null;

/** Load the bundled display font once (falls back to Impact-like system fonts). */
export function ensureDisplayFont(): Promise<void> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      if (typeof document === "undefined" || !document.fonts) return;
      // Prefer the stylesheet's @font-face (styles.css); load it explicitly so
      // the first card never paints in the fallback face.
      await document.fonts.load(`400 100px "Anton"`);
      if (document.fonts.check(`400 100px "Anton"`)) return;
      if (typeof FontFace === "undefined") return;
      const face = new FontFace("Anton", "url(/fonts/anton-latin-400.woff2)", { weight: "400", style: "normal" });
      await face.load();
      document.fonts.add(face);
    } catch {
      /* system fallback is fine */
    }
  })();
  return fontPromise;
}

function display(size: number) {
  return `400 ${size}px ${DISPLAY_FAMILY}`;
}

/** Shrink display text until it fits. Returns the size used. */
function fitDisplay(ctx: Ctx, text: string, maxWidth: number, start: number, min = 40) {
  let size = start;
  ctx.font = display(size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 4;
    ctx.font = display(size);
  }
  return size;
}

function setSpacing(ctx: Ctx, px: number) {
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  } catch {
    /* unsupported → no tracking, still fine */
  }
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

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
  ctx.drawImage(src, (W - w * s) / 2, (H - h * s) / 2, w * s, h * s);
}

function gold(ctx: Ctx, x: number, w: number) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, GOLD_FROM);
  g.addColorStop(1, GOLD_TO);
  return g;
}

function darkGlow(ctx: Ctx, W: number, H: number, tint: "red" | "gold") {
  ctx.fillStyle = "#08080b";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.85, -60, 20, W * 0.85, -60, H * 0.95);
  g.addColorStop(0, tint === "gold" ? "rgba(245,158,11,0.40)" : "rgba(239,51,64,0.42)");
  g.addColorStop(0.5, tint === "gold" ? "rgba(120,53,15,0.14)" : "rgba(127,29,29,0.16)");
  g.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const b = ctx.createRadialGradient(0, H + 40, 20, 0, H + 40, H * 0.6);
  b.addColorStop(0, tint === "gold" ? "rgba(245,158,11,0.10)" : "rgba(239,51,64,0.10)");
  b.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, W, H);
}

/** Small brand mark + date. `y` is the baseline. */
function brandRow(ctx: Ctx, logo: HTMLImageElement | null, x: number, y: number, W: number, dateLabel: string | null, alpha = 0.72) {
  const size = 36;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  let bx = x;
  if (logo) {
    ctx.globalAlpha = Math.min(1, alpha + 0.15);
    ctx.save();
    roundRect(ctx, bx, y - size + 7, size, size, 9);
    ctx.clip();
    ctx.drawImage(logo, bx, y - size + 7, size, size);
    ctx.restore();
    bx += size + 14;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.font = font(800, 24);
  setSpacing(ctx, 4);
  ctx.fillText("JF EFFECT", bx, y);
  setSpacing(ctx, 0);
  if (dateLabel) {
    ctx.globalAlpha = alpha * 0.75;
    ctx.font = font(700, 24);
    ctx.textAlign = "right";
    ctx.fillText(dateLabel, W - x, y);
  }
  ctx.restore();
}

/** Big display numbers with small labels underneath. Returns the block height. */
function statRow(ctx: Ctx, stats: CardStat[], x: number, top: number, width: number, size: number, color: string | CanvasGradient = INK): number {
  if (!stats.length) return 0;
  const colW = width / stats.length;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  stats.forEach((s, i) => {
    const cx = x + i * colW;
    ctx.fillStyle = color;
    const used = fitDisplay(ctx, s.value.toUpperCase(), colW - 60, size, 44);
    ctx.fillText(s.value.toUpperCase(), cx, top + used * 0.92);
    ctx.fillStyle = MUTED;
    ctx.font = font(800, 22);
    setSpacing(ctx, 3);
    ctx.fillText(s.label.toUpperCase(), cx, top + size * 0.92 + 40);
    setSpacing(ctx, 0);
  });
  return size * 0.92 + 40;
}

function pill(ctx: Ctx, text: string, x: number, y: number, fill: string | CanvasGradient, ink: string): number {
  ctx.save();
  ctx.font = font(900, 26);
  setSpacing(ctx, 4);
  const w = ctx.measureText(text).width + 52;
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, 54, 27);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 26, y + 29);
  setSpacing(ctx, 0);
  ctx.restore();
  return w;
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

let logoPromise: Promise<HTMLImageElement | null> | null = null;
/** The brand mark, loaded once. */
export function cardLogo(): Promise<HTMLImageElement | null> {
  return (logoPromise ??= loadImage("/logo.png"));
}

export async function drawWorkoutShareCard(canvas: HTMLCanvasElement, d: ShareCardData): Promise<void> {
  await ensureDisplayFont();
  const logo = await cardLogo();
  if (d.template === "sticker") {
    drawSticker(canvas, d, logo);
    return;
  }
  paintShareCard(canvas, d, logo);
}

/**
 * Synchronous paint (fonts and logo already loaded), so the camera can run a
 * card live over the viewfinder. `scale` < 1 renders a lighter preview.
 */
export function paintShareCard(canvas: HTMLCanvasElement, d: ShareCardData, logo: HTMLImageElement | null, scale = 1): void {
  if (d.template === "sticker") return drawSticker(canvas, d, logo);
  const size = SHARE_SIZES[d.format];
  const cw = Math.round(size.w * scale);
  const ch = Math.round(size.h * scale);
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const L: Layout = { W: size.w, H: size.h, PAD: 80, innerW: size.w - 160, top: size.safeTop, bottom: size.h - size.safeBottom, story: d.format === "story" };
  if (d.template === "pr") drawPr(ctx, d, logo, L);
  else if (d.template === "photo") drawPhoto(ctx, d, logo, L);
  else if (d.template === "stats") drawStats(ctx, d, logo, L);
  else if (d.template === "lockin") drawLockIn(ctx, d, logo, L);
  else if (d.template === "lockclock") drawLockClock(ctx, d, logo, L);
  else if (d.template === "lockplan") drawLockPlan(ctx, d, logo, L);
  else if (d.template === "receipt") drawReceipt(ctx, d, logo, L);
  else if (d.template === "streak") drawStreak(ctx, d, logo, L);
  else if (d.template === "progress") drawProgress(ctx, d, logo, L);
  else if (d.template === "plain") drawPlain(ctx, d, L);
  else drawVolume(ctx, d, logo, L);
}

/** No filter: just the photo (the brand glow when there isn't one yet). */
function drawPlain(ctx: Ctx, d: ShareCardData, L: Layout) {
  if (d.media) drawCover(ctx, d.media, L.W, L.H);
  else darkGlow(ctx, L.W, L.H, "red");
}

/** The photo, dimmed so data reads on it — or the brand glow without one. */
function backdrop(ctx: Ctx, d: ShareCardData, L: Layout, dim: number, tint: "red" | "gold" = "red") {
  if (d.media) {
    drawCover(ctx, d.media, L.W, L.H);
    ctx.fillStyle = `rgba(8,8,11,${dim})`;
    ctx.fillRect(0, 0, L.W, L.H);
  } else darkGlow(ctx, L.W, L.H, tint);
}

type Layout = { W: number; H: number; PAD: number; innerW: number; top: number; bottom: number; story: boolean };

/* ------------------------------------------------------------------ */
/*  PR                                                                 */
/* ------------------------------------------------------------------ */
function drawPr(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, H, PAD, innerW } = L;
  if (d.media) {
    drawCover(ctx, d.media, W, H);
    ctx.fillStyle = "rgba(8,8,11,0.55)";
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.25, 0, H);
    g.addColorStop(0, "rgba(8,8,11,0)");
    g.addColorStop(1, "rgba(8,8,11,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    darkGlow(ctx, W, H, "gold");
  }

  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel);

  // Measure the hero, then centre it optically in the free space.
  const lift = d.lift;
  const name = (lift?.name ?? d.workoutTitle).toUpperCase();
  const detail = (lift?.detail ?? "").toUpperCase();
  ctx.font = display(110);
  const nameSize = Math.min(fitDisplay(ctx, name, innerW, 120, 64), 120);
  ctx.font = display(nameSize);
  const nameLines = wrapLines(ctx, name, innerW, 2);
  const detailSize = detail ? fitDisplay(ctx, detail, innerW, L.story ? 230 : 190, 90) : 0;
  const prSize = L.story ? 250 : 200;
  const heroH = prSize * 0.9 + 40 + 54 + 46 + nameLines.length * (nameSize + 6) + (detail ? detailSize * 0.95 + 20 : 0);
  const regionTop = L.top + 90;
  const regionBottom = L.bottom - 230;
  let y = regionTop + Math.max(0, (regionBottom - regionTop - heroH) * 0.42);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = gold(ctx, PAD, innerW * 0.8);
  ctx.font = display(prSize);
  ctx.fillText("NEW PR", PAD - 6, y + prSize * 0.9);
  y += prSize * 0.9 + 40;
  if (lift?.prLabel) pill(ctx, lift.prLabel, PAD, y, "rgba(253,230,138,0.16)", GOLD_FROM);
  y += 54 + 46;

  ctx.fillStyle = INK;
  ctx.font = display(nameSize);
  nameLines.forEach((ln, i) => ctx.fillText(ln, PAD, y + nameSize * 0.9 + i * (nameSize + 6)));
  y += nameLines.length * (nameSize + 6);
  if (detail) {
    ctx.fillStyle = INK;
    ctx.font = display(detailSize);
    ctx.fillText(detail, PAD - 4, y + detailSize * 0.92 + 10);
  }

  drawFooterStats(ctx, d, logo, L);
}

/* ------------------------------------------------------------------ */
/*  PHOTO                                                              */
/* ------------------------------------------------------------------ */
function drawPhoto(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, H, PAD, innerW } = L;
  if (d.media) {
    drawCover(ctx, d.media, W, H);
  } else {
    // No photo yet: the editor shows an "Add photo" button on top of this.
    darkGlow(ctx, W, H, "red");
  }
  const scrimTop = H * 0.42;
  const g = ctx.createLinearGradient(0, scrimTop, 0, H);
  g.addColorStop(0, "rgba(8,8,11,0)");
  g.addColorStop(0.5, "rgba(8,8,11,0.6)");
  g.addColorStop(1, "rgba(8,8,11,0.92)");
  ctx.fillStyle = g;
  ctx.fillRect(0, scrimTop, W, H - scrimTop);
  const tg = ctx.createLinearGradient(0, 0, 0, L.top + 160);
  tg.addColorStop(0, "rgba(8,8,11,0.5)");
  tg.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, L.top + 160);

  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel, 0.9);
  if (d.isPr) pill(ctx, d.lift?.prLabel ? `NEW ${d.lift.prLabel}` : "NEW PR", PAD, L.top + 70, gold(ctx, PAD, 360), "#2b1700");
  else if (d.lockedIn) pill(ctx, `LOCKED IN ${d.lockedIn.time}`.toUpperCase(), PAD, L.top + 70, RED, INK);

  // Bottom-up block: stats, lift, title.
  let y = L.bottom - 40;
  ctx.textAlign = "left";
  if (d.stats.length) {
    const h = statRow(ctx, d.stats, PAD, y - 136, innerW, 96);
    y -= h + 70;
  }
  if (d.lift) {
    ctx.font = font(700, 36);
    ctx.fillStyle = MUTED;
    ctx.fillText(ellipsize(ctx, d.lift.name, innerW), PAD, y - 78);
    ctx.fillStyle = d.isPr ? gold(ctx, PAD, innerW * 0.6) : INK;
    const s = fitDisplay(ctx, d.lift.detail.toUpperCase(), innerW, 84, 48);
    ctx.fillText(d.lift.detail.toUpperCase(), PAD, y - 78 + 14 + s * 0.92);
    y -= 78 + 50;
  }
  ctx.fillStyle = INK;
  const title = d.workoutTitle.toUpperCase();
  const ts = fitDisplay(ctx, title, innerW, 116, 60);
  ctx.fillText(title, PAD - 3, y - 20);
  if (d.athleteName) {
    ctx.font = font(800, 28);
    setSpacing(ctx, 6);
    ctx.fillStyle = MUTED;
    ctx.fillText(d.athleteName.toUpperCase(), PAD, y - 20 - ts * 0.92 - 22);
    setSpacing(ctx, 0);
  }
  if (d.sessionLine) {
    ctx.font = font(700, 24);
    ctx.fillStyle = MUTED;
    ctx.textAlign = "right";
    ctx.fillText(d.sessionLine, W - PAD, L.bottom + 40);
    ctx.textAlign = "left";
  }
}

/* ------------------------------------------------------------------ */
/*  LOCK IN ("I showed up")                                            */
/* ------------------------------------------------------------------ */
function drawLockIn(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, H, PAD, innerW } = L;
  if (d.media) drawCover(ctx, d.media, W, H);
  else darkGlow(ctx, W, H, "red");
  const scrimTop = H * 0.38;
  const g = ctx.createLinearGradient(0, scrimTop, 0, H);
  g.addColorStop(0, "rgba(8,8,11,0)");
  g.addColorStop(0.55, "rgba(8,8,11,0.62)");
  g.addColorStop(1, "rgba(8,8,11,0.94)");
  ctx.fillStyle = g;
  ctx.fillRect(0, scrimTop, W, H - scrimTop);
  const tg = ctx.createLinearGradient(0, 0, 0, L.top + 160);
  tg.addColorStop(0, "rgba(8,8,11,0.5)");
  tg.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, L.top + 160);

  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel, 0.9);

  // Bottom-up: session, the stamp, the time.
  let y = L.bottom - 10;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, 40);
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillText(ellipsize(ctx, d.workoutTitle, innerW), PAD, y);
  y -= 40 + 64;

  ctx.fillStyle = INK;
  const size = fitDisplay(ctx, "LOCKED IN", innerW, L.story ? 250 : 210, 120);
  ctx.fillText("LOCKED IN", PAD - 4, y);
  // Red rule under the stamp: the brand accent, one stroke.
  ctx.fillStyle = RED;
  ctx.fillRect(PAD, y + 18, Math.min(innerW, size * 1.15), 10);
  y -= size * 0.92 + 34;

  if (d.lockedIn) {
    const text = (d.lockedIn.live ? `●  LIVE  ${d.lockedIn.time}` : d.lockedIn.time).toUpperCase();
    pill(ctx, text, PAD, y - 54, RED, INK);
    y -= 54 + 30;
  }
  if (d.athleteName) {
    ctx.font = font(800, 28);
    setSpacing(ctx, 6);
    ctx.fillStyle = MUTED;
    ctx.fillText(d.athleteName.toUpperCase(), PAD, y);
    setSpacing(ctx, 0);
  }
}

/** Photo (or the brand glow) with a scrim from `from` (0-1 of height) down. */
function photoWithScrim(ctx: Ctx, d: ShareCardData, L: Layout, from: number, strength = 0.94) {
  const { W, H } = L;
  if (d.media) drawCover(ctx, d.media, W, H);
  else darkGlow(ctx, W, H, "red");
  const top = H * from;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, "rgba(8,8,11,0)");
  g.addColorStop(0.5, `rgba(8,8,11,${(strength * 0.66).toFixed(2)})`);
  g.addColorStop(1, `rgba(8,8,11,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  const tg = ctx.createLinearGradient(0, 0, 0, L.top + 160);
  tg.addColorStop(0, "rgba(8,8,11,0.5)");
  tg.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, L.top + 160);
}

/* ------------------------------------------------------------------ */
/*  LOCK IN · CLOCK  (the time is the flex: "5:42 AM, already here")   */
/* ------------------------------------------------------------------ */
function drawLockClock(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, PAD, innerW } = L;
  photoWithScrim(ctx, d, L, 0.34, 0.95);
  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel, 0.9);

  const raw = (d.lockedIn?.time ?? "").toUpperCase();
  const m = raw.match(/^(\d{1,2}:\d{2})\s*([AP]M)?$/);
  const clock = m ? m[1] : raw;
  const ampm = m?.[2] ?? "";

  let y = L.bottom - 10;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, 40);
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillText(ellipsize(ctx, d.workoutTitle, innerW), PAD, y);
  y -= 40 + 40;

  pill(ctx, d.lockedIn?.live ? "●  LOCKED IN" : "LOCKED IN", PAD, y - 54, RED, INK);
  y -= 54 + 44;

  // The clock, as big as the width allows; AM/PM rides beside it.
  ctx.fillStyle = INK;
  const ampmW = ampm ? 150 : 0;
  const size = fitDisplay(ctx, clock, innerW - ampmW, L.story ? 400 : 330, 140);
  ctx.fillText(clock, PAD - 6, y);
  const clockW = ctx.measureText(clock).width;
  if (ampm) {
    ctx.font = display(Math.round(size * 0.34));
    ctx.fillStyle = RED;
    ctx.fillText(ampm, PAD + clockW + 18, y);
  }
  y -= size * 0.9 + 26;
  if (d.athleteName) {
    ctx.font = font(800, 28);
    setSpacing(ctx, 6);
    ctx.fillStyle = MUTED;
    ctx.fillText(d.athleteName.toUpperCase(), PAD, y);
    setSpacing(ctx, 0);
  }
}

/* ------------------------------------------------------------------ */
/*  LOCK IN · TODAY'S PLAN  (what's about to get done)                  */
/* ------------------------------------------------------------------ */
function drawLockPlan(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, H, PAD, innerW } = L;
  photoWithScrim(ctx, d, L, 0.22, 0.96);
  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel, 0.9);

  const rows = d.exercises.slice(0, L.story ? 6 : 4);
  const more = d.exercises.length - rows.length;
  const rowH = 92;
  const listH = rows.length * rowH + (more > 0 ? 56 : 0);
  let y = L.bottom - 10 - listH;

  // Header block above the list
  const headTop = y - 40;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  const size = fitDisplay(ctx, "LOCKED IN", innerW, L.story ? 200 : 170, 100);
  ctx.fillText("LOCKED IN", PAD - 4, headTop - 80);
  ctx.fillStyle = RED;
  ctx.fillRect(PAD, headTop - 80 + 16, Math.min(innerW, size * 1.1), 9);
  ctx.font = font(800, 30);
  setSpacing(ctx, 5);
  ctx.fillStyle = MUTED;
  const label = `TODAY'S PLAN${d.lockedIn?.time ? `  ·  ${d.lockedIn.time.toUpperCase()}` : ""}`;
  ctx.fillText(ellipsize(ctx, label, innerW), PAD, headTop);
  setSpacing(ctx, 0);
  // session title above the stamp
  ctx.font = font(800, 38);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(ellipsize(ctx, d.workoutTitle, innerW), PAD, headTop - 80 - size * 0.92 - 26);

  // The list
  y += 6;
  for (const r of rows) {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.font = display(48);
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    const dw = r.detail ? ctx.measureText(r.detail).width : 0;
    if (r.detail) ctx.fillText(r.detail, W - PAD, y + 62);
    ctx.textAlign = "left";
    ctx.font = font(800, 36);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(ellipsize(ctx, r.name, innerW - dw - 30), PAD, y + 60);
    y += rowH;
  }
  if (more > 0) {
    ctx.font = font(700, 28);
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.fillText(`+ ${more} more`, PAD, y + 40);
  }
  void H;
}

/* ------------------------------------------------------------------ */
/*  STATS (the receipt)                                                */
/* ------------------------------------------------------------------ */
function drawStats(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, PAD, innerW } = L;
  backdrop(ctx, d, L, 0.74, d.isPr ? "gold" : "red");
  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel);

  let y = L.top + 120;
  ctx.textAlign = "left";
  if (d.athleteName) {
    ctx.font = font(800, 30);
    setSpacing(ctx, 6);
    ctx.fillStyle = RED;
    ctx.fillText(d.athleteName.toUpperCase(), PAD, y);
    setSpacing(ctx, 0);
    y += 30;
  }
  const title = d.workoutTitle.toUpperCase();
  ctx.fillStyle = INK;
  ctx.font = display(L.story ? 140 : 120);
  let ts = L.story ? 140 : 120;
  let lines = wrapLines(ctx, title, innerW, 2);
  while (ts > 76 && lines.length === 2 && ctx.measureText(lines[1]).width > innerW * 0.98) {
    ts -= 6;
    ctx.font = display(ts);
    lines = wrapLines(ctx, title, innerW, 2);
  }
  lines.forEach((ln, i) => ctx.fillText(ln, PAD - 3, y + ts * 0.92 + i * (ts + 2)));
  y += ts * 0.92 + (lines.length - 1) * (ts + 2) + 70;

  if (d.stats.length) {
    const h = statRow(ctx, d.stats, PAD, y, innerW, L.story ? 128 : 108, d.isPr ? gold(ctx, PAD, innerW) : INK);
    y += h + 70;
  }

  // Top lifts — the actual work.
  const rows = d.exercises.slice(0, L.story ? 6 : 4);
  if (rows.length) {
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(PAD, y, innerW, 2);
    y += 24;
    const rowH = L.story ? 104 : 92;
    const room = L.bottom - 80 - y;
    const fit = Math.max(1, Math.min(rows.length, Math.floor(room / rowH)));
    rows.slice(0, fit).forEach((r, i) => {
      const ry = y + i * rowH;
      ctx.textAlign = "right";
      ctx.fillStyle = r.pr ? GOLD_TO : INK;
      ctx.font = display(56);
      const detail = r.detail.toUpperCase();
      const dw = ctx.measureText(detail).width;
      ctx.fillText(detail, W - PAD, ry + 66);
      ctx.textAlign = "left";
      const nameMax = innerW - dw - 40 - (r.pr ? 70 : 0);
      ctx.font = font(700, 36);
      ctx.fillStyle = INK;
      const nm = ellipsize(ctx, r.name, nameMax);
      ctx.fillText(nm, PAD, ry + 60);
      if (r.pr) {
        const nx = PAD + ctx.measureText(nm).width + 16;
        pill(ctx, "PR", nx, ry + 22, gold(ctx, nx, 70), "#2b1700");
      }
      if (i < fit - 1) {
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(PAD, ry + rowH - 4, innerW, 2);
      }
    });
  }

  brandFooter(ctx, d, L);
}

/* ------------------------------------------------------------------ */
/*  VOLUME (one giant number)                                          */
/* ------------------------------------------------------------------ */
function drawVolume(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, PAD, innerW } = L;
  backdrop(ctx, d, L, 0.6);
  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel);

  const vol = (d.volume ?? "").toUpperCase();
  const [num, unit] = vol.split(" ");
  const numSize = fitDisplay(ctx, num ?? "", innerW, L.story ? 330 : 280, 120);
  const compare = d.extras?.compare ?? null;
  const blockH = 40 + numSize * 0.92 + 56 + 80 + 40 + 60 + (compare ? 80 : 0);
  const regionTop = L.top + 100;
  const regionBottom = L.bottom - 240;
  let y = regionTop + Math.max(0, (regionBottom - regionTop - blockH) * 0.4);

  ctx.textAlign = "left";
  ctx.font = font(800, 30);
  setSpacing(ctx, 6);
  ctx.fillStyle = RED;
  ctx.fillText(d.athleteName ? `${d.athleteName.toUpperCase()} MOVED` : "TOTAL MOVED", PAD, y + 30);
  setSpacing(ctx, 0);
  y += 40;
  const g = ctx.createLinearGradient(0, y, 0, y + numSize);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#ffb4b9");
  ctx.fillStyle = g;
  ctx.font = display(numSize);
  ctx.fillText(num ?? "", PAD - 8, y + numSize * 0.92);
  y += numSize * 0.92 + 56;
  ctx.fillStyle = INK;
  ctx.font = display(88);
  ctx.fillText(`${(unit ?? "KG").toUpperCase()} LIFTED`, PAD - 2, y + 80);
  y += 80 + 40;
  if (compare) {
    // The bit anyone gets: "≈ the weight of 3 pickup trucks".
    ctx.font = font(800, 44);
    ctx.fillStyle = "#ffb4b9";
    ctx.fillText(ellipsize(ctx, compare, innerW), PAD, y + 46);
    y += 80;
  }
  ctx.font = font(700, 36);
  ctx.fillStyle = MUTED;
  ctx.fillText(ellipsize(ctx, d.workoutTitle, innerW), PAD, y + 40);

  drawFooterStats(ctx, d, logo, L);
}

/* ------------------------------------------------------------------ */
/*  RECEIPT (the session, itemised: anyone can read a receipt)         */
/* ------------------------------------------------------------------ */
const MONO = `"SF Mono", "Menlo", "Roboto Mono", "Courier New", monospace`;
const mono = (w: number, s: number) => `${w} ${s}px ${MONO}`;
const PAPER = "#f6f4ee";
const PAPER_INK = "#17171b";
const PAPER_MUTED = "#6e6d72";

function zigzag(ctx: Ctx, x: number, y: number, w: number, tooth: number, down: boolean) {
  const n = Math.max(1, Math.round(w / (tooth * 2)));
  const step = w / n;
  for (let i = 0; i < n; i++) {
    ctx.lineTo(x + i * step + step / 2, y + (down ? tooth : -tooth));
    ctx.lineTo(x + (i + 1) * step, y);
  }
}

function drawReceipt(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W } = L;
  backdrop(ctx, d, L, 0.42);
  const x = d.extras;
  const PW = L.story ? 820 : 740;
  const px = (W - PW) / 2;
  const IN = 56; // paper padding
  const iw = PW - IN * 2;
  const lh = L.story ? 54 : 48;

  const totals: [string, string][] = [];
  if (x?.sets) totals.push(["Sets", String(x.sets)]);
  if (x?.reps) totals.push(["Reps", x.reps.toLocaleString("en-US")]);
  if (x?.duration) totals.push(["Time", x.duration]);
  const fixed = 70 + 96 + 44 + 44 + (d.athleteName ? 44 : 0) + 44 + 44 + totals.length * lh + (d.volume ? 92 : 0) + (x?.compare ? 50 : 0) + 44 + 110 + 50 + (x?.workoutNumber ? 40 : 0) + 60;
  const room = L.bottom - L.top - 40;
  const all = x?.receipt ?? [];
  const maxRows = Math.max(1, Math.min(all.length, L.story ? 8 : 5, Math.floor((room - fixed) / lh) - (all.length > 1 ? 1 : 0)));
  const rows = all.slice(0, maxRows);
  const more = all.length - rows.length;
  const PH = fixed + rows.length * lh + (more > 0 ? lh : 0);
  const py = L.top + 20 + Math.max(0, (room - PH) / 2);

  ctx.save();
  // A slight tilt so it reads as a real slip of paper.
  ctx.translate(W / 2, py + PH / 2);
  ctx.rotate(-0.018);
  ctx.translate(-W / 2, -(py + PH / 2));
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.moveTo(px, py);
  zigzag(ctx, px, py, PW, 12, false);
  ctx.lineTo(px + PW, py + PH);
  const n = Math.max(1, Math.round(PW / 24));
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(px + (i + 0.5) * (PW / n), py + PH + 12);
    ctx.lineTo(px + i * (PW / n), py + PH);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = "transparent";

  const cx = W / 2;
  const L0 = px + IN;
  const R0 = px + PW - IN;
  let y = py + 70;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = PAPER_INK;
  ctx.font = display(84);
  ctx.fillText("JF EFFECT", cx, y + 60);
  y += 96;
  ctx.font = mono(800, 26);
  setSpacing(ctx, 8);
  ctx.fillText("WORKOUT RECEIPT", cx, y + 20);
  setSpacing(ctx, 0);
  y += 44;
  ctx.font = mono(600, 26);
  ctx.fillStyle = PAPER_MUTED;
  ctx.fillText([d.dateLabel, x?.timeLabel].filter(Boolean).join("  ·  ").toUpperCase(), cx, y + 20);
  y += 44;
  if (d.athleteName) {
    ctx.fillText(`MEMBER: ${d.athleteName.toUpperCase()}`, cx, y + 20);
    y += 44;
  }

  const dash = () => {
    ctx.save();
    ctx.strokeStyle = "rgba(23,23,27,0.35)";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(L0, y + 18);
    ctx.lineTo(R0, y + 18);
    ctx.stroke();
    ctx.restore();
    y += 44;
  };
  const line = (left: string, right: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => {
    const size = opts.size ?? (L.story ? 30 : 28);
    ctx.font = mono(opts.bold ? 800 : 600, size);
    ctx.fillStyle = opts.color ?? PAPER_INK;
    ctx.textAlign = "right";
    const rw = ctx.measureText(right).width;
    ctx.fillText(right, R0, y + size);
    ctx.textAlign = "left";
    ctx.fillText(ellipsize(ctx, left, iw - rw - 30), L0, y + size);
    y += lh;
  };

  dash();
  rows.forEach((r) => line(`${r.sets}× ${r.name.toUpperCase()}`, r.detail.toUpperCase(), { color: r.pr ? "#b45309" : PAPER_INK, bold: r.pr }));
  if (more > 0) line(`+ ${more} MORE`, "", { color: PAPER_MUTED });
  dash();
  const totalsY = y;
  totals.forEach(([k, v]) => line(k.toUpperCase(), v.toUpperCase()));
  if (d.volume) {
    ctx.font = mono(800, 30);
    ctx.fillStyle = PAPER_INK;
    ctx.textAlign = "left";
    ctx.fillText("TOTAL LIFTED", L0, y + 56);
    ctx.textAlign = "right";
    fitDisplay(ctx, d.volume.toUpperCase(), iw * 0.6, 76, 44);
    ctx.fillText(d.volume.toUpperCase(), R0, y + 64);
    y += 92;
  }
  if (x?.compare) {
    ctx.font = mono(700, 26);
    ctx.fillStyle = PAPER_MUTED;
    ctx.textAlign = "right";
    ctx.fillText(x.compare.toUpperCase(), R0, y + 26);
    y += 50;
  }
  dash();

  // Barcode, seeded by the workout so it's stable.
  let seed = 7;
  for (const ch of d.workoutTitle) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  ctx.fillStyle = PAPER_INK;
  let bx = L0 + 40;
  while (bx < R0 - 40) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const bw = 2 + (seed % 5);
    if ((seed >> 4) % 3) ctx.fillRect(bx, y + 4, bw, 92);
    bx += bw + 3 + ((seed >> 8) % 4);
  }
  y += 110;
  ctx.textAlign = "center";
  ctx.font = mono(800, 26);
  setSpacing(ctx, 4);
  ctx.fillText("THANK YOU FOR SHOWING UP", cx, y + 26);
  setSpacing(ctx, 0);
  y += 50;
  if (x?.workoutNumber) {
    ctx.font = mono(600, 24);
    ctx.fillStyle = PAPER_MUTED;
    ctx.fillText(`WORKOUT #${x.workoutNumber}`, cx, y + 22);
  }

  // The stamp: across the gap between the labels and the numbers.
  ctx.save();
  ctx.translate(cx - 10, totalsY + Math.max(1, totals.length) * lh * 0.5 + 6);
  ctx.rotate(-0.16);
  ctx.strokeStyle = "rgba(239,51,64,0.85)";
  ctx.fillStyle = "rgba(239,51,64,0.85)";
  ctx.lineWidth = 6;
  roundRect(ctx, -150, -46, 300, 92, 16);
  ctx.stroke();
  ctx.font = display(48);
  ctx.textAlign = "center";
  ctx.fillText("PAID IN SWEAT", 0, 17);
  ctx.restore();
  ctx.restore();
  void logo;
}

/* ------------------------------------------------------------------ */
/*  STREAK (4 weeks of showing up, as a calendar)                      */
/* ------------------------------------------------------------------ */
function drawStreak(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, PAD, innerW } = L;
  backdrop(ctx, d, L, 0.62);
  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel, 0.9);
  const st = d.extras?.streak;
  if (!st) return brandFooter(ctx, d, L);
  const gap = 14;
  const cell = Math.min(L.story ? 112 : 88, (innerW - gap * 6) / 7);
  const gridH = cell * 4 + gap * 3;
  const stats: CardStat[] = [];
  if (st.weeks >= 2) stats.push({ value: String(st.weeks), label: "weeks in a row" });
  if (d.extras?.workoutNumber) stats.push({ value: `#${d.extras.workoutNumber}`, label: "workout" });
  if (d.extras?.duration) stats.push({ value: d.extras.duration, label: "today" });

  const heroSize = L.story ? 230 : 170;
  const blockH = 34 + 20 + heroSize * 0.92 + 30 + 46 + 60 + 40 + gridH + (stats.length ? 70 + 84 * 0.92 + 40 : 0);
  const regionTop = L.top + 100;
  const regionBottom = L.bottom - 40;
  let y = regionTop + Math.max(0, (regionBottom - regionTop - blockH) * 0.5);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, 30);
  setSpacing(ctx, 6);
  ctx.fillStyle = RED;
  ctx.fillText("THE LAST 4 WEEKS", PAD, y + 30);
  setSpacing(ctx, 0);
  y += 34 + 20;
  ctx.fillStyle = INK;
  ctx.font = display(heroSize);
  const num = String(st.trained);
  ctx.fillText(num, PAD - 6, y + heroSize * 0.92);
  const nw = ctx.measureText(num).width;
  ctx.font = display(Math.round(heroSize * 0.42));
  ctx.fillText(st.trained === 1 ? "DAY" : "DAYS", PAD + nw + 18, y + heroSize * 0.92);
  y += heroSize * 0.92 + 30;
  ctx.font = font(800, 40);
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillText("in the gym. Showed up.", PAD, y + 40);
  y += 46 + 60;

  // M T W T F S S
  ctx.font = font(800, 24);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  "MTWTFSS".split("").forEach((ch, i) => ctx.fillText(ch, PAD + i * (cell + gap) + cell / 2, y + 22));
  y += 40;
  st.cells.forEach((c, i) => {
    const cx0 = PAD + (i % 7) * (cell + gap);
    const cy0 = y + Math.floor(i / 7) * (cell + gap);
    ctx.save();
    roundRect(ctx, cx0, cy0, cell, cell, cell * 0.24);
    if (c.state === "trained") {
      ctx.fillStyle = RED;
      ctx.fill();
      if (c.today) {
        ctx.lineWidth = 7;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    } else if (c.state === "rest") {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();
    } else {
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.stroke();
    }
    ctx.restore();
  });
  y += gridH;
  ctx.textAlign = "left";
  if (stats.length) {
    y += 70;
    statRow(ctx, stats, PAD, y, innerW, 84);
  }
  brandFooter(ctx, d, L);
}

/* ------------------------------------------------------------------ */
/*  VS LAST TIME (same workout, the last time they did it)             */
/* ------------------------------------------------------------------ */
function drawProgress(ctx: Ctx, d: ShareCardData, logo: HTMLImageElement | null, L: Layout) {
  const { W, PAD, innerW } = L;
  backdrop(ctx, d, L, 0.62);
  brandRow(ctx, logo, PAD, L.top + 30, W, d.dateLabel, 0.9);
  const p = d.extras?.progress;
  if (!p) return drawFooterStats(ctx, d, logo, L);
  const head = (L.story ? 280 : 210);
  const barH = L.story ? 66 : 56;
  const barBlock = 44 + 16 + barH + 44;
  const blockH = 34 + 24 + head * 0.92 + 30 + 84 + 70 + p.bars.length * barBlock + (p.lift ? 70 : 0);
  const regionTop = L.top + 100;
  const regionBottom = L.bottom - 250;
  let y = regionTop + Math.max(0, (regionBottom - regionTop - blockH) * 0.45);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, 30);
  setSpacing(ctx, 6);
  ctx.fillStyle = RED;
  ctx.fillText("VS LAST TIME", PAD, y + 30);
  setSpacing(ctx, 0);
  y += 34 + 24;
  const g = ctx.createLinearGradient(0, y, 0, y + head);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#ffb4b9");
  ctx.fillStyle = g;
  const hs = fitDisplay(ctx, p.headline.toUpperCase(), innerW, head, 120);
  ctx.fillText(p.headline.toUpperCase(), PAD - 8, y + hs * 0.92);
  y += head * 0.92 + 30;
  ctx.fillStyle = INK;
  const ss = fitDisplay(ctx, p.sub.toUpperCase(), innerW, 76, 44);
  ctx.fillText(p.sub.toUpperCase(), PAD - 2, y + ss * 0.92);
  y += 84 + 70;

  p.bars.forEach((b) => {
    ctx.textAlign = "left";
    ctx.font = font(800, 30);
    ctx.fillStyle = b.today ? INK : MUTED;
    ctx.fillText(b.label.toUpperCase(), PAD, y + 32);
    ctx.textAlign = "right";
    ctx.font = display(48);
    ctx.fillText(b.value.toUpperCase(), W - PAD, y + 40);
    y += 44 + 16;
    roundRect(ctx, PAD, y, innerW, barH, barH / 2);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();
    roundRect(ctx, PAD, y, Math.max(barH, innerW * b.share), barH, barH / 2);
    if (b.today) {
      const bg = ctx.createLinearGradient(PAD, 0, PAD + innerW, 0);
      bg.addColorStop(0, "#ef3340");
      bg.addColorStop(1, "#ff7a59");
      ctx.fillStyle = bg;
    } else ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fill();
    y += barH + 44;
  });
  if (p.lift) {
    ctx.textAlign = "left";
    ctx.font = font(800, 38);
    ctx.fillStyle = INK;
    ctx.fillText(ellipsize(ctx, `↑ ${p.lift}`, innerW), PAD, y + 40);
  }
  drawFooterStats(ctx, d, logo, L);
}

/* ------------------------------------------------------------------ */
/*  STICKER (transparent, sized to content)                            */
/* ------------------------------------------------------------------ */
function drawSticker(canvas: HTMLCanvasElement, d: ShareCardData, logo: HTMLImageElement | null) {
  const W = 1080;
  const PAD = 70;
  const innerW = W - PAD * 2;
  const hasLift = !!d.lift;
  const H = 180 + 150 + 30 + 170 + (hasLift ? 120 : 0) + 70;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 4;
  ctx.textAlign = "center";
  const cx = W / 2;

  // brand
  let y = 90;
  ctx.font = font(900, 30);
  setSpacing(ctx, 8);
  ctx.fillStyle = INK;
  const brand = "JF EFFECT";
  const bw = ctx.measureText(brand).width;
  if (logo) {
    const s = 46;
    ctx.save();
    ctx.shadowBlur = 0;
    roundRect(ctx, cx - (bw + s + 16) / 2, y - 36, s, s, 11);
    ctx.clip();
    ctx.drawImage(logo, cx - (bw + s + 16) / 2, y - 36, s, s);
    ctx.restore();
    ctx.textAlign = "left";
    ctx.fillText(brand, cx - (bw + s + 16) / 2 + s + 16, y);
    ctx.textAlign = "center";
  } else {
    ctx.fillText(brand, cx, y);
  }
  setSpacing(ctx, 0);
  y += 90;

  // title
  const title = d.workoutTitle.toUpperCase();
  const ts = fitDisplay(ctx, title, innerW, 130, 64);
  ctx.fillStyle = INK;
  ctx.fillText(title, cx, y + ts * 0.92);
  y += 150 + 30;

  // stats
  const stats = d.stats.slice(0, 3);
  if (stats.length) {
    const colW = innerW / stats.length;
    stats.forEach((s, i) => {
      const x = PAD + colW * i + colW / 2;
      ctx.fillStyle = INK;
      fitDisplay(ctx, s.value.toUpperCase(), colW - 56, 120, 50);
      ctx.fillText(s.value.toUpperCase(), x, y + 110);
      ctx.font = font(800, 24);
      setSpacing(ctx, 4);
      ctx.fillText(s.label.toUpperCase(), x, y + 156);
      setSpacing(ctx, 0);
    });
  }
  y += 170;

  if (hasLift) {
    const line = `${d.lift!.name.toUpperCase()}  ${d.lift!.detail.toUpperCase()}`;
    ctx.fillStyle = d.isPr ? GOLD_FROM : INK;
    fitDisplay(ctx, line, innerW, 74, 40);
    ctx.fillText(line, cx, y + 80);
  }
}

/* ------------------------------------------------------------------ */
/*  Footers                                                            */
/* ------------------------------------------------------------------ */

/** Stats row + brand line anchored to the bottom safe zone. */
function drawFooterStats(ctx: Ctx, d: ShareCardData, _logo: HTMLImageElement | null, L: Layout) {
  const { PAD, innerW } = L;
  if (d.stats.length) {
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(PAD, L.bottom - 210, innerW, 2);
    statRow(ctx, d.stats, PAD, L.bottom - 170, innerW, 84);
  }
  brandFooter(ctx, d, L);
}

function brandFooter(ctx: Ctx, d: ShareCardData, L: Layout) {
  ctx.save();
  ctx.font = font(700, 24);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.fillText(d.sessionLine ?? (d.athleteName ? `${d.athleteName} · JF Effect` : "JF Effect"), L.PAD, L.bottom + 40);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Output helpers                                                     */
/* ------------------------------------------------------------------ */

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

/** The sticker must keep its transparency; everything else ships as JPEG. */
export function exportType(template: ShareTemplate): "image/png" | "image/jpeg" {
  return template === "sticker" ? "image/png" : "image/jpeg";
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

/**
 * Copy an image to the clipboard (so it can be pasted as a sticker in an
 * Instagram Story). Accepts a promise so Safari keeps the user gesture.
 */
export async function copyImageToClipboard(blob: Blob | Promise<Blob | null>): Promise<boolean> {
  try {
    const CI = (globalThis as unknown as { ClipboardItem?: new (items: Record<string, Blob | Promise<Blob>>) => ClipboardItem }).ClipboardItem;
    if (!CI || !navigator.clipboard?.write) return false;
    const data = Promise.resolve(blob).then((b) => {
      if (!b) throw new Error("no image");
      return b;
    });
    await navigator.clipboard.write([new CI({ "image/png": data })]);
    return true;
  } catch {
    return false;
  }
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

// Kept for callers that size system-font text on cards.
export { fitSystemFont };
