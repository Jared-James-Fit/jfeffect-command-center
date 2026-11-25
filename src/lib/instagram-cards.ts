/**
 * Instagram cards: a post that has no photo of its own (a lesson, Wednesday
 * Wins, the Sunday Recap, Tuesday's numbers, Thursday's feature, a birthday,
 * a holiday, Saturday's scene, a workout, words), painted as the picture
 * that goes to Instagram. 1080×1350 for the feed (4:5), 1080×1920 for a story
 * (words kept clear of Instagram's name row and reply bar). The 4:5 one is
 * also the automated post's own picture in the app (post-art.ts) and its
 * profile-grid tile.
 *
 * Every card is in the automated posts' design system (post-design.ts,
 * Nov 25 2026): black, off-white, graphite and the JF Effect red, the line
 * read in the grid in the condensed display face in capitals, everything
 * else in the phone's heavy sans, no serif, no italics, no gradients. Wins
 * and the Recap are carousels (stats-slides.ts): one big number on the
 * cover, what supports it on the slides after. Each card notes what it drew
 * (post-design-paint.ts' report) so its readability is checked.
 *
 * Canvas only: a lesson's diagram and Saturday's scene come in as pictures
 * of their own SVG (svgPicture, colours written in, no HTML inside, so the
 * canvas can still be saved on an iPhone).
 */
import { loadImage, roundRect } from "@/lib/workout-story-card";
import { cardLogo, drawCover, ensureDisplayFont, paintShareCard, type ShareCardData } from "@/lib/workout-share-card";
import {
  buildShareCardFields,
  compareBars,
  extraBirthday,
  extraFeature,
  extraHoliday,
  extraObservation,
  extraTipKind,
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
  type CrewCompare,
  type RecapStats,
  type WinsStats,
} from "@/lib/community";
import { LESSON_TRACK, extraLesson, hookLine } from "@/lib/lessons";
import { IG_SIZES, plainMentions, type IgCard, type IgFormat } from "@/lib/instagram-export";
import { deckOf } from "@/lib/post-decks";
import { SWIPE_X, ensureDeckFonts, paintDeckSlide } from "@/lib/deck-cards";
import { COLOR, FOOT, HEAD, PAD_X, SURFACES, TYPE, seedHash, type Surface } from "@/lib/post-design";
import { recapSlides, winsSlides } from "@/lib/stats-slides";
import {
  beginReport,
  brand,
  columns,
  drawRuns,
  endReport,
  fitRuns,
  hairline,
  hbar,
  heroNumber,
  hookFace,
  kicker,
  marker,
  pill,
  place,
  rule,
  sans,
  surfaceFill,
  swipeCue,
  text,
  type Ctx,
  type Picture,
} from "@/lib/post-design-paint";

export type IgCardInput = {
  card: IgCard;
  format: IgFormat;
  post: CommunityPost;
  unit: "kg" | "lb";
  /** A lesson's diagram or Saturday's scene (svgPicture). */
  art?: Picture | null;
  /** A carousel's slide (0 = its cover): a deck, Wins, the Recap. */
  slide?: number;
};

type Layout = { W: number; H: number; top: number; bottom: number; format: IgFormat };

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
  const slide = input.slide ?? 0;
  beginReport(input.card, slide);
  try {
    await paintCard(ctx, L, input, logo, slide);
  } finally {
    endReport();
  }
}

async function paintCard(ctx: Ctx, L: Layout, input: IgCardInput, logo: HTMLImageElement | null, slide: number): Promise<void> {
  const { post } = input;
  switch (input.card) {
    case "deck": {
      const deck = deckOf(post);
      if (deck) {
        await ensureDeckFonts();
        paintDeckSlide(ctx, L, deck, slide, logo, input.art ?? null);
        return;
      }
      break;
    }
    case "lesson":
      return paintLesson(ctx, L, post, logo, input.art ?? null);
    case "wins":
      if (isWinsStats(post.series_data)) return paintWins(ctx, L, logo, post.series_data, slide);
      break;
    case "recap":
      if (isRecapStats(post.series_data)) return paintRecap(ctx, L, logo, post.series_data, slide);
      break;
    case "compare": {
      const obs = extraObservation(post.series_extra);
      if (obs) return paintCompare(ctx, L, logo, post, obs);
      break;
    }
    case "feature": {
      const f = extraFeature(post.series_extra);
      if (f) return paintFeature(ctx, L, logo, post, f);
      break;
    }
    case "birthday": {
      const b = extraBirthday(post);
      if (b?.name) return paintBirthday(ctx, L, logo, post, b.name);
      break;
    }
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

const W_OF = (L: Layout) => L.W - PAD_X * 2;
const roomTop = (L: Layout) => L.top + HEAD;
const roomH = (L: Layout) => L.bottom - FOOT - roomTop(L);

/** The grid line: the display face in capitals. */
const hook = (c: Ctx, words: string, y: number, w: number, s: Surface, start: number = TYPE.hook.start, lines: number = TYPE.hook.maxLines, min: number = TYPE.hook.min) =>
  text(c, words, 0, y, w, { f: hookFace, start, min, lines, lh: TYPE.hook.lh, color: s.ink, accent: s.accent, role: "hook", bg: s.bg, caps: true });

const title = (c: Ctx, words: string, y: number, w: number, s: Surface, start: number = TYPE.title.start, lines = 4, color = s.ink) =>
  text(c, words, 0, y, w, { f: sans(800), start, min: TYPE.title.min, lines, lh: TYPE.title.lh, color, accent: s.accent, role: "title", bg: s.bg, tracking: -0.012 });

const body = (c: Ctx, words: string, y: number, w: number, s: Surface, lines = 5, start: number = TYPE.body.start) =>
  text(c, words, 0, y, w, { f: sans(500), start, min: TYPE.body.min, lines, lh: TYPE.body.lh, color: s.sub, accent: s.ink, role: "body", bg: s.bg });

/** A card's head: its kicker (with the accent bar), and on the right a quiet date. */
/** A card's head: its kicker (with the accent bar), and under it a quiet date. Never top right: the app's slide counter sits there. */
function head(ctx: Ctx, L: Layout, s: Surface, words: string | null, sub?: string | null) {
  if (words) kicker(ctx, words, PAD_X, L.top + 18, s, { size: 34, bar: true, maxWidth: W_OF(L) - 120 });
  if (sub) kicker(ctx, sub, PAD_X + (words ? 58 : 0), L.top + 68, s, { size: 30, color: s.sub, maxWidth: W_OF(L) - 120 });
}

/* ------------------------------------------------------------------ */
/*  A lesson (one painted before decks): its title, then its picture   */
/* ------------------------------------------------------------------ */

function paintLesson(ctx: Ctx, L: Layout, post: CommunityPost, logo: HTMLImageElement | null, art: Picture | null) {
  const lesson = extraLesson(post);
  const v = lesson?.visual ?? null;
  const s = v?.kind === "truth" ? SURFACES.black : v?.kind === "reset" ? SURFACES.graphite : SURFACES.offwhite;
  surfaceFill(ctx, s, L.W, L.H);
  head(ctx, L, s, lesson ? LESSON_TRACK[lesson.track]?.name ?? "Lesson" : "Lesson");
  const name = lesson?.title ?? hookLine(post.caption);
  const line = hookLine(post.caption);
  place(
    ctx,
    (c, w) => {
      let y = hook(c, name, 0, w, s, 168, 3, 104);
      if (v?.kind === "truth" && v.belief && v.truth) y = truthBlock(c, w, y + 64, v.belief, v.truth, s);
      else if (v?.kind === "reset" && v.items?.length) y = resetBlock(c, w, y + 64, v.items.filter((i) => i.trim()).slice(0, 4), s);
      else if (art) {
        y = rule(c, 0, y + 40, s) + 40;
        const pad = 40;
        const iw = w - pad * 2;
        const ih = (iw * art.height) / art.width;
        c.fillStyle = s.dark ? COLOR.offwhite : s.panel;
        roundRect(c, 0, y, w, ih + pad * 2, 32);
        c.fill();
        c.drawImage(art, pad, y + pad, iw, ih);
        y += ih + pad * 2;
      } else if (line && line !== name) {
        y = rule(c, 0, y + 40, s) + 40;
        y = body(c, line, y, w, s, 6, 52);
      }
      return y;
    },
    PAD_X,
    roomTop(L),
    W_OF(L),
    roomH(L),
    "middle",
  );
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
}

/** The belief struck out, then the truth, big. */
function truthBlock(c: Ctx, w: number, top: number, belief: string, truth: string, s: Surface): number {
  const d = 64;
  marker(c, "cross", 0, 0, top, d, s, false);
  kicker(c, "The belief", d + 28, top + 16, s, { color: s.sub, size: 30 });
  const b = fitRuns(c, belief, w - d - 28, sans(600), 54, 44, 3);
  const y0 = top + 76;
  let y = drawRuns(c, b.lines, d + 28, y0, b.size, 1.2, sans(600), s.sub, s.sub, "body", s.bg);
  c.strokeStyle = s.accent;
  c.lineWidth = Math.max(5, b.size * 0.08);
  b.lines.forEach((ln, k) => {
    c.font = sans(600)(b.size);
    const lw = c.measureText(ln.map((t, j) => (j && !t.glue ? ` ${t.text}` : t.text)).join("")).width;
    const mid = y0 + k * b.size * 1.2 + b.size * 0.55;
    c.beginPath();
    c.moveTo(d + 28, mid);
    c.lineTo(d + 28 + lw, mid);
    c.stroke();
  });
  y = hairline(c, 0, y + 44, w, s) + 44;
  marker(c, "check", 0, 0, y, d, s, true);
  kicker(c, "The truth", d + 28, y + 16, s, { size: 30 });
  return text(c, truth, d + 28, y + 76, w - d - 28, { f: sans(800), start: 76, min: 58, lines: 5, lh: 1.08, color: s.ink, accent: s.accent, role: "title", bg: s.bg });
}

/** The week's few things, each with a box to tick. */
function resetBlock(c: Ctx, w: number, top: number, items: string[], s: Surface): number {
  let y = top;
  items.forEach((t, i) => {
    const d = 64;
    marker(c, "number", i + 1, 0, y, d, s, i === 0);
    const it = fitRuns(c, t, w - d - 32, sans(700), 64, 48, 2);
    const yy = drawRuns(c, it.lines, d + 32, y + Math.max(0, (d - it.size * 1.18) / 2), it.size, 1.18, sans(700), s.ink, s.accent, "title", s.bg);
    y = Math.max(yy, y + d) + 36;
  });
  return y - 36;
}

/* ------------------------------------------------------------------ */
/*  Wednesday Wins: what the crew lifted, then the numbers, the weeks  */
/* ------------------------------------------------------------------ */

function paintWins(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, st: WinsStats, slide: number) {
  const kinds = winsSlides(st);
  const kind = kinds[Math.max(0, Math.min(kinds.length - 1, slide))];
  const week = winsWeekLabel(st.week_of);
  const w = W_OF(L);
  if (kind === "hero") {
    const s = SURFACES.black;
    surfaceFill(ctx, s, L.W, L.H);
    head(ctx, L, s, "Wednesday wins", week);
    const hero = winsHero(st);
    const lifted = st.volume_kg > 0;
    place(
      ctx,
      (c, width) => {
        let y = heroNumber(c, lifted ? hero.amount : String(st.prs), 0, 0, width, s, { start: 330, min: 170 }).bottom + 30;
        y = hook(c, lifted ? `${hero.unit} lifted together` : st.prs === 1 ? "personal record" : "personal records", y, width, s, 128, 2, 112);
        y = rule(c, 0, y + 36, s) + 40;
        const lines = [lifted ? hero.other : null, lifted ? hero.compare : `${st.sessions} workouts finished`].filter(Boolean) as string[];
        for (const ln of lines) y = body(c, ln, y, width, s, 2, 48) + 8;
        const tag = hero.badge ?? hero.change;
        if (tag) {
          pill(c, tag, 0, y + 24, hero.badge ? COLOR.gold : s.panel, hero.badge ? COLOR.black : s.ink, s.bg, 32);
          y += 24 + 56;
        }
        return y;
      },
      PAD_X,
      roomTop(L),
      w,
      roomH(L),
      "bottom",
    );
    brand(ctx, logo, PAD_X, L.bottom, L.W, s);
    swipeCue(ctx, SWIPE_X, L.bottom - 26, s);
    return;
  }
  if (kind === "numbers") {
    const s = SURFACES.offwhite;
    surfaceFill(ctx, s, L.W, L.H);
    head(ctx, L, s, "The week in numbers", week);
    place(ctx, (c, width) => tiles(c, width, 0, winsTiles(st), s), PAD_X, roomTop(L), w, roomH(L), "middle");
    brand(ctx, logo, PAD_X, L.bottom, L.W, s);
    return;
  }
  if (kind === "weeks") {
    const s = SURFACES.offwhite;
    surfaceFill(ctx, s, L.W, L.H);
    head(ctx, L, s, "Workouts each week", week);
    const chart = winsChart(st);
    place(
      ctx,
      (c, width) => {
        let y = columns(c, width, 0, 560, chart.map((b) => ({ share: b.share, hot: b.current, value: b.current ? String(b.sessions) : undefined, label: b.label.split(" ")[1] ?? b.label })), s);
        y = hairline(c, 0, y + 48, width, s) + 48;
        return hook(c, winsChallenge(st), y, width, s, 118, 3, 96);
      },
      PAD_X,
      roomTop(L),
      w,
      roomH(L),
      "middle",
    );
    brand(ctx, logo, PAD_X, L.bottom, L.W, s);
    return;
  }
  const s = SURFACES.red;
  surfaceFill(ctx, s, L.W, L.H);
  head(ctx, L, s, "This week", week);
  place(ctx, (c, width) => hook(c, winsChallenge(st), 0, width, s, 190, 4, 120), PAD_X, roomTop(L), w, roomH(L), "middle");
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
}

/** Two across: a big number and what it means. */
function tiles(c: Ctx, w: number, top: number, list: { value: string; label: string; sub?: string }[], s: Surface): number {
  const gap = 56;
  const colW = (w - gap) / 2;
  let y = top;
  for (let i = 0; i < list.length; i += 2) {
    let bottom = y;
    for (let j = 0; j < 2 && i + j < list.length; j++) {
      const t = list[i + j];
      const x = j * (colW + gap);
      const n = heroNumber(c, t.value.toUpperCase(), x, y, colW, s, { start: 200, min: 100, color: i + j === 0 ? s.accent : s.ink });
      let ty = n.bottom + 26;
      ty = text(c, t.label, x, ty, colW, { f: sans(800), start: 48, min: 42, lines: 2, lh: 1.15, color: s.ink, accent: s.accent, role: "body", bg: s.bg });
      if (t.sub) ty = text(c, t.sub, x, ty + 6, colW, { f: sans(500), start: 42, min: 40, lines: 2, lh: 1.2, color: s.sub, accent: s.sub, role: "body", bg: s.bg });
      bottom = Math.max(bottom, ty);
    }
    y = bottom + 72;
    if (i + 2 < list.length) y = hairline(c, 0, y - 36, w, s) + 34;
  }
  return y - 72;
}

/* ------------------------------------------------------------------ */
/*  The Sunday Recap: the plan done, the numbers, the days, moments    */
/* ------------------------------------------------------------------ */

function paintRecap(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, st: RecapStats, slide: number) {
  const kinds = recapSlides(st);
  const kind = kinds[Math.max(0, Math.min(kinds.length - 1, slide))];
  const week = winsWeekLabel(st.week_of);
  const sum = recapSummary(st);
  const w = W_OF(L);
  if (kind === "hero") {
    const s = SURFACES.red;
    surfaceFill(ctx, s, L.W, L.H);
    head(ctx, L, s, "Week recap", week);
    const plan = sum.planPct != null;
    place(
      ctx,
      (c, width) => {
        let y = heroNumber(c, plan ? `${sum.planPct}%` : String(st.sessions), 0, 0, width, s, { start: 360, min: 180, color: s.ink }).bottom + 30;
        y = hook(c, plan ? "of planned sessions done" : "workouts finished", y, width, s, 128, 2, 112);
        y = rule(c, 0, y + 36, { ...s, accent: COLOR.black }) + 40;
        const ln = st.active > 0 ? `${st.hit} of ${st.active} hit their weekly target` : sum.vsLast;
        if (ln) y = text(c, ln, 0, y, width, { f: sans(700), start: 50, min: 44, lines: 2, lh: 1.24, color: s.ink, accent: s.ink, role: "body", bg: s.bg });
        return y;
      },
      PAD_X,
      roomTop(L),
      w,
      roomH(L),
      "bottom",
    );
    brand(ctx, logo, PAD_X, L.bottom, L.W, s);
    swipeCue(ctx, SWIPE_X, L.bottom - 26, { ...s, accent: COLOR.white });
    return;
  }
  if (kind === "numbers") {
    const s = SURFACES.offwhite;
    surfaceFill(ctx, s, L.W, L.H);
    head(ctx, L, s, "The week in numbers", week);
    const hero = winsHero(st);
    const list = [
      { value: st.prs.toLocaleString("en-US"), label: st.prs === 1 ? "personal record" : "personal records", sub: st.pr_people > 1 ? `set by ${st.pr_people} people` : undefined },
      { value: st.sessions.toLocaleString("en-US"), label: st.sessions === 1 ? "workout finished" : "workouts finished", sub: sum.vsLast ?? undefined },
      ...(st.volume_kg > 0 ? [{ value: hero.amount, label: `${hero.unit} lifted together`, sub: hero.other }] : []),
      ...(st.trained > 0 ? [{ value: `${st.trained}`, label: st.trained === 1 ? "person trained" : "people trained", sub: st.roster ? `of ${st.roster} in the crew` : undefined }] : []),
    ];
    place(ctx, (c, width) => tiles(c, width, 0, list, s), PAD_X, roomTop(L), w, roomH(L), "middle");
    brand(ctx, logo, PAD_X, L.bottom, L.W, s);
    return;
  }
  if (kind === "days") {
    const s = SURFACES.black;
    surfaceFill(ctx, s, L.W, L.H);
    head(ctx, L, s, "Workouts by day", week);
    const best = sum.days.find((d) => d.best);
    const NAMES: Record<string, string> = {};
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach((n, i) => (NAMES[i] = n));
    place(
      ctx,
      (c, width) => {
        let y = columns(c, width, 0, 600, sum.days.map((d) => ({ share: d.share, hot: d.best, value: String(d.n), label: d.letter })), s);
        if (best) {
          y = hairline(c, 0, y + 48, width, s) + 48;
          y = hook(c, `${NAMES[sum.days.indexOf(best)]} was the busiest day`, y, width, s, 112, 2, 96);
        }
        return y;
      },
      PAD_X,
      roomTop(L),
      w,
      roomH(L),
      "middle",
    );
    brand(ctx, logo, PAD_X, L.bottom, L.W, s);
    return;
  }
  // the week's biggest moments
  const s = SURFACES.graphite;
  surfaceFill(ctx, s, L.W, L.H);
  head(ctx, L, s, "Biggest moments", week);
  place(
    ctx,
    (c, width) => {
      let y = 0;
      st.top.slice(0, 3).forEach((t, i) => {
        const d = 84;
        marker(c, "number", i + 1, 0, y, d, s, i === 0);
        const it = fitRuns(c, t.text, width - d - 40, sans(800), 76, 54, 3);
        const yy = drawRuns(c, it.lines, d + 40, y + Math.max(0, (d - it.size * 1.16) / 2), it.size, 1.16, sans(800), s.ink, s.accent, "title", s.bg);
        y = Math.max(yy, y + d) + 64;
        if (i < Math.min(3, st.top.length) - 1) y = hairline(c, 0, y - 32, width, s) + 30;
      });
      return y - 64;
    },
    PAD_X,
    roomTop(L),
    w,
    roomH(L),
    "middle",
  );
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
}

/* ------------------------------------------------------------------ */
/*  Tuesday's numbers / Thursday's feature                             */
/* ------------------------------------------------------------------ */

function compareBlock(c: Ctx, w: number, top: number, compare: CrewCompare, s: Surface): number {
  let y = top;
  compareBars(compare).forEach((r, i) => {
    y = hbar(c, w, y, r.label, r.value, r.share, r.lead, s, r.count) + (i === 0 ? 52 : 0);
  });
  return y;
}

/**
 * Tuesday's headline from its own numbers, short enough for the grid:
 * "3+ sessions a week: 2× the PRs". Only when the gap is real (1.3× or more)
 * and the outcome is a count; else null (the caption's first line is used).
 */
export function compareHeadline(c: CrewCompare): string | null {
  if (c.outcome === "rating") return null;
  const bars = compareBars(c);
  const [hi, lo] = c.x >= c.y ? [c.x, c.y] : [c.y, c.x];
  if (!(lo > 0) || hi / lo < 1.3) return null;
  const lead = bars.find((b) => b.lead) ?? bars[0];
  const ratio = hi / lo;
  const times = ratio >= 1.95 && ratio < 2.05 ? "2" : ratio.toFixed(1).replace(/\.0$/, "");
  return `${lead.label}: ${times}× the ${c.outcome === "prs" ? "PRs" : "workouts"}`;
}

function paintCompare(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, post: CommunityPost, obs: CrewCompare & { observation: string }) {
  const s = SURFACES.offwhite;
  surfaceFill(ctx, s, L.W, L.H);
  const sleep = obs.habit === "sleep";
  head(ctx, L, s, sleep ? "From your workout reviews" : "From the app · 8 weeks");
  const line = compareHeadline(obs) ?? (hookLine(post.caption) || (sleep ? "How you slept vs how you trained" : "What the crew's training says"));
  place(
    ctx,
    (c, w) => {
      let y = hook(c, line, 0, w, s, 146, 3, 104);
      y = rule(c, 0, y + 36, s) + 52;
      return compareBlock(c, w, y, obs, s);
    },
    PAD_X,
    roomTop(L),
    W_OF(L),
    roomH(L) - 96,
    "middle",
  );
  // how it was counted: a footnote over the brand row, never shrunk with the block
  text(ctx, sleep ? "Sessions rated by the sleep the night before." : "New members (last 8 weeks) aren't counted.", PAD_X, L.bottom - FOOT - 70, W_OF(L), { f: sans(500), start: 40, min: 38, lines: 1, lh: 1.2, color: s.sub, accent: s.sub, role: "body", bg: s.bg });
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
}

function paintFeature(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, post: CommunityPost, f: { title: string; where: string[]; stat?: CrewCompare | null }) {
  const s = SURFACES.graphite;
  surfaceFill(ctx, s, L.W, L.H);
  head(ctx, L, s, "Try it in the app");
  place(
    ctx,
    (c, w) => {
      let y = hook(c, f.title, 0, w, s, 180, 3, 112);
      y = rule(c, 0, y + 40, s) + 48;
      if (f.where.length) y = path(c, f.where, y, w, s);
      if (f.stat) {
        y = hairline(c, 0, y + 56, w, s) + 48;
        y = kicker(c, "How the crew trains · 8 weeks", 0, y, s, { color: s.sub, size: 30 }) + 40;
        y = compareBlock(c, w, y, f.stat, s);
      } else {
        const line = hookLine(post.caption);
        if (line && line !== f.title) y = body(c, line, y + 48, w, s, 4, 50);
      }
      return y;
    },
    PAD_X,
    roomTop(L),
    W_OF(L),
    roomH(L),
    "middle",
  );
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
}

/** Where a feature lives, as the app's own steps: "Workouts › Exercise › + Warm-up". */
function path(c: Ctx, steps: string[], top: number, w: number, s: Surface): number {
  let x = 0;
  let y = top;
  steps.forEach((step, i) => {
    c.font = sans(800)(40);
    const pw = c.measureText(step).width + 56;
    const arrow = i > 0 ? 52 : 0;
    if (x > 0 && x + arrow + pw > w) {
      x = 0;
      y += 96;
    }
    if (i > 0 && x > 0) {
      c.fillStyle = s.accent;
      c.font = sans(800)(44);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("›", x + arrow / 2, y + 36);
      x += arrow;
    }
    const last = i === steps.length - 1;
    x = pill(c, step, x, y, last ? COLOR.red : s.panel, last ? COLOR.white : s.ink, s.bg, 40);
  });
  c.textBaseline = "alphabetic";
  return y + 70;
}

/* ------------------------------------------------------------------ */
/*  A birthday                                                         */
/* ------------------------------------------------------------------ */

/** A fixed scatter of brand-colour confetti along the edges, from the post's id: the same card every time. */
function confetti(ctx: Ctx, W: number, H: number, seed: string) {
  let h = seedHash(seed) || 1;
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const colors = [COLOR.offwhite, COLOR.black, COLOR.gold];
  for (let i = 0; i < 26; i++) {
    const top = i % 2 === 0;
    const x = rnd() * W;
    const y = top ? 20 + rnd() * H * 0.1 : H * 0.9 + rnd() * H * 0.08;
    const w = 14 + rnd() * 18;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI);
    ctx.globalAlpha = 0.55 + rnd() * 0.35;
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.fillRect(-w / 2, -w / 6, w, w / 3);
    ctx.restore();
  }
}

/** Happy birthday, their name huge, then what they've done (the caption's next lines). */
function paintBirthday(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, post: CommunityPost, name: string) {
  const s = SURFACES.red;
  surfaceFill(ctx, s, L.W, L.H);
  confetti(ctx, L.W, L.H, post.id);
  const caption = post.caption?.trim() ? plainMentions(post.caption.trim(), post.mentions) : "";
  const lines = caption.split("\n").map((l) => l.trim());
  const first = lines.findIndex(Boolean);
  const rest = lines.slice(first + 1).join(" ").trim();
  place(
    ctx,
    (c, w) => {
      let y = kicker(c, "Happy birthday", 0, 0, s, { color: s.ink, size: 40, bar: true }) + 34;
      y = heroNumber(c, name.toUpperCase(), 0, y, w, s, { start: 300, min: 150, color: s.ink }).bottom + 20;
      if (rest) {
        y = rule(c, 0, y + 30, { ...s, accent: COLOR.black }) + 40;
        y = text(c, rest, 0, y, w, { f: sans(700), start: 50, min: 44, lines: 4, lh: 1.26, color: s.ink, accent: s.ink, role: "body", bg: s.bg });
      }
      return y;
    },
    PAD_X,
    roomTop(L),
    W_OF(L),
    roomH(L),
    "middle",
  );
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
}

/* ------------------------------------------------------------------ */
/*  A picture (a holiday's photo, Saturday's scene)                    */
/* ------------------------------------------------------------------ */

function paintPicture(ctx: Ctx, L: Layout, logo: HTMLImageElement | null, pic: Picture) {
  const { W, H } = L;
  if (L.format === "feed") {
    ctx.fillStyle = COLOR.black;
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, pic, W, H);
    return;
  }
  const s = SURFACES.black;
  surfaceFill(ctx, s, W, H);
  brand(ctx, logo, PAD_X, L.top + 30, W, s);
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
/*  Words (a coach's note, a quote, a tip without a deck)              */
/* ------------------------------------------------------------------ */

/** A whole tip on one line is too much for a headline: its first sentence is, and the rest goes under it. */
export function splitHeadline(line: string, max = 110): { head: string; rest: string } {
  const t = line.trim();
  if (t.length <= max) return { head: t, rest: "" };
  const m = /^(.{12,}?[.!?])\s+([\s\S]+)$/.exec(t);
  return m && m[1].length <= max + 30 ? { head: m[1], rest: m[2].trim() } : { head: t, rest: "" };
}

/**
 * A words card: a small label (a Tuesday tip's kind), the headline (a quote
 * and who said it, else the caption's first sentence), and what's under it
 * (the next sentence or two; the caption under the picture has the rest).
 */
export function wordsCardText(post: CommunityPost): { kicker: string | null; head: string; body: string | null; by: string | null } {
  const kicker = post.series === "tuesday_tips" ? extraTipKind(post.series_extra) : null;
  const quote = post.quote?.trim();
  if (quote) return { kicker, head: `“${quote}”`, body: null, by: post.quote_author?.trim() || null };
  const caption = post.caption?.trim() ? plainMentions(post.caption.trim(), post.mentions) : "";
  if (!caption) {
    const w = storyWords(post);
    return { kicker, head: w.text, body: null, by: w.by };
  }
  const lines = caption.split("\n").map((l) => l.trim());
  const at = lines.findIndex(Boolean);
  const { head, rest } = splitHeadline(lines[at] ?? caption);
  const body = [rest, ...lines.slice(at + 1)].join("\n").trim() || null;
  // "Cue to test" over "cue to test on squats…" says it twice
  return { kicker: kicker && !head.toLowerCase().startsWith(kicker.toLowerCase()) ? kicker : null, head, body, by: null };
}


/** The surface a words card gets: one of three, from the post (the same card every time, a run of them varied). */
export function wordsSurface(post: Pick<CommunityPost, "id" | "series">): Surface {
  const list = [SURFACES.black, SURFACES.offwhite, SURFACES.graphite];
  return list[seedHash(`${post.series ?? ""}:${post.id}`) % list.length];
}

function paintWords(ctx: Ctx, L: Layout, post: CommunityPost, logo: HTMLImageElement | null) {
  const s = wordsSurface(post);
  surfaceFill(ctx, s, L.W, L.H);
  const { kicker: label, head: line, by } = wordsCardText(post);
  head(ctx, L, s, label ?? (post.series === "tuesday_tips" ? "Tuesday tip" : null));
  // a short line reads in the grid in the display face; a long one in heavy sans, as big as it fits
  const short = line.replace(/[“”"]/g, "").length <= 70;
  place(
    ctx,
    (c, w) => {
      let y = 0;
      if (by) {
        c.font = hookFace(280);
        c.fillStyle = s.accent;
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
        c.fillText("“", -8, 230);
        y = 170;
      }
      const words = by ? line.replace(/^[“"]|[”"]$/g, "") : line;
      y = short && !by ? hook(c, words, y, w, s, 190, 5, 112) : title(c, words, y, w, s, 108, 7);
      y = rule(c, 0, y + 40, s);
      if (by) y = kicker(c, by, 0, y + 30, s, { color: s.sub, size: 32 });
      return y;
    },
    PAD_X,
    roomTop(L),
    W_OF(L),
    roomH(L),
    short && !by ? "bottom" : "middle",
  );
  brand(ctx, logo, PAD_X, L.bottom, L.W, s);
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
