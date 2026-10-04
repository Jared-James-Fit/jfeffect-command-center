/**
 * Prompts for the Nutrition Update Request AI (coach-provided wording).
 * Pass 1 → calorie / macro / cardio targets in a fixed format.
 * Pass 2 → full meal plan in the app's paste format (parseMealPlan).
 */

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
export function manualMealPlanPrompt(qas: QA[], targetsText: string, phase?: string | null): string {
  return `${MEAL_PLAN_PROMPT}\n\n${mealPlanUserPrompt(qas, targetsText, phase)}`;
}

/** Pass 2 input: the CLIENT DETAILS block filled from the form + pass-1 targets. */
export function mealPlanUserPrompt(qas: QA[], targetsText: string, phase?: string | null): string {
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
