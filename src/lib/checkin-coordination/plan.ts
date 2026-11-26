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
 * - photos / measurements: the coach's progress schedule (the Progress tab,
 *   progress_check_in_schedules) when it's switched on, never when it's set to
 *   "No reminder", else their goal's default (progressDefault: a physique goal
 *   asks for photos every 4 weeks and the waist every 2 to 4; maintenance, no
 *   goal and a weight-class meet ask for neither); never when they're already
 *   on file inside the window. Always an optional step, never required.
 * - the monthly Nutrition Update waiting unanswered: answered right inside the
 *   check-in when they've sent one before (nutrition-fold.ts: only what's new
 *   this month, the rest carried), else one line pointing at the form.
 * Also the delivery rules shared with the SQL schedulers and the digest:
 * which automated cards the unread nudge leaves to the digest, the digest's
 * lines, and the warnings a coach sees before sending a request by hand.
 */

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);

export const PLAN_VERSION = 1;
/** Weekly check-in extras, in the order they're asked. */
export type CheckinExtra = "bodyweight" | "weight_making" | "photos" | "measurements" | "nutrition_update" | "roadmap" | "profile";

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
  /** The current nutrition plan's phase (Fat Loss, Recomp, Muscle Gain, Maintenance…). */
  phase?: string | null;
  /** Their last submitted Nutrition Update (its date): this month's can be answered inside the check-in. */
  nutritionLastAnswered?: string | null;
  /** The form's goal and free-meal options, for the inline section. */
  nutritionOptions?: { goal: string[]; freeMeal: string[] } | null;
  /** Their last update never answered the free meal (it came later): asked inline. */
  nutritionAskFreeMeal?: boolean;
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
  /** What the nutrition roadmap needs told apart this week (nutrition-roadmap/checkins.ts), and why. */
  roadmap?: { asks: string[]; reason: string | null; sex?: "M" | "F" | null } | null;
  /** One missing work & lifestyle answer worth one optional tap this week (client-context checkinProfileAsk), or none. */
  profileAsk?: { field: string; prompt: string; options: string[] } | null;
};

export type PlanExtra = {
  key: CheckinExtra;
  reason: string;
  /** nutrition_update: answered inside the check-in (the monthly section), not the separate form. */
  inline?: boolean;
  /** nutrition_update: the date of their last one, for "since your last update". */
  since?: string | null;
  options?: { goal: string[]; freeMeal: string[] } | null;
  /** nutrition_update: the free meal was never answered, so it's asked. */
  askFreeMeal?: boolean;
  /** roadmap: the follow-ups the nutrition roadmap asked for (tracking, barriers, confounders, cycle, training). */
  asks?: string[];
  sex?: "M" | "F" | null;
  /** profile: the field asked, its question and its one-tap answers. */
  field?: string;
  prompt?: string;
  choices?: string[];
};

export type CheckinPlan = {
  version: number;
  extras: PlanExtra[];
  /** What wasn't asked and why: on file, not due yet. */
  skipped: Array<{ key: CheckinExtra; reason: string }>;
};

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * How often photos and the tape are worth it for their goal, with no schedule
 * from the coach: a physique goal shows in the mirror and on the tape before
 * the scale (the waist matters most on a cut or a recomp, where the scale
 * lags); maintenance or no goal needs neither, and a weight class is made on
 * the scale, so a powerlifter's cut asks for neither either.
 */
export function progressDefault(kind: "photos" | "measurements", g: { phase: string | null; goalType: string | null; classMeet: boolean }): { days: number | null; why: string } {
  if (g.classMeet) return { days: null, why: "a weight class is made on the scale" };
  const p = String(g.phase ?? "").toLowerCase();
  const goal = String(g.goalType ?? "");
  const cut = /loss|cut/.test(p) || (!p && goal === "lose");
  const recomp = /recomp/.test(p);
  const gain = /gain|bulk|reverse/.test(p) || (!p && goal === "gain");
  if (cut || recomp) return kind === "photos" ? { days: GOAL_PROGRESS_DAYS, why: `every 4 weeks on ${recomp ? "a recomp" : "a fat loss phase"}` } : { days: 14, why: `every 2 weeks on ${recomp ? "a recomp, where the scale lags" : "a fat loss phase"}` };
  if (gain) return { days: GOAL_PROGRESS_DAYS, why: "every 4 weeks on a muscle gain phase" };
  return { days: null, why: "maintenance or no physique goal" };
}

function progressDue(kind: "photos" | "measurements", last: string | null, x: PlanInput, classMeet: boolean): { due: boolean; reason: string } | null {
  const own = x.schedules.find((s) => s.kind === kind);
  // the coach's "No reminder" is a choice: never asked
  if (own && !own.enabled && own.frequency === "none") return null;
  const sched = own?.enabled ? own : null;
  const goalDefault = progressDefault(kind, { phase: x.phase ?? null, goalType: x.goal?.type ?? null, classMeet });
  const every = sched ? scheduleDays(sched) : goalDefault.days;
  if (!every) return null;
  const why = sched ? `your schedule (every ${every} days)` : goalDefault.why;
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

  // photos and measurements: the coach's schedule, else their goal's default
  for (const kind of ["photos", "measurements"] as const) {
    const d = progressDue(kind, kind === "photos" ? x.lastPhotos : x.lastMeasurements, x, classMeet || cutGoal);
    if (!d) continue;
    (d.due ? extras : skipped).push({ key: kind, reason: d.reason });
  }

  // the monthly Nutrition Update waiting: one pointer, not another reminder
  if (x.nutritionPendingSince && daysBetween(x.nutritionPendingSince, x.due) <= 14) {
    const inline = !!x.nutritionLastAnswered;
    extras.push({
      key: "nutrition_update",
      reason: inline
        ? `This month's Nutrition Update, asked ${fmt(x.nutritionPendingSince)}: answered in this check-in, only what changed since ${fmt(x.nutritionLastAnswered!)}`
        : `Nutrition Update sent ${fmt(x.nutritionPendingSince)} is still waiting: their first one, so it's the full form`,
      inline,
      since: x.nutritionLastAnswered ?? null,
      options: inline ? x.nutritionOptions ?? null : null,
      ...(inline && x.nutritionAskFreeMeal ? { askFreeMeal: true } : {}),
    });
  }
  // the nutrition roadmap's follow-ups: only what it needs told apart, never a second form
  const asks = (x.roadmap?.asks ?? []).filter((a) => ["tracking", "barriers", "confounders", "cycle", "training"].includes(a));
  if (asks.length) extras.push({ key: "roadmap", reason: x.roadmap?.reason ? `Nutrition roadmap: ${x.roadmap.reason}` : "Nutrition roadmap follow-ups", asks, sex: x.roadmap?.sex ?? null });
  // at most one optional work & lifestyle question, only when it's missing and not asked or skipped lately
  if (x.profileAsk?.field && x.profileAsk.options?.length)
    extras.push({ key: "profile", reason: `Missing from their profile, one optional tap: "${x.profileAsk.prompt}"`, field: x.profileAsk.field, prompt: x.profileAsk.prompt, choices: x.profileAsk.options });
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
 * When a nutrition plan is due its review: the coach's own "Next update due"
 * (nutrition_targets.end_date) when it's set, else its goal's rhythm from the
 * later of the plan's start and their last update (reviewWeeks). The old
 * update_cadence column belongs to a retired flow and is "manual" on every
 * plan, so it's never read. Mirrors public.nutrition_review_due.
 */
export function reviewWeeks(phase: string | null | undefined): number {
  const p = String(phase ?? "").toLowerCase();
  if (/loss|cut/.test(p)) return 4;
  if (/recomp/.test(p)) return 6;
  if (/gain|bulk|reverse/.test(p)) return 6;
  if (/maint|perform/.test(p)) return 8;
  return 4;
}

export function nutritionReviewDue(x: { endDate: string | null; startDate: string | null; lastAnswered: string | null; phase: string | null }): string | null {
  if (x.endDate) return x.endDate.slice(0, 10);
  const from = [x.startDate, x.lastAnswered].filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop();
  if (!from) return null;
  return new Date(Date.parse(`${from}T00:00:00Z`) + reviewWeeks(x.phase) * 7 * DAY).toISOString().slice(0, 10);
}

/** Never asked again within 3 weeks of their last update: a plan needs that long to read. */
export const REVIEW_MIN_DAYS = 21;
/** Never two requests within this many days, answered or not. */
export const ASK_GAP_DAYS = 25;

export type NutritionSend = "wait" | "fold" | "standalone" | "skip";

/**
 * What the Nutrition Update sender does today (mirrors
 * enqueue_monthly_nutrition_updates): only in the week its plan is due a
 * review, and through the weekly check-in when there is one. A client who's
 * sent one before answers it inside that check-in ("fold"); a first one, or a
 * client with no weekly check-in coming, gets the form itself.
 */
export function nutritionUpdateDecision(x: {
  today: string;
  /** Their local hour now. */
  hour: number;
  reviewDue: string | null;
  lastAnswered: string | null;
  lastAsked: string | null;
  /** This week's check-in card (out in the last 2 days): still open, answered, or none. */
  weeklyCard: "open" | "answered" | null;
  /** An open weekly check-in sends its card within the next 7 days. */
  weeklyCardComing: boolean;
  /** A submitted Nutrition Update to carry the rest from. */
  hasPrior: boolean;
}): NutritionSend {
  if (x.hour < 7) return "wait";
  if (!x.reviewDue) return "skip";
  if (daysBetween(x.today, x.reviewDue) > 7) return "wait";
  if (x.lastAnswered && daysBetween(x.lastAnswered, x.today) < REVIEW_MIN_DAYS) return "skip";
  if (x.lastAsked && daysBetween(x.lastAsked, x.today) < ASK_GAP_DAYS) return "skip";
  if (x.weeklyCard === "open") return x.hasPrior ? "fold" : "standalone";
  if (x.weeklyCard === "answered" && !x.hasPrior) return "standalone";
  if (x.weeklyCardComing) return "wait";
  if (x.weeklyCard === null && (daysBetween(x.today, x.reviewDue) > 0 || x.hour < 9)) return "wait";
  return "standalone";
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
