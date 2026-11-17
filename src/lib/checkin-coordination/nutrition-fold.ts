/**
 * The monthly Nutrition Update answered inside the weekly check-in, for a
 * client who has sent one before. The full form is 24 questions, most of which
 * (sex, height, allergies, foods, schedule, the two agreements) don't change
 * month to month; asked again, people stopped answering. So the check-in asks
 * only what's new each month:
 *
 *   1. what should happen with their meals (keep, swap some, start fresh),
 *      and which foods if they're swapping;
 *   2. what changed since their last update (goal, allergies or diet,
 *      health, supplements, training or activity, the free meal), each with
 *      one follow-up only when it's ticked.
 *
 * Everything else carries from their last submitted update, bodyweight,
 * sex, height and training days come from their records, and the result is
 * an ordinary Nutrition Update submission: the coach's panel, the AI plan and
 * the food history read it exactly as if the form had been filled in. Pure,
 * tested (checkin-coordination.test.ts).
 */
import { MEAL_CHOICE } from "@/lib/nutrition-history";
import { isNoneAnswer } from "@/lib/nutrition-targets/food-notes";
import { prefillAnswer, questionPrefill, type PrefillProfile } from "@/lib/form-prefill";

/** The check-in's own keys for the monthly section (kept in messenger_checkins.answers, shown on the coach's card). */
export const NU = {
  meals: "nu_meals",
  swap: "nu_swap",
  changed: "nu_changed",
  goal: "nu_goal",
  goalDetail: "nu_goal_detail",
  allergies: "nu_allergies",
  health: "nu_health",
  supplements: "nu_supplements",
  activity: "nu_activity",
  freeMeal: "nu_free_meal",
} as const;

export const MEAL_OPTIONS = [MEAL_CHOICE.keep, MEAL_CHOICE.swap, MEAL_CHOICE.fresh] as const;

export const CHANGED = {
  goal: "Goal or target",
  allergies: "Allergies or diet",
  health: "Health, injuries or meds",
  supplements: "Supplements",
  activity: "Training or daily activity",
  freeMeal: "Free meal",
  nothing: "Nothing else changed",
} as const;
export const CHANGED_OPTIONS = [CHANGED.goal, CHANGED.allergies, CHANGED.health, CHANGED.supplements, CHANGED.activity, CHANGED.freeMeal, CHANGED.nothing];

/** Each change's follow-up keys: cleared when the change is unticked. */
export const CHANGE_FOLLOW_UPS: Record<string, string[]> = {
  [CHANGED.goal]: [NU.goal, NU.goalDetail],
  [CHANGED.allergies]: [NU.allergies],
  [CHANGED.health]: [NU.health],
  [CHANGED.supplements]: [NU.supplements],
  [CHANGED.activity]: [NU.activity],
  [CHANGED.freeMeal]: [NU.freeMeal],
};

/** Which of the form's questions is which, by its wording (like nutrition-history.ts), never its id. */
export type Role =
  | "goal" | "bodyFat" | "goalDetail" | "allergies" | "health" | "supplements" | "budget" | "mealsPerDay"
  | "activity" | "foods" | "meals" | "swap" | "freeMeal" | "freeMealPick" | "trainingDays" | "steps"
  | "trainTime" | "preTraining" | "missed";

const ROLES: Array<[Role, RegExp]> = [
  ["goal", /^goal\b/i],
  ["bodyFat", /body fat/i],
  ["goalDetail", /^explain your goal/i],
  ["allergies", /allergies/i],
  ["health", /health conditions|injuries or medications/i],
  ["supplements", /supplements do you take/i],
  ["budget", /spend on supplements/i],
  ["mealsPerDay", /meals can you have per day/i],
  ["activity", /physical activit/i],
  ["foods", /list all of your foods/i],
  ["meals", /happen with the meals/i],
  ["swap", /which foods or meals do you want changed/i],
  ["freeMeal", /free meal on your high day/i],
  ["freeMealPick", /go-to free meal/i],
  ["trainingDays", /training days per week/i],
  ["steps", /daily steps/i],
  ["trainTime", /time do you usually train/i],
  ["preTraining", /eat before training/i],
  ["missed", /anything i missed|need to know/i],
];

export function roleOf(label: string | null | undefined): Role | null {
  const l = String(label ?? "").trim();
  for (const [role, re] of ROLES) if (re.test(l)) return role;
  return null;
}

export type FoldQuestion = { id: string; label: string; question_type: string; options?: string[] | null; validation?: Record<string, unknown> | null; required?: boolean | null };

/** Asked every month, or worked out from their records: never a reason the rest can't carry. */
const ALWAYS_FRESH: Role[] = ["meals", "swap", "missed", "freeMealPick", "trainingDays"];

/**
 * Can this month's update carry from their last one? Only when it answered
 * every required question the check-in doesn't ask or read from records; the
 * free meal (added to the form later) is asked inline when it was never
 * answered. Anything else missing means the full form, which opens on their
 * last answers (validation.remember).
 */
export function foldGaps(questions: FoldQuestion[], answeredIds: Iterable<string>): { foldable: boolean; askFreeMeal: boolean } {
  const answered = new Set(answeredIds);
  let foldable = true;
  let askFreeMeal = false;
  for (const q of questions) {
    if (!q.required || answered.has(q.id)) continue;
    if (questionPrefill(q)) continue; // sex, height, bodyweight: from their records
    const role = roleOf(q.label);
    if (role && ALWAYS_FRESH.includes(role)) continue;
    if (role === "freeMeal") askFreeMeal = true;
    else foldable = false;
  }
  return { foldable, askFreeMeal };
}
export type FoldAnswer = { question_id: string; value_text: string | null; value_number: number | null; value_json: unknown };

/** The answer types the form keeps as JSON (native-forms.ts NF_JSON_TYPES). */
const JSON_TYPES = new Set(["multi_choice", "competitions", "ranking", "checklist"]);

/** The options the check-in offers for the goal and the free meal: the form's own. */
export function foldOptions(questions: FoldQuestion[]): { goal: string[]; freeMeal: string[] } {
  const opts = (r: Role) => ((questions.find((q) => roleOf(q.label) === r)?.options ?? []) as string[]).filter(Boolean);
  return { goal: opts("goal"), freeMeal: opts("freeMeal") };
}

/** A change written on top of what they said before (allergies and health are sticky in the food history). */
export function withChange(last: string | null | undefined, change: string, day: string): string {
  const c = change.trim();
  if (!c) return String(last ?? "");
  const prev = String(last ?? "").trim();
  if (!prev || isNoneAnswer(prev)) return c;
  return `${prev}\nUpdate ${day}: ${c}`;
}

function rawOf(a: FoldAnswer | undefined): unknown {
  if (!a) return undefined;
  const j = a.value_json as any;
  if (j && typeof j === "object" && !Array.isArray(j) && typeof j.unit === "string") return { value: a.value_number == null ? "" : String(a.value_number), unit: j.unit };
  return a.value_json ?? a.value_text ?? a.value_number ?? undefined;
}

/** One answer stored the way the form renderer stores it. */
export function toRow(q: FoldQuestion, raw: unknown): FoldAnswer | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "object" && raw && !Array.isArray(raw) && "unit" in (raw as any)) {
    const v = Number((raw as any).value);
    return { question_id: q.id, value_text: null, value_number: Number.isFinite(v) ? v : null, value_json: { unit: (raw as any).unit } };
  }
  if (q.question_type === "number" || q.question_type === "rating") {
    const v = Number(raw);
    return Number.isFinite(v) ? { question_id: q.id, value_text: null, value_number: v, value_json: null } : null;
  }
  if (JSON_TYPES.has(q.question_type)) return { question_id: q.id, value_text: null, value_number: null, value_json: raw };
  return { question_id: q.id, value_text: String(raw), value_number: null, value_json: null };
}

export type FoldInput = {
  questions: FoldQuestion[];
  /** Their last submitted Nutrition Update's answers. */
  last: FoldAnswer[];
  /** Sex, height, the latest weigh-in (fresh when within a week). */
  profile: PrefillProfile | null;
  /** Committed training days a week, when set. */
  trainingDays: number | null;
  /** The weekly check-in's answers, the monthly section's (nu_*) and its open "help" question. */
  checkin: Record<string, unknown>;
  /** Their local date, for "Update Nov 17: …". */
  day: string;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Every answer the submission carries: last time's, the records', then this month's. */
export function foldNutritionAnswers(x: FoldInput): FoldAnswer[] {
  const lastBy = new Map(x.last.map((a) => [a.question_id, a]));
  const changed = new Set(Array.isArray(x.checkin[NU.changed]) ? (x.checkin[NU.changed] as unknown[]).map(String) : []);
  const did = (c: string) => changed.has(c);
  const dayLabel = new Date(`${x.day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const meals = text(x.checkin[NU.meals]);
  const out: FoldAnswer[] = [];
  for (const q of x.questions) {
    const role = roleOf(q.label);
    let raw: unknown = rawOf(lastBy.get(q.id));
    // from their records: sex, height, this week's weigh-in
    if (questionPrefill(q)) {
      const fromRecords = prefillAnswer(q, x.profile);
      if (fromRecords != null) raw = fromRecords;
      // last month's weight is never this month's: no weigh-in this week leaves it to their log
      else if (questionPrefill(q) === "bodyweight") raw = undefined;
    }
    switch (role) {
      case "meals":
        raw = meals || raw;
        break;
      case "swap":
        raw = meals === MEAL_CHOICE.swap ? text(x.checkin[NU.swap]) || raw : undefined;
        break;
      case "goal":
        if (did(CHANGED.goal) && text(x.checkin[NU.goal])) raw = text(x.checkin[NU.goal]);
        break;
      case "goalDetail":
        if (did(CHANGED.goal) && text(x.checkin[NU.goalDetail])) raw = text(x.checkin[NU.goalDetail]);
        break;
      case "allergies":
        if (did(CHANGED.allergies) && text(x.checkin[NU.allergies])) raw = withChange(raw as string, text(x.checkin[NU.allergies]), dayLabel);
        break;
      case "health":
        if (did(CHANGED.health) && text(x.checkin[NU.health])) raw = withChange(raw as string, text(x.checkin[NU.health]), dayLabel);
        break;
      case "supplements":
        if (did(CHANGED.supplements) && text(x.checkin[NU.supplements])) raw = withChange(raw as string, text(x.checkin[NU.supplements]), dayLabel);
        break;
      case "activity":
        if (did(CHANGED.activity) && text(x.checkin[NU.activity])) raw = withChange(raw as string, text(x.checkin[NU.activity]), dayLabel);
        break;
      case "freeMeal":
        // changed this month, or never answered before (asked inline then)
        if ((did(CHANGED.freeMeal) || raw === undefined) && text(x.checkin[NU.freeMeal])) raw = text(x.checkin[NU.freeMeal]);
        break;
      case "freeMealPick":
        // no free meal any more: no go-to
        if (did(CHANGED.freeMeal) && /^no\b/i.test(text(x.checkin[NU.freeMeal]))) raw = undefined;
        break;
      case "trainingDays":
        if (x.trainingDays != null && x.trainingDays > 0) raw = x.trainingDays;
        break;
      case "missed": {
        // the check-in's own "anything you need help with": this month's note, else nothing more to add
        const help = text(x.checkin.help);
        raw = help && !isNoneAnswer(help) ? help : "That's everything";
        break;
      }
    }
    const row = toRow(q, raw);
    if (row) out.push(row);
  }
  return out;
}

/** True once the check-in answered the monthly section (the meals question is the one it always asks). */
export function answeredNutrition(checkin: Record<string, unknown>): boolean {
  return MEAL_OPTIONS.includes(text(checkin[NU.meals]) as (typeof MEAL_OPTIONS)[number]);
}
