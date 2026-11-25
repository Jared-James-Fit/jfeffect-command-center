/**
 * What a workout is called wherever it shows (the Workouts page, the week's
 * split, the calendars, analytics): its training focus in a few words, the
 * same everywhere (Nov 25 2026). Pure and deterministic; it never changes the
 * program, only the words on screen.
 *
 *  1. A meaningful name the coach gave it is kept ("Mock Meet", "Heavy
 *     Singles", "Squat & Bench"), cleaned of what isn't the workout's name:
 *     RPE, "Primary", a phase or week tag, a stale date.
 *  2. A generic name ("Day 1", "Workout A", "Session 3", "Monday") or one too
 *     long for a calendar is replaced by the focus read from its exercises:
 *       - the main barbell lifts the day is built around ("SBD", "Squat &
 *         Bench", "Deadlift", "Bench Press"), by priority (the lifts flagged
 *         primary / competition, or first in the order), never by how many
 *         exercises of each there are;
 *       - else the body region, weighted by sets and order ("Chest &
 *         Triceps", "Back & Biceps", "Push", "Pull", "Legs", "Lower Body",
 *         "Upper Body", "Full Body"), with "& Conditioning" for a finisher;
 *       - a cardio-only day is "Treadmill LISS" (a treadmill walk), else
 *         "Cardio" / "Conditioning".
 *  3. With nothing to read, the cleaned name or "Day N". "Workout" is the
 *     category, never a title of its own when there's anything better.
 */
import { normalizeMuscle, type MuscleGroup } from "@/lib/analytics/muscle-map";
import { rangeLift } from "@/lib/workouts/pick-range";

export type TitleExercise = {
  name: string | null | undefined;
  /** exercises.movement_family / the row's own (squat · bench · deadlift · accessory) */
  family?: string | null;
  competitionLift?: boolean | null;
  equipment?: string | null;
  primaryMuscle?: string | null;
  purposeLabel?: string | null;
  sets?: number | null;
  optional?: boolean | null;
  /** the day's cardio plan row (cardio_target_id): the cardio plan's, not the workout's focus */
  planCardio?: boolean | null;
};

export type TitleInput = {
  title?: string | null;
  subtitle?: string | null;
  dayIndex?: number | null;
  exercises?: readonly TitleExercise[] | null;
};

/** Longest coach name kept as is; a longer one gets the focus title when there is one. */
export const MAX_TITLE_CHARS = 28;

const STALE_DATE =
  /\s*[—–-]\s*(?:Sun|Mon|Tue(?:s)?|Wed(?:nes)?|Thu(?:rs?)?|Fri|Sat(?:ur)?)(?:day)?(?:[.,]?\s+[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{2,4})?)?(?=\s*(?:[—–-]|$))/gi;
const RPE = /\(?\s*(?:@\s*)?(?:rpe|rir)\s*[:=]?\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*\)?|@\s*\d+(?:\.\d+)?\b/gi;
const ROLE_WORDS = /\b(?:primary|secondary|tertiary|main lift|accessor(?:y|ies))\b/gi;
const TAGS = /\b(?:week|wk|block|phase|day|meso|micro)\s*\d+\b|\bw\d+\s*d\d+\b/gi;
const PHASE_SEGMENT =
  /^(?:(?:hypertrophy|strength|power|peaking|peak|accumulation|intensification|realization|realisation|deload|taper|base|prep|off[- ]?season|volume|intensity|gpp|spp)\s*(?:phase|block|week)?|(?:phase|block|week)\s*\d*)$/i;
const GENERIC =
  /^(?:(?:workout|session|training(?:\s+day)?|lift(?:ing)?|day|gym|program|wod|routine)(?:\s*(?:[a-z]|\d+))?|(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?|[a-z]|\d+)$/i;

/** The coach's name without dates, RPE, role words, phase or week tags. */
export function cleanCoachTitle(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(STALE_DATE, "");
  // Parentheses / brackets that only hold noise go; ones with words stay.
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (m, inner: string) => (stripNoise(inner) ? m : " "));
  const parts = s
    .split(/\s*(?:[—–|:·•]|\s-\s)\s*/)
    .map(stripNoise)
    .filter((p) => p && !PHASE_SEGMENT.test(p));
  // "Monday — Upper Body": a weekday or "Workout A" beside a real name goes
  const named = parts.filter((p) => !GENERIC.test(p));
  return (named.length ? named : parts).join(" — ").replace(/\s{2,}/g, " ").trim();
}

function stripNoise(s: string): string {
  return s
    .replace(RPE, " ")
    .replace(ROLE_WORDS, " ")
    .replace(TAGS, " ")
    .replace(/^[\s,&+/-]+|[\s,&+/-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isGenericTitle(clean: string): boolean {
  const s = clean.trim();
  return !s || GENERIC.test(s);
}

type Main = "squat" | "bench" | "deadlift";
const MAIN_NAME: Record<Main, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const MAIN_ALONE: Record<Main, string> = { squat: "Squat", bench: "Bench Press", deadlift: "Deadlift" };

const WARMUP = /^(?:warm[- ]?up|mobility|activation|prep)\b/i;
const TREADMILL = /\b(treadmill|incline walk|walk(?:ing)?)\b/i;
const INTERVALS = /\b(interval|hiit|sprint|sled|prowler|metcon|emom|amrap|circuit|conditioning|finisher|assault|air ?bike|ski ?erg|rower|row erg)\b/i;
const CARDIO = /\b(treadmill|walk|walking|bike|biking|cycling|cycle|elliptical|stair ?master|stair climber|stepper|rower|erg|jog|jogging|run|running|cardio|airbike|assault|sled|prowler|liss|hiit|conditioning|finisher|metcon)\b/i;
const NOT_CARDIO = /lunge|farmer|carry|walkout|walk-?over|band walk|plank|crunch|rowing\s+(?!machine)|\brows?\b(?!\s*erg)|seated row|cable row|barbell row|dumbbell row/i;

function familyOf(e: TitleExercise): Main | null {
  const f = String(e.family ?? "").toLowerCase();
  if (f === "squat" || f === "bench" || f === "deadlift") return f;
  const n = String(e.name ?? "").toLowerCase();
  if (/\bbench\b/.test(n)) return "bench";
  if (/\bdead ?lift|\bdl\b/.test(n) && !/\b(romanian|rdl|stiff|single[- ]leg)\b/.test(n)) return "deadlift";
  if (/\bsquat\b/.test(n) && !/\b(split|bulgarian|goblet|hack|belt|pistol|sissy|jump)\b/.test(n)) return "squat";
  return null;
}

function isCardioExercise(e: TitleExercise): boolean {
  if (/^(?:conditioning|cardio)\b/i.test(String(e.purposeLabel ?? ""))) return true;
  const n = String(e.name ?? "");
  return CARDIO.test(n) && !NOT_CARDIO.test(n);
}

/** Muscle region for the region title: from the library's muscle, else the name. */
function muscleOf(e: TitleExercise): MuscleGroup | null {
  const n = String(e.name ?? "").toLowerCase();
  // rear delts are pulling work, whatever the library calls the muscle
  if (/\brear delt|face pull|reverse fly|reverse pec/.test(`${n} ${String(e.primaryMuscle ?? "").toLowerCase()}`)) return "Back";
  const m = normalizeMuscle(e.primaryMuscle);
  if (m) return m;
  if (/\b(curl)\b/.test(n) && !/\b(leg|hamstring|nordic)\b/.test(n)) return "Biceps";
  if (/\b(pushdown|push-down|skull|tricep|dip|kickback|close[- ]grip)\b/.test(n)) return "Triceps";
  if (/\b(lateral raise|overhead press|ohp|military|shoulder press|arnold|upright row)\b/.test(n)) return "Shoulders";
  if (/\b(bench|chest|fly|flye|pec|push[- ]?up|incline press|decline press)\b/.test(n)) return "Chest";
  if (/\b(pulldown|pull-?down|pull-?up|chin-?up|lat\b)/.test(n)) return "Lats";
  if (/\b(row|shrug|back extension|hyperextension|good morning)\b/.test(n)) return "Back";
  if (/\b(rdl|romanian|leg curl|hamstring|nordic|stiff)\b/.test(n)) return "Hamstrings";
  if (/\b(hip thrust|glute|kickback|abduct)\b/.test(n)) return "Glutes";
  if (/\b(squat|leg press|leg extension|lunge|split squat|step-?up|hack)\b/.test(n)) return "Quads";
  if (/\b(dead ?lift)\b/.test(n)) return "Hamstrings";
  if (/\b(calf|calves)\b/.test(n)) return "Calves";
  if (/\b(adductor|copenhagen)\b/.test(n)) return "Adductors";
  if (/\b(plank|crunch|ab |abs|core|pallof|leg raise|sit-?up|dead bug|rollout)\b/.test(n)) return "Core";
  return null;
}

const PUSH = new Set<MuscleGroup>(["Chest", "Triceps", "Shoulders"]);
const PULL = new Set<MuscleGroup>(["Back", "Lats", "Biceps", "Forearms"]);
const LEGS = new Set<MuscleGroup>(["Quads", "Hamstrings", "Glutes", "Adductors", "Calves"]);

/** The focus read from the exercises, or null when there is nothing to read. */
export function focusTitle(exercises: readonly TitleExercise[] | null | undefined): string | null {
  const all = (exercises ?? []).filter((e) => (e.name ?? "").trim() || e.family || e.primaryMuscle);
  const working = all.filter((e) => !e.planCardio && !WARMUP.test(String(e.purposeLabel ?? "")));
  if (!working.length) {
    // the day's cardio plan only
    const cardio = all.filter((e) => e.planCardio || isCardioExercise(e));
    return cardio.length ? cardioTitle(cardio) : null;
  }
  const required = working.filter((e) => !e.optional);
  const list = required.length ? required : working;
  const cardio = list.filter(isCardioExercise);
  const lifts = list.filter((e) => !isCardioExercise(e));
  if (!lifts.length) return cardioTitle(cardio);

  // 1. The main barbell lifts the day is built around, by priority.
  const mains: Main[] = [];
  lifts.forEach((e, i) => {
    const fam = familyOf(e);
    if (!fam || !rangeLift(fam, e.name, e.equipment)) return;
    const label = String(e.purposeLabel ?? "");
    const flagged = !!e.competitionLift || /^(primary|competition|top set)\b/i.test(label);
    const leads = i < 2 && !/^(accessory|assistance|tertiary)\b/i.test(label);
    if ((flagged || leads) && !mains.includes(fam)) mains.push(fam);
  });
  const anyFlagged = lifts.some((e) => {
    const fam = familyOf(e);
    return !!fam && rangeLift(fam, e.name, e.equipment) &&
      (!!e.competitionLift || /^(primary|competition|top set)\b/i.test(String(e.purposeLabel ?? "")));
  });
  // One unflagged barbell lift first on a bodybuilding day ("Back Squat, then
  // leg press, curls, calves") is a leg day, not a "Squat" day.
  const plDay = mains.length >= 2 || (mains.length === 1 && (anyFlagged || lifts.length <= 3));
  let title: string | null = null;
  if (plDay) {
    if (mains.length === 3) title = "SBD";
    else if (mains.length === 2) title = `${MAIN_NAME[mains[0]]} & ${MAIN_NAME[mains[1]]}`;
    else title = MAIN_ALONE[mains[0]];
  } else {
    title = regionTitle(lifts);
  }
  if (!title) return cardio.length ? cardioTitle(cardio) : null;
  if (cardio.length && !plDay && !/&/.test(title)) title = `${title} & Conditioning`;
  return title;
}

function cardioTitle(cardio: readonly TitleExercise[]): string {
  const names = cardio.map((e) => String(e.name ?? "")).join(" ");
  if (INTERVALS.test(names)) return "Conditioning";
  if (TREADMILL.test(names)) return "Treadmill LISS";
  return "Cardio";
}

function regionTitle(lifts: readonly TitleExercise[]): string | null {
  const score = new Map<MuscleGroup, number>();
  let total = 0;
  let core = 0;
  lifts.forEach((e, i) => {
    const m = muscleOf(e);
    if (m === "Core") core++;
    if (!m || m === "Core") return;
    // order carries priority: the first lifts count more than the last ones
    const w = (Math.max(1, Math.min(10, Number(e.sets) || 3))) * (i === 0 ? 1.6 : i === 1 ? 1.3 : 1);
    score.set(m, (score.get(m) ?? 0) + w);
    total += w;
  });
  if (!total) return null;
  const sum = (set: Set<MuscleGroup>) => [...score].reduce((s, [m, w]) => s + (set.has(m) ? w : 0), 0);
  const push = sum(PUSH);
  const pull = sum(PULL);
  const legs = sum(LEGS);
  const upper = push + pull;
  const of = (m: MuscleGroup) => score.get(m) ?? 0;
  // "Legs" is legs only; legs with core or an upper accessory is "Lower Body"
  if (legs / total >= 0.85 && !core) return "Legs";
  if (legs / total >= 0.65) return "Lower Body";
  if (upper / total >= 0.75) {
    if (push / upper >= 0.85) {
      const chestTri = of("Chest") + of("Triceps");
      return chestTri / push >= 0.75 && of("Chest") > 0 && of("Triceps") > 0 ? "Chest & Triceps" : "Push";
    }
    if (pull / upper >= 0.85) {
      const back = of("Back") + of("Lats");
      return back > 0 && of("Biceps") > 0 && (back + of("Biceps")) / pull >= 0.8 ? "Back & Biceps" : "Pull";
    }
    return "Upper Body";
  }
  return "Full Body";
}

/**
 * The workout's display title. A meaningful coach name is kept; a generic or
 * long one becomes the focus from its exercises; never "Workout" when there's
 * anything better, never RPE / Primary / a phase.
 */
export function workoutDisplayTitle(input: TitleInput): string {
  const fallback = input.dayIndex != null && input.dayIndex > 0 ? `Day ${input.dayIndex}` : "Workout";
  const fromSubtitle = cleanCoachTitle(input.subtitle);
  const fromTitle = cleanCoachTitle(input.title);
  const coach = !isGenericTitle(fromSubtitle) ? fromSubtitle : fromTitle;
  const meaningful = !isGenericTitle(coach);
  if (meaningful && coach.length <= MAX_TITLE_CHARS) return coach;
  const focus = focusTitle(input.exercises);
  if (focus) return focus;
  if (meaningful) return shorten(coach);
  return fallback;
}

/** A long name cut at a word, never mid-word. */
function shorten(s: string): string {
  if (s.length <= MAX_TITLE_CHARS) return s;
  const first = s.split(" — ")[0];
  if (first.length <= MAX_TITLE_CHARS && !isGenericTitle(first)) return first;
  const cut = s.slice(0, MAX_TITLE_CHARS + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 10 ? cut.slice(0, at) : cut.slice(0, MAX_TITLE_CHARS)).replace(/[\s,&+/—–-]+$/, "")}…`;
}

/** A program row (pl_exercise_rows with its exercises join) as the title reads it. */
export function titleExerciseFromRow(r: any): TitleExercise {
  const ex = r?.exercises ?? null;
  return {
    name: r?.exercise_name_override || ex?.name || r?.exercise_name || "",
    family: ex?.movement_family ?? ex?.competition_lift_type ?? r?.movement_family ?? null,
    competitionLift: ex?.is_competition_lift ?? null,
    equipment: ex?.equipment ?? null,
    primaryMuscle: ex?.primary_muscle_group ?? ex?.muscle_group ?? null,
    purposeLabel: r?.purpose_label ?? null,
    sets: r?.sets ?? null,
    optional: r?.is_optional ?? null,
    planCardio: !!r?.cardio_target_id,
  };
}

/** A workout item's title (getClientWorkouts sets `display_title` from its rows). */
export function itemDisplayTitle(item: { day?: any; display_title?: string | null } | null | undefined): string {
  if (!item) return "Workout";
  if (item.display_title) return item.display_title;
  const d = item.day;
  return workoutDisplayTitle({ title: d?.title, subtitle: d?.subtitle, dayIndex: d?.day_index });
}
