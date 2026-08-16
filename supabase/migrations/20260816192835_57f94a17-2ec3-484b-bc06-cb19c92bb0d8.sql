ALTER TABLE public.coaching_applications
  ADD COLUMN IF NOT EXISTS source_label text,
  ADD COLUMN IF NOT EXISTS form_name text,
  ADD COLUMN IF NOT EXISTS page_path text,
  ADD COLUMN IF NOT EXISTS referrer text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS page_url text,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS coaching_applications_is_test_idx
  ON public.coaching_applications (is_test);

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS used_on_path text,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;