-- Cookbook: extremely simple recipes (air fryer, pan, microwave, no-cook, store-bought).
-- Idempotent by title. Published to everyone. Applied to production directly.
insert into public.recipes (title, category, status, access_scope, body, tags, published_at, calories_per_serving, protein_grams, prep_time_minutes, servings)
select v.* from (values
('Protein Pudding Cup','Dessert','Published','everyone','## Ingredients

- 1 sugar-free pudding cup (any flavour)
- 150 g 0% Greek yogurt

## Instructions

1. Stir the pudding into the Greek yogurt.
2. Eat right away or chill 10 minutes.

## Nutrition

- **Calories:** 140
- **Protein:** 16 g

## Tip

Chocolate pudding + vanilla Greek yogurt tastes like mousse.
',ARRAY['easy','no-cook','grab-and-go','dessert','low-calorie','quick']::text[],now(),140,16,2,1),
('Sugar-Free Jell-O Cup + Whip','Dessert','Published','everyone','## Ingredients

- 1 sugar-free Jell-O cup
- 2 tbsp light whipped topping

## Instructions

1. Top the Jell-O with the whipped topping.
2. Done.

## Nutrition

- **Calories:** 30
- **Protein:** 1 g

## Tip

Almost zero calories — perfect for night-time sweet cravings.
',ARRAY['easy','no-cook','grab-and-go','dessert','low-calorie','quick']::text[],now(),30,1,1,1),
('High-Protein Yogurt + Berries','Snack','Published','everyone','## Ingredients

- 1 high-protein yogurt cup (e.g. Oikos Pro)
- 50 g berries

## Instructions

1. Top the yogurt with the berries.
2. Done.

## Nutrition

- **Calories:** 150
- **Protein:** 20 g
',ARRAY['easy','no-cook','grab-and-go','snack','high-protein','low-calorie','quick']::text[],now(),150,20,1,1),
('Protein Shake + Banana','Breakfast','Published','everyone','## Ingredients

- 1 ready-to-drink protein shake (e.g. Fairlife Core Power)
- 1 banana

## Instructions

1. Grab both and go.

## Nutrition

- **Calories:** 275
- **Protein:** 27 g

## Tip

Great for busy mornings or right after training.
',ARRAY['easy','no-cook','grab-and-go','breakfast','high-protein','low-calorie','quick']::text[],now(),275,27,1,1),
('Rotisserie Chicken Plate','Lunch','Published','everyone','## Ingredients

- 150 g store-bought rotisserie chicken breast (skin off)
- 1 microwave rice cup
- 1 bag steam-in-bag vegetables (about 150 g)

## Instructions

1. Microwave the rice and veggies following the packages.
2. Pull the chicken off the bone and add it to the plate.
3. Season and eat.

## Nutrition

- **Calories:** 490
- **Protein:** 52 g

## Tip

Buy one rotisserie chicken and you have 2–3 meals done.
',ARRAY['easy','microwave','grab-and-go','lunch','high-protein','quick']::text[],now(),490,52,5,1),
('Deli Turkey Roll-Ups','Snack','Published','everyone','## Ingredients

- 100 g sliced deli turkey
- 2 light cheese slices
- Mustard
- Pickle spears

## Instructions

1. Lay out the turkey slices.
2. Add cheese, mustard and a pickle spear.
3. Roll them up.

## Nutrition

- **Calories:** 190
- **Protein:** 26 g
',ARRAY['easy','no-cook','grab-and-go','snack','high-protein','low-calorie','quick']::text[],now(),190,26,3,1),
('Cottage Cheese & Pineapple','Snack','Published','everyone','## Ingredients

- 200 g 1% cottage cheese
- 100 g pineapple chunks

## Instructions

1. Add the pineapple on top of the cottage cheese.
2. Done.

## Nutrition

- **Calories:** 210
- **Protein:** 25 g
',ARRAY['easy','no-cook','grab-and-go','snack','high-protein','low-calorie','quick']::text[],now(),210,25,1,1),
('Protein Bar + Apple','Snack','Published','everyone','## Ingredients

- 1 protein bar (about 200 kcal, 20 g protein)
- 1 apple

## Instructions

1. Grab both and go.

## Nutrition

- **Calories:** 295
- **Protein:** 20 g

## Tip

Keep a bar in your bag or car for emergencies.
',ARRAY['easy','no-cook','grab-and-go','snack','high-protein','low-calorie','quick']::text[],now(),295,20,1,1),
('Tuna Pouch & Crackers','Lunch','Published','everyone','## Ingredients

- 1 flavoured tuna pouch
- 6 rice crackers
- 1/2 cucumber, sliced

## Instructions

1. Open the tuna pouch.
2. Scoop onto crackers and cucumber slices.

## Nutrition

- **Calories:** 220
- **Protein:** 20 g
',ARRAY['easy','no-cook','grab-and-go','lunch','high-protein','low-calorie','quick']::text[],now(),220,20,2,1),
('Egg White Bites + Yogurt','Breakfast','Published','everyone','## Ingredients

- 2 frozen egg white bites
- 1 high-protein yogurt cup

## Instructions

1. Microwave the egg bites following the package (about 1 minute).
2. Eat with the yogurt.

## Nutrition

- **Calories:** 290
- **Protein:** 30 g
',ARRAY['easy','microwave','grab-and-go','breakfast','high-protein','low-calorie','quick']::text[],now(),290,30,3,1),
('Hard-Boiled Eggs + Orange','Snack','Published','everyone','## Ingredients

- 2 store-bought peeled hard-boiled eggs
- 1 orange

## Instructions

1. Salt and pepper the eggs.
2. Eat with the orange.

## Nutrition

- **Calories:** 220
- **Protein:** 13 g
',ARRAY['easy','no-cook','grab-and-go','snack','low-calorie','quick']::text[],now(),220,13,1,1),
('Beef Jerky + Cheese Stick','Snack','Published','everyone','## Ingredients

- 30 g beef jerky
- 1 light cheese stick

## Instructions

1. Grab both and go.

## Nutrition

- **Calories:** 140
- **Protein:** 19 g
',ARRAY['easy','no-cook','grab-and-go','snack','low-calorie','quick']::text[],now(),140,19,1,1),
('Apple + String Cheese','Snack','Published','everyone','## Ingredients

- 1 apple
- 2 light string cheese

## Instructions

1. Slice the apple (optional).
2. Eat with the cheese.

## Nutrition

- **Calories:** 220
- **Protein:** 14 g
',ARRAY['easy','no-cook','grab-and-go','snack','low-calorie','quick']::text[],now(),220,14,1,1),
('Chocolate Protein Milk','Snack','Published','everyone','## Ingredients

- 1 bottle (about 400 ml) chocolate ultra-filtered milk (e.g. Fairlife)

## Instructions

1. Shake and drink.

## Nutrition

- **Calories:** 230
- **Protein:** 22 g

## Tip

Tastes like chocolate milk, packs way more protein.
',ARRAY['easy','no-cook','grab-and-go','snack','high-protein','low-calorie','quick']::text[],now(),230,22,1,1),
('Light Ice Cream Bowl','Dessert','Published','everyone','## Ingredients

- 1/2 pint light high-protein ice cream (e.g. Halo Top)

## Instructions

1. Scoop into a bowl so you don''t eat the whole pint.
2. Enjoy.

## Nutrition

- **Calories:** 170
- **Protein:** 10 g
',ARRAY['easy','no-cook','grab-and-go','dessert','low-calorie','quick']::text[],now(),170,10,1,1),
('Overnight Protein Oats','Breakfast','Published','everyone','## Ingredients

- 40 g quick oats
- 1 scoop protein powder
- 150 ml unsweetened almond milk
- 100 g 0% Greek yogurt
- 50 g berries

## Instructions

1. Mix everything except the berries in a jar.
2. Cover and put it in the fridge overnight.
3. Top with berries in the morning.

## Nutrition

- **Calories:** 380
- **Protein:** 38 g

## Tip

Make 3–4 jars on Sunday for the week.
',ARRAY['easy','no-cook','breakfast','high-protein','quick']::text[],now(),380,38,5,1),
('Greek Yogurt Protein Bowl','Breakfast','Published','everyone','## Ingredients

- 250 g 0% Greek yogurt
- 1/2 scoop protein powder
- 50 g berries
- Zero-calorie sweetener

## Instructions

1. Stir the protein powder and sweetener into the yogurt.
2. Top with berries.

## Nutrition

- **Calories:** 260
- **Protein:** 38 g
',ARRAY['easy','no-cook','breakfast','high-protein','low-calorie','quick']::text[],now(),260,38,3,1),
('Greek Yogurt Ranch Veggie Dip','Snack','Published','everyone','## Ingredients

- 200 g 0% Greek yogurt
- 1 tsp ranch seasoning
- Baby carrots, cucumber, peppers

## Instructions

1. Stir the ranch seasoning into the yogurt.
2. Dip the veggies.

## Nutrition

- **Calories:** 180
- **Protein:** 22 g
',ARRAY['easy','no-cook','snack','high-protein','low-calorie','quick']::text[],now(),180,22,5,1),
('Chicken Caesar Wrap','Lunch','Published','everyone','## Ingredients

- 100 g pre-cooked chicken strips
- 1 low-calorie tortilla
- 1 handful romaine lettuce
- 1 tbsp light Caesar dressing

## Instructions

1. Lay the chicken and lettuce on the tortilla.
2. Drizzle with dressing.
3. Roll it up.

## Nutrition

- **Calories:** 300
- **Protein:** 30 g
',ARRAY['easy','no-cook','lunch','high-protein','low-calorie','quick']::text[],now(),300,30,5,1),
('Smoked Salmon Rice Cakes','Snack','Published','everyone','## Ingredients

- 2 rice cakes
- 2 tbsp light cream cheese
- 60 g smoked salmon

## Instructions

1. Spread cream cheese on the rice cakes.
2. Top with smoked salmon.

## Nutrition

- **Calories:** 230
- **Protein:** 16 g
',ARRAY['easy','no-cook','snack','low-calorie','quick']::text[],now(),230,16,3,1),
('Frozen Yogurt Bark','Dessert','Published','everyone','## Ingredients

- 250 g 0% Greek yogurt
- Zero-calorie sweetener
- 50 g berries

## Instructions

1. Mix the sweetener into the yogurt.
2. Spread it thin on a parchment-lined tray and add the berries.
3. Freeze 2 hours, then break into pieces.

## Nutrition

- **Calories:** 220
- **Protein:** 25 g
',ARRAY['easy','no-cook','dessert','high-protein','low-calorie','quick']::text[],now(),220,25,5,1),
('Microwave Egg Mug','Breakfast','Published','everyone','## Ingredients

- 150 g liquid egg whites
- 1 whole egg
- 1 handful spinach
- 1 light cheese slice

## Instructions

1. Spray a mug, add the eggs and spinach, and stir.
2. Microwave 60 seconds, stir, then 30–45 seconds more.
3. Top with the cheese.

## Nutrition

- **Calories:** 190
- **Protein:** 27 g
',ARRAY['easy','microwave','breakfast','high-protein','low-calorie','quick']::text[],now(),190,27,3,1),
('Protein Mug Cake','Dessert','Published','everyone','## Ingredients

- 1 scoop protein powder
- 1 egg white
- 1 tbsp cocoa powder
- 1/2 tsp baking powder
- 2 tbsp milk

## Instructions

1. Mix everything in a sprayed mug.
2. Microwave 60–75 seconds.

## Nutrition

- **Calories:** 190
- **Protein:** 27 g

## Tip

Add sugar-free syrup on top.
',ARRAY['easy','microwave','dessert','high-protein','low-calorie','quick']::text[],now(),190,27,3,1),
('Microwave Chicken & Rice Bowl','Lunch','Published','everyone','## Ingredients

- 1 microwave rice cup
- 120 g pre-cooked chicken strips
- 1 bag steam-in-bag vegetables
- 1 tbsp light teriyaki sauce

## Instructions

1. Microwave the rice and veggies following the packages.
2. Warm the chicken 60 seconds.
3. Add everything to a bowl and top with sauce.

## Nutrition

- **Calories:** 480
- **Protein:** 42 g
',ARRAY['easy','microwave','lunch','high-protein','quick']::text[],now(),480,42,5,1),
('Microwave Sweet Potato + Cottage Cheese','Lunch','Published','everyone','## Ingredients

- 1 medium sweet potato
- 150 g 1% cottage cheese
- Salt, pepper, green onion

## Instructions

1. Poke the potato with a fork a few times.
2. Microwave 5–6 minutes until soft.
3. Split it open and top with cottage cheese.

## Nutrition

- **Calories:** 270
- **Protein:** 20 g
',ARRAY['easy','microwave','lunch','high-protein','low-calorie','quick']::text[],now(),270,20,7,1),
('Protein Oatmeal','Breakfast','Published','everyone','## Ingredients

- 40 g quick oats
- 200 ml water
- 1 scoop protein powder
- 50 g berries

## Instructions

1. Microwave the oats and water for 90 seconds.
2. Let it cool 1 minute, then stir in the protein powder.
3. Top with berries.

## Nutrition

- **Calories:** 330
- **Protein:** 30 g

## Tip

Stir the protein in after cooking so it doesn''t clump.
',ARRAY['easy','microwave','breakfast','high-protein','low-calorie','quick']::text[],now(),330,30,3,1),
('Turkey Meatballs & Marinara','Dinner','Published','everyone','## Ingredients

- 8 frozen turkey meatballs
- 1/2 cup marinara sauce
- 1 bag steam-in-bag vegetables

## Instructions

1. Microwave the meatballs with the sauce, covered, 2–3 minutes.
2. Microwave the veggies following the package.
3. Serve together.

## Nutrition

- **Calories:** 400
- **Protein:** 30 g
',ARRAY['easy','microwave','dinner','high-protein','quick']::text[],now(),400,30,5,1),
('Microwave Edamame','Snack','Published','everyone','## Ingredients

- 150 g frozen shelled edamame
- Pinch of salt

## Instructions

1. Microwave covered for 3 minutes.
2. Salt and eat.

## Nutrition

- **Calories:** 180
- **Protein:** 17 g
',ARRAY['easy','microwave','snack','low-calorie','quick']::text[],now(),180,17,4,1),
('Air Fryer Chicken Breast','Dinner','Published','everyone','## Ingredients

- 200 g chicken breast
- Cooking spray
- Your favourite seasoning

## Instructions

1. Spray and season the chicken.
2. Air fry at 200°C (390°F) for 18–20 minutes, flipping halfway.
3. Rest 2 minutes, then slice.

## Nutrition

- **Calories:** 330
- **Protein:** 62 g

## Tip

Make 3–4 at once for easy lunches.
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie']::text[],now(),330,62,20,1),
('Air Fryer Salmon','Dinner','Published','everyone','## Ingredients

- 150 g salmon fillet
- Lemon pepper seasoning
- Cooking spray

## Instructions

1. Spray and season the salmon.
2. Air fry at 200°C (390°F) for 8–10 minutes.

## Nutrition

- **Calories:** 310
- **Protein:** 31 g
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie']::text[],now(),310,31,12,1),
('Air Fryer Cajun Shrimp','Dinner','Published','everyone','## Ingredients

- 200 g raw peeled shrimp (thawed)
- 1 tsp Cajun seasoning
- Cooking spray

## Instructions

1. Pat the shrimp dry, spray and season.
2. Air fry at 200°C (390°F) for 6–8 minutes.

## Nutrition

- **Calories:** 200
- **Protein:** 40 g
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie','quick']::text[],now(),200,40,10,1),
('Air Fryer Turkey Burger','Dinner','Published','everyone','## Ingredients

- 1 frozen lean turkey burger patty
- 1 light burger bun
- Lettuce, mustard, pickles

## Instructions

1. Air fry the frozen patty at 190°C (375°F) for 12–14 minutes, flipping halfway.
2. Build your burger.

## Nutrition

- **Calories:** 290
- **Protein:** 26 g
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie']::text[],now(),290,26,15,1),
('Air Fryer Potatoes','Dinner','Published','everyone','## Ingredients

- 250 g baby potatoes, halved
- 1 tsp olive oil
- Salt and garlic powder

## Instructions

1. Toss the potatoes with oil and seasoning.
2. Air fry at 200°C (390°F) for 18–20 minutes, shaking halfway.

## Nutrition

- **Calories:** 230
- **Protein:** 5 g

## Tip

An easy carb side for any protein.
',ARRAY['easy','air-fryer','dinner','low-calorie']::text[],now(),230,5,20,1),
('Air Fryer Tofu Bites','Dinner','Published','everyone','## Ingredients

- 200 g extra-firm tofu, cubed
- 1 tbsp soy sauce
- 1 tsp cornstarch

## Instructions

1. Toss the tofu with soy sauce, then cornstarch.
2. Air fry at 200°C (390°F) for 15 minutes, shaking halfway.

## Nutrition

- **Calories:** 300
- **Protein:** 32 g
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie']::text[],now(),300,32,15,1),
('Air Fryer Pork Chop','Dinner','Published','everyone','## Ingredients

- 170 g boneless pork loin chop
- Steak or BBQ seasoning
- Cooking spray

## Instructions

1. Spray and season the pork.
2. Air fry at 200°C (390°F) for 12 minutes, flipping halfway.

## Nutrition

- **Calories:** 280
- **Protein:** 40 g
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie']::text[],now(),280,40,14,1),
('Air Fryer Steak Bites','Dinner','Published','everyone','## Ingredients

- 200 g sirloin steak, cubed
- Montreal steak spice
- Cooking spray

## Instructions

1. Spray and season the steak cubes.
2. Air fry at 200°C (390°F) for 7–9 minutes, shaking halfway.

## Nutrition

- **Calories:** 360
- **Protein:** 50 g
',ARRAY['easy','air-fryer','dinner','high-protein','quick']::text[],now(),360,50,10,1),
('Air Fryer Crispy Veggies','Dinner','Published','everyone','## Ingredients

- 300 g frozen broccoli or mixed veggies
- Cooking spray
- Garlic salt

## Instructions

1. Spray and season the frozen veggies (no need to thaw).
2. Air fry at 200°C (390°F) for 12 minutes, shaking halfway.

## Nutrition

- **Calories:** 120
- **Protein:** 8 g
',ARRAY['easy','air-fryer','dinner','low-calorie']::text[],now(),120,8,12,1),
('Air Fryer Pizza Wrap','Dinner','Published','everyone','## Ingredients

- 1 low-calorie tortilla
- 2 tbsp pizza sauce
- 40 g light mozzarella
- 30 g turkey pepperoni

## Instructions

1. Top the tortilla with sauce, cheese and pepperoni.
2. Air fry at 190°C (375°F) for 5 minutes.

## Nutrition

- **Calories:** 280
- **Protein:** 24 g
',ARRAY['easy','air-fryer','dinner','high-protein','low-calorie','quick']::text[],now(),280,24,8,1),
('5-Minute Scrambled Eggs & Toast','Breakfast','Published','everyone','## Ingredients

- 2 whole eggs
- 150 g liquid egg whites
- 1 slice whole-grain toast
- Cooking spray

## Instructions

1. Spray a pan on medium heat.
2. Add the eggs and egg whites and stir until set (2–3 minutes).
3. Serve with toast.

## Nutrition

- **Calories:** 330
- **Protein:** 34 g
',ARRAY['easy','pan','breakfast','high-protein','low-calorie','quick']::text[],now(),330,34,5,1),
('Egg White Omelette','Breakfast','Published','everyone','## Ingredients

- 250 ml liquid egg whites
- 1 handful spinach
- 30 g light feta
- Cooking spray

## Instructions

1. Spray a pan on medium heat and pour in the egg whites.
2. Add spinach and feta once it starts to set.
3. Fold in half and cook 1 more minute.

## Nutrition

- **Calories:** 190
- **Protein:** 31 g
',ARRAY['easy','pan','breakfast','high-protein','low-calorie','quick']::text[],now(),190,31,6,1),
('Protein Pancakes','Breakfast','Published','everyone','## Ingredients

- 50 g protein pancake mix (e.g. Kodiak)
- 100 g liquid egg whites
- Sugar-free syrup

## Instructions

1. Mix the pancake mix and egg whites.
2. Cook on a sprayed pan, about 1–2 minutes per side.
3. Top with sugar-free syrup.

## Nutrition

- **Calories:** 240
- **Protein:** 25 g
',ARRAY['easy','pan','breakfast','high-protein','low-calorie','quick']::text[],now(),240,25,8,1),
('Turkey Taco Rice Bowl','Dinner','Published','everyone','## Ingredients

- 150 g extra-lean ground turkey
- 1 tbsp taco seasoning
- 1 microwave rice cup
- 3 tbsp salsa

## Instructions

1. Brown the turkey in a pan for 6–8 minutes.
2. Stir in the taco seasoning and a splash of water.
3. Serve over the microwaved rice with salsa.

## Nutrition

- **Calories:** 520
- **Protein:** 40 g
',ARRAY['easy','pan','dinner','high-protein','quick']::text[],now(),520,40,10,1),
('Chicken Stir-Fry (Frozen Veg)','Dinner','Published','everyone','## Ingredients

- 150 g chicken breast strips
- 300 g frozen stir-fry vegetables
- 2 tbsp light teriyaki sauce

## Instructions

1. Cook the chicken in a sprayed pan for 5–6 minutes.
2. Add the frozen veggies and cook 5 minutes.
3. Stir in the sauce.

## Nutrition

- **Calories:** 330
- **Protein:** 38 g
',ARRAY['easy','pan','dinner','high-protein','low-calorie']::text[],now(),330,38,12,1),
('Turkey Sausage & Egg Wrap','Breakfast','Published','everyone','## Ingredients

- 2 pre-cooked turkey sausages
- 1 egg + 100 g liquid egg whites
- 1 low-calorie tortilla

## Instructions

1. Brown the sausages in a pan for 4 minutes.
2. Scramble the eggs in the same pan.
3. Wrap it all in the tortilla.

## Nutrition

- **Calories:** 360
- **Protein:** 32 g
',ARRAY['easy','pan','breakfast','high-protein','quick']::text[],now(),360,32,8,1)
) as v(title, category, status, access_scope, body, tags, published_at, calories_per_serving, protein_grams, prep_time_minutes, servings)
where not exists (select 1 from public.recipes r where lower(r.title) = lower(v.title));

-- Remove the internal test recipe from the client cookbook.
update public.recipes set status = 'Archived', access_scope = 'hidden' where title = 'Test hidden' and body = 'test';
