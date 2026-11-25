/**
 * The four cardio overlay styles (Nov 25 2026), each its own typography and
 * composition, drawn in a box of design size BOX_W × (its height) that
 * placeBox (cardio-story.ts) scales and moves inside the story's safe area.
 * Transparent over the photo or clip: only the box's own panel or ink is
 * painted, never a full-picture fill. `mono` is the quiet variant (white on
 * grey, a fine grain on the panel), `phrase` the words the athlete picked.
 */
import { display, fitDisplay, setSpacing } from "@/lib/workout-share-card";
import { ellipsize, roundRect } from "@/lib/workout-story-card";
import { cardioMetrics, stopwatchFace, type CardioMetric, type CardioMetricId, type CardioStoryData } from "@/lib/cardio-story";

type Ctx = CanvasRenderingContext2D;

export type CardioStyle = "treadmill" | "stopwatch" | "heartrate" | "editorial";
export const BOX_W = 920;
export const BOX_H: Record<CardioStyle, number> = { treadmill: 600, stopwatch: 560, heartrate: 580, editorial: 600 };

export type CardioPaint = { phrase: string; data: CardioStoryData | null; hidden: readonly string[]; mono: boolean };

const MONO_FONT = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
const SERIF = `Georgia, "Times New Roman", serif`;
const SANS = `-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
const f = (style: string, weight: number, size: number, family: string) => `${style} ${weight} ${size}px ${family}`.trim();

/** A small seeded generator, so the grain is the same on every repaint of the same overlay. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fine film grain over a rounded panel (the quiet variant's). Subtle: a few thousand 2px specks at low alpha. */
function grain(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const rand = rng(Math.round(w * 31 + h));
  const n = Math.round((w * h) / 120);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.10)";
    ctx.fillRect(x + rand() * w, y + rand() * h, 2, 2);
  }
  ctx.restore();
}
/** A line of text at the size that fits `maxW` (shrinks to `min`, then cut), returns the size. */
function line(ctx: Ctx, text: string, x: number, y: number, maxW: number, o: { fam: string; style?: string; weight: number; size: number; min?: number; color: string; align?: CanvasTextAlign; track?: number }) {
  let size = o.size;
  setSpacing(ctx, (o.track ?? 0) * size);
  ctx.font = f(o.style ?? "", o.weight, size, o.fam);
  while (size > (o.min ?? 20) && ctx.measureText(text).width > maxW) {
    size -= 2;
    setSpacing(ctx, (o.track ?? 0) * size);
    ctx.font = f(o.style ?? "", o.weight, size, o.fam);
  }
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = o.color;
  ctx.fillText(ellipsize(ctx, text, maxW), x, y);
  setSpacing(ctx, 0);
  return size;
}
/** Up to two lines of a phrase, split at the middle space when it doesn't fit on one. */
function twoLines(ctx: Ctx, text: string, maxW: number, setFont: (size: number) => void, size: number, min: number): { lines: string[]; size: number } {
  for (let s = size; s >= min; s -= 2) {
    setFont(s);
    if (ctx.measureText(text).width <= maxW) return { lines: [text], size: s };
  }
  const words = text.split(" ");
  let best = { lines: [text], size: min };
  for (let s = size; s >= min; s -= 2) {
    setFont(s);
    for (let cut = 1; cut < words.length; cut++) {
      const a = words.slice(0, cut).join(" ");
      const b = words.slice(cut).join(" ");
      if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= maxW) return { lines: [a, b], size: s };
    }
    best = { lines: [text], size: s };
  }
  return best;
}

const take = (m: CardioMetric[], ids: readonly CardioMetricId[]) => ids.map((id) => m.find((x) => x.id === id)).filter((x): x is CardioMetric => !!x);
const valueText = (m: CardioMetric) => (m.unit === "%" ? `${m.value}%` : m.value);

/* ---- 1. Retro treadmill console: an LED panel ----------------------- */
function treadmill(ctx: Ctx, p: CardioPaint) {
  const W = BOX_W;
  const H = BOX_H.treadmill;
  const led = p.mono ? "#f1f1f1" : "#ff6a2b";
  ctx.fillStyle = "rgba(10,8,7,0.82)";
  roundRect(ctx, 0, 0, W, H, 40);
  ctx.fill();
  ctx.strokeStyle = p.mono ? "rgba(255,255,255,0.25)" : "rgba(255,106,43,0.45)";
  ctx.lineWidth = 4;
  roundRect(ctx, 6, 6, W - 12, H - 12, 36);
  ctx.stroke();
  if (p.mono) grain(ctx, 0, 0, W, H, 40);
  // the marquee line
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, 36, 36, W - 72, 150, 18);
  ctx.fill();
  const t = twoLines(ctx, p.phrase.toUpperCase(), W - 140, (s) => (ctx.font = f("", 800, s, MONO_FONT)), 56, 30);
  setSpacing(ctx, t.size * 0.06);
  ctx.font = f("", 800, t.size, MONO_FONT);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = led;
  t.lines.forEach((l, i) => ctx.fillText(l, 66, 111 + (i - (t.lines.length - 1) / 2) * (t.size * 1.2)));
  setSpacing(ctx, 0);
  // the readouts: up to six, three across; each its small label over its big LED value
  const cells = take(cardioMetrics(p.data, p.hidden), ["duration", "incline", "speed", "distance", "heartRate", "steps", "week", "sessions"]).slice(0, 6);
  const cw = (W - 72 - 2 * 16) / 3;
  cells.forEach((m, i) => {
    const cx = 36 + (i % 3) * (cw + 16);
    const cy = 208 + Math.floor(i / 3) * 150;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(ctx, cx, cy, cw, 134, 16);
    ctx.fill();
    line(ctx, m.label, cx + 20, cy + 36, cw - 40, { fam: MONO_FONT, weight: 700, size: 24, color: p.mono ? "rgba(255,255,255,0.6)" : "rgba(255,160,110,0.8)", track: 0.12 });
    line(ctx, valueText(m), cx + 20, cy + 106, cw - 40 - (m.unit && m.unit !== "%" ? 70 : 0), { fam: MONO_FONT, weight: 800, size: 70, min: 36, color: led });
    if (m.unit && m.unit !== "%") line(ctx, m.unit, cx + cw - 20, cy + 106, 80, { fam: MONO_FONT, weight: 700, size: 22, color: p.mono ? "rgba(255,255,255,0.6)" : "rgba(255,160,110,0.75)", align: "right" });
  });
  // footer: the brand, small
  line(ctx, "JF EFFECT", W - 36, H - 24, 300, { fam: MONO_FONT, weight: 700, size: 22, color: p.mono ? "rgba(255,255,255,0.5)" : "rgba(255,160,110,0.65)", align: "right", track: 0.3 });
}

/* ---- 2. Digital stopwatch: one big face ------------------------------ */
function stopwatch(ctx: Ctx, p: CardioPaint) {
  const W = BOX_W;
  const H = BOX_H.stopwatch;
  const ink = "#ffffff";
  const accent = p.mono ? "rgba(255,255,255,0.55)" : "#ff3b30";
  ctx.fillStyle = "rgba(14,14,16,0.64)";
  roundRect(ctx, 0, 0, W, H, 56);
  ctx.fill();
  if (p.mono) grain(ctx, 0, 0, W, H, 56);
  const m = cardioMetrics(p.data, p.hidden);
  const face = p.hidden.includes("duration") ? null : stopwatchFace(m.find((x) => x.id === "duration") ? Number(m.find((x) => x.id === "duration")!.value) : null);
  line(ctx, "CARDIO", 56, 84, 400, { fam: SANS, weight: 700, size: 28, color: accent, track: 0.3 });
  dotRow(ctx, W - 56, 70, accent);
  let y = 150;
  if (face) {
    // tabular: each character in its own cell, so the face never shifts
    const chars = [...face];
    const size = Math.min(210, Math.floor((W - 112) / (chars.length * 0.56)));
    ctx.font = f("", 200, size, SANS);
    const cell = size * 0.56;
    const total = chars.reduce((n, c) => n + (c === ":" ? cell * 0.55 : cell), 0);
    let x = (W - total) / 2;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    for (const c of chars) {
      const cw = c === ":" ? cell * 0.55 : cell;
      ctx.fillStyle = c === ":" ? accent : ink;
      ctx.fillText(c, x + cw / 2, y + size * 0.8);
      x += cw;
    }
    y += size * 0.8 + 56;
  } else y += 20;
  // the phrase, centred under (or the headline when there's no clock)
  const big = !face;
  const t = twoLines(ctx, p.phrase, W - 112, (s) => (ctx.font = f("", big ? 700 : 500, s, SANS)), big ? 64 : 38, 26);
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  t.lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * t.size * 1.2));
  y += t.lines.length * t.size * 1.2 + 14;
  // lap chips: up to three small readings
  const chips = take(m, ["incline", "speed", "heartRate", "distance", "steps", "week"]).slice(0, 3);
  if (chips.length) {
    const cw = (W - 112 - (chips.length - 1) * 14) / chips.length;
    chips.forEach((c, i) => {
      const x = 56 + i * (cw + 14);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      roundRect(ctx, x, H - 150, cw, 94, 20);
      ctx.fill();
      line(ctx, c.label, x + cw / 2, H - 118, cw - 20, { fam: SANS, weight: 600, size: 20, color: "rgba(255,255,255,0.6)", align: "center", track: 0.18 });
      line(ctx, `${valueText(c)}${c.unit && c.unit !== "%" ? ` ${c.unit}` : ""}`, x + cw / 2, H - 76, cw - 20, { fam: SANS, weight: 700, size: 36, min: 22, color: ink, align: "center" });
    });
  }
  line(ctx, "JF EFFECT", W / 2, H - 22, 300, { fam: SANS, weight: 600, size: 18, color: "rgba(255,255,255,0.45)", align: "center", track: 0.4 });
}
function dotRow(ctx: Ctx, right: number, y: number, color: string) {
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(right - i * 26, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? color : "rgba(255,255,255,0.28)";
    ctx.fill();
  }
}

/* ---- 3. Heart-rate monitor: the trace, the number -------------------- */
function heartrate(ctx: Ctx, p: CardioPaint) {
  const W = BOX_W;
  const H = BOX_H.heartrate;
  const trace = p.mono ? "#ffffff" : "#3df08a";
  const alert = p.mono ? "#ffffff" : "#ff3b5c";
  ctx.fillStyle = "rgba(6,12,10,0.78)";
  roundRect(ctx, 0, 0, W, H, 36);
  ctx.fill();
  if (p.mono) grain(ctx, 0, 0, W, H, 36);
  // faint monitor grid
  ctx.strokeStyle = p.mono ? "rgba(255,255,255,0.06)" : "rgba(61,240,138,0.08)";
  ctx.lineWidth = 2;
  for (let x = 46; x < W; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, H - 20);
    ctx.stroke();
  }
  for (let y = 46; y < H; y += 46) {
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(W - 20, y);
    ctx.stroke();
  }
  // the trace: flat, then a P-QRS-T beat, repeated
  ctx.strokeStyle = trace;
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const base = 130;
  const beat = 230;
  ctx.moveTo(30, base);
  for (let x = 30; x < W - 30; x += beat) {
    const seg = (dx: number, dy: number) => ctx.lineTo(Math.min(W - 30, x + dx), base + dy);
    seg(50, 0);
    seg(70, -16);
    seg(90, 0);
    seg(110, 0);
    seg(122, 12);
    seg(138, -86);
    seg(156, 52);
    seg(168, 0);
    seg(196, 0);
    seg(210, -22);
    seg(226, 0);
    seg(beat, 0);
  }
  ctx.stroke();
  // the number, in the app's display face (hidden or missing: the phrase leads instead)
  const m = cardioMetrics(p.data, p.hidden);
  const hr = m.find((x) => x.id === "heartRate");
  let y = 236;
  if (hr) {
    ctx.font = display(150);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = alert;
    ctx.fillText("♥", 44, y + 6);
    const ws = ctx.measureText("♥").width;
    ctx.fillStyle = "#ffffff";
    ctx.font = display(170);
    ctx.fillText(hr.value, 44 + ws + 16, y + 10);
    const vw = ctx.measureText(hr.value).width;
    line(ctx, "AVG BPM", 44 + ws + 16 + vw + 20, y - 74, 200, { fam: SANS, weight: 700, size: 30, color: trace, track: 0.2 });
    const zone = m.find((x) => x.id === "zone");
    if (zone) line(ctx, `ZONE ${zone.value}`, 44 + ws + 16 + vw + 20, y - 30, 260, { fam: SANS, weight: 700, size: 28, color: "rgba(255,255,255,0.75)", track: 0.12 });
    y += 66;
  } else y -= 30;
  const dispSize = fitDisplay(ctx, p.phrase.toUpperCase(), W - 88, hr ? 74 : 112, 44);
  ctx.font = display(dispSize);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(p.phrase.toUpperCase(), 44, y + 24);
  const row = take(m, ["duration", "week", "sessions", "streak", "steps", "distance"]).slice(0, 3);
  row.forEach((c, i) => {
    const x = 44 + i * ((W - 88) / 3);
    line(ctx, c.label, x, H - 92, 260, { fam: SANS, weight: 600, size: 20, color: "rgba(255,255,255,0.55)", track: 0.18 });
    line(ctx, `${valueText(c)}${c.unit && c.unit !== "%" ? ` ${c.unit}` : ""}`, x, H - 48, 270, { fam: SANS, weight: 700, size: 38, min: 24, color: "#ffffff" });
  });
  line(ctx, "JF EFFECT", W - 44, 70, 300, { fam: SANS, weight: 700, size: 20, color: "rgba(255,255,255,0.5)", align: "right", track: 0.4 });
}

/* ---- 4. Minimalist editorial: serif, lowercase, hairlines ------------ */
function editorial(ctx: Ctx, p: CardioPaint) {
  const W = BOX_W;
  const H = BOX_H.editorial;
  const ink = "#ffffff";
  const soft = "rgba(255,255,255,0.7)";
  // no panel: a soft scrim only behind the words, so it reads on any picture
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(10,10,12,0.0)");
  g.addColorStop(0.25, "rgba(10,10,12,0.42)");
  g.addColorStop(1, "rgba(10,10,12,0.5)");
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, W, H, 8);
  ctx.fill();
  if (p.mono) grain(ctx, 0, 0, W, H, 8);
  const t = twoLines(ctx, p.phrase, W - 100, (s) => (ctx.font = f("italic", 400, s, SERIF)), 92, 44);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  let y = 150;
  t.lines.forEach((l, i) => ctx.fillText(l, 50, y + i * t.size * 1.12));
  y += t.lines.length * t.size * 1.12 - t.size * 0.4;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(50, y + 16, W - 100, 2);
  // a plain list: label left, value right, hairline between
  const rows = cardioMetrics(p.data, p.hidden).slice(0, 5);
  y += 70;
  rows.forEach((m) => {
    if (y > H - 96) return;
    line(ctx, m.label.toLowerCase(), 50, y, 420, { fam: SERIF, style: "italic", weight: 400, size: 30, color: soft });
    line(ctx, `${valueText(m)}${m.unit && m.unit !== "%" ? ` ${m.unit.toLowerCase()}` : ""}`, W - 50, y, 420, { fam: SERIF, weight: 400, size: 36, color: ink, align: "right" });
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(50, y + 18, W - 100, 1.5);
    y += 62;
  });
  // the brand, spaced out in the corner
  line(ctx, "J F /", W - 50, H - 58, 200, { fam: SERIF, weight: 400, size: 20, color: "rgba(255,255,255,0.6)", align: "right", track: 0.5 });
  line(ctx, "E F F E C T", W - 50, H - 30, 260, { fam: SERIF, weight: 400, size: 20, color: "rgba(255,255,255,0.6)", align: "right", track: 0.5 });
}

export const CARDIO_PAINTERS: Record<CardioStyle, (ctx: Ctx, p: CardioPaint) => void> = { treadmill, stopwatch, heartrate, editorial };
