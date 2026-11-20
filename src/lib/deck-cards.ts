/**
 * A deck's slides, painted (Nov 20 2026): each slide of an automated post's
 * deck (post-decks.ts) as its own 1080×1350 picture, the same file the feed
 * shows and Share to Instagram sends. A carousel opens on its theme's bold
 * side (the hook), builds on its calm side, and lands back on the bold side
 * (the takeaway), so it reads as one designed set; posts in a row never share
 * a theme (pickDeckTheme).
 *
 * Type does the work: a heavy sans hook in sentence case (the phone's own
 * face, SF on an iPhone) or an editorial serif (Instrument Serif, bundled),
 * condensed numerals for a number that carries the point (Anton, bundled),
 * one accent colour, generous margins, and every block fitted to its room
 * (shrunk only as far as reads, then the block scaled to fit, never cut off).
 * Nothing goes in the corners the app puts its own marks on (the counter top
 * right, the dots bottom centre, the post's buttons over the lower right); the
 * brand is a small mark bottom left and a carousel's cover says "Swipe" under
 * its hook. Never the feed's near-black.
 */
import { font, roundRect } from "@/lib/workout-story-card";
import { brandRow, display, ensureDisplayFont, setSpacing } from "@/lib/workout-share-card";
import { emphasisRuns, stripEmphasis, type DeckTheme, type PostDeck } from "@/lib/post-decks";

type Ctx = CanvasRenderingContext2D;
type Picture = CanvasImageSource & { width: number; height: number };

export type DeckLayout = { W: number; H: number; top: number; bottom: number };

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

type Palette = {
  bg: string;
  ink: string;
  sub: string;
  accent: string;
  /** Text on an accent-filled shape. */
  onAccent: string;
  line: string;
  faint: string;
};

const INK = "#141417";
const RED = "#e42f3d";
const dark = (a: number) => `rgba(20,20,23,${a})`;
const light = (a: number) => `rgba(255,255,255,${a})`;

const PALETTES: Record<"paper" | "red" | "slate" | "blush" | "bone", Palette> = {
  paper: { bg: "#f4f0e8", ink: INK, sub: dark(0.6), accent: RED, onAccent: "#ffffff", line: dark(0.14), faint: dark(0.055) },
  red: { bg: "#e0303d", ink: "#ffffff", sub: light(0.8), accent: INK, onAccent: "#ffffff", line: light(0.32), faint: light(0.13) },
  slate: { bg: "#e5e8ed", ink: "#13161b", sub: "rgba(19,22,27,0.6)", accent: RED, onAccent: "#ffffff", line: "rgba(19,22,27,0.14)", faint: "rgba(19,22,27,0.055)" },
  blush: { bg: "#f6e0dc", ink: "#1b1314", sub: "rgba(27,19,20,0.6)", accent: "#cf2533", onAccent: "#ffffff", line: "rgba(27,19,20,0.14)", faint: "rgba(27,19,20,0.055)" },
  bone: { bg: "#fbfaf7", ink: INK, sub: dark(0.58), accent: RED, onAccent: "#ffffff", line: dark(0.12), faint: dark(0.05) },
};

/** A theme's three sides: the cover, the slides that build, the takeaway. */
const THEME: Record<DeckTheme, { cover: Palette; body: Palette; end: Palette; hook: "sans" | "serif" }> = {
  paper: { cover: PALETTES.paper, body: PALETTES.paper, end: PALETTES.red, hook: "sans" },
  red: { cover: PALETTES.red, body: PALETTES.bone, end: PALETTES.red, hook: "sans" },
  slate: { cover: PALETTES.slate, body: PALETTES.slate, end: PALETTES.paper, hook: "serif" },
  blush: { cover: PALETTES.blush, body: PALETTES.bone, end: PALETTES.blush, hook: "serif" },
  bone: { cover: PALETTES.bone, body: PALETTES.bone, end: PALETTES.slate, hook: "sans" },
};

/** The colour a slide's background is (a lesson's diagram is drawn in ink on the light ones). */
export function deckSlideBackground(deck: Pick<PostDeck, "theme" | "slides">, index: number): string {
  return paletteFor(deck, index).bg;
}

function paletteFor(deck: Pick<PostDeck, "theme" | "slides">, i: number): Palette {
  const t = THEME[deck.theme] ?? THEME.paper;
  const s = deck.slides[i];
  if (i === 0) return t.cover;
  if (s?.type === "takeaway") return t.end;
  return t.body;
}

/* ------------------------------------------------------------------ */
/*  Type                                                               */
/* ------------------------------------------------------------------ */

const SERIF = `"Instrument Serif", "Iowan Old Style", Georgia, serif`;
const serif = (size: number, italic = false) => `${italic ? "italic " : ""}400 ${size}px ${SERIF}`;

let serifPromise: Promise<void> | null = null;

/** The bundled serif (upright and italic), loaded once; Georgia if it can't be. */
function ensureSerifFont(): Promise<void> {
  if (serifPromise) return serifPromise;
  serifPromise = (async () => {
    try {
      if (typeof document === "undefined" || !document.fonts || typeof FontFace === "undefined") return;
      if (document.fonts.check(`400 80px "Instrument Serif"`) && document.fonts.check(`italic 400 80px "Instrument Serif"`)) return;
      const faces = [
        new FontFace("Instrument Serif", "url(/fonts/instrument-serif-latin-400.woff2)", { weight: "400", style: "normal" }),
        new FontFace("Instrument Serif", "url(/fonts/instrument-serif-latin-400-italic.woff2)", { weight: "400", style: "italic" }),
      ];
      await Promise.all(faces.map(async (f) => document.fonts.add(await f.load())));
    } catch {
      /* Georgia is fine */
    }
  })();
  return serifPromise;
}

/** Every face a deck paints in, fetched before the first slide (and ahead of time by the feed). */
export function ensureDeckFonts(): Promise<void> {
  return Promise.all([ensureDisplayFont(), ensureSerifFont()]).then(() => undefined);
}

type FontFn = (size: number) => string;
const sans = (weight: number): FontFn => (size) => font(weight, size);
const serifUp: FontFn = (size) => serif(size);
const serifItalic: FontFn = (size) => serif(size, true);

/** A word and the run it belongs to (accented or not); `glue`: no space before it ("again" + "."). */
type Token = { text: string; accent: boolean; glue?: boolean };
type Line = Token[];

/** A token as it's drawn after the one before it on its line. */
const piece = (t: Token, i: number) => (i && !t.glue ? ` ${t.text}` : t.text);

/** The words of a text with their accent, in order (punctuation right after an accent stays on its word). */
function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let endsWithSpace = true;
  for (const r of emphasisRuns(text)) {
    // glued only when nothing separates it from the run before ("*again*." → "again.")
    const glued = tokens.length > 0 && !endsWithSpace && !/^\s/.test(r.text);
    endsWithSpace = /\s$/.test(r.text);
    r.text
      .split(/\s+/)
      .filter(Boolean)
      .forEach((w, i) => tokens.push({ text: w, accent: r.accent, glue: i === 0 && glued }));
  }
  return tokens;
}

/** Words of a line with their accent, wrapped to `maxWidth` in `face` (a glued token never starts a line). */
function wrapRuns(c: Ctx, text: string, maxWidth: number, face: string, accentFace = face): Line[] {
  const tokens = tokensOf(text);
  const lines: Line[] = [];
  let cur: Line = [];
  const width = (line: Line) => {
    let w = 0;
    line.forEach((t, i) => {
      c.font = t.accent ? accentFace : face;
      w += c.measureText(piece(t, i)).width;
    });
    return w;
  };
  for (const t of tokens) {
    const next = [...cur, t];
    if (!cur.length || t.glue || width(next) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = [t];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** The biggest size (start → min) at which the text wraps into `maxLines`; at min it takes what it needs. */
function fitRuns(c: Ctx, text: string, maxWidth: number, f: FontFn, start: number, min: number, maxLines: number, accentF: FontFn = f): { lines: Line[]; size: number } {
  for (let size = start; size >= min; size -= 2) {
    const lines = wrapRuns(c, text, maxWidth, f(size), accentF(size));
    // a single word too wide for the line: smaller
    const widest = Math.max(...lines.map((l) => l.reduce((w, t, i) => ((c.font = t.accent ? accentF(size) : f(size)), w + c.measureText(piece(t, i)).width), 0)));
    if (lines.length <= maxLines && widest <= maxWidth) return { lines, size };
  }
  return { lines: wrapRuns(c, text, maxWidth, f(min), accentF(min)), size: min };
}

/** Draws wrapped runs from `top` (their top edge); returns the bottom edge. */
function drawRuns(c: Ctx, lines: Line[], x: number, top: number, size: number, lh: number, f: FontFn, color: string, accent: string, accentF: FontFn = f, align: "left" | "center" = "left", width = 0): number {
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  let y = top;
  for (const line of lines) {
    let w = 0;
    if (align === "center") {
      line.forEach((t, i) => {
        c.font = t.accent ? accentF(size) : f(size);
        w += c.measureText(piece(t, i)).width;
      });
    }
    let cx = align === "center" ? x + (width - w) / 2 : x;
    const base = y + size * 0.86;
    line.forEach((t, i) => {
      const p = piece(t, i);
      c.font = t.accent ? accentF(size) : f(size);
      c.fillStyle = t.accent ? accent : color;
      c.fillText(p, cx, base);
      cx += c.measureText(p).width;
    });
    y += size * lh;
  }
  return y;
}

/** Small tracked capitals (a kicker, a label). Returns its bottom. */
function label(c: Ctx, text: string, x: number, top: number, color: string, size = 26, align: "left" | "right" = "left"): number {
  c.save();
  c.font = font(800, size);
  setSpacing(c, size * 0.16);
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = "alphabetic";
  c.fillText(text.toUpperCase(), x, top + size * 0.82);
  setSpacing(c, 0);
  c.restore();
  return top + size;
}

/* ------------------------------------------------------------------ */
/*  Blocks                                                             */
/* ------------------------------------------------------------------ */

/**
 * A block drawn at a fixed width and any height, set into the slide at its
 * left edge. When it's too tall for `maxH` it's drawn again a step smaller
 * (the canvas scaled, so the words re-wrap to the wider room at a smaller
 * size, never a squashed picture), down to 68%; past that, scaled to fit.
 * Placed at the top, the bottom or the optical middle of its room. Returns
 * the size it was drawn at (1 = as designed).
 */
function place(ctx: Ctx, draw: (c: Ctx, w: number) => number, x: number, top: number, width: number, maxH: number, valign: "top" | "middle" | "bottom" = "middle"): number {
  const off = document.createElement("canvas");
  off.width = width;
  off.height = 3400;
  const c = off.getContext("2d");
  if (!c) return 1;
  let k = 1;
  let h = 0;
  for (const step of [1, 0.93, 0.86, 0.8, 0.74, 0.68]) {
    k = step;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, off.width, off.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    h = Math.max(1, Math.ceil(draw(c, width / k) * k));
    if (h <= maxH) break;
  }
  const s = Math.min(1, maxH / h);
  // "middle" sits a little above the true middle (the optical centre), so a short block never looks dropped
  const y = valign === "middle" ? top + (maxH - h * s) * 0.44 : valign === "bottom" ? top + maxH - h * s : top;
  ctx.drawImage(off, 0, 0, width, h, x, y, width * s, h * s);
  off.width = 0;
  off.height = 0;
  return k * s;
}

/** A tick, a cross or a number in a circle: a list's marker. Returns its size. */
function marker(c: Ctx, kind: "check" | "cross" | "number", n: number, x: number, y: number, d: number, p: Palette, filled: boolean) {
  c.save();
  c.beginPath();
  c.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  if (filled) {
    c.fillStyle = p.accent;
    c.fill();
  } else {
    c.strokeStyle = p.accent;
    c.lineWidth = 4;
    c.stroke();
  }
  const ink = filled ? p.onAccent : p.accent;
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.lineWidth = d * 0.11;
  if (kind === "check") {
    c.beginPath();
    c.moveTo(x + d * 0.29, y + d * 0.53);
    c.lineTo(x + d * 0.44, y + d * 0.67);
    c.lineTo(x + d * 0.72, y + d * 0.36);
    c.stroke();
  } else if (kind === "cross") {
    c.beginPath();
    c.moveTo(x + d * 0.34, y + d * 0.34);
    c.lineTo(x + d * 0.66, y + d * 0.66);
    c.moveTo(x + d * 0.66, y + d * 0.34);
    c.lineTo(x + d * 0.34, y + d * 0.66);
    c.stroke();
  } else {
    c.font = display(d * 0.56);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(n), x + d / 2, y + d / 2 + d * 0.03);
  }
  c.restore();
}

/**
 * The cover's "Swipe" and its arrow, under the hook (a carousel only): in the
 * feed the post's buttons sit over the card's lower right, so the cue lives
 * with the words. Returns its bottom.
 */
function swipeCue(c: Ctx, top: number, p: Palette): number {
  const size = 30;
  c.save();
  c.font = font(800, size);
  setSpacing(c, size * 0.16);
  c.fillStyle = p.accent;
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  c.fillText("SWIPE", 0, top + size * 0.82);
  const w = c.measureText("SWIPE").width;
  setSpacing(c, 0);
  const y = top + size * 0.5;
  const x0 = w + 18;
  c.strokeStyle = p.accent;
  c.lineWidth = 4.5;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  c.moveTo(x0, y);
  c.lineTo(x0 + 58, y);
  c.moveTo(x0 + 42, y - 15);
  c.lineTo(x0 + 58, y);
  c.lineTo(x0 + 42, y + 15);
  c.stroke();
  c.restore();
  return top + size;
}

const PAD = 96;
/** Room kept at the foot for the brand mark (and the cover's swipe cue). */
const FOOT = 104;
/** Room kept at the top: the slide's small label (and the app's counter, which sits over the top right). */
const HEAD = 96;

/** Two numbers as bars, scaled to the bigger: a comparison anyone reads at a glance. */
function statBars(c: Ctx, w: number, top: number, a: { value: string; label: string }, b: { value: string; label: string }, p: Palette): number {
  const num = (v: string) => {
    const m = /\d+(?:\.\d+)?/.exec(v.replace(/,/g, ""));
    return m ? Number(m[0]) : NaN;
  };
  const av = num(a.value);
  const bv = num(b.value);
  const top0 = Number.isFinite(av) && Number.isFinite(bv) ? Math.max(av, bv, 0.0001) : 1;
  let y = top;
  [a, b].forEach((s, i) => {
    const v = num(s.value);
    const share = Number.isFinite(v) ? Math.max(0.08, v / top0) : 1;
    c.font = font(700, 42);
    c.fillStyle = i === 0 ? p.ink : p.sub;
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.fillText(s.label, 0, y + 38);
    c.font = display(64);
    c.textAlign = "right";
    c.fillStyle = i === 0 ? p.accent : p.sub;
    c.fillText(s.value, w, y + 50);
    y += 74;
    c.fillStyle = p.faint;
    roundRect(c, 0, y, w, 30, 15);
    c.fill();
    c.fillStyle = i === 0 ? p.accent : p.line;
    roundRect(c, 0, y, Math.max(30, w * share), 30, 15);
    c.fill();
    y += 30 + (i === 0 ? 44 : 0);
  });
  return y;
}

/* ------------------------------------------------------------------ */
/*  The slides                                                         */
/* ------------------------------------------------------------------ */

/** The small label over a slide that isn't the cover: the deck's kicker, so a swiped-to slide still says what it's part of. */
function slideLabel(deck: PostDeck): string | null {
  const c = deck.slides[0];
  return c?.type === "cover" && c.kicker ? stripEmphasis(c.kicker) : null;
}

/**
 * Paint slide `index` of `deck` onto `ctx` (already sized to L.W × L.H).
 * `art`: the lesson's diagram, for a diagram slide. Returns how far the
 * content had to be scaled to fit (1: as designed).
 */
export function paintDeckSlide(ctx: Ctx, L: DeckLayout, deck: PostDeck, index: number, logo: HTMLImageElement | null, art: Picture | null): number {
  const i = Math.max(0, Math.min(deck.slides.length - 1, index));
  const s = deck.slides[i];
  const p = paletteFor(deck, i);
  const theme = THEME[deck.theme] ?? THEME.paper;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, L.W, L.H);
  const W = L.W - PAD * 2;
  const roomTop = L.top + HEAD;
  const roomH = L.bottom - FOOT - roomTop;
  let scale = 1;

  if (s.type === "cover") {
    // the kicker up top, the hook big and low in the slide, its line under it
    if (s.kicker) label(ctx, stripEmphasis(s.kicker), PAD, L.top + 18, p.accent, 32);
    else {
      ctx.fillStyle = p.accent;
      roundRect(ctx, PAD, L.top + 22, 88, 10, 5);
      ctx.fill();
    }
    const serifHook = theme.hook === "serif";
    scale = place(
      ctx,
      (c, w) => {
        const f = serifHook ? serifUp : sans(900);
        const fa = serifHook ? serifItalic : sans(900);
        const t = fitRuns(c, s.title, w, f, serifHook ? 172 : 156, serifHook ? 92 : 80, 4, fa);
        if (!serifHook) setSpacing(c, -t.size * 0.025);
        let y = drawRuns(c, t.lines, 0, 0, t.size, serifHook ? 1.02 : 1.04, f, p.ink, p.accent, fa);
        setSpacing(c, 0);
        if (s.sub) {
          y += 44;
          c.fillStyle = p.accent;
          c.fillRect(0, y, 64, 6);
          y += 40;
          const sub = fitRuns(c, s.sub, w * 0.94, sans(500), 50, 38, 4);
          y = drawRuns(c, sub.lines, 0, y, sub.size, 1.28, sans(500), p.sub, p.sub);
        }
        if (deck.slides.length > 1) y = swipeCue(c, y + 52, p);
        return y;
      },
      PAD,
      roomTop,
      W,
      roomH,
      "bottom",
    );
    brandRow(ctx, logo, PAD, L.bottom, L.W, null, 0.78, p.ink);
    return scale;
  }

  // every other slide: the deck's label up top, the content centred in its room, the brand at the foot
  const tag = slideLabel(deck);
  if (tag && s.type !== "takeaway") label(ctx, tag, PAD, L.top + 18, p.sub, 28);

  switch (s.type) {
    case "point": {
      // numbered only as a sequence (two or more numbered points), counted in order whatever the model wrote
      const numbered = deck.slides.filter((x) => x.type === "point" && x.n);
      const n = numbered.length >= 2 && s.n ? numbered.indexOf(s) + 1 : 0;
      scale = place(ctx, (c, w) => {
        let y = 0;
        if (n) {
          c.font = display(176);
          c.fillStyle = p.accent;
          c.textAlign = "left";
          c.textBaseline = "alphabetic";
          c.fillText(String(n).padStart(2, "0"), -6, 158);
          y = 196;
        } else {
          c.fillStyle = p.accent;
          c.fillRect(0, 0, 72, 8);
          y = 52;
        }
        const t = fitRuns(c, s.title, w, sans(800), 98, 66, 4);
        setSpacing(c, -t.size * 0.015);
        y = drawRuns(c, t.lines, 0, y, t.size, 1.08, sans(800), p.ink, p.accent);
        setSpacing(c, 0);
        if (s.body) {
          const b = fitRuns(c, s.body, w, sans(500), 54, 40, 6);
          y = drawRuns(c, b.lines, 0, y + 40, b.size, 1.32, sans(500), p.sub, p.sub);
        }
        return y;
      }, PAD, roomTop, W, roomH);
      break;
    }

    case "stat":
      scale = place(ctx, (c, w) => {
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
        // the number as big as the width allows
        let size = 300;
        c.font = display(size);
        while (size > 140 && c.measureText(s.value).width > w) c.font = display((size -= 8));
        c.fillStyle = p.accent;
        c.fillText(s.value, -4, size * 0.9);
        let y = size * 0.9 + 44;
        const l = fitRuns(c, s.label, w, sans(800), 68, 46, 4);
        y = drawRuns(c, l.lines, 0, y, l.size, 1.14, sans(800), p.ink, p.accent);
        if (s.bars?.length === 2) y = statBars(c, w, y + 56, s.bars[0], s.bars[1], p);
        if (s.note) {
          y += 48;
          c.fillStyle = p.line;
          c.fillRect(0, y, w, 2);
          y += 28;
          const n = fitRuns(c, s.note, w, serifItalic, 46, 36, 2);
          y = drawRuns(c, n.lines, 0, y, n.size, 1.2, serifItalic, p.sub, p.sub);
        }
        return y;
      }, PAD, roomTop, W, roomH);
      break;

    case "compare":
      scale = place(ctx, (c, w) => {
        const d = 64;
        const row = (side: { label: string; text: string }, top: number, strong: boolean, kind: "check" | "cross" | null): number => {
          const tx = kind ? d + 32 : 0;
          if (kind) marker(c, kind, 0, 0, top, d, p, strong);
          label(c, side.label, tx, top + 10, strong ? p.accent : p.sub, 30);
          const f = strong ? sans(800) : sans(600);
          const t = fitRuns(c, side.text, w - tx, f, strong ? 84 : 60, strong ? 56 : 44, 4);
          const y0 = top + 64;
          const y = drawRuns(c, t.lines, tx, y0, t.size, strong ? 1.1 : 1.22, f, strong ? p.ink : p.sub, p.accent);
          if (!strong && s.myth) {
            // the belief, struck out
            c.strokeStyle = p.accent;
            c.lineWidth = Math.max(4, t.size * 0.08);
            t.lines.forEach((ln, k) => {
              c.font = f(t.size);
              const lw = ln.reduce((a, tk, j) => a + c.measureText(piece(tk, j)).width, 0);
              const mid = y0 + k * t.size * 1.22 + t.size * 0.55;
              c.beginPath();
              c.moveTo(tx, mid);
              c.lineTo(tx + lw, mid);
              c.stroke();
            });
          }
          return y;
        };
        let y = row(s.left, 0, false, s.myth ? "cross" : null);
        y += 56;
        c.fillStyle = p.line;
        c.fillRect(0, y, w, 2);
        y += 56;
        return row(s.right, y, true, s.myth ? "check" : null);
      }, PAD, roomTop, W, roomH);
      break;

    case "list":
      scale = place(ctx, (c, w) => {
        const t = fitRuns(c, s.title, w, sans(800), 92, 62, 3);
        let y = drawRuns(c, t.lines, 0, 0, t.size, 1.08, sans(800), p.ink, p.accent) + 56;
        const d = 68;
        const style = s.style ?? "check";
        s.items.forEach((item, k) => {
          const top = y;
          marker(c, style, k + 1, 0, top, d, p, style !== "cross" || k === 0);
          const it = fitRuns(c, item, w - d - 36, sans(700), 60, 44, 3);
          const y0 = top + Math.max(0, (d - it.size * 1.2) / 2);
          y = drawRuns(c, it.lines, d + 36, y0, it.size, 1.2, sans(700), p.ink, p.accent);
          y = Math.max(y, top + d) + 42;
        });
        return y - 42;
      }, PAD, roomTop, W, roomH);
      break;

    case "quote":
      scale = place(ctx, (c, w) => {
        c.font = serif(260);
        c.fillStyle = p.accent;
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
        c.fillText("“", -10, 190);
        const q = fitRuns(c, s.text, w, serifUp, 100, 60, 7, serifItalic);
        let y = drawRuns(c, q.lines, 0, 150, q.size, 1.12, serifUp, p.ink, p.accent, serifItalic);
        y += 40;
        c.fillStyle = p.accent;
        c.fillRect(0, y + 12, 44, 5);
        return label(c, s.by, 64, y, p.sub, 30);
      }, PAD, roomTop, W, roomH);
      break;

    case "diagram":
      scale = place(ctx, (c, w) => {
        const t = fitRuns(c, s.title, w, sans(800), 80, 56, 3);
        let y = drawRuns(c, t.lines, 0, 0, t.size, 1.08, sans(800), p.ink, p.accent) + 44;
        if (art) {
          const pad = 44;
          const iw = w - pad * 2;
          const ih = (iw * art.height) / art.width;
          c.fillStyle = p.faint;
          roundRect(c, 0, y, w, ih + pad * 2, 36);
          c.fill();
          c.drawImage(art, pad, y + pad, iw, ih);
          y += ih + pad * 2;
        }
        if (s.note) {
          const n = fitRuns(c, s.note, w, sans(500), 46, 36, 3);
          y = drawRuns(c, n.lines, 0, y + 32, n.size, 1.28, sans(500), p.sub, p.sub);
        }
        return y;
      }, PAD, roomTop, W, roomH);
      break;

    case "takeaway":
      scale = place(ctx, (c, w) => {
        // a short bar, then the line to remember, big, in the hook's face
        c.fillStyle = p.accent;
        c.fillRect(0, 0, 88, 10);
        const serifEnd = theme.hook === "serif";
        const f = serifEnd ? serifUp : sans(900);
        const fa = serifEnd ? serifItalic : sans(900);
        const t = fitRuns(c, s.title, w, f, serifEnd ? 148 : 124, serifEnd ? 84 : 72, 5, fa);
        if (!serifEnd) setSpacing(c, -t.size * 0.02);
        let y = drawRuns(c, t.lines, 0, 64, t.size, serifEnd ? 1.04 : 1.06, f, p.ink, p.accent, fa);
        setSpacing(c, 0);
        if (s.body) {
          const b = fitRuns(c, s.body, w * 0.94, sans(500), 50, 38, 4);
          y = drawRuns(c, b.lines, 0, y + 40, b.size, 1.3, sans(500), p.sub, p.sub);
        }
        return y;
      }, PAD, roomTop, W, roomH);
      break;
  }

  brandRow(ctx, logo, PAD, L.bottom, L.W, null, 0.72, p.ink);
  return scale;
}
