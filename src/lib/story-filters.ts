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
import { RED, INK, MUTED, balancedLines, display, fitDisplay, setSpacing, drawCover, plainBackdrop, SHARE_SIZES, type ShareCardMedia, type ShareFormat } from "@/lib/workout-share-card";
import { font, fitFont, ellipsize, roundRect } from "@/lib/workout-story-card";

type Ctx = CanvasRenderingContext2D;

export type FilterGroup = "fav" | "today" | "lockin" | "train" | "block" | "meet" | "rest" | "gymbro" | "memes" | "fuel" | "stims" | "time" | "mindset" | "vibe";

/**
 * The chips over the story camera's templates, in their default order
 * (Nov 23 2026: the gym-culture collections joined them). Favorites leads
 * when there are any. Vibe (the old colour grades) is no longer a template
 * group: colour is the editor's Filters (media-grade.ts), separate from
 * templates and combined with them; its filters stay defined so a saved key
 * still resolves.
 */
export const FILTER_GROUPS: { key: FilterGroup; label: string }[] = [
  { key: "fav", label: "Favorites" },
  { key: "today", label: "Today" },
  { key: "lockin", label: "Lock in" },
  { key: "train", label: "Train" },
  { key: "block", label: "Block" },
  { key: "meet", label: "Meet day" },
  { key: "rest", label: "Rest day" },
  { key: "gymbro", label: "Gym bro" },
  { key: "memes", label: "Brain rot" },
  { key: "fuel", label: "Fuel" },
  { key: "stims", label: "Stims" },
  { key: "time", label: "Time" },
  { key: "mindset", label: "Mindset" },
];

/** A template's own words, as the person wrote them (its title, a second line, a meet's numbers). */
export type MeetNumbers = { cls?: string; s?: string; b?: string; d?: string; unit?: "kg" | "lb" };
export type TemplateText = { title?: string; sub?: string; meet?: MeetNumbers };

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
  /** What the person typed onto a template (by its id): its words in place of the template's own. */
  custom?: Record<string, TemplateText>;
};

/** The drawing area: the card's size and the band the story's own bars leave clear. */
/**
 * Where a filter draws: `W` × `H` the canvas (full-bleed fills and the picture
 * use it), `SW` the width its design is laid out across (W, except a
 * full-screen post's, which keeps the design clear of the feed's buttons down
 * the right), `top` / `bottom` / `PAD` the room its words stay inside,
 * `story` the tall 9:16 canvas.
 */
export type Area = { W: number; H: number; SW: number; top: number; bottom: number; PAD: number; story: boolean };

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
  /** Its words can be changed (the camera's chip opens them): the title, a second line, a meet's numbers. */
  edit?: { title: string; sub?: string; meet?: boolean };
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
    const maxW = A.SW - A.PAD * 2;
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
    say(ctx, "TODAY IS", A.PAD, top + 66, A.SW - A.PAD * 2, 32, 900, "rgba(255,255,255,0.85)", "left", 6);
    big(ctx, `${word} DAY`, A.PAD - 4, top + bandH - 50, A.SW - A.PAD * 2, 230, INK, "left", 90);
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
      const maxW = A.SW - A.PAD * 2;
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
      if (A.PAD + w + s * 0.55 < A.SW - A.PAD) check(ctx, A.PAD + w + s * 0.3, y - s * 0.36, s * 0.42, GREEN);
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const w = A.SW - A.PAD * 1.4;
      const x = (A.SW - w) / 2;
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
      const w = A.SW - A.PAD * 1.4;
      const x = (A.SW - w) / 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      ctx.translate(A.SW / 2, A.top + (A.bottom - A.top) * 0.72);
      ctx.rotate(-0.09);
      const w = A.SW * 0.78;
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
      say(ctx, "TONIGHT ONLY", A.SW / 2, A.top + band * 0.55 - 40, A.SW - A.PAD * 2, 38, 900, YELLOW, "center", 10);
      const maxW = A.SW - A.PAD * 2;
      const s = big(ctx, who(c), A.SW / 2, A.bottom - band * 0.9 + (A.story ? 160 : 120), maxW, A.story ? 150 : 120, INK, "center", 60);
      say(ctx, "VS. THE BAR", A.SW / 2, A.bottom - band * 0.9 + (A.story ? 160 : 120) + Math.min(70, s * 0.5), maxW, 44, 900, RED, "center", 6);
      say(ctx, "HEAVY DAY · NO REFUNDS", A.SW / 2, A.bottom - 10, maxW, 26, 800, MUTED, "center", 6);
    },
  },
  {
    id: "prattempt",
    label: "PR attempt",
    group: "train",
    emoji: "🎯",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.45);
      const maxW = A.SW - A.PAD * 2;
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
      say(ctx, date, A.SW - inset - 40, b - 50, 400, 30, 800, INK, "right", 3);
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
      const w = A.SW * (A.story ? 0.8 : 0.72);
      const ph = w * 1.08;
      const frameH = ph + w * 0.06 + (A.story ? 230 : 180);
      const x = (A.SW - w) / 2;
      const y = A.top + (A.bottom - A.top - frameH) / 2;
      ctx.save();
      ctx.translate(A.SW / 2, y + frameH / 2);
      ctx.rotate(-0.035);
      ctx.translate(-A.SW / 2, -(y + frameH / 2));
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
      const w = A.SW * (A.story ? 0.8 : 0.72);
      const ph = w * 1.08;
      const frameH = ph + w * 0.06 + (A.story ? 230 : 180);
      const y = A.top + (A.bottom - A.top - frameH) / 2;
      ctx.save();
      ctx.translate(A.SW / 2, y + frameH / 2);
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
        const X = A.PAD * 0.5 + px * (A.SW - A.PAD);
        const Y = y + py * 110;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      dot(ctx, A.PAD * 0.5 + 0.44 * (A.SW - A.PAD), y - 110, 16, RED);
      big(ctx, "CARDIO", A.PAD - 4, A.bottom - 10, A.SW - A.PAD * 2, A.story ? 230 : 190, INK, "left", 90);
    },
  },
  {
    id: "restday",
    label: "Rest day",
    group: "train",
    emoji: "😴",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.5);
      moon(ctx, A.SW - A.PAD - 70, A.top + 110, 64, INK);
      ctx.font = font(800, 44);
      ctx.fillStyle = INK;
      ctx.textAlign = "left";
      ctx.fillText("z", A.SW - A.PAD - 220, A.top + 120);
      ctx.font = font(800, 60);
      ctx.fillText("z", A.SW - A.PAD - 190, A.top + 70);
      const maxW = A.SW - A.PAD * 2;
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
      const colW = (A.SW - A.PAD * 2) / cols.length;
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
      const maxW = A.SW - A.PAD * 2;
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
      const cx = A.SW / 2;
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
      say(ctx, "BACK OFF NOW, COME BACK STRONGER", A.SW / 2, A.bottom - 10, A.SW - A.PAD * 2, 32, 800, INK, "center", 3);
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
      const R = A.SW - A.PAD * 0.5;
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
      big(ctx, "PEAK WEEK", A.PAD - 4, A.bottom - 10, A.SW - A.PAD * 2, A.story ? 230 : 190, INK, "left", 100);
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
      const w = A.SW * (A.story ? 0.62 : 0.5);
      const h = w * 1.36;
      const x = (A.SW - w) / 2;
      const y = A.bottom - h - (A.story ? 30 : 0);
      ctx.strokeStyle = RED;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 10);
      ctx.lineTo(A.SW / 2 - 120, 0);
      ctx.moveTo(x + w * 0.7, y + 10);
      ctx.lineTo(A.SW / 2 + 120, 0);
      ctx.stroke();
      ctx.fillStyle = PAPER;
      roundRect(ctx, x, y, w, h, 30);
      ctx.fill();
      ctx.fillStyle = RED;
      ctx.fillRect(x, y + h * 0.16, w, h * 0.17);
      ctx.fillStyle = "#cfcac0";
      roundRect(ctx, A.SW / 2 - 50, y + 26, 100, 22, 11);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = display(Math.round(h * 0.1));
      ctx.fillText("ATHLETE", A.SW / 2, y + h * 0.247);
      ctx.fillStyle = INKDARK;
      ctx.font = display(Math.round(h * 0.14));
      fitDisplay(ctx, who(c), w - 80, Math.round(h * 0.14), 40);
      ctx.fillText(who(c), A.SW / 2, y + h * 0.48);
      ctx.font = font(900, Math.round(h * 0.05));
      setSpacing(ctx, 6);
      ctx.fillText("MEET DAY", A.SW / 2, y + h * 0.6);
      setSpacing(ctx, 0);
      ctx.font = font(700, Math.round(h * 0.04));
      ctx.fillStyle = "#55555c";
      ctx.fillText(`${MONTH[c.now.getMonth()]} ${c.now.getDate()}, ${c.now.getFullYear()}`, A.SW / 2, y + h * 0.68);
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
      const maxW = A.SW - A.PAD * 2;
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
      ctx.translate(A.SW / 2, A.top + (A.bottom - A.top) * 0.62);
      ctx.rotate(-0.16);
      const w = A.SW * 0.72;
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
      const w = A.SW * 0.62;
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
      const maxW = A.SW - A.PAD * 2;
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
      const w = A.SW * 0.6;
      const lh = A.story ? 62 : 52;
      const h = 150 + items.length * lh + 120;
      const x = A.SW - A.PAD - w;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const bx = A.SW - A.PAD - bw;
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
      big(ctx, "HYDRATED", A.PAD - 4, A.bottom - 10, A.SW - A.PAD * 2 - bw - 30, A.story ? 210 : 170, INK, "left", 80);
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
      say(ctx, date, A.SW / 2, A.top + 70, A.SW - A.PAD * 2, 44, 700, "rgba(255,255,255,0.88)", "center");
      ctx.font = font(300, A.story ? 300 : 240);
      // the lock screen's thin, huge numbers (system face)
      const size = fitFont(ctx, time, A.SW - A.PAD * 2, 300, A.story ? 300 : 240, 120);
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(time, A.SW / 2, A.top + 80 + size * 0.95);
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
      const maxW = A.SW - A.PAD * 2;
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
      const cx = A.SW - A.PAD - 130;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      [[0.62, 0.06], [0.8, 0.12], [0.7, 0.2], [0.9, 0.03]].forEach(([fx, fy]) => dot(ctx, A.SW * fx, A.top + (A.bottom - A.top) * fy, 6, INK));
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      ctx.fillText(`'${yy} ${mm} ${dd}`, A.SW - A.PAD, A.bottom - 10);
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const w = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      const maxW = A.SW - A.PAD * 2;
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
      say(ctx, "work in silence.", A.SW / 2, A.bottom - 30, A.SW - A.PAD * 2, A.story ? 64 : 56, 500, INK, "center");
    },
  },
  {
    id: "youvsyou",
    label: "You vs. you",
    group: "mindset",
    emoji: "🪞",
    over: (ctx, A) => {
      scrimBottom(ctx, A, 0.38);
      const maxW = A.SW - A.PAD * 2;
      const s = A.story ? 220 : 180;
      const y3 = A.bottom - 10;
      big(ctx, "YOU", A.SW / 2, y3, maxW, s, INK, "center", 90);
      big(ctx, "VS.", A.SW / 2, y3 - s * 0.92, maxW, s * 0.6, RED, "center", 60);
      big(ctx, "YOU", A.SW / 2, y3 - s * 0.92 - s * 0.6, maxW, s, INK, "center", 90);
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

/* ------------------------------------------------------------------ */
/*  The gym's own collections (Nov 23 2026)                            */
/* ------------------------------------------------------------------ */

/*
 * Meet day, rest day, gym bro, brain rot and stims: a few strong designs
 * (a competition poster, the judges' lights, caution tape, a meme caption, a
 * game's HUD, a supplement label, candy type, a retro sunset, clean type),
 * each carrying its own words. Every one's title and second line can be
 * changed (`edit`), and a meet's can carry the athlete's own numbers (their
 * class and squat / bench / deadlift, in kg or lb): only what they type,
 * never anything read from their records.
 */

type GymDesign = "poster" | "lights" | "tape" | "meme" | "hud" | "label" | "candy" | "retro" | "clean";
type HudKind = "popup" | "dialogue" | "timer" | "patch" | "loading" | "quest";
type GymSpec = {
  id: string;
  label: string;
  group: FilterGroup;
  emoji: string;
  design: GymDesign;
  /** The words: a "|" splits a meme's top from its bottom, a popup's number from its word. */
  title: string;
  sub?: string;
  /** A poster's small line over everything (MEET DAY). */
  kicker?: string;
  /** The judges' lights, left to right: w(hite) or r(ed). */
  lights?: string;
  hud?: HudKind;
  /** A label's rows / a patch's notes. */
  rows?: [string, string][];
  accent?: string;
  meet?: boolean;
};

const NEON = "#b6ff3b";
const CYAN = "#3ee0f5";
const CANDY = ["#ff5fa2", "#ffd23f", "#3ee0f5", "#a78bfa", "#7cf29c", "#ff8a3d"];

const upper = (t: string) => t.toUpperCase();
/** The meet numbers the person typed, and their total when all three are numbers. */
function meetLine(m: MeetNumbers | undefined): { cells: [string, string][]; total: string | null; unit: string; cls: string | null } | null {
  if (!m) return null;
  const unit = m.unit ?? "kg";
  const cells: [string, string][] = [];
  if (m.s?.trim()) cells.push(["SQ", m.s.trim()]);
  if (m.b?.trim()) cells.push(["BP", m.b.trim()]);
  if (m.d?.trim()) cells.push(["DL", m.d.trim()]);
  const nums = [m.s, m.b, m.d].map((v) => Number(String(v ?? "").replace(",", ".")));
  const total = nums.every((n) => Number.isFinite(n) && n > 0) ? String(Math.round(nums.reduce((a, b) => a + b, 0) * 10) / 10) : null;
  const cls = m.cls?.trim() ? m.cls.trim() : null;
  if (!cells.length && !cls) return null;
  return { cells, total, unit, cls };
}

/** Lines of display type stacked up from `bottom` at one size that fits them all; returns the top of the stack. */
function stackDisplay(ctx: Ctx, lines: string[], x: number, bottom: number, maxW: number, start: number, min: number, color: string, align: CanvasTextAlign = "left", lead = 0.9, stroke?: { color: string; width: number }) {
  let size = start;
  for (const l of lines) size = Math.min(size, fitDisplay(ctx, l, maxW, start, min));
  ctx.font = display(size);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  let y = bottom;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (stroke) {
      ctx.lineWidth = stroke.width;
      ctx.strokeStyle = stroke.color;
      ctx.lineJoin = "round";
      ctx.strokeText(lines[i], x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(lines[i], x, y);
    if (i > 0) y -= size * lead;
  }
  return { top: y - size * 0.82, size };
}
/** A title as lines: its own line breaks, else balanced across two when it's long. */
function titleLines(ctx: Ctx, text: string, maxW: number, size: number): string[] {
  const parts = text.split("\n").map((t) => t.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 3);
  ctx.font = display(size);
  return balancedLines(ctx, parts[0] ?? "", maxW).slice(0, 3);
}

/** The competition poster: the big words low on the picture, a red rule, the line under, the numbers when typed. */
function posterDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const f = storyFilter(t.id)!;
    const w = templateWords(f, c);
    const m = t.meet ? meetLine(c.custom?.[t.id]?.meet) : null;
    dim(ctx, A, 0.16);
    scrimTop(ctx, A, A.top + 180, 0.5);
    scrimBottom(ctx, A, 0.36, 0.92);
    const maxW = A.SW - A.PAD * 2;
    tag(ctx, upper(t.kicker ?? "MEET DAY"), A.PAD, A.top, { bg: t.accent ?? RED, ink: INK, size: A.story ? 28 : 24 });
    const d = `${MONTH[c.now.getMonth()].slice(0, 3).toUpperCase()} ${c.now.getDate()}`;
    say(ctx, m?.cls ? `${d} · ${upper(m.cls)}` : d, A.SW - A.PAD, A.top + (A.story ? 40 : 34), maxW / 2, A.story ? 30 : 26, 800, INK, "right", 4);
    let bottom = A.bottom - 6;
    if (m && m.cells.length) {
      // the scoreboard: a box a lift (and the total), the numbers big
      const cells: [string, string][] = m.total ? [...m.cells, ["TOTAL", m.total]] : m.cells;
      const gap = 14;
      const bw = (maxW - gap * (cells.length - 1)) / cells.length;
      const bh = A.story ? 168 : 140;
      const top = bottom - bh;
      cells.forEach(([k, v], i) => {
        const x = A.PAD + i * (bw + gap);
        ctx.fillStyle = k === "TOTAL" ? (t.accent ?? RED) : "rgba(255,255,255,0.12)";
        roundRect(ctx, x, top, bw, bh, 22);
        ctx.fill();
        say(ctx, k, x + bw / 2, top + (A.story ? 46 : 40), bw - 20, A.story ? 26 : 22, 900, k === "TOTAL" ? INK : MUTED, "center", 4);
        big(ctx, v, x + bw / 2, top + bh - (A.story ? 30 : 24), bw - 24, A.story ? 78 : 64, INK, "center", 30);
      });
      say(ctx, m.unit.toUpperCase(), A.SW - A.PAD, top - 18, maxW, A.story ? 26 : 22, 800, MUTED, "right", 4);
      bottom = top - (A.story ? 64 : 54);
    } else if (w.sub) {
      say(ctx, upper(w.sub), A.PAD, bottom, maxW, A.story ? 34 : 30, 800, MUTED, "left", 6);
      bottom -= A.story ? 70 : 60;
    }
    rule(ctx, A.PAD, bottom, A.story ? 150 : 120, 12, t.accent ?? RED);
    const lines = titleLines(ctx, upper(w.title), maxW, A.story ? 230 : 180);
    stackDisplay(ctx, lines, A.PAD - 4, bottom - 30, maxW, A.story ? (lines.length > 1 ? 210 : 260) : lines.length > 1 ? 160 : 200, 70, INK);
  };
}

/** Three lights over the platform: the judges' call, white or red. */
function lightsDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    dim(ctx, A, 0.2);
    scrimBottom(ctx, A, 0.45, 0.9);
    const calls = (t.lights ?? "www").split("");
    const r = A.story ? 78 : 60;
    const gap = A.story ? 46 : 36;
    const total = calls.length * r * 2 + (calls.length - 1) * gap;
    const cy = A.top + (A.story ? 150 : 110);
    // the lights' bar
    ctx.fillStyle = "rgba(10,10,12,0.82)";
    roundRect(ctx, (A.SW - total) / 2 - 36, cy - r - 30, total + 72, r * 2 + 60, r + 30);
    ctx.fill();
    calls.forEach((k, i) => {
      const x = (A.SW - total) / 2 + r + i * (r * 2 + gap);
      dot(ctx, x, cy, r, k === "r" ? RED : "#f8f8f6");
      dot(ctx, x - r * 0.32, cy - r * 0.34, r * 0.18, k === "r" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)");
    });
    const maxW = A.SW - A.PAD * 2;
    let bottom = A.bottom - 6;
    if (w.sub) {
      say(ctx, upper(w.sub), A.SW / 2, bottom, maxW, A.story ? 34 : 30, 800, MUTED, "center", 6);
      bottom -= A.story ? 70 : 58;
    }
    const lines = titleLines(ctx, upper(w.title), maxW, A.story ? 220 : 170);
    stackDisplay(ctx, lines, A.SW / 2, bottom, maxW, A.story ? (lines.length > 1 ? 200 : 240) : 170, 70, INK, "center");
  };
}

/** Caution tape across the picture, twice. */
function tapeDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    dim(ctx, A, 0.12);
    tape(ctx, A, upper(w.title), A.H * 0.4, -0.2, A.story ? 132 : 110);
    tape(ctx, A, upper(w.sub || w.title), A.H * 0.63, 0.14, A.story ? 104 : 88);
  };
}

/** The meme: white display words with a black outline, over the top and along the foot. */
function memeDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    const [topText, bottomText] = /[|\n]/.test(w.title) ? w.title.split(/[|\n]/) : [w.title, w.sub];
    const maxW = A.SW - A.PAD * 2;
    const stroke = { color: INKDARK, width: A.story ? 16 : 12 };
    if (topText?.trim()) {
      const size = fitDisplay(ctx, upper(topText.trim()), maxW, A.story ? 170 : 130, 64);
      stackDisplay(ctx, [upper(topText.trim())], A.SW / 2, A.top + size * 0.86, maxW, size, 64, INK, "center", 0.9, stroke);
    }
    if (bottomText?.trim()) stackDisplay(ctx, [upper(bottomText.trim())], A.SW / 2, A.bottom - 6, maxW, A.story ? 170 : 130, 64, INK, "center", 0.9, stroke);
  };
}

/** A game's screen: corner brackets, a health bar and a level, then the moment itself. */
function hudDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    const accent = t.accent ?? NEON;
    dim(ctx, A, 0.22);
    // corner brackets
    const inset = 40;
    const arm = A.story ? 120 : 90;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.lineCap = "square";
    for (const [x, y, dx, dy] of [
      [inset, inset, 1, 1],
      [A.W - inset, inset, -1, 1],
      [inset, A.H - inset, 1, -1],
      [A.W - inset, A.H - inset, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * arm, y);
      ctx.stroke();
    }
    // HP and level, up top
    const hy = A.top + 30;
    say(ctx, "HP", A.PAD, hy, 80, 30, 900, accent, "left", 4);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(ctx, A.PAD + 70, hy - 26, 300, 26, 8);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, A.PAD + 70, hy - 26, t.hud === "loading" ? 90 : 252, 26, 8);
    ctx.fill();
    say(ctx, `LV ${99}`, A.SW - A.PAD, hy, 200, 30, 900, INK, "right", 4);
    const maxW = A.SW - A.PAD * 2;
    const kind = t.hud ?? "quest";
    if (kind === "popup") {
      const [num, word] = /[|\n]/.test(w.title) ? w.title.split(/[|\n]/) : [w.title, w.sub];
      const midY = A.top + (A.bottom - A.top) * 0.56;
      const s = fitDisplay(ctx, upper(num.trim()), maxW, A.story ? 300 : 230, 90);
      stackDisplay(ctx, [upper(num.trim())], A.SW / 2, midY, maxW, s, 90, accent, "center", 0.9, { color: INKDARK, width: 14 });
      if (word?.trim()) say(ctx, upper(word.trim()), A.SW / 2, midY + (A.story ? 90 : 72), maxW, A.story ? 54 : 44, 900, INK, "center", 10);
    } else if (kind === "timer") {
      const midY = A.top + (A.bottom - A.top) * 0.55;
      say(ctx, upper(w.sub || "REST TIMER"), A.SW / 2, midY - (A.story ? 250 : 190), maxW, A.story ? 40 : 34, 900, accent, "center", 10);
      stackDisplay(ctx, [w.title], A.SW / 2, midY, maxW, A.story ? 320 : 250, 100, INK, "center");
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      roundRect(ctx, A.PAD + 40, midY + 60, maxW - 80, 18, 9);
      ctx.fill();
      ctx.fillStyle = accent;
      roundRect(ctx, A.PAD + 40, midY + 60, (maxW - 80) * 0.82, 18, 9);
      ctx.fill();
    } else if (kind === "loading") {
      const midY = A.top + (A.bottom - A.top) * 0.6;
      const lines = titleLines(ctx, upper(w.title), maxW, A.story ? 160 : 130);
      stackDisplay(ctx, lines, A.SW / 2, midY, maxW, A.story ? 160 : 130, 60, INK, "center");
      // a segmented bar
      const segs = 10;
      const sw = (maxW - 40 - (segs - 1) * 10) / segs;
      for (let i = 0; i < segs; i++) {
        ctx.fillStyle = i < 3 ? accent : "rgba(255,255,255,0.16)";
        roundRect(ctx, A.PAD + 20 + i * (sw + 10), midY + 50, sw, 44, 8);
        ctx.fill();
      }
      if (w.sub) say(ctx, upper(w.sub), A.SW / 2, midY + (A.story ? 170 : 150), maxW, A.story ? 36 : 30, 800, MUTED, "center", 6);
    } else if (kind === "dialogue" || kind === "patch") {
      // the box along the foot: a name tab on its top edge, the words inside
      const bh = A.story ? 400 : 330;
      const top = A.bottom - bh;
      ctx.fillStyle = "rgba(8,10,14,0.88)";
      roundRect(ctx, A.PAD - 20, top, maxW + 40, bh, 26);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 6;
      roundRect(ctx, A.PAD - 20, top, maxW + 40, bh, 26);
      ctx.stroke();
      tag(ctx, upper(w.title), A.PAD + 10, top - 34, { bg: accent, ink: INKDARK, size: A.story ? 30 : 26 });
      const lineSize = A.story ? 50 : 42;
      if (kind === "patch") {
        let y = top + 96;
        for (const [k, v] of (t.rows ?? []).slice(0, 4)) {
          say(ctx, `• ${k}`, A.PAD + 16, y, maxW * 0.62, lineSize, 700, INK);
          say(ctx, v, A.SW - A.PAD - 16, y, maxW * 0.36, lineSize, 900, accent, "right");
          y += lineSize * 1.45;
        }
      } else {
        ctx.font = font(700, lineSize);
        const words = (w.sub || "…").split(/\s+/);
        const lines: string[] = [];
        let cur = "";
        for (const word of words) {
          const next = cur ? `${cur} ${word}` : word;
          if (ctx.measureText(next).width > maxW - 40 && cur) {
            lines.push(cur);
            cur = word;
          } else cur = next;
        }
        if (cur) lines.push(cur);
        lines.slice(0, 4).forEach((l, i) => say(ctx, l, A.PAD + 16, top + 100 + i * lineSize * 1.3, maxW - 32, lineSize, 700, INK));
        say(ctx, "▼", A.SW - A.PAD - 10, A.bottom - 30, 60, 36, 900, accent, "right");
      }
    } else {
      // quest complete
      const midY = A.top + (A.bottom - A.top) * 0.62;
      const lines = titleLines(ctx, upper(w.title), maxW, A.story ? 190 : 150);
      const st = stackDisplay(ctx, lines, A.SW / 2, midY, maxW, A.story ? 190 : 150, 70, INK, "center", 0.9, { color: INKDARK, width: 12 });
      say(ctx, upper(w.sub || "QUEST COMPLETE"), A.SW / 2, Math.max(A.top + 80, st.top - 34), maxW, A.story ? 40 : 34, 900, accent, "center", 10);
      say(ctx, "+ 500 XP", A.SW / 2, midY + (A.story ? 100 : 80), maxW, A.story ? 46 : 38, 900, accent, "center", 6);
    }
  };
}

/** A supplement facts panel, the title its name. */
function labelDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    dim(ctx, A, 0.1);
    const pw = A.SW - A.PAD * 2;
    const rows = t.rows ?? [];
    const rowH = A.story ? 76 : 62;
    const inner0 = pw - 80;
    const tl = titleLines(ctx, upper(w.title), inner0, A.story ? 110 : 90);
    const tSize = tl.length > 1 ? (A.story ? 86 : 70) : A.story ? 110 : 90;
    // the head is as tall as its title (one line or two) and the "facts" line under it
    const head = 56 + tl.length * tSize * 0.92 + (A.story ? 70 : 60);
    const ph = head + rows.length * rowH + (A.story ? 110 : 86);
    const top = A.bottom - ph;
    const x = A.PAD;
    ctx.fillStyle = "#fbfaf6";
    roundRect(ctx, x, top, pw, ph, 18);
    ctx.fill();
    ctx.strokeStyle = INKDARK;
    ctx.lineWidth = 8;
    roundRect(ctx, x + 14, top + 14, pw - 28, ph - 28, 10);
    ctx.stroke();
    const inner = inner0;
    stackDisplay(ctx, tl, x + 40, top + head - (A.story ? 64 : 54), inner, tSize, 44, INKDARK);
    say(ctx, upper(w.sub || "SUPPLEMENT FACTS"), x + 40, top + head - 18, inner, A.story ? 28 : 24, 900, "#3a3a40", "left", 4);
    ctx.fillStyle = INKDARK;
    ctx.fillRect(x + 40, top + head, inner, 14);
    let y = top + head + 14;
    for (const [k, v] of rows) {
      say(ctx, k, x + 40, y + rowH * 0.66, inner * 0.62, A.story ? 40 : 34, 700, INKDARK);
      say(ctx, v, x + pw - 40, y + rowH * 0.66, inner * 0.38, A.story ? 40 : 34, 900, INKDARK, "right");
      y += rowH;
      ctx.fillRect(x + 40, y - 3, inner, 3);
    }
    say(ctx, "* Daily value not established.", x + 40, top + ph - (A.story ? 44 : 34), inner, A.story ? 26 : 22, 600, "#55555c");
  };
}

/** Candy type: each letter its own colour, a little turned, sprinkles around. */
function candyDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    dim(ctx, A, 0.14);
    scrimBottom(ctx, A, 0.5, 0.75);
    const maxW = A.SW - A.PAD * 2;
    const lines = titleLines(ctx, upper(w.title), maxW, A.story ? 200 : 160);
    let size = A.story ? 200 : 160;
    for (const l of lines) size = Math.min(size, fitDisplay(ctx, l, maxW, A.story ? 200 : 160, 70));
    ctx.font = display(size);
    let k = 0;
    const subRoom = w.sub ? (A.story ? 110 : 90) : 0;
    lines.forEach((l, li) => {
      const y = A.bottom - subRoom - (lines.length - 1 - li) * size * 0.95;
      let x = (A.SW - ctx.measureText(l).width) / 2;
      for (const ch of l) {
        const cw = ctx.measureText(ch).width;
        ctx.save();
        ctx.translate(x + cw / 2, y - size * 0.35);
        ctx.rotate(((k % 5) - 2) * 0.045);
        ctx.lineWidth = Math.max(8, size * 0.07);
        ctx.strokeStyle = INKDARK;
        ctx.lineJoin = "round";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(ch, 0, 0);
        ctx.fillStyle = CANDY[k % CANDY.length];
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        if (ch !== " ") k++;
        x += cw;
      }
    });
    // sprinkles
    let seed = 13;
    for (let i = 0; i < 26; i++) {
      seed = (seed * 37 + 11) % 997;
      const sx = A.PAD + (seed % (A.SW - A.PAD * 2));
      const sy = A.top + ((seed * 7) % Math.max(1, Math.round((A.bottom - A.top) * 0.45)));
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate((seed % 31) / 5);
      ctx.fillStyle = CANDY[i % CANDY.length];
      roundRect(ctx, -16, -5, 32, 10, 5);
      ctx.fill();
      ctx.restore();
    }
    if (w.sub) tag(ctx, upper(w.sub), A.SW / 2, A.bottom - (A.story ? 64 : 54), { bg: "#ffffff", ink: INKDARK, size: A.story ? 30 : 26, align: "center" });
  };
}

/** A retro sunset: a striped sun on a horizon, the words over it. */
function retroDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    dim(ctx, A, 0.18);
    scrimBottom(ctx, A, 0.42, 0.85);
    const cx = A.SW / 2;
    const maxW0 = A.SW - A.PAD * 2;
    let bottom0 = A.bottom - 6;
    if (w.sub) {
      say(ctx, upper(w.sub), cx, bottom0, maxW0, A.story ? 36 : 30, 800, "#ffd166", "center", 8);
      bottom0 -= A.story ? 72 : 60;
    }
    const tl = titleLines(ctx, upper(w.title), maxW0, A.story ? 190 : 150);
    // (measured first, drawn last: the sun sits on a horizon just over the words)
    let tSize = A.story ? 190 : 150;
    for (const l of tl) tSize = Math.min(tSize, fitDisplay(ctx, l, maxW0, A.story ? 190 : 150, 64));
    const titleTop = bottom0 - (tl.length - 1) * tSize * 0.9 - tSize * 0.82;
    const r = A.story ? 250 : 190;
    const horizon = Math.max(A.top + r + 20, titleTop - (A.story ? 40 : 30));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, A.W, horizon);
    ctx.clip();
    const bands = ["#ffd166", "#ff9f43", "#ff6b6b", "#e84393"];
    bands.forEach((col, i) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, horizon, r, Math.PI, 0);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = col;
      const bt = horizon - r + (i * r) / bands.length;
      ctx.fillRect(cx - r, bt, r * 2, r / bands.length - (i ? 10 : 0));
      ctx.restore();
    });
    ctx.restore();
    ctx.fillStyle = "#ff6b6b";
    ctx.fillRect(A.PAD, horizon, A.SW - A.PAD * 2, 8);
    stackDisplay(ctx, tl, cx, bottom0, maxW0, tSize, 64, INK, "center", 0.9, { color: "#e84393", width: A.story ? 10 : 8 });
  };
}

/** Clean type: a small date and tag up top, the words big and lowercase at the foot. */
function cleanDesign(t: GymSpec) {
  return (ctx: Ctx, A: Area, c: FilterContext) => {
    const w = templateWords(storyFilter(t.id)!, c);
    dim(ctx, A, 0.1);
    scrimTop(ctx, A, A.top + 140, 0.4);
    scrimBottom(ctx, A, 0.5, 0.85);
    const maxW = A.SW - A.PAD * 2;
    say(ctx, `${WEEKDAY[c.now.getDay()].slice(0, 3).toUpperCase()} · ${MONTH[c.now.getMonth()].slice(0, 3).toUpperCase()} ${c.now.getDate()}`, A.PAD, A.top + 36, maxW, 30, 800, MUTED, "left", 6);
    let bottom = A.bottom - 6;
    if (w.sub) {
      say(ctx, w.sub, A.PAD, bottom, maxW, A.story ? 44 : 38, 600, MUTED);
      bottom -= A.story ? 80 : 66;
    }
    // sans, heavy, as written (lowercase stays lowercase)
    const words = w.title.split(/\s+/);
    const start = A.story ? 132 : 108;
    let size = start;
    let lines: string[] = [];
    for (; size >= 56; size -= 6) {
      ctx.font = font(800, size);
      lines = [];
      let cur = "";
      for (const word of words) {
        const next = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(next).width > maxW && cur) {
          lines.push(cur);
          cur = word;
        } else cur = next;
      }
      if (cur) lines.push(cur);
      if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
    }
    lines.slice(0, 3).forEach((l, i, all) => say(ctx, l, A.PAD, bottom - (all.length - 1 - i) * size * 1.02, maxW, size, 800, INK, "left", -1));
    rule(ctx, A.PAD, bottom - lines.slice(0, 3).length * size * 1.02 - 6, 90, 8, RED);
  };
}

const GYM_DESIGNS: Record<GymDesign, (t: GymSpec) => NonNullable<StoryFilter["over"]>> = {
  poster: posterDesign,
  lights: lightsDesign,
  tape: tapeDesign,
  meme: memeDesign,
  hud: hudDesign,
  label: labelDesign,
  candy: candyDesign,
  retro: retroDesign,
  clean: cleanDesign,
};

const GYM: GymSpec[] = [
  /* ---- Meet day --------------------------------------------------- */
  { id: "gameday", label: "Game Day", group: "meet", emoji: "🏟️", design: "poster", title: "Game day", sub: "Let's go", meet: true },
  { id: "platformready", label: "Platform Ready", group: "meet", emoji: "🟥", design: "poster", title: "Platform\nready", sub: "Chalked · belted · locked", meet: true },
  { id: "weighedin", label: "Weighed In", group: "meet", emoji: "⚖️", design: "poster", kicker: "Weigh-ins", title: "Weighed\nin", sub: "Made weight", meet: true },
  { id: "attemptseason", label: "Attempt Season", group: "meet", emoji: "📋", design: "poster", title: "Attempt\nseason", sub: "Openers are in", meet: true },
  { id: "thirddemon", label: "3rd Attempt Demon", group: "meet", emoji: "😈", design: "poster", kicker: "Third attempt", title: "3rd attempt\ndemon", sub: "All gas", meet: true },
  { id: "whitelights", label: "White Light Hunter", group: "meet", emoji: "⚪", design: "lights", lights: "www", title: "White light\nhunter", sub: "Three for three" },
  { id: "ninefornine", label: "9/9 Club", group: "meet", emoji: "💯", design: "lights", lights: "www", title: "9/9 club", sub: "Nine for nine" },
  { id: "meetaura", label: "Meet Day Aura", group: "meet", emoji: "✴️", design: "hud", hud: "popup", title: "+1000|Meet day aura", accent: CYAN },
  { id: "totalsecured", label: "Total Secured", group: "meet", emoji: "🔐", design: "poster", kicker: "Total", title: "Total\nsecured", sub: "On the board", meet: true },
  { id: "bombrisk", label: "Bomb Out Risk", group: "meet", emoji: "💣", design: "tape", title: "Bomb out risk", sub: "Proceed with caution" },
  { id: "pleasedontbomb", label: "Please Don't Bomb", group: "meet", emoji: "🙏", design: "tape", title: "Please don't bomb", sub: "Openers light" },
  { id: "roadtobomb", label: "Road to a Bomb Out", group: "meet", emoji: "🛣️", design: "tape", title: "Road to a bomb out", sub: "Next exit: 3rd attempt" },
  { id: "twoofnine", label: "2/9 But Confident", group: "meet", emoji: "😤", design: "lights", lights: "rrw", title: "2/9 but\nconfident", sub: "Still had fun" },
  { id: "judgeshate", label: "Judges Hate Me", group: "meet", emoji: "🔴", design: "lights", lights: "rrr", title: "Judges\nhate me", sub: "Depth was there" },
  { id: "commandviolation", label: "Command Violation", group: "meet", emoji: "✋", design: "lights", lights: "wrr", title: "Command\nviolation", sub: "Wait for the rack" },
  { id: "misgroove", label: "Misgroove But Send It", group: "meet", emoji: "🌀", design: "meme", title: "Misgroove|but send it" },
  { id: "savethetotal", label: "Deadlift to Save the Total", group: "meet", emoji: "🛟", design: "poster", kicker: "Last lift", title: "Deadlift to\nsave the total", sub: "One more", meet: true },
  { id: "onepull", label: "One Pull to Glory", group: "meet", emoji: "🏆", design: "poster", kicker: "Final attempt", title: "One pull\nto glory", sub: "Make it count", meet: true },
  { id: "missioncomplete", label: "Mission Complete", group: "meet", emoji: "✅", design: "hud", hud: "quest", title: "Mission complete", sub: "Meet day", accent: NEON },

  /* ---- Rest day --------------------------------------------------- */
  { id: "recoverymode", label: "Recovery Mode", group: "rest", emoji: "🛌", design: "retro", title: "Recovery\nmode", sub: "On" },
  { id: "cnsreboot", label: "CNS Reboot", group: "rest", emoji: "🔄", design: "hud", hud: "loading", title: "CNS reboot", sub: "Rebooting… 34%", accent: CYAN },
  { id: "offtheclock", label: "Off The Clock", group: "rest", emoji: "🕊️", design: "clean", title: "off the clock.", sub: "rest day" },
  { id: "noprs", label: "No PRs Today", group: "rest", emoji: "🚫", design: "clean", title: "no PRs today.", sub: "back at it tomorrow" },
  { id: "stillsore", label: "Still Sore", group: "rest", emoji: "🥴", design: "meme", title: "Still|sore" },
  { id: "doingnothing", label: "Doing Nothing Professionally", group: "rest", emoji: "🛋️", design: "clean", title: "doing nothing, professionally.", sub: "rest day" },
  { id: "activerecovery", label: "Active Recovery (Barely)", group: "rest", emoji: "🚶", design: "retro", title: "Active\nrecovery", sub: "(barely)" },
  { id: "eatsleepgrow", label: "Eat Sleep Grow", group: "rest", emoji: "🍽️", design: "clean", title: "eat. sleep. grow.", sub: "repeat" },
  { id: "restingforgains", label: "Resting for Gains", group: "rest", emoji: "😴", design: "retro", title: "Resting\nfor gains", sub: "Growth in progress" },
  { id: "domswon", label: "DOMS Won", group: "rest", emoji: "🏳️", design: "meme", title: "DOMS|won" },

  /* ---- Gym bro ---------------------------------------------------- */
  { id: "heavytherapy", label: "Heavy Is Therapy", group: "gymbro", emoji: "🧠", design: "meme", title: "Heavy is|therapy" },
  { id: "thepump", label: "The Pump", group: "gymbro", emoji: "🎈", design: "poster", kicker: "Forecast", title: "The pump", sub: "100% chance" },
  { id: "builtdifferent", label: "Built Different", group: "gymbro", emoji: "🧱", design: "meme", title: "Built|different" },
  { id: "rpe11", label: "RPE 11", group: "gymbro", emoji: "🔟", design: "hud", hud: "popup", title: "RPE 11|on a scale of 10", accent: "#ff5f5f" },
  { id: "lightweight", label: "Lightweight Baby", group: "gymbro", emoji: "🪶", design: "meme", title: "Lightweight|baby" },
  { id: "volumefailure", label: "Volume Till Failure", group: "gymbro", emoji: "📈", design: "label", title: "Volume till failure", sub: "Training facts", rows: [["Sets", "∞"], ["Reps", "till failure"], ["Rest", "0:30"], ["Regrets", "0"]] },
  { id: "bulkmode", label: "Bulk Mode", group: "gymbro", emoji: "🍔", design: "retro", title: "Bulk\nmode", sub: "Activated" },
  { id: "notnatural", label: "Not Natural Lighting", group: "gymbro", emoji: "💡", design: "meme", title: "Not natural|lighting" },
  { id: "mirrorcheck", label: "Mirror Check Mandatory", group: "gymbro", emoji: "🪞", design: "tape", title: "Mirror check mandatory", sub: "Between every set" },
  { id: "chestday", label: "Chest Day Citizen", group: "gymbro", emoji: "🫡", design: "poster", kicker: "Monday", title: "Chest day\ncitizen", sub: "Bench reserved" },

  /* ---- Brain rot -------------------------------------------------- */
  { id: "aura", label: "Aura +1000", group: "memes", emoji: "✨", design: "hud", hud: "popup", title: "+1000|Aura", accent: NEON },
  { id: "gymnpc", label: "Gym NPC", group: "memes", emoji: "🤖", design: "hud", hud: "dialogue", title: "Gym NPC", sub: "Hey. You gonna be long on that rack?", accent: CYAN },
  { id: "cnsleft", label: "CNS Left The Chat", group: "memes", emoji: "📴", design: "hud", hud: "dialogue", title: "System", sub: "CNS has left the chat.", accent: "#ff5f5f" },
  { id: "finalform", label: "Bro's Final Form", group: "memes", emoji: "🦾", design: "hud", hud: "quest", title: "Bro's final form", sub: "Evolution complete", accent: NEON },
  { id: "delulupr", label: "Delulu PR", group: "memes", emoji: "🦄", design: "candy", title: "Delulu PR", sub: "Manifesting" },
  { id: "resttimer", label: "Rest Timer 47:32", group: "memes", emoji: "⏱️", design: "hud", hud: "timer", title: "47:32", sub: "Rest timer", accent: NEON },
  { id: "patchnotes", label: "Patch Notes Live", group: "memes", emoji: "🛠️", design: "hud", hud: "patch", title: "Patch notes v11", accent: CYAN, rows: [["Squat", "+5 lb"], ["Knees", "nerfed"], ["The pump", "buffed"], ["Rest times", "longer"]] },
  { id: "lockedzero", label: "Locked In (Zero Thoughts)", group: "memes", emoji: "🔒", design: "clean", title: "locked in.", sub: "(zero thoughts)" },
  { id: "possessed", label: "Pre Workout Possessed", group: "memes", emoji: "👹", design: "meme", title: "Pre workout|possessed" },
  { id: "barspeaking", label: "The Bar Is Speaking", group: "memes", emoji: "🗣️", design: "hud", hud: "dialogue", title: "The bar", sub: "One more rep.", accent: NEON },
  { id: "nothoughts", label: "No Thoughts Just Lift", group: "memes", emoji: "🫥", design: "clean", title: "no thoughts. just lift.", sub: "" },
  { id: "mentally315", label: "Mentally at 315", group: "memes", emoji: "🧘", design: "meme", title: "Mentally at 315|physically not" },
  { id: "brainoff", label: "Brain Off Bar On", group: "memes", emoji: "🧠", design: "meme", title: "Brain off|bar on" },

  /* ---- Fuel / stims ----------------------------------------------- */
  { id: "caffeineloaded", label: "Caffeine Loaded", group: "stims", emoji: "☕", design: "label", title: "Caffeine loaded", rows: [["Serving size", "1 scoop"], ["Caffeine", "a lot"], ["Patience", "0 g"]] },
  { id: "twohundredmg", label: "200mg to Feel Normal", group: "stims", emoji: "🥤", design: "label", title: "200mg to feel normal", rows: [["Caffeine", "200 mg"], ["Feeling", "normal"], ["Tolerance", "high"]] },
  { id: "stimmedout", label: "Stimmed Out", group: "stims", emoji: "⚡", design: "hud", hud: "loading", title: "Stimmed out", sub: "Heart rate: yes", accent: "#ffd23f" },
  { id: "prehitting", label: "Pre Workout Hitting", group: "stims", emoji: "🌋", design: "meme", title: "Pre workout|hitting" },
  { id: "baddecisions", label: "Caffeine & Bad Decisions", group: "stims", emoji: "🎲", design: "label", title: "Caffeine & bad decisions", rows: [["Caffeine", "max"], ["Bad decisions", "100%"], ["Regret", "pending"]] },
  { id: "candyfueled", label: "Candy Fueled", group: "stims", emoji: "🍬", design: "candy", title: "Candy fueled", sub: "Intra workout" },
  { id: "sourcandypr", label: "Sour Candy PR", group: "stims", emoji: "🍭", design: "candy", title: "Sour candy PR", sub: "Fast carbs" },
  { id: "gummybulk", label: "Gummy Bear Bulk", group: "stims", emoji: "🧸", design: "candy", title: "Gummy bear bulk", sub: "Surplus" },
  { id: "ricekrispie", label: "Rice Krispie Powered", group: "stims", emoji: "🍚", design: "label", title: "Rice Krispie powered", rows: [["Rice Krispies", "2"], ["Carbs", "fast"], ["Power", "max"]] },
  { id: "glucosegoblin", label: "Glucose Goblin", group: "stims", emoji: "👺", design: "candy", title: "Glucose goblin", sub: "Do not disturb" },
  { id: "sugarrush", label: "Sugar Rush Squats", group: "stims", emoji: "🍩", design: "retro", title: "Sugar rush\nsquats", sub: "Fast carbs in" },
  { id: "carbloaded", label: "Carb Loaded", group: "stims", emoji: "🍝", design: "label", title: "Carb loaded", rows: [["Carbs", "yes"], ["Glycogen", "full"], ["Bench", "up"]] },
  { id: "pumpfueled", label: "Pump Fueled", group: "stims", emoji: "🎈", design: "poster", kicker: "Fuel", title: "Pump\nfueled", sub: "Carbs in, pump on" },
  { id: "vibescaffeine", label: "Running on Vibes + Caffeine", group: "stims", emoji: "🌀", design: "label", title: "Running on vibes + caffeine", rows: [["Sleep", "4 h"], ["Caffeine", "high"], ["Vibes", "immaculate"]] },
];

for (const t of GYM)
  FILTERS.push({
    id: t.id,
    label: t.label,
    group: t.group,
    emoji: t.emoji,
    over: GYM_DESIGNS[t.design](t),
    edit: { title: t.title, sub: t.sub, meet: !!t.meet },
  });

export const STORY_FILTERS: readonly StoryFilter[] = FILTERS;

/** A filter by its id (the key without "fx:"). */
export function storyFilter(id: string): StoryFilter | undefined {
  return FILTERS.find((f) => f.id === id);
}
export function filterLabel(f: StoryFilter, c: FilterContext): string {
  return typeof f.label === "function" ? f.label(c) : f.label;
}

/** The order the groups go in right now: what fits the moment first (Favorites, when the person has any, goes before all of it: buildFilterRow). */
export function groupOrder(c: FilterContext): FilterGroup[] {
  const lead: FilterGroup[] = [];
  if (c.finished) lead.push("today");
  if (c.session && !c.finished) lead.push("lockin");
  if (c.fuel === "post") lead.push("fuel");
  const rest = FILTER_GROUPS.map((g) => g.key).filter((k) => k !== "fav" && !lead.includes(k));
  return [...lead, ...rest];
}

/** The filters offered right now, grouped and in order (each group's best fit first, ties keep the catalogue's order). */
export function filterRow(c: FilterContext): StoryFilter[] {
  const out: StoryFilter[] = [];
  for (const g of groupOrder(c)) {
    if (g === "fav") continue;
    const list = FILTERS.map((f, i) => ({ f, i })).filter(({ f }) => f.group === g && (!f.when || f.when(c)));
    list.sort((a, b) => (b.f.fit?.(c) ?? 0) - (a.f.fit?.(c) ?? 0) || a.i - b.i);
    out.push(...list.map(({ f }) => f));
  }
  return out;
}

/** A template's title and second line as they'll be painted (the person's words first). */
export function templateWords(f: StoryFilter, c: FilterContext): { title: string; sub: string } {
  const own = c.custom?.[f.id];
  return { title: own?.title?.trim() || f.edit?.title || "", sub: own?.sub?.trim() ?? f.edit?.sub ?? "" };
}

/* ------------------------------------------------------------------ */
/*  Painting                                                           */
/* ------------------------------------------------------------------ */

/** Where a filter draws: a story or a full-screen post (1080×1920), a feed card (1080×1350), or any other size a post takes (grades only). */
export type FilterSize = ShareFormat | { w: number; h: number };
export function filterArea(size: FilterSize): Area {
  if (typeof size === "string") {
    const s = SHARE_SIZES[size];
    const PAD = size === "feed" ? 72 : 80;
    return { W: s.w, H: s.h, SW: s.w - (s.safeRight ? s.safeRight - PAD : 0), top: s.safeTop, bottom: s.h - s.safeBottom, PAD, story: size !== "feed" };
  }
  const story = Math.abs(size.w / size.h - 9 / 16) < 0.02;
  if (story) return filterArea("story");
  return { W: size.w, H: size.h, SW: size.w, top: 60, bottom: size.h - 60, PAD: 72, story: false };
}
/** A grade only changes the picture (no words or shapes), so it suits any shape a post takes. */
export function isGrade(f: StoryFilter): boolean {
  return !f.over;
}

/** What the design shows changes with these (and the minute, for the clocks). */
function contextKey(c: FilterContext): string {
  return JSON.stringify([c.firstName, c.session, c.finished, c.block, c.fuel, c.custom ?? null, c.now.getFullYear(), c.now.getMonth(), c.now.getDate(), c.now.getHours(), c.now.getMinutes()]);
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
