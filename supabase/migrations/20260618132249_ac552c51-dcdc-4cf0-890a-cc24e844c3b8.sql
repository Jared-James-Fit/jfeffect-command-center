ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS calories_per_serving integer,
  ADD COLUMN IF NOT EXISTS protein_grams integer,
  ADD COLUMN IF NOT EXISTS prep_time_minutes integer,
  ADD COLUMN IF NOT EXISTS servings integer;