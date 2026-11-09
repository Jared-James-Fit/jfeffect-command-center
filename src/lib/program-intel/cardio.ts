/**
 * Cardio in Generate Next Program: one cardio plan, never a second copy in the
 * workouts.
 *
 * The client's cardio plan is `cardio_targets` (set by their nutrition plan or
 * the coach). On training days the app adds the plan's session to every
 * upcoming workout as its last exercise (`program_cardio_sync`, linked by
 * `pl_exercise_rows.cardio_target_id`, 20270115090000_cardio_one_plan.sql), so
 * a generated program never writes walking, treadmill or bike rows itself: it
 * reads the plan, leaves time for it, and lets it shape the lifting (fatigue,
 * session length).
 *
 * Priority: the nutrition plan > the coach's own targets > a plan proposed here
 * when there is none yet (written on Assign, source 'program', until the
 * nutrition plan sets one) > a plan read from cardio already in the program.
 * Pure, tested (program-intel-cardio.test.ts).
 */
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { fitTrainingDays } from "@/lib/plan-days-fit";

export type RawCardioTarget = {
  id: string;
  day_type: string | null;
  cardio_type: string | null;
  custom_type?: string | null;
  duration_minutes: number | null;
  frequency_per_week?: number | null;
  scheduled_weekdays?: string[] | null;
  incline?: number | string | null;
  heart_rate_zone?: string | null;
  status?: string | null;
  enabled?: boolean | null;
  visible_to_client?: boolean | null;
  program_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  source?: string | null;
  last_updated_at?: string | null;
  updated_at?: string | null;
};
export type RawCardioCompletion = { cardio_target_id: string | null; completed_date: string; completed: boolean | null; skipped?: boolean | null };

export type CardioSession = {
  type: string;
  minutes: number;
  /** sessions a week (rest days); a training-day session is every training day */
  perWeek: number | null;
  weekdays: string[];
  incline: number | null;
  zone: string | null;
};

export type CardioSource = "plan" | "proposed" | "none";
export type CardioPlan = {
  source: CardioSource;
  /** who set the plan, when there is one */
  origin: "nutrition" | "coach" | "program" | "program_rows" | null;
  trainingDay: CardioSession | null;
  restDay: CardioSession | null;
  updatedAt: string | null;
  /** last 28 days: sessions done of those planned */
  done: { done: number; planned: number } | null;
  why: string;
};

const kind = (dayType: string | null | undefined): "training" | "high" | "rest" | "other" => {
  const d = (dayType ?? "").toLowerCase().trim();
  if (/^training( day)?$/.test(d)) return "training";
  if (/^high( day)?$/.test(d)) return "high";
  if (/non.?training|rest/.test(d)) return "rest";
  return "other";
};

const isLive = (t: RawCardioTarget, today: string) =>
  (t.status ?? "Active") === "Active" &&
  t.enabled !== false &&
  t.visible_to_client !== false &&
  !t.program_name &&
  (!t.end_date || t.end_date >= today) &&
  (t.duration_minutes ?? 0) > 0;

const sessionOf = (t: RawCardioTarget): CardioSession => ({
  type: (t.custom_type?.trim() || t.cardio_type?.trim() || "Cardio").slice(0, 60),
  minutes: Math.round(t.duration_minutes as number),
  perWeek: t.frequency_per_week ?? null,
  weekdays: (t.scheduled_weekdays ?? []).filter(Boolean),
  incline: t.incline == null || t.incline === "" ? null : Number(t.incline),
  zone: t.heart_rate_zone?.trim() || null,
});

const ORIGIN_LABEL: Record<NonNullable<CardioPlan["origin"]>, string> = {
  nutrition: "their nutrition plan",
  coach: "their cardio targets",
  program: "the plan proposed with their last generated program",
  program_rows: "the cardio in their training program",
};

/** The client's cardio plan as it stands (training-day and rest-day sessions), with how much of it they did. */
export function cardioPlanFromTargets(targets: RawCardioTarget[], completions: RawCardioCompletion[], today: string): CardioPlan {
  const live = targets.filter((t) => isLive(t, today));
  const newest = (list: RawCardioTarget[]) =>
    list.slice().sort((a, b) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0] ?? null;
  const train = newest(live.filter((t) => kind(t.day_type) === "training" && t.source !== "program_rows")) ?? newest(live.filter((t) => kind(t.day_type) === "training"));
  const rest = newest(live.filter((t) => kind(t.day_type) === "rest"));
  if (!train && !rest) return { source: "none", origin: null, trainingDay: null, restDay: null, updatedAt: null, done: null, why: "No cardio plan on file." };
  const lead = train ?? rest!;
  const origin = (lead.source === "nutrition" || lead.source === "program" || lead.source === "program_rows" ? lead.source : "coach") as CardioPlan["origin"];
  const from = addDaysISO(today, -28);
  const ids = new Set([train?.id, rest?.id].filter(Boolean) as string[]);
  const recent = completions.filter((c) => c.cardio_target_id && ids.has(c.cardio_target_id) && c.completed_date >= from && c.completed_date < today);
  const plannedPerWeek = (train ? (train.frequency_per_week ?? train.scheduled_weekdays?.length ?? 0) : 0) + (rest ? (rest.frequency_per_week ?? rest.scheduled_weekdays?.length ?? 0) : 0);
  const updatedAt = [train, rest].map((t) => t?.last_updated_at ?? t?.updated_at ?? null).filter(Boolean).sort().pop() ?? null;
  return {
    source: "plan",
    origin,
    trainingDay: train ? sessionOf(train) : null,
    restDay: rest ? sessionOf(rest) : null,
    updatedAt,
    done: plannedPerWeek > 0 ? { done: recent.filter((c) => c.completed && !c.skipped).length, planned: plannedPerWeek * 4 } : null,
    why: `From ${ORIGIN_LABEL[origin!]}${updatedAt ? ` (updated ${updatedAt.slice(0, 10)})` : ""}.`,
  };
}

/** What the goals ask of cardio when there's no plan yet: fat loss most, building or peaking none. */
export function cardioGoal(text: string): "fat_loss" | "recomp" | "general" | "none" {
  const t = text.toLowerCase();
  const fat = /\b(lose|losing|loss|cut|cutting|lean(er)?|shred|fat)\b/.test(t);
  const gain = /\b(gain|gaining|bulk|bulking)\b|\bbuild(ing)? muscle\b/.test(t);
  if (/recomp/.test(t) || (fat && gain)) return "recomp";
  if (fat) return "fat_loss";
  if (/\b(general fitness|health|healthy|fitness|endurance|cardio|conditioning)\b/.test(t)) return "general";
  return "none";
}

/** Rest days for cardio: the days off training, spread out (fewest back to back with training). */
function restWeekdays(trainingDays: readonly string[], count: number): string[] {
  const off = WEEK_DAYS.filter((d) => !trainingDays.includes(d));
  if (count >= off.length) return off;
  // the spread of training + cardio days, keeping the training days, picking only from days off
  const fit = fitTrainingDays(trainingDays as WeekDay[], trainingDays.length + count, { allowed: [...trainingDays, ...off] as WeekDay[] });
  return fit.days.filter((d) => off.includes(d));
}

/**
 * The cardio plan to propose when the client has none: from the goal (fat loss: a short Zone 2
 * walk after lifting plus three rest-day walks; recomposition: shorter; general fitness: rest days
 * only; building, strength or a meet within 6 weeks: none, daily steps cover it). It becomes their
 * cardio plan on Assign until their nutrition plan sets one.
 */
export function proposeCardio(x: { goalText: string; trainingDays: readonly string[]; meetWeeksOut?: number | null }): CardioPlan {
  const goal = x.meetWeeksOut != null && x.meetWeeksOut <= 6 ? "none" : cardioGoal(x.goalText);
  const walk = (minutes: number, perWeek: number | null, weekdays: string[]): CardioSession => ({ type: "Incline Treadmill Walk", minutes, perWeek, weekdays, incline: 5, zone: "Zone 2" });
  const train = x.trainingDays.slice();
  const proposed = (t: CardioSession | null, r: CardioSession | null, why: string): CardioPlan => ({ source: "proposed", origin: null, trainingDay: t, restDay: r, updatedAt: null, done: null, why });
  switch (goal) {
    case "fat_loss":
      return proposed(walk(15, train.length || null, train), walk(25, 3, restWeekdays(train, 3)), "No cardio plan yet and the goal is fat loss: a 15-min Zone 2 walk after lifting and three 25-min walks on days off. Their nutrition plan replaces it when it's made.");
    case "recomp":
      return proposed(walk(10, train.length || null, train), walk(20, 2, restWeekdays(train, 2)), "No cardio plan yet and the goal is recomposition: a 10-min walk after lifting and two 20-min walks on days off. Their nutrition plan replaces it when it's made.");
    case "general":
      return proposed(null, walk(20, 2, restWeekdays(train, 2)), "No cardio plan yet: two 20-min walks on days off for general fitness. Their nutrition plan replaces it when it's made.");
    default:
      return {
        source: "none",
        origin: null,
        trainingDay: null,
        restDay: null,
        updatedAt: null,
        done: null,
        why: x.meetWeeksOut != null && x.meetWeeksOut <= 6 ? "A meet within 6 weeks: no added cardio (daily steps only)." : "The goal is strength or muscle: no added cardio beyond daily steps.",
      };
  }
}

/** Lifting time when the plan's cardio follows every workout: the stated session length less the cardio. */
export function liftingMinutesWith(cardio: Pick<CardioPlan, "trainingDay"> | null | undefined, sessionMinutes: number | null, statedMinutes: number | null): number | null {
  const c = cardio?.trainingDay?.minutes ?? 0;
  if (!c || sessionMinutes == null) return sessionMinutes;
  if (statedMinutes == null) return sessionMinutes;
  return Math.max(20, Math.min(sessionMinutes, statedMinutes - c));
}

const sessionText = (s: CardioSession) =>
  `${s.type} ${s.minutes} min${s.incline != null ? `, incline ${s.incline}%` : ""}${s.zone ? `, ${s.zone}` : ""}`;

/** Plain lines for the brief and the prompts. */
export function cardioBriefLines(plan: CardioPlan | null | undefined): string[] {
  if (!plan) return [];
  const out: string[] = [];
  if (plan.source === "none") {
    out.push(`No added cardio: ${plan.why}`);
  } else {
    out.push(`${plan.source === "plan" ? "Their cardio plan" : "Proposed cardio plan (none on file)"}: ${plan.why}`);
    if (plan.trainingDay) out.push(`- Training days: ${sessionText(plan.trainingDay)}, added by the app as the LAST exercise of every workout.`);
    else out.push(`- Training days: no cardio after lifting.`);
    if (plan.restDay) {
      const r = plan.restDay;
      // 2× a week with three days ticked means two of those days, never a contradiction
      const days = r.weekdays.length ? ` (${r.perWeek && r.perWeek < r.weekdays.length ? `${r.perWeek} of ` : ""}${r.weekdays.join(", ")})` : "";
      out.push(`- Days off: ${sessionText(r)}${r.perWeek ? `, ${r.perWeek}× a week` : ""}${days}.`);
    }
    if (plan.done) out.push(`- Done in the last 4 weeks: ${plan.done.done} of about ${plan.done.planned} planned sessions.`);
  }
  out.push(
    "Rules: never write walking, treadmill, bike, elliptical, stair, rowing-machine or other steady cardio into the workouts (the cardio plan is the one place for it). Leave the time for it: the lifting must fit the session length on its own. Let it shape the lifting: hard leg work the day before long rest-day cardio is fine, but don't stack extra conditioning or high-rep leg finishers on top of a fat-loss cardio load.",
  );
  return out;
}

/** The cardio_targets rows a proposed plan becomes on Assign (only when the client has none). */
export function cardioTargetsFromProposal(plan: CardioPlan, x: { clientId: string; trainingDays: readonly string[]; today: string }): Array<Record<string, unknown>> {
  if (plan.source !== "proposed") return [];
  const row = (dayType: string, s: CardioSession) => ({
    client_id: x.clientId,
    day_type: dayType,
    cardio_type: s.type,
    duration_minutes: s.minutes,
    frequency_per_week: s.perWeek ?? s.weekdays.length ?? null,
    scheduled_weekdays: s.weekdays,
    incline: s.incline,
    speed_min_mph: s.incline != null ? 2 : null,
    speed_max_mph: s.incline != null ? 3 : null,
    heart_rate_zone: s.zone,
    status: "Active",
    enabled: true,
    visible_to_client: true,
    start_date: x.today,
    completion_rule: "any_target",
    source: "program",
    client_notes: dayType === "Training Day"
      ? "After lifting, at a pace you can talk but not sing. Your nutrition plan will adjust this when it's made."
      : "An easy walk on a day off, at a pace you can talk but not sing. Your nutrition plan will adjust this when it's made.",
    last_updated_at: new Date().toISOString(),
  });
  return [
    ...(plan.trainingDay ? [row("Training Day", { ...plan.trainingDay, weekdays: plan.trainingDay.weekdays.length ? plan.trainingDay.weekdays : [...x.trainingDays] })] : []),
    ...(plan.restDay ? [row("Non-Training Day", plan.restDay)] : []),
  ];
}

function addDaysISO(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
