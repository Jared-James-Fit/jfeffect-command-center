/**
 * One client, one coordinated check-in. The weekly check-in is the only
 * recurring form; anything else a feature needs from the client that week
 * rides on it as a step, only when it's due and not already on file, and the
 * reason is kept on the check-in so the coach can see why it was asked (or
 * not). Deterministic: the same records give the same plan, nothing here calls
 * a model. Pure, tested (checkin-coordination.test.ts).
 *
 * What it decides:
 * - bodyweight: never a question. Weigh-ins are read from their log; a "log
 *   this morning's weight" step shows only when nothing was logged in 7 days.
 * - weight_making: a meet with a weight class within 16 weeks (or a dated
 *   "make weight" goal) adds one question on how making weight feels.
 * - photos / measurements: when the coach's progress schedule (the Progress
 *   tab, progress_check_in_schedules) says they're due, or every 4 weeks for a
 *   client with an active weight goal or meet; never when they're already on
 *   file inside the window, and never before the schedule says.
 * - the monthly Nutrition Update waiting unanswered: one line in the check-in
 *   pointing at it, never a second reminder.
 * Also the delivery rules shared with the SQL schedulers and the digest:
 * which automated cards the unread nudge leaves to the digest, the digest's
 * lines, and the warnings a coach sees before sending a request by hand.
 */

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);

export const PLAN_VERSION = 1;
/** Weekly check-in extras, in the order they're asked. */
export type CheckinExtra = "bodyweight" | "weight_making" | "photos" | "measurements" | "nutrition_update";

export type ScheduleFrequency = "weekly" | "biweekly" | "monthly" | "per_block" | "custom" | "none";
export type ProgressSchedule = { kind: "photos" | "measurements" | "videos" | "bodyweight"; enabled: boolean; frequency: ScheduleFrequency; customDays: number | null };

/** Days between asks for each schedule (a block counts as 4 weeks). */
export function scheduleDays(s: Pick<ProgressSchedule, "frequency" | "customDays">): number | null {
  switch (s.frequency) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
    case "per_block":
      return 28;
    case "custom":
      return s.customDays && s.customDays > 0 ? s.customDays : null;
    default:
      return null;
  }
}

/** A weight goal or a meet: photos and the tape every 4 weeks unless the coach set their own schedule. */
export const GOAL_PROGRESS_DAYS = 28;
/** Already on file this close to the check-in: not asked again. */
export const ON_FILE_SLACK_DAYS = 3;
/** Weigh-ins: a step only when nothing was logged in this long. */
export const BODYWEIGHT_FRESH_DAYS = 7;
/** A weight class this close makes weight-making a question. */
export const WEIGHT_MAKING_WEEKS = 16;

export type PlanInput = {
  /** The check-in's due day (their local date). */
  due: string;
  lastWeighIn: string | null;
  weighInsLast7: number;
  meet: { date: string; weightClass: string | null; name: string | null } | null;
  /** clients.bodyweight_goal_* with its date, when set. */
  goal: { type: string | null; date: string | null } | null;
  lastPhotos: string | null;
  lastMeasurements: string | null;
  schedules: ProgressSchedule[];
  /** A Nutrition Update request sent and not answered yet (its date). */
  nutritionPendingSince: string | null;
};

export type CheckinPlan = {
  version: number;
  extras: Array<{ key: CheckinExtra; reason: string }>;
  /** What wasn't asked and why: on file, not due yet. */
  skipped: Array<{ key: CheckinExtra; reason: string }>;
};

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function progressDue(kind: "photos" | "measurements", last: string | null, x: PlanInput, goalActive: boolean): { due: boolean; reason: string } | null {
  const sched = x.schedules.find((s) => s.kind === kind && s.enabled);
  const every = sched ? scheduleDays(sched) : goalActive ? GOAL_PROGRESS_DAYS : null;
  if (!every) return null;
  const why = sched ? `your schedule (every ${every} days)` : "every 4 weeks while there's a weight goal or a meet";
  const label = kind === "photos" ? "Progress photos" : "Measurements";
  if (last && daysBetween(last, x.due) < every - ON_FILE_SLACK_DAYS) {
    return { due: false, reason: `${label} on file from ${fmt(last)}; next due about ${fmt(new Date(dayNum(last) * DAY + every * DAY).toISOString())} (${why})` };
  }
  return { due: true, reason: `${label} due: ${last ? `last ${fmt(last)}` : "none on file"} (${why})` };
}

export function planCheckin(x: PlanInput): CheckinPlan {
  const extras: CheckinPlan["extras"] = [];
  const skipped: CheckinPlan["skipped"] = [];

  // bodyweight: read from the log, asked only when there's nothing recent
  if (!x.lastWeighIn || daysBetween(x.lastWeighIn, x.due) > BODYWEIGHT_FRESH_DAYS) {
    extras.push({ key: "bodyweight", reason: x.lastWeighIn ? `No weigh-in since ${fmt(x.lastWeighIn)}: one quick entry, saved to their log` : "No weigh-ins logged yet: one quick entry, saved to their log" });
  } else {
    skipped.push({ key: "bodyweight", reason: `Read from their log (${x.weighInsLast7} weigh-in${x.weighInsLast7 === 1 ? "" : "s"} this week), not asked` });
  }

  // weight-making: a class meet (or a dated make-weight goal) within 16 weeks
  const meetWeeks = x.meet ? daysBetween(x.due, x.meet.date) / 7 : null;
  const classMeet = !!x.meet?.weightClass?.trim() && meetWeeks != null && meetWeeks >= 0 && meetWeeks <= WEIGHT_MAKING_WEEKS;
  const goalWeeks = x.goal?.type === "performance_cut" && x.goal.date ? daysBetween(x.due, x.goal.date) / 7 : null;
  const cutGoal = goalWeeks != null && goalWeeks >= 0 && goalWeeks <= WEIGHT_MAKING_WEEKS;
  if (classMeet) extras.push({ key: "weight_making", reason: `${x.meet!.name ?? "Meet"} in ${Math.round(meetWeeks!)} week${Math.round(meetWeeks!) === 1 ? "" : "s"}, ${x.meet!.weightClass!.trim()} class` });
  else if (cutGoal) extras.push({ key: "weight_making", reason: `Weight to make by ${fmt(x.goal!.date!)}` });

  // photos and measurements: the coach's schedule, else every 4 weeks with a weight goal or a meet
  const goalActive = classMeet || cutGoal || !!(x.goal?.type && x.goal.type !== "maintain") || (x.meet != null && meetWeeks != null && meetWeeks >= 0 && meetWeeks <= 26);
  for (const kind of ["photos", "measurements"] as const) {
    const d = progressDue(kind, kind === "photos" ? x.lastPhotos : x.lastMeasurements, x, goalActive);
    if (!d) continue;
    (d.due ? extras : skipped).push({ key: kind, reason: d.reason });
  }

  // the monthly Nutrition Update waiting: one pointer, not another reminder
  if (x.nutritionPendingSince && daysBetween(x.nutritionPendingSince, x.due) <= 14) {
    extras.push({ key: "nutrition_update", reason: `Nutrition Update sent ${fmt(x.nutritionPendingSince)} is still waiting: finished from here, no separate reminder` });
  }
  return { version: PLAN_VERSION, extras, skipped };
}

/* ------------------------------------------------------------------------ */
/* Delivery rules shared with the schedulers                                  */

/**
 * The unread-message nudge leaves automated request cards (the weekly
 * check-in, the monthly Nutrition Update) to the morning digest, which stops
 * the moment they're answered; a coach's own words and anything sent by hand
 * still get it.
 */
export function isNudgeable(m: { is_automated?: boolean | null; message_type?: string | null }): boolean {
  if (!m.is_automated) return true;
  return !["Scheduling", "Check-In", "Form"].includes(String(m.message_type ?? ""));
}

/** The morning digest's lines, in order, nothing that isn't due. */
export function digestLines(x: { workout: string | null; checkinPending: boolean; nutritionPending: boolean; weighInDue: boolean }): Array<string | null> {
  const asks = [x.checkinPending ? "your check-in" : null, x.nutritionPending ? "your nutrition update" : null].filter(Boolean) as string[];
  return [
    x.workout,
    asks.length ? `${asks.join(" and ")} ${asks.length > 1 ? "are" : "is"} waiting` : null,
    x.weighInDue ? "log this morning's weight" : null,
  ];
}

/**
 * Meet week: a weigh-in line in the digest when the meet (with a class) is
 * 10 days out or less and nothing was logged today or yesterday. One line in
 * the push they already get, never a push of its own.
 */
export function weighInDue(x: { today: string; meetDate: string | null; weightClass: string | null; lastWeighIn: string | null }): boolean {
  if (!x.meetDate || !x.weightClass?.trim()) return false;
  const out = daysBetween(x.today, x.meetDate);
  if (out < 0 || out > 10) return false;
  return !x.lastWeighIn || daysBetween(x.lastWeighIn, x.today) >= 2;
}

/**
 * The monthly Nutrition Update goes out with the weekly check-in: in the last
 * 7 days of the month, on the morning that week's check-in card went out;
 * a client with no weekly check-in in that window gets it on the last Monday
 * (the old rule). Mirrors enqueue_monthly_nutrition_updates.
 */
export function nutritionSendsToday(x: { today: string; weeklyCardToday: boolean; weeklyCardDueThisWindow: boolean; lastMonday: string }): boolean {
  const d = new Date(`${x.today}T12:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const inWindow = d.getUTCDate() > last - 7;
  if (!inWindow) return false;
  if (x.weeklyCardToday) return true;
  if (x.weeklyCardDueThisWindow) return false;
  return daysBetween(x.lastMonday, x.today) >= 0 && daysBetween(x.lastMonday, x.today) <= 2;
}

/* ------------------------------------------------------------------------ */
/* A coach sending by hand                                                    */

export type RequestStatus = {
  weekly: { pendingSince: string | null; nextAutomated: string | null };
  nutrition: { pendingSince: string | null };
};

/** What the coach should know before sending: a send by hand is always theirs to make. */
export function requestWarnings(kind: "weekly_checkin" | "nutrition_update", s: RequestStatus, today: string): string[] {
  const out: string[] = [];
  if (kind === "weekly_checkin") {
    if (s.weekly.pendingSince) out.push(`The check-in sent ${fmt(s.weekly.pendingSince)} is still open: this one replaces it.`);
    if (s.weekly.nextAutomated && daysBetween(today, s.weekly.nextAutomated) >= 0 && daysBetween(today, s.weekly.nextAutomated) <= 4)
      out.push(`Their weekly check-in goes out on its own ${fmt(s.weekly.nextAutomated)}. Sending now counts as this week's, so that one won't go out.`);
  } else if (s.nutrition.pendingSince) {
    out.push(`Their Nutrition Update sent ${fmt(s.nutrition.pendingSince)} hasn't been answered yet. Sending again gives them a fresh one.`);
  }
  return out;
}
