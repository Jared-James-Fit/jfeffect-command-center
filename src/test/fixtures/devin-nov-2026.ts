/**
 * Devin Buth's nutrition plan as it is stored in production (published Nov 11
 * 2026), word for word: the regression case for plan-coverage.ts. These are
 * copies; no test or app code writes his plan. `STORED_MD5` is md5(notes) of
 * each day in nutrition_target_days as read on Nov 18 2026, so a test proves
 * the copy is his exact data.
 */

export const DEVIN_TRAINING =
  "Meal 1\n2 whole eggs\n150 g egg whites\n100 g cooked white rice\n150 g broccoli\n10 g olive oil\n\nApproximate macros:\n45 g protein\n30 g carbohydrates\n20 g fat\n4 g fibre\n\nMeal 2 (Pre-Workout)\n180 g cooked chicken breast\n250 g cooked white rice\n1 medium banana\n\nApproximate macros:\n55 g protein\n95 g carbohydrates\n8 g fat\n5 g fibre\n\nMeal 3 (Post-Workout)\n180 g cooked lean ground beef (90% lean)\n450 g cooked potatoes\n150 g green beans\n\nApproximate macros:\n50 g protein\n85 g carbohydrates\n18 g fat\n10 g fibre\n\nDaily Total\nApproximately 180 g protein, 305 g carbohydrates, 71 g fat and 24 g fibre";
export const DEVIN_REST =
  "Meal 1\n2 whole eggs\n150 g egg whites\n100 g cooked white rice\n150 g broccoli\n10 g olive oil\n\nApproximate macros:\n45 g protein\n30 g carbohydrates\n20 g fat\n4 g fibre\n\nMeal 2\n180 g cooked chicken breast\n250 g cooked white rice\n1 medium banana\n\nApproximate macros:\n55 g protein\n95 g carbohydrates\n8 g fat\n5 g fibre\n\nMeal 3\n180 g cooked lean ground beef (90% lean)\n300 g cooked potatoes\n150 g green beans\n15 g olive oil\n\nApproximate macros:\n50 g protein\n58 g carbohydrates\n32 g fat\n7 g fibre\n\nDaily Total\nApproximately 180 g protein, 238 g carbohydrates, 70 g fat and 21 g fibre";
export const DEVIN_HIGH =
  "Meal 1\n180 g cooked chicken breast\n200 g cooked white rice\n1 medium banana\n\nApproximate macros:\n55 g protein\n82 g carbohydrates\n6 g fat\n5 g fibre\n\nMeal 2 (Pre-Workout)\n180 g cooked chicken breast\n300 g cooked white rice\n150 g green beans\n\nApproximate macros:\n55 g protein\n88 g carbohydrates\n7 g fat\n7 g fibre\n\nMeal 3 – Free Meal\nYour choice: burger + fries, steak + potatoes, pasta or whatever you're craving\nAim for about 850 kcal with 40+ g protein. Enjoy it, then straight back to the plan.\n\nApproximate macros:\n45 g protein\n100 g carbohydrates\n31 g fat\n6 g fibre\n\nDaily Total\nApproximately 185 g protein, 325 g carbohydrates, 79 g fat and 23 g fibre";
/** What the targets AI wrote for him on Nov 9 (the coaching decision). */
export const DEVIN_AI_TARGETS =
  "CALORIE TARGETS\nTraining Day: 2,550 kcal\nNon Training Day: 2,300 kcal\nHigh Day: 2,750 kcal\n\nMACRO TARGETS\n\nTraining Day\nProtein: 180g\nCarbs: 300g\nFats: 70g\n\nNon Training Day\nProtein: 180g\nCarbs: 235g\nFats: 70g\n\nHigh Day\nProtein: 180g\nCarbs: 330g\nFats: 80g";
export const DEVIN_PLAN_TEXT = `PHASE: Recomp\n\nTRAINING-DAY MENU\n${DEVIN_TRAINING}\n\nNON-TRAINING-DAY MENU\n${DEVIN_REST}\n\nHIGH-DAY MENU\n${DEVIN_HIGH}\n\nFOOD-WEIGHING RULES\n1. Weigh all meat, rice and potatoes after cooking.`;
/** md5(nutrition_target_days.notes) in production, Nov 18 2026. */
export const STORED_MD5 = {
  training: "45857cb554637c5cc14be3e93de22c42",
  rest: "74c17886e4d71bfb649f39c234838dd5",
  high: "ac550107c50f44f20fb8a5dcfaaf95e0",
} as const;

/**
 * What a regeneration for the same targets should come back as: 3 meals (his
 * answer), one container (200 g cooked protein + 350 g cooked white rice) on
 * every day, the Non-Training Day the same minus the banana and peanut butter,
 * the High Day his free meal and a bagel before training; every meal's macros
 * what its foods give. Its Daily Totals are deliberately the targets copied in
 * (the old failure): the code writes the real ones.
 */
export const ALIGNED_PLAN_TEXT = [
  "PHASE: Recomp",
  "",
  "TRAINING-DAY MENU",
  "Meal 1\n3 whole eggs\n200 g egg whites\n80 g oats\n1 medium banana\n15 g peanut butter\n\nApproximate macros:\n56 g protein\n87 g carbohydrates\n28 g fat\n9 g fibre\n",
  "Meal 2 (Pre-Workout)\n200 g cooked chicken breast\n350 g cooked white rice\n\nApproximate macros:\n72 g protein\n99 g carbohydrates\n8 g fat\n1 g fibre\n",
  "Meal 3 (Post-Workout)\n200 g cooked 93% lean ground beef\n350 g cooked white rice\n100 g broccoli\n10 g olive oil\n\nApproximate macros:\n64 g protein\n106 g carbohydrates\n28 g fat\n4 g fibre\n",
  "Daily Total\nApproximately 180 g protein, 300 g carbohydrates, 70 g fat and 14 g fibre",
  "",
  "NON-TRAINING-DAY MENU",
  "Meal 1\n3 whole eggs\n200 g egg whites\n80 g oats\n\nApproximate macros:\n53 g protein\n57 g carbohydrates\n20 g fat\n6 g fibre\n",
  "Meal 2\n200 g cooked chicken breast\n350 g cooked white rice\n\nApproximate macros:\n72 g protein\n99 g carbohydrates\n8 g fat\n1 g fibre\n",
  "Meal 3\n200 g cooked 93% lean ground beef\n350 g cooked white rice\n100 g broccoli\n10 g olive oil\n\nApproximate macros:\n64 g protein\n106 g carbohydrates\n28 g fat\n4 g fibre\n",
  "Daily Total\nApproximately 180 g protein, 235 g carbohydrates, 70 g fat and 11 g fibre",
  "",
  "HIGH-DAY MENU",
  "Meal 1\n3 whole eggs\n200 g egg whites\n80 g oats\n1 medium banana\n15 g peanut butter\n\nApproximate macros:\n56 g protein\n87 g carbohydrates\n28 g fat\n9 g fibre\n",
  "Meal 2 (Pre-Workout)\n200 g cooked chicken breast\n350 g cooked white rice\n1 bagel (about 100 g)\n\nApproximate macros:\n82 g protein\n149 g carbohydrates\n10 g fat\n3 g fibre\n",
  "Meal 3 – Free Meal\nYour choice: burger + fries, steak + potatoes, pasta or whatever you're craving\nAim for about 850 kcal with 40+ g protein. Enjoy it, then straight back to the plan.\n\nApproximate macros:\n45 g protein\n100 g carbohydrates\n31 g fat\n6 g fibre\n",
  "Daily Total\nApproximately 180 g protein, 330 g carbohydrates, 80 g fat and 18 g fibre",
  "",
  "FOOD-WEIGHING RULES",
  "1. Weigh meat and rice after cooking; oats and peanut butter dry.",
  "Swap: 100 g cooked chicken breast = 100 g cooked 93% lean ground beef",
].join("\n");
