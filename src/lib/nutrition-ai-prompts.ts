/**
 * Prompts for the Nutrition Update Request AI (coach-provided wording).
 * Pass 1 → calorie / macro / cardio targets in a fixed format.
 * Pass 2 → full meal plan in the app's paste format (parseMealPlan).
 */

import type { TrainingBucket, TrainingPattern } from "@/lib/nutrition-targets/training-pattern";
import { freeMealRule, mealChoiceOf, mealChoiceRule, wantsFreeMeal } from "@/lib/nutrition-history";

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
- if a TRAINING PROGRAM is given, use it to judge training demand: higher volume or intensity blocks and weeks get more carbs on training days, a deload never lowers protein, and within 2 weeks of a meet keep foods familiar with no new big deficit unless the coach-selected phase says so. it never overrides the goal or the coach-selected phase

- protein = 0.8–1g per lb bodyweight
- protein is the SAME on every day type; fats stay within about 10 g between day types; the calorie difference between training, non training and high days comes from carbs (so the meal plan can use the same foods every day and only change carb portions)
- fats = 20–30% of calories
- carbs = remaining calories

- training day = higher carbs
- non training day = lower carbs
- high day = highest carbs and calories
- training time (morning / evening / fasted / varies) never changes the daily totals; it only changes which meals carry the carbs (pre- and post-workout meals)
- a free meal on the high day fits inside the high day calories; never add calories for it

------------------------

STEPS + CARDIO

- DAILY STEPS TARGETS = the day's total steps, a number only (e.g. 10,000)
- CARDIO SESSIONS = that day type's planned cardio, written exactly as "<minutes> min <type> · ~<kcal> kcal" (e.g. "25 min incline walk · ~150 kcal"), or "none"
- start from CURRENT CARDIO when it's given and keep their cardio type
- fat loss: 8,000–12,000 steps, cardio 15–30 min low intensity / zone 2 most days. when fat loss stalls with good adherence, add 5–10 min of cardio or 1,000–2,000 daily steps alongside a smaller calorie cut, never only more cardio
- muscle gain: 7,000–10,000 steps, cardio 10–20 min easy 2–3 days a week for health, never enough to eat the surplus
- recomp / maintenance / performance: 8,000–10,000 steps, cardio 15–25 min easy a few days a week
- never over 45 min of cardio in a day. keep it low intensity so it doesn't cut into lifting recovery
- a deload, taper or meet week in the TRAINING PROGRAM = easy walks only, no hard cardio
- cardio and steps are part of the estimated daily expenditure; don't count them twice

------------------------

PREVIOUS PLAN (only when one is given)

- start from the previous plan's numbers and adjust them using RESULTS ON THE PREVIOUS PLAN. do not rebuild from scratch
- judge bodyweight by the % of bodyweight per week, never one weigh-in
- the first 2–3 weeks after calories or carbs go up include about 1–3 lb of water and glycogen, and the first 1–2 weeks of a cut drop extra water. if the plan is 3 weeks old or less, don't correct for a fast early change; only act on it once it holds past that
- fat loss: aim for 0.5–1% per week. under 0.25% per week with adherence 4/5 or better = drop 5–10% of calories (about 100–200 kcal), from carbs and fats, protein stays. over 1.25% per week, or hunger / low energy flagged most weeks = add 100–150 kcal, mostly carbs
- muscle gain: aim for 0.25–0.5% per week. under that with good adherence = add 100–150 kcal, mostly carbs. over 0.75% per week = take off about 100 kcal
- recomp / maintenance / performance: within about ±0.25% per week = keep calories. drifting past that = nudge about 100 kcal the other way
- adherence under 4/5 = keep calories the same. the numbers aren't the problem, consistency is
- under 2 weeks on the plan, or not enough weigh-ins = keep calories unless the goal changed
- a new goal or a COACH-SELECTED PHASE different from the previous plan's phase overrides all of this: set targets for the new phase
- protein stays at or above the previous plan's unless bodyweight changed a lot
- keep the same day types as the previous plan
- with a previous plan, fill in CHANGES FROM LAST PLAN: each day type as "old kcal → new kcal (+/- difference)", Cardio: what changed in steps / cardio (or "no change"), and Why: one short line from the results (e.g. "down 0.2% a week for 4 weeks at 4.5/5 adherence, so -150 kcal from carbs"). with no previous plan, leave the CHANGES FROM LAST PLAN section out completely

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

DAILY STEPS TARGETS:
Training Day:
Non Training Day:
High Day:

CARDIO SESSIONS:
Training Day:
Non Training Day:
High Day:

CHANGES FROM LAST PLAN
Training Day:
Non Training Day:
High Day:
Cardio:
Why:`;

export const MEAL_PLAN_PROMPT = `You are a nutrition coach. Build a full meal plan using the EXACT format below so it can be pasted directly into the JF Effect coaching app.

FORMAT RULES (strict — do not change headings, do not add extra commentary):
0. Start with ONE line: PHASE: <Fat Loss | Muscle Gain | Recomp | Maintenance | Performance | Reverse Diet | Lifestyle Reset> — the client's phase / goal. Then a blank line.
1. Create one menu per day-type the client needs (e.g. TRAINING-DAY MENU, NON-TRAINING-DAY MENU, HIGH-DAY MENU). Each menu header ends with the word MENU in ALL CAPS.
2. Inside each menu, list "Meal 1", "Meal 2", "Meal 3"… on their own line.
2b. WORKOUT MEALS — on TRAINING-DAY and HIGH-DAY menus, tag the meal eaten before training as "Meal X (Pre-Workout)" and the first meal after training as "Meal Y (Post-Workout)" — exact spelling, in brackets on the meal line. Meals are numbered in the order they are eaten; place these two using the TRAINING TIME RULE in the client details.
   - Pre-Workout (eaten 60–120 min before training): fuel for the session. Mostly easy-to-digest carbs + moderate protein: about 25–40 g protein and roughly 0.25–0.5 g carbs per lb of bodyweight (top of the range on High Day and for heavier lifters). Keep fat at or under ~15 g and fibre at or under ~6 g so nothing sits heavy. Good picks: chicken or lean beef with white rice or potatoes, or a banana with whey / Greek yogurt; bagels, cream of rice, cereal or rice cakes only when the client already eats them.
   - Small snack 30–60 min before (client preference or early-morning training): 20–40 g fast carbs + 15–25 g protein, under 5 g fat (e.g. a banana + whey, or a banana + Greek yogurt).
   - Post-Workout (within 2 hours after training): recovery. 30–50 g protein + roughly 0.3–0.6 g carbs per lb of bodyweight; fat can be moderate. A normal whole-food meal is ideal.
   - Together the Pre- and Post-Workout meals should carry about 35–50% of that day's carbs. On the High Day, most of the extra carbs go into these two meals. Put vegetables, high-fibre foods and most of the day's fat in the other meals.
   - Client trains fasted: no Pre-Workout meal; the first meal after training is the Post-Workout meal and should be one of the biggest meals of the day.
   - Never tag meals on NON-TRAINING-DAY menus. Keep the same number of meals there with carbs spread evenly.
   - The COACH WORKOUT MEALS instruction below always wins over these defaults.
2c. SAME FOODS EVERY DAY (meal-prep logic: few groceries, easy to follow):
   - Build the TRAINING-DAY MENU first, then make every other menu the SAME meals with the SAME foods in the same order. Between day types only the portions change, mostly the carbs (rice, potatoes, sweet potatoes, fruit) up or down. Protein foods and portions stay the same every day.
   - Keep the whole plan to a short grocery list: about 2–3 protein sources, 2–3 carb sources, 1–2 fat sources, 1–2 vegetables and 1 fruit. Never add a food just for variety.
   - A food stays in the same meal slot every day (e.g. rice is always in Meal 2).
   - Only use a different food when the targets can't be hit with portions alone, the client asked for a swap, or it's the High-Day free meal. Prefer changing an amount over changing a food.
   - Use the same fat source(s) every day; adjust fats with the amount (oil, peanut butter, nuts), not a new food.
   - Pick foods that batch-cook and store well (chicken, lean ground beef, rice, potatoes, sweet potatoes) and keep amounts easy: multiples of 5 g for weighed foods, whole or half units for counted ones. Counted foods (bread, bagels, eggs, scoops, a banana) move in whole or half units, so fine-tune each day's numbers with the weighed foods (rice, potatoes, meat, oil).
   - On the NON-TRAINING-DAY MENU keep the same meals untagged with fewer carbs; on the HIGH-DAY MENU the extra carbs go into the same carb foods (bigger portions), mostly the Pre- and Post-Workout meals.
2d. BODYBUILDING SIMPLE (plain foods, portions that make sense):
   - Every food line is one plain food you buy and cook simply (grill, bake, air-fry, boil, pan-cook). Never a recipe, dressing, vinaigrette, sauce, marinade, homemade mix, bowl, wrap or smoothie, and no cooking steps. Spices, salt, garlic, herbs, lemon / lime, vinegar, mustard, hot sauce, salsa and zero-calorie sauces are free: never list them (FOOD-WEIGHING RULES covers them). Even when keeping the CURRENT MEALS, drop extras like these unless the client asked to keep them, and move their calories into the meal's main foods.
   - Protein defaults: chicken breast and lean ground beef (93% lean on fat loss, 85–90% lean when gaining and the fats allow), sometimes white fish (cod, tilapia) or salmon. Breakfast or a snack can use eggs / egg whites, Greek yogurt or whey instead. Spread protein evenly: about 30–50 g a meal (up to ~60 g for big lifters), which is roughly 120–250 g of cooked meat.
   - Carb defaults: white rice, potatoes and sweet potatoes, plus one fruit. Use pasta, oats, bagels, bread, cream of rice or cereal only when the client's answers (preferred foods, current meals, swaps) call for them, swapped like for like (pasta in for rice). If a day has so many carbs that one meal would need more than ~450 g cooked rice or ~600 g potatoes, move some into a denser carb they'll eat (cream of rice, bagels, cereal, juice) instead of a giant plate.
   - Fats come from the meat, eggs or salmon plus one measured fat: cooking oil (5–15 g olive or avocado oil), peanut butter or nuts. Never add a fat food just to fill the fats.
   - Vegetables are a side, never the meal: one vegetable (broccoli, green beans, asparagus or a frozen mixed-vegetable blend counts as one) at 75–150 g a serving, in 1–2 meals a day, never in the Pre-Workout meal. A serving is never bigger than the carb food in the same meal (400 g of vegetables next to 400 g of rice is wrong), except in a fat-loss phase, where up to 200 g helps fullness. Fruit: 1 serving a day (a banana or 100–150 g berries), best before training.
   - Each meal is 2–4 foods: a protein and a carb (a low-carb day's meal can drop the carb), then a vegetable or fruit and the fat it's cooked with. The protein and carb lead; nothing minor out-weighs them.
   - Fibre is an output, not a target: report what the foods give (about 20–40 g a day comes naturally from the potatoes, fruit and vegetables). Never add foods or bigger vegetable portions to raise it.
   - The client's answers win over every default here: drop anything in Allergies / dislikes, build around their Preferred foods (a vegetarian gets eggs, Greek yogurt, tofu, tempeh, whey or a plant protein), and follow the MEALS rule.
3. Under each meal, list every food on its own line, amount first. Weigh only what needs a scale: "<amount> g <food>" for meat and fish, rice, potatoes, pasta, oats, vegetables, berries, Greek yogurt, oils, nut butters and nuts (cooked weight for meat, fish, rice, potatoes, pasta and vegetables; packaged weight for oats, peanut butter, oils and nuts). Foods that come in a unit are counted, never in grams: "2 slices whole wheat bread", "1 bagel", "½ bagel", "3 whole eggs", "1 scoop whey protein", "1 medium banana", "1 apple", "2 rice cakes", "1 tortilla wrap", "1 can tuna". Use whole or half units only (½, 1, 1½, 2), base their macros on a typical label (a slice of bread ~30 g, a bagel ~100 g, a large egg ~50 g, a scoop of whey ~30 g, a medium banana ~120 g) and add the size in brackets only where brands differ a lot (e.g. "1 scoop whey protein (about 30 g)", "1 bagel (about 100 g)").
4. After each meal add a blank line, then:
   Approximate macros:
   <P> g protein
   <C> g carbohydrates
   <F> g fat
   <Fb> g fibre
5. End every menu with:
   Daily Total
   Approximately <P> g protein, <C> g carbohydrates, <F> g fat and <Fb> g fibre
6. After all menus, include a FOOD-WEIGHING RULES section with the standard rules (cooked vs packaged, bread / bagels / eggs / scoops / whole fruit are counted not weighed, weigh consistently, track all calorie beverages, oils and sauces, seasonings / zero-cal sauces / zero-cal drinks allowed), then up to 3 "Swap:" lines for the plan's own foods with amounts that keep the macros, e.g. "Swap: 100 g cooked chicken breast = 130 g cooked white fish (cod, tilapia) = 105 g cooked turkey breast" and "Swap: 100 g cooked white rice = 140 g cooked potatoes or sweet potatoes = 90 g cooked pasta".

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

/** What the profile already knows about the client (never asked twice). */
export type ClientBasics = {
  name: string;
  /** "Male" / "Female"; omitted when unknown or "prefer not to say". */
  sex?: string | null;
  age?: number | null;
  /** Display height, e.g. "5 ft 10 in". */
  height?: string | null;
};

function basicsOf(client: string | ClientBasics): ClientBasics {
  return typeof client === "string" ? { name: client } : client;
}

/**
 * Name / sex / age / height lines from the profile. Sex and height are left
 * out when the form already answered them, so nothing appears twice.
 */
export function clientBasicsLines(client: string | ClientBasics, qas: QA[] = []): string[] {
  const c = basicsOf(client);
  const answered = (re: RegExp) => qas.some((q) => re.test(q.label.trim()) && q.value.trim());
  return [
    `Client name: ${c.name}`,
    c.sex && !answered(/^sex\b/i) ? `Sex: ${c.sex}` : "",
    c.age != null ? `Age: ${c.age}` : "",
    c.height && !answered(/^height\b/i) ? `Height: ${c.height}` : "",
  ].filter(Boolean);
}

export function targetsUserPrompt(
  client: string | ClientBasics,
  qas: QA[],
  phase?: string | null,
  /** programContextText() for the client, when they have a program. */
  program?: string | null,
  /** previousPlanText(): the plan they were on and how it went. */
  previous?: string | null,
  /** currentCardioText(): the cardio they're doing now. */
  cardio?: string | null,
): string {
  return [
    `CLIENT DATA`,
    ...clientBasicsLines(client, qas),
    phase ? `COACH-SELECTED PHASE: ${phase}` : "",
    program ? `TRAINING PROGRAM\n${program}` : "",
    previous ? previous : "",
    cardio ? cardio : "",
    "",
    formatAnswers(qas),
  ]
    .filter((l, i, all) => l !== "" || i === all.length - 2)
    .join("\n");
}

/** Full copy-paste prompt for running pass 1 by hand in ChatGPT/Claude. */
export function manualTargetsPrompt(
  client: string | ClientBasics,
  qas: QA[],
  phase?: string | null,
  previous?: string | null,
  extra?: { program?: string | null; cardio?: string | null },
): string {
  return `${TARGETS_PROMPT}\n\n------------------------\n\n${targetsUserPrompt(client, qas, phase, extra?.program ?? null, previous, extra?.cardio ?? null)}`;
}

/**
 * The whole submission as one paste-ready block: who the client is, the
 * coach's phase, then every answer. For building a plan by hand.
 */
export function nutritionSubmissionSummary(opts: {
  client: string | ClientBasics;
  qas: QA[];
  phase?: string | null;
  submittedAt?: string | null;
}): string {
  const c = basicsOf(opts.client);
  const when = opts.submittedAt
    ? new Date(opts.submittedAt).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return [
    `NUTRITION FORM — ${c.name}`,
    when ? `Submitted: ${when}` : "",
    ...clientBasicsLines(c, opts.qas).slice(1),
    opts.phase ? `Coach phase: ${opts.phase}` : "",
    "",
    formatAnswers(opts.qas),
  ]
    .filter((l, i, all) => l !== "" || i === all.length - 2)
    .join("\n");
}

/** Full copy-paste prompt for running pass 2 by hand. */
export function manualMealPlanPrompt(
  qas: QA[],
  targetsText: string,
  phase?: string | null,
  workoutMeals?: WorkoutMealsMode | null,
  history?: TrainingPattern | null,
  currentMeals?: string | null,
): string {
  return `${MEAL_PLAN_PROMPT}\n\n${mealPlanUserPrompt(qas, targetsText, phase, workoutMeals, history, currentMeals)}`;
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
  varies: "Training time changes day to day. Make Pre-Workout and Post-Workout two back-to-back meals in the middle of the day, built from simple, portable foods (e.g. chicken + rice; a banana + whey), so the client can slide that pair to wherever training lands. The other meals stay normal.",
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

/**
 * Pass 2 input: the CLIENT DETAILS block filled from the form + pass-1
 * targets. `currentMeals` (previousMealsText) is the plan they're on now:
 * the client's meal choice on the form decides whether it's kept, swapped
 * or replaced, and their free-meal answer shapes the High Day.
 */
export function mealPlanUserPrompt(
  qas: QA[],
  targetsText: string,
  phase?: string | null,
  workoutMeals?: WorkoutMealsMode | null,
  history?: TrainingPattern | null,
  currentMeals?: string | null,
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
  const meals = answerFor(qas, "how many meals") || answerFor(qas, "meals per day");
  const hasMeals = !!currentMeals?.trim();
  const mealRule = mealChoiceRule(
    mealChoiceOf(answerFor(qas, "meals in your current plan")),
    answerFor(qas, "foods or meals do you want changed"),
    hasMeals,
  );
  const highDay = freeMealRule(wantsFreeMeal(answerFor(qas, "free meal on your high day")), answerFor(qas, "go-to free meal"));
  const avoid = answerFor(qas, "allerg") || answerFor(qas, "dislike");
  const love = answerFor(qas, "foods you love") || answerFor(qas, "prefer") || answerFor(qas, "favourite") || answerFor(qas, "favorite");
  // No targets yet (the coach copying the prompt before pass 1 ran): leave the numbers for them to fill in.
  const hasTargets = !!targetsText.trim();
  const goal = answerFor(qas, "goal");
  return [
    "CLIENT DETAILS:",
    `- Phase / goal: ${phase || (hasTargets ? "use the Goal from the TARGETS below" : goal || "(fill in)")}`,
    `- Bodyweight: ${bw || (hasTargets ? "see targets" : "(fill in)")}`,
    `- Training days per week: ${days || (hasTargets ? "see targets" : "(fill in)")}`,
    hasTargets
      ? `- Daily calorie target: use the CALORIE TARGETS below for each day-type menu (Training Day, Non Training Day, High Day)`
      : `- Daily calorie target: (fill in for each day-type menu)`,
    hasTargets
      ? `- Daily protein / carbs / fat / fibre targets: use the MACRO TARGETS below for each day-type; fibre is whatever the foods give (about 20–40 g), never a target to chase`
      : `- Daily protein / carbs / fat / fibre targets: (fill in for each day-type); fibre is whatever the foods give (about 20–40 g), never a target to chase`,
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
    mealRule ? `- MEALS: ${mealRule}` : "",
    highDay ? `- HIGH DAY: ${highDay}` : "",
    "",
    hasTargets ? "TARGETS (match each menu's Daily Total to these within ±3%):" : "",
    targetsText.trim(),
    hasMeals ? "\nCURRENT MEALS (the plan the client is on now):" : "",
    hasMeals ? currentMeals!.trim() : "",
  ].filter((l) => l !== "").join("\n");
}

/**
 * The coach's "Copy ChatGPT prompt" when building a client's plan by hand
 * (Create Nutrition Targets → Quick Paste): the same format and workout-meal
 * rules the AI uses (MEAL_PLAN_PROMPT), with the client details filled in
 * from their latest Nutrition Update when there is one, and the AI's targets
 * when it wrote them. Details sit right under the opening line, so anything
 * left to fill in is at the top.
 */
export function quickPastePrompt(opts: {
  client?: string | ClientBasics | null;
  qas?: QA[] | null;
  targetsText?: string | null;
  phase?: string | null;
  workoutMeals?: WorkoutMealsMode | null;
  history?: TrainingPattern | null;
}): string {
  const split = MEAL_PLAN_PROMPT.indexOf("\n\n");
  const intro = MEAL_PLAN_PROMPT.slice(0, split);
  const rules = MEAL_PLAN_PROMPT.slice(split + 2);
  const qas = opts.qas ?? [];
  const basics = opts.client ? clientBasicsLines(opts.client, qas) : [];
  const details = qas.length
    ? mealPlanUserPrompt(qas, opts.targetsText ?? "", opts.phase, opts.workoutMeals, opts.history)
    : [
        "CLIENT DETAILS (fill in):",
        opts.phase ? `- Phase / goal: ${opts.phase}` : "- Phase / goal:",
        "- Bodyweight:",
        "- Training days per week:",
        "- Daily calorie target:",
        "- Daily protein / carbs / fat / fibre targets:",
        "- Allergies / dislikes:",
        "- Preferred foods:",
        "- Meals per day:",
        "- Usual training time:",
        "- Eating before training:",
        "- TRAINING TIME RULE: the Pre-Workout meal is eaten 60–120 min before training and the Post-Workout meal within 2 hours after.",
        opts.workoutMeals && opts.workoutMeals !== "auto" ? `- COACH WORKOUT MEALS: ${WORKOUT_MEALS_RULE[opts.workoutMeals]}` : "",
      ].filter(Boolean).join("\n");
  return [intro, basics.length ? `CLIENT\n${basics.join("\n")}` : "", details, rules].filter(Boolean).join("\n\n");
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

/* ------------------------------------------------------------------------ */
/* Coach updates ("Change something" on a written plan)                      */

/** Longest set of instructions the coach can send in one update. */
export const REVISE_MAX_CHARS = 2000;

/**
 * Pass 1 of a coach update: the targets again, changed only where the
 * instructions are about numbers (food-only changes give them back as is).
 */
export const REVISE_TARGETS_PROMPT = `you are an elite level nutrition coach under the brand: ${BRAND}

the head coach wants a change to a client's plan. respond exactly in the required format.

RULES

- output the CURRENT TARGETS again in full: same sections, same headings, same order, same day types, plain text, nothing before or after
- change only what the COACH INSTRUCTIONS ask for, plus what has to follow from it: each day's calories = protein x 4 + carbs x 4 + fat x 9, protein stays the same on every day type and fats within about 10 g between day types unless the coach says otherwise
- instructions only about foods, meals, swaps, recipes or meal timing change no number: output the CURRENT TARGETS exactly as they are
- steps and cardio changes go in DAILY STEPS TARGETS / CARDIO SESSIONS in the same format ("<minutes> min <type> · ~<kcal> kcal" or "none")
- if a number changed and there is a CHANGES FROM LAST PLAN section, keep it true to the new numbers and add the coach's change to its Why: line`;

export function reviseTargetsUserPrompt(targetsText: string, instructions: string): string {
  return `CURRENT TARGETS:\n${targetsText.trim()}\n\nCOACH INSTRUCTIONS:\n${instructions.trim()}`;
}

const REVISE_MEAL_RULES = [
  "COACH UPDATE: revise the CURRENT MEAL PLAN below. Do not build a new plan.",
  "- Do exactly what the COACH INSTRUCTIONS at the end ask. They win over every default rule above, but never over the client's allergies.",
  "- Everything they don't touch stays exactly as it is: the same menus, meals, foods, amounts, order and workout-meal tags.",
  "- A swap or removal applies on every menu that has that food, unless the instructions name one day or meal.",
  "- After the change, adjust portions (mostly the weighed carbs) only where needed so each menu's Daily Total still matches its TARGETS within ±3%, and update the Approximate macros of every meal you changed and each Daily Total.",
  "- Output the full meal plan again in the same format: the PHASE line, every menu, then FOOD-WEIGHING RULES. Nothing before or after it.",
].join("\n");

/**
 * Pass 2 of a coach update: the meal plan as it is, the (possibly updated)
 * targets and the client's details, with the instructions last so they're
 * the freshest thing the model reads. Runs under MEAL_PLAN_PROMPT, so a
 * swapped-in food still follows the format and the plan's own rules.
 */
export function reviseMealPlanUserPrompt(opts: {
  qas: QA[];
  targetsText: string;
  mealPlanText: string;
  instructions: string;
  phase?: string | null;
  workoutMeals?: WorkoutMealsMode | null;
  history?: TrainingPattern | null;
}): string {
  return [
    REVISE_MEAL_RULES,
    mealPlanUserPrompt(opts.qas, opts.targetsText, opts.phase, opts.workoutMeals, opts.history),
    `CURRENT MEAL PLAN:\n${opts.mealPlanText.trim()}`,
    `COACH INSTRUCTIONS:\n${opts.instructions.trim()}`,
  ].join("\n\n");
}

/** The copy-paste version of an update, for ChatGPT / Claude by hand. */
export function manualRevisePrompt(opts: Parameters<typeof reviseMealPlanUserPrompt>[0]): string {
  return `${MEAL_PLAN_PROMPT}\n\n${reviseMealPlanUserPrompt(opts)}`;
}

/**
 * An update's output is only used when it still reads as the same kind of
 * text: targets keep their CALORIE / MACRO sections, a meal plan keeps at
 * least one menu with a Daily Total. Anything else (a refusal, a question,
 * a half answer) leaves the plan as it was.
 */
export function revisionLooksRight(kind: "targets" | "meals", original: string, revised: string): boolean {
  const text = revised.trim();
  if (text.length < 40) return false;
  if (kind === "targets") {
    return ["CALORIE TARGETS", "MACRO TARGETS"].every((h) => !original.includes(h) || text.includes(h));
  }
  return /^.{0,60}MENU\s*$/im.test(text) && /daily\s+total/i.test(text);
}
