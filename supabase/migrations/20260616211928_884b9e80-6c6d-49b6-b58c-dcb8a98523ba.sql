ALTER TABLE public.app_members 
  ADD COLUMN IF NOT EXISTS dietary_preferences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS food_restrictions text[] NOT NULL DEFAULT '{}';