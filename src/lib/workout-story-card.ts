/**
 * Instagram-Story share card for a finished workout (1080×1920, 9:16).
 *
 * Everything important sits inside the Story safe zone (y ≈ 230–1650) so the
 * Instagram header and reply bar never cover it. Pure canvas drawing: no DOM,
 * no network except the brand logo.
 */

export type StoryRecord = { label: string; tier: "atpr" | "program_pr" | "block_pr"; title: string; detail: string };

export type StoryCardData = {
  athleteName: string | null;
  headline: string;
  score: number;
  workoutTitle: string | null;
  dateLabel: string | null;
  records: StoryRecord[];
  stats: Array<{ label: string; value: string }>;
  leaguePoints: number | null;
  levelPoints: number | null;
};

export const STORY_W = 1080;
export const STORY_H = 1920;
export const SAFE_TOP = 230;
export const SAFE_BOTTOM = 1650;

const FONT = `system-ui, -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
const RED = "#ef3340";
const TIER: Record<StoryRecord["tier"], { from: string; to: string; text: string }> = {
  atpr: { from: "#fde68a", to: "#f59e0b", text: "#2b1700" },
  program_pr: { from: "#c4b5fd", to: "#7c3aed", text: "#ffffff" },
  block_pr: { from: "#7dd3fc", to: "#0284c7", text: "#ffffff" },
};

type Ctx = CanvasRenderingContext2D;

function font(weight: number, size: number) {
  return `${weight} ${size}px ${FONT}`;
}

/** Shrink text until it fits `maxWidth`. Returns the size used. */
export function fitFont(ctx: Ctx, text: string, maxWidth: number, weight: number, start: number, min = 24) {
  let size = start;
  ctx.font = font(weight, size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = font(weight, size);
  }
  return size;
}

/** Ellipsize to fit `maxWidth` at the current font. */
export function ellipsize(ctx: Ctx, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

export async function drawWorkoutStory(canvas: HTMLCanvasElement, d: StoryCardData) {
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cx = STORY_W / 2;

  // ── Background: near-black, red glow top, warm glow bottom, fine grain lines
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  let g = ctx.createRadialGradient(cx, 120, 40, cx, 120, 1100);
  g.addColorStop(0, "rgba(239,51,64,0.55)");
  g.addColorStop(0.45, "rgba(127,29,29,0.22)");
  g.addColorStop(1, "rgba(7,7,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  g = ctx.createRadialGradient(cx, STORY_H + 100, 40, cx, STORY_H + 100, 900);
  g.addColorStop(0, "rgba(245,158,11,0.18)");
  g.addColorStop(1, "rgba(7,7,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  for (let x = -STORY_H; x < STORY_W; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + STORY_H, STORY_H);
    ctx.stroke();
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ── Brand row
  let y = SAFE_TOP + 20;
  const logo = await loadImage("/logo.png");
  const brand = "JF EFFECT";
  ctx.font = font(900, 34);
  const brandW = ctx.measureText(brand).width;
  const logoS = 56;
  const rowW = (logo ? logoS + 18 : 0) + brandW;
  let bx = cx - rowW / 2;
  if (logo) {
    ctx.save();
    roundRect(ctx, bx, y - 42, logoS, logoS, 14);
    ctx.clip();
    ctx.drawImage(logo, bx, y - 42, logoS, logoS);
    ctx.restore();
    bx += logoS + 18;
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(brand, bx, y);
  ctx.textAlign = "center";

  // ── Athlete + headline
  y += 92;
  ctx.fillStyle = RED;
  ctx.font = font(900, 30);
  ctx.fillText("W O R K O U T   C O M P L E T E", cx, y);
  if (d.athleteName) {
    y += 92;
    const name = d.athleteName.toUpperCase();
    fitFont(ctx, name, 900, 900, 84, 44);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, cx, y);
  }

  // ── Score ring
  y += 56;
  const ringR = 150;
  const ringY = y + ringR;
  ctx.lineWidth = 26;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.arc(cx, ringY, ringR, 0, Math.PI * 2);
  ctx.stroke();
  const pct = Math.max(0, Math.min(100, d.score)) / 100;
  if (pct > 0) {
    const rg = ctx.createLinearGradient(cx - ringR, ringY - ringR, cx + ringR, ringY + ringR);
    rg.addColorStop(0, "#ff6b6b");
    rg.addColorStop(1, RED);
    ctx.strokeStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = font(900, 124);
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(d.score)), cx, ringY - 14);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#a1a1aa";
  ctx.font = font(800, 22);
  ctx.fillText("WORKOUT SCORE", cx, ringY + 74);
  y = ringY + ringR + 82;

  // ── Headline pill
  ctx.font = font(900, 54);
  const hw = Math.min(940, ctx.measureText(d.headline).width + 90);
  const pg = ctx.createLinearGradient(cx - hw / 2, 0, cx + hw / 2, 0);
  const goldHeadline = /ATPR/.test(d.headline);
  pg.addColorStop(0, goldHeadline ? "#fde68a" : "#ff6b6b");
  pg.addColorStop(1, goldHeadline ? "#f59e0b" : RED);
  ctx.fillStyle = pg;
  roundRect(ctx, cx - hw / 2, y - 62, hw, 88, 44);
  ctx.fill();
  ctx.fillStyle = goldHeadline ? "#2b1700" : "#ffffff";
  fitFont(ctx, d.headline, hw - 70, 900, 54, 32);
  ctx.textBaseline = "middle";
  ctx.fillText(d.headline, cx, y - 18);
  ctx.textBaseline = "alphabetic";

  // ── Workout title · date (one line)
  y += 70;
  const title = d.workoutTitle ?? "Workout";
  const dateTxt = d.dateLabel ? `  ·  ${d.dateLabel}` : "";
  ctx.font = font(700, 30);
  const dateW = dateTxt ? ctx.measureText(dateTxt).width : 0;
  fitFont(ctx, title, 940 - dateW, 800, 34, 26);
  const t1 = ellipsize(ctx, title, 940 - dateW);
  const t1w = ctx.measureText(t1).width;
  ctx.textAlign = "left";
  const tx = cx - (t1w + dateW) / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(t1, tx, y);
  if (dateTxt) {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = font(700, 30);
    ctx.fillText(dateTxt, tx + t1w, y);
  }
  ctx.textAlign = "center";

  // Bottom block is anchored to the safe zone: footer, points, stats.
  const footerY = SAFE_BOTTOM - 8;
  const hasPoints = (d.leaguePoints ?? 0) > 0 || (d.levelPoints ?? 0) > 0;
  const pointsY = footerY - 70;
  const statsH = 128;
  const statsTop = (hasPoints ? pointsY - 62 : footerY - 56) - statsH;
  const recordsBottom = statsTop - 34;

  // ── Records card
  const rowH = 90;
  y += 38;
  const room = recordsBottom - y - 74 - 10;
  let fit = Math.max(0, Math.floor(room / rowH));
  if (fit < d.records.length) fit = Math.max(0, Math.floor((room - 38) / rowH));
  const recs = d.records.slice(0, Math.min(5, fit));
  if (recs.length) {
    const cardX = 70;
    const cardW = STORY_W - 140;
    const extra = d.records.length - recs.length;
    const cardH = 74 + recs.length * rowH + (extra > 0 ? 38 : 0) + 10;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, cardX, y, cardW, cardH, 36);
    ctx.fill();
    ctx.strokeStyle = "rgba(245,158,11,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#a1a1aa";
    ctx.font = font(900, 24);
    ctx.fillText("N E W   R E C O R D S", cardX + 40, y + 52);
    let ry = y + 74;
    for (const r of recs) {
      const t = TIER[r.tier];
      // Pill on the right
      ctx.font = font(900, 24);
      const pillW = Math.min(360, ctx.measureText(r.label).width + 44);
      const px = cardX + cardW - 36 - pillW;
      const pgr = ctx.createLinearGradient(px, 0, px + pillW, 0);
      pgr.addColorStop(0, t.from);
      pgr.addColorStop(1, t.to);
      ctx.fillStyle = pgr;
      roundRect(ctx, px, ry + 20, pillW, 46, 23);
      ctx.fill();
      ctx.fillStyle = t.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ellipsize(ctx, r.label, pillW - 30), px + pillW / 2, ry + 44);
      ctx.textBaseline = "alphabetic";
      // Lift on the left
      ctx.textAlign = "left";
      const textW = px - (cardX + 40) - 24;
      ctx.fillStyle = "#ffffff";
      ctx.font = font(800, 32);
      ctx.fillText(ellipsize(ctx, r.title, textW), cardX + 40, ry + 44);
      ctx.fillStyle = "#a1a1aa";
      ctx.font = font(700, 26);
      ctx.fillText(ellipsize(ctx, r.detail, textW), cardX + 40, ry + 78);
      ry += rowH;
    }
    if (extra > 0) {
      ctx.fillStyle = "#a1a1aa";
      ctx.font = font(700, 24);
      ctx.fillText(`+${extra} more record${extra === 1 ? "" : "s"}`, cardX + 40, ry + 22);
    }
    ctx.textAlign = "center";
    y += cardH;
  }

  // ── Stats tiles (anchored)
  const stats = d.stats.slice(0, 3);
  if (stats.length) {
    const gap = 20;
    const tileW = (STORY_W - 140 - gap * (stats.length - 1)) / stats.length;
    stats.forEach((s, i) => {
      const x = 70 + i * (tileW + gap);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(ctx, x, statsTop, tileW, statsH, 30);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      fitFont(ctx, s.value, tileW - 30, 900, 46, 26);
      ctx.fillText(s.value, x + tileW / 2, statsTop + 66);
      ctx.fillStyle = "#a1a1aa";
      ctx.font = font(800, 22);
      ctx.fillText(s.label.toUpperCase(), x + tileW / 2, statsTop + 104);
    });
  }

  // ── Points strip (anchored)
  if (hasPoints) {
    const parts = [
      d.leaguePoints && d.leaguePoints > 0 ? `+${d.leaguePoints} LEAGUE PTS` : null,
      d.levelPoints && d.levelPoints > 0 ? `+${d.levelPoints} LEVEL XP` : null,
    ].filter(Boolean) as string[];
    const txt = parts.join("    ");
    ctx.font = font(900, 32);
    const w = ctx.measureText(txt).width + 70;
    ctx.fillStyle = "rgba(251,191,36,0.12)";
    roundRect(ctx, cx - w / 2, pointsY - 46, w, 66, 33);
    ctx.fill();
    ctx.strokeStyle = "rgba(251,191,36,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, cx, pointsY - 13);
    ctx.textBaseline = "alphabetic";
  }

  // ── Footer (just above the reply bar)
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = font(800, 24);
  ctx.fillText("T R A I N E D   W I T H   J F   E F F E C T", cx, footerY);
}
