/**
 * The ingredients the JF Effect cookbook is built from, per 100 g as bought
 * (raw unless the name says cooked), from standard nutrition tables (USDA
 * FoodData Central / SR Legacy values, the typical store product where it's a
 * packaged food). Every recipe's numbers are worked out from these, so they're
 * consistent and checkable (cookbook-library.test.ts), and the recipe
 * disclaimer says what they are: estimates that brands and cooking change.
 *
 * [kcal, protein g, carbs g, fat g]
 */

export type FoodMacros = readonly [kcal: number, protein: number, carbs: number, fat: number];

export const FOODS = {
  // protein
  chicken_breast_raw: [120, 22.5, 0, 2.6],
  chicken_breast_cooked: [165, 31, 0, 3.6], // roasted / rotisserie breast, skin off
  beef_93_raw: [152, 20.9, 0, 7], // 93% lean / extra-lean ground beef
  sirloin_raw: [143, 22, 0, 5.8], // top sirloin, trimmed
  salmon_raw: [208, 20.4, 0, 13.4], // Atlantic, farmed
  shrimp_raw: [85, 20.1, 0, 0.5],
  tuna_drained: [116, 25.5, 0, 0.8], // light tuna in water, drained
  deli_turkey: [100, 18, 3, 1.5], // sliced turkey breast
  egg: [143, 12.6, 0.7, 9.5], // a large egg is ~50 g
  egg_whites: [52, 10.9, 0.7, 0.2], // liquid egg whites
  greek_yogurt_0: [59, 10.3, 3.6, 0.4], // plain, 0%
  cottage_cheese_1: [72, 12.4, 2.7, 1],
  whey: [400, 80, 10, 5], // a 30 g scoop: ~120 kcal, 24 g protein
  milk_1: [42, 3.4, 5, 1], // 1% milk
  mozzarella_part_skim: [254, 24.3, 2.8, 15.9],
  cheddar: [403, 22.9, 3.4, 33.1],
  parmesan: [392, 35.8, 3.2, 25.8],
  tofu_firm: [144, 17.3, 2.8, 8.7],
  edamame_shelled: [121, 11.9, 8.9, 5.2],
  // carbs
  oats: [379, 13.2, 67.7, 6.5], // rolled oats, dry
  rice_cooked: [130, 2.7, 28.2, 0.3], // white rice, cooked (or a microwave rice cup)
  rice_dry: [365, 7.1, 80, 0.7],
  pasta_dry: [371, 13, 74.7, 1.5],
  potato_raw: [79, 2.1, 18, 0.1],
  sweet_potato_raw: [86, 1.6, 20.1, 0.1],
  bread_whole_wheat: [252, 12.4, 42.7, 3.5], // a slice is ~35 g
  tortilla_flour: [304, 8.2, 49.4, 8], // a large 10" wrap is ~70 g
  bagel: [257, 10, 50.5, 1.6],
  rice_cakes: [387, 8.2, 81.5, 2.8], // a plain rice cake is ~9 g
  banana: [89, 1.1, 22.8, 0.3], // a medium banana is ~118 g
  berries: [50, 0.7, 12, 0.3], // mixed, fresh or frozen
  pineapple: [50, 0.5, 13.1, 0.1],
  black_beans_canned: [91, 6, 16.6, 0.3], // drained
  cornstarch: [381, 0.3, 91.3, 0.1],
  honey: [304, 0.3, 82.4, 0],
  // vegetables & extras
  stir_fry_veg: [35, 2, 6, 0.3], // frozen stir-fry / mixed vegetables
  broccoli: [34, 2.8, 6.6, 0.4],
  raw_veg: [30, 1.2, 6.5, 0.2], // carrots, cucumber, peppers
  lettuce: [15, 1.2, 2.9, 0.2],
  cucumber: [15, 0.7, 3.6, 0.1],
  onion: [40, 1.1, 9.3, 0.1],
  tomatoes_canned: [20, 1, 4, 0.2],
  salsa: [36, 1.5, 7, 0.2],
  marinara: [55, 1.5, 8.5, 1.5],
  soy_sauce: [53, 8.1, 4.9, 0.6],
  light_mayo: [260, 0.4, 9, 24],
  light_caesar: [250, 1, 10, 22],
  ranch_mix: [300, 6, 55, 5], // dry ranch seasoning
  olive_oil: [884, 0, 0, 100],
  peanut_butter: [588, 25.1, 19.6, 50.4],
  cocoa: [228, 19.6, 57.9, 13.7], // unsweetened cocoa powder
  chocolate_chips: [500, 5, 60, 30],
} as const satisfies Record<string, FoodMacros>;

export type FoodKey = keyof typeof FOODS;
