/**
 * Prompts for the Nutrition Update Request AI (coach-provided wording).
 * Pass 1 → calorie / macro / cardio targets in a fixed format.
 * Pass 2 → full meal plan in the app's paste format (parseMealPlan).
 */

import type { TrainingBucket, TrainingPattern } from "@/lib/nutrition-targets/training-pattern";

export const NUTRITION_REQUEST_FORM_ID = "b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d";
export const NUTRITION_REQUEST_FORM_TYPE = "nutrition_update";
export const BRAND = "JF Effect";

export const TARGETS_PROMPT = `you are an elite level nutrition coach under the brand: ${BRAND}

analyze this nutrition creation form and respond exactly in the required format.

generate calorie targets, macro targets, and cardio targets using the client data below.

------------------------

RULES

- no fluff
- no explanations
- no paragraphs
- every line must be separate
- follow the format exactly
- do not add or remove sections

------------------------

CALCULATIONS

- estimate daily expenditure from bodyweight, activity, training, and steps
- gain goal = calorie surplus
- fat loss = calorie deficit of 15–25% below expenditure
- muscle gain = calorie surplus of 5–15% above expenditure
- recomp = slight deficit of ~5–10%, protein at 1g per lb
- maintenance / lifestyle reset = calories at expenditure
- performance = at or slightly above expenditure, carbs around training
- reverse diet = start at current intake, add 50–100 kcal per week
- if a COACH-SELECTED PHASE is given, it overrides the client's goal

- protein = 0.8–1g per lb bodyweight
- fats = 20–30% of calories
- carbs = remaining calories

- training day = higher carbs
- non training day = lower carbs
- high day = highest carbs and calories
- training time (morning / evening / fasted / varies) never changes the daily totals; it only changes which meals carry the carbs (pre- and post-workout meals)

=== OUTPUT ===

CLIENT OVERVIEW
Name:
Goal:
Goals / Timeframe:
Estimated Daily Expenditure:

CALORIE TARGETS
Training Day:
Non Training Day:
High Day:

MACRO TARGETS

Training Day
Protein:
Carbs:
Fats:

Non Training Day
Protein:
Carbs:
Fats:

High Day
Protein:
Carbs:
Fats:

CARDIO STEPS TARGETS:
Training Day:
Non Training Day:
High Day:

CARDIO CALORIE TARGETS:
Training Day:
Non Training Day:
High Day:`;

export const MEAL_PLAN_PROMPT = `You are a nutrition coach. Build a full meal plan using the EXACT format below so it can be pasted directly into the JF Effect coaching app.

FORMAT RULES (strict — do not change headings, do not add extra commentary):
0. Start with ONE line: PHASE: <Fat Loss | Muscle Gain | Recomp | Maintenance | Performance | Reverse Diet | Lifestyle Reset> — the client's phase / goal. Then a blank line.
1. Create one menu per day-type the client needs (e.g. TRAINING-DAY MENU, NON-TRAINING-DAY MENU, HIGH-DAY MENU). Each menu header ends with the word MENU in ALL CAPS.
2. Inside each menu, list "Meal 1", "Meal 2", "Meal 3"… on their own line.
2b. WORKOUT MEALS — on TRAINING-DAY and HIGH-DAY menus, tag the meal eaten before training as "Meal X (Pre-Workout)" and the first meal after training as "Meal Y (Post-Workout)" — exact spelling, in brackets on the meal line. Meals are numbered in the order they are eaten; place these two using the TRAINING TIME RULE in the client details.
   - Pre-Workout (eaten 60–120 min before training): fuel for the session. Mostly easy-to-digest carbs + moderate protein: about 25–40 g protein and roughly 0.25–0.5 g carbs per lb of bodyweight (top of the range on High Day and for heavier lifters). Keep fat at or under ~15 g and fibre at or under ~6 g so nothing sits heavy. Good picks: white rice, bagel / bread + jam, cream of rice, oats, cereal, fruit, rice cakes, lean meat, Greek yogurt, whey.
   - Small snack 30–60 min before (client preference or early-morning training): 20–40 g fast carbs + 15–25 g protein, under 5 g fat (e.g. banana + whey, rice cakes + jam + Greek yogurt).
   - Post-Workout (within 2 hours after training): recovery. 30–50 g protein + roughly 0.3–0.6 g carbs per lb of bodyweight; fat can be moderate. A normal whole-food meal is ideal.
   - Together the Pre- and Post-Workout meals should carry about 35–50% of that day's carbs. On the High Day, most of the extra carbs go into these two meals. Put vegetables, high-fibre foods and most of the day's fat in the other meals.
   - Client trains fasted: no Pre-Workout meal; the first meal after training is the Post-Workout meal and should be one of the biggest meals of the day.
   - Never tag meals on NON-TRAINING-DAY menus. Keep the same number of meals there with carbs spread evenly.
   - The COACH WORKOUT MEALS instruction below always wins over these defaults.
3. Under each meal, list every food on its own line as: "<amount> g <food>" (use cooked weight for meat, rice, potatoes, vegetables; packaged weight for oats, whey, peanut butter, oils).
4. After each meal add a blank line, then:
   Approximate macros:
   <P> g protein
   <C> g carbohydrates
   <F> g fat
   <Fb> g fibre
5. End every menu with:
   Daily Total
   Approximately <P> g protein, <C> g carbohydrates, <F> g fat and <Fb> g fibre
6. After all menus, include a FOOD-WEIGHING RULES section with the standard rules (cooked vs packaged, weigh consistently, track all calorie beverages, seasonings/zero-cal drinks allowed).

Output plain text only — no markdown, no bullets, no tables. Match the formatting exactly so the app's parser can read it.`;

export type QA = { label: string; value: string };

/** "Q: label / A: value" block the AI reads, skipping blanks. */
export function formatAnswers(qas: QA[]): string {
  return qas
    .filter((q) => q.value.trim())
    .map((q) => `${q.label}: ${q.value.trim()}`)
    .join("\n");
}

/** Find an answer by keywords in its question label (case-insensitive). */
export function answerFor(qas: QA[], ...keywords: string[]): string {
  const hit = qas.find((q) => keywords.every((k) => q.label.toLowerCase().includes(k.toLowerCase())));
  return hit?.value.trim() ?? "";
}

export function targetsUserPrompt(clientName: string, qas: QA[], phase?: string | null): string {
  return [
    `CLIENT DATA`,
    `Client name: ${clientName}`,
    phase ? `COACH-SELECTED PHASE: ${phase}` : "",
    "",
    formatAnswers(qas),
  ].filter((l, i) => l !== "" || i === 3).join("\n");
}

/** Full copy-paste prompt for running pass 1 by hand in ChatGPT/Claude. */
export function manualTargetsPrompt(clientName: string, qas: QA[], phase?: string | null): string {
  return `${TARGETS_PROMPT}\n\n------------------------\n\n${targetsUserPrompt(clientName, qas, phase)}`;
}

/** Full copy-paste prompt for running pass 2 by hand. */
export function manualMealPlanPrompt(
  qas: QA[],
  targetsText: string,
  phase?: string | null,
  workoutMeals?: WorkoutMealsMode | null,
  history?: TrainingPattern | null,
): string {
  return `${MEAL_PLAN_PROMPT}\n\n${mealPlanUserPrompt(qas, targetsText, phase, workoutMeals, history)}`;
}

/** Coach override for pre/post-workout meals (stored on the request). */
export type WorkoutMealsMode = "auto" | "pre_post" | "post_only" | "pre_only" | "none";

export const WORKOUT_MEALS_OPTIONS: { value: WorkoutMealsMode; label: string }[] = [
  { value: "auto", label: "Auto — from the client's training time" },
  { value: "pre_post", label: "Pre + Post-Workout meals" },
  { value: "post_only", label: "Post-Workout only (trains fasted)" },
  { value: "pre_only", label: "Pre-Workout only" },
  { value: "none", label: "No workout meals" },
];

const WORKOUT_MEALS_RULE: Record<Exclude<WorkoutMealsMode, "auto">, string> = {
  pre_post: "Include BOTH a Pre-Workout and a Post-Workout meal on every training-day and high-day menu.",
  post_only: "Client trains fasted: NO Pre-Workout meal. Tag the first meal after training as Post-Workout.",
  pre_only: "Tag a Pre-Workout meal only; do not tag a Post-Workout meal.",
  none: "Do NOT tag any Pre-Workout or Post-Workout meals.",
};

/**
 * Turn the client's "What time do you usually train?" answer (plus how they
 * like to eat before training) into an explicit placement rule for the
 * Pre-/Post-Workout meals. Deterministic so the AI never has to guess.
 */
export type TrainingTimeClass = TrainingBucket | "varies" | "none" | "other";

/** Bucket a free-text / dropdown training-time answer. */
export function classifyTrainingTime(trainTime: string): TrainingTimeClass {
  const t = trainTime.toLowerCase();
  if (!t.trim()) return "none";
  if (/vari|random|depends|changes|different/.test(t)) return "varies";
  if (/early|before 8|5am|6am|7am/.test(t)) return "early";
  if (/midday|\bnoon\b|lunch|11am[–-]2|11[–-]2/.test(t)) return "midday";
  if (/morning|8–11|8-11/.test(t)) return "morning";
  if (/afternoon|2–5|2-5/.test(t)) return "afternoon";
  if (/evening|5–8|5-8|after work/.test(t)) return "evening";
  if (/night|after 8|late/.test(t)) return "night";
  return "other";
}

const TIMING_RULES: Record<Exclude<TrainingTimeClass, "other">, string> = {
  none: "Training time not given — assume late afternoon (about 4–6pm): the mid-afternoon meal is Pre-Workout, dinner is Post-Workout.",
  varies: "Training time changes day to day. Make Pre-Workout and Post-Workout two back-to-back meals in the middle of the day, built from simple, portable foods (e.g. bagel + jam + whey; rice + chicken), so the client can slide that pair to wherever training lands. The other meals stay normal.",
  early: "Trains early morning (before 8am). Meal 1 is a small Pre-Workout snack 30–60 min before (or skip it if they train fasted). The next meal, straight after training, is the Post-Workout meal and one of the biggest meals of the day.",
  morning: "Trains in the morning (8–11am). Meal 1 (breakfast, 60–120 min before) is Pre-Workout; Meal 2 straight after training is Post-Workout.",
  midday: "Trains midday (11am–2pm). Breakfast stays a normal meal; the late-morning meal 1–2 h before training is Pre-Workout; lunch after training is Post-Workout.",
  afternoon: "Trains in the afternoon (2–5pm). Lunch / the early-afternoon meal is Pre-Workout; the next meal after training is Post-Workout.",
  evening: "Trains in the evening (5–8pm). The mid-afternoon meal (about 3–4pm) is Pre-Workout; dinner after training is Post-Workout; any later meal is a normal evening meal.",
  night: "Trains at night (after 8pm). Dinner (about 6–7pm) is Pre-Workout; the last meal of the day, straight after training, is Post-Workout — protein-forward (e.g. Greek yogurt or casein + carbs). Carbs at night are fine.",
};

export function workoutTimingRule(trainTime: string, preEat = ""): string {
  const c = classifyTrainingTime(trainTime);
  let rule =
    c === "other"
      ? `Trains: ${trainTime}. Place Pre-Workout 60–120 min before training and Post-Workout within 2 hours after.`
      : TIMING_RULES[c];
  const p = preEat.toLowerCase();
  if (/fasted|empty/.test(p)) rule += " Client prefers training fasted: no Pre-Workout meal.";
  else if (/snack/.test(p)) rule += " Client prefers a small snack 30–60 min before: make Pre-Workout a snack.";
  else if (/full meal/.test(p)) rule += " Client prefers a full meal 1–2 hours before training.";
  return rule;
}

/** A form answer too vague to place workout meals from ("It varies" / blank). */
export function isVagueTrainingTime(answer: string): boolean {
  const c = classifyTrainingTime(answer);
  return c === "none" || c === "varies";
}

/**
 * Which training time places the workout meals: the client's form answer
 * when it's specific (it's the newest info), otherwise a consistent pattern
 * from their logged workouts, otherwise the vague answer as-is.
 */
export function effectiveTrainingTime(
  formAnswer: string,
  history?: TrainingPattern | null,
): { time: string; fromHistory: boolean } {
  if (isVagueTrainingTime(formAnswer) && history?.confident) return { time: history.label, fromHistory: true };
  return { time: formAnswer, fromHistory: false };
}

/** Pass 2 input: the CLIENT DETAILS block filled from the form + pass-1 targets. */
export function mealPlanUserPrompt(
  qas: QA[],
  targetsText: string,
  phase?: string | null,
  workoutMeals?: WorkoutMealsMode | null,
  history?: TrainingPattern | null,
): string {
  const trainTime = answerFor(qas, "time", "train");
  const placed = effectiveTrainingTime(trainTime, history);
  const formClass = classifyTrainingTime(trainTime);
  const disagrees =
    !placed.fromHistory && !!history?.confident && formClass !== "other" && !isVagueTrainingTime(trainTime) &&
    formClass !== history.bucket;
  const preEat = answerFor(qas, "eat before training");
  const bw = answerFor(qas, "bodyweight") || answerFor(qas, "weight");
  const days = answerFor(qas, "training days") || answerFor(qas, "days per week");
  const meals = answerFor(qas, "meals per day") || answerFor(qas, "meals");
  const avoid = answerFor(qas, "allerg") || answerFor(qas, "dislike");
  const love = answerFor(qas, "foods you love") || answerFor(qas, "prefer") || answerFor(qas, "favourite") || answerFor(qas, "favorite");
  return [
    "CLIENT DETAILS:",
    `- Phase / goal: ${phase || "use the Goal from the TARGETS below"}`,
    `- Bodyweight: ${bw || "see targets"}`,
    `- Training days per week: ${days || "see targets"}`,
    `- Daily calorie target: use the CALORIE TARGETS below for each day-type menu (Training Day, Non Training Day, High Day)`,
    `- Daily protein / carbs / fat / fibre targets: use the MACRO TARGETS below for each day-type; fibre 14 g per 1000 kcal`,
    `- Allergies / dislikes: ${avoid || "none"}`,
    `- Preferred foods: ${love || "no preference"}`,
    meals ? `- Meals per day: ${meals}` : "",
    `- Usual training time: ${trainTime || "not given — assume late afternoon"}`,
    preEat ? `- Eating before training: ${preEat}` : "",
    history ? `- Logged workouts (last 8 weeks): ${history.summary}` : "",
    `- TRAINING TIME RULE: ${workoutTimingRule(placed.time, preEat)}${
      placed.fromHistory ? " (Based on their logged workout times.)" : ""
    }${disagrees ? ` (Logged workouts point to ${history!.label}; the form answer is newer, so follow the form.)` : ""}`,
    workoutMeals && workoutMeals !== "auto" ? `- COACH WORKOUT MEALS: ${WORKOUT_MEALS_RULE[workoutMeals]}` : "",
    "",
    "TARGETS (match each menu's Daily Total to these within ±3%):",
    targetsText.trim(),
  ].filter((l) => l !== "").join("\n");
}

/** Strip code fences / markdown emphasis the model sometimes adds. */
export function cleanAiText(text: string): string {
  return text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .trim();
}
