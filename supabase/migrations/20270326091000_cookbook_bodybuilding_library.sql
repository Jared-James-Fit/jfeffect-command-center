-- The JF Effect Cookbook, simplified (Nov 15 2026). GENERATED from
-- src/lib/cookbook (library.ts, sql.ts): edit those and run
-- `npx tsx scripts/cookbook/write-migration.ts`, never this file.
--
-- 159 published recipes became 32 simple, high-protein ones (most 10 minutes
-- or less hands-on, a few everyday ingredients, numbers worked out from the
-- ingredients, a cutting and a bulking line on each). 31 of them rewrite an
-- older recipe in place (same id: its views stay), 1 is new, and the other
-- 128 are archived, never deleted. Every audited row is backed up first.
-- Each step only touches a recipe still exactly as audited (md5 of its
-- body), so running this twice, or after the coach edits one, changes
-- nothing it shouldn't.

-- 1. Backup (closed to the app: RLS on, no policies).
CREATE TABLE IF NOT EXISTS public.recipes_cookbook_backup_20261115 (LIKE public.recipes);
ALTER TABLE public.recipes_cookbook_backup_20261115 ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.recipes_cookbook_backup_20261115 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipes_cookbook_backup_20261115 FROM anon, authenticated;
INSERT INTO public.recipes_cookbook_backup_20261115
SELECT r.*, now() FROM public.recipes r
WHERE r.id IN ('008bc5a5-b4eb-4e81-b87a-3d6009aa97a7',
  '031c3243-596c-45d2-a977-c8bdccd293cc',
  '04aaeecc-f136-4f50-ae06-efdd7b267dfb',
  '0550faa5-21b0-4bfa-ae16-861aeee818a2',
  '081c6f73-75a9-4400-8bf8-27d5586dd3bd',
  '0873f212-5dcd-45ec-9d44-7eb64e494ce2',
  '0a4c213f-d876-4b19-9b8c-09791a7bdef3',
  '0b4ff92e-30b4-4460-9848-e0b69d33e246',
  '0ba0d150-7303-46d2-afef-91f02ce98faa',
  '0c7ea908-a6b5-4bbd-b4a6-daad03ffd916',
  '0f3eed0c-4fb2-468a-ba29-fd4598826a6f',
  '1165cfb2-f956-409e-8dee-c20650c7be04',
  '11961034-3a27-4019-b501-2af95c9f2214',
  '1371fe07-ecbc-4111-9f1b-eba0072bcef8',
  '148b80f1-8b7a-494e-8835-be4484eecc5f',
  '15b05cee-6a18-4a71-9869-eaf322d5041b',
  '16cfc185-89b4-450c-a701-149c74b4dd81',
  '1b80352f-3eda-4d80-8a9d-e4d90d53b89a',
  '1d8d3e71-f53f-47a0-a7f5-a7677eb765cb',
  '1debde07-d0b7-4496-8cfd-efb3f1f61503',
  '220fd4e5-794f-4bbc-bf05-d3b198e5dfc3',
  '22e28f3a-163e-40ec-98cc-0840864d3e6c',
  '23db7831-f859-42c9-8a0a-33abb58e78f7',
  '27d29ad4-0fa3-45b9-99a5-a40e7f0ef003',
  '28545388-19cb-46b3-b588-29ec3913e4ec',
  '297a2f43-c200-4bab-aef8-e5ef66174f6b',
  '29917dec-8d30-40e5-ae56-128ae2a9df13',
  '2b6e39e8-22da-46c0-a96e-1d7b19e5eb57',
  '2ecf4797-caa5-4d70-8e9a-68d9a1298d1c',
  '2ee9c0a0-d844-4f74-b923-2ce963dbd4b3',
  '305fb238-b69f-46ee-9bc9-12b15140417c',
  '32024f3a-0d97-4ed2-aa60-bc8cf82952ad',
  '32b60ae9-e833-41a9-82e3-9014d08975a9',
  '354fd23d-ceb6-4f10-8d42-ad963681291d',
  '38812365-7f93-425f-ba13-f8549078c7a0',
  '39249d9b-035a-4bf3-954b-578fd8b21da0',
  '395e6cf0-748e-4dca-9160-fd8f8076487f',
  '3b9e6029-2ef1-402f-87c3-c24dae3296f0',
  '3c8bfb70-f0b8-4b57-b3b1-ac11a69ccb55',
  '3e0d6f6b-04f5-4261-a5e6-6a09bc9231d5',
  '3eb848c5-44ed-4f84-9935-7e2332e370aa',
  '4032b974-6f0f-44ee-ab0b-4bb033c9b5d2',
  '4073e091-800a-48b2-8bc6-fc92fc674839',
  '4163e126-b5c2-41a0-97ac-de2e514886a6',
  '416eb4ab-b0cf-4e7f-8283-dfe44e07917f',
  '4271bcae-6e5e-40ad-8a0c-cbe1a4f37e96',
  '428a9cb6-8030-4412-9d0c-95c4fdc91923',
  '43c9ee7d-b286-4432-af12-137e30fa2db2',
  '4487a430-46e2-4364-93c5-1a579d4ef95c',
  '44b1437b-3ade-4ea7-9f51-7ea821e37983',
  '44bf1c83-11b9-45d6-9a41-64a52dad2db5',
  '44f1415d-68d5-49f5-b289-f495734a4a12',
  '4511a42b-9bba-4a29-a9e4-6ca155c3c32d',
  '45546ae6-4668-4ec3-8847-8dcc47c29c4a',
  '4a2c0bdf-fe71-4ae3-8b42-b19d55fa8272',
  '4e9b3ea3-76dd-49a0-80ab-8ccaef69c7f3',
  '4f795426-5275-4fb4-9ade-9d557a6d45e7',
  '4ff0ab3d-9fcb-4162-ba6d-2b90ec3e45da',
  '5469a019-234d-4606-bfdf-40616034eefc',
  '56133463-3d15-4e15-bad2-5d726b746d3d',
  '574b0479-5623-4ead-b72b-e61afe983a6e',
  '58027472-a4d4-4b84-b894-97524c04a70a',
  '58a94fcf-5cb1-4dae-b992-f9092eed02c5',
  '58e43f6d-1d9f-4554-a8c0-11690aae262a',
  '5c5216c7-e69f-437a-b064-6be7c17ae713',
  '5d6d58b8-4575-4924-9299-d0db2acfbce5',
  '5eba342d-a421-47fe-b4a0-4b6a8ee6f1d3',
  '6114d7aa-a686-4fc1-be10-596876cd2868',
  '661b6c9f-368d-451c-8949-fc2ff26ddc6b',
  '6794c6df-2d23-4775-8656-7b88c3150c33',
  '6835f5de-b838-49a6-8dee-32888dfd2798',
  '689ca031-ebb0-4a50-bcf1-cabf1af5c846',
  '6ba67802-041c-4c05-b525-e1801e233c3b',
  '6f4cc07f-b072-424b-8640-e8c70b593ffb',
  '70080480-593a-4531-a92c-299dd8d0e0a2',
  '7128cb7a-9b76-4be0-8b7b-13984848e970',
  '71b81611-05ea-4ed6-8e45-7623e31faaa5',
  '723c1fca-2e77-47c3-a0d6-98d13d83261c',
  '72881d65-2759-480c-abcc-2c8f5fab3eeb',
  '740c563a-eda8-4e66-8b2c-35fef757a811',
  '74993cf3-d596-4563-9303-c5275d28ed80',
  '75324894-eff8-449e-897c-8c3e35e13bcc',
  '76b5a165-95b5-4778-b79b-13053238d2f3',
  '7a97f0f2-f4c5-4025-ab46-67f944a76899',
  '80dd9975-c934-41aa-a21b-b9f838bdc97f',
  '81108217-51e3-42c1-bd3b-42a484396357',
  '814cd8cc-185b-4a3e-90eb-76a6d3c61967',
  '81760778-2759-47fc-8472-bacd764976ac',
  '81fbcab4-5e7b-4d20-a398-f9887a372450',
  '851d7f8b-1d6a-47ac-a28b-6159ab90138b',
  '86e1ca01-328a-477a-8cbb-cc8e3709c6ce',
  '88ca2210-735a-4c7a-9906-ad2d144a82a9',
  '8bd32424-b2b1-4f37-ae3c-0ed2a305a94f',
  '8c74102e-b3cb-46f2-8226-4a99f6198a05',
  '8fb30b7c-907d-4406-9664-891059aa5973',
  '90899bb0-9ead-4d6e-a4a1-83ff8589e0a7',
  '90b70741-78af-4b7f-ac54-d514ea55d9c4',
  '90f36501-5e0a-4633-9bb2-ff102dca034a',
  '9209b22e-9a2f-43b9-9e21-0e8eb87fe644',
  '9389dc99-7453-492e-8cc6-c273d66d847f',
  '98cb9791-df11-4b3b-8077-9aae8720a5d9',
  '9940c024-d0fe-4c8b-a033-288d8cbfb0fb',
  '9e967687-bff3-40c7-a8b2-0e9243355daf',
  'a1cbd913-99fe-4116-9454-c086ae6616b7',
  'a2dddd86-baca-4620-86cd-0950248186d3',
  'a67c4c48-e0a4-48d0-9119-19ee04530db6',
  'a81078ed-5187-4eee-934d-cc2a438321cc',
  'a8b1cea4-c038-45a6-95d6-0a485544b5f3',
  'a96a9f8b-aa21-4ef0-99d7-38ce0eeade93',
  'aa3a38bb-8c90-4772-9b35-96917a7e6ee7',
  'ad66e347-b4b2-4748-ba64-fcff5d27cc9a',
  'aec5b9ea-5bd7-47d3-9f41-1e85858bba59',
  'af31bf35-354f-4de9-9f1a-725e0a009bd8',
  'b084c64a-ef7b-4d6e-82a2-5fd862637e70',
  'b0fd4971-2879-4e4a-aed0-b6b02d10d703',
  'b11718d7-4ae6-4119-a314-3378964b9e92',
  'b2a3cb7a-6164-4fe8-af69-59d575875a60',
  'b3730ae8-2f8f-4087-921c-68734c9002b5',
  'b5255ec0-18bd-41a0-ba09-ba3e6f4c0ba8',
  'b8bde3ee-64d9-4b00-ba34-c7810a975b18',
  'bde7ece2-33e6-4390-9f0c-5637a18c0979',
  'bf0ab9a7-5ea0-4245-a30e-db06b8992b4f',
  'c16a96ba-d156-4880-9b2f-b9375774b189',
  'c29022d2-793d-43de-bcf6-29c72680368d',
  'c2b11f4e-9e7a-490c-a00c-08a74a4c5839',
  'c2cf79a8-172f-4b12-a658-ed170ee29f61',
  'c7e3f83b-cd29-478a-ab13-2759dfe579f9',
  'c80ef913-8281-413c-a166-ae4815a63850',
  'c8c19bb3-8246-4801-ace6-e443d3d359fe',
  'ca1d5e07-32ef-462b-b18e-2fe90fc29758',
  'ca61c23e-aa78-4b5f-abd2-b41b3bfb9b28',
  'cc22cbd4-882c-4a64-8e79-bdd28963405a',
  'cc59a759-af84-4794-8d3e-61661562d73c',
  'cc8525af-d1db-4807-98a5-8308dda30dd0',
  'ccc38ddb-c4be-4742-a04f-0b1d39869d1d',
  'd018af10-a435-4af5-83fe-44c3e5011292',
  'd22956c2-5ccb-4c86-b9b3-1182ce108413',
  'd243bc74-dd58-460b-972e-221aef98662c',
  'd384c38a-7bf2-4a5a-b39c-623336d70ee1',
  'd398ba07-7e07-43a7-80b7-40197545d854',
  'd55374f4-6987-4ccf-ab31-b109122e69b3',
  'd5a0a5e2-a0d5-402c-af8c-8daf23bda12b',
  'd860c51f-152f-4ff7-b68a-db118a0f2b2c',
  'd9677220-1c96-4341-aab0-79617bb93d20',
  'dc98082c-2638-415d-b5f6-918a7cfd2db3',
  'dda80a40-18b7-42e4-a314-a3c0ce83b8ee',
  'e0b00693-0768-46dc-8e28-770dd064040c',
  'e1f45443-3ce7-4306-824a-4f8e2f16aac9',
  'e2b0e4b5-fb71-44d6-a500-344ffcec3904',
  'e6ddf9b1-1c68-446c-8cb5-2b6705982f07',
  'ea701331-2768-4ba4-abe2-5e7cc4ec410d',
  'ed151dae-d64d-47f6-98f0-d77079806e1a',
  'ef44af4f-cdc2-4709-96f4-14c91728a757',
  'f036b2eb-66aa-4346-ad72-1cd6be7fa7bd',
  'f1ed3023-c5a9-4314-b7ac-4cf883456aba',
  'f4682590-0a7f-4f75-8dd3-92a648586dd1',
  'f4e77b25-b69d-4cb5-97bf-4c976f6baddb',
  'f582daa2-d1db-40dc-9868-4ab7d30ae7e8',
  'f709a6fe-2e3a-4701-841f-1c242f502579')
  AND NOT EXISTS (SELECT 1 FROM public.recipes_cookbook_backup_20261115 b WHERE b.id = r.id);

-- 2. The recipes the cookbook keeps, rewritten in place.
UPDATE public.recipes SET
  title = $cb$Protein Oats$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 4 min

## Ingredients

- 50 g (½ cup) rolled oats
- 250 ml (1 cup) water
- 1 scoop (30 g) whey protein
- 75 g (½ cup) frozen berries

## Instructions

1. Microwave the oats and water in a big bowl for 2 minutes.
2. Let it sit 1 minute, then stir in the protein powder. Adding it before cooking makes it rubbery.
3. Top with the berries.

## Nutrition

- Calories: 347 kcal
- Protein: 31 g
- Carbs: 46 g
- Fat: 5 g

## Notes

- Cutting: Use 40 g oats and add an extra splash of water. Still 30 g of protein.
- Bulking: Cook the oats in 1% milk instead of water and stir in 1 tbsp peanut butter (+200 kcal).
- Tip: Too thick once the protein is in? Add water a spoon at a time.
$cb$,
  tags = ARRAY['jf-cookbook', 'microwave', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 347,
  protein_grams = 31,
  prep_time_minutes = 4,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '220fd4e5-794f-4bbc-bf05-d3b198e5dfc3' AND md5(body) = '3aca11ac699c6134dbbbd19a7139f9f6';

UPDATE public.recipes SET
  title = $cb$Overnight Protein Oats$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min
Cook Time: Overnight in the fridge

## Ingredients

- 50 g (½ cup) rolled oats
- 170 g (¾ cup) plain 0% Greek yogurt
- 120 ml (½ cup) 1% milk
- ½ scoop (15 g) whey protein
- 75 g (½ cup) berries

## Instructions

1. Stir the oats, yogurt, milk and protein powder together in a jar or container.
2. Top with the berries, close it and refrigerate overnight (at least 4 hours).
3. Eat it cold, or microwave it for a minute.

## Nutrition

- Calories: 438 kcal
- Protein: 41 g
- Carbs: 56 g
- Fat: 6 g

## Notes

- Cutting: Use 30 g oats and water instead of milk (about 310 kcal).
- Bulking: Add 1 tbsp peanut butter and a sliced banana (+200 kcal).
- Tip: Make 3 or 4 jars at once: they keep 3 days in the fridge. Cheesecake version: vanilla protein, a spoon of sugar-free cheesecake pudding mix and strawberries.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 438,
  protein_grams = 41,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '86e1ca01-328a-477a-8cbb-cc8e3709c6ce' AND md5(body) = '1428a759458cdbc73fba9487b44e64bf';

UPDATE public.recipes SET
  title = $cb$Egg Scramble & Toast$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min

## Ingredients

- 2 large eggs
- 150 ml (⅔ cup) liquid egg whites
- 2 slices whole-wheat bread
- 2 tbsp salsa or hot sauce
- Salt, pepper and cooking spray

## Instructions

1. Spray a non-stick pan and heat it on medium.
2. Whisk the eggs and egg whites with salt and pepper, pour them in and stir slowly until just set, 2 to 3 minutes.
3. Toast the bread while the eggs cook, and top the eggs with salsa.

## Nutrition

- Calories: 408 kcal
- Protein: 38 g
- Carbs: 34 g
- Fat: 12 g

## Notes

- Cutting: Use 1 egg, 200 ml egg whites and 1 slice of toast (about 275 kcal).
- Bulking: Add a third egg and a third slice of toast (+160 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 408,
  protein_grams = 38,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'f036b2eb-66aa-4346-ad72-1cd6be7fa7bd' AND md5(body) = '1c5d5a2e895d944883aa049839788b28';

UPDATE public.recipes SET
  title = $cb$Greek Yogurt Protein Bowl$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 2 min

## Ingredients

- 250 g (1 cup) plain 0% Greek yogurt
- ½ scoop (15 g) vanilla whey protein
- 100 g (⅔ cup) berries
- 2 tsp honey

## Instructions

1. Stir the protein powder into the yogurt until smooth.
2. Top with the berries and honey.

## Nutrition

- Calories: 288 kcal
- Protein: 38 g
- Carbs: 31 g
- Fat: 2 g

## Notes

- Cutting: Eat it as it is. It's under 300 kcal with almost 40 g of protein.
- Bulking: Add 40 g granola and 1 tbsp peanut butter (+280 kcal).
- Tip: If the protein clumps, stir it into a splash of milk first.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 288,
  protein_grams = 38,
  prep_time_minutes = 2,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '395e6cf0-748e-4dca-9160-fd8f8076487f' AND md5(body) = 'b157c8ac08d80eab55a3aaa3fd0adb0e';

UPDATE public.recipes SET
  title = $cb$Breakfast Burrito$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 8 min

## Ingredients

- 1 large (10") flour tortilla
- 2 large eggs
- 100 ml (⅓ cup) liquid egg whites
- 30 g (¼ cup) shredded part-skim mozzarella
- 2 tbsp salsa

## Instructions

1. Scramble the eggs and egg whites in a sprayed pan on medium, 2 to 3 minutes.
2. Warm the tortilla in the microwave for 15 seconds.
3. Fill it with the eggs, cheese and salsa, fold in the sides and roll it up.
4. For a crisp outside, toast it seam-side down in the pan for a minute.

## Nutrition

- Calories: 495 kcal
- Protein: 37 g
- Carbs: 39 g
- Fat: 20 g

## Notes

- Cutting: Use a low-carb wrap and 1 egg with 150 ml egg whites (about 340 kcal).
- Bulking: Add 100 g cooked potatoes or hash browns inside (+100 to 150 kcal).
- Tip: Make 5 at once, wrap each in foil and freeze. Reheat from frozen out of the foil, about 2 minutes in the microwave, turning halfway.
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'bulking', 'vegetarian', 'quick']::text[],
  calories_per_serving = 495,
  protein_grams = 37,
  prep_time_minutes = 8,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'ca1d5e07-32ef-462b-b18e-2fe90fc29758' AND md5(body) = 'd9fc85dddc846d7398866b7d79c9655e';

UPDATE public.recipes SET
  title = $cb$Protein Pancakes$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 10 min

## Ingredients

- 40 g (½ cup) rolled oats
- 1 scoop (30 g) whey protein
- 1 large egg
- 100 ml (⅓ cup) liquid egg whites
- ½ banana
- ½ tsp baking powder

## Instructions

1. Blend everything for 20 seconds.
2. Heat a sprayed non-stick pan on medium-low.
3. Pour 3 or 4 small pancakes. Flip when bubbles form on top (about 2 minutes) and cook 1 minute more.
4. Top with berries or sugar-free syrup.

## Nutrition

- Calories: 449 kcal
- Protein: 47 g
- Carbs: 45 g
- Fat: 9 g

## Notes

- Cutting: Leave out the banana and use 30 g oats (about 360 kcal).
- Bulking: Top with 1 tbsp peanut butter and 1 tbsp maple syrup (+150 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 449,
  protein_grams = 47,
  prep_time_minutes = 10,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'aec5b9ea-5bd7-47d3-9f41-1e85858bba59' AND md5(body) = '4f6ec2d5af146b5dc26b5ec7dc9e4517';

UPDATE public.recipes SET
  title = $cb$Egg & Turkey Bagel$cb$,
  category = 'Breakfast',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 6 min

## Ingredients

- 1 plain bagel
- 2 large eggs
- 40 g sliced turkey breast
- 1 slice (20 g) cheddar

## Instructions

1. Toast the bagel.
2. Fry or scramble the eggs in a sprayed pan, 2 to 3 minutes.
3. Stack the eggs, turkey and cheese on the bagel: the hot eggs melt the cheese.

## Nutrition

- Calories: 508 kcal
- Protein: 34 g
- Carbs: 51 g
- Fat: 18 g

## Notes

- Cutting: Use an English muffin and 1 egg with 100 ml egg whites (about 380 kcal).
- Bulking: Add a third egg and a second slice of cheese (+150 kcal).
- Tip: Grab-and-go: make it the night before, wrap it, and microwave 45 seconds in the morning.
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 508,
  protein_grams = 34,
  prep_time_minutes = 6,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '98cb9791-df11-4b3b-8077-9aae8720a5d9' AND md5(body) = 'a507a9991950a42518f7321a93cc89b5';

UPDATE public.recipes SET
  title = $cb$Rotisserie Chicken & Rice Bowl$cb$,
  category = 'Lunch',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min

## Ingredients

- 150 g rotisserie chicken breast, skin off
- 1 microwave rice cup (about 150 g cooked rice)
- 1 bag steam-in-bag broccoli (about 150 g)
- Hot sauce, soy sauce or seasoning

## Instructions

1. Microwave the rice and the broccoli following their packages.
2. Pull 150 g of breast meat off the chicken, skin off.
3. Put it all in a bowl and season it.

## Nutrition

- Calories: 494 kcal
- Protein: 55 g
- Carbs: 52 g
- Fat: 6 g

## Notes

- Cutting: Use 75 g rice (half the cup) and double the broccoli (about 450 kcal).
- Bulking: Use 250 g rice and add 1 tbsp olive oil or ¼ avocado (+250 kcal).
- Tip: One rotisserie chicken is 2 or 3 of these. Pull all the breast meat when you get home and it's ready for 3 days.
$cb$,
  tags = ARRAY['jf-cookbook', 'microwave', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 494,
  protein_grams = 55,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '008bc5a5-b4eb-4e81-b87a-3d6009aa97a7' AND md5(body) = '83f7bb6370afa6387c1db4502b9c3c33';

UPDATE public.recipes SET
  title = $cb$Air Fryer Chicken Breast$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min
Cook Time: 18 min hands-off

## Ingredients

- 200 g raw boneless, skinless chicken breast
- 1 tsp olive oil
- Salt, pepper, garlic powder and paprika

## Instructions

1. Pat the chicken dry. If one end is much thicker, slice it in half lengthwise so it cooks evenly.
2. Rub it with the oil and season both sides.
3. Air fry at 200°C (400°F) for 16 to 20 minutes, flipping halfway, until the thickest part reads 74°C (165°F).
4. Rest it 3 minutes before slicing.

## Nutrition

- Calories: 284 kcal
- Protein: 45 g
- Carbs: 0 g
- Fat: 10 g

## Notes

- Cutting: Use cooking spray instead of oil (about 240 kcal).
- Bulking: Serve it with 200 g cooked rice or a potato (+260 kcal).
- Tip: Cook 3 or 4 at once in a single layer for the week. A meat thermometer is the cheapest way to never eat dry chicken again.
$cb$,
  tags = ARRAY['jf-cookbook', 'air-fryer', 'high-protein', 'cutting', 'quick']::text[],
  calories_per_serving = 284,
  protein_grams = 45,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'c16a96ba-d156-4880-9b2f-b9375774b189' AND md5(body) = '7c63801580e9b26810c810def25d4ee3';

UPDATE public.recipes SET
  title = $cb$Air Fryer Salmon & Potatoes$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 8 min
Cook Time: 20 min hands-off

## Ingredients

- 150 g salmon fillet
- 250 g potatoes (about 2 small)
- 1 tsp olive oil
- Salt, garlic powder and a lemon wedge

## Instructions

1. Cut the potatoes into 2 cm cubes and toss them with the oil, salt and garlic powder.
2. Air fry at 200°C (400°F) for 10 minutes.
3. Shake the basket, add the seasoned salmon skin-side down and cook 8 to 10 minutes more, until it flakes easily and reaches 70°C (158°F).
4. Squeeze the lemon over it.

## Nutrition

- Calories: 554 kcal
- Protein: 36 g
- Carbs: 45 g
- Fat: 25 g

## Notes

- Cutting: Use 150 g potatoes and cooking spray instead of oil (about 430 kcal).
- Bulking: Use 400 g potatoes and 2 more tsp of oil (+210 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'air-fryer', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 554,
  protein_grams = 36,
  prep_time_minutes = 8,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'e1f45443-3ce7-4306-824a-4f8e2f16aac9' AND md5(body) = 'bd6f2ad9c78062c87196ace6a62b4c6e';

UPDATE public.recipes SET
  title = $cb$Taco Rice Bowl$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 10 min

## Ingredients

- 150 g extra-lean (93%) ground beef or turkey
- 1 microwave rice cup (about 150 g cooked rice)
- 75 g (⅓ cup) canned black beans, rinsed
- ¼ cup (50 g) salsa
- 1 tbsp taco seasoning

## Instructions

1. Brown the meat in a pan on medium-high, breaking it up, until no pink is left (5 to 6 minutes).
2. Stir in the taco seasoning with a splash of water and simmer 1 minute.
3. Microwave the rice and the beans.
4. Pile it all in a bowl and top with salsa.

## Nutrition

- Calories: 509 kcal
- Protein: 41 g
- Carbs: 58 g
- Fat: 11 g

## Notes

- Cutting: Swap the rice for lettuce or riced cauliflower (about 340 kcal).
- Bulking: Add 30 g shredded cheese and ¼ avocado (+200 kcal).
- Tip: Brown 600 g of meat at once and you have 4 bowls for the week.
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 509,
  protein_grams = 41,
  prep_time_minutes = 10,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '0c7ea908-a6b5-4bbd-b4a6-daad03ffd916' AND md5(body) = 'a0a2d97963ea4a717fbde20def820c40';

UPDATE public.recipes SET
  title = $cb$Chicken Stir-Fry$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 10 min

## Ingredients

- 150 g raw chicken breast, sliced thin
- 250 g frozen stir-fry vegetables
- 1 tbsp soy sauce
- 1 tsp oil
- 1 microwave rice cup (about 150 g cooked rice)
- Garlic powder and chili flakes

## Instructions

1. Heat the oil in a large pan on high.
2. Cook the chicken 4 to 5 minutes, until no pink is left.
3. Add the frozen vegetables and cook 3 to 4 minutes, stirring.
4. Stir in the soy sauce and seasoning and serve over the rice.

## Nutrition

- Calories: 515 kcal
- Protein: 44 g
- Carbs: 58 g
- Fat: 10 g

## Notes

- Cutting: Use half the rice (about 415 kcal), or skip it (about 320).
- Bulking: Use 250 g rice and add 2 tsp honey to the sauce (+170 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 515,
  protein_grams = 44,
  prep_time_minutes = 10,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '031c3243-596c-45d2-a977-c8bdccd293cc' AND md5(body) = '0805dae4cef0e5f7b742e5cfb52d02d2';

UPDATE public.recipes SET
  title = $cb$Beef Pasta Marinara$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 10 min

## Ingredients

- 75 g dry pasta
- 125 g extra-lean (93%) ground beef
- 150 g (⅔ cup) jarred marinara sauce
- 1 tbsp (10 g) grated parmesan

## Instructions

1. Boil the pasta in salted water following the package (about 10 minutes).
2. Meanwhile brown the beef in a pan, breaking it up, until no pink is left.
3. Add the marinara and simmer 2 minutes.
4. Drain the pasta, toss it with the sauce and top with parmesan.

## Nutrition

- Calories: 590 kcal
- Protein: 42 g
- Carbs: 69 g
- Fat: 15 g

## Notes

- Cutting: Use 50 g pasta and stir a handful of spinach into the sauce (about 500 kcal).
- Bulking: Use 125 g pasta (+185 kcal).
- Tip: Double everything and the second half is tomorrow's lunch.
$cb$,
  tags = ARRAY['jf-cookbook', 'stovetop', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 590,
  protein_grams = 42,
  prep_time_minutes = 10,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '44bf1c83-11b9-45d6-9a41-64a52dad2db5' AND md5(body) = '50a590e9bcc6a6b83f139fac7d0eb6a8';

UPDATE public.recipes SET
  title = $cb$Chicken Caesar Wrap$cb$,
  category = 'Lunch',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min

## Ingredients

- 120 g cooked chicken breast
- 1 large (10") flour tortilla
- 1 cup (30 g) chopped romaine
- 1 tbsp (20 g) light Caesar dressing
- 1 tbsp (10 g) grated parmesan

## Instructions

1. Slice the chicken and chop the lettuce.
2. Toss them with the dressing.
3. Fill the tortilla, sprinkle the parmesan, fold in the sides and roll it up.

## Nutrition

- Calories: 504 kcal
- Protein: 47 g
- Carbs: 38 g
- Fat: 17 g

## Notes

- Cutting: Use a low-carb wrap (about 390 kcal).
- Bulking: Have it with an apple and a glass of 1% milk (+200 kcal).
- Tip: Leftover Air Fryer Chicken Breast or rotisserie chicken both work.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 504,
  protein_grams = 47,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '16cfc185-89b4-450c-a701-149c74b4dd81' AND md5(body) = '57174febd8238b6617756777b2faf7a3';

UPDATE public.recipes SET
  title = $cb$Spicy Tuna Sushi Bowl$cb$,
  category = 'Lunch',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min

## Ingredients

- 1 can (120 g drained) light tuna in water
- 1 microwave rice cup (about 150 g cooked rice)
- 1 tbsp light mayo
- ½ cucumber, sliced
- 2 tsp soy sauce
- Sriracha to taste

## Instructions

1. Microwave the rice.
2. Mix the drained tuna with the mayo and sriracha.
3. Top the rice with the tuna and cucumber and drizzle the soy sauce over it.

## Nutrition

- Calories: 386 kcal
- Protein: 36 g
- Carbs: 46 g
- Fat: 5 g

## Notes

- Cutting: Use 100 g rice (about 320 kcal).
- Bulking: Use 250 g rice and add ½ avocado (+250 kcal).
- Tip: Crushed seaweed snacks or sesame seeds on top make it taste like the real thing.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'quick']::text[],
  calories_per_serving = 386,
  protein_grams = 36,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '4f795426-5275-4fb4-9ade-9d557a6d45e7' AND md5(body) = '81a220b5d4d60907911ba676f7196c63';

UPDATE public.recipes SET
  title = $cb$Hot Honey Chicken & Sweet Potato$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 8 min
Cook Time: 22 min hands-off

## Ingredients

- 150 g raw chicken breast, cubed
- 250 g sweet potato, cubed (1 medium)
- 1 tbsp honey
- 1 tsp olive oil
- Salt, garlic powder, chili flakes or hot sauce

## Instructions

1. Toss the sweet potato with the oil and salt and air fry at 200°C (400°F) for 10 minutes.
2. Season the chicken, add it to the basket and cook 10 to 12 minutes more, shaking once, until the chicken reaches 74°C (165°F).
3. Warm the honey for 10 seconds with chili flakes or a splash of hot sauce and toss everything in it.

## Nutrition

- Calories: 485 kcal
- Protein: 38 g
- Carbs: 63 g
- Fat: 9 g

## Notes

- Cutting: Use 150 g sweet potato and 2 tsp honey (about 380 kcal).
- Bulking: Use 400 g sweet potato and 200 g chicken (+190 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'air-fryer', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 485,
  protein_grams = 38,
  prep_time_minutes = 8,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '4271bcae-6e5e-40ad-8a0c-cbe1a4f37e96' AND md5(body) = '46e64d4e7c92188793d6ee5aa0594bff';

UPDATE public.recipes SET
  title = $cb$Steak Bites & Potatoes$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 8 min
Cook Time: 20 min hands-off

## Ingredients

- 175 g sirloin steak
- 250 g potatoes (about 2 small)
- 1 tsp olive oil
- Salt, pepper and garlic powder

## Instructions

1. Cube the potatoes, toss them with half the oil and salt, and air fry at 200°C (400°F) for 12 minutes.
2. Cut the steak into 2 to 3 cm cubes and toss with the rest of the oil and the seasoning.
3. Add the steak to the basket and cook 6 to 8 minutes, shaking once, until done the way you like it (63°C / 145°F is medium-rare).

## Nutrition

- Calories: 492 kcal
- Protein: 44 g
- Carbs: 45 g
- Fat: 15 g

## Notes

- Cutting: Use 150 g potatoes and add a side of green beans (about 440 kcal).
- Bulking: Use 400 g potatoes and 225 g steak (+190 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'air-fryer', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 492,
  protein_grams = 44,
  prep_time_minutes = 8,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '71b81611-05ea-4ed6-8e45-7623e31faaa5' AND md5(body) = '6e0afc589b58115ea89d78596be97553';

UPDATE public.recipes SET
  title = $cb$Cajun Shrimp Rice Bowl$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 10 min

## Ingredients

- 200 g raw peeled shrimp (thawed)
- 200 g cooked rice (a large microwave cup)
- 150 g frozen mixed vegetables
- 1 tsp oil
- 2 tsp Cajun seasoning

## Instructions

1. Pat the shrimp dry and toss with the oil and Cajun seasoning.
2. Cook in a hot pan for about 2 minutes a side, until pink and curled.
3. Microwave the rice and the vegetables.
4. Serve the shrimp over them.

## Nutrition

- Calories: 527 kcal
- Protein: 49 g
- Carbs: 65 g
- Fat: 7 g

## Notes

- Cutting: Use 100 g rice (about 400 kcal).
- Bulking: Use 300 g rice and add ¼ avocado (+210 kcal).
- Tip: Frozen shrimp thaws in 5 minutes under cold running water.
$cb$,
  tags = ARRAY['jf-cookbook', 'pan', 'high-protein', 'bulking', 'quick']::text[],
  calories_per_serving = 527,
  protein_grams = 49,
  prep_time_minutes = 10,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '851d7f8b-1d6a-47ac-a28b-6159ab90138b' AND md5(body) = 'c144f6ebd2e06e209fd6990952ac7263';

UPDATE public.recipes SET
  title = $cb$Crispy Tofu Rice Bowl$cb$,
  category = 'Dinner',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 8 min
Cook Time: 15 min hands-off

## Ingredients

- 200 g extra-firm tofu
- 1 tbsp soy sauce
- 1 tbsp cornstarch
- 1 microwave rice cup (about 150 g cooked rice)
- 1 bag steam-in-bag broccoli (about 150 g)

## Instructions

1. Press the tofu between paper towels for a few minutes, then cut it into cubes.
2. Toss the cubes with the soy sauce, then with the cornstarch.
3. Air fry at 200°C (400°F) for 12 to 15 minutes, shaking halfway, until crisp.
4. Serve over the rice and broccoli.

## Nutrition

- Calories: 580 kcal
- Protein: 44 g
- Carbs: 68 g
- Fat: 19 g

## Notes

- Cutting: Use 75 g rice (about 480 kcal).
- Bulking: Use 250 g rice and drizzle 1 tbsp peanut butter thinned with soy sauce (+225 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'air-fryer', 'high-protein', 'bulking', 'vegetarian', 'quick']::text[],
  calories_per_serving = 580,
  protein_grams = 44,
  prep_time_minutes = 8,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '29917dec-8d30-40e5-ae56-128ae2a9df13' AND md5(body) = '7ff9e620757518f281e853a04a4406e3';

UPDATE public.recipes SET
  title = $cb$Cottage Cheese & Pineapple$cb$,
  category = 'Snack',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 1 min

## Ingredients

- 200 g (¾ cup) 1% cottage cheese
- 100 g pineapple chunks

## Instructions

1. Spoon the cottage cheese into a bowl.
2. Top with the pineapple.

## Nutrition

- Calories: 194 kcal
- Protein: 25 g
- Carbs: 19 g
- Fat: 2 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Add 30 g granola or a small handful of almonds (+150 kcal).
- Tip: Canned pineapple in juice, drained, works too. Not a fan of the texture? Blend the cottage cheese smooth first.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 194,
  protein_grams = 25,
  prep_time_minutes = 1,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'e6ddf9b1-1c68-446c-8cb5-2b6705982f07' AND md5(body) = '6221ec31984950bf8d924712b195d2eb';

UPDATE public.recipes SET
  title = $cb$Greek Yogurt Ranch Dip & Veggies$cb$,
  category = 'Snack',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min

## Ingredients

- 170 g (¾ cup) plain 0% Greek yogurt
- 1 tsp dry ranch seasoning
- 200 g carrot, cucumber and pepper sticks

## Instructions

1. Stir the ranch seasoning into the yogurt.
2. Cut the vegetables into sticks and dip.

## Nutrition

- Calories: 175 kcal
- Protein: 20 g
- Carbs: 22 g
- Fat: 1 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Add a few whole-grain crackers or a pita (+150 kcal).
- Tip: Mix a big tub of the dip at the start of the week: it keeps 3 days in the fridge.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 175,
  protein_grams = 20,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '0873f212-5dcd-45ec-9d44-7eb64e494ce2' AND md5(body) = 'dc4942ebbbf834cd317c56fa56f04bf0';

UPDATE public.recipes SET
  title = $cb$Turkey Roll-Ups$cb$,
  category = 'Snack',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 3 min

## Ingredients

- 120 g sliced turkey breast
- 2 slices (40 g) part-skim mozzarella
- Mustard and pickle spears

## Instructions

1. Lay out the turkey slices.
2. Add the cheese, a little mustard and a pickle spear.
3. Roll them up.

## Nutrition

- Calories: 222 kcal
- Protein: 31 g
- Carbs: 5 g
- Fat: 8 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Roll everything in a tortilla, or add an apple and a handful of nuts (+250 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'quick']::text[],
  calories_per_serving = 222,
  protein_grams = 31,
  prep_time_minutes = 3,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '11961034-3a27-4019-b501-2af95c9f2214' AND md5(body) = '6f2bf82a5bab326dc473ea50b132bec8';

UPDATE public.recipes SET
  title = $cb$Tuna Rice Cakes$cb$,
  category = 'Snack',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 3 min

## Ingredients

- 1 can (120 g drained) light tuna in water
- 3 plain rice cakes
- 2 tsp light mayo
- Pepper and hot sauce

## Instructions

1. Mix the drained tuna with the mayo, pepper and hot sauce.
2. Spread it on the rice cakes.

## Nutrition

- Calories: 270 kcal
- Protein: 33 g
- Carbs: 23 g
- Fat: 4 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Use 5 rice cakes and add ¼ avocado (+150 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'quick']::text[],
  calories_per_serving = 270,
  protein_grams = 33,
  prep_time_minutes = 3,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '27d29ad4-0fa3-45b9-99a5-a40e7f0ef003' AND md5(body) = '09b8bb723d0f6ecc735f9f580103b185';

UPDATE public.recipes SET
  title = $cb$Chocolate Banana Protein Shake$cb$,
  category = 'Snack',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 2 min

## Ingredients

- 1 scoop (30 g) chocolate whey protein
- 300 ml (1¼ cups) 1% milk
- 1 medium banana (fresh or frozen)
- A handful of ice

## Instructions

1. Blend everything for 30 seconds.

## Nutrition

- Calories: 351 kcal
- Protein: 35 g
- Carbs: 45 g
- Fat: 5 g

## Notes

- Cutting: Use water instead of milk and half a banana (about 175 kcal).
- Bulking: Blend in 40 g oats and 1 tbsp peanut butter for a mass shake (+245 kcal).
- Tip: Freeze ripe bananas in chunks and the shake comes out thick like a milkshake.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 351,
  protein_grams = 35,
  prep_time_minutes = 2,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '23db7831-f859-42c9-8a0a-33abb58e78f7' AND md5(body) = '1d68f14f68fa9d8ade0167cd7797242e';

UPDATE public.recipes SET
  title = $cb$Microwave Edamame$cb$,
  category = 'Snack',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 4 min

## Ingredients

- 150 g frozen shelled edamame
- Salt and chili flakes

## Instructions

1. Microwave the edamame in a covered bowl for 3 to 4 minutes.
2. Season with salt and chili flakes.

## Nutrition

- Calories: 182 kcal
- Protein: 18 g
- Carbs: 13 g
- Fat: 8 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Have it with a bowl of rice and soy sauce for a meal (+200 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'microwave', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 182,
  protein_grams = 18,
  prep_time_minutes = 4,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '6114d7aa-a686-4fc1-be10-596876cd2868' AND md5(body) = '7e23bdd346d2af486d85acf283345cca';

UPDATE public.recipes SET
  title = $cb$Chocolate Protein Pudding$cb$,
  category = 'Dessert',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 3 min

## Ingredients

- 200 g (¾ cup) plain 0% Greek yogurt
- ½ scoop (15 g) chocolate whey protein
- 1 tbsp (5 g) cocoa powder
- Sweetener to taste

## Instructions

1. Stir the protein powder and cocoa into the yogurt until smooth.
2. Sweeten to taste. Chill 10 minutes for a thicker, mousse-like pudding.

## Nutrition

- Calories: 189 kcal
- Protein: 34 g
- Carbs: 12 g
- Fat: 2 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Top with 1 tbsp peanut butter and a sliced banana (+200 kcal).
- Tip: Vanilla protein and berries instead of cocoa makes a cheesecake-style bowl.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 189,
  protein_grams = 34,
  prep_time_minutes = 3,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '81108217-51e3-42c1-bd3b-42a484396357' AND md5(body) = '5c8235d2705c8cdb78d67b13cdf8f487';

UPDATE public.recipes SET
  title = $cb$Protein Mug Cake$cb$,
  category = 'Dessert',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 3 min

## Ingredients

- 1 scoop (30 g) chocolate or vanilla whey protein
- 20 g (¼ cup) oat flour (blended oats)
- 1 tbsp (5 g) cocoa powder
- 50 ml liquid egg whites
- 2 tbsp (30 ml) 1% milk
- ½ tsp baking powder

## Instructions

1. Mix the protein powder, oat flour, cocoa and baking powder in a large mug.
2. Stir in the egg whites and milk until smooth.
3. Microwave 60 to 75 seconds. It should still be a little soft in the middle: overcooked is rubbery.

## Nutrition

- Calories: 246 kcal
- Protein: 34 g
- Carbs: 21 g
- Fat: 4 g

## Notes

- Cutting: Eat it as it is.
- Bulking: Add 10 g chocolate chips and serve with a scoop of light ice cream (+150 kcal).
- Tip: No oat flour? Blend rolled oats for 10 seconds.
$cb$,
  tags = ARRAY['jf-cookbook', 'microwave', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 246,
  protein_grams = 34,
  prep_time_minutes = 3,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '74993cf3-d596-4563-9303-c5275d28ed80' AND md5(body) = '0c8e19a5c6c226dfd7541f03b11aed0f';

UPDATE public.recipes SET
  title = $cb$Cottage Cheese Cookie Dough$cb$,
  category = 'Dessert',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 1
Prep Time: 5 min

## Ingredients

- 200 g (¾ cup) 1% cottage cheese
- ½ scoop (15 g) vanilla whey protein
- 1 tbsp peanut butter
- 1 tbsp (10 g) chocolate chips
- Sweetener to taste

## Instructions

1. Blend the cottage cheese until completely smooth.
2. Stir in the protein powder, peanut butter and a little sweetener.
3. Fold in the chocolate chips. Chill 15 minutes for a firmer dough.

## Nutrition

- Calories: 342 kcal
- Protein: 41 g
- Carbs: 16 g
- Fat: 13 g

## Notes

- Cutting: Leave out the peanut butter (about 255 kcal).
- Bulking: Eat it with graham crackers or pretzels (+150 kcal).
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 342,
  protein_grams = 41,
  prep_time_minutes = 5,
  servings = 1,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '38812365-7f93-425f-ba13-f8549078c7a0' AND md5(body) = 'fcd829090c3ad7139146d9947ae5f4f7';

UPDATE public.recipes SET
  title = $cb$Frozen Yogurt Bark$cb$,
  category = 'Dessert',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 4
Prep Time: 5 min
Cook Time: 2 hours in the freezer

## Ingredients

- 500 g (2 cups) plain 0% Greek yogurt
- 1 scoop (30 g) vanilla whey protein
- 1 tbsp + 1 tsp honey
- 150 g (1 cup) berries
- 2 tbsp (20 g) chocolate chips

## Instructions

1. Stir the protein powder and honey into the yogurt.
2. Spread it about 1 cm thick on a tray lined with parchment paper.
3. Scatter the berries and chocolate chips on top.
4. Freeze 2 hours, then break it into pieces and keep them in a freezer bag.

## Nutrition

- Calories: 163 kcal
- Protein: 19 g
- Carbs: 17 g
- Fat: 2 g

## Notes

- Cutting: One serving is a quarter of the tray.
- Bulking: Have two servings.
$cb$,
  tags = ARRAY['jf-cookbook', 'no-cook', 'high-protein', 'cutting', 'vegetarian', 'quick']::text[],
  calories_per_serving = 163,
  protein_grams = 19,
  prep_time_minutes = 5,
  servings = 4,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '75324894-eff8-449e-897c-8c3e35e13bcc' AND md5(body) = '90647bb705d290ea096e3d46296c5bb8';

UPDATE public.recipes SET
  title = $cb$Chicken & Rice Meal Prep$cb$,
  category = 'Meal Prep',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 4
Prep Time: 15 min
Cook Time: 30 min hands-off

## Ingredients

- 800 g raw chicken breast
- 300 g (1½ cups) dry white rice
- 600 g frozen mixed vegetables
- 1 tbsp olive oil
- Salt, pepper, garlic powder and paprika

## Instructions

1. Start the rice in a rice cooker or pot following the package.
2. Heat the oven to 220°C (425°F). Toss the chicken with 2 tsp of the oil and the seasoning on a lined tray and bake 20 to 25 minutes, until the thickest piece reads 74°C (165°F).
3. Roast or steam the vegetables with the last of the oil while the chicken cooks.
4. Rest the chicken 5 minutes, slice it and split everything into 4 containers.

## Nutrition

- Calories: 599 kcal
- Protein: 53 g
- Carbs: 69 g
- Fat: 10 g

## Notes

- Cutting: Cook 200 g dry rice instead of 300 g (about 510 kcal a container).
- Bulking: Cook 450 g dry rice and add 1 tbsp more oil (+170 kcal a container).
- Tip: Cool the containers before they go in the fridge. Eat them within 3 days, or freeze some and thaw them overnight in the fridge.
$cb$,
  tags = ARRAY['jf-cookbook', 'oven', 'high-protein', 'bulking', 'meal-prep']::text[],
  calories_per_serving = 599,
  protein_grams = 53,
  prep_time_minutes = 15,
  servings = 4,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = '0550faa5-21b0-4bfa-ae16-861aeee818a2' AND md5(body) = 'aeaec42db96bcb5a30559b5414a42caa';

UPDATE public.recipes SET
  title = $cb$Egg White Muffins$cb$,
  category = 'Meal Prep',
  status = 'Published',
  access_scope = 'everyone',
  body = $cb$Servings: 4
Prep Time: 10 min
Cook Time: 22 min hands-off

## Ingredients

- 6 large eggs
- 500 ml (2 cups) liquid egg whites
- 150 g sliced turkey breast, chopped
- 150 g chopped peppers and spinach
- 60 g (½ cup) shredded part-skim mozzarella
- Salt and pepper

## Instructions

1. Heat the oven to 180°C (350°F) and grease a 12-cup muffin tin well (or use silicone cups).
2. Divide the turkey, vegetables and cheese between the cups.
3. Whisk the eggs and egg whites with salt and pepper and pour them in, filling each cup about ¾ full.
4. Bake 20 to 22 minutes, until set in the middle. Cool, then refrigerate.

## Nutrition

- Calories: 259 kcal
- Protein: 34 g
- Carbs: 5 g
- Fat: 10 g

## Notes

- Cutting: Three muffins as written.
- Bulking: Have three with a toasted bagel (+245 kcal).
- Tip: Makes 12 (3 a serving). Reheat 30 to 45 seconds in the microwave. They keep 3 days in the fridge or 2 months in the freezer.
$cb$,
  tags = ARRAY['jf-cookbook', 'oven', 'high-protein', 'cutting', 'meal-prep', 'quick']::text[],
  calories_per_serving = 259,
  protein_grams = 34,
  prep_time_minutes = 10,
  servings = 4,
  published_at = COALESCE(published_at, now()),
  updated_at = now()
WHERE id = 'f1ed3023-c5a9-4314-b7ac-4cf883456aba' AND md5(body) = '5bb68203ea880b2c43602d3f25409288';

-- 3. New recipes.
INSERT INTO public.recipes (id, title, category, status, access_scope, body, tags, calories_per_serving, protein_grams, prep_time_minutes, servings, published_at)
SELECT '5b0cd1ab-96ea-4fc9-84fe-7f1816a91610', $cb$Beef & Bean Chili$cb$, 'Meal Prep', 'Published', 'everyone', $cb$Servings: 6
Prep Time: 15 min
Cook Time: 25 min hands-off

## Ingredients

- 900 g extra-lean (93%) ground beef
- 2 cans (540 ml each) black or kidney beans, drained and rinsed
- 1 can (796 ml) diced tomatoes
- 1 cup (150 g) frozen diced onion
- 3 tbsp chili powder, 1 tbsp cumin, salt and pepper

## Instructions

1. Brown the beef with the onion in a large pot on medium-high, breaking it up, 8 to 10 minutes.
2. Stir in the chili powder, cumin, salt and pepper.
3. Add the tomatoes and the beans, bring it to a simmer and cook 20 minutes, stirring now and then.
4. Split it into 6 containers.

## Nutrition

- Calories: 337 kcal
- Protein: 38 g
- Carbs: 21 g
- Fat: 11 g

## Notes

- Cutting: A bowl as written is about 340 kcal.
- Bulking: Serve each bowl over 200 g cooked rice with 30 g shredded cheese (+380 kcal).
- Tip: Cool it in shallow containers before the fridge. It keeps 3 days in the fridge or 3 months in the freezer.
$cb$, ARRAY['jf-cookbook', 'stovetop', 'high-protein', 'cutting', 'meal-prep']::text[], 337, 38, 15, 6, now()
WHERE NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = '5b0cd1ab-96ea-4fc9-84fe-7f1816a91610');

-- 4. Everything else from the audit: archived (the coach can publish any again).
UPDATE public.recipes r SET status = 'Archived', updated_at = now()
FROM (VALUES
  ('04aaeecc-f136-4f50-ae06-efdd7b267dfb'::uuid, 'be2e630081bfb99782dbd7360aa8d3cc') -- Steak Poutine,
  ('081c6f73-75a9-4400-8bf8-27d5586dd3bd'::uuid, 'b6dba38c5d0ad8eafdff87e4b7f5551a') -- Tempeh Protein Pasta,
  ('0a4c213f-d876-4b19-9b8c-09791a7bdef3'::uuid, '58e0d651e5e41c9068c854979f188c91') -- Salmon Potato Power Bowl,
  ('0b4ff92e-30b4-4460-9848-e0b69d33e246'::uuid, '1102271ad51d27b87f70f34b736c4fba') -- Loaded Chicken Nachos,
  ('0ba0d150-7303-46d2-afef-91f02ce98faa'::uuid, '626bfff345a32d0c23ebf571eb6d8624') -- Tropical Coconut Cooler,
  ('0f3eed0c-4fb2-468a-ba29-fd4598826a6f'::uuid, 'dfd2dbc1c43b3aa71baae78995860c89') -- Cucumber Mint Cooler,
  ('1165cfb2-f956-409e-8dee-c20650c7be04'::uuid, '7924421cd578298a25d8ea7690f48074') -- Vegan Berry Protein Smoothie,
  ('1371fe07-ecbc-4111-9f1b-eba0072bcef8'::uuid, '8615aa871b4d0a44d9a68e6a5094d535') -- Air-Fried Cinnamon Apple,
  ('148b80f1-8b7a-494e-8835-be4484eecc5f'::uuid, '09c6d815d74d1f4b90feb760afadba01') -- Egg White Turkey Wrap,
  ('15b05cee-6a18-4a71-9869-eaf322d5041b'::uuid, '0d1e0173588eb2f3ea0b4555eede70a4') -- Cucumber Turkey Roll-Ups,
  ('1b80352f-3eda-4d80-8a9d-e4d90d53b89a'::uuid, '7cb90082a21ef802eac1b3ff552631c4') -- Protein Waffle Dessert,
  ('1d8d3e71-f53f-47a0-a7f5-a7677eb765cb'::uuid, '47928fc56916df9e7be437c89683f16f') -- Garlic Butter Salmon,
  ('1debde07-d0b7-4496-8cfd-efb3f1f61503'::uuid, 'f5b369548a63202793ded6c318bd4324') -- Light Ice Cream Sandwich,
  ('22e28f3a-163e-40ec-98cc-0840864d3e6c'::uuid, 'b15b2e56fe0ec18936f3c729f0a9d5de') -- Tofu Breakfast Scramble,
  ('28545388-19cb-46b3-b588-29ec3913e4ec'::uuid, 'e3d103aef937d9bb72ad7b1363ef5530') -- Cottage Cheese Egg White Scramble,
  ('297a2f43-c200-4bab-aef8-e5ef66174f6b'::uuid, '9a4e68821919e5f421b8ec34cdcf3039') -- Loaded Breakfast Pancake Stack,
  ('2b6e39e8-22da-46c0-a96e-1d7b19e5eb57'::uuid, '83d9c628a059c22b9cdd892fa1a4c43d') -- Strawberry Cheesecake Overnight Oats,
  ('2ecf4797-caa5-4d70-8e9a-68d9a1298d1c'::uuid, 'fececde7416e3e61f3056ee5c96c57e0') -- High-Protein Vegetable Soup,
  ('2ee9c0a0-d844-4f74-b923-2ce963dbd4b3'::uuid, '0ee433946c6bd918ac972cdb4e42a015') -- Vegan Chocolate Protein Shake,
  ('305fb238-b69f-46ee-9bc9-12b15140417c'::uuid, '11f2be77e9103b472b6c7bb8f1de3e46') -- Diet Root Beer Float,
  ('32024f3a-0d97-4ed2-aa60-bc8cf82952ad'::uuid, 'c9c1038df83edadf976ba7df118bfd5f') -- Peanut Butter Mocha Shake,
  ('32b60ae9-e833-41a9-82e3-9014d08975a9'::uuid, 'f01576b678736fcad6be38a8f86aad8c') -- Air Fryer Crispy Veggies,
  ('354fd23d-ceb6-4f10-8d42-ad963681291d'::uuid, '4bf8b6f45c95fb29e48ac777d9451814') -- Pickle Ranch Cottage Cheese Snack Box,
  ('39249d9b-035a-4bf3-954b-578fd8b21da0'::uuid, '1749e3c6a9e81bd4310f91dda497faef') -- Greek Yogurt Berry Crunch,
  ('3b9e6029-2ef1-402f-87c3-c24dae3296f0'::uuid, '1993867fd0608939e9a3efb5685ad75a') -- Silken Tofu Chocolate Pudding,
  ('3c8bfb70-f0b8-4b57-b3b1-ac11a69ccb55'::uuid, '4ac9e5afcffcc5a3fd733202d1afc5ba') -- High-Protein Yogurt + Berries,
  ('3e0d6f6b-04f5-4261-a5e6-6a09bc9231d5'::uuid, '30f663e53c5eb0ad3c48ba64dae26c2d') -- Air Fryer Pork Chop,
  ('3eb848c5-44ed-4f84-9935-7e2332e370aa'::uuid, '755938c0cc306038ef9afd5a6ec351b6') -- Microwave Egg Mug,
  ('4032b974-6f0f-44ee-ab0b-4bb033c9b5d2'::uuid, '6bd2dfb3e3b197372cf258a56a54abee') -- Vegan Protein Smoothie,
  ('4073e091-800a-48b2-8bc6-fc92fc674839'::uuid, '0ca1ba51ed50cb3f28b38c804e11f6e5') -- Apple + String Cheese,
  ('4163e126-b5c2-41a0-97ac-de2e514886a6'::uuid, '80ce85248deac04b3dea012cfc813cde') -- Strawberry Basil Lemonade,
  ('416eb4ab-b0cf-4e7f-8283-dfe44e07917f'::uuid, 'e4ce8f232412ee8cccc555e56b5a307e') -- Peach Ginger Smash,
  ('428a9cb6-8030-4412-9d0c-95c4fdc91923'::uuid, '03de673aa7fca331e713362dc2e42438') -- Halloumi and Fried Eggs,
  ('43c9ee7d-b286-4432-af12-137e30fa2db2'::uuid, '057c45d7b9c0c3df136095711f23996a') -- Orange Creamsicle Protein Shake,
  ('4487a430-46e2-4364-93c5-1a579d4ef95c'::uuid, '791a39d5c4b8ea531084cfee94832c40') -- Air Fryer Potatoes,
  ('44b1437b-3ade-4ea7-9f51-7ea821e37983'::uuid, '41941dc9e627f92230c0484e7edd16b3') -- Tofu Vegetable Stir-Fry,
  ('44f1415d-68d5-49f5-b289-f495734a4a12'::uuid, '87f3a765cedbde39e4ea15fefb717802') -- Cherry Cola Fizz,
  ('4511a42b-9bba-4a29-a9e4-6ca155c3c32d'::uuid, 'b3017282b1190805dbfafab26bf2534b') -- Buffalo Chicken Lettuce Cups,
  ('45546ae6-4668-4ec3-8847-8dcc47c29c4a'::uuid, '4239f97f62d9ca638c2b83e6cb2d44da') -- Turkey Meatballs & Marinara,
  ('4a2c0bdf-fe71-4ae3-8b42-b19d55fa8272'::uuid, '0bba8ad2df9cf0a818b39f204f423706') -- Beef Jerky + Cheese Stick,
  ('4e9b3ea3-76dd-49a0-80ab-8ccaef69c7f3'::uuid, '352bcca3b68c0b8fad85f1c9489811d9') -- Protein Root Beer Float,
  ('4ff0ab3d-9fcb-4162-ba6d-2b90ec3e45da'::uuid, '0b2772be995c34e25ba177450b5e3e77') -- Peanut Butter Protein Overnight Oats,
  ('5469a019-234d-4606-bfdf-40616034eefc'::uuid, '62064ff4363f164a2fa1c3fbac2b53ad') -- Coconut Tofu Curry,
  ('56133463-3d15-4e15-bad2-5d726b746d3d'::uuid, 'e605c190b0367919caaabbae2daba80c') -- Peanut Butter Granola Parfait,
  ('574b0479-5623-4ead-b72b-e61afe983a6e'::uuid, 'dbe0f2a639c1c85a56310fa429ad202a') -- Berry Lemon Fizz,
  ('58027472-a4d4-4b84-b894-97524c04a70a'::uuid, '0401313b8d4c84f6786f24472b1c7890') -- Peach Greek Yogurt Smoothie,
  ('58a94fcf-5cb1-4dae-b992-f9092eed02c5'::uuid, 'c396d2d9b278cb365cdfbcb027fe59ec') -- Lime Soda Cooler,
  ('58e43f6d-1d9f-4554-a8c0-11690aae262a'::uuid, '7f7610f9fb2a741c825ac8e1ea7757eb') -- Chocolate Greek Yogurt Mousse,
  ('5c5216c7-e69f-437a-b064-6be7c17ae713'::uuid, '8ca07a97a58cabc188c730c965e57889') -- BBQ Chicken Bacon Quesadilla,
  ('5d6d58b8-4575-4924-9299-d0db2acfbce5'::uuid, 'ea9f163fc53db5f4310d24f3c7080ed0') -- Chicken Bacon Ranch Bowl,
  ('5eba342d-a421-47fe-b4a0-4b6a8ee6f1d3'::uuid, '54c57a79d4bd17d09db49e7f9d36541b') -- Seitan Avocado Bowl,
  ('661b6c9f-368d-451c-8949-fc2ff26ddc6b'::uuid, 'a870e8bcea2fbb3810c14d17ebfc59ff') -- Light Ice Cream Bowl,
  ('6794c6df-2d23-4775-8656-7b88c3150c33'::uuid, 'e1c752f129b9b6f7363a47e8ed35387d') -- Vegan Peanut Butter Tofu Mousse,
  ('6835f5de-b838-49a6-8dee-32888dfd2798'::uuid, '6f95ecc53976f5464590c72063eb7c2d') -- Vegan Diet Soda Float,
  ('689ca031-ebb0-4a50-bcf1-cabf1af5c846'::uuid, '19cd2e2ff4d8ea115bea7511da4bc81a') -- Cottage Cheese Pizza Bowl,
  ('6ba67802-041c-4c05-b525-e1801e233c3b'::uuid, '77b88532d97ce2a26ebee82ff10b7a94') -- TVP Taco Bowl,
  ('6f4cc07f-b072-424b-8640-e8c70b593ffb'::uuid, '00556317ca6b64c43fc1758b6b32a065') -- Cottage Cheese Chocolate Pudding,
  ('70080480-593a-4531-a92c-299dd8d0e0a2'::uuid, 'e9b28733c86a15dcc1b7d8f23a3198d9') -- Paneer Rice Bowl,
  ('7128cb7a-9b76-4be0-8b7b-13984848e970'::uuid, '5425c1838a2a5cbc2d98d171e54f79a7') -- Orange Creamsicle Spritz,
  ('723c1fca-2e77-47c3-a0d6-98d13d83261c'::uuid, 'c163eafd87d46aa024baf72296a01e35') -- Vegan Jelly and Coconut Whip,
  ('72881d65-2759-480c-abcc-2c8f5fab3eeb'::uuid, '5b65fd3e3da96ed45db2a314c3e3ebac') -- Egg Salad Lettuce Wraps,
  ('740c563a-eda8-4e66-8b2c-35fef757a811'::uuid, '2dcad60b89214925ca60fcc41f284a51') -- Chocolate Protein Milk,
  ('76b5a165-95b5-4778-b79b-13053238d2f3'::uuid, '2298c0490b026faf64afda66794a8f70') -- Frozen Protein Yogurt Bites,
  ('7a97f0f2-f4c5-4025-ab46-67f944a76899'::uuid, 'c10cf1456b4c360cbb1a3c4dff59b541') -- Strawberry Cheesecake Protein Shake,
  ('80dd9975-c934-41aa-a21b-b9f838bdc97f'::uuid, 'ba4f3326ecf8d3f15db5926519f7111f') -- Vegetarian Protein Yogurt Bowl,
  ('814cd8cc-185b-4a3e-90eb-76a6d3c61967'::uuid, '23b46d315cf27df4ccc8a94c225a3f07') -- Warm Protein Bar Brownie,
  ('81760778-2759-47fc-8472-bacd764976ac'::uuid, '06a129075e01f7a627cd0dacb8c7ec93') -- Greek Yogurt Fruit Dip,
  ('81fbcab4-5e7b-4d20-a398-f9887a372450'::uuid, '5699c45266c791bd41e520be8c19c5b4') -- Buffalo Chicken Pizza,
  ('88ca2210-735a-4c7a-9906-ad2d144a82a9'::uuid, '4c4712275231e329cc1552669f292eef') -- Turkey Sausage & Egg Wrap,
  ('8bd32424-b2b1-4f37-ae3c-0ed2a305a94f'::uuid, '42b844526163aa4e94f904f36f391264') -- Cinnamon Apple Protein Bowl,
  ('8c74102e-b3cb-46f2-8226-4a99f6198a05'::uuid, '613a1564bd39a5f0b3b3996773835b1d') -- Vegan Keto Protein Shake,
  ('8fb30b7c-907d-4406-9664-891059aa5973'::uuid, 'b247a79c63da67e9dea5b6db517a61bc') -- Cottage Cheese Egg Bowl,
  ('90899bb0-9ead-4d6e-a4a1-83ff8589e0a7'::uuid, 'c0c552be388f3328fc6c015d91626694') -- Peanut Butter Banana Protein Oats,
  ('90b70741-78af-4b7f-ac54-d514ea55d9c4'::uuid, '18f671c1076a116f3a2ab6ecdc5fa0dd') -- Zero-Sugar Jello Bowl,
  ('90f36501-5e0a-4633-9bb2-ff102dca034a'::uuid, 'b2479b2298cd3d968ca2770dcdf98917') -- Egg White Pizza Bites,
  ('9209b22e-9a2f-43b9-9e21-0e8eb87fe644'::uuid, '279c5e5ecf153a89c9b743344f00a455') -- Chickpea Pesto Pasta,
  ('9389dc99-7453-492e-8cc6-c273d66d847f'::uuid, '63fd33cf4880f3009b74fbf33a608220') -- Lupini Tofu Salad,
  ('9940c024-d0fe-4c8b-a033-288d8cbfb0fb'::uuid, '0c709eebcdf0f020313bb53b18d5ba82') -- Creamy Chicken Alfredo Pasta,
  ('9e967687-bff3-40c7-a8b2-0e9243355daf'::uuid, '09e6a3b43a847e7dc595c89a5d0a2683') -- Microwave Chicken & Rice Bowl,
  ('a1cbd913-99fe-4116-9454-c086ae6616b7'::uuid, '6bc1a9cc96f207859c1ab2b1cf8d9204') -- Protein Pudding Cup,
  ('a2dddd86-baca-4620-86cd-0950248186d3'::uuid, 'd6b68c2a8f8cde6ea46d18a8927ffdee') -- Strawberry Cheesecake Bowl,
  ('a67c4c48-e0a4-48d0-9119-19ee04530db6'::uuid, 'bafe71c8e3b0331676d81dd9416aca82') -- Air Fryer Turkey Burger,
  ('a81078ed-5187-4eee-934d-cc2a438321cc'::uuid, '1f9a7c5a12ac0d59561197fea84f2b68') -- Air Fryer Pizza Wrap,
  ('a8b1cea4-c038-45a6-95d6-0a485544b5f3'::uuid, '8ad2278fcca35c6eab887c37c5669108') -- Protein Bar + Apple,
  ('a96a9f8b-aa21-4ef0-99d7-38ce0eeade93'::uuid, '5d7f4ca2da95547b6cae60759cbaeb8f') -- Turkey Cheese Roll-Ups,
  ('aa3a38bb-8c90-4772-9b35-96917a7e6ee7'::uuid, '38cb5262088ab14e745d7a987e6b6d2b') -- Vegan Berry Protein Nice Cream,
  ('ad66e347-b4b2-4748-ba64-fcff5d27cc9a'::uuid, '009c0e294d016b6360623e0af1323c46') -- Cheese-Crust Pizza,
  ('af31bf35-354f-4de9-9f1a-725e0a009bd8'::uuid, '4d3c3dff2ff3a765255594b447290425') -- Hard Gainer Peanut Butter Banana Mass Shake,
  ('b084c64a-ef7b-4d6e-82a2-5fd862637e70'::uuid, 'f024dda409e0e54ac05e43c551c57c79') -- Vegan Chocolate Chia Pudding,
  ('b0fd4971-2879-4e4a-aed0-b6b02d10d703'::uuid, 'a018b929fc2c764c2ab9c6d65b246b77') -- Microwave Sweet Potato + Cottage Cheese,
  ('b11718d7-4ae6-4119-a314-3378964b9e92'::uuid, '397a52352791785542deb28911d51e98') -- Vanilla Protein Iced Coffee,
  ('b2a3cb7a-6164-4fe8-af69-59d575875a60'::uuid, 'fa50cd0aa4ed698da066712aef6f7dce') -- Chocolate Protein Rice Cakes,
  ('b3730ae8-2f8f-4087-921c-68734c9002b5'::uuid, '84283a28dbe3f59e7d2306eb4db0a40e') -- Tofu Peanut Rice Bowl,
  ('b5255ec0-18bd-41a0-ba09-ba3e6f4c0ba8'::uuid, '42ed94c3805cd60805920f8f19b85a5e') -- Loaded Beef Burrito,
  ('b8bde3ee-64d9-4b00-ba34-c7810a975b18'::uuid, 'd598c4e33782297327199000ddc86ef4') -- Cheesy Egg Omelette,
  ('bde7ece2-33e6-4390-9f0c-5637a18c0979'::uuid, '8bfc11ba254c4d06dbed3592252e11f3') -- Sugar-Free Jell-O Cup + Whip,
  ('bf0ab9a7-5ea0-4245-a30e-db06b8992b4f'::uuid, '3e83f6f67cd16657ea57cf70d6636318') -- Raspberry Mint Mock Mojito,
  ('c29022d2-793d-43de-bcf6-29c72680368d'::uuid, '359eb1e128fa381b0e1ab6035fb52907') -- Steak and Eggs,
  ('c2b11f4e-9e7a-490c-a00c-08a74a4c5839'::uuid, 'c565d904c44914bd80e776eac92ea02a') -- Crispy Chicken Sandwich,
  ('c2cf79a8-172f-4b12-a658-ed170ee29f61'::uuid, '122d2ea1cb91f8b2e98f23ab02ddd260') -- Edamame Snack Bowl,
  ('c7e3f83b-cd29-478a-ab13-2759dfe579f9'::uuid, 'c0f38137d3511d551505390884fa4541') -- Vegetarian Taco Salad,
  ('c80ef913-8281-413c-a166-ae4815a63850'::uuid, '34e5ce7d6dc056800a453d6ad9ce2c49') -- High-Protein Smash Burger and Fries,
  ('c8c19bb3-8246-4801-ace6-e443d3d359fe'::uuid, '09d3a0adf16093413d45c10de84cba0c') -- Hard-Boiled Eggs + Orange,
  ('ca61c23e-aa78-4b5f-abd2-b41b3bfb9b28'::uuid, 'ba9cdb8feb3fc29db887740605af861b') -- Hard Gainer Chicken Pesto Pasta,
  ('cc22cbd4-882c-4a64-8e79-bdd28963405a'::uuid, '180b191870450871d30b845b57ff4b7f') -- Pineapple Jalapeño Sparkler,
  ('cc59a759-af84-4794-8d3e-61661562d73c'::uuid, '820ab1beab11d7490260c709dd7882ce') -- Protein Rice Cake Sundae,
  ('cc8525af-d1db-4807-98a5-8308dda30dd0'::uuid, 'b1f8d689e3c5433680fef20464e20e06') -- Egg White Omelette,
  ('ccc38ddb-c4be-4742-a04f-0b1d39869d1d'::uuid, 'dfa1a7881288cb203f2479d749b55640') -- Cottage Cheese Cucumber Bowl,
  ('d018af10-a435-4af5-83fe-44c3e5011292'::uuid, 'e68240749120ed4bb989c3da80802179') -- Low-Calorie Electrolyte Slush,
  ('d22956c2-5ccb-4c86-b9b3-1182ce108413'::uuid, 'ac6c6783517ce9fa6c173ba13ed1937e') -- Smoked Salmon Rice Cakes,
  ('d243bc74-dd58-460b-972e-221aef98662c'::uuid, '0492be85a0661cf675b6296a02ee2f6e') -- Tofu Mushroom Skillet,
  ('d384c38a-7bf2-4a5a-b39c-623336d70ee1'::uuid, '0b3bce410e57dd61eb031c5f3908d66c') -- Warm Berry Dessert,
  ('d398ba07-7e07-43a7-80b7-40197545d854'::uuid, '673d18b1660bb83d69851b06f849c898') -- Loaded Cottage Cheese Potato,
  ('d55374f4-6987-4ccf-ab31-b109122e69b3'::uuid, 'ec1665beb94842eb4db0ba128bb43bed') -- Seitan Salad Bowl,
  ('d5a0a5e2-a0d5-402c-af8c-8daf23bda12b'::uuid, '63789815e9ad8a458bb6f1f98fbf580e') -- Protein Shake + Banana,
  ('d860c51f-152f-4ff7-b68a-db118a0f2b2c'::uuid, '5c3216de8a23eba4d08b41bf55d3e20b') -- Tuna Cucumber Boats,
  ('d9677220-1c96-4341-aab0-79617bb93d20'::uuid, 'e015ec024ffda3b55cf97fe0550fe03e') -- Chocolate Strawberry Protein Bark,
  ('dc98082c-2638-415d-b5f6-918a7cfd2db3'::uuid, 'bd90fc28a77354c66fd27dad46f2a31e') -- Greek Yogurt Cheesecake Bowl,
  ('dda80a40-18b7-42e4-a314-a3c0ce83b8ee'::uuid, 'c95d33c62f438f7edbfedc98cd190597') -- BBQ Chicken Mac and Cheese,
  ('e0b00693-0768-46dc-8e28-770dd064040c'::uuid, '6b8acb8c726cbfba155e5ff55d5a6987') -- Tempeh Peanut Noodles,
  ('e2b0e4b5-fb71-44d6-a500-344ffcec3904'::uuid, '16054f7bfd8f44ba6001d7b0e7042c7a') -- Egg White Bites + Yogurt,
  ('ea701331-2768-4ba4-abe2-5e7cc4ec410d'::uuid, 'bd83612f60b346c270c57d2d5a81b1ef') -- Turkey Zucchini Skillet,
  ('ed151dae-d64d-47f6-98f0-d77079806e1a'::uuid, 'ff6e27433553d8fc3822759670ee882d') -- Tuna Pickle Cups,
  ('ef44af4f-cdc2-4709-96f4-14c91728a757'::uuid, '9a5359d7bec60c1d8474a8ce071c1c25') -- Sugar-Free Popsicle Protein Snack,
  ('f4682590-0a7f-4f75-8dd3-92a648586dd1'::uuid, '38680f3c2394aced866e61a9718d4726') -- High-Protein Cereal Bowl,
  ('f4e77b25-b69d-4cb5-97bf-4c976f6baddb'::uuid, 'e899d24e484f7d785a1e17835bb6a96d') -- Frozen Banana Protein Bites,
  ('f582daa2-d1db-40dc-9868-4ab7d30ae7e8'::uuid, '664831a065d5b4a9a2d5776fabe59b53') -- Chicken Taco Bowl,
  ('f709a6fe-2e3a-4701-841f-1c242f502579'::uuid, '421199ef35b1399a25961592968478af') -- Loaded Vegan Burrito Bowl
) AS a(id, body_md5)
WHERE r.id = a.id AND r.status = 'Published' AND md5(r.body) = a.body_md5;
