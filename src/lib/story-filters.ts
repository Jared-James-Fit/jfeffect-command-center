/**
 * Story filters (Nov 22 2026): the fun ones around the story camera's
 * shutter, beside the cards a workout, a lock in and a meal already have.
 * Each is a design painted over the live camera (or a photo from the
 * library) at the story's 1080×1920, or a post's 1080×1350: a grade on the
 * picture underneath (`under`, every frame) and the words and shapes on top
 * (`over`, drawn once a minute and kept, so the camera stays at 30 fps).
 *
 * They're organised in groups (Today, Lock in, Train, Block, Fuel, Time,
 * Mindset, Vibe) that the camera's chips jump between, and the row is
 * ordered for right now (`filterRow`): a session to start puts Lock in
 * first, a workout just finished puts Today first, the time of day picks
 * which Time filter leads.
 *
 * Nothing private ever lands on one: no targets, macros, bodyweight or the
 * coach's day and block names, only what the athlete chose to show (their
 * first name, the public session title "Block 5 · Week 1", a finished
 * workout's own numbers, the clock). Flat colour and scrims only, never a
 * glow (the design system's rule for pictures of posts).
 */
import { RED, INK, MUTED, display, fitDisplay, setSpacing, drawCover, plainBackdrop, SHARE_SIZES, type ShareCardMedia, type ShareFormat } from "@/lib/workout-share-card";
import { font, fitFont, ellipsize, roundRect } from "@/lib/workout-story-card";

type Ctx = CanvasRenderingContext2D;

export type FilterGroup = "today" | "lockin" | "train" | "block" | "fuel" | "time" | "mindset" | "vibe";

/** The chips over the story camera's filters, in their default order. */
export const FILTER_GROUPS: { key: FilterGroup; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "lockin", label: "Lock in" },
  { key: "train", label: "Train" },
  { key: "block", label: "Block" },
  { key: "fuel", label: "Fuel" },
  { key: "time", label: "Time" },
  { key: "mindset", label: "Mindset" },
  { key: "vibe", label: "Vibe" },
];

/** What a filter can show: only what's already the athlete's to share. */
export type FilterContext = {
  now: Date;
  /** First name only. */
  firstName: string | null;
  /** Today's session still to train (its public title), and whether it's started. */
  session: { title: string; started: boolean } | null;
  /** A workout finished in the last day: its own numbers, already formatted. */
  finished: {
    title: string;
    duration: string | null;
    sets: number | null;
    volume: string | null;
    lift: { name: string; detail: string; alt?: string | null; pr: boolean } | null;
    workoutNumber: number | null;
    streakWeeks: number | null;
  } | null;
  /** The block and week, read from the public title ("Block 5 · Week 1"). */
  block: { block: number | null; week: number | null } | null;
  /** A meal now is pre- or post-workout (mealFuelMoment). */
  fuel: "pre" | "post" | null;
};

/** The drawing area: the card's size and the band the story's own bars leave clear. */
export type Area = { W: number; H: number; top: number; bottom: number; PAD: number; story: boolean };

export type StoryFilter = {
  id: string;
  label: string | ((c: FilterContext) => string);
  group: FilterGroup;
  /** On its circle. */
  emoji: string;
  /** Offered only when it has what it needs. */
  when?: (c: FilterContext) => boolean;
  /** Above 0: it fits right now (first in its group). */
  fit?: (c: FilterContext) => number;
  /** The picture under it, every frame (default: the photo or camera, filling the card). */
  under?: (ctx: Ctx, A: Area, media: ShareCardMedia | null) => void;
  /** The design on top, drawn once a minute and kept. */
  over?: (ctx: Ctx, A: Area, c: FilterContext, logo: HTMLImageElement | null) => void;
};

/* ------------------------------------------------------------------ */
/*  Reading the context                                                */
/* ------------------------------------------------------------------ */

/** "Block 5 · Week 1" → { block: 5, week: 1 }; anything else → null (never a guess). */
export function readBlockWeek(title: string | null | undefined): { block: number | null; week: number | null } | null {
  if (!title) return null;
  const b = /\bblock\s*(\d{1,2})\b/i.exec(title);
  const w = /\bweek\s*(\d{1,2})\b/i.exec(title);
  if (!b && !w) return null;
  return { block: b ? Number(b[1]) : null, week: w ? Number(w[1]) : null };
}

const hourOf = (c: FilterContext) => c.now.getHours();
/** 5 AM … 7 AM club: only before 8. */
const earlyHour = (c: FilterContext) => {
  const h = hourOf(c);
  return h >= 3 && h < 8 ? Math.max(4, h) : null;
};
export function clockLabel(d: Date): { time: string; ampm: string } {
  const h = d.getHours();
  const m = d.getMinutes();
  return { time: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, ampm: h < 12 ? "AM" : "PM" };
}
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LINE = ["reset", "new week", "keep it rolling", "halfway", "almost there", "finish strong", "weekend session"];
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
};
const who = (c: FilterContext) => (c.firstName?.trim() || "Me").toUpperCase();

/* ------------------------------------------------------------------ */
/*  Drawing pieces                                                     */
/* ------------------------------------------------------------------ */

const YELLOW = "#facc15";
const GREEN = "#22c55e";
const PAPER = "#f6f3ec";
const INKDARK = "#0a0a0c";

function cover(ctx: Ctx, A: Area, media: ShareCardMedia | null) {
  if (media) drawCover(ctx, media, A.W, A.H);
  else plainBackdrop(ctx, A.W, A.H);
}

/** A scrim from `from` (share of the height) down, so words read on any picture. */
function scrimBottom(ctx: Ctx, A: Area, from = 0.55, max = 0.88) {
  const top = A.H * from;
  const g = ctx.createLinearGradient(0, top, 0, A.H);
  g.addColorStop(0, "rgba(8,8,11,0)");
  g.addColorStop(0.55, `rgba(8,8,11,${(max * 0.7).toFixed(2)})`);
  g.addColorStop(1, `rgba(8,8,11,${max})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, top, A.W, A.H - top);
}
function scrimTop(ctx: Ctx, A: Area, h: number, max = 0.55) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(8,8,11,${max})`);
  g.addColorStop(1, "rgba(8,8,11,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A.W, h);
}
function dim(ctx: Ctx, A: Area, a: number) {
  ctx.fillStyle = `rgba(8,8,11,${a})`;
  ctx.fillRect(0, 0, A.W, A.H);
}

/** Display type at the size that fits, left / centre / right at x. Returns the size used. */
function big(ctx: Ctx, text: string, x: number, y: number, maxW: number, start: number, color = INK, align: CanvasTextAlign = "left", min = 48) {
  const size = fitDisplay(ctx, text, maxW, start, min);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return size;
}
/** A line of sans text, cut to fit. */
function say(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, weight = 700, color = INK, align: CanvasTextAlign = "left", tracking = 0) {
  ctx.font = font(weight, size);
  setSpacing(ctx, tracking);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(ellipsize(ctx, text, maxW), x, y);
  setSpacing(ctx, 0);
}
/** A rounded pill with words in it at (x, y) top-left. Returns its width. */
function tag(ctx: Ctx, text: string, x: number, y: number, o: { bg: string; ink: string; size?: number; h?: number; align?: "left" | "center" | "right" } = { bg: RED, ink: INK }) {
  const size = o.size ?? 28;
  const h = o.h ?? Math.round(size * 2);
  ctx.save();
  ctx.font = font(900, size);
  setSpacing(ctx, size * 0.14);
  const w = ctx.measureText(text).width + size * 1.8;
  const left = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
  ctx.fillStyle = o.bg;
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = o.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + size * 0.9, y + h / 2 + size * 0.04);
  setSpacing(ctx, 0);
  ctx.restore();
  return w;
}
function rule(ctx: Ctx, x: number, y: number, w: number, h = 10, color = RED) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
/** A filled circle (dots, the REC light, the moon's body). */
function dot(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
/** A crescent moon, its centre at (x, y). */
function moon(ctx: Ctx, x: number, y: number, r: number, color = INK) {
  ctx.save();
  // everything but the bite out of it
  ctx.beginPath();
  ctx.rect(x - r * 2, y - r * 2, r * 4, r * 4);
  ctx.arc(x + r * 0.42, y - r * 0.24, r * 0.86, 0, Math.PI * 2, true);
  ctx.clip("evenodd");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}
function check(ctx: Ctx, x: number, y: number, s: number, color: string, width = s * 0.16) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y + s * 0.02);
  ctx.lineTo(x - s * 0.12, y + s * 0.32);
  ctx.lineTo(x + s * 0.46, y - s * 0.3);
  ctx.stroke();
  ctx.restore();
}

/** Caution tape across the picture: yellow, black words repeated, turned `angle` (radians) about (cx, cy). */
function tape(ctx: Ctx, A: Area, text: string, cy: number, angle: number, h = 128) {
  ctx.save();
  ctx.translate(A.W / 2, cy);
  ctx.rotate(angle);
  const w = A.W * 1.6;
  ctx.fillStyle = YELLOW;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = INKDARK;
  ctx.fillRect(-w / 2, -h / 2 + 8, w, 6);
  ctx.fillRect(-w / 2, h / 2 - 14, w, 6);
  ctx.font = display(Math.round(h * 0.6));
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const unit = `${text}   ✕   `;
  const uw = ctx.measureText(unit).width;
  for (let x = -w / 2 + 20; x < w / 2; x += uw) ctx.fillText(unit, x, 4);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Grades (Vibe): the picture itself, cheaply, in every browser       */
/* ------------------------------------------------------------------ */

let grain: HTMLCanvasElement | null = null;
function grainPattern(ctx: Ctx): CanvasPattern | null {
  if (typeof document === "undefined") return null;
  if (!grain) {
    grain = document.createElement("canvas");
    grain.width = 160;
    grain.height = 160;
    const g = grain.getContext("2d");
    if (!g) return null;
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.floor(Math.random() * 60);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(grain, "repeat");
}
function blend(ctx: Ctx, A: Area, mode: GlobalCompositeOperation, color: string, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, A.W, A.H);
  ctx.restore();
}
function vignette(ctx: Ctx, A: Area, strength = 0.55) {
  const r = Math.hypot(A.W, A.H) / 2;
  const g = ctx.createRadialGradient(A.W / 2, A.H / 2, r * 0.45, A.W / 2, A.H / 2, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, A.W, A.H);
}
function graded(fn: (ctx: Ctx, A: Area) => void) {
  return (ctx: Ctx, A: Area, media: ShareCardMedia | null) => {
    cover(ctx, A, media);
    fn(ctx, A);
  };
}

/* ------------------------------------------------------------------ */
/*  The catalogue                                                      */
/* ------------------------------------------------------------------ */

/** A big two-line word at the foot: "PUSH" outlined over "DAY", with a line under. */
function dayWord(word: string, sub: string) {
  return (ctx: Ctx, A: Area) => {
    scrimBottom(ctx, A, 0.5);
    const x = A.PAD;
    const maxW = A.W - A.PAD * 2;
    let y = A.bottom - 10;
    say(ctx, sub.toUpperCase(), x, y, maxW, 30, 800, MUTED, "left", 4);
    y -= 56;
    const s2 = big(ctx, "DAY", x - 4, y, maxW, A.story ? 210 : 170, RED);
    y -= s2 * 0.9;
    const s1 = fitDisplay(ctx, word, maxW, A.story ? 260 : 200, 80);
    ctx.lineWidth = Math.max(6, s1 * 0.035);
    ctx.strokeStyle = INK;
    ctx.lineJoin = "round";
    ctx.textAlign = "left";
    ctx.strokeText(word, x - 4, y);
  };
}

/** One lift, huge, on a flat red band at the foot. */
function liftDay(word: string) {
  return (ctx: Ctx, A: Area) => {
    const bandH = A.story ? 330 : 280;
    const top = A.bottom - bandH;
    ctx.fillStyle = RED;
    ctx.fillRect(0, top, A.W, bandH + (A.H - A.bottom));
    say(ctx, "TODAY IS", A.PAD, top + 66, A.W - A.PAD * 2, 32, 900, "rgba(255,255,255,0.85)", "left", 6);
    big(ctx, `${word} DAY`, A.PAD - 4, top + bandH - 50, A.W - A.PAD * 2, 230, INK, "left", 90);
  };
}

const FILTERS: StoryFilter[] = [
  /* ---- Today: the session on screen right now --------------------- */
  {
    id: "done",
    label: "Session done",
    group: "today",
    emoji: "✅",
    when: (c) => !!c.finished,
    fit: () => 3,
    over: (ctx, A, c) => {
      const f = c.finished!;
      scrimBottom(ctx, A, 0.42);
      const maxW = A.W - A.PAD * 2;
      let y = A.bottom - 10;
      const parts = [f.duration, f.sets ? `${f.sets} sets` : null, f.volume].filter(Boolean) as string[];
      if (parts.length) {
        say(ctx, parts.join("  ·  "), A.PAD, y, maxW, 40, 800, INK);
        y -= 64;
      }
      say(ctx, f.title, A.PAD, y, maxW, 34, 700, MUTED);
      y -= 48;
      const s = big(ctx, "DONE.", A.PAD - 6, y, maxW, A.story ? 300 : 240);
      // the check, in green, tucked after the word
      ctx.font = display(s);
      const w = ctx.measureText("DONE.").width;
      if (A.PAD + w + s * 0.55 < A.W - A.PAD) check(ctx, A.PAD + w + s * 0.3, y - s * 0.36, s * 0.42, GREEN);
    },
  },
  {
    id: "topset",
    label: "Top set",
    group: "today",
    emoji: "🏋️",
    when: (c) => !!c.finished?.lift,
    fit: (c) => (c.finished?.lift?.pr ? 4 : 2),
    over: (ctx, A, c) => {
      const l = c.finished!.lift!;
      scrimBottom(ctx, A, 0.4);
      const maxW = A.W - A.PAD * 2;
      let y = A.bottom - 10;
      if (l.alt) {
        say(ctx, l.alt, A.PAD, y, maxW, 38, 700, MUTED);
        y -= 58;
      }
      const s = big(ctx, l.detail.toUpperCase(), A.PAD - 4, y, maxW, A.story ? 210 : 170, l.pr ? "#f59e0b" : INK, "left", 70);
      y -= s * 0.92 + 22;
      say(ctx, l.name.toUpperCase(), A.PAD, y, maxW, 40, 900, INK, "left", 3);
      y -= 76;
      tag(ctx, l.pr ? "ALL-TIME PR" : "TOP SET", A.PAD, y - 56, { bg: l.pr ? "#f59e0b" : INK, ink: INKDARK });
    },
  },
  {
    id: "monthcount",
    label: "This month",
    group: "today",
    emoji: "📅",
    when: (c) => !!c.finished?.workoutNumber,
    over: (ctx, A, c) => {
      const n = c.finished!.workoutNumber!;
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      say(ctx, `WORKOUT THIS MONTH · ${MONTH[c.now.getMonth()].toUpperCase()}`, A.PAD, A.bottom - 10, maxW, 32, 800, MUTED, "left", 3);
      big(ctx, ordinal(n).toUpperCase(), A.PAD - 6, A.bottom - 70, maxW, A.story ? 380 : 300, INK);
    },
  },
  {
    id: "streakweeks",
    label: "Weeks in a row",
    group: "today",
    emoji: "🔥",
    when: (c) => (c.finished?.streakWeeks ?? 0) >= 2,
    over: (ctx, A, c) => {
      const n = c.finished!.streakWeeks!;
      scrimBottom(ctx, A, 0.45);
      const maxW = A.W - A.PAD * 2;
      say(ctx, "WEEKS IN A ROW", A.PAD, A.bottom - 10, maxW, 40, 900, INK, "left", 4);
      const s = big(ctx, String(n), A.PAD - 8, A.bottom - 76, maxW * 0.7, A.story ? 420 : 320, "#f59e0b");
      // a row of weeks under the number's top, one block each (the last eight at most)
      const shown = Math.min(n, 8);
      const bw = 46;
      for (let i = 0; i < shown; i++) {
        ctx.fillStyle = i === shown - 1 ? "#f59e0b" : "rgba(255,255,255,0.85)";
        roundRect(ctx, A.PAD + i * (bw + 12), A.bottom - 76 - s * 0.95 - 64, bw, 34, 8);
        ctx.fill();
      }
    },
  },

  /* ---- Lock in ----------------------------------------------------- */
  {
    id: "lockedin",
    label: "Locked in",
    group: "lockin",
    emoji: "🔒",
    // the session's own Locked in card covers it when there's one today
    when: (c) => !c.session,
    over: (ctx, A, c) => {
      scrimBottom(ctx, A, 0.45);
      const maxW = A.W - A.PAD * 2;
      const { time, ampm } = clockLabel(c.now);
      let y = A.bottom - 10;
      say(ctx, `${time} ${ampm}`, A.PAD, y, maxW, 40, 800, MUTED, "left", 2);
      y -= 70;
      const s = big(ctx, "LOCKED IN", A.PAD - 4, y, maxW, A.story ? 250 : 210, INK, "left", 120);
      ctx.font = display(s);
      rule(ctx, A.PAD, y + 18, Math.min(maxW, ctx.measureText("LOCKED IN").width), 10);
    },
  },
  {
    id: "dnd",
    label: "Do not disturb",
    group: "lockin",
    emoji: "🌙",
    over: (ctx, A, c) => {
      const w = A.W - A.PAD * 1.4;
      const x = (A.W - w) / 2;
      const y = A.top + (A.story ? 30 : 10);
      const h = 168;
      ctx.fillStyle = "rgba(28,28,32,0.82)";
      roundRect(ctx, x, y, w, h, 44);
      ctx.fill();
      // the Focus icon: a moon in a purple-free dark circle
      dot(ctx, x + 92, y + h / 2, 52, "#3a3a44");
      moon(ctx, x + 88, y + h / 2 + 2, 26, INK);
      say(ctx, "Gym Focus", x + 168, y + 74, w - 360, 44, 800, INK);
      say(ctx, "Notifications silenced", x + 168, y + 124, w - 360, 32, 600, "rgba(255,255,255,0.65)");
      tag(ctx, "ON", x + w - 40, y + (h - 66) / 2, { bg: INK, ink: INKDARK, size: 28, h: 66, align: "right" });
      void c;
    },
  },
  {
    id: "nowplaying",
    label: "Now playing",
    group: "lockin",
    emoji: "🎧",
    over: (ctx, A, c, logo) => {
      const w = A.W - A.PAD * 1.4;
      const x = (A.W - w) / 2;
      const h = 300;
      const y = A.bottom - h;
      ctx.fillStyle = "rgba(24,24,28,0.84)";
      roundRect(ctx, x, y, w, h, 48);
      ctx.fill();
      const art = 150;
      ctx.fillStyle = RED;
      roundRect(ctx, x + 40, y + 40, art, art, 24);
      ctx.fill();
      if (logo) {
        ctx.save();
        roundRect(ctx, x + 40 + 30, y + 40 + 30, art - 60, art - 60, 16);
        ctx.clip();
        ctx.drawImage(logo, x + 70, y + 70, art - 60, art - 60);
        ctx.restore();
      }
      const tx = x + 40 + art + 36;
      const tw = w - (tx - x) - 40;
      say(ctx, "Lock In Mix", tx, y + 96, tw, 46, 800, INK);
      say(ctx, c.firstName?.trim() ? `${c.firstName.trim()}'s gym playlist` : "Gym playlist", tx, y + 146, tw, 32, 600, "rgba(255,255,255,0.6)");
      // progress
      const py = y + 232;
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      roundRect(ctx, x + 40, py, w - 80, 10, 5);
      ctx.fill();
      ctx.fillStyle = INK;
      roundRect(ctx, x + 40, py, (w - 80) * 0.42, 10, 5);
      ctx.fill();
      dot(ctx, x + 40 + (w - 80) * 0.42, py + 5, 14, INK);
      say(ctx, "1:24", x + 40, py + 48, 200, 26, 700, "rgba(255,255,255,0.6)");
      say(ctx, "-2:31", x + w - 40, py + 48, 200, 26, 700, "rgba(255,255,255,0.6)", "right");
      // pause, between back and next
      const cx = x + w / 2;
      const cy = py + 34;
      ctx.fillStyle = INK;
      ctx.fillRect(cx - 16, cy - 20, 10, 40);
      ctx.fillRect(cx + 6, cy - 20, 10, 40);
      for (const dir of [-1, 1]) {
        const bx = cx + dir * 110;
        ctx.beginPath();
        ctx.moveTo(bx - dir * 14, cy - 18);
        ctx.lineTo(bx + dir * 10, cy);
        ctx.lineTo(bx - dir * 14, cy + 18);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(bx + dir * 10 - (dir > 0 ? 0 : 5), cy - 18, 5, 36);
      }
    },
  },
  {
    id: "headphones",
    label: "Headphones in",
    group: "lockin",
    emoji: "🎶",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      big(ctx, "WORLD OUT.", A.PAD - 4, A.bottom - 10, maxW, A.story ? 200 : 160, RED, "left", 80);
      big(ctx, "HEADPHONES IN.", A.PAD - 4, A.bottom - (A.story ? 200 : 165), maxW, A.story ? 200 : 160, INK, "left", 80);
    },
  },
  {
    id: "gameface",
    label: "Game face",
    group: "lockin",
    emoji: "😤",
    over: (ctx, A) => {
      dim(ctx, A, 0.12);
      ctx.save();
      ctx.translate(A.W / 2, A.top + (A.bottom - A.top) * 0.72);
      ctx.rotate(-0.09);
      const w = A.W * 0.78;
      const h = A.story ? 240 : 200;
      ctx.lineWidth = 14;
      ctx.strokeStyle = RED;
      roundRect(ctx, -w / 2, -h / 2, w, h, 26);
      ctx.stroke();
      ctx.fillStyle = RED;
      ctx.font = display(h * 0.5);
      fitDisplay(ctx, "GAME FACE ON", w - 80, h * 0.56, 60);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GAME FACE ON", 0, 8);
      ctx.restore();
    },
  },

  /* ---- Train -------------------------------------------------------- */
  {
    id: "legday",
    label: "Leg day",
    group: "train",
    emoji: "🦵",
    over: (ctx, A) => {
      tape(ctx, A, "LEG DAY", A.top + (A.bottom - A.top) * 0.18, -0.1);
      tape(ctx, A, "LEG DAY", A.bottom - (A.bottom - A.top) * 0.1, 0.07);
    },
  },
  { id: "pushday", label: "Push day", group: "train", emoji: "💥", over: dayWord("PUSH", "chest · shoulders · triceps") },
  { id: "pullday", label: "Pull day", group: "train", emoji: "🪢", over: dayWord("PULL", "back · biceps · rear delts") },
  { id: "armday", label: "Arm day", group: "train", emoji: "💪", over: dayWord("ARM", "biceps · triceps · forearms") },
  { id: "squatday", label: "Squat day", group: "train", emoji: "🏋️", over: liftDay("SQUAT") },
  { id: "benchday", label: "Bench day", group: "train", emoji: "🛋️", over: liftDay("BENCH") },
  { id: "deadliftday", label: "Deadlift day", group: "train", emoji: "🪨", over: liftDay("DEADLIFT") },
  {
    id: "heavyday",
    label: "Heavy day",
    group: "train",
    emoji: "🥊",
    over: (ctx, A, c) => {
      // a fight poster: flat bands top and bottom
      const band = A.story ? 300 : 230;
      ctx.fillStyle = INKDARK;
      ctx.fillRect(0, 0, A.W, A.top + band * 0.55);
      ctx.fillRect(0, A.bottom - band * 0.9, A.W, A.H - A.bottom + band * 0.9);
      rule(ctx, 0, A.top + band * 0.55, A.W, 12);
      rule(ctx, 0, A.bottom - band * 0.9 - 12, A.W, 12);
      say(ctx, "TONIGHT ONLY", A.W / 2, A.top + band * 0.55 - 40, A.W - A.PAD * 2, 38, 900, YELLOW, "center", 10);
      const maxW = A.W - A.PAD * 2;
      const s = big(ctx, who(c), A.W / 2, A.bottom - band * 0.9 + (A.story ? 160 : 120), maxW, A.story ? 150 : 120, INK, "center", 60);
      say(ctx, "VS. THE BAR", A.W / 2, A.bottom - band * 0.9 + (A.story ? 160 : 120) + Math.min(70, s * 0.5), maxW, 44, 900, RED, "center", 6);
      say(ctx, "HEAVY DAY · NO REFUNDS", A.W / 2, A.bottom - 10, maxW, 26, 800, MUTED, "center", 6);
    },
  },
  {
    id: "prattempt",
    label: "PR attempt",
    group: "train",
    emoji: "🎯",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.45);
      const maxW = A.W - A.PAD * 2;
      const r = 58;
      const cy = A.bottom - (A.story ? 300 : 250);
      ["3", "2", "1"].forEach((n, i) => {
        const cx = A.PAD + r + i * (r * 2 + 34);
        ctx.lineWidth = 8;
        ctx.strokeStyle = i === 2 ? RED : INK;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = display(70);
        ctx.fillStyle = i === 2 ? RED : INK;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n, cx, cy + 4);
      });
      big(ctx, "PR ATTEMPT", A.PAD - 4, A.bottom - 10, maxW, A.story ? 210 : 170, INK, "left", 90);
    },
  },
  {
    id: "rec",
    label: "Training cam",
    group: "train",
    emoji: "🎥",
    over: (ctx, A, c) => {
      const inset = A.PAD * 0.7;
      const t = A.top - (A.story ? 40 : 0);
      const b = A.bottom + (A.story ? 40 : 0);
      const arm = 90;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.lineCap = "square";
      const corner = (x: number, y: number, dx: number, dy: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * arm);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * arm, y);
        ctx.stroke();
      };
      corner(inset, t, 1, 1);
      corner(A.W - inset, t, -1, 1);
      corner(inset, b, 1, -1);
      corner(A.W - inset, b, -1, -1);
      dot(ctx, inset + 64, t + 76, 18, RED);
      say(ctx, "REC", inset + 98, t + 90, 200, 40, 900, INK, "left", 4);
      const hh = String(c.now.getHours()).padStart(2, "0");
      const mm = String(c.now.getMinutes()).padStart(2, "0");
      say(ctx, `${hh}:${mm}:00`, A.W - inset - 40, t + 90, 300, 40, 800, INK, "right", 3);
      say(ctx, "1080p · 30", inset + 40, b - 50, 400, 30, 800, INK, "left", 3);
      const date = `${MONTH[c.now.getMonth()].slice(0, 3).toUpperCase()} ${c.now.getDate()} ${c.now.getFullYear()}`;
      say(ctx, date, A.W - inset - 40, b - 50, 400, 30, 800, INK, "right", 3);
      // the battery, top right under the clock
      const bx = A.W - inset - 120;
      const by = t + 116;
      ctx.lineWidth = 5;
      ctx.strokeRect(bx, by, 72, 34);
      ctx.fillStyle = INK;
      ctx.fillRect(bx + 76, by + 10, 7, 14);
      ctx.fillRect(bx + 7, by + 7, 44, 20);
    },
  },
  {
    id: "polaroid",
    label: "Polaroid",
    group: "train",
    emoji: "📸",
    under: (ctx, A, media) => {
      plainBackdrop(ctx, A.W, A.H);
      const w = A.W * (A.story ? 0.8 : 0.72);
      const ph = w * 1.08;
      const frameH = ph + w * 0.06 + (A.story ? 230 : 180);
      const x = (A.W - w) / 2;
      const y = A.top + (A.bottom - A.top - frameH) / 2;
      ctx.save();
      ctx.translate(A.W / 2, y + frameH / 2);
      ctx.rotate(-0.035);
      ctx.translate(-A.W / 2, -(y + frameH / 2));
      ctx.fillStyle = PAPER;
      ctx.fillRect(x - w * 0.06, y - w * 0.06, w + w * 0.12, frameH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, ph);
      ctx.clip();
      ctx.translate(x, y);
      if (media) drawCover(ctx, media, w, ph);
      else {
        ctx.fillStyle = "#2c2c31";
        ctx.fillRect(0, 0, w, ph);
      }
      ctx.restore();
      ctx.restore();
    },
    over: (ctx, A, c) => {
      const w = A.W * (A.story ? 0.8 : 0.72);
      const ph = w * 1.08;
      const frameH = ph + w * 0.06 + (A.story ? 230 : 180);
      const y = A.top + (A.bottom - A.top - frameH) / 2;
      ctx.save();
      ctx.translate(A.W / 2, y + frameH / 2);
      ctx.rotate(-0.035);
      const capY = -frameH / 2 + ph + (A.story ? 130 : 105);
      ctx.font = `italic 600 ${A.story ? 58 : 48}px "Marker Felt", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive`;
      ctx.fillStyle = "#1c1c20";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const day = `${MONTH[c.now.getMonth()].slice(0, 3)} ${c.now.getDate()}`;
      ctx.fillText(ellipsize(ctx, `${day} · gym`, w - 60), 0, capY);
      ctx.restore();
    },
  },
  {
    id: "cardio",
    label: "Cardio",
    group: "train",
    emoji: "❤️",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const y = A.bottom - (A.story ? 330 : 280);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 10;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      const pts: [number, number][] = [
        [0, 0], [0.28, 0], [0.33, -0.25], [0.38, 0.12], [0.44, -1], [0.5, 0.5], [0.55, 0], [0.62, 0], [0.66, -0.18], [0.7, 0], [1, 0],
      ];
      pts.forEach(([px, py], i) => {
        const X = A.PAD * 0.5 + px * (A.W - A.PAD);
        const Y = y + py * 110;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      dot(ctx, A.PAD * 0.5 + 0.44 * (A.W - A.PAD), y - 110, 16, RED);
      big(ctx, "CARDIO", A.PAD - 4, A.bottom - 10, A.W - A.PAD * 2, A.story ? 230 : 190, INK, "left", 90);
    },
  },
  {
    id: "restday",
    label: "Rest day",
    group: "train",
    emoji: "😴",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      moon(ctx, A.W - A.PAD - 70, A.top + 110, 64, INK);
      ctx.font = font(800, 44);
      ctx.fillStyle = INK;
      ctx.textAlign = "left";
      ctx.fillText("z", A.W - A.PAD - 220, A.top + 120);
      ctx.font = font(800, 60);
      ctx.fillText("z", A.W - A.PAD - 190, A.top + 70);
      const maxW = A.W - A.PAD * 2;
      say(ctx, "RECOVERY IS PART OF IT", A.PAD, A.bottom - 10, maxW, 34, 800, MUTED, "left", 4);
      big(ctx, "REST DAY", A.PAD - 4, A.bottom - 70, maxW, A.story ? 240 : 200, INK, "left", 100);
    },
  },

  /* ---- Block --------------------------------------------------------- */
  {
    id: "blockweek",
    label: "Block & week",
    group: "block",
    emoji: "🧱",
    when: (c) => !!c.block && (c.block.block != null || c.block.week != null),
    fit: () => 2,
    over: (ctx, A, c) => {
      const b = c.block!;
      scrimBottom(ctx, A, 0.42);
      const cols = [b.block != null ? { k: "BLOCK", v: String(b.block) } : null, b.week != null ? { k: "WEEK", v: String(b.week) } : null].filter(Boolean) as { k: string; v: string }[];
      const colW = (A.W - A.PAD * 2) / cols.length;
      const size = A.story ? 400 : 320;
      cols.forEach((col, i) => {
        const x = A.PAD + i * colW + (i ? 40 : 0);
        say(ctx, col.k, x, A.bottom - size * 0.92 - 40, colW, 40, 900, i ? RED : INK, "left", 8);
        big(ctx, col.v, x - 6, A.bottom - 10, colW - 60, size, INK, "left", 120);
      });
      if (cols.length === 2) rule(ctx, A.PAD + colW - 4, A.bottom - size * 0.92 - 80, 8, size * 0.92 + 70);
    },
  },
  {
    id: "weekticks",
    label: "Week by week",
    group: "block",
    emoji: "📈",
    when: (c) => (c.block?.week ?? 0) >= 1,
    over: (ctx, A, c) => {
      const n = Math.min(16, c.block!.week!);
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      // a box for every week done so far and one for the next
      const boxes = n + 1;
      const gap = 14;
      const bw = Math.min(72, (maxW - gap * (boxes - 1)) / boxes);
      const y = A.bottom - 60;
      for (let i = 0; i < boxes; i++) {
        const x = A.PAD + i * (bw + gap);
        if (i < n) {
          ctx.fillStyle = i === n - 1 ? RED : INK;
          roundRect(ctx, x, y, bw, 60, 12);
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 5;
          roundRect(ctx, x + 2.5, y + 2.5, bw - 5, 55, 11);
          ctx.stroke();
        }
      }
      big(ctx, `WEEK ${n}`, A.PAD - 4, y - 40, maxW, A.story ? 260 : 210, INK, "left", 100);
      if (c.block?.block != null) say(ctx, `BLOCK ${c.block.block}`, A.PAD, y - 40 - (A.story ? 260 : 210) * 0.92 - 20, maxW, 38, 900, MUTED, "left", 8);
    },
  },
  {
    id: "deload",
    label: "Deload week",
    group: "block",
    emoji: "🛑",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.55);
      // a road sign
      const s = A.story ? 300 : 240;
      const cx = A.W / 2;
      const cy = A.top + (A.bottom - A.top) * (A.story ? 0.56 : 0.5);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = YELLOW;
      roundRect(ctx, -s / 2, -s / 2, s, s, 28);
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = INKDARK;
      roundRect(ctx, -s / 2 + 20, -s / 2 + 20, s - 40, s - 40, 18);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = INKDARK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = display(Math.round(s * 0.22));
      fitDisplay(ctx, "DELOAD", s * 0.9, Math.round(s * 0.24), 40);
      ctx.fillText("DELOAD", cx, cy - s * 0.06);
      ctx.font = font(900, Math.round(s * 0.09));
      ctx.fillText("AHEAD", cx, cy + s * 0.16);
      say(ctx, "BACK OFF NOW, COME BACK STRONGER", A.W / 2, A.bottom - 10, A.W - A.PAD * 2, 32, 800, INK, "center", 3);
    },
  },
  {
    id: "peakweek",
    label: "Peak week",
    group: "block",
    emoji: "⛰️",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.45);
      const base = A.bottom - (A.story ? 300 : 250);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 9;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const L = A.PAD * 0.5;
      const R = A.W - A.PAD * 0.5;
      const w = R - L;
      ctx.moveTo(L, base);
      ctx.lineTo(L + w * 0.22, base - 110);
      ctx.lineTo(L + w * 0.34, base - 60);
      ctx.lineTo(L + w * 0.56, base - 250);
      ctx.lineTo(L + w * 0.72, base - 120);
      ctx.lineTo(L + w * 0.8, base - 160);
      ctx.lineTo(R, base);
      ctx.stroke();
      // the flag on the top
      const fx = L + w * 0.56;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(fx, base - 250);
      ctx.lineTo(fx, base - 340);
      ctx.stroke();
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.moveTo(fx, base - 340);
      ctx.lineTo(fx + 70, base - 318);
      ctx.lineTo(fx, base - 296);
      ctx.closePath();
      ctx.fill();
      big(ctx, "PEAK WEEK", A.PAD - 4, A.bottom - 10, A.W - A.PAD * 2, A.story ? 230 : 190, INK, "left", 100);
    },
  },
  {
    id: "meetday",
    label: "Meet day",
    group: "block",
    emoji: "🏆",
    over: (ctx, A, c) => {
      dim(ctx, A, 0.18);
      // an athlete's pass on a lanyard
      const w = A.W * (A.story ? 0.62 : 0.5);
      const h = w * 1.36;
      const x = (A.W - w) / 2;
      const y = A.bottom - h - (A.story ? 30 : 0);
      ctx.strokeStyle = RED;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 10);
      ctx.lineTo(A.W / 2 - 120, 0);
      ctx.moveTo(x + w * 0.7, y + 10);
      ctx.lineTo(A.W / 2 + 120, 0);
      ctx.stroke();
      ctx.fillStyle = PAPER;
      roundRect(ctx, x, y, w, h, 30);
      ctx.fill();
      ctx.fillStyle = RED;
      ctx.fillRect(x, y + h * 0.16, w, h * 0.17);
      ctx.fillStyle = "#cfcac0";
      roundRect(ctx, A.W / 2 - 50, y + 26, 100, 22, 11);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = display(Math.round(h * 0.1));
      ctx.fillText("ATHLETE", A.W / 2, y + h * 0.247);
      ctx.fillStyle = INKDARK;
      ctx.font = display(Math.round(h * 0.14));
      fitDisplay(ctx, who(c), w - 80, Math.round(h * 0.14), 40);
      ctx.fillText(who(c), A.W / 2, y + h * 0.48);
      ctx.font = font(900, Math.round(h * 0.05));
      setSpacing(ctx, 6);
      ctx.fillText("MEET DAY", A.W / 2, y + h * 0.6);
      setSpacing(ctx, 0);
      ctx.font = font(700, Math.round(h * 0.04));
      ctx.fillStyle = "#55555c";
      ctx.fillText(`${MONTH[c.now.getMonth()]} ${c.now.getDate()}, ${c.now.getFullYear()}`, A.W / 2, y + h * 0.68);
      // a barcode
      let bx = x + w * 0.16;
      const end = x + w * 0.84;
      let k = 7;
      ctx.fillStyle = INKDARK;
      while (bx < end) {
        k = (k * 31 + 11) % 97;
        const bw = 3 + (k % 4) * 3;
        ctx.fillRect(bx, y + h * 0.77, bw, h * 0.13);
        bx += bw + 4 + (k % 3) * 2;
      }
    },
  },
  {
    id: "newblock",
    label: "New block",
    group: "block",
    emoji: "🆕",
    over: (ctx, A, c) => {
      scrimBottom(ctx, A, 0.45);
      const maxW = A.W - A.PAD * 2;
      const label = c.block?.block != null ? `BLOCK ${c.block.block}` : "NEW BLOCK";
      say(ctx, label, A.PAD, A.bottom - 10, maxW, 40, 900, RED, "left", 8);
      big(ctx, "DAY 1", A.PAD - 6, A.bottom - 76, maxW, A.story ? 380 : 300, INK, "left", 120);
    },
  },

  /* ---- Fuel (never a number from their plan) -------------------------- */
  {
    id: "earned",
    label: "Earned it",
    group: "fuel",
    emoji: "🍕",
    over: (ctx, A) => {
      ctx.save();
      ctx.translate(A.W / 2, A.top + (A.bottom - A.top) * 0.62);
      ctx.rotate(-0.16);
      const w = A.W * 0.72;
      const h = A.story ? 250 : 210;
      ctx.globalAlpha = 0.92;
      ctx.lineWidth = 16;
      ctx.strokeStyle = RED;
      roundRect(ctx, -w / 2, -h / 2, w, h, 22);
      ctx.stroke();
      ctx.lineWidth = 5;
      roundRect(ctx, -w / 2 + 22, -h / 2 + 22, w - 44, h - 44, 12);
      ctx.stroke();
      ctx.fillStyle = RED;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font(900, 32);
      setSpacing(ctx, 10);
      ctx.fillText("CHEAT MEAL", 0, -h * 0.24);
      setSpacing(ctx, 0);
      ctx.font = display(Math.round(h * 0.5));
      ctx.fillText("EARNED", 0, h * 0.12);
      ctx.restore();
    },
  },
  {
    id: "checklist",
    label: "Plate check",
    group: "fuel",
    emoji: "🥩",
    over: (ctx, A) => {
      const rows = ["Protein", "Carbs", "Veggies", "Water"];
      const w = A.W * 0.62;
      const rowH = A.story ? 96 : 82;
      const h = rowH * rows.length + 90;
      const x = A.PAD;
      const y = A.bottom - h;
      ctx.fillStyle = "rgba(250,250,248,0.95)";
      roundRect(ctx, x, y, w, h, 36);
      ctx.fill();
      say(ctx, "PLATE CHECK", x + 44, y + 64, w - 88, 30, 900, "#6b6b73", "left", 6);
      rows.forEach((r, i) => {
        const ry = y + 90 + i * rowH + rowH / 2;
        say(ctx, r, x + 44, ry + 16, w - 200, A.story ? 46 : 40, 800, INKDARK);
        dot(ctx, x + w - 80, ry, 30, GREEN);
        check(ctx, x + w - 80, ry, 34, INK, 6);
      });
    },
  },
  {
    id: "prepday",
    label: "Prep day",
    group: "fuel",
    emoji: "🍱",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const days = ["M", "T", "W", "T", "F", "S", "S"];
      const gap = 14;
      const bw = (maxW - gap * 6) / 7;
      const y = A.bottom - bw * 0.8;
      days.forEach((d, i) => {
        const x = A.PAD + i * (bw + gap);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 6;
        roundRect(ctx, x + 3, y + 3, bw - 6, bw * 0.8 - 6, 16);
        ctx.stroke();
        ctx.font = font(900, Math.round(bw * 0.32));
        ctx.fillStyle = INK;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(d, x + bw / 2, y + bw * 0.4);
      });
      big(ctx, "PREP DAY", A.PAD - 4, y - 40, maxW, A.story ? 240 : 200, INK, "left", 100);
    },
  },
  {
    id: "grocery",
    label: "Grocery run",
    group: "fuel",
    emoji: "🛒",
    over: (ctx, A) => {
      const items = ["Chicken", "Rice", "Eggs", "Oats", "Greek yogurt", "Bananas"];
      const w = A.W * 0.6;
      const lh = A.story ? 62 : 52;
      const h = 150 + items.length * lh + 120;
      const x = A.W - A.PAD - w;
      const y = A.bottom - h;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(0.03);
      ctx.translate(-(x + w / 2), -(y + h / 2));
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      // the torn foot
      const teeth = 14;
      for (let i = 0; i <= teeth; i++) ctx.lineTo(x + w - (w / teeth) * i, y + h - (i % 2 ? 18 : 0));
      ctx.closePath();
      ctx.fill();
      const mono = (size: number, weight = 700) => `${weight} ${size}px "SF Mono", "Menlo", "Courier New", monospace`;
      ctx.fillStyle = INKDARK;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      ctx.font = mono(34, 800);
      ctx.fillText("JF GROCERY", x + w / 2, y + 70);
      ctx.font = mono(24);
      ctx.fillStyle = "#6b6b73";
      ctx.fillText("- - - - - - - - - - - -", x + w / 2, y + 110);
      ctx.textAlign = "left";
      ctx.font = mono(A.story ? 34 : 30);
      ctx.fillStyle = INKDARK;
      items.forEach((it, i) => {
        const iy = y + 160 + i * lh;
        ctx.fillText(ellipsize(ctx, it.toUpperCase(), w - 150), x + 40, iy);
        check(ctx, x + w - 60, iy - 12, 34, GREEN, 6);
      });
      ctx.font = mono(24);
      ctx.fillStyle = "#6b6b73";
      ctx.textAlign = "center";
      ctx.fillText("- - - - - - - - - - - -", x + w / 2, y + 160 + items.length * lh - 10);
      ctx.textAlign = "left";
      ctx.fillStyle = INKDARK;
      ctx.font = mono(A.story ? 36 : 32, 800);
      ctx.fillText("TOTAL", x + 40, y + 160 + items.length * lh + 50);
      ctx.textAlign = "right";
      ctx.fillText("GAINS", x + w - 40, y + 160 + items.length * lh + 50);
      ctx.restore();
    },
  },
  {
    id: "refeed",
    label: "Refeed",
    group: "fuel",
    emoji: "🍝",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      say(ctx, "CARBS ARE BACK ON THE MENU", A.PAD, A.bottom - 10, maxW, 34, 800, MUTED, "left", 3);
      big(ctx, "REFEED DAY", A.PAD - 4, A.bottom - 70, maxW, A.story ? 230 : 190, YELLOW, "left", 90);
    },
  },
  {
    id: "coffee",
    label: "Coffee first",
    group: "fuel",
    emoji: "☕",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 190 : 150;
      big(ctx, "LIFT SECOND.", A.PAD - 4, A.bottom - 10, maxW, s, RED, "left", 70);
      big(ctx, "COFFEE FIRST.", A.PAD - 4, A.bottom - 10 - s * 0.98, maxW, s, INK, "left", 70);
    },
  },
  {
    id: "hydrated",
    label: "Hydrated",
    group: "fuel",
    emoji: "💧",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      // a water bottle, mostly full
      const bw = 150;
      const bh = A.story ? 360 : 300;
      const bx = A.W - A.PAD - bw;
      const by = A.bottom - bh;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      roundRect(ctx, bx + bw * 0.3, by - 40, bw * 0.4, 46, 10);
      ctx.stroke();
      roundRect(ctx, bx, by, bw, bh, 40);
      ctx.stroke();
      ctx.save();
      roundRect(ctx, bx + 4, by + 4, bw - 8, bh - 8, 36);
      ctx.clip();
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(bx, by + bh * 0.28, bw, bh);
      ctx.restore();
      for (let i = 1; i <= 3; i++) rule(ctx, bx + bw * 0.62, by + (bh * i) / 4, bw * 0.22, 5, "rgba(255,255,255,0.8)");
      big(ctx, "HYDRATED", A.PAD - 4, A.bottom - 10, A.W - A.PAD * 2 - bw - 30, A.story ? 210 : 170, INK, "left", 80);
    },
  },

  /* ---- Time ---------------------------------------------------------- */
  {
    id: "clock",
    label: "Clock",
    group: "time",
    emoji: "🕐",
    fit: () => 1,
    over: (ctx, A, c) => {
      scrimTop(ctx, A, A.top + 520, 0.5);
      const { time } = clockLabel(c.now);
      const date = `${WEEKDAY[c.now.getDay()]}, ${MONTH[c.now.getMonth()]} ${c.now.getDate()}`;
      say(ctx, date, A.W / 2, A.top + 70, A.W - A.PAD * 2, 44, 700, "rgba(255,255,255,0.88)", "center");
      ctx.font = font(300, A.story ? 300 : 240);
      // the lock screen's thin, huge numbers (system face)
      const size = fitFont(ctx, time, A.W - A.PAD * 2, 300, A.story ? 300 : 240, 120);
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(time, A.W / 2, A.top + 80 + size * 0.95);
    },
  },
  {
    id: "earlyclub",
    label: (c) => `${earlyHour(c) ?? 5} AM club`,
    group: "time",
    emoji: "🌅",
    when: (c) => earlyHour(c) != null,
    fit: () => 5,
    over: (ctx, A, c) => {
      scrimBottom(ctx, A, 0.45);
      const h = earlyHour(c) ?? 5;
      const maxW = A.W - A.PAD * 2;
      const { time, ampm } = clockLabel(c.now);
      say(ctx, `UP AT ${time} ${ampm}`, A.PAD, A.bottom - 10, maxW, 36, 800, MUTED, "left", 4);
      const s = big(ctx, `${h} AM`, A.PAD - 6, A.bottom - 70, maxW, A.story ? 330 : 270, INK, "left", 120);
      say(ctx, "CLUB", A.PAD, A.bottom - 70 - s * 0.92 - 18, maxW, 56, 900, YELLOW, "left", 14);
    },
  },
  {
    id: "morning",
    label: "Morning session",
    group: "time",
    emoji: "☀️",
    fit: (c) => (hourOf(c) >= 5 && hourOf(c) < 11 ? 4 : 0),
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const cx = A.W - A.PAD - 130;
      const cy = A.top + 180;
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, 70, Math.PI, 0);
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (Math.PI * i) / 6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
        ctx.lineTo(cx + Math.cos(a) * 130, cy + Math.sin(a) * 130);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - 140, cy);
      ctx.lineTo(cx + 140, cy);
      ctx.stroke();
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 210 : 170;
      big(ctx, "SESSION", A.PAD - 4, A.bottom - 10, maxW, s, INK, "left", 80);
      big(ctx, "MORNING", A.PAD - 4, A.bottom - 10 - s * 0.95, maxW, s, YELLOW, "left", 80);
    },
  },
  {
    id: "lunch",
    label: "Lunch lift",
    group: "time",
    emoji: "🥪",
    fit: (c) => (hourOf(c) >= 11 && hourOf(c) < 14 ? 4 : 0),
    over: (ctx, A, c) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const { time, ampm } = clockLabel(c.now);
      say(ctx, `ON MY LUNCH BREAK · ${time} ${ampm}`, A.PAD, A.bottom - 10, maxW, 34, 800, MUTED, "left", 3);
      big(ctx, "LUNCH LIFT", A.PAD - 4, A.bottom - 70, maxW, A.story ? 240 : 200, INK, "left", 100);
    },
  },
  {
    id: "afterwork",
    label: "After work",
    group: "time",
    emoji: "💼",
    fit: (c) => (hourOf(c) >= 15 && hourOf(c) < 20 ? 4 : 0),
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 170 : 140;
      const y2 = A.bottom - 10;
      const y1 = y2 - s * 1.0;
      big(ctx, "CLOCKED IN.", A.PAD - 4, y2, maxW, s, RED, "left", 70);
      const used = big(ctx, "CLOCKED OUT.", A.PAD - 4, y1, maxW, s, INK, "left", 70);
      ctx.font = display(used);
      const w = ctx.measureText("CLOCKED OUT.").width;
      rule(ctx, A.PAD - 8, y1 - used * 0.36, w + 16, 12, INK);
      say(ctx, "WORK'S DONE. GYM ISN'T.", A.PAD, y1 - used * 0.92 - 24, maxW, 30, 800, MUTED, "left", 4);
    },
  },
  {
    id: "latenight",
    label: "Late night",
    group: "time",
    emoji: "🌌",
    fit: (c) => (hourOf(c) >= 20 || hourOf(c) < 3 ? 4 : 0),
    over: (ctx, A, c) => {
      scrimBottom(ctx, A, 0.45);
      scrimTop(ctx, A, A.top + 300, 0.45);
      moon(ctx, A.PAD + 70, A.top + 110, 60, INK);
      [[0.62, 0.06], [0.8, 0.12], [0.7, 0.2], [0.9, 0.03]].forEach(([fx, fy]) => dot(ctx, A.W * fx, A.top + (A.bottom - A.top) * fy, 6, INK));
      const maxW = A.W - A.PAD * 2;
      const { time, ampm } = clockLabel(c.now);
      say(ctx, `${time} ${ampm} · STILL HERE`, A.PAD, A.bottom - 10, maxW, 34, 800, MUTED, "left", 4);
      big(ctx, "LATE NIGHT LIFT", A.PAD - 4, A.bottom - 70, maxW, A.story ? 200 : 160, INK, "left", 80);
    },
  },
  {
    id: "weekday",
    label: (c) => WEEKDAY[c.now.getDay()],
    group: "time",
    emoji: "📆",
    over: (ctx, A, c) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      say(ctx, WEEKDAY_LINE[c.now.getDay()].toUpperCase(), A.PAD, A.bottom - 10, maxW, 40, 900, RED, "left", 8);
      big(ctx, WEEKDAY[c.now.getDay()].toUpperCase(), A.PAD - 4, A.bottom - 76, maxW, A.story ? 260 : 210, INK, "left", 100);
    },
  },
  {
    id: "datestamp",
    label: "Date stamp",
    group: "time",
    emoji: "🎞️",
    under: graded((ctx, A) => {
      blend(ctx, A, "soft-light", "#ff9a3c", 0.28);
      blend(ctx, A, "screen", "#2a1d12", 0.35);
    }),
    over: (ctx, A, c) => {
      const yy = String(c.now.getFullYear()).slice(2);
      const mm = String(c.now.getMonth() + 1).padStart(2, " ");
      const dd = String(c.now.getDate()).padStart(2, " ");
      ctx.font = `700 ${A.story ? 64 : 54}px "SF Mono", "Menlo", "Courier New", monospace`;
      ctx.fillStyle = "#ff8a1f";
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`'${yy} ${mm} ${dd}`, A.W - A.PAD, A.bottom - 10);
    },
  },

  /* ---- Mindset -------------------------------------------------------- */
  {
    id: "showup",
    label: "Show up",
    group: "mindset",
    emoji: "🙋",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      say(ctx, "ESPECIALLY ON THE DAYS YOU DON'T WANT TO", A.PAD, A.bottom - 10, maxW, 30, 800, MUTED, "left", 3);
      big(ctx, "SHOW UP.", A.PAD - 6, A.bottom - 66, maxW, A.story ? 300 : 240, INK, "left", 120);
    },
  },
  {
    id: "nozero",
    label: "No zero days",
    group: "mindset",
    emoji: "0️⃣",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 200 : 165;
      big(ctx, "ZERO DAYS", A.PAD - 4, A.bottom - 10, maxW, s, INK, "left", 80);
      big(ctx, "NO", A.PAD - 4, A.bottom - 10 - s * 0.95, maxW, s, RED, "left", 80);
    },
  },
  {
    id: "discipline",
    label: "Discipline",
    group: "mindset",
    emoji: "📖",
    over: (ctx, A) => {
      const w = A.W - A.PAD * 2;
      const h = A.story ? 400 : 340;
      const x = A.PAD;
      const y = A.bottom - h;
      ctx.fillStyle = "rgba(250,250,248,0.96)";
      roundRect(ctx, x, y, w, h, 32);
      ctx.fill();
      const serif = (size: number, weight = 700, italic = false) => `${italic ? "italic " : ""}${weight} ${size}px "New York", "Iowan Old Style", Georgia, "Times New Roman", serif`;
      ctx.fillStyle = INKDARK;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = serif(A.story ? 92 : 80);
      ctx.fillText("dis·ci·pline", x + 56, y + (A.story ? 130 : 112));
      ctx.font = serif(36, 400, true);
      ctx.fillStyle = "#6b6b73";
      ctx.fillText("/ ˈdisəplən /   noun", x + 60, y + (A.story ? 190 : 166));
      ctx.fillStyle = INKDARK;
      ctx.font = serif(A.story ? 50 : 44, 500);
      ctx.fillText("1. doing it anyway.", x + 60, y + (A.story ? 280 : 240));
      ctx.font = serif(34, 400, true);
      ctx.fillStyle = "#6b6b73";
      ctx.fillText(ellipsize(ctx, "see also: the alarm at 5 AM", w - 120), x + 60, y + (A.story ? 345 : 296));
    },
  },
  {
    id: "onemore",
    label: "One more rep",
    group: "mindset",
    emoji: "➕",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const s = big(ctx, "ONE MORE REP.", A.PAD - 4, A.bottom - 10, maxW, A.story ? 190 : 160, INK, "left", 70);
      tag(ctx, "+1", A.PAD, A.bottom - 10 - s - 70, { bg: RED, ink: INK, size: 44, h: 84 });
    },
  },
  {
    id: "process",
    label: "Trust the process",
    group: "mindset",
    emoji: "🧩",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 190 : 160;
      big(ctx, "THE PROCESS", A.PAD - 4, A.bottom - 10, maxW, s, INK, "left", 70);
      say(ctx, "TRUST", A.PAD, A.bottom - 10 - s * 0.95, maxW, 60, 900, RED, "left", 14);
    },
  },
  {
    id: "earnednotgiven",
    label: "Earned, not given",
    group: "mindset",
    emoji: "🏅",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 210 : 175;
      big(ctx, "NOT GIVEN.", A.PAD - 4, A.bottom - 10, maxW, s, "rgba(255,255,255,0.55)", "left", 80);
      big(ctx, "EARNED.", A.PAD - 4, A.bottom - 10 - s * 0.95, maxW, s, INK, "left", 80);
    },
  },
  {
    id: "silence",
    label: "Work in silence",
    group: "mindset",
    emoji: "🤫",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.62, 0.7);
      say(ctx, "work in silence.", A.W / 2, A.bottom - 30, A.W - A.PAD * 2, A.story ? 64 : 56, 500, INK, "center");
    },
  },
  {
    id: "youvsyou",
    label: "You vs. you",
    group: "mindset",
    emoji: "🪞",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.38);
      const maxW = A.W - A.PAD * 2;
      const s = A.story ? 220 : 180;
      const y3 = A.bottom - 10;
      big(ctx, "YOU", A.W / 2, y3, maxW, s, INK, "center", 90);
      big(ctx, "VS.", A.W / 2, y3 - s * 0.92, maxW, s * 0.6, RED, "center", 60);
      big(ctx, "YOU", A.W / 2, y3 - s * 0.92 - s * 0.6, maxW, s, INK, "center", 90);
    },
  },

  /* ---- Vibe: grades on the picture itself ------------------------------ */
  {
    id: "noir",
    label: "Gym noir",
    group: "vibe",
    emoji: "🖤",
    under: graded((ctx, A) => {
      blend(ctx, A, "saturation", "#808080", 1);
      blend(ctx, A, "soft-light", "#000000", 0.35);
      vignette(ctx, A, 0.6);
    }),
  },
  {
    id: "golden",
    label: "Golden",
    group: "vibe",
    emoji: "🌇",
    under: graded((ctx, A) => {
      blend(ctx, A, "soft-light", "#ff9a3c", 0.45);
      blend(ctx, A, "screen", "#3a2410", 0.25);
    }),
  },
  {
    id: "steel",
    label: "Cold steel",
    group: "vibe",
    emoji: "🧊",
    under: graded((ctx, A) => {
      blend(ctx, A, "soft-light", "#2f7dff", 0.45);
      blend(ctx, A, "saturation", "#808080", 0.3);
      vignette(ctx, A, 0.35);
    }),
  },
  {
    id: "film",
    label: "Film",
    group: "vibe",
    emoji: "📼",
    under: (ctx, A, media) => {
      cover(ctx, A, media);
      blend(ctx, A, "saturation", "#808080", 0.35);
      blend(ctx, A, "screen", "#2b2219", 0.4);
      blend(ctx, A, "soft-light", "#ffcc88", 0.25);
      const p = grainPattern(ctx);
      if (p) {
        ctx.save();
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = p;
        ctx.fillRect(0, 0, A.W, A.H);
        ctx.restore();
      }
      vignette(ctx, A, 0.35);
    },
  },
  {
    id: "chalk",
    label: "Chalk",
    group: "vibe",
    emoji: "🤍",
    under: graded((ctx, A) => {
      blend(ctx, A, "saturation", "#808080", 0.65);
      blend(ctx, A, "screen", "#3c3c3c", 0.45);
    }),
  },
  {
    id: "redroom",
    label: "Red room",
    group: "vibe",
    emoji: "🟥",
    under: graded((ctx, A) => {
      blend(ctx, A, "color", RED, 0.55);
      blend(ctx, A, "soft-light", "#000000", 0.3);
      vignette(ctx, A, 0.45);
    }),
  },
];

export const STORY_FILTERS: readonly StoryFilter[] = FILTERS;

/** A filter by its id (the key without "fx:"). */
export function storyFilter(id: string): StoryFilter | undefined {
  return FILTERS.find((f) => f.id === id);
}
export function filterLabel(f: StoryFilter, c: FilterContext): string {
  return typeof f.label === "function" ? f.label(c) : f.label;
}

/** The order the groups go in right now: what fits the moment first. */
export function groupOrder(c: FilterContext): FilterGroup[] {
  const lead: FilterGroup[] = [];
  if (c.finished) lead.push("today");
  if (c.session && !c.finished) lead.push("lockin");
  if (c.fuel === "post") lead.push("fuel");
  const rest = FILTER_GROUPS.map((g) => g.key).filter((k) => !lead.includes(k));
  return [...lead, ...rest];
}

/** The filters offered right now, grouped and in order (each group's best fit first, ties keep the catalogue's order). */
export function filterRow(c: FilterContext): StoryFilter[] {
  const out: StoryFilter[] = [];
  for (const g of groupOrder(c)) {
    const list = FILTERS.map((f, i) => ({ f, i })).filter(({ f }) => f.group === g && (!f.when || f.when(c)));
    list.sort((a, b) => (b.f.fit?.(c) ?? 0) - (a.f.fit?.(c) ?? 0) || a.i - b.i);
    out.push(...list.map(({ f }) => f));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Painting                                                           */
/* ------------------------------------------------------------------ */

/** Where a filter draws: a story (1080×1920), a feed card (1080×1350), or any other size a post takes (grades only). */
export type FilterSize = ShareFormat | { w: number; h: number };
export function filterArea(size: FilterSize): Area {
  if (typeof size === "string") {
    const s = SHARE_SIZES[size];
    return { W: s.w, H: s.h, top: s.safeTop, bottom: s.h - s.safeBottom, PAD: size === "story" ? 80 : 72, story: size === "story" };
  }
  const story = Math.abs(size.w / size.h - 9 / 16) < 0.02;
  if (story) return filterArea("story");
  return { W: size.w, H: size.h, top: 60, bottom: size.h - 60, PAD: 72, story: false };
}
/** A grade only changes the picture (no words or shapes), so it suits any shape a post takes. */
export function isGrade(f: StoryFilter): boolean {
  return !f.over;
}

/** What the design shows changes with these (and the minute, for the clocks). */
function contextKey(c: FilterContext): string {
  return JSON.stringify([c.firstName, c.session, c.finished, c.block, c.fuel, c.now.getFullYear(), c.now.getMonth(), c.now.getDate(), c.now.getHours(), c.now.getMinutes()]);
}

const overCache = new Map<string, HTMLCanvasElement>();
const OVER_CACHE_MAX = 6;

/**
 * Paint a filter onto a canvas sized for the format (1080 wide, × `scale`):
 * the picture under it (graded), then its design. The design is drawn once
 * per minute and kept, so the camera can call this 30 times a second.
 */
export function paintStoryFilter(
  canvas: HTMLCanvasElement,
  f: StoryFilter,
  c: FilterContext,
  media: ShareCardMedia | null,
  logo: HTMLImageElement | null,
  format: FilterSize,
  scale = 1,
): void {
  const A = filterArea(format);
  const cw = Math.round(A.W * scale);
  const ch = Math.round(A.H * scale);
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.save();
  (f.under ?? cover)(ctx, A, media);
  ctx.restore();
  if (!f.over) return;
  const key = `${f.id}|${A.W}x${A.H}|${cw}|${!!logo}|${contextKey(c)}`;
  let layer = overCache.get(key);
  if (!layer && typeof document !== "undefined") {
    layer = document.createElement("canvas");
    layer.width = cw;
    layer.height = ch;
    const l = layer.getContext("2d");
    if (l) {
      l.setTransform(scale, 0, 0, scale, 0, 0);
      l.save();
      f.over(l, A, c, logo);
      l.restore();
    }
    overCache.set(key, layer);
    // only the last few (a filter at a time, a minute at a time)
    while (overCache.size > OVER_CACHE_MAX) {
      const first = overCache.keys().next().value as string;
      const old = overCache.get(first);
      if (old) {
        old.width = 0;
        old.height = 0;
      }
      overCache.delete(first);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (layer) ctx.drawImage(layer, 0, 0);
  else {
    // no document (tests): straight onto the canvas
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    f.over(ctx, A, c, logo);
  }
}

/** Draw a filter straight onto a context the caller sized (tests, and anything that must not cache). */
export function drawStoryFilter(ctx: Ctx, f: StoryFilter, c: FilterContext, media: ShareCardMedia | null, logo: HTMLImageElement | null, format: FilterSize) {
  const A = filterArea(format);
  ctx.save();
  (f.under ?? cover)(ctx, A, media);
  ctx.restore();
  ctx.save();
  f.over?.(ctx, A, c, logo);
  ctx.restore();
}
