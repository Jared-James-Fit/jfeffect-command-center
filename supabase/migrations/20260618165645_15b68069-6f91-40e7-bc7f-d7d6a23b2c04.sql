UPDATE recipes SET calories_per_serving = sub.cal::int FROM (SELECT id, (regexp_match(body, '(?i)\*?\*?Calories\*?\*?\s*[:\-]\s*\*?\*?\s*([0-9]+)'))[1] AS cal FROM recipes) sub WHERE recipes.id = sub.id AND recipes.calories_per_serving IS NULL AND sub.cal IS NOT NULL;

UPDATE recipes SET protein_grams = sub.prot::int FROM (SELECT id, (regexp_match(body, '(?i)\*?\*?Protein\*?\*?\s*[:\-]\s*\*?\*?\s*([0-9]+)'))[1] AS prot FROM recipes) sub WHERE recipes.id = sub.id AND recipes.protein_grams IS NULL AND sub.prot IS NOT NULL;

UPDATE recipes SET servings = 1 WHERE servings IS NULL;

UPDATE recipes SET prep_time_minutes = GREATEST(10, LEAST(45, 5 + 5 * sub.steps)) FROM (SELECT id, GREATEST(1, (SELECT count(*) FROM regexp_matches(body, '(?m)^\s*\d+[.)]\s+', 'g'))) AS steps FROM recipes) sub WHERE recipes.id = sub.id AND recipes.prep_time_minutes IS NULL;