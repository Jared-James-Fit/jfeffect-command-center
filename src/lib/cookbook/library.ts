/**
 * The JF Effect Cookbook (Nov 15 2026): 32 simple, high-protein recipes a
 * lifter will actually make. Most take 10 minutes or less of hands-on time
 * with a handful of everyday ingredients; the three meal-prep recipes take
 * longer and make 4 to 6 containers. Every recipe says how to make it fit a
 * cut or a bulk.
 *
 * Numbers are worked out here from the ingredients (foods.ts), per serving,
 * never typed by hand, so they add up and stay checkable. The cookbook reads
 * recipes from the database (`recipes`, Published); the migration that puts
 * these there is generated from this file (sql.ts, cookbook-library.test.ts),
 * keeping the id of each older recipe it simplifies (its views stay with it).
 *
 * Before: 159 published recipes, 21 of them zero-calorie mocktails, a dozen
 * 1,000+ kcal "cheat meals" with 7–10 ingredients, prep times that were
 * placeholders (a diet soda float "20 min"), a taco bowl listed at 200 g of
 * protein, and the same idea three or four times over.
 */

import { FOODS, type FoodKey } from "./foods";

export type CookbookCategory = "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Dessert" | "Meal Prep";
export type CookMethod = "no-cook" | "microwave" | "pan" | "air-fryer" | "oven" | "stovetop";

export type Ingredient = {
  /** What's on the shopping list, with the amount. */
  text: string;
  /** Counted in the numbers; left out for salt, spices, hot sauce, water, sweetener. */
  food?: FoodKey;
  grams?: number;
};

export type CookbookRecipe = {
  id: string;
  title: string;
  category: CookbookCategory;
  method: CookMethod;
  /** Hands-on minutes. */
  prepMinutes: number;
  /** Hands-off minutes (oven, air fryer, simmering, fridge time), if any. */
  cookMinutes?: number;
  /** "Overnight", "2 hours in the freezer" when it isn't cooking time. */
  waitNote?: string;
  servings: number;
  vegetarian?: boolean;
  ingredients: Ingredient[];
  steps: string[];
  cutting: string;
  bulking: string;
  tip?: string;
};

export type Macros = { calories: number; protein: number; carbs: number; fat: number };

const FREE = (text: string): Ingredient => ({ text });
const I = (text: string, food: FoodKey, grams: number): Ingredient => ({ text, food, grams });

/** The marker tag on every recipe of this set. */
export const COOKBOOK_TAG = "jf-cookbook";

export const COOKBOOK: CookbookRecipe[] = [
  /* ---------------------------------------------------------------- Breakfast */
  {
    id: "220fd4e5-794f-4bbc-bf05-d3b198e5dfc3",
    title: "Protein Oats",
    category: "Breakfast",
    method: "microwave",
    prepMinutes: 4,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("50 g (½ cup) rolled oats", "oats", 50),
      FREE("250 ml (1 cup) water"),
      I("1 scoop (30 g) whey protein", "whey", 30),
      I("75 g (½ cup) frozen berries", "berries", 75),
    ],
    steps: [
      "Microwave the oats and water in a big bowl for 2 minutes.",
      "Let it sit 1 minute, then stir in the protein powder. Adding it before cooking makes it rubbery.",
      "Top with the berries.",
    ],
    cutting: "Use 40 g oats and add an extra splash of water. Still 30 g of protein.",
    bulking: "Cook the oats in 1% milk instead of water and stir in 1 tbsp peanut butter (+200 kcal).",
    tip: "Too thick once the protein is in? Add water a spoon at a time.",
  },
  {
    id: "86e1ca01-328a-477a-8cbb-cc8e3709c6ce",
    title: "Overnight Protein Oats",
    category: "Breakfast",
    method: "no-cook",
    prepMinutes: 5,
    waitNote: "Overnight in the fridge",
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("50 g (½ cup) rolled oats", "oats", 50),
      I("170 g (¾ cup) plain 0% Greek yogurt", "greek_yogurt_0", 170),
      I("120 ml (½ cup) 1% milk", "milk_1", 120),
      I("½ scoop (15 g) whey protein", "whey", 15),
      I("75 g (½ cup) berries", "berries", 75),
    ],
    steps: [
      "Stir the oats, yogurt, milk and protein powder together in a jar or container.",
      "Top with the berries, close it and refrigerate overnight (at least 4 hours).",
      "Eat it cold, or microwave it for a minute.",
    ],
    cutting: "Use 30 g oats and water instead of milk (about 310 kcal).",
    bulking: "Add 1 tbsp peanut butter and a sliced banana (+200 kcal).",
    tip: "Make 3 or 4 jars at once: they keep 3 days in the fridge. Cheesecake version: vanilla protein, a spoon of sugar-free cheesecake pudding mix and strawberries.",
  },
  {
    id: "f036b2eb-66aa-4346-ad72-1cd6be7fa7bd",
    title: "Egg Scramble & Toast",
    category: "Breakfast",
    method: "pan",
    prepMinutes: 5,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("2 large eggs", "egg", 100),
      I("150 ml (⅔ cup) liquid egg whites", "egg_whites", 150),
      I("2 slices whole-wheat bread", "bread_whole_wheat", 70),
      I("2 tbsp salsa or hot sauce", "salsa", 30),
      FREE("Salt, pepper and cooking spray"),
    ],
    steps: [
      "Spray a non-stick pan and heat it on medium.",
      "Whisk the eggs and egg whites with salt and pepper, pour them in and stir slowly until just set, 2 to 3 minutes.",
      "Toast the bread while the eggs cook, and top the eggs with salsa.",
    ],
    cutting: "Use 1 egg, 200 ml egg whites and 1 slice of toast (about 275 kcal).",
    bulking: "Add a third egg and a third slice of toast (+160 kcal).",
  },
  {
    id: "395e6cf0-748e-4dca-9160-fd8f8076487f",
    title: "Greek Yogurt Protein Bowl",
    category: "Breakfast",
    method: "no-cook",
    prepMinutes: 2,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("250 g (1 cup) plain 0% Greek yogurt", "greek_yogurt_0", 250),
      I("½ scoop (15 g) vanilla whey protein", "whey", 15),
      I("100 g (⅔ cup) berries", "berries", 100),
      I("2 tsp honey", "honey", 10),
    ],
    steps: ["Stir the protein powder into the yogurt until smooth.", "Top with the berries and honey."],
    cutting: "Eat it as it is. It's under 300 kcal with almost 40 g of protein.",
    bulking: "Add 40 g granola and 1 tbsp peanut butter (+280 kcal).",
    tip: "If the protein clumps, stir it into a splash of milk first.",
  },
  {
    id: "ca1d5e07-32ef-462b-b18e-2fe90fc29758",
    title: "Breakfast Burrito",
    category: "Breakfast",
    method: "pan",
    prepMinutes: 8,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("1 large (10\") flour tortilla", "tortilla_flour", 70),
      I("2 large eggs", "egg", 100),
      I("100 ml (⅓ cup) liquid egg whites", "egg_whites", 100),
      I("30 g (¼ cup) shredded part-skim mozzarella", "mozzarella_part_skim", 30),
      I("2 tbsp salsa", "salsa", 30),
    ],
    steps: [
      "Scramble the eggs and egg whites in a sprayed pan on medium, 2 to 3 minutes.",
      "Warm the tortilla in the microwave for 15 seconds.",
      "Fill it with the eggs, cheese and salsa, fold in the sides and roll it up.",
      "For a crisp outside, toast it seam-side down in the pan for a minute.",
    ],
    cutting: "Use a low-carb wrap and 1 egg with 150 ml egg whites (about 340 kcal).",
    bulking: "Add 100 g cooked potatoes or hash browns inside (+100 to 150 kcal).",
    tip: "Make 5 at once, wrap each in foil and freeze. Reheat from frozen out of the foil, about 2 minutes in the microwave, turning halfway.",
  },
  {
    id: "aec5b9ea-5bd7-47d3-9f41-1e85858bba59",
    title: "Protein Pancakes",
    category: "Breakfast",
    method: "pan",
    prepMinutes: 10,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("40 g (½ cup) rolled oats", "oats", 40),
      I("1 scoop (30 g) whey protein", "whey", 30),
      I("1 large egg", "egg", 50),
      I("100 ml (⅓ cup) liquid egg whites", "egg_whites", 100),
      I("½ banana", "banana", 60),
      FREE("½ tsp baking powder"),
    ],
    steps: [
      "Blend everything for 20 seconds.",
      "Heat a sprayed non-stick pan on medium-low.",
      "Pour 3 or 4 small pancakes. Flip when bubbles form on top (about 2 minutes) and cook 1 minute more.",
      "Top with berries or sugar-free syrup.",
    ],
    cutting: "Leave out the banana and use 30 g oats (about 360 kcal).",
    bulking: "Top with 1 tbsp peanut butter and 1 tbsp maple syrup (+150 kcal).",
  },
  {
    id: "98cb9791-df11-4b3b-8077-9aae8720a5d9",
    title: "Egg & Turkey Bagel",
    category: "Breakfast",
    method: "pan",
    prepMinutes: 6,
    servings: 1,
    ingredients: [
      I("1 plain bagel", "bagel", 95),
      I("2 large eggs", "egg", 100),
      I("40 g sliced turkey breast", "deli_turkey", 40),
      I("1 slice (20 g) cheddar", "cheddar", 20),
    ],
    steps: [
      "Toast the bagel.",
      "Fry or scramble the eggs in a sprayed pan, 2 to 3 minutes.",
      "Stack the eggs, turkey and cheese on the bagel: the hot eggs melt the cheese.",
    ],
    cutting: "Use an English muffin and 1 egg with 100 ml egg whites (about 380 kcal).",
    bulking: "Add a third egg and a second slice of cheese (+150 kcal).",
    tip: "Grab-and-go: make it the night before, wrap it, and microwave 45 seconds in the morning.",
  },

  /* ---------------------------------------------------------------- Meals */
  {
    id: "008bc5a5-b4eb-4e81-b87a-3d6009aa97a7",
    title: "Rotisserie Chicken & Rice Bowl",
    category: "Lunch",
    method: "microwave",
    prepMinutes: 5,
    servings: 1,
    ingredients: [
      I("150 g rotisserie chicken breast, skin off", "chicken_breast_cooked", 150),
      I("1 microwave rice cup (about 150 g cooked rice)", "rice_cooked", 150),
      I("1 bag steam-in-bag broccoli (about 150 g)", "broccoli", 150),
      FREE("Hot sauce, soy sauce or seasoning"),
    ],
    steps: [
      "Microwave the rice and the broccoli following their packages.",
      "Pull 150 g of breast meat off the chicken, skin off.",
      "Put it all in a bowl and season it.",
    ],
    cutting: "Use 75 g rice (half the cup) and double the broccoli (about 450 kcal).",
    bulking: "Use 250 g rice and add 1 tbsp olive oil or ¼ avocado (+250 kcal).",
    tip: "One rotisserie chicken is 2 or 3 of these. Pull all the breast meat when you get home and it's ready for 3 days.",
  },
  {
    id: "c16a96ba-d156-4880-9b2f-b9375774b189",
    title: "Air Fryer Chicken Breast",
    category: "Dinner",
    method: "air-fryer",
    prepMinutes: 5,
    cookMinutes: 18,
    servings: 1,
    ingredients: [
      I("200 g raw boneless, skinless chicken breast", "chicken_breast_raw", 200),
      I("1 tsp olive oil", "olive_oil", 5),
      FREE("Salt, pepper, garlic powder and paprika"),
    ],
    steps: [
      "Pat the chicken dry. If one end is much thicker, slice it in half lengthwise so it cooks evenly.",
      "Rub it with the oil and season both sides.",
      "Air fry at 200°C (400°F) for 16 to 20 minutes, flipping halfway, until the thickest part reads 74°C (165°F).",
      "Rest it 3 minutes before slicing.",
    ],
    cutting: "Use cooking spray instead of oil (about 240 kcal).",
    bulking: "Serve it with 200 g cooked rice or a potato (+260 kcal).",
    tip: "Cook 3 or 4 at once in a single layer for the week. A meat thermometer is the cheapest way to never eat dry chicken again.",
  },
  {
    id: "e1f45443-3ce7-4306-824a-4f8e2f16aac9",
    title: "Air Fryer Salmon & Potatoes",
    category: "Dinner",
    method: "air-fryer",
    prepMinutes: 8,
    cookMinutes: 20,
    servings: 1,
    ingredients: [
      I("150 g salmon fillet", "salmon_raw", 150),
      I("250 g potatoes (about 2 small)", "potato_raw", 250),
      I("1 tsp olive oil", "olive_oil", 5),
      FREE("Salt, garlic powder and a lemon wedge"),
    ],
    steps: [
      "Cut the potatoes into 2 cm cubes and toss them with the oil, salt and garlic powder.",
      "Air fry at 200°C (400°F) for 10 minutes.",
      "Shake the basket, add the seasoned salmon skin-side down and cook 8 to 10 minutes more, until it flakes easily and reaches 70°C (158°F).",
      "Squeeze the lemon over it.",
    ],
    cutting: "Use 150 g potatoes and cooking spray instead of oil (about 430 kcal).",
    bulking: "Use 400 g potatoes and 2 more tsp of oil (+210 kcal).",
  },
  {
    id: "0c7ea908-a6b5-4bbd-b4a6-daad03ffd916",
    title: "Taco Rice Bowl",
    category: "Dinner",
    method: "pan",
    prepMinutes: 10,
    servings: 1,
    ingredients: [
      I("150 g extra-lean (93%) ground beef or turkey", "beef_93_raw", 150),
      I("1 microwave rice cup (about 150 g cooked rice)", "rice_cooked", 150),
      I("75 g (⅓ cup) canned black beans, rinsed", "black_beans_canned", 75),
      I("¼ cup (50 g) salsa", "salsa", 50),
      FREE("1 tbsp taco seasoning"),
    ],
    steps: [
      "Brown the meat in a pan on medium-high, breaking it up, until no pink is left (5 to 6 minutes).",
      "Stir in the taco seasoning with a splash of water and simmer 1 minute.",
      "Microwave the rice and the beans.",
      "Pile it all in a bowl and top with salsa.",
    ],
    cutting: "Swap the rice for lettuce or riced cauliflower (about 340 kcal).",
    bulking: "Add 30 g shredded cheese and ¼ avocado (+200 kcal).",
    tip: "Brown 600 g of meat at once and you have 4 bowls for the week.",
  },
  {
    id: "031c3243-596c-45d2-a977-c8bdccd293cc",
    title: "Chicken Stir-Fry",
    category: "Dinner",
    method: "pan",
    prepMinutes: 10,
    servings: 1,
    ingredients: [
      I("150 g raw chicken breast, sliced thin", "chicken_breast_raw", 150),
      I("250 g frozen stir-fry vegetables", "stir_fry_veg", 250),
      I("1 tbsp soy sauce", "soy_sauce", 15),
      I("1 tsp oil", "olive_oil", 5),
      I("1 microwave rice cup (about 150 g cooked rice)", "rice_cooked", 150),
      FREE("Garlic powder and chili flakes"),
    ],
    steps: [
      "Heat the oil in a large pan on high.",
      "Cook the chicken 4 to 5 minutes, until no pink is left.",
      "Add the frozen vegetables and cook 3 to 4 minutes, stirring.",
      "Stir in the soy sauce and seasoning and serve over the rice.",
    ],
    cutting: "Use half the rice (about 415 kcal), or skip it (about 320).",
    bulking: "Use 250 g rice and add 2 tsp honey to the sauce (+170 kcal).",
  },
  {
    id: "44bf1c83-11b9-45d6-9a41-64a52dad2db5",
    title: "Beef Pasta Marinara",
    category: "Dinner",
    method: "stovetop",
    prepMinutes: 10,
    servings: 1,
    ingredients: [
      I("75 g dry pasta", "pasta_dry", 75),
      I("125 g extra-lean (93%) ground beef", "beef_93_raw", 125),
      I("150 g (⅔ cup) jarred marinara sauce", "marinara", 150),
      I("1 tbsp (10 g) grated parmesan", "parmesan", 10),
    ],
    steps: [
      "Boil the pasta in salted water following the package (about 10 minutes).",
      "Meanwhile brown the beef in a pan, breaking it up, until no pink is left.",
      "Add the marinara and simmer 2 minutes.",
      "Drain the pasta, toss it with the sauce and top with parmesan.",
    ],
    cutting: "Use 50 g pasta and stir a handful of spinach into the sauce (about 500 kcal).",
    bulking: "Use 125 g pasta (+185 kcal).",
    tip: "Double everything and the second half is tomorrow's lunch.",
  },
  {
    id: "16cfc185-89b4-450c-a701-149c74b4dd81",
    title: "Chicken Caesar Wrap",
    category: "Lunch",
    method: "no-cook",
    prepMinutes: 5,
    servings: 1,
    ingredients: [
      I("120 g cooked chicken breast", "chicken_breast_cooked", 120),
      I("1 large (10\") flour tortilla", "tortilla_flour", 70),
      I("1 cup (30 g) chopped romaine", "lettuce", 30),
      I("1 tbsp (20 g) light Caesar dressing", "light_caesar", 20),
      I("1 tbsp (10 g) grated parmesan", "parmesan", 10),
    ],
    steps: [
      "Slice the chicken and chop the lettuce.",
      "Toss them with the dressing.",
      "Fill the tortilla, sprinkle the parmesan, fold in the sides and roll it up.",
    ],
    cutting: "Use a low-carb wrap (about 390 kcal).",
    bulking: "Have it with an apple and a glass of 1% milk (+200 kcal).",
    tip: "Leftover Air Fryer Chicken Breast or rotisserie chicken both work.",
  },
  {
    id: "4f795426-5275-4fb4-9ade-9d557a6d45e7",
    title: "Spicy Tuna Sushi Bowl",
    category: "Lunch",
    method: "no-cook",
    prepMinutes: 5,
    servings: 1,
    ingredients: [
      I("1 can (120 g drained) light tuna in water", "tuna_drained", 120),
      I("1 microwave rice cup (about 150 g cooked rice)", "rice_cooked", 150),
      I("1 tbsp light mayo", "light_mayo", 15),
      I("½ cucumber, sliced", "cucumber", 50),
      I("2 tsp soy sauce", "soy_sauce", 10),
      FREE("Sriracha to taste"),
    ],
    steps: [
      "Microwave the rice.",
      "Mix the drained tuna with the mayo and sriracha.",
      "Top the rice with the tuna and cucumber and drizzle the soy sauce over it.",
    ],
    cutting: "Use 100 g rice (about 320 kcal).",
    bulking: "Use 250 g rice and add ½ avocado (+250 kcal).",
    tip: "Crushed seaweed snacks or sesame seeds on top make it taste like the real thing.",
  },
  {
    id: "4271bcae-6e5e-40ad-8a0c-cbe1a4f37e96",
    title: "Hot Honey Chicken & Sweet Potato",
    category: "Dinner",
    method: "air-fryer",
    prepMinutes: 8,
    cookMinutes: 22,
    servings: 1,
    ingredients: [
      I("150 g raw chicken breast, cubed", "chicken_breast_raw", 150),
      I("250 g sweet potato, cubed (1 medium)", "sweet_potato_raw", 250),
      I("1 tbsp honey", "honey", 15),
      I("1 tsp olive oil", "olive_oil", 5),
      FREE("Salt, garlic powder, chili flakes or hot sauce"),
    ],
    steps: [
      "Toss the sweet potato with the oil and salt and air fry at 200°C (400°F) for 10 minutes.",
      "Season the chicken, add it to the basket and cook 10 to 12 minutes more, shaking once, until the chicken reaches 74°C (165°F).",
      "Warm the honey for 10 seconds with chili flakes or a splash of hot sauce and toss everything in it.",
    ],
    cutting: "Use 150 g sweet potato and 2 tsp honey (about 380 kcal).",
    bulking: "Use 400 g sweet potato and 200 g chicken (+190 kcal).",
  },
  {
    id: "71b81611-05ea-4ed6-8e45-7623e31faaa5",
    title: "Steak Bites & Potatoes",
    category: "Dinner",
    method: "air-fryer",
    prepMinutes: 8,
    cookMinutes: 20,
    servings: 1,
    ingredients: [
      I("175 g sirloin steak", "sirloin_raw", 175),
      I("250 g potatoes (about 2 small)", "potato_raw", 250),
      I("1 tsp olive oil", "olive_oil", 5),
      FREE("Salt, pepper and garlic powder"),
    ],
    steps: [
      "Cube the potatoes, toss them with half the oil and salt, and air fry at 200°C (400°F) for 12 minutes.",
      "Cut the steak into 2 to 3 cm cubes and toss with the rest of the oil and the seasoning.",
      "Add the steak to the basket and cook 6 to 8 minutes, shaking once, until done the way you like it (63°C / 145°F is medium-rare).",
    ],
    cutting: "Use 150 g potatoes and add a side of green beans (about 440 kcal).",
    bulking: "Use 400 g potatoes and 225 g steak (+190 kcal).",
  },
  {
    id: "851d7f8b-1d6a-47ac-a28b-6159ab90138b",
    title: "Cajun Shrimp Rice Bowl",
    category: "Dinner",
    method: "pan",
    prepMinutes: 10,
    servings: 1,
    ingredients: [
      I("200 g raw peeled shrimp (thawed)", "shrimp_raw", 200),
      I("200 g cooked rice (a large microwave cup)", "rice_cooked", 200),
      I("150 g frozen mixed vegetables", "stir_fry_veg", 150),
      I("1 tsp oil", "olive_oil", 5),
      FREE("2 tsp Cajun seasoning"),
    ],
    steps: [
      "Pat the shrimp dry and toss with the oil and Cajun seasoning.",
      "Cook in a hot pan for about 2 minutes a side, until pink and curled.",
      "Microwave the rice and the vegetables.",
      "Serve the shrimp over them.",
    ],
    cutting: "Use 100 g rice (about 400 kcal).",
    bulking: "Use 300 g rice and add ¼ avocado (+210 kcal).",
    tip: "Frozen shrimp thaws in 5 minutes under cold running water.",
  },
  {
    id: "29917dec-8d30-40e5-ae56-128ae2a9df13",
    title: "Crispy Tofu Rice Bowl",
    category: "Dinner",
    method: "air-fryer",
    prepMinutes: 8,
    cookMinutes: 15,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("200 g extra-firm tofu", "tofu_firm", 200),
      I("1 tbsp soy sauce", "soy_sauce", 15),
      I("1 tbsp cornstarch", "cornstarch", 10),
      I("1 microwave rice cup (about 150 g cooked rice)", "rice_cooked", 150),
      I("1 bag steam-in-bag broccoli (about 150 g)", "broccoli", 150),
    ],
    steps: [
      "Press the tofu between paper towels for a few minutes, then cut it into cubes.",
      "Toss the cubes with the soy sauce, then with the cornstarch.",
      "Air fry at 200°C (400°F) for 12 to 15 minutes, shaking halfway, until crisp.",
      "Serve over the rice and broccoli.",
    ],
    cutting: "Use 75 g rice (about 480 kcal).",
    bulking: "Use 250 g rice and drizzle 1 tbsp peanut butter thinned with soy sauce (+225 kcal).",
  },

  /* ---------------------------------------------------------------- Snacks */
  {
    id: "e6ddf9b1-1c68-446c-8cb5-2b6705982f07",
    title: "Cottage Cheese & Pineapple",
    category: "Snack",
    method: "no-cook",
    prepMinutes: 1,
    servings: 1,
    vegetarian: true,
    ingredients: [I("200 g (¾ cup) 1% cottage cheese", "cottage_cheese_1", 200), I("100 g pineapple chunks", "pineapple", 100)],
    steps: ["Spoon the cottage cheese into a bowl.", "Top with the pineapple."],
    cutting: "Eat it as it is.",
    bulking: "Add 30 g granola or a small handful of almonds (+150 kcal).",
    tip: "Canned pineapple in juice, drained, works too. Not a fan of the texture? Blend the cottage cheese smooth first.",
  },
  {
    id: "0873f212-5dcd-45ec-9d44-7eb64e494ce2",
    title: "Greek Yogurt Ranch Dip & Veggies",
    category: "Snack",
    method: "no-cook",
    prepMinutes: 5,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("170 g (¾ cup) plain 0% Greek yogurt", "greek_yogurt_0", 170),
      I("1 tsp dry ranch seasoning", "ranch_mix", 5),
      I("200 g carrot, cucumber and pepper sticks", "raw_veg", 200),
    ],
    steps: ["Stir the ranch seasoning into the yogurt.", "Cut the vegetables into sticks and dip."],
    cutting: "Eat it as it is.",
    bulking: "Add a few whole-grain crackers or a pita (+150 kcal).",
    tip: "Mix a big tub of the dip at the start of the week: it keeps 3 days in the fridge.",
  },
  {
    id: "11961034-3a27-4019-b501-2af95c9f2214",
    title: "Turkey Roll-Ups",
    category: "Snack",
    method: "no-cook",
    prepMinutes: 3,
    servings: 1,
    ingredients: [
      I("120 g sliced turkey breast", "deli_turkey", 120),
      I("2 slices (40 g) part-skim mozzarella", "mozzarella_part_skim", 40),
      FREE("Mustard and pickle spears"),
    ],
    steps: ["Lay out the turkey slices.", "Add the cheese, a little mustard and a pickle spear.", "Roll them up."],
    cutting: "Eat it as it is.",
    bulking: "Roll everything in a tortilla, or add an apple and a handful of nuts (+250 kcal).",
  },
  {
    id: "27d29ad4-0fa3-45b9-99a5-a40e7f0ef003",
    title: "Tuna Rice Cakes",
    category: "Snack",
    method: "no-cook",
    prepMinutes: 3,
    servings: 1,
    ingredients: [
      I("1 can (120 g drained) light tuna in water", "tuna_drained", 120),
      I("3 plain rice cakes", "rice_cakes", 27),
      I("2 tsp light mayo", "light_mayo", 10),
      FREE("Pepper and hot sauce"),
    ],
    steps: ["Mix the drained tuna with the mayo, pepper and hot sauce.", "Spread it on the rice cakes."],
    cutting: "Eat it as it is.",
    bulking: "Use 5 rice cakes and add ¼ avocado (+150 kcal).",
  },
  {
    id: "23db7831-f859-42c9-8a0a-33abb58e78f7",
    title: "Chocolate Banana Protein Shake",
    category: "Snack",
    method: "no-cook",
    prepMinutes: 2,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("1 scoop (30 g) chocolate whey protein", "whey", 30),
      I("300 ml (1¼ cups) 1% milk", "milk_1", 300),
      I("1 medium banana (fresh or frozen)", "banana", 118),
      FREE("A handful of ice"),
    ],
    steps: ["Blend everything for 30 seconds."],
    cutting: "Use water instead of milk and half a banana (about 175 kcal).",
    bulking: "Blend in 40 g oats and 1 tbsp peanut butter for a mass shake (+245 kcal).",
    tip: "Freeze ripe bananas in chunks and the shake comes out thick like a milkshake.",
  },
  {
    id: "6114d7aa-a686-4fc1-be10-596876cd2868",
    title: "Microwave Edamame",
    category: "Snack",
    method: "microwave",
    prepMinutes: 4,
    servings: 1,
    vegetarian: true,
    ingredients: [I("150 g frozen shelled edamame", "edamame_shelled", 150), FREE("Salt and chili flakes")],
    steps: ["Microwave the edamame in a covered bowl for 3 to 4 minutes.", "Season with salt and chili flakes."],
    cutting: "Eat it as it is.",
    bulking: "Have it with a bowl of rice and soy sauce for a meal (+200 kcal).",
  },

  /* ---------------------------------------------------------------- Sweet */
  {
    id: "81108217-51e3-42c1-bd3b-42a484396357",
    title: "Chocolate Protein Pudding",
    category: "Dessert",
    method: "no-cook",
    prepMinutes: 3,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("200 g (¾ cup) plain 0% Greek yogurt", "greek_yogurt_0", 200),
      I("½ scoop (15 g) chocolate whey protein", "whey", 15),
      I("1 tbsp (5 g) cocoa powder", "cocoa", 5),
      FREE("Sweetener to taste"),
    ],
    steps: [
      "Stir the protein powder and cocoa into the yogurt until smooth.",
      "Sweeten to taste. Chill 10 minutes for a thicker, mousse-like pudding.",
    ],
    cutting: "Eat it as it is.",
    bulking: "Top with 1 tbsp peanut butter and a sliced banana (+200 kcal).",
    tip: "Vanilla protein and berries instead of cocoa makes a cheesecake-style bowl.",
  },
  {
    id: "74993cf3-d596-4563-9303-c5275d28ed80",
    title: "Protein Mug Cake",
    category: "Dessert",
    method: "microwave",
    prepMinutes: 3,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("1 scoop (30 g) chocolate or vanilla whey protein", "whey", 30),
      I("20 g (¼ cup) oat flour (blended oats)", "oats", 20),
      I("1 tbsp (5 g) cocoa powder", "cocoa", 5),
      I("50 ml liquid egg whites", "egg_whites", 50),
      I("2 tbsp (30 ml) 1% milk", "milk_1", 30),
      FREE("½ tsp baking powder"),
    ],
    steps: [
      "Mix the protein powder, oat flour, cocoa and baking powder in a large mug.",
      "Stir in the egg whites and milk until smooth.",
      "Microwave 60 to 75 seconds. It should still be a little soft in the middle: overcooked is rubbery.",
    ],
    cutting: "Eat it as it is.",
    bulking: "Add 10 g chocolate chips and serve with a scoop of light ice cream (+150 kcal).",
    tip: "No oat flour? Blend rolled oats for 10 seconds.",
  },
  {
    id: "38812365-7f93-425f-ba13-f8549078c7a0",
    title: "Cottage Cheese Cookie Dough",
    category: "Dessert",
    method: "no-cook",
    prepMinutes: 5,
    servings: 1,
    vegetarian: true,
    ingredients: [
      I("200 g (¾ cup) 1% cottage cheese", "cottage_cheese_1", 200),
      I("½ scoop (15 g) vanilla whey protein", "whey", 15),
      I("1 tbsp peanut butter", "peanut_butter", 15),
      I("1 tbsp (10 g) chocolate chips", "chocolate_chips", 10),
      FREE("Sweetener to taste"),
    ],
    steps: [
      "Blend the cottage cheese until completely smooth.",
      "Stir in the protein powder, peanut butter and a little sweetener.",
      "Fold in the chocolate chips. Chill 15 minutes for a firmer dough.",
    ],
    cutting: "Leave out the peanut butter (about 255 kcal).",
    bulking: "Eat it with graham crackers or pretzels (+150 kcal).",
  },
  {
    id: "75324894-eff8-449e-897c-8c3e35e13bcc",
    title: "Frozen Yogurt Bark",
    category: "Dessert",
    method: "no-cook",
    prepMinutes: 5,
    waitNote: "2 hours in the freezer",
    servings: 4,
    vegetarian: true,
    ingredients: [
      I("500 g (2 cups) plain 0% Greek yogurt", "greek_yogurt_0", 500),
      I("1 scoop (30 g) vanilla whey protein", "whey", 30),
      I("1 tbsp + 1 tsp honey", "honey", 20),
      I("150 g (1 cup) berries", "berries", 150),
      I("2 tbsp (20 g) chocolate chips", "chocolate_chips", 20),
    ],
    steps: [
      "Stir the protein powder and honey into the yogurt.",
      "Spread it about 1 cm thick on a tray lined with parchment paper.",
      "Scatter the berries and chocolate chips on top.",
      "Freeze 2 hours, then break it into pieces and keep them in a freezer bag.",
    ],
    cutting: "One serving is a quarter of the tray.",
    bulking: "Have two servings.",
  },

  /* ---------------------------------------------------------------- Meal prep */
  {
    id: "0550faa5-21b0-4bfa-ae16-861aeee818a2",
    title: "Chicken & Rice Meal Prep",
    category: "Meal Prep",
    method: "oven",
    prepMinutes: 15,
    cookMinutes: 30,
    servings: 4,
    ingredients: [
      I("800 g raw chicken breast", "chicken_breast_raw", 800),
      I("300 g (1½ cups) dry white rice", "rice_dry", 300),
      I("600 g frozen mixed vegetables", "stir_fry_veg", 600),
      I("1 tbsp olive oil", "olive_oil", 15),
      FREE("Salt, pepper, garlic powder and paprika"),
    ],
    steps: [
      "Start the rice in a rice cooker or pot following the package.",
      "Heat the oven to 220°C (425°F). Toss the chicken with 2 tsp of the oil and the seasoning on a lined tray and bake 20 to 25 minutes, until the thickest piece reads 74°C (165°F).",
      "Roast or steam the vegetables with the last of the oil while the chicken cooks.",
      "Rest the chicken 5 minutes, slice it and split everything into 4 containers.",
    ],
    cutting: "Cook 200 g dry rice instead of 300 g (about 510 kcal a container).",
    bulking: "Cook 450 g dry rice and add 1 tbsp more oil (+170 kcal a container).",
    tip: "Cool the containers before they go in the fridge. Eat them within 3 days, or freeze some and thaw them overnight in the fridge.",
  },
  {
    id: "f1ed3023-c5a9-4314-b7ac-4cf883456aba",
    title: "Egg White Muffins",
    category: "Meal Prep",
    method: "oven",
    prepMinutes: 10,
    cookMinutes: 22,
    servings: 4,
    ingredients: [
      I("6 large eggs", "egg", 300),
      I("500 ml (2 cups) liquid egg whites", "egg_whites", 500),
      I("150 g sliced turkey breast, chopped", "deli_turkey", 150),
      I("150 g chopped peppers and spinach", "raw_veg", 150),
      I("60 g (½ cup) shredded part-skim mozzarella", "mozzarella_part_skim", 60),
      FREE("Salt and pepper"),
    ],
    steps: [
      "Heat the oven to 180°C (350°F) and grease a 12-cup muffin tin well (or use silicone cups).",
      "Divide the turkey, vegetables and cheese between the cups.",
      "Whisk the eggs and egg whites with salt and pepper and pour them in, filling each cup about ¾ full.",
      "Bake 20 to 22 minutes, until set in the middle. Cool, then refrigerate.",
    ],
    cutting: "Three muffins as written.",
    bulking: "Have three with a toasted bagel (+245 kcal).",
    tip: "Makes 12 (3 a serving). Reheat 30 to 45 seconds in the microwave. They keep 3 days in the fridge or 2 months in the freezer.",
  },
  {
    id: "5b0cd1ab-96ea-4fc9-84fe-7f1816a91610",
    title: "Beef & Bean Chili",
    category: "Meal Prep",
    method: "stovetop",
    prepMinutes: 15,
    cookMinutes: 25,
    servings: 6,
    ingredients: [
      I("900 g extra-lean (93%) ground beef", "beef_93_raw", 900),
      I("2 cans (540 ml each) black or kidney beans, drained and rinsed", "black_beans_canned", 480),
      I("1 can (796 ml) diced tomatoes", "tomatoes_canned", 800),
      I("1 cup (150 g) frozen diced onion", "onion", 150),
      FREE("3 tbsp chili powder, 1 tbsp cumin, salt and pepper"),
    ],
    steps: [
      "Brown the beef with the onion in a large pot on medium-high, breaking it up, 8 to 10 minutes.",
      "Stir in the chili powder, cumin, salt and pepper.",
      "Add the tomatoes and the beans, bring it to a simmer and cook 20 minutes, stirring now and then.",
      "Split it into 6 containers.",
    ],
    cutting: "A bowl as written is about 340 kcal.",
    bulking: "Serve each bowl over 200 g cooked rice with 30 g shredded cheese (+380 kcal).",
    tip: "Cool it in shallow containers before the fridge. It keeps 3 days in the fridge or 3 months in the freezer.",
  },
];

const r1 = (n: number) => Math.round(n);

/** Per-serving numbers, from the ingredients. */
export function recipeMacros(recipe: CookbookRecipe): Macros {
  let kcal = 0;
  let p = 0;
  let c = 0;
  let f = 0;
  for (const ing of recipe.ingredients) {
    if (!ing.food || !ing.grams) continue;
    const [k, pp, cc, ff] = FOODS[ing.food];
    const x = ing.grams / 100;
    kcal += k * x;
    p += pp * x;
    c += cc * x;
    f += ff * x;
  }
  const s = recipe.servings || 1;
  return { calories: r1(kcal / s), protein: r1(p / s), carbs: r1(c / s), fat: r1(f / s) };
}

/**
 * Who a recipe suits, from its numbers: cutting when it's a lean, protein-led
 * serving; bulking when it's a big one. The detail shows how to make any
 * recipe fit either way.
 */
export function goalFit(m: Pick<Macros, "calories" | "protein">): { cutting: boolean; bulking: boolean } {
  const proteinShare = m.calories > 0 ? (m.protein * 4) / m.calories : 0;
  return {
    cutting: m.calories > 0 && m.calories <= 450 && proteinShare >= 0.28,
    bulking: m.calories >= 480,
  };
}

export function recipeTags(recipe: CookbookRecipe): string[] {
  const m = recipeMacros(recipe);
  const fit = goalFit(m);
  return [
    COOKBOOK_TAG,
    recipe.method,
    "high-protein",
    ...(fit.cutting ? ["cutting"] : []),
    ...(fit.bulking ? ["bulking"] : []),
    ...(recipe.category === "Meal Prep" ? ["meal-prep"] : []),
    ...(recipe.vegetarian ? ["vegetarian"] : []),
    ...(recipe.prepMinutes <= 10 ? ["quick"] : []),
  ];
}

/**
 * The recipe body as the admin editor and the parser (recipe-format.ts) read
 * it: fields, Ingredients, Instructions, Nutrition, Notes (the cutting /
 * bulking lines and the tip).
 */
export function recipeBody(recipe: CookbookRecipe): string {
  const m = recipeMacros(recipe);
  const lines: string[] = [];
  lines.push(`Servings: ${recipe.servings}`);
  lines.push(`Prep Time: ${recipe.prepMinutes} min`);
  if (recipe.cookMinutes) lines.push(`Cook Time: ${recipe.cookMinutes} min hands-off`);
  else if (recipe.waitNote) lines.push(`Cook Time: ${recipe.waitNote}`);
  lines.push("", "## Ingredients", "");
  for (const i of recipe.ingredients) lines.push(`- ${i.text}`);
  lines.push("", "## Instructions", "");
  recipe.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", "## Nutrition", "");
  lines.push(`- Calories: ${m.calories} kcal`);
  lines.push(`- Protein: ${m.protein} g`);
  lines.push(`- Carbs: ${m.carbs} g`);
  lines.push(`- Fat: ${m.fat} g`);
  lines.push("", "## Notes", "");
  lines.push(`- Cutting: ${recipe.cutting}`);
  lines.push(`- Bulking: ${recipe.bulking}`);
  if (recipe.tip) lines.push(`- Tip: ${recipe.tip}`);
  return lines.join("\n") + "\n";
}
