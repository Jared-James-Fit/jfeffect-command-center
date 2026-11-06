/**
 * Result cards: the picture someone shares after their set. Painted on a
 * canvas from the verified result (never typed), in three shapes (story 9:16,
 * portrait 4:5, square 1:1) and four looks. A card made while the event is
 * still running says so ("LIVE · 7:42 PM"); only confirmed results say FINAL.
 */
import QRCode from "qrcode";
import {
  display,
  ensureDisplayFont,
  fitDisplay,
  setSpacing,
  drawCover,
  cardLogo,
} from "@/lib/workout-share-card";
import { ellipsize, fitFont as fitSystemFont, font, roundRect } from "@/lib/workout-story-card";

export type CardFormat = "story" | "portrait" | "square";
export type CardStyle = "championship" | "scoreboard" | "light" | "spotlight";
export type CardKind = "winner" | "podium" | "result" | "live" | "invite";

export const CARD_SIZES: Record<CardFormat, { w: number; h: number; label: string; hint: string }> =
  {
    story: { w: 1080, h: 1920, label: "Story", hint: "9:16" },
    portrait: { w: 1080, h: 1350, label: "Post", hint: "4:5" },
    square: { w: 1080, h: 1080, label: "Square", hint: "1:1" },
  };

export const STYLE_LABEL: Record<CardStyle, string> = {
  championship: "Championship",
  scoreboard: "Scoreboard",
  light: "Light",
  spotlight: "Photo",
};

export type ResultCardData = {
  kind: CardKind;
  style: CardStyle;
  format: CardFormat;
  eventTitle: string;
  /** e.g. "Barbell bench press · 225 lb" */
  eventLine: string | null;
  athlete: string;
  photo: CanvasImageSource | null;
  scoreBig: string | null;
  scoreUnit: string | null;
  rank: number | null;
  tied: boolean;
  of: number;
  division: string | null;
  /** "FINAL RESULT", "LIVE · 7:42 PM", "NOV 15 · WINNIPEG" */
  statusLine: string;
  cta: string;
  /** Printed link, "jfeffect.com/challenges/winnipeg-225" */
  link: string;
  /** Encoded in the QR (the full URL), or null for no QR */
  qr: string | null;
  sponsor: string | null;
};

type Ctx = CanvasRenderingContext2D;

const RED = "#ef3340";
const GOLD = "#f5b301";
const SILVER = "#c9ccd1";
const BRONZE = "#d08a4b";

type Palette = {
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  panel: string;
};

function palette(style: CardStyle): Palette {
  if (style === "light")
    return {
      bg: "#f6f5f1",
      ink: "#111113",
      muted: "rgba(17,17,19,0.62)",
      faint: "rgba(17,17,19,0.38)",
      line: "rgba(17,17,19,0.14)",
      accent: RED,
      panel: "#ffffff",
    };
  if (style === "scoreboard")
    return {
      bg: "#08080a",
      ink: "#ffffff",
      muted: "rgba(255,255,255,0.62)",
      faint: "rgba(255,255,255,0.36)",
      line: "rgba(255,255,255,0.16)",
      accent: RED,
      panel: "#141417",
    };
  return {
    bg: "#151517",
    ink: "#ffffff",
    muted: "rgba(255,255,255,0.64)",
    faint: "rgba(255,255,255,0.36)",
    line: "rgba(255,255,255,0.14)",
    accent: RED,
    panel: "#1f1f23",
  };
}

function medal(rank: number | null): string | null {
  if (rank === 1) return GOLD;
  if (rank === 2) return SILVER;
  if (rank === 3) return BRONZE;
  return null;
}

/** "Winnipeg 225 Bench Press Challenge" → ["WINNIPEG 225", "BENCH PRESS CHALLENGE"]. */
export function splitTitle(title: string): [string, string | null] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return [title.toUpperCase(), null];
  const num = words.findIndex((w) => /\d/.test(w));
  if (num >= 0 && num < words.length - 1) {
    return [
      words
        .slice(0, num + 1)
        .join(" ")
        .toUpperCase(),
      words
        .slice(num + 1)
        .join(" ")
        .toUpperCase(),
    ];
  }
  // otherwise the most even split by letters
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    if (Math.abs(a - b) < bestDiff) {
      bestDiff = Math.abs(a - b);
      best = i;
    }
  }
  return [words.slice(0, best).join(" ").toUpperCase(), words.slice(best).join(" ").toUpperCase()];
}

/** The rank line: "1ST PLACE", "RANKED #2 OF 47", "T-3 OF 12". */
export function rankLine(d: Pick<ResultCardData, "kind" | "rank" | "tied" | "of">): string | null {
  if (!d.rank) return null;
  const ord = ordinalUpper(d.rank);
  if (d.kind === "winner" || d.kind === "podium")
    return `${d.tied ? "T-" : ""}${ord} PLACE${d.of > 1 ? ` OF ${d.of}` : ""}`;
  if (d.kind === "live") return `${d.tied ? "TIED " : ""}#${d.rank} OF ${d.of} RIGHT NOW`;
  return `${d.tied ? "T-" : ""}${ord} OF ${d.of}`;
}

function ordinalUpper(n: number): string {
  const s = ["TH", "ST", "ND", "RD"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Load a remote picture for the canvas without tainting it. */
export function loadCardImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawQr(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  ink = "#0a0a0a",
  paper = "#ffffff",
) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const pad = Math.round(size * 0.08);
  ctx.save();
  ctx.fillStyle = paper;
  roundRect(ctx, x, y, size, size, Math.round(size * 0.08));
  ctx.fill();
  const cell = (size - pad * 2) / n;
  ctx.fillStyle = ink;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.data[r * n + c]) {
        ctx.fillRect(
          Math.floor(x + pad + c * cell),
          Math.floor(y + pad + r * cell),
          Math.ceil(cell),
          Math.ceil(cell),
        );
      }
    }
  }
  ctx.restore();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** A round athlete photo, or a monogram on the panel colour. */
function avatar(
  ctx: Ctx,
  d: ResultCardData,
  p: Palette,
  cx: number,
  cy: number,
  r: number,
  ringColor: string | null,
) {
  ctx.save();
  if (ringColor) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
    ctx.fillStyle = ringColor;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = p.panel;
  ctx.fill();
  if (d.photo) {
    ctx.clip();
    const anyImg = d.photo as HTMLImageElement;
    const w = anyImg.naturalWidth || (d.photo as ImageBitmap).width || 1;
    const h = anyImg.naturalHeight || (d.photo as ImageBitmap).height || 1;
    const s = Math.max((r * 2) / w, (r * 2) / h);
    ctx.drawImage(d.photo, cx - (w * s) / 2, cy - (h * s) / 2, w * s, h * s);
  } else {
    ctx.fillStyle = p.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = display(Math.round(r * 0.9));
    ctx.fillText(initials(d.athlete), cx, cy + r * 0.04);
  }
  ctx.restore();
}

function statusChip(
  ctx: Ctx,
  text: string,
  rightX: number,
  baseline: number,
  live: boolean,
  p: Palette,
  light: boolean,
) {
  ctx.save();
  ctx.font = font(800, 26);
  setSpacing(ctx, 3);
  const w = ctx.measureText(text).width + (live ? 66 : 44);
  const h = 54;
  const x = rightX - w;
  const y = baseline - 38;
  ctx.fillStyle = live ? RED : light ? "rgba(17,17,19,0.08)" : "rgba(255,255,255,0.12)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (live) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x + 30, y + h / 2, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = live ? "#ffffff" : p.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + (live ? 48 : 22), y + h / 2 + 1);
  setSpacing(ctx, 0);
  ctx.restore();
}

/** Paint a result card. Fonts and pictures must already be loaded. */
export function paintResultCard(
  canvas: HTMLCanvasElement,
  d: ResultCardData,
  logo: HTMLImageElement | null,
) {
  const { w: W, h: H } = CARD_SIZES[d.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const p = palette(d.style === "spotlight" && !d.photo ? "championship" : d.style);
  const light = d.style === "light";
  const spotlight = d.style === "spotlight" && !!d.photo;
  const story = d.format === "story";
  const square = d.format === "square";
  const PAD = 84;
  // keep clear of Instagram's own top / bottom bars on a story
  const top = story ? 210 : PAD;
  const bottom = story ? H - 250 : H - PAD;
  const innerW = W - PAD * 2;
  const medalColor = d.kind === "winner" || d.kind === "podium" ? medal(d.rank) : null;
  const scoreColor = d.kind === "winner" ? GOLD : p.ink;

  // ── backdrop ──
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  if (spotlight) {
    drawCover(ctx, d.photo as CanvasImageSource & { width?: number; height?: number }, W, H);
    // a scrim so the words read over any photo
    const g = ctx.createLinearGradient(0, H * 0.25, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.45, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const t = ctx.createLinearGradient(0, 0, 0, 360);
    t.addColorStop(0, "rgba(0,0,0,0.55)");
    t.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = t;
    ctx.fillRect(0, 0, W, 360);
  }
  if (d.style === "scoreboard") {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (let y = 0; y < H; y += 54) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }
  // a single accent bar, top left: the brand mark of every card
  ctx.fillStyle = medalColor ?? p.accent;
  ctx.fillRect(PAD, top - 34, 120, 10);

  // ── brand row + status ──
  ctx.save();
  let bx = PAD;
  const brandBase = top + 30;
  if (logo) {
    ctx.save();
    roundRect(ctx, bx, brandBase - 38, 46, 46, 11);
    ctx.clip();
    ctx.drawImage(logo, bx, brandBase - 38, 46, 46);
    ctx.restore();
    bx += 62;
  }
  ctx.fillStyle = spotlight ? "#ffffff" : p.ink;
  ctx.font = font(900, 28);
  setSpacing(ctx, 5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("JF EFFECT", bx, brandBase);
  setSpacing(ctx, 0);
  ctx.restore();
  const live = d.kind === "live";
  statusChip(
    ctx,
    d.statusLine.toUpperCase().slice(0, 30),
    W - PAD,
    brandBase,
    live,
    spotlight ? palette("championship") : p,
    light && !spotlight,
  );

  // ── event title ──
  let y = top + (square ? 120 : 150);
  const [t1, t2] = splitTitle(d.eventTitle);
  ctx.fillStyle = spotlight ? "#ffffff" : p.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const titleSize = fitDisplay(ctx, t1, innerW, square ? 120 : story ? 168 : 140, 64);
  ctx.fillText(t1, PAD, y + titleSize * 0.82);
  y += titleSize * 0.92;
  if (t2) {
    ctx.fillStyle = spotlight ? "rgba(255,255,255,0.75)" : p.muted;
    const sub = fitDisplay(ctx, t2, innerW, Math.round(titleSize * 0.5), 34);
    ctx.fillText(t2, PAD, y + sub * 0.95);
    y += sub * 1.1;
  }
  if (d.eventLine) {
    ctx.fillStyle = spotlight ? "rgba(255,255,255,0.7)" : p.faint;
    ctx.font = font(700, square ? 28 : 32);
    ctx.fillText(ellipsize(ctx, d.eventLine, innerW), PAD, y + 44);
    y += 56;
  }

  // ── laid out bottom-up in fixed slots, so nothing can overlap ──
  //    footer (link + QR) · call to action · rank line · score · athlete
  const qrSize = d.qr && !square ? (story ? 196 : 164) : 0;
  const footerH = square ? 120 : story ? 236 : 200;
  const footerTop = bottom - footerH;
  const ctaSize = d.cta && !square ? (story ? 84 : 66) : 0;
  const ctaBase = footerTop - 30;
  const rankSize = square ? 36 : 44;
  const rankBase = ctaSize ? ctaBase - ctaSize - 26 : footerTop - 34;
  const scoreBase = rankBase - rankSize - 22;

  const avR = spotlight ? 0 : story ? 92 : square ? 58 : 72;
  const nameSize = story ? 84 : square ? 60 : 70;
  const athleteH = Math.max(avR * 2, nameSize + (d.division ? 44 : 0));
  // the score takes whatever room is left between the title and the rank line
  const room = scoreBase - (y + 36) - athleteH - 28;
  const scoreSize = Math.max(
    110,
    Math.min(story ? 330 : square ? 200 : 240, Math.floor(room / 0.92)),
  );
  const scoreTop = scoreBase - scoreSize * 0.92;
  // spare room goes between the title and the athlete, not between athlete and score
  const athleteTop = Math.max(y + 36, scoreTop - 28 - athleteH);

  const nameX = avR ? PAD + avR * 2 + 36 : PAD;
  if (avR) avatar(ctx, d, p, PAD + avR, athleteTop + athleteH / 2, avR, medalColor);
  ctx.fillStyle = spotlight ? "#ffffff" : p.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const nameText = d.athlete.toUpperCase();
  const nameUsed = fitDisplay(ctx, nameText, W - PAD - nameX, nameSize, 40);
  const mid = athleteTop + athleteH / 2;
  ctx.fillText(nameText, nameX, mid + nameUsed * 0.34 - (d.division ? 20 : 0));
  if (d.division) {
    ctx.fillStyle = spotlight ? "rgba(255,255,255,0.72)" : p.muted;
    ctx.font = font(800, 26);
    setSpacing(ctx, 3);
    ctx.fillText(
      ellipsize(ctx, d.division.toUpperCase(), W - PAD - nameX),
      nameX,
      mid + nameUsed * 0.34 + 26,
    );
    setSpacing(ctx, 0);
  }

  // score (or, before a score, the invite line) sitting on its baseline
  if (d.scoreBig) {
    ctx.fillStyle = scoreColor;
    const big = d.scoreBig;
    const used = fitDisplay(ctx, big, innerW * 0.66, scoreSize, 100);
    const bw = ctx.measureText(big).width;
    ctx.fillText(big, PAD - 6, scoreBase);
    if (d.scoreUnit) {
      ctx.fillStyle = spotlight ? "rgba(255,255,255,0.8)" : p.muted;
      const u = d.scoreUnit.toUpperCase();
      fitDisplay(ctx, u, Math.max(140, innerW - bw - 24), Math.round(used * 0.3), 36);
      ctx.fillText(u, PAD + bw + 16, scoreBase);
    }
  } else {
    ctx.fillStyle = spotlight ? "#ffffff" : p.ink;
    fitDisplay(ctx, "I'M IN.", innerW, scoreSize, 90);
    ctx.fillText("I'M IN.", PAD - 4, scoreBase);
  }
  const rl = d.scoreBig ? rankLine(d) : null;
  if (rl) {
    ctx.fillStyle = medalColor ?? (spotlight ? "#ffffff" : p.ink);
    ctx.font = font(900, rankSize);
    setSpacing(ctx, 4);
    ctx.fillText(ellipsize(ctx, rl, innerW), PAD, rankBase);
    setSpacing(ctx, 0);
  }
  if (ctaSize) {
    ctx.fillStyle = p.accent;
    const cta = d.cta.toUpperCase();
    fitDisplay(ctx, cta, innerW, ctaSize, 40);
    ctx.fillText(cta, PAD, ctaBase);
  }

  // ── footer: where to look (+ QR) and the sponsor ──
  ctx.strokeStyle = spotlight ? "rgba(255,255,255,0.25)" : p.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, footerTop);
  ctx.lineTo(W - PAD, footerTop);
  ctx.stroke();
  const textW = (qrSize ? W - PAD - qrSize - 32 : W - PAD) - PAD;
  ctx.textAlign = "left";
  ctx.fillStyle = spotlight ? "rgba(255,255,255,0.7)" : p.muted;
  ctx.font = font(700, square ? 24 : 28);
  const lead =
    d.kind === "invite"
      ? "Sign up or watch live"
      : d.kind === "live"
        ? "Watch it live"
        : "Full results";
  ctx.fillText(lead + (qrSize ? " · scan" : ""), PAD, footerTop + (square ? 46 : 56));
  ctx.fillStyle = spotlight ? "#ffffff" : p.ink;
  // the printed link is the challenge page (short); the QR carries the full result link
  const linkSize = fitSystemFont(ctx, d.link, textW, 800, square ? 32 : 36, 20);
  ctx.font = font(800, linkSize);
  ctx.fillText(ellipsize(ctx, d.link, textW), PAD, footerTop + (square ? 88 : 104));
  if (d.sponsor && !square) {
    ctx.fillStyle = spotlight ? "rgba(255,255,255,0.6)" : p.faint;
    ctx.font = font(700, 26);
    ctx.fillText(ellipsize(ctx, `Presented with ${d.sponsor}`, textW), PAD, footerTop + 150);
  }
  if (qrSize && d.qr) drawQr(ctx, d.qr, W - PAD - qrSize, footerTop + 22, qrSize);
}

export async function renderResultCard(d: ResultCardData): Promise<Blob | null> {
  await ensureDisplayFont();
  const logo = await cardLogo();
  const canvas = document.createElement("canvas");
  paintResultCard(canvas, d, logo);
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

/** Paint into an on-screen canvas (the preview), after fonts and the logo load. */
export async function previewResultCard(
  canvas: HTMLCanvasElement,
  d: ResultCardData,
): Promise<void> {
  await ensureDisplayFont();
  const logo = await cardLogo();
  paintResultCard(canvas, d, logo);
}
