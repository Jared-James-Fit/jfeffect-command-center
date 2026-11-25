/**
 * A deck's slides, painted: each slide of an automated post's deck
 * (post-decks.ts) as its own 1080×1350 picture, the same file the feed shows
 * and Share to Instagram sends. In the design system of every automated
 * post (post-design.ts, Nov 25 2026): black, off-white, graphite and the JF
 * Effect red; the cover's headline in the condensed display face in capitals,
 * big enough to read in the three-across profile grid; the slides that
 * build in the phone's heavy sans; no serif, no italics.
 *
 * A carousel opens on its theme's cover surface, builds on its body surface
 * and lands on its end surface, so it reads as one designed set; each stored
 * theme is one arrangement of the four surfaces and one cover layout, and
 * posts in a row never share one (pickDeckTheme). Nothing goes in the
 * corners the app puts its own marks on (the counter top right, the post's
 * buttons over the lower right); the brand is a small mark bottom left.
 */
import { ensureDisplayFont } from "@/lib/workout-share-card";
import { stripEmphasis, type DeckTheme, type PostDeck } from "@/lib/post-decks";
import { COLOR, FOOT, HEAD, PAD_X, SURFACES, TYPE, type Surface } from "@/lib/post-design";
import {
  brand,
  drawRuns,
  fitRuns,
  hairline,
  hbar,
  heroNumber,
  hookFace,
  kicker,
  marker,
  place,
  rule,
  sans,
  surfaceFill,
  swipeCue,
  text,
  type Ctx,
  type Picture,
} from "@/lib/post-design-paint";
import { roundRect } from "@/lib/workout-story-card";

export type DeckLayout = { W: number; H: number; top: number; bottom: number };

/** How a cover is laid out: the headline low (stack), under an accent band (band), or beside a full-height accent edge (edge). */
type CoverLayout = "stack" | "band" | "edge";

/** A stored theme's surfaces (the names are the stored keys; their looks are the design system's). */
const THEME: Record<DeckTheme, { cover: Surface; body: Surface; end: Surface; layout: CoverLayout }> = {
  paper: { cover: SURFACES.offwhite, body: SURFACES.offwhite, end: SURFACES.black, layout: "stack" },
  red: { cover: SURFACES.red, body: SURFACES.offwhite, end: SURFACES.black, layout: "stack" },
  slate: { cover: SURFACES.black, body: SURFACES.black, end: SURFACES.red, layout: "edge" },
  blush: { cover: SURFACES.graphite, body: SURFACES.graphite, end: SURFACES.offwhite, layout: "band" },
  bone: { cover: SURFACES.offwhite, body: SURFACES.offwhite, end: SURFACES.red, layout: "band" },
};

function surfaceFor(deck: Pick<PostDeck, "theme" | "slides">, i: number): Surface {
  const t = THEME[deck.theme] ?? THEME.paper;
  const s = deck.slides[i];
  if (i === 0) return t.cover;
  if (s?.type === "takeaway") return t.end;
  return t.body;
}

/** The colour a slide's background is. */
export function deckSlideBackground(deck: Pick<PostDeck, "theme" | "slides">, index: number): string {
  return surfaceFor(deck, index).bg;
}

/** Whether a slide is on a dark surface (a lesson's diagram then sits on a light panel). */
export function deckSlideIsDark(deck: Pick<PostDeck, "theme" | "slides">, index: number): boolean {
  return surfaceFor(deck, index).dark;
}

/** Every face a deck paints in, fetched before the first slide (and ahead of time by the feed). */
export function ensureDeckFonts(): Promise<void> {
  return ensureDisplayFont();
}

/** The small label over a slide that isn't the cover: the deck's kicker, so a swiped-to slide still says what it's part of. */
function slideLabel(deck: PostDeck): string | null {
  const c = deck.slides[0];
  return c?.type === "cover" && c.kicker ? stripEmphasis(c.kicker) : null;
}

const W_OF = (L: DeckLayout) => L.W - PAD_X * 2;
/** "Swipe" sits on the brand row, after the mark: never shrunk with the headline, clear of the post's buttons on the right. */
export const SWIPE_X = PAD_X + 300;

/* ------------------------------------------------------------------ */
/*  The cover                                                          */
/* ------------------------------------------------------------------ */

function headline(c: Ctx, title: string, w: number, s: Surface, lines: number = TYPE.hook.maxLines): number {
  return text(c, title, 0, 0, w, { f: hookFace, start: TYPE.hook.start, min: TYPE.hook.min, lines, lh: TYPE.hook.lh, color: s.ink, accent: s.accent, role: "hook", bg: s.bg, caps: true });
}

function paintCover(ctx: Ctx, L: DeckLayout, deck: PostDeck, logo: HTMLImageElement | null): number {
  const s = deck.slides[0];
  if (s.type !== "cover") return 1;
  const t = THEME[deck.theme] ?? THEME.paper;
  const surf = t.cover;
  const carousel = deck.slides.length > 1;
  const w = W_OF(L);
  surfaceFill(ctx, surf, L.W, L.H);

  // what goes under the headline: the line, then the swipe cue
  const tail = (c: Ctx, y: number, width: number) => {
    // a long headline is the whole cover: its line goes, so nothing shrinks under what the grid reads
    const roomy = y <= 640;
    y = rule(c, 0, y + 40, surf) + 36;
    if (s.sub && roomy) y = text(c, s.sub, 0, y, width * 0.94, { f: sans(600), start: 48, min: TYPE.body.min, lines: 3, lh: 1.26, color: surf.sub, accent: surf.sub, role: "body", bg: surf.bg });
    return y;
  };

  if (t.layout === "band") {
    // an accent band across the top holds the kicker; the headline right under it
    const bandH = Math.round(L.H * 0.2);
    const band: Surface = { ...SURFACES.red, bg: COLOR.red };
    ctx.fillStyle = band.bg;
    ctx.fillRect(0, 0, L.W, bandH);
    if (s.kicker) kicker(ctx, stripEmphasis(s.kicker), PAD_X, bandH - 74, band, { color: band.ink, size: 34, maxWidth: w - 120 });
    const top = bandH + 64;
    const scale = place(ctx, (c, width) => tail(c, headline(c, s.title, width, surf), width), PAD_X, top, w, L.bottom - FOOT - top, "top");
    brand(ctx, logo, PAD_X, L.bottom, L.W, surf);
    if (carousel) swipeCue(ctx, SWIPE_X, L.bottom - 26, surf);
    return scale;
  }

  if (t.layout === "edge") {
    // a full-height accent edge down the left; the kicker up top, the headline in the middle
    ctx.fillStyle = surf.accent;
    ctx.fillRect(0, 0, 28, L.H);
    if (s.kicker) kicker(ctx, stripEmphasis(s.kicker), PAD_X, L.top + 18, surf, { size: 34, bar: true, maxWidth: w - 120 });
    const top = L.top + HEAD;
    const scale = place(ctx, (c, width) => tail(c, headline(c, s.title, width, surf), width), PAD_X, top, w, L.bottom - FOOT - top, "middle");
    brand(ctx, logo, PAD_X, L.bottom, L.W, surf);
    if (carousel) swipeCue(ctx, SWIPE_X, L.bottom - 26, surf);
    return scale;
  }

  // stack: the kicker up top, the headline big and low
  if (s.kicker) kicker(ctx, stripEmphasis(s.kicker), PAD_X, L.top + 18, surf, { size: 34, bar: true, maxWidth: w - 120 });
  else rule(ctx, PAD_X, L.top + 22, surf, 96, 14);
  const top = L.top + HEAD;
  const scale = place(ctx, (c, width) => tail(c, headline(c, s.title, width, surf), width), PAD_X, top, w, L.bottom - FOOT - top, "bottom");
  brand(ctx, logo, PAD_X, L.bottom, L.W, surf);
  if (carousel) swipeCue(ctx, SWIPE_X, L.bottom - 26, surf);
  return scale;
}

/* ------------------------------------------------------------------ */
/*  The slides                                                         */
/* ------------------------------------------------------------------ */

const title = (c: Ctx, words: string, y: number, w: number, s: Surface, start: number = TYPE.title.start, lines = 4) =>
  text(c, words, 0, y, w, { f: sans(800), start, min: TYPE.title.min, lines, lh: TYPE.title.lh, color: s.ink, accent: s.accent, role: "title", bg: s.bg, tracking: -0.012 });

const body = (c: Ctx, words: string, y: number, w: number, s: Surface, lines = 6, start: number = TYPE.body.start) =>
  text(c, words, 0, y, w, { f: sans(500), start, min: TYPE.body.min, lines, lh: TYPE.body.lh, color: s.sub, accent: s.ink, role: "body", bg: s.bg });

/**
 * Paint slide `index` of `deck` onto `ctx` (already sized to L.W × L.H).
 * `art`: the lesson's diagram, for a diagram slide. Returns how far the
 * content had to be scaled to fit (1: as designed).
 */
export function paintDeckSlide(ctx: Ctx, L: DeckLayout, deck: PostDeck, index: number, logo: HTMLImageElement | null, art: Picture | null): number {
  const i = Math.max(0, Math.min(deck.slides.length - 1, index));
  if (i === 0) return paintCover(ctx, L, deck, logo);
  const s = deck.slides[i];
  const surf = surfaceFor(deck, i);
  surfaceFill(ctx, surf, L.W, L.H);
  const W = W_OF(L);
  const roomTop = L.top + HEAD;
  const roomH = L.bottom - FOOT - roomTop;
  let scale = 1;

  // every slide but the takeaway says what it's part of, up top
  const tag = slideLabel(deck);
  if (tag && s.type !== "takeaway") kicker(ctx, tag, PAD_X, L.top + 18, surf, { color: surf.sub, size: 32, maxWidth: W - 120 });

  switch (s.type) {
    case "point": {
      // numbered only as a sequence (two or more numbered points), counted in order whatever the model wrote
      const numbered = deck.slides.filter((x) => x.type === "point" && x.n);
      const n = numbered.length >= 2 && s.n ? numbered.indexOf(s) + 1 : 0;
      scale = place(ctx, (c, w) => {
        let y = 0;
        if (n) y = heroNumber(c, String(n).padStart(2, "0"), 0, 0, w, surf, { start: 220, min: 160 }).bottom + 48;
        else y = rule(c, 0, 0, surf) + 52;
        y = title(c, s.title, y, w, surf);
        if (s.body) y = body(c, s.body, y + 40, w, surf);
        return y;
      }, PAD_X, roomTop, W, roomH);
      break;
    }

    case "stat":
      scale = place(ctx, (c, w) => {
        let y = heroNumber(c, s.value, 0, 0, w, surf).bottom + 40;
        y = title(c, s.label, y, w, surf, 88, 4);
        if (s.bars?.length === 2) {
          const num = (v: string) => {
            const m = /\d+(?:\.\d+)?/.exec(v.replace(/,/g, ""));
            return m ? Number(m[0]) : NaN;
          };
          const vals = s.bars.map((b) => num(b.value));
          const top0 = vals.every(Number.isFinite) ? Math.max(...vals, 0.0001) : 1;
          y += 56;
          s.bars.forEach((b, k) => {
            const v = vals[k];
            y = hbar(c, w, y, b.label, b.value, Number.isFinite(v) ? Math.max(0.08, v / top0) : 1, k === 0, surf) + (k === 0 ? 40 : 0);
          });
        }
        if (s.note) {
          y = hairline(c, 0, y + 48, w, surf) + 28;
          y = body(c, s.note, y, w, surf, 2, 44);
        }
        return y;
      }, PAD_X, roomTop, W, roomH);
      break;

    case "compare":
      scale = place(ctx, (c, w) => {
        const d = 72;
        const row = (side: { label: string; text: string }, top: number, strong: boolean, kind: "check" | "cross" | null): number => {
          const tx = kind ? d + 32 : 0;
          if (kind) marker(c, kind, 0, 0, top, d, surf, strong);
          kicker(c, side.label, tx, top + 18, surf, { color: strong ? surf.accent : surf.sub, size: 30 });
          const f = strong ? sans(800) : sans(600);
          const fit = fitRuns(c, side.text, w - tx, f, strong ? 100 : 66, strong ? 66 : 48, 4);
          const y0 = top + 80;
          const color = strong ? surf.ink : surf.sub;
          const lh = strong ? 1.08 : 1.22;
          const y = drawRuns(c, fit.lines, tx, y0, fit.size, lh, f, color, surf.accent, strong ? "title" : "body", surf.bg);
          if (!strong && s.myth) {
            // the belief, struck out
            c.strokeStyle = surf.accent;
            c.lineWidth = Math.max(5, fit.size * 0.08);
            fit.lines.forEach((ln, k) => {
              c.font = f(fit.size);
              const lw = ln.reduce((a, tk, j) => a + c.measureText(j && !tk.glue ? ` ${tk.text}` : tk.text).width, 0);
              const mid = y0 + k * fit.size * lh + fit.size * 0.55;
              c.beginPath();
              c.moveTo(tx, mid);
              c.lineTo(tx + lw, mid);
              c.stroke();
            });
          }
          return y;
        };
        let y = row(s.left, 0, false, s.myth ? "cross" : null);
        y = hairline(c, 0, y + 56, w, surf) + 56;
        return row(s.right, y, true, s.myth ? "check" : null);
      }, PAD_X, roomTop, W, roomH);
      break;

    case "list":
      scale = place(ctx, (c, w) => {
        let y = title(c, s.title, 0, w, surf, 104, 3) + 64;
        const d = 84;
        const style = s.style ?? "check";
        s.items.forEach((item, k) => {
          const top = y;
          marker(c, style, k + 1, 0, top, d, surf, style !== "cross" || k === 0);
          const it = fitRuns(c, item, w - d - 40, sans(700), 68, 50, 3);
          const y0 = top + Math.max(0, (d - it.size * 1.18) / 2);
          y = drawRuns(c, it.lines, d + 40, y0, it.size, 1.18, sans(700), surf.ink, surf.accent, "title", surf.bg);
          y = Math.max(y, top + d) + 44;
        });
        return y - 44;
      }, PAD_X, roomTop, W, roomH);
      break;

    case "quote":
      scale = place(ctx, (c, w) => {
        // the mark in the display face, the words in heavy sans (no serif, no italics)
        c.font = hookFace(300);
        c.fillStyle = surf.accent;
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
        c.fillText("“", -8, 250);
        let y = title(c, s.text, 190, w, surf, 104, 7);
        y = rule(c, 0, y + 44, surf, 56, 8);
        return kicker(c, s.by, 80, y - 26, surf, { color: surf.sub, size: 30 });
      }, PAD_X, roomTop, W, roomH);
      break;

    case "diagram":
      scale = place(ctx, (c, w) => {
        let y = title(c, s.title, 0, w, surf, 92, 3) + 44;
        if (art) {
          // the drawing is in ink on paper: on a dark slide it sits on an off-white panel
          const pad = 44;
          const iw = w - pad * 2;
          const ih = (iw * art.height) / art.width;
          c.fillStyle = surf.dark ? COLOR.offwhite : surf.panel;
          roundRect(c, 0, y, w, ih + pad * 2, 32);
          c.fill();
          c.drawImage(art, pad, y + pad, iw, ih);
          y += ih + pad * 2;
        }
        if (s.note) y = body(c, s.note, y + 32, w, surf, 3, 46);
        return y;
      }, PAD_X, roomTop, W, roomH);
      break;

    case "takeaway":
      scale = place(ctx, (c, w) => {
        kicker(c, "The takeaway", 0, 0, surf, { color: surf.accent === COLOR.black ? surf.ink : surf.accent, size: 32, bar: true });
        let y = text(c, s.title, 0, 80, w, { f: hookFace, start: 150, min: 96, lines: 6, lh: TYPE.hook.lh, color: surf.ink, accent: surf.accent, role: "hook", bg: surf.bg, caps: true });
        if (s.body) y = body(c, s.body, y + 44, w * 0.94, surf, 4, 48);
        return y;
      }, PAD_X, roomTop, W, roomH);
      break;
  }

  brand(ctx, logo, PAD_X, L.bottom, L.W, surf);
  return scale;
}

