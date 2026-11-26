/**
 * Smart filming reminders (pure; Nov 25 2026). A coaching client who keeps
 * training without logged footage is reminded to film a working set, at most
 * once a rolling week and once a workout, with numbers from the server
 * (`filming_status`, 20270527101700_filming_accountability.sql, which repeats
 * the eligibility rule when the reminder is recorded, so every phone agrees).
 * Nothing here calls a model: opening the logger costs one small read.
 *
 * Words: always "without logged footage", never "you haven't filmed" (they may
 * have filmed and not logged it, or sent it some other way).
 */

export type Sensitivity = "gentle" | "standard" | "firm";
export type Expectation = "main_lifts" | "one_per_workout" | "top_sets";

export type FootageStats = {
  last_footage_at: string | null;
  first_workout_at: string | null;
  /** Completed workouts since the last logged footage that had none. */
  workouts_without: number;
  c7: number; f7: number;
  c14: number; f14: number;
  c30: number; f30: number;
  /** The server's clock when it counted. */
  now?: string;
};

export type ReminderState = {
  enabled: boolean;
  sensitivity: Sensitivity;
  expectation: Expectation;
  paused_until: string | null;
  auto_paused_at: string | null;
  dismissals: number;
  shown_count: number;
  last_shown_at: string | null;
  last_shown_day_id: string | null;
  requested_at: string | null;
  coach_flagged_at: string | null;
  coach_flag_reason: "dismissed" | "no_footage" | null;
};

export type FilmingStatus = FootageStats & { coaching: boolean; coach_first?: string | null; state: ReminderState | null };

export const DEFAULT_STATE: ReminderState = {
  enabled: true,
  sensitivity: "standard",
  expectation: "main_lifts",
  paused_until: null,
  auto_paused_at: null,
  dismissals: 0,
  shown_count: 0,
  last_shown_at: null,
  last_shown_day_id: null,
  requested_at: null,
  coach_flagged_at: null,
  coach_flag_reason: null,
};

/** days / workouts to be eligible, the days the words get more direct, the days the coach is flagged instead. */
export const THRESHOLDS: Record<Sensitivity, { days: number; workouts: number; extended: number; flag: number }> = {
  gentle: { days: 10, workouts: 4, extended: 18, flag: 28 },
  standard: { days: 7, workouts: 3, extended: 14, flag: 21 },
  firm: { days: 5, workouts: 2, extended: 10, flag: 14 },
};

export const REMINDER_GAP_MS = 7 * 24 * 3600_000;
const DAY = 24 * 3600_000;

export type Tier = "first_time" | "initial" | "extended" | "continued";

/** Whole days without logged footage (since their first workout when they've never logged any). */
export function daysWithout(s: FootageStats, now: number): number {
  const from = s.last_footage_at ?? s.first_workout_at;
  if (!from) return 0;
  return Math.max(0, Math.floor((now - Date.parse(from)) / DAY));
}

export type ReminderDecision =
  | { show: true; tier: Tier; requested: boolean }
  | { show: false; why: "not_coaching" | "off" | "paused" | "this_workout" | "this_week" | "not_yet" | "flag_coach" };

/** Whether the reminder may show at this workout (the server records it only if it still agrees). */
export function reminderDecision(status: FilmingStatus | null | undefined, dayId: string, now = Date.now()): ReminderDecision {
  if (!status?.coaching) return { show: false, why: "not_coaching" };
  const st = { ...DEFAULT_STATE, ...(status.state ?? {}) };
  if (!st.enabled) return { show: false, why: "off" };
  if (st.auto_paused_at || (st.paused_until && Date.parse(st.paused_until) > now)) return { show: false, why: "paused" };
  if (st.last_shown_day_id === dayId) return { show: false, why: "this_workout" };
  const lastShown = st.last_shown_at ? Date.parse(st.last_shown_at) : null;
  const requested = !!st.requested_at && (lastShown == null || Date.parse(st.requested_at) > lastShown);
  if (!requested && lastShown != null && now - lastShown < REMINDER_GAP_MS) return { show: false, why: "this_week" };
  const th = THRESHOLDS[st.sensitivity] ?? THRESHOLDS.standard;
  const days = daysWithout(status, now);
  const tier: Tier = !status.last_footage_at
    ? "first_time"
    : st.shown_count > 0
      ? "continued"
      : days >= th.extended
        ? "extended"
        : "initial";
  if (requested) return { show: true, tier, requested: true };
  if (days < th.days || status.workouts_without < th.workouts) return { show: false, why: "not_yet" };
  if (status.last_footage_at && days >= th.flag) return { show: false, why: "flag_coach" };
  return { show: true, tier, requested: false };
}

const HEADLINES: Record<Tier, string> = {
  first_time: "Let's set the standard.",
  initial: "You're putting in the work. Let's see it.",
  extended: "Your coach can't fix what they can't see.",
  continued: "Are you getting everything out of your coaching?",
};

const EXPECTS: Record<Expectation, string> = {
  main_lifts: "one working set of each main lift",
  one_per_workout: "one working set each workout",
  top_sets: "every top set",
};

export const TAGLINE = "Film it. Log it. Improve it.";

/** The reminder's words, with their real numbers. */
export function reminderCopy(
  status: FilmingStatus,
  tier: Tier,
  opts: { coachFirst?: string | null; requested?: boolean; now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const coach = (opts.coachFirst ?? status.coach_first)?.trim() || "Your coach";
  const st = { ...DEFAULT_STATE, ...(status.state ?? {}) };
  const days = daysWithout(status, now);
  const stats: string[] = [];
  if (status.last_footage_at) stats.push(`${days} ${days === 1 ? "day" : "days"} since your last logged video`);
  if (status.workouts_without > 0)
    stats.push(`${status.workouts_without} ${status.workouts_without === 1 ? "workout" : "workouts"} without logged footage`);
  return {
    headline: HEADLINES[tier],
    stats,
    ask: opts.requested
      ? `${coach} asked for footage: ${EXPECTS[st.expectation]}.`
      : `${coach} asks for ${EXPECTS[st.expectation]}, filmed on the set you log.`,
    tagline: TAGLINE,
    primary: "Let's get some footage",
    secondary: "Maybe later",
  };
}

/* ── the coach's view ─────────────────────────────────────────────────── */

export type FootageStatusKind = "consistent" | "occasional" | "limited" | "none";

export const STATUS_LABEL: Record<FootageStatusKind, string> = {
  consistent: "Consistent",
  occasional: "Occasional",
  limited: "Limited recent footage",
  none: "No footage logged",
};

/**
 * Consistent: footage in at least half their workouts of the last 30 days and
 * some in the last 7 (or 14, with nothing done in the last 7). Occasional:
 * some in the last 14. Limited: some in 30 but none in 14. No footage logged:
 * none in 30 days.
 */
export function footageStatus(s: FootageStats): FootageStatusKind {
  if (s.f30 <= 0) return "none";
  if (s.f14 <= 0) return "limited";
  const recent = s.c7 > 0 ? s.f7 > 0 : s.f14 > 0;
  if (s.c30 > 0 && s.f30 / s.c30 >= 0.5 && recent) return "consistent";
  return "occasional";
}

/** The coach's flag, when there is one: twice dismissed (paused), or long enough without footage. */
export function coachFlag(status: FilmingStatus, now = Date.now()): string | null {
  const st = { ...DEFAULT_STATE, ...(status.state ?? {}) };
  if (st.auto_paused_at || st.coach_flag_reason === "dismissed")
    return "Dismissed the filming reminder twice. Reminders are paused until they log footage or you resume them.";
  const th = THRESHOLDS[st.sensitivity] ?? THRESHOLDS.standard;
  const days = daysWithout(status, now);
  if (status.last_footage_at && days >= th.flag && status.workouts_without > 0)
    return `${days} days without logged footage. Worth a word from you.`;
  return null;
}

/** One line for the coach's check-in review: "Footage: 2 of 5 workouts (14 days) · Occasional". */
export function checkinFootageLine(s: FootageStats, now = Date.now()): string {
  const kind = footageStatus(s);
  const part = s.c14 > 0 ? `${s.f14} of ${s.c14} workouts filmed in 14 days` : "No workouts in 14 days";
  const last = s.last_footage_at
    ? ` · last logged video ${daysWithout(s, now)}d ago`
    : " · no logged footage yet";
  return `Footage: ${part}${last} · ${STATUS_LABEL[kind]}`;
}

/* ── when it may appear ───────────────────────────────────────────────── */

/**
 * Never over something: a field being typed in, a sheet or dialog, the camera,
 * a clip being edited or sent. The logger asks this just before showing.
 */
export function screenIsBusy(doc: Document = document): boolean {
  const el = doc.activeElement;
  if (el instanceof HTMLElement && el.matches("input, textarea, select, [contenteditable='true']")) return true;
  if (doc.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-set-video-tip]')) return true;
  if (doc.documentElement.hasAttribute("data-camera-open")) return true;
  return false;
}

/** A row the reminder points at: a main / competition lift, else the coach's first barbell lift. */
export type ReminderRow = {
  rowId: string;
  name: string;
  main: boolean;
  /** Working sets written or logged on the row. */
  sets: number;
  /** Set numbers already logged. */
  logged: number[];
  /** Set numbers that already have a video. */
  filmed: number[];
  barbell: boolean;
};

export type ReminderTarget = { rowId: string; setIndex: number; name: string };

/**
 * The working sets the reminder may point at, best first: the next unlogged
 * set of each main / competition lift with no video yet, then of each barbell
 * lift. The logger takes the first one on screen. None: nothing to point at,
 * so no reminder (every main lift is done or already filmed).
 */
export function reminderTargets(rows: ReminderRow[]): ReminderTarget[] {
  const next = (r: ReminderRow): ReminderTarget | null => {
    if (r.filmed.length) return null;
    for (let i = 1; i <= Math.max(1, r.sets); i++) if (!r.logged.includes(i)) return { rowId: r.rowId, setIndex: i, name: r.name };
    return null;
  };
  const out: ReminderTarget[] = [];
  for (const r of rows) if (r.main) { const t = next(r); if (t) out.push(t); }
  if (!out.length) for (const r of rows) if (r.barbell) { const t = next(r); if (t) out.push(t); }
  return out;
}

/** The set cell's key, on its camera (`data-set-video-key`) and in the film-this-set event. */
export const setVideoKey = (rowId: string, setIndex: number) => `${rowId}:${setIndex}`;
/** Ask a set's camera to open (dispatched inside the tap, so the camera can be asked for in it). */
export const FILM_SET_EVENT = "jf:film-set";
