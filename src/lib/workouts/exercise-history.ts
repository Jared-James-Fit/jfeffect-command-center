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
 * - lastTimeLoad / weightView: a weight in the unit you're working in (the
 *   card's kg | lb): as typed when logged in it, else converted exactly to one
 *   decimal (never rounded to a plate) with the number as logged kept beside it.
 * - trainedOn: the day a session was trained, one rule for the card and History.
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
  /**
   * The machine it was done on, when a weight on it means nothing on another
   * (equipment.ts loadEquipmentId). Two sessions on different machines are never
   * compared; a session that never said is compared as before.
   */
  equipmentKey?: string | null;
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
  const sameMachine = (s: HistorySession) => !latest.equipmentKey || !s.equipmentKey || s.equipmentKey === latest.equipmentKey;
  const prev = sorted.slice(1).find((s) => {
    if (!samePlace(s) || !sameMachine(s)) return false;
    const t = topSet(s.sets);
    if (!t || t.reps !== top.reps) return false;
    if (t.rpe != null && top.rpe != null) return Math.abs(t.rpe - top.rpe) <= 1;
    return t.rpe == null && top.rpe == null;
  });
  if (!prev) return null;
  const before = topSet(prev.sets)!;
  // The two top sets as the list reads them (weightView: exact in this unit, else to one decimal).
  const num = (s: HistorySet) => Number(weightView(s, unit).text.split(" ")[0]);
  const a = num(before);
  const b = num(top);
  const diff = Math.round((b - a) * 10) / 10;
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
    text: `${diff > 0 ? "Up" : "Down"} ${one(Math.abs(diff))} ${unit} for ${reps} since ${when} (${one(a)} → ${one(b)} ${unit})`,
    direction: diff > 0 ? "up" : "down",
  };
}

/**
 * "Last time"'s weight in the card's unit, with the unit: the number exactly as
 * logged when it was logged in this unit, else converted exactly to one decimal
 * and marked "≈" (150 kg reads "≈330.7 lb" on a pounds card, never a plate-
 * rounded 330.5; History shows the 150 kg beside it), the same number the
 * History sheet reads (weightView).
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
    if (other != null && other > 0) return `≈${one(fromOther(other))} ${unit}`;
    return null;
  }
  // Logged in the other unit: converted to a usable number and said so.
  const value = own != null && own > 0 ? own : entered != null && entered > 0 ? fromOther(entered) : other != null && other > 0 ? fromOther(other) : null;
  return value == null ? null : `≈${one(value)} ${unit}`;
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

// ─── When a session was trained ──────────────────────────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A Date's calendar day where it's read ("2026-09-21"), from an ISO timestamp or ms. */
export function localYmd(at: string | number | Date | null | undefined): string | null {
  if (at == null || at === "") return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-09-20" → that day's local midnight (ms), else 0. */
export function ymdMs(ymd: string | null | undefined): number {
  const m = YMD.exec(ymd ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0;
}

/**
 * The day a session was trained, one rule for the card's "Last time" and the
 * History sheet: the workout's day on the calendar (its scheduled instance's
 * date when it has one, which is where a moved workout went, else the program
 * day's own date), never later than the day its sets were logged (a workout
 * done early is history on the day it was done, never a date still ahead).
 * With no date at all, the day it was logged.
 *
 * Not "when the sets were typed": a meet's attempts logged the next evening
 * were lifted on meet day (Jared's Commonwealth bench: Sep 20, typed Sep 21).
 * Not the program day's date alone either: a moved workout keeps its old date
 * there (his "Taper / 4 Days Out" was moved from Sep 14 to Sep 16).
 */
export function trainedOn(input: {
  /** pl_scheduled_workouts.scheduled_date of the set's instance. */
  instanceDate?: string | null;
  /** pl_days.scheduled_date. */
  dayDate?: string | null;
  /** When the session's sets were logged (completed_at; the earliest when several). */
  loggedAt?: string | number | null;
}): string | null {
  const planned = [input.instanceDate, input.dayDate].find((d) => !!d && YMD.test(d)) ?? null;
  const logged = localYmd(input.loggedAt ?? null);
  if (planned && logged) return planned <= logged ? planned : logged;
  return planned ?? logged;
}

// ─── A weight, read in the unit you're working in ────────────────────────────

/**
 * One weight as the logger and History show it: in the unit you're working in
 * (the card's kg | lb), so sessions compare at a glance, and the number as it
 * was logged kept beside it when that was the other unit.
 *
 * - logged in this unit: the number as typed ("102.5 kg", "245 lb");
 * - logged in the other unit: converted exactly, to one decimal, never rounded
 *   to a plate ("150 kg" reads "330.7 lb"), with `logged` = "150 kg";
 * - an older set with no unit on record: its stored number in this unit.
 */
export type WeightView = {
  /** "330.7 lb", "Bodyweight", "40 lb assist", or "—". */
  text: string;
  /** The weight as logged when it was the other unit ("150 kg"), else null. */
  logged: string | null;
};

function one(n: number): string {
  return trainingWeightText(n);
}

/**
 * A weight's number, one rule for the logger, History and records: a number on
 * the plates' own steps (a quarter kg / lb, as typed: 101.25, 72.5, 315) reads
 * as it is; anything else (a conversion) exact to one decimal (330.7), never
 * rounded to a plate.
 */
export function trainingWeightText(n: number): string {
  const quarter = Math.round(n * 4) / 4;
  if (Math.abs(n - quarter) < 0.006) return String(Number(quarter.toFixed(2)));
  return String(Number((Math.round(n * 10) / 10).toFixed(1)));
}
const asTyped = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return String(r);
};

export function weightView(s: HistorySet, unit: Unit): WeightView {
  if (s.loadType === "bodyweight") return { text: "Bodyweight", logged: null };
  const assist = s.loadType === "assisted" ? " assist" : "";
  const typed = s.enteredValue != null && s.enteredValue > 0 && s.enteredUnit ? { value: s.enteredValue, unit: s.enteredUnit } : null;
  if (typed && typed.unit === unit) return { text: `${asTyped(typed.value)} ${unit}${assist}`, logged: null };
  const lb = setLb(s);
  if (lb == null) return { text: s.loadType === "assisted" ? "Assisted" : "—", logged: null };
  const value = unit === "kg" ? lb / LB_PER_KG : lb;
  return {
    text: `${one(value)} ${unit}${assist}`,
    logged: typed ? `${asTyped(typed.value)} ${typed.unit}` : null,
  };
}

/** "× 5 @ 8", "× 12 · 2 RIR", "" (reps and effort, after the weight). */
export function repsEffort(s: Pick<HistorySet, "reps" | "rpe" | "rir">): string {
  return `${s.reps != null ? `× ${s.reps}` : ""}${effort(s)}`.trim();
}

// ─── A session's sets by what they were for ──────────────────────────────────

export type SetRole = "top" | "backoff" | null;

/** One exercise row (card) of a past session, as History groups its sets. */
export type HistoryRowRef = {
  rowId: string;
  sortOrder: number;
  purposeLabel: string | null;
  notes: string | null;
  /** Planned sets (pl_exercise_rows.sets). */
  planned: number | null;
  /** Its heaviest logged set, in kg. */
  topKg: number | null;
};

const SAID_BACKOFF = /back\s*-?\s*off/i;
const NOTE_BACKOFF = /^\s*back\s*-?\s*offs?\b/i;
const SAID_TOP = /\btop\s*sets?\b/i;
const NOTE_TOP = /^\s*top\s*sets?\b/i;

/**
 * Which of a session's cards of this exercise were its top set and its
 * back-offs: the same rule as the server's pl_day_set_names (the film and the
 * coach chat), so a set is called the same thing everywhere. A card the coach
 * calls a back-off (or a top set) is one; the card before the first back-off is
 * the top set; two unlabelled cards where the first is a single set (and the
 * second wasn't heavier) are a top set and its back-offs. Anything else has no
 * role: its sets are just sets.
 */
export function historyRoles(rows: readonly HistoryRowRef[]): Map<string, SetRole> {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || (a.rowId < b.rowId ? -1 : 1));
  const said = (r: HistoryRowRef): SetRole =>
    SAID_BACKOFF.test(r.purposeLabel ?? "") || NOTE_BACKOFF.test(r.notes ?? "")
      ? "backoff"
      : SAID_TOP.test(r.purposeLabel ?? "") || NOTE_TOP.test(r.notes ?? "")
        ? "top"
        : null;
  const firstBackoff = sorted.find((r) => said(r) === "backoff")?.sortOrder ?? null;
  const anySaid = sorted.some((r) => said(r) != null);
  const out = new Map<string, SetRole>();
  sorted.forEach((r, i) => {
    let role = said(r);
    if (!role && firstBackoff != null && r.sortOrder < firstBackoff) role = "top";
    if (!role && !anySaid && sorted.length === 2 && sorted[0].planned === 1) {
      const [a, b] = [sorted[0].topKg, sorted[1].topKg];
      if (!(a != null && b != null && b > a)) role = i === 0 ? "top" : "backoff";
    }
    out.set(r.rowId, role);
  });
  return out;
}

const MEET_LABEL = /^\s*(competition|meet|attempts?|platform)\s*$/i;
const MEET_DAY = /🏆|\bchampionships?\b|\bmeet\s*day\b|[—–-]\s*meet\s*$/i;

/** A meet: the day is named for one ("🏆 Commonwealth Championships", "Meet Day"), or the card's role is the meet ("Competition"). */
export function isMeetSession(day: { title?: string | null; subtitle?: string | null }, purposeLabels: ReadonlyArray<string | null | undefined>): boolean {
  if (MEET_DAY.test(`${day.title ?? ""}`) || MEET_DAY.test(`${day.subtitle ?? ""}`)) return true;
  return purposeLabels.some((l) => MEET_LABEL.test(l ?? ""));
}

export type SessionLine = {
  role: SetRole;
  /** "330.7 lb" */
  weight: string;
  /** "150 kg" when logged in the other unit. */
  logged: string | null;
  /** "× 4 @ 6–7" */
  rest: string;
  count: number;
};

/**
 * A session's sets as a few lines, in the unit you're working in: sets in a
 * row with the same role, weight and reps read once with how many there were,
 * their RPE a range when it moved ("245 lb × 4 @ 6–7 · 2 sets").
 */
export function sessionLines(sets: ReadonlyArray<HistorySet & { role?: SetRole }>, unit: Unit): SessionLine[] {
  const out: Array<{ role: SetRole; weight: WeightView; reps: number | null; rpes: number[]; rirs: number[]; count: number }> = [];
  for (const s of sets) {
    const w = weightView(s, unit);
    const role = s.role ?? null;
    const last = out[out.length - 1];
    if (last && last.role === role && last.weight.text === w.text && last.weight.logged === w.logged && last.reps === s.reps) {
      last.count += 1;
      if (s.rpe != null && s.rpe > 0) last.rpes.push(s.rpe);
      else if (s.rir != null) last.rirs.push(s.rir);
    } else {
      out.push({ role, weight: w, reps: s.reps, rpes: s.rpe != null && s.rpe > 0 ? [s.rpe] : [], rirs: s.rpe == null && s.rir != null ? [s.rir] : [], count: 1 });
    }
  }
  const range = (xs: number[]) => {
    const lo = tidy(Math.min(...xs));
    const hi = tidy(Math.max(...xs));
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };
  return out.map((g) => ({
    role: g.role,
    weight: g.weight.text,
    logged: g.weight.logged,
    rest: `${g.reps != null ? `× ${g.reps}` : ""}${g.rpes.length ? ` @ ${range(g.rpes)}` : g.rirs.length ? ` · ${range(g.rirs)} RIR` : ""}`.trim(),
    count: g.count,
  }));
}

/** "Commonwealth Peak" from "Block 6 — Commonwealth Peak": a block by its own name. */
export function blockShortName(name: string | null | undefined): string | null {
  const t = (name ?? "").trim();
  if (!t) return null;
  const m = /^block\s*\d+\s*[—–:-]\s*(.+)$/i.exec(t);
  return (m ? m[1] : t).trim() || null;
}

// ─── The rest of the family, since the last session ──────────────────────────

export type RelatedLog = {
  exerciseId: string;
  /** The name the program used (its override), else the library's. */
  name: string;
  /** Session key (day + instance). */
  sessionKey: string;
  /** trainedOn of the session (yyyy-mm-dd). */
  day: string;
  set: HistorySet;
};

export type RelatedLift = {
  exerciseId: string;
  name: string;
  sessions: number;
  /** The latest session's day and its top set. */
  lastDay: string;
  top: HistorySet | null;
};

/**
 * The other lifts of the family trained after `since` (the competition lift's
 * last session), newest first: what the athlete did instead, so "my bench
 * history stops in September" reads as a program that moved to paused bench,
 * never as lost data. Each is named the way the program called it, with its
 * latest session's top set.
 */
export function relatedSince(logs: readonly RelatedLog[], since: string | null): RelatedLift[] {
  const byEx = new Map<string, { name: string; nameDay: string; sessions: Map<string, { day: string; sets: HistorySet[] }> }>();
  for (const l of logs) {
    if (since && !(l.day > since)) continue;
    const e = byEx.get(l.exerciseId) ?? { name: l.name, nameDay: l.day, sessions: new Map() };
    if (l.day >= e.nameDay) { e.name = l.name; e.nameDay = l.day; }
    const s = e.sessions.get(l.sessionKey) ?? { day: l.day, sets: [] };
    s.sets.push(l.set);
    e.sessions.set(l.sessionKey, s);
    byEx.set(l.exerciseId, e);
  }
  const out: RelatedLift[] = [];
  for (const [exerciseId, e] of byEx) {
    const sessions = [...e.sessions.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    const latest = sessions[0];
    out.push({ exerciseId, name: e.name, sessions: sessions.length, lastDay: latest.day, top: topSet(latest.sets) });
  }
  return out.sort((a, b) => (a.lastDay < b.lastDay ? 1 : a.lastDay > b.lastDay ? -1 : a.name.localeCompare(b.name)));
}
