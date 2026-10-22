/**
 * Instagram cards: a post that has no photo of its own (a lesson, Wednesday
 * Wins, the Sunday Recap, a holiday, Saturday's scene, a workout, words),
 * painted as the picture that goes to Instagram. 1080×1350 for the feed
 * (4:5, the tallest it shows), 1080×1920 for a story (words kept clear of
 * Instagram's name row and reply bar).
 *
 * Canvas only, in the share cards' look (workout-share-card.ts): always dark,
 * the brand a small mark, never a banner. A lesson's diagram and Saturday's
 * scene come in as pictures of their own SVG (svgPicture, colours written in,
 * no HTML inside, so the canvas can still be saved on an iPhone).
 */
import { ellipsize, font, loadImage, roundRect } from "@/lib/workout-story-card";
import {
  INK,
  MUTED,
  RED,
  brandRow,
  cardLogo,
  display,
  drawCover,
  ensureDisplayFont,
  fitDisplay,
  paintShareCard,
  setSpacing,
  wrapLines,
  type ShareCardData,
} from "@/lib/workout-share-card";
import {
  MEDALS,
  buildShareCardFields,
  extraHoliday,
  isRecapStats,
  isWinsStats,
  recapSummary,
  storyWords,
  winsChallenge,
  winsChart,
  winsHero,
  winsTiles,
  winsWeekLabel,
  type CommunityPost,
  type RecapStats,
  type WinsStats,
} from "@/lib/community";
import { extraLesson, hookLine } from "@/lib/lessons";
import { IG_SIZES, plainMentions, type IgCard, type IgFormat } from "@/lib/instagram-export";

type Ctx = CanvasRenderingContext2D;
type Picture = CanvasImageSource & { width: number; height: number };

const PAD = 88;
const SUB = "rgba(255,255,255,0.58)";
const BODY = "rgba(255,255,255,0.85)";
const LINE = "rgba(255,255,255,0.16)";
const FAINT = "rgba(255,255,255,0.07)";
const ACCENT = "#ff4d58";

export type IgCardInput = {
  card: IgCard;
  format: IgFormat;
  post: CommunityPost;
  unit: "kg" | "lb";
  /** A lesson's diagram or Saturday's scene (svgPicture). */
  art?: Picture | null;
};

/** Paint the post's card onto `canvas` (sized here). */
export async function paintInstagramCard(canvas: HTMLCanvasElement, input: IgCardInput): Promise<void> {
  await ensureDisplayFont();
  const logo = await cardLogo();
  const { post, format, unit } = input;
  if (input.card === "workout" && post.stats) {
    paintShareCard(canvas, workoutCardData(post, format, unit), logo);
    return;
  }
  const size = IG_SIZES[format];
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const L: Layout = { W: size.w, H: size.h, top: size.safeTop, bottom: size.h - size.safeBottom, format };
  switch (input.card) {
    case "lesson":
      return paintLesson(ctx, L, post, logo, input.art ?? null);
    case "wins":
      if (isWinsStats(post.series_data)) return paintStats(ctx, L, logo, winsWeekLabel(post.series_data.week_of), (c, w) => winsBlock(c, w, post.series_data as WinsStats, unit));
      break;
    case "recap":
      if (isRecapStats(post.series_data)) return paintStats(ctx, L, logo, winsWeekLabel(post.series_data.week_of), (c, w) => recapBlock(c, w, post.series_data as RecapStats, unit));
      break;
    case "holiday": {
      const h = extraHoliday(post.series_extra);
      const photo = h ? await loadImage(h.image) : null;
      if (photo) return paintPicture(ctx, L, logo, photo);
      break;
    }
    case "scene":
      if (input.art) return paintPicture(ctx, L, logo, input.art);
      break;
  }
  paintWords(ctx, L, post, logo);
}

type Layout = { W: number; H: number; top: number; bottom: number; format: IgFormat };

/** The lesson cards' backdrop (the story frame's): near-black with the red glow up in the corner. */
function backdrop(ctx: Ctx, W: number, H: number) {
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W, 0, 0, W, 0, Math.max(W, H) * 0.85);
  g.addColorStop(0, "rgba(239,51,64,0.40)");
  g.addColorStop(0.6, "rgba(239,51,64,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Wrap at the biggest size (from `start` down to `min`) that fits `maxLines`. */
function fitWrap(ctx: Ctx, text: string, maxWidth: number, weight: number, start: number, min: number, maxLines: number): { lines: string[]; size: number } {
  for (let size = start; size >= min; size -= 4) {
    ctx.font = font(weight, size);
    const all = wrapLines(ctx, text, maxWidth, 99);
    if (all.length <= maxLines) return { lines: all, size };
  }
  ctx.font = font(weight, min);
  return { lines: wrapLines(ctx, text, maxWidth, maxLines), size: min };
}

/** Lines of text from `top` (their top edge). Returns the bottom edge. */
function textLines(ctx: Ctx, lines: string[], x: number, top: number, size: number, lh: number, color: string, strike?: string): number {
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = top;
  for (const line of lines) {
    const base = y + size * 0.9;
    ctx.fillText(line, x, base);
    if (strike) {
      ctx.save();
      ctx.strokeStyle = strike;
      ctx.lineWidth = Math.max(3, size * 0.09);
      ctx.beginPath();
      const mid = base - size * 0.32;
      ctx.moveTo(x, mid);
      ctx.lineTo(x + ctx.measureText(line).width, mid);
      ctx.stroke();
      ctx.restore();
    }
    y += size * lh;
  }
  return y;
}

function kicker(ctx: Ctx, text: string, x: number, top: number, color: string, size = 26): number {
  ctx.save();
  ctx.font = font(800, size);
  setSpacing(ctx, size * 0.18);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text.toUpperCase(), x, top + size * 0.82);
  setSpacing(ctx, 0);
  ctx.restore();
  return top + size;
}

/**
 * Something drawn at a fixed width, any height, then set into the card:
 * scaled down only when it wouldn't fit, centred across. Returns the height
 * it took.
 */
function placeBlock(ctx: Ctx, draw: (c: Ctx, width: number) => number, x: number, top: number, width: number, maxH: number, valign: "top" | "middle" = "top"): number {
  const off = document.createElement("canvas");
  off.width = width;
  off.height = 3200;
  const c = off.getContext("2d");
  if (!c) return 0;
  const h = Math.max(1, Math.ceil(draw(c, width)));
  const s = Math.min(1, maxH / h);
  const w = width * s;
  const y = valign === "middle" ? top + (maxH - h * s) / 2 : top;
  ctx.drawImage(off, 0, 0, width, h, x + (width - w) / 2, y, w, h * s);
  return h * s;
}

/* ------------------------------------------------------------------ */
/*  A lesson: its title, then its diagram / the truth / the week       */
/* ------------------------------------------------------------------ */

function paintLesson(ctx: Ctx, L: Layout, post: CommunityPost, logo: HTMLImageElement | null, art: Picture | null) {
  const lesson = extraLesson(post);
  const { W } = L;
  backdrop(ctx, W, L.H);
  const title = lesson?.title ?? hookLine(post.caption);
  const v = lesson?.visual ?? null;
  const hook = hookLine(post.caption);
  // the title and its picture as one block, in the middle; the brand is the footer
  placeBlock(
    ctx,
    (c, w) => {
      const t = fitWrap(c, title, w, 900, 92, 60, 3);
      c.font = font(900, t.size);
      let y = textLines(c, t.lines, 0, 0, t.size, 1.08, INK) + 48;
      if (v?.kind === "truth" && v.belief && v.truth) y += panel(c, w, y, (pc, pw) => truthBlock(pc, pw, v.belief!, v.truth!));
      else if (v?.kind === "reset" && v.items?.length) y += panel(c, w, y, (pc, pw) => resetBlock(pc, pw, v.items!.filter((i) => i.trim()).slice(0, 4)));
      else if (art) y += panel(c, w, y, (pc, pw) => {
        const h = (pw * art.height) / art.width;
        pc.drawImage(art, 0, 0, pw, h);
        return h;
      });
      else if (hook && hook !== title) {
        // no picture: the hook under the title
        const h = fitWrap(c, hook, w, 600, 50, 38, 8);
        c.font = font(600, h.size);
        y = textLines(c, h.lines, 0, y, h.size, 1.25, BODY);
      } else y -= 48;
      return y;
    },
    PAD,
    L.top,
    W - PAD * 2,
    L.bottom - L.top - FOOTER,
    "middle",
  );
  brandRow(ctx, logo, PAD, L.bottom, W, null);
}

/** Room kept under a card's content for the brand row. */
const FOOTER = 96;

/** Content on the lesson card's soft panel (the story frame's). Returns the panel's height. */
function panel(c: Ctx, w: number, top: number, draw: (c: Ctx, w: number) => number): number {
  const inner = 56;
  const off = document.createElement("canvas");
  off.width = w - inner * 2;
  off.height = 3000;
  const oc = off.getContext("2d");
  const h = oc ? Math.ceil(draw(oc, w - inner * 2)) : 0;
  const ph = h + inner * 2;
  c.fillStyle = "rgba(255,255,255,0.045)";
  roundRect(c, 0, top, w, ph, 40);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.10)";
  c.lineWidth = 2;
  roundRect(c, 1, top + 1, w - 2, ph - 2, 39);
  c.stroke();
  c.drawImage(off, 0, 0, w - inner * 2, h, inner, top + inner, w - inner * 2, h);
  return ph;
}

/** The belief struck out in red, then the truth, big. */
function truthBlock(c: Ctx, w: number, belief: string, truth: string): number {
  let y = kicker(c, "The belief", 0, 0, SUB) + 22;
  const b = fitWrap(c, belief, w, 700, 46, 38, 3);
  c.font = font(700, b.size);
  y = textLines(c, b.lines, 0, y, b.size, 1.22, SUB, ACCENT);
  y += 40;
  c.fillStyle = LINE;
  c.fillRect(0, y, w, 2);
  y += 42;
  y = kicker(c, "The truth", 0, y, ACCENT) + 22;
  const t = fitWrap(c, truth, w, 900, 72, 52, 5);
  c.font = font(900, t.size);
  return textLines(c, t.lines, 0, y, t.size, 1.12, "rgba(255,255,255,0.95)") + t.size * 0.06;
}

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

/** The next seven days, then the week's few things, each with a box to tick. */
function resetBlock(c: Ctx, w: number, items: string[]): number {
  kicker(c, "This week", 0, 10, SUB);
  const d = 46;
  const gap = 10;
  let x = w - (d * 7 + gap * 6);
  WEEK.forEach((l, i) => {
    c.fillStyle = i === 0 ? ACCENT : FAINT;
    c.beginPath();
    c.arc(x + d / 2, d / 2, d / 2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = i === 0 ? "#121215" : SUB;
    c.font = font(800, 22);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(l, x + d / 2, d / 2 + 1);
    x += d + gap;
  });
  c.textAlign = "left";
  let y = d + 44;
  const box = 48;
  items.forEach((t, i) => {
    c.font = font(800, 46);
    const lines = wrapLines(c, t, w - box - 30, 2);
    const top = y;
    c.strokeStyle = i === 0 ? ACCENT : LINE;
    c.lineWidth = 5;
    roundRect(c, 2.5, top + 4, box - 5, box - 5, 12);
    c.stroke();
    c.font = font(800, 46);
    y = textLines(c, lines, box + 30, top, 46, 1.18, "rgba(255,255,255,0.95)");
    y = Math.max(y, top + box) + 34;
  });
  return y - 34;
}

/* ------------------------------------------------------------------ */
/*  Wednesday Wins / Sunday Recap: the card from the feed, bigger      */
/* ------------------------------------------------------------------ */

function paintStats(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, label: string, draw: (c: Ctx, w: number) => number) {
  const { W, H } = L;
  ctx.fillStyle = "#0a0a0d";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.95, 0, 0, W * 0.95, 0, W * 1.25);
  g.addColorStop(0, "rgba(239,51,64,0.50)");
  g.addColorStop(0.45, "rgba(127,29,29,0.14)");
  g.addColorStop(0.75, "rgba(10,10,13,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  brandRow(ctx, logo, PAD, L.top + 30, W, label);
  const top = L.top + 84;
  placeBlock(ctx, draw, PAD, top, W - PAD * 2, L.bottom - top, L.format === "story" ? "middle" : "top");
}

/** Up to four numbers, two across, each with what it means. */
function tilesBlock(c: Ctx, w: number, top: number, tiles: { value: string; label: string; sub?: string }[]): number {
  const colW = (w - 40) / 2;
  let y = top;
  for (let i = 0; i < tiles.length; i += 2) {
    let rowBottom = y;
    for (let j = 0; j < 2 && i + j < tiles.length; j++) {
      const t = tiles[i + j];
      const x = j * (colW + 40);
      c.fillStyle = INK;
      const size = fitDisplay(c, t.value.toUpperCase(), colW, 92, 50);
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      c.fillText(t.value.toUpperCase(), x, y + size * 0.92);
      let ty = y + 92 + 16;
      c.font = font(700, 32);
      const label = wrapLines(c, t.label, colW, 2);
      ty = textLines(c, label, x, ty, 32, 1.2, "rgba(255,255,255,0.80)");
      if (t.sub) {
        c.font = font(500, 28);
        ty = textLines(c, wrapLines(c, t.sub, colW, 2), x, ty + 4, 28, 1.2, "rgba(255,255,255,0.50)");
      }
      rowBottom = Math.max(rowBottom, ty);
    }
    y = rowBottom + 44;
  }
  return y - 44;
}

function divider(c: Ctx, w: number, y: number): number {
  c.fillStyle = "rgba(255,255,255,0.10)";
  c.fillRect(0, y, w, 2);
  return y + 40;
}

function pills(c: Ctx, items: { text: string; gold?: boolean }[], top: number, w: number, x0 = 0): number {
  let x = x0;
  let y = top;
  c.font = font(800, 28);
  for (const p of items) {
    const pw = c.measureText(p.text).width + 44;
    if (x > x0 && x + pw > x0 + w) {
      x = x0;
      y += 60;
    }
    if (p.gold) {
      const g = c.createLinearGradient(x, 0, x + pw, 0);
      g.addColorStop(0, "#fde68a");
      g.addColorStop(1, "#f59e0b");
      c.fillStyle = g;
    } else c.fillStyle = "rgba(255,255,255,0.10)";
    roundRect(c, x, y, pw, 50, 25);
    c.fill();
    c.fillStyle = p.gold ? "#2b1700" : "rgba(255,255,255,0.85)";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(p.text, x + 22, y + 26);
    x += pw + 14;
  }
  c.textBaseline = "alphabetic";
  return y + 50;
}

function bars(c: Ctx, w: number, top: number, data: { n: number; share: number; hot: boolean; label?: string }[], height: number): number {
  const gap = data.length > 7 ? 8 : 18;
  const bw = (w - gap * (data.length - 1)) / data.length;
  data.forEach((b, i) => {
    const x = i * (bw + gap);
    const h = Math.max(8, Math.round(b.share * (height - 40)));
    c.fillStyle = b.hot ? RED : "rgba(255,255,255,0.20)";
    roundRect(c, x, top + height - h, bw, h, Math.min(10, bw / 3));
    c.fill();
    if (b.label != null) {
      c.fillStyle = b.hot ? INK : "rgba(255,255,255,0.55)";
      c.font = font(900, 26);
      c.textAlign = "center";
      c.fillText(b.label, x + bw / 2, top + height - h - 10);
    }
  });
  c.textAlign = "left";
  return top + height;
}

function noteBox(c: Ctx, w: number, top: number, title: string | null, text: string): number {
  const inner = 30;
  c.font = font(700, 34);
  const lines = wrapLines(c, text, w - inner * 2, 3);
  const h = inner * 2 + (title ? 40 : 0) + lines.length * 34 * 1.25;
  c.fillStyle = "rgba(255,255,255,0.07)";
  roundRect(c, 0, top, w, h, 24);
  c.fill();
  let y = top + inner;
  if (title) y = kicker(c, title, inner, y, "rgba(255,255,255,0.55)", 22) + 18;
  c.font = font(700, 34);
  textLines(c, lines, inner, y, 34, 1.25, "rgba(255,255,255,0.90)");
  return top + h;
}

function heroAmount(c: Ctx, top: number, amount: string, unit: string): number {
  c.fillStyle = INK;
  c.font = display(170);
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  const base = top + 170 * 0.9;
  c.fillText(amount.toUpperCase(), 0, base);
  const aw = c.measureText(amount.toUpperCase()).width;
  c.fillStyle = "rgba(255,255,255,0.70)";
  c.font = display(84);
  c.fillText(unit.toUpperCase(), aw + 22, base);
  return top + 170;
}

function winsBlock(c: Ctx, w: number, s: WinsStats, unit: "kg" | "lb"): number {
  let y = 0;
  if (s.volume_kg > 0) {
    const hero = winsHero(s, unit);
    y = kicker(c, "Together the crew lifted", 0, y, "rgba(255,255,255,0.60)", 28) + 20;
    y = heroAmount(c, y, hero.amount, hero.unit) + 22;
    if (hero.compare) {
      c.font = font(600, 40);
      y = textLines(c, wrapLines(c, hero.compare, w, 2), 0, y, 40, 1.25, BODY) + 10;
    }
    const tags = [hero.badge ? { text: `🏆 ${hero.badge}`, gold: true } : null, hero.change ? { text: hero.change } : null].filter(Boolean) as { text: string; gold?: boolean }[];
    if (tags.length) y = pills(c, tags, y + 8, w) + 8;
    y = divider(c, w, y + 36);
  }
  y = tilesBlock(c, w, y, winsTiles(s));
  const chart = winsChart(s);
  if (chart.length > 1) {
    y = divider(c, w, y + 40);
    kicker(c, "Workouts each week", 0, y, "rgba(255,255,255,0.60)", 26);
    y += 50;
    y = bars(c, w, y, chart.map((b) => ({ n: b.sessions, share: b.share, hot: b.current, label: b.current ? String(b.sessions) : undefined })), 210);
    c.font = font(600, 24);
    c.fillStyle = "rgba(255,255,255,0.40)";
    c.fillText(chart[0].label, 0, y + 36);
    c.textAlign = "right";
    c.fillText(chart[chart.length - 1].label, w, y + 36);
    c.textAlign = "left";
    y += 48;
  }
  return noteBox(c, w, y + 36, null, winsChallenge(s));
}

/**
 * The Recap for Instagram: the plan as a ring, PRs and the crew's total, the
 * days, and the week's biggest moments. What's only for the crew (how fully
 * workouts were logged, what to work on) stays in the app.
 */
function recapBlock(c: Ctx, w: number, s: RecapStats, unit: "kg" | "lb"): number {
  const sum = recapSummary(s);
  const hero = winsHero(s, unit);
  let y = kicker(c, "Week recap", 0, 0, ACCENT, 30) + 36;
  // the plan, as one ring
  const r = 104;
  const cx = r + 14;
  const cy = y + r + 14;
  c.lineCap = "round";
  c.lineWidth = 26;
  c.strokeStyle = "rgba(255,255,255,0.12)";
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.stroke();
  if (sum.planPct != null) {
    c.strokeStyle = RED;
    c.beginPath();
    c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.max(0, Math.min(100, sum.planPct)) / 100) * Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = INK;
  c.font = display(72);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(sum.planPct != null ? `${sum.planPct}%` : "–", cx, cy + 4);
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  const tx = cx + r + 54;
  const tw = w - tx;
  c.font = font(900, 42);
  let ty = textLines(c, wrapLines(c, sum.planPct != null ? "of planned sessions done" : `${s.sessions} workouts finished`, tw, 2), tx, y + 14, 42, 1.15, INK);
  if (s.active > 0) {
    c.font = font(600, 34);
    ty = textLines(c, wrapLines(c, `${s.hit} of ${s.active} hit their weekly target`, tw, 2), tx, ty + 8, 34, 1.2, BODY);
  }
  ty = pills(c, [{ text: `${s.sessions} workouts` }, ...(sum.vsLast ? [{ text: sum.vsLast }] : [])], ty + 16, tw, tx);
  y = divider(c, w, Math.max(cy + r + 14, ty) + 40);
  y = tilesBlock(c, w, y, [
    { value: s.prs.toLocaleString("en-US"), label: s.prs === 1 ? "personal record" : "personal records", sub: s.pr_people > 1 ? `set by ${s.pr_people} people` : undefined },
    { value: hero.amount, label: `${hero.unit} lifted together`, sub: hero.change ?? undefined },
  ]);
  y = divider(c, w, y + 40);
  kicker(c, "Workouts by day", 0, y, "rgba(255,255,255,0.60)", 26);
  y = bars(c, w, y + 50, sum.days.map((d) => ({ n: d.n, share: d.share, hot: d.best, label: String(d.n) })), 170);
  const bw = (w - 18 * 6) / 7;
  c.font = font(800, 26);
  c.fillStyle = "rgba(255,255,255,0.45)";
  c.textAlign = "center";
  sum.days.forEach((d, i) => c.fillText(d.letter, i * (bw + 18) + bw / 2, y + 40));
  c.textAlign = "left";
  y += 52;
  if (s.top.length) {
    y = divider(c, w, y + 30);
    y = kicker(c, "Biggest moments", 0, y, "rgba(255,255,255,0.60)", 26) + 26;
    s.top.slice(0, 3).forEach((t, i) => {
      c.font = font(400, 44);
      c.fillStyle = INK;
      c.fillText(MEDALS[i] ?? "•", 0, y + 40);
      c.font = font(600, 36);
      y = textLines(c, wrapLines(c, t.text, w - 74, 3), 74, y, 36, 1.25, "rgba(255,255,255,0.90)") + 18;
    });
  }
  return y;
}

/* ------------------------------------------------------------------ */
/*  A picture (a holiday's photo, Saturday's scene)                    */
/* ------------------------------------------------------------------ */

function paintPicture(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, pic: Picture) {
  const { W, H } = L;
  if (L.format === "feed") {
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, pic, W, H);
    return;
  }
  backdrop(ctx, W, H);
  brandRow(ctx, logo, PAD, L.top + 30, W, null);
  // the 4:5 picture, edge to edge, in the middle of the story
  const h = (W * pic.height) / pic.width;
  const y = Math.max(L.top + 80, (H - h) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, W, Math.min(h, L.bottom - y));
  ctx.clip();
  ctx.drawImage(pic, 0, y, W, h);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Words (a coach's note, a quote, anything without a picture)        */
/* ------------------------------------------------------------------ */

/** The headline and what's under it: a quote and who said it, else the caption's first line and the next few. */
export function wordsCardText(post: CommunityPost): { head: string; body: string | null; by: string | null } {
  const quote = post.quote?.trim();
  if (quote) return { head: `“${quote}”`, body: null, by: post.quote_author?.trim() || null };
  const caption = post.caption?.trim() ? plainMentions(post.caption.trim(), post.mentions) : "";
  if (!caption) {
    const w = storyWords(post);
    return { head: w.text, body: null, by: w.by };
  }
  const lines = caption.split("\n").map((l) => l.trim());
  const at = lines.findIndex(Boolean);
  const head = lines[at] ?? caption;
  const body = lines.slice(at + 1).join("\n").trim() || null;
  return { head, body, by: null };
}

function paintWords(ctx: Ctx, L: Layout, post: CommunityPost, logo: HTMLImageElement | null) {
  const { W } = L;
  backdrop(ctx, W, L.H);
  const { head, body, by } = wordsCardText(post);
  placeBlock(
    ctx,
    (c, w) => {
      c.fillStyle = RED;
      roundRect(c, 0, 0, 96, 10, 5);
      c.fill();
      let y = 52;
      const h = fitWrap(c, head, w, 900, 88, 54, 7);
      c.font = font(900, h.size);
      y = textLines(c, h.lines, 0, y, h.size, 1.1, INK);
      if (by) y = kicker(c, by, 0, y + 30, ACCENT, 28) + 8;
      if (body) {
        c.font = font(600, 42);
        const paragraphs = body.split(/\n+/).filter(Boolean);
        const lines: string[] = [];
        for (const p of paragraphs) {
          if (lines.length >= 8) break;
          lines.push(...wrapLines(c, p, w, 8 - lines.length));
        }
        if (paragraphs.join(" ").length > lines.join(" ").length + 4 && lines.length) lines[lines.length - 1] = ellipsize(c, `${lines[lines.length - 1]}…`, w);
        y = textLines(c, lines, 0, y + 40, 42, 1.3, BODY);
      }
      return y + 10;
    },
    PAD,
    L.top,
    W - PAD * 2,
    L.bottom - L.top - FOOTER,
    "middle",
  );
  brandRow(ctx, logo, PAD, L.bottom, W, null);
}

/* ------------------------------------------------------------------ */
/*  A workout: the share card the athlete gets (PR, else the stats)    */
/* ------------------------------------------------------------------ */

export function workoutCardData(post: CommunityPost, format: IgFormat, unit: "kg" | "lb"): ShareCardData {
  const base = buildShareCardFields({
    stats: post.stats!,
    unit,
    athleteName: post.author.name.trim().split(/\s+/)[0] || null,
    dateLabel: new Date(post.stats!.completed_at || post.created_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
  });
  return { ...base, template: base.isPr && base.lift ? "pr" : "stats", format, media: null, lockedIn: null };
}

/* ------------------------------------------------------------------ */
/*  An SVG on the page → a picture a canvas can draw (and still save)  */
/* ------------------------------------------------------------------ */

const SYSTEM_FONT = `system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

/**
 * A standalone copy of an <svg> from the page: its CSS variables written in
 * as colours (`vars`), the page's font named, and a pixel size, so it draws
 * the same outside the page. Pure SVG (no HTML inside), so a canvas that
 * draws it can still be saved on an iPhone.
 */
export function standaloneSvg(svg: SVGSVGElement, vars: Record<string, string>, width: number): string {
  const vb = svg.viewBox?.baseVal;
  const vw = vb && vb.width ? vb.width : svg.clientWidth || 320;
  const vh = vb && vb.height ? vb.height : svg.clientHeight || 320;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(Math.round(width)));
  copy.setAttribute("height", String(Math.round((width * vh) / vw)));
  copy.removeAttribute("class");
  copy.style.fontFamily = SYSTEM_FONT;
  let out = new XMLSerializer().serializeToString(copy);
  out = out.replace(/var\((--[\w-]+)\)/g, (m, name: string) => vars[name] ?? m);
  out = out.replace(/font-family:\s*inherit/g, `font-family: ${SYSTEM_FONT.replace(/"/g, "'")}`);
  return out;
}

/** Load SVG markup as a picture. */
export async function svgPicture(markup: string): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    // drawn from memory once decoded; the URL can go after the card is painted
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** A canvas as a JPEG file (Instagram re-encodes anyway; PNG would be 5× the size). */
export function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File | null> {
  return new Promise((res) =>
    canvas.toBlob(
      (b) => res(b ? new File([b], name, { type: "image/jpeg" }) : null),
      "image/jpeg",
      0.92,
    ),
  );
}
