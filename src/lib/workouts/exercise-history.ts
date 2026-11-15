/**
 * One exercise's history, read the way an athlete reviews it (the History
 * sheet and the card's "Last time"). Pure, tested (exercise-history.test.ts).
 *
 * - workoutName: the workout as the athlete knows it in the logger: its title,
 *   else the coach's subtitle, else "Day N".
 * - sameSplit: whether a past session was the same workout as the one open
 *   now, from stable ids first: the same day, a copy of it (a week copied from
 *   another keeps `source_day_id`), the same slot of the same block, or the
 *   same named workout in another block of the same program (`prep_id`). Never
 *   the same weekday or the same slot in another program: "Full Body B" of an
 *   old at-home program is not "Strength & Hypertrophy B" because both were
 *   day 2 of their week.
 * - sessionGroups / setText: a session's sets as lifted, in the unit they were
 *   logged in ("75 lb × 12 @ 8", three of them "· 3 sets").
 * - progressSince: the one honest progress line, like with like: the latest
 *   session's top set against the last session of the same program with the
 *   same reps at about the same effort ("Up 20 lb for 12 reps since Nov 8").
 *   Never across programs (a home belt squat and a gym belt squat aren't the
 *   same load), never across rep counts.
 * - lastTimeLoad: "Last time"'s weight in the card's unit, said with its unit;
 *   a set logged in the other unit is converted to a usable number and marked
 *   "≈".
 */
import { format } from "date-fns";
import { cleanDayTitle } from "@/lib/workout-today";

export type Unit = "kg" | "lb";
const LB_PER_KG = 2.2046226218;

export type HistoryDayRef = {
  dayId: string | null;
  dayIndex: number | null;
  title: string | null;
  subtitle: string | null;
  /** The day this one was copied from (pl_days.source_day_id), when it's a copy. */
  sourceDayId: string | null;
  blockId: string | null;
  /** The program the block belongs to (pl_blocks.prep_id), when it's one of several. */
  programId: string | null;
};

/** The workout as the athlete knows it: its title, else the coach's subtitle, else "Day N". */
export function workoutName(d: Pick<HistoryDayRef, "title" | "subtitle" | "dayIndex">): string {
  const title = (d.title ?? "").trim();
  if (title && !/^day\s*\d+$/i.test(title)) return cleanDayTitle(title, d.dayIndex);
  const sub = (d.subtitle ?? "").trim();
  if (sub) return sub;
  return d.dayIndex != null ? `Day ${d.dayIndex}` : "Workout";
}

const WEEKDAYS = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|sday|urday)?$/;
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
/** "Day 2", "Workout 1", "Monday": a slot, not a workout's name. */
function isGeneric(key: string): boolean {
  return !key || /^(day|workout|session|training|week)?\d*$/.test(key) || WEEKDAYS.test(key);
}

/** Was this past session the same workout (split) as the one open now? See the header. */
export function sameSplit(day: HistoryDayRef, cur: HistoryDayRef | null | undefined): boolean {
  if (!cur) return false;
  if (day.dayId && cur.dayId && day.dayId === cur.dayId) return true;
  const a = nameKey(workoutName(day));
  const b = nameKey(workoutName(cur));
  const namedApart = !isGeneric(a) && !isGeneric(b) && a !== b;
  const sameSlot = day.dayIndex != null && day.dayIndex === cur.dayIndex;
  // A copy of the same workout (week 3 copied from week 1 keeps week 1's id).
  const rootA = day.sourceDayId ?? day.dayId;
  const rootB = cur.sourceDayId ?? cur.dayId;
  if (rootA && rootB && rootA === rootB) {
    // a copy in the same slot stays the same workout even when it was renamed
    // ("… (deload)"); a duplicate moved to another slot and renamed is another workout
    if (sameSlot || !namedApart) return true;
  }
  // Within one block, day N of every week is the same workout, unless named apart.
  if (day.blockId && day.blockId === cur.blockId && sameSlot) return !namedApart;
  // Another block of the same program: the same named workout.
  if (day.programId && day.programId === cur.programId && !isGeneric(a) && a === b) return true;
  return false;
}

export type HistorySet = {
  id: string;
  completed: boolean;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  loadType: "external" | "bodyweight" | "assisted";
  enteredValue: number | null;
  enteredUnit: Unit | null;
  kg: number | null;
  lb: number | null;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A row from pl_row_results as the History sheet reads it. */
export function historySetOf(r: any): HistorySet {
  const type = r?.load_type === "assisted" ? "assisted" : r?.load_type === "bodyweight" || r?.is_bodyweight === true ? "bodyweight" : "external";
  const unit = r?.entered_unit === "kg" || r?.entered_unit === "lb"
    ? r.entered_unit
    : r?.actual_load_unit === "kg" || r?.actual_load_unit === "lb" ? r.actual_load_unit : null;
  return {
    id: String(r?.id ?? ""),
    completed: !!r?.completed_at,
    reps: num(r?.actual_reps),
    rpe: num(r?.actual_rpe_num ?? r?.actual_rpe),
    rir: num(r?.actual_rir),
    loadType: type,
    enteredValue: num(r?.entered_value) ?? num(r?.actual_load),
    enteredUnit: unit,
    kg: num(r?.normalized_kg),
    lb: num(r?.normalized_lb),
  };
}

const tidy = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Math.round(n * 10) / 10);
/** A converted weight rounded to what's on a bar or a pin: the nearest half kg / lb. */
const usable = (n: number) => Math.round(n * 2) / 2;

/** The set's weight in pounds (any unit it was logged in), or null. */
export function setLb(s: HistorySet): number | null {
  if (s.lb != null && s.lb > 0) return s.lb;
  if (s.kg != null && s.kg > 0) return s.kg * LB_PER_KG;
  if (s.enteredValue != null && s.enteredValue > 0 && s.enteredUnit) return s.enteredUnit === "lb" ? s.enteredValue : s.enteredValue * LB_PER_KG;
  return null;
}

/** The weight as it was loaded ("75 lb", "Bodyweight", "40 lb assist"), in the unit it was logged in. */
export function setLoadText(s: HistorySet, fallbackUnit: Unit): string {
  if (s.loadType === "bodyweight") return "Bodyweight";
  const unit = s.enteredUnit ?? fallbackUnit;
  let value = s.enteredValue != null && s.enteredUnit ? s.enteredValue : unit === "kg" ? s.kg : s.lb;
  if (value == null || value <= 0) return s.loadType === "assisted" ? "Assisted" : "—";
  value = tidy(value);
  return s.loadType === "assisted" ? `${value} ${unit} assist` : `${value} ${unit}`;
}

function effort(s: Pick<HistorySet, "rpe" | "rir">): string {
  if (s.rpe != null && s.rpe > 0) return ` @ ${tidy(s.rpe)}`;
  if (s.rir != null && s.rir >= 0) return ` · ${tidy(s.rir)} RIR`;
  return "";
}

/** "75 lb × 12 @ 8". */
export function setText(s: HistorySet, fallbackUnit: Unit): string {
  return `${setLoadText(s, fallbackUnit)}${s.reps != null ? ` × ${s.reps}` : ""}${effort(s)}`;
}

/**
 * A session's sets as lifted, in order: sets in a row at the same weight and
 * reps read once with how many there were, their RPE a range when it moved
 * ("75 lb × 12 @ 8–9", 3 sets).
 */
export function sessionGroups(sets: readonly HistorySet[], fallbackUnit: Unit): Array<{ text: string; count: number }> {
  const out: Array<{ load: string; reps: number | null; rpes: number[]; rirs: number[]; count: number }> = [];
  for (const s of sets) {
    const load = setLoadText(s, fallbackUnit);
    const last = out[out.length - 1];
    if (last && last.load === load && last.reps === s.reps) {
      last.count += 1;
      if (s.rpe != null && s.rpe > 0) last.rpes.push(s.rpe);
      else if (s.rir != null) last.rirs.push(s.rir);
    } else {
      out.push({ load, reps: s.reps, rpes: s.rpe != null && s.rpe > 0 ? [s.rpe] : [], rirs: s.rpe == null && s.rir != null ? [s.rir] : [], count: 1 });
    }
  }
  return out.map((g) => {
    const range = (xs: number[]) => {
      const lo = tidy(Math.min(...xs));
      const hi = tidy(Math.max(...xs));
      return lo === hi ? `${lo}` : `${lo}–${hi}`;
    };
    const eff = g.rpes.length ? ` @ ${range(g.rpes)}` : g.rirs.length ? ` · ${range(g.rirs)} RIR` : "";
    return { text: `${g.load}${g.reps != null ? ` × ${g.reps}` : ""}${eff}`, count: g.count };
  });
}

/** The session's top set: the heaviest finished set with a weight (more reps on a tie). */
export function topSet(sets: readonly HistorySet[]): HistorySet | null {
  let best: HistorySet | null = null;
  for (const s of sets) {
    if (!s.completed || s.loadType !== "external" || !(s.reps && s.reps > 0)) continue;
    const lb = setLb(s);
    if (lb == null) continue;
    const bestLb = best ? setLb(best) ?? 0 : -1;
    if (lb > bestLb + 1e-6 || (Math.abs(lb - bestLb) < 1e-6 && (s.reps ?? 0) > (best?.reps ?? 0))) best = s;
  }
  return best;
}

export type HistorySession = {
  key: string;
  /** When it was trained (ms). */
  at: number;
  blockId: string | null;
  programId: string | null;
  sets: HistorySet[];
};

/** "Nov 8", with the year when it isn't this year. */
export function shortDay(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  return format(d, d.getFullYear() === new Date(now).getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/** "Today", "Yesterday", "4 days ago", "1 week ago", "3 weeks ago", else null (the date says it). */
export function relativeDay(ms: number, now: number = Date.now()): string | null {
  const a = new Date(ms);
  const b = new Date(now);
  const days = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  return null;
}

/**
 * The latest session against the last one it can honestly be compared with:
 * the same program (block or `prep_id`), the same reps on the top set and,
 * when both logged one, an RPE within a point. Null when there's no such pair.
 */
export function progressSince(
  sessions: readonly HistorySession[],
  unit: Unit,
  now: number = Date.now(),
): { text: string; direction: "up" | "down" | "same" } | null {
  const sorted = [...sessions].sort((x, y) => y.at - x.at);
  const latest = sorted[0];
  if (!latest) return null;
  const top = topSet(latest.sets);
  if (!top) return null;
  const samePlace = (s: HistorySession) =>
    (!!latest.blockId && s.blockId === latest.blockId) || (!!latest.programId && s.programId === latest.programId);
  const prev = sorted.slice(1).find((s) => {
    if (!samePlace(s)) return false;
    const t = topSet(s.sets);
    if (!t || t.reps !== top.reps) return false;
    if (t.rpe != null && top.rpe != null) return Math.abs(t.rpe - top.rpe) <= 1;
    return t.rpe == null && top.rpe == null;
  });
  if (!prev) return null;
  const before = topSet(prev.sets)!;
  const toUnit = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const a = usable(toUnit(setLb(before)!));
  const b = usable(toUnit(setLb(top)!));
  const diff = Math.round((b - a) * 2) / 2;
  const when = shortDay(prev.at, now);
  const reps = `${top.reps} rep${top.reps === 1 ? "" : "s"}`;
  if (Math.abs(diff) < (unit === "kg" ? 0.5 : 1)) {
    const easier = before.rpe != null && top.rpe != null && top.rpe <= before.rpe - 0.5;
    return {
      text: easier
        ? `Same weight for ${reps} as ${when}, and easier (RPE ${tidy(top.rpe!)}, was ${tidy(before.rpe!)})`
        : `Same weight for ${reps} as ${when}`,
      direction: easier ? "up" : "same",
    };
  }
  return {
    text: `${diff > 0 ? "Up" : "Down"} ${tidy(Math.abs(diff))} ${unit} for ${reps} since ${when} (${tidy(a)} → ${tidy(b)} ${unit})`,
    direction: diff > 0 ? "up" : "down",
  };
}

/**
 * "Last time"'s weight in the card's unit, with the unit: the number exactly as
 * logged when it was logged in this unit, else converted to the nearest half
 * and marked "≈" (25 kg reads "≈55 lb" on a pounds card).
 */
export function lastTimeLoad(
  log: { enteredValue?: number | null; enteredUnit?: Unit | null; normalizedKg?: number | null; normalizedLb?: number | null },
  unit: Unit,
): string | null {
  const entered = num(log.enteredValue);
  if (entered != null && entered > 0 && log.enteredUnit === unit) return `${tidy(entered)} ${unit}`;
  const own = num(unit === "kg" ? log.normalizedKg : log.normalizedLb);
  const other = num(unit === "kg" ? log.normalizedLb : log.normalizedKg);
  const fromOther = (v: number) => (unit === "kg" ? v / LB_PER_KG : v * LB_PER_KG);
  // An older set with no entered unit on record: its stored value in this unit is the number.
  if (!log.enteredUnit) {
    if (own != null && own > 0) return `${tidy(own)} ${unit}`;
    if (other != null && other > 0) return `≈${tidy(usable(fromOther(other)))} ${unit}`;
    return null;
  }
  // Logged in the other unit: converted to a usable number and said so.
  const value = own != null && own > 0 ? own : entered != null && entered > 0 ? fromOther(entered) : other != null && other > 0 ? fromOther(other) : null;
  return value == null ? null : `≈${tidy(usable(value))} ${unit}`;
}

/** A pl_days row (and its block) as the history reads it. */
export function dayRefOf(day: any, block: any): HistoryDayRef {
  return {
    dayId: day?.id ?? null,
    dayIndex: day?.day_index ?? null,
    title: day?.title ?? null,
    subtitle: day?.subtitle ?? null,
    sourceDayId: day?.source_day_id ?? null,
    blockId: block?.id ?? null,
    programId: block?.prep_id ?? null,
  };
}
