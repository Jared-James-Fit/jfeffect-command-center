ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
UPDATE public.profiles p SET phone = c.phone
  FROM public.coaches c
 WHERE c.user_id = p.id AND c.phone IS NOT NULL AND (p.phone IS NULL OR p.phone = '');