// How scores, ranks, dates and rules read everywhere: the page, the board,
// the big screen and the share cards. Pure, so it's tested.
import type { ChallengeStatus, Direction, Metric, ScoreSpec, Tiebreak, Unit } from "./types";

export const LB_PER_KG = 2.20462;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;

/** Trim trailing zeros: 225 → "225", 102.06 → "102.1" (1 decimal by default). */
export function num(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return "–";
  const f = Math.round(n * 10 ** decimals) / 10 ** decimals;
  return f.toLocaleString("en-CA", { maximumFractionDigits: decimals });
}

/** Seconds → "42.3s", "1:02.3", "1:02:03". */
export function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "–";
  if (total < 60) return `${num(total, 2)}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const whole = Math.floor(s);
  const frac = Math.round((s - whole) * 10);
  const ss = String(whole).padStart(2, "0") + (frac ? `.${frac}` : "");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const UNIT_WORD: Record<Unit, [string, string]> = {
  reps: ["rep", "reps"],
  lb: ["lb", "lb"],
  kg: ["kg", "kg"],
  s: ["sec", "sec"],
  m: ["m", "m"],
  km: ["km", "km"],
  mi: ["mi", "mi"],
  pts: ["pt", "pts"],
  cal: ["cal", "cal"],
};

/** The score as a big number and its unit: { value: "18", unit: "reps" }. */
export function scoreParts(value: number | null | undefined, spec: Pick<ScoreSpec, "metric" | "unit" | "scoring">): { value: string; unit: string } {
  if (value == null || !Number.isFinite(Number(value))) return { value: "–", unit: "" };
  const v = Number(value);
  if (spec.scoring === "bodyweight_ratio") return { value: `${num(v, 2)}×`, unit: "bodyweight" };
  if (spec.metric === "time") return { value: formatSeconds(v), unit: "" };
  const [one, many] = UNIT_WORD[spec.unit] ?? ["", ""];
  const decimals = spec.metric === "reps" ? 0 : spec.unit === "km" || spec.unit === "mi" ? 2 : 1;
  return { value: num(v, decimals), unit: v === 1 ? one : many };
}

/** "18 reps", "405 lb", "1:02.3", "1.52× bodyweight". */
export function formatScore(value: number | null | undefined, spec: Pick<ScoreSpec, "metric" | "unit" | "scoring">): string {
  const p = scoreParts(value, spec);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/** 1 → "1st", 12 → "12th", 22 → "22nd". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** A board's rank cell: "1", or "T2" when tied. */
export function rankLabel(rank: number | null | undefined, tied?: boolean | null): string {
  if (rank == null) return "–";
  return tied ? `T${rank}` : String(rank);
}

/** "225 lb (102.1 kg)" / "100 kg (220 lb)". */
export function loadText(load: number | null | undefined, unit: "lb" | "kg" | null | undefined): string | null {
  if (!load || !unit) return null;
  return unit === "lb" ? `${num(load)} lb (${num(lbToKg(load))} kg)` : `${num(load)} kg (${num(kgToLb(load), 0)} lb)`;
}

export const STATUS_META: Record<ChallengeStatus, { label: string; tone: "live" | "neutral" | "done" | "warn" | "muted" }> = {
  draft: { label: "Draft", tone: "muted" },
  upcoming: { label: "Upcoming", tone: "neutral" },
  live: { label: "Live", tone: "live" },
  paused: { label: "Paused", tone: "warn" },
  verifying: { label: "Verifying results", tone: "warn" },
  completed: { label: "Final results", tone: "done" },
  archived: { label: "Final results", tone: "done" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

/** Has a leaderboard worth showing (scores can exist). */
export function hasBoard(status: ChallengeStatus): boolean {
  return status === "live" || status === "paused" || status === "verifying" || status === "completed" || status === "archived";
}

export function isOver(status: ChallengeStatus): boolean {
  return status === "completed" || status === "archived" || status === "cancelled";
}

/** What wins, in a sentence. */
export function objectiveText(c: { objective?: string | null; activity: string; metric: Metric; direction: Direction; scoring: string; unit: Unit; load_value?: number | null; load_unit?: "lb" | "kg" | null }): string {
  if (c.objective?.trim()) return c.objective.trim();
  const load = c.load_value && c.load_unit ? ` with ${num(c.load_value)} ${c.load_unit}` : "";
  if (c.scoring === "bodyweight_ratio") return `Heaviest ${c.activity.toLowerCase()} for your bodyweight wins.`;
  if (c.scoring === "total") return `Highest total across your attempts wins.`;
  switch (c.metric) {
    case "reps":
      return `Most valid reps${load} wins.`;
    case "weight":
      return `Heaviest verified ${c.activity.toLowerCase() || "lift"} wins.`;
    case "time":
      return c.direction === "lower" ? "Fastest time wins." : "Longest time wins.";
    case "distance":
      return c.direction === "lower" ? "Shortest distance wins." : "Farthest distance wins.";
    default:
      return c.direction === "lower" ? "Lowest score wins." : "Highest score wins.";
  }
}

export const TIEBREAK_OPTIONS: { value: Tiebreak; label: string; help: string }[] = [
  { value: "shared", label: "Ties share the place", help: "Same score, same place. A prize for a shared place is split equally." },
  { value: "bodyweight_lower", label: "Lighter athlete places higher", help: "Bodyweight taken at check-in. Anyone without one shares the place." },
  { value: "next_best", label: "Next-best attempt decides", help: "For events with more than one attempt." },
  { value: "fewer_attempts", label: "Fewer attempts to hit the score", help: "For events with more than one attempt." },
];

export function tiebreakText(tb: Tiebreak, note?: string | null): string {
  if (note?.trim()) return note.trim();
  switch (tb) {
    case "bodyweight_lower":
      return "On a tie, the lighter athlete (weighed at check-in) places higher. If that can't separate them, they share the place and split the prize equally.";
    case "next_best":
      return "On a tie, the better next-best attempt places higher. If that's tied too, they share the place and split the prize equally.";
    case "fewer_attempts":
      return "On a tie, whoever reached the score in fewer attempts places higher. Otherwise they share the place and split the prize equally.";
    default:
      return "Tied scores share the place, and a prize for that place is split equally.";
  }
}

/** Parse what a judge types: reps whole, time as "1:02.5" or seconds, the rest decimals. */
export function parseScoreInput(text: string, metric: Metric): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  if (metric === "time" && t.includes(":")) {
    const parts = t.split(":").map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  if (metric === "reps" && !Number.isInteger(n)) return null;
  return n;
}

/** "Sat, Dec 12 · 10:00 AM" in the event's own time zone. */
export function eventWhen(startsAt: string | null, endsAt: string | null, timeZone = "America/Winnipeg"): string | null {
  if (!startsAt) return null;
  const s = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone }).format(s);
  const time = (d: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(d);
  if (!endsAt) return `${day} · ${time(s)}`;
  const e = new Date(endsAt);
  const sameDay = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone }).format(s) ===
    new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone }).format(e);
  if (sameDay) return `${day} · ${time(s)} – ${time(e)}`;
  const endDay = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone }).format(e);
  return `${day} – ${endDay}`;
}

export function shortDate(iso: string | null | undefined, timeZone = "America/Winnipeg"): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone }).format(new Date(iso));
}

/** Time left as "2d 4h", "3h 12m", "12:04". */
export function countdownText(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** How far you are from the place above: "1 rep to pass Cal". */
export function gapText(mine: number, theirs: number, spec: Pick<ScoreSpec, "metric" | "unit" | "scoring" | "direction">, name: string): string | null {
  const diff = spec.direction === "higher" ? theirs - mine : mine - theirs;
  if (!(diff > 0)) return `Tied with ${name}`;
  if (spec.metric === "reps" && spec.scoring !== "bodyweight_ratio") {
    const n = Math.floor(diff) + 1;
    return `${n} more rep${n === 1 ? "" : "s"} to pass ${name}`;
  }
  return `${formatScore(diff, spec)} behind ${name}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** An instant as the event's wall clock, for <input type="datetime-local">: "2026-12-12T10:00". */
export function isoToWall(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** The event's wall clock ("2026-12-12T10:00" in its zone) as an ISO instant. */
export function wallToIso(wall: string, timeZone: string): string | null {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // the zone's offset at that moment (twice, for the hour around a clock change)
  let t = asUtc;
  for (let i = 0; i < 2; i++) {
    const shown = isoToWall(new Date(t).toISOString(), timeZone);
    const sm = shown.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)!;
    const shownUtc = Date.UTC(+sm[1], +sm[2] - 1, +sm[3], +sm[4], +sm[5]);
    t = t - (shownUtc - asUtc);
  }
  return new Date(t).toISOString();
}
