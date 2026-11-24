/**
 * The coach's workout quick view (Clients list → the dumbbell), pure so the
 * drawer and the tests share it (Nov 23 2026).
 *
 * Its workouts are the coach's Schedule's (getClientSchedule, the Training
 * tab's own feed and cache): one entry per dated workout, read the way the
 * Schedule reads them (buildScheduleManagerRows → statusOfRow), never a
 * second rule. Its day is one workout's prescription and what was logged on
 * it, in the training PDF's own words (training-words.ts): the plan as the
 * coach wrote it, the sets as the athlete typed them, identical sets said once.
 *
 * Which workout it opens on (`defaultEntry`): today's, else one still in
 * progress from the last few days, else the next one this week, else the
 * last one trained or missed, else whatever comes next; each with the words
 * that say why, so the coach never mistakes Thursday's workout for today's.
 */
import { buildScheduleManagerRows } from "@/components/schedule/ScheduleManagerList";
import { statusOfRow, workoutName, type CoachStatus } from "@/lib/coach-schedule";
import { exerciseNoteForAthlete } from "@/lib/workouts/coach-notes";
import { loggedSetHasInput, pickCompletion, setsForSession, type SrcCompletion } from "@/lib/workouts/training-report-data";
import { exerciseName, loggedLines, prescriptionLine, roleOf, type LoggedSet, type PrescriptionRow } from "@/lib/workouts/training-words";
import { cardRest } from "@/lib/exercise-metadata";
import { planCheck, type PlanCheck } from "@/lib/workouts/plan-vs-actual";

/* ───────────────────────────── Dates ───────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A yyyy-mm-dd as a date at local noon (never the day before in Manitoba). */
export function isoNoon(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = isoNoon(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** The Monday of the week a day is in (the app's weeks run Monday to Sunday). */
export function weekStartIso(iso: string): string {
  const d = isoNoon(iso);
  const back = (d.getDay() + 6) % 7;
  return addDaysIso(iso, -back);
}

/** "Mon, Nov 23", with the year only when it isn't this year's. */
export function shortDay(iso: string, todayIso: string): string {
  const d = isoNoon(iso);
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return iso.slice(0, 4) === todayIso.slice(0, 4) ? base : `${base}, ${iso.slice(0, 4)}`;
}

/** "Today", "Tomorrow", "Yesterday", else the day. */
export function relativeDay(iso: string, todayIso: string): string {
  if (iso === todayIso) return "Today";
  if (iso === addDaysIso(todayIso, 1)) return "Tomorrow";
  if (iso === addDaysIso(todayIso, -1)) return "Yesterday";
  return shortDay(iso, todayIso);
}

/** "Nov 16 – 22", "Nov 30 – Dec 6". */
export function weekLabel(startIso: string): string {
  const a = isoNoon(startIso);
  const b = isoNoon(addDaysIso(startIso, 6));
  const right = a.getMonth() === b.getMonth() ? String(b.getDate()) : `${MONTHS[b.getMonth()]} ${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${right}`;
}

/* ───────────────────────────── Training days ───────────────────────────── */

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_WORDS: Record<(typeof DAY_KEYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** clients.committed_training_days ("mon", "Monday", "Tue"…) as "Mon · Wed · Fri", in week order; null when none. */
export function trainingDaysLine(days: unknown): string | null {
  if (!Array.isArray(days)) return null;
  const set = new Set<string>();
  for (const raw of days) {
    const k = String(raw ?? "").trim().toLowerCase().slice(0, 3);
    if ((DAY_KEYS as readonly string[]).includes(k)) set.add(k);
  }
  const out = DAY_KEYS.filter((k) => set.has(k)).map((k) => DAY_WORDS[k]);
  return out.length ? out.join(" · ") : null;
}

/* ───────────────────────────── The workouts ───────────────────────────── */

/** What getClientSchedule returns (the parts read here). */
export type PeekSchedule = {
  blocks?: Array<{ id: string; name: string | null; start_date?: string | null; end_date?: string | null; status?: string | null; client_visible?: boolean | null }>;
  weeks?: Array<{ id: string; week_index: number; block_id: string }>;
  days?: Array<{ id: string; week_id: string; day_index: number; title?: string | null; subtitle?: string | null; focus?: string | null; scheduled_date?: string | null; is_optional?: boolean | null }>;
  completions?: Array<{ id?: string; day_id: string; completed_at?: string | null; in_progress_at?: string | null; started_at?: string | null; scheduled_workout_id?: string | null }>;
  scheduledInstances?: Array<{ id: string; source_day_id: string; scheduled_date: string | null; order_index?: number | null }>;
};

export type PeekEntry = {
  key: string;
  dayId: string;
  instanceId: string | null;
  /** yyyy-mm-dd */
  date: string;
  status: CoachStatus;
  name: string;
  focus: string | null;
  optional: boolean;
  blockId: string | null;
  blockName: string | null;
  weekIndex: number | null;
  /** How many weeks the block has. */
  weekCount: number | null;
  dayIndex: number;
};

/**
 * Every dated workout the athlete can see, oldest first (same day: the
 * Schedule's own order). A block hidden from the client (a coach's draft) and
 * undated workouts aren't part of it: the quick view is what the athlete sees.
 */
export function peekEntries(schedule: PeekSchedule | null | undefined, todayIso: string): PeekEntry[] {
  if (!schedule) return [];
  const blocks = new Map((schedule.blocks ?? []).map((b) => [b.id, b]));
  const weeks = new Map((schedule.weeks ?? []).map((w) => [w.id, w]));
  const weekCount = new Map<string, number>();
  for (const w of schedule.weeks ?? []) weekCount.set(w.block_id, Math.max(weekCount.get(w.block_id) ?? 0, w.week_index));
  const visibleDays = (schedule.days ?? []).filter((d) => {
    const w = weeks.get(d.week_id);
    const b = w ? blocks.get(w.block_id) : null;
    return !!b && b.client_visible !== false;
  });
  const { rows } = buildScheduleManagerRows({
    days: visibleDays,
    scheduledInstances: schedule.scheduledInstances ?? [],
    completions: schedule.completions ?? [],
    todayISO: todayIso,
  });
  const out: PeekEntry[] = [];
  rows.forEach((row, order) => {
    if (!row.date) return;
    const w = weeks.get(row.weekId);
    const b = w ? blocks.get(w.block_id) : null;
    out.push({
      key: row.key,
      dayId: row.dayId,
      instanceId: row.instanceId,
      date: String(row.date).slice(0, 10),
      status: statusOfRow({ status: row.status, date: row.date, day: row.day }, todayIso),
      name: workoutName(row.day ?? {}),
      focus: (row.day?.focus ?? "").trim() || null,
      optional: !!row.day?.is_optional,
      blockId: b?.id ?? null,
      blockName: (b?.name ?? "").trim() || null,
      weekIndex: w?.week_index ?? null,
      weekCount: b ? weekCount.get(b.id) ?? null : null,
      dayIndex: Number(row.day?.day_index ?? order),
    });
  });
  // stable: by date, then the order the Schedule lists them in
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
    .map(({ e }) => e);
}

export type DefaultReason = "today" | "in_progress" | "next" | "last" | "upcoming";

/** The words above a workout the quick view opened on by itself. */
export const DEFAULT_REASON_WORDS: Record<DefaultReason, string> = {
  today: "Today's workout",
  in_progress: "Still in progress",
  next: "No workout today · next one",
  last: "No workout today · last one",
  upcoming: "Next workout",
};

/** How far back a started, unfinished workout still counts as the one to look at. */
export const IN_PROGRESS_DAYS = 3;
/** How far ahead "the next one" is preferred over the last one trained. */
export const NEXT_WITHIN_DAYS = 7;

/**
 * Which workout the quick view opens on, and why: today's (one not finished
 * first, when there are two), else one still in progress from the last few
 * days, else the next one within a week, else the last one done or missed,
 * else the next one at all. Null when there's nothing dated.
 */
export function defaultEntry(entries: PeekEntry[], todayIso: string): { key: string; reason: DefaultReason } | null {
  if (!entries.length) return null;
  const today = entries.filter((e) => e.date === todayIso);
  if (today.length) {
    const open = today.find((e) => e.status !== "done") ?? today[0];
    return { key: open.key, reason: "today" };
  }
  const since = addDaysIso(todayIso, -IN_PROGRESS_DAYS);
  const started = entries.filter((e) => e.status === "in_progress" && e.date >= since && e.date < todayIso).pop();
  if (started) return { key: started.key, reason: "in_progress" };
  const ahead = entries.filter((e) => e.date > todayIso);
  const soon = ahead.find((e) => e.date <= addDaysIso(todayIso, NEXT_WITHIN_DAYS));
  if (soon) return { key: soon.key, reason: "next" };
  const past = entries.filter((e) => e.date < todayIso).pop();
  if (past) return { key: past.key, reason: "last" };
  return { key: ahead[0].key, reason: "upcoming" };
}

/**
 * What to show for a client the coach switches to: the workout they last
 * looked at for that client, else the same day as the athlete they came from
 * when this one trains that day too (an in-person session or a group's
 * review keeps its day), else their default.
 */
export function pickForClient(
  entries: PeekEntry[],
  opts: { remembered?: string | null; carryDate?: string | null; todayIso: string },
): { key: string; reason: DefaultReason | null } | null {
  if (opts.remembered && entries.some((e) => e.key === opts.remembered)) return { key: opts.remembered, reason: null };
  if (opts.carryDate) {
    const same = entries.filter((e) => e.date === opts.carryDate);
    if (same.length) {
      const pick = same.find((e) => e.status !== "done") ?? same[0];
      return { key: pick.key, reason: opts.carryDate === opts.todayIso ? "today" : null };
    }
  }
  return defaultEntry(entries, opts.todayIso);
}

/** The workout before / after one, in date order (null at either end). */
export function stepEntry(entries: PeekEntry[], key: string | null, dir: -1 | 1): PeekEntry | null {
  const i = entries.findIndex((e) => e.key === key);
  if (i < 0) return null;
  return entries[i + dir] ?? null;
}

/** A week, Monday to Sunday: each day and the workouts dated on it. */
export function weekDays(entries: PeekEntry[], startIso: string): Array<{ date: string; entries: PeekEntry[] }> {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(startIso, i);
    return { date, entries: entries.filter((e) => e.date === date) };
  });
}

/** The jump list: the last few trained or missed (newest first) and the next few ahead (soonest first). */
export function jumpList(entries: PeekEntry[], todayIso: string, opts: { recent?: number; ahead?: number } = {}) {
  const recent = entries.filter((e) => e.date < todayIso || (e.date === todayIso && e.status === "done")).slice(-(opts.recent ?? 8)).reverse();
  const ahead = entries.filter((e) => e.date > todayIso || (e.date === todayIso && e.status !== "done")).slice(0, opts.ahead ?? 5);
  return { recent, ahead };
}

/** "Block 2 — General Strength · Week 4 of 6". */
export function placeLine(e: Pick<PeekEntry, "blockName" | "weekIndex" | "weekCount">): string {
  const week = e.weekIndex ? (e.weekCount ? `Week ${e.weekIndex} of ${e.weekCount}` : `Week ${e.weekIndex}`) : null;
  return [e.blockName, week].filter(Boolean).join(" · ");
}

/* ───────────────────────────── One workout ───────────────────────────── */

export type PeekRow = PrescriptionRow & {
  id: string;
  day_id?: string;
  rest_seconds_override?: number | null;
  tracking_type?: string | null;
  cardio_target_id?: string | null;
  exercise_id?: string | null;
  exercises?: {
    id?: string | null;
    name?: string | null;
    exercise_category?: string | null;
    is_competition_lift?: boolean | null;
    competition_lift_type?: string | null;
    movement_family?: string | null;
    primary_muscle_group?: string | null;
    muscle_group?: string | null;
    equipment?: string | null;
    cues?: string | null;
    video_url?: string | null;
    vimeo_url?: string | null;
    youtube_url?: string | null;
  } | null;
};

export type PeekResult = LoggedSet & {
  id?: string;
  row_id: string;
  scheduled_workout_id?: string | null;
  completed_at?: string | null;
  is_working_set?: boolean | null;
  equipment_id?: string | null;
};

export type PeekNote = { id?: string; row_id?: string | null; exercise_name?: string | null; content: string; updated_at?: string | null };

export type PeekFeedback = {
  overall_rating?: number | null;
  session_rpe?: number | null;
  client_note?: string | null;
  pain?: boolean | null;
  pain_area?: string | null;
  pain_level?: number | null;
  hit_target?: string | null;
  fatigue_feel?: string | null;
  strength_feel?: string | null;
};

export type PeekDaySource = {
  day: { id: string; title?: string | null; subtitle?: string | null; focus?: string | null; notes?: string | null; notes_client_visible?: boolean | null; is_optional?: boolean | null; day_index?: number | null } | null;
  rows: PeekRow[];
  results: PeekResult[];
  completions: SrcCompletion[];
  notes: PeekNote[];
  feedback: PeekFeedback | null;
};

export type PeekExercise = {
  id: string;
  /** The library exercise (its setup is saved per exercise). */
  exerciseId: string | null;
  name: string;
  role: string | null;
  /** The prescription as the coach wrote it ("4 × 5 @ 75% TM · RPE 7"); its rest is `rest`. */
  plan: string;
  /** The rest the athlete's card shows: the program's, else the usual for the kind of exercise (cardRest). Never on the day's cardio. */
  rest: { seconds: number; usual: boolean } | null;
  /** This session's sets of it (what its equipment line reads). */
  sets: PeekResult[];
  /** What was logged, identical sets in a row said once ("Sets 1–3: 140 kg × 5 · RPE 8"). */
  logged: string[];
  setsPlanned: number | null;
  setsLogged: number;
  /** The coach's note as the athlete reads it (the app's boilerplate left out). */
  coachNote: string | null;
  /** What the athlete wrote on it that day. */
  athleteNotes: string[];
  details: { muscle: string | null; equipment: string | null; cues: string | null; demo: string | null };
  cardio: boolean;
};

export type PeekDay = {
  name: string;
  focus: string | null;
  completion: SrcCompletion | null;
  /** The coach's day note, and whether the athlete sees it. */
  dayNote: { text: string; visible: boolean } | null;
  /** What the athlete wrote on the workout when they finished it. */
  athleteNote: string | null;
  feedback: PeekFeedback | null;
  exercises: PeekExercise[];
  setsPlanned: number;
  setsLogged: number;
  minutes: number | null;
  /** Against the plan (the recap's own read), once anything is logged. */
  vsPlan: PlanCheck | null;
  /** The rows in the coach's order and this session's sets of them (what the load guidance reads). */
  rows: PeekRow[];
  sessionResults: PeekResult[];
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function demoOf(ex: PeekRow["exercises"]): string | null {
  for (const url of [ex?.vimeo_url, ex?.youtube_url, ex?.video_url]) {
    const u = text(url);
    if (/^https?:\/\//i.test(u)) return u;
  }
  return null;
}

/** Minutes between starting and finishing, when both are known and it reads as a session (≤ 5 hours). */
export function sessionMinutes(c: Pick<SrcCompletion, "started_at" | "completed_at"> | null | undefined): number | null {
  if (!c?.started_at || !c.completed_at) return null;
  const ms = Date.parse(c.completed_at) - Date.parse(c.started_at);
  if (!Number.isFinite(ms) || ms <= 0 || ms > 5 * 3_600_000) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * One workout for the quick view: its exercises in the coach's order with the
 * plan beside what was logged (only the sets of the session it stands for),
 * the notes from both sides and the review.
 */
export function buildPeekDay(src: PeekDaySource, opts: { instanceId: string | null; weekIndex: number | null }): PeekDay {
  const instanceCompletions = opts.instanceId ? src.completions.filter((c) => c.scheduled_workout_id === opts.instanceId) : [];
  const legacy = src.completions.filter((c) => !c.scheduled_workout_id);
  const completion = pickCompletion(instanceCompletions.length ? instanceCompletions : legacy.length ? legacy : src.completions);
  const session = completion?.scheduled_workout_id ?? opts.instanceId ?? null;

  const resultsByRow = new Map<string, PeekResult[]>();
  for (const r of src.results) {
    const list = resultsByRow.get(r.row_id);
    if (list) list.push(r);
    else resultsByRow.set(r.row_id, [r]);
  }
  const notesByRow = new Map<string, string[]>();
  for (const n of src.notes) {
    const t = text(n.content);
    if (!t || !n.row_id) continue;
    const list = notesByRow.get(n.row_id) ?? [];
    list.push(t);
    notesByRow.set(n.row_id, list);
  }

  const rows = [...src.rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  let setsPlanned = 0;
  let setsLogged = 0;
  const sessionResults: PeekResult[] = [];
  const exercises: PeekExercise[] = rows.map((r) => {
    const sets = setsForSession(resultsByRow.get(r.id) as any, session) as PeekResult[];
    sessionResults.push(...sets);
    const done = sets.filter(loggedSetHasInput);
    const planned = r.sets != null && Number(r.sets) > 0 ? Number(r.sets) : null;
    const cardio = !!r.cardio_target_id;
    if (planned && !cardio) setsPlanned += planned;
    if (!cardio) setsLogged += Math.min(done.length, planned ?? done.length);
    // the rest is its own line (Rest), so the plan doesn't say it twice
    const row: PrescriptionRow = { ...r, rest_seconds: null };
    const ex = r.exercises ?? null;
    const rest = cardRest(r as any);
    return {
      id: r.id,
      exerciseId: ex?.id ?? r.exercise_id ?? null,
      name: exerciseName(row),
      role: roleOf(row),
      plan: prescriptionLine(row),
      rest: !cardio && rest.seconds && rest.seconds > 0 ? { seconds: rest.seconds, usual: rest.usual } : null,
      sets,
      logged: loggedLines(done),
      setsPlanned: planned,
      setsLogged: done.length,
      coachNote: exerciseNoteForAthlete(r.notes, opts.weekIndex),
      athleteNotes: notesByRow.get(r.id) ?? [],
      details: {
        muscle: text(ex?.primary_muscle_group) || text(ex?.muscle_group) || null,
        equipment: text(ex?.equipment) || null,
        cues: text(ex?.cues) || null,
        demo: demoOf(ex),
      },
      cardio,
    };
  });

  const dayNoteText = text(src.day?.notes);
  const anyLogged = sessionResults.some(loggedSetHasInput);
  return {
    name: src.day ? workoutName(src.day) : "Workout",
    focus: text(src.day?.focus) || null,
    completion,
    dayNote: dayNoteText ? { text: dayNoteText, visible: src.day?.notes_client_visible === true } : null,
    athleteNote: text(completion?.client_notes) || null,
    feedback: src.feedback,
    exercises,
    setsPlanned,
    setsLogged,
    minutes: sessionMinutes(completion),
    vsPlan: anyLogged ? planCheck(rows as any, sessionResults as any) : null,
    rows,
    sessionResults,
  };
}

/** "Mon 6:12 PM" for a timestamp, in the device's time. */
export function clockLine(ts: string | null | undefined, todayIso: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const day = toIso(d);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return day === todayIso ? time : `${WEEKDAYS[d.getDay()]} ${time}`;
}

function targetWords(v: string): string | null {
  const t = v.replace(/_/g, " ").trim().toLowerCase();
  if (!t) return null;
  if (t === "yes" || t === "true") return "hit target";
  if (t === "no" || t === "false") return "missed target";
  return `target: ${t}`;
}

/** The review in one line: "4/5 · session RPE 8 · hit target". */
export function feedbackLine(f: PeekFeedback | null | undefined): string | null {
  if (!f) return null;
  const parts = [
    f.overall_rating ? `${f.overall_rating}/5` : null,
    f.session_rpe ? `session RPE ${f.session_rpe}` : null,
    targetWords(text(f.hit_target)),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "Knee · 4/10", or just "Pain" with nothing more said; null without pain. */
export function painLine(f: PeekFeedback | null | undefined): string | null {
  if (!f?.pain) return null;
  const area = text(f.pain_area).split(/[;,|]/)[0]?.trim();
  return [area || "Pain", f.pain_level ? `${f.pain_level}/10` : null].filter(Boolean).join(" · ");
}
