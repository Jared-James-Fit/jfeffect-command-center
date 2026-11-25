/**
 * Cardio story overlays (Nov 25 2026): the data and the words behind the
 * Cardio group of story filters (story-filters.ts, cardio-story-paint.ts).
 * Pure and tested (cardio-story.test.ts). Nothing is ever made up: a metric
 * the session didn't record is left out, and the athlete can hide any one.
 */

export type CardioTone = "locked" | "funny" | "aesthetic";

/** The coach's lines, by tone. Every one reads as cardio. */
export const CARDIO_PHRASES: Record<CardioTone, readonly string[]> = {
  locked: [
    "CARDIO. NO EXCUSES.",
    "GETTING MY STEPS IN.",
    "THE CUT CONTINUES.",
    "INCLINE & DISCIPLINE.",
    "DAILY CARDIO DEPOSIT.",
    "CARDIO IS NON-NEGOTIABLE.",
    "ONE STEP LEANER.",
    "WALKING WITH PURPOSE.",
  ],
  funny: [
    "Walking away from my problems.",
    "Incline today. Decline invitations tomorrow.",
    "Cardio against my will.",
    "Mentally at the buffet.",
    "Just a hamster with goals.",
    "Hot people do cardio.",
    "My coach said 30 minutes.",
    "Unfortunately, cardio works.",
    "Emotionally attached to the countdown.",
    "Walking to absolutely nowhere.",
  ],
  aesthetic: [
    "cardio club.",
    "morning miles.",
    "the incline club.",
    "steps & silence.",
    "daily movement.",
    "walking therapy.",
    "low intensity. high standards.",
    "the cardio diaries.",
  ],
};

/** The line a style starts on: one of its tone's, a new one each day (the athlete can pick or type another). */
export function defaultCardioPhrase(tone: CardioTone, now: Date, salt = 0): string {
  const list = CARDIO_PHRASES[tone];
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
  return list[(day + salt) % list.length];
}

export type CardioMetricId = "duration" | "incline" | "speed" | "minutes" | "heartRate" | "zone" | "steps" | "week" | "sessions" | "distance" | "streak";

export const CARDIO_METRIC_LABELS: Record<CardioMetricId, string> = {
  duration: "Duration",
  incline: "Incline",
  speed: "Speed",
  minutes: "Minutes",
  heartRate: "Avg heart rate",
  zone: "Zone",
  steps: "Steps",
  week: "Minutes this week",
  sessions: "Sessions this week",
  distance: "Distance",
  streak: "Streak",
};

/** What the story can read about the athlete's cardio (all optional; null = not recorded). */
export type CardioStoryData = {
  /** The newest completed cardio session (its own numbers). */
  session: {
    date: string;
    minutes: number | null;
    incline: number | null;
    /** In the athlete's unit already. */
    speed: { value: number; unit: "mph" | "km/h" } | null;
    bpm: number | null;
    zone: string | null;
    steps: number | null;
    distance: { value: number; unit: string } | null;
  } | null;
  week: { minutes: number; done: number; prescribed: number | null } | null;
  /** Days in a row with a completed session, ending today or yesterday. */
  streak: number | null;
  /** A session was completed today or yesterday: cardio's filters lead the row. */
  fresh: boolean;
};

export type CardioMetric = { id: CardioMetricId; label: string; value: string; unit: string };

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const trim = (n: number) => String(Math.round(n * 10) / 10);

/** The metrics a style may show, in order, with the missing and the hidden left out. `only` limits it to the ones a style has room for. */
export function cardioMetrics(d: CardioStoryData | null | undefined, hidden: readonly string[] = [], only?: readonly CardioMetricId[]): CardioMetric[] {
  if (!d) return [];
  const s = d.session;
  const out: CardioMetric[] = [];
  if (s) {
    if (pos(s.minutes)) out.push({ id: "duration", label: "TIME", value: String(Math.round(s.minutes)), unit: "MIN" });
    if (s.incline != null && Number.isFinite(s.incline) && s.incline >= 0) out.push({ id: "incline", label: "INCLINE", value: trim(s.incline), unit: "%" });
    if (s.speed && pos(s.speed.value)) out.push({ id: "speed", label: "SPEED", value: trim(s.speed.value), unit: s.speed.unit.toUpperCase() });
    if (pos(s.bpm)) out.push({ id: "heartRate", label: "AVG HR", value: String(Math.round(s.bpm)), unit: "BPM" });
    if (s.zone && s.zone.trim()) out.push({ id: "zone", label: "ZONE", value: s.zone.trim().slice(0, 8).toUpperCase(), unit: "" });
    if (s.distance && pos(s.distance.value)) out.push({ id: "distance", label: "DISTANCE", value: trim(s.distance.value), unit: s.distance.unit.toUpperCase() });
    if (pos(s.steps)) out.push({ id: "steps", label: "STEPS", value: Math.round(s.steps).toLocaleString("en-US"), unit: "" });
  }
  if (d.week && pos(d.week.minutes)) out.push({ id: "week", label: "THIS WEEK", value: String(Math.round(d.week.minutes)), unit: "MIN" });
  if (d.week && d.week.prescribed && d.week.prescribed > 0) out.push({ id: "sessions", label: "SESSIONS", value: `${Math.min(d.week.done, 99)}/${d.week.prescribed}`, unit: "" });
  if (d.streak && d.streak >= 2) out.push({ id: "streak", label: "STREAK", value: String(d.streak), unit: "DAYS" });
  return out.filter((m) => !hidden.includes(m.id) && (!only || only.includes(m.id)));
}

/** A clock from whole minutes ("32:00", "1:05:00"): the stopwatch's face. Null when there's no duration. */
export function stopwatchFace(minutes: number | null | undefined): string | null {
  if (!pos(minutes)) return null;
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:00` : `${m}:00`;
}

/* ------------------------------------------------------------------ */
/*  Reading the athlete's cardio                                       */
/* ------------------------------------------------------------------ */

export type CardioCompletionRead = {
  completed_date: string;
  completed?: boolean | null;
  skipped?: boolean | null;
  duration_minutes?: number | null;
  incline?: number | null;
  avg_speed?: number | null;
  avg_heart_rate?: number | null;
  steps?: number | null;
  distance?: number | null;
  distance_unit?: string | null;
  cardio_target_id?: string | null;
};
export type CardioTargetRead = { id: string; frequency_per_week?: number | null; heart_rate_zone?: string | null };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isDone = (c: CardioCompletionRead) => !!c.completed && !c.skipped;

/** The Monday (local) of the week `now` is in, as YYYY-MM-DD. */
export function weekStartISO(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

/** Consecutive days with a completed session, counted back from today (or yesterday when today has none yet). */
export function cardioDayStreak(completions: CardioCompletionRead[], now: Date): number {
  const days = new Set(completions.filter(isDone).map((c) => c.completed_date));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(iso(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(iso(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/**
 * Everything the cardio overlays can show, read from the athlete's own
 * cardio_completions (recent) and active cardio_targets. `distance_unit`
 * decides the speed's unit (mi → mph, else km/h); speeds are stored in mph.
 * The zone comes from the session's own target (never guessed from a pulse).
 */
export function buildCardioStory(i: { completions: CardioCompletionRead[]; targets: CardioTargetRead[]; now: Date }): CardioStoryData | null {
  const done = i.completions.filter(isDone).sort((a, b) => (a.completed_date < b.completed_date ? 1 : -1));
  if (!done.length) return null;
  const last = done[0];
  const miles = (last.distance_unit ?? "").toLowerCase().startsWith("mi");
  const speed = pos(last.avg_speed) ? { value: miles ? last.avg_speed! : last.avg_speed! * 1.609344, unit: (miles ? "mph" : "km/h") as "mph" | "km/h" } : null;
  const target = i.targets.find((t) => t.id === last.cardio_target_id);
  const start = weekStartISO(i.now);
  const thisWeek = done.filter((c) => c.completed_date >= start);
  const prescribed = i.targets.reduce((n, t) => n + (pos(t.frequency_per_week) ? t.frequency_per_week : 0), 0);
  const today = iso(i.now);
  const y = new Date(i.now.getFullYear(), i.now.getMonth(), i.now.getDate() - 1);
  return {
    session: {
      date: last.completed_date,
      minutes: pos(last.duration_minutes) ? last.duration_minutes! : null,
      incline: last.incline != null && Number.isFinite(last.incline) ? last.incline : null,
      speed,
      bpm: pos(last.avg_heart_rate) ? last.avg_heart_rate! : null,
      zone: target?.heart_rate_zone?.trim() || null,
      steps: pos(last.steps) ? last.steps! : null,
      distance: pos(last.distance) ? { value: last.distance!, unit: last.distance_unit || "km" } : null,
    },
    week: { minutes: thisWeek.reduce((n, c) => n + (pos(c.duration_minutes) ? c.duration_minutes! : 0), 0), done: thisWeek.length, prescribed: prescribed > 0 ? prescribed : null },
    streak: cardioDayStreak(i.completions, i.now),
    fresh: last.completed_date === today || last.completed_date === iso(y),
  };
}

/* ------------------------------------------------------------------ */
/*  Position and size                                                  */
/* ------------------------------------------------------------------ */

/** Where the athlete put the overlay: `x`, `y` 0..1 across the room it has, `s` its size (MIN_SCALE..1 of the safe width). */
export type CardioPlace = { x: number; y: number; s: number };
export const CARDIO_MIN_SCALE = 0.6;
export const DEFAULT_CARDIO_PLACE: CardioPlace = { x: 0.5, y: 0.82, s: 1 };

export function cleanPlace(p: Partial<CardioPlace> | null | undefined): CardioPlace {
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { x: n(p?.x, DEFAULT_CARDIO_PLACE.x, 0, 1), y: n(p?.y, DEFAULT_CARDIO_PLACE.y, 0, 1), s: n(p?.s, 1, CARDIO_MIN_SCALE, 1) };
}

/**
 * The box (design size bw × bh) placed in the story's safe area: scaled by
 * `s`, then moved across whatever room is left. Always entirely inside
 * left..right × top..bottom, whatever the place says.
 */
export function placeBox(area: { left: number; right: number; top: number; bottom: number }, bw: number, bh: number, place?: Partial<CardioPlace> | null) {
  const p = cleanPlace(place);
  const room = { w: area.right - area.left, h: area.bottom - area.top };
  // size 1 = as wide as the safe width allows (or as tall, if the box is taller than wide)
  const fit = Math.min(room.w / bw, room.h / bh);
  const k = fit * p.s;
  const w = bw * k;
  const h = bh * k;
  return { k, x: area.left + (room.w - w) * p.x, y: area.top + (room.h - h) * p.y, w, h };
}
