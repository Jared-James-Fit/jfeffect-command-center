/**
 * Nutrition disclaimer shown on the client nutrition page and printed on
 * every meal plan / grocery list PDF.
 */
export const NUTRITION_DISCLAIMER_TITLE = "Nutrition disclaimer";

export const NUTRITION_DISCLAIMER =
  "JF Effect meal plans, macro and calorie targets, cardio targets and grocery lists are general fitness-coaching " +
  "guidance and meal suggestions only. JF Effect coaches are not registered dietitians, nutritionists or medical " +
  "professionals, and nothing here is medical advice, diagnosis or treatment. Always consult your doctor or a " +
  "registered dietitian before changing your diet or exercise — especially if you are pregnant or breastfeeding, " +
  "have a medical condition, take medication, have food allergies or intolerances, or have a history of disordered " +
  "eating. Always check food labels for allergens. If you feel unwell, stop and seek medical advice. You are " +
  "responsible for the food and health choices you make while following this plan.";

export const NUTRITION_DISCLAIMER_SHORT =
  "Meal suggestions from your coach, not medical advice. JF Effect coaches are not dietitians — consult your doctor " +
  "or a registered dietitian before changing your diet, and always check labels for allergens.";

/**
 * Shown on the Cookbook (under the list and on every recipe): what the
 * numbers are, labels and allergens, food safety, and that recipes are
 * general information. The Nutrition disclaimer above is unchanged.
 */
export const RECIPE_DISCLAIMER_SHORT = "Per serving, estimated from the ingredients.";

export const RECIPE_DISCLAIMER: readonly string[] = [
  "Calories and macros are estimates, per serving, worked out from standard nutrition data for the ingredients and amounts listed. Brands, cuts of meat, cooking methods and how you measure all change the real numbers, so log from your own labels when they differ, especially breads, sauces, cheese and protein powder.",
  "Check every label for allergens (milk, eggs, fish, shellfish, wheat and gluten, soy, peanuts, tree nuts, sesame, mustard) and swap or skip anything that doesn't fit your allergies, intolerances, or dietary or religious needs.",
  "Handle food safely: keep raw meat apart from ready-to-eat food, cook chicken and turkey to 74°C (165°F), ground beef to 71°C (160°F) and fish to 70°C (158°F) (a meat thermometer is the only way to know), refrigerate leftovers within 2 hours and eat them within 3 days, and reheat them to 74°C (165°F).",
  "These recipes are general nutrition information, not medical advice. If you're pregnant, managing a health condition or a medical diet, or your coach has given you a plan, follow your doctor's, dietitian's or coach's guidance first.",
];
