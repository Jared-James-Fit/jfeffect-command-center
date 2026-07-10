
-- 1. Add subtitle column
ALTER TABLE public.pl_days ADD COLUMN IF NOT EXISTS subtitle text;

-- 2. Review log for backfill decisions (service_role only)
CREATE TABLE IF NOT EXISTS public.pl_days_title_migration_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  day_id uuid NOT NULL,
  original_title text,
  action text NOT NULL, -- 'cleared' | 'split' | 'skipped_ambiguous'
  extracted_subtitle text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pl_days_title_migration_log TO service_role;
ALTER TABLE public.pl_days_title_migration_log ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon: this is service-role-only audit data.

-- 3. Backfill
DO $$
DECLARE
  r record;
  t text;
  original text;
  weekday_re text := '(?i)\y(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\y\.?';
  month_re   text := '(?i)\y(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\y\.?\s*\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?';
  iso_re     text := '\y\d{4}-\d{2}-\d{2}\y';
  numeric_re text := '\y\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\y';
  cleaned text;
BEGIN
  FOR r IN
    SELECT id, title
    FROM public.pl_days
    WHERE subtitle IS NULL
      AND title IS NOT NULL
      AND btrim(title) <> ''
  LOOP
    original := r.title;
    t := original;

    -- Strip "Day N" tokens
    t := regexp_replace(t, '(?i)\yday\s*\d+\y', '', 'g');
    -- Strip date-shaped tokens
    t := regexp_replace(t, month_re, '', 'g');
    t := regexp_replace(t, iso_re, '', 'g');
    t := regexp_replace(t, numeric_re, '', 'g');
    -- Strip weekday words
    t := regexp_replace(t, weekday_re, '', 'g');
    -- Strip common separators / stray punctuation left over
    t := regexp_replace(t, '[—–\-·|,:]+', ' ', 'g');
    -- Collapse whitespace
    t := btrim(regexp_replace(t, '\s+', ' ', 'g'));

    cleaned := t;

    IF cleaned = '' THEN
      -- Nothing coach-specific remains → title was purely generated text
      UPDATE public.pl_days SET title = NULL WHERE id = r.id;
      INSERT INTO public.pl_days_title_migration_log (day_id, original_title, action, extracted_subtitle)
        VALUES (r.id, original, 'cleared', NULL);
    ELSIF length(cleaned) <= 80 AND cleaned !~ '\d{3,}' THEN
      -- Looks like a short coach label (no long numeric junk) → promote to subtitle
      UPDATE public.pl_days SET subtitle = cleaned, title = NULL WHERE id = r.id;
      INSERT INTO public.pl_days_title_migration_log (day_id, original_title, action, extracted_subtitle)
        VALUES (r.id, original, 'split', cleaned);
    ELSE
      -- Ambiguous — leave the title alone for manual review
      INSERT INTO public.pl_days_title_migration_log (day_id, original_title, action, extracted_subtitle)
        VALUES (r.id, original, 'skipped_ambiguous', cleaned);
    END IF;
  END LOOP;
END $$;
