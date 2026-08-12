CREATE OR REPLACE FUNCTION public.pl_norm_exercise_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(lower(btrim(coalesce(_name, ''))), '[^a-z0-9]+', '', 'g')
$$;

CREATE INDEX IF NOT EXISTS idx_exercises_norm_name
  ON public.exercises (public.pl_norm_exercise_name(name));

-- One-time safe backfill: only link when EXACTLY ONE non-archived library
-- exercise matches the normalized name. Ambiguous / unmatched rows untouched.
WITH cand AS (
  SELECT r.id AS row_id,
         (SELECT e.id FROM public.exercises e
           WHERE NOT e.archived
             AND public.pl_norm_exercise_name(e.name) = public.pl_norm_exercise_name(r.exercise_name_override)
           LIMIT 1) AS ex_id,
         (SELECT count(*) FROM public.exercises e
           WHERE NOT e.archived
             AND public.pl_norm_exercise_name(e.name) = public.pl_norm_exercise_name(r.exercise_name_override)) AS n
  FROM public.pl_exercise_rows r
  WHERE r.exercise_id IS NULL
    AND btrim(coalesce(r.exercise_name_override, '')) <> ''
)
UPDATE public.pl_exercise_rows r
SET exercise_id = c.ex_id
FROM cand c
WHERE r.id = c.row_id AND c.n = 1 AND c.ex_id IS NOT NULL;

-- Safety net: never let a row whose name unambiguously matches the library
-- persist with a NULL exercise_id.
CREATE OR REPLACE FUNCTION public.pl_exercise_rows_autolink()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  match_count integer;
  match_id uuid;
BEGIN
  IF NEW.exercise_id IS NULL AND btrim(coalesce(NEW.exercise_name_override, '')) <> '' THEN
    SELECT count(*), min(e.id) INTO match_count, match_id
    FROM public.exercises e
    WHERE NOT e.archived
      AND public.pl_norm_exercise_name(e.name) = public.pl_norm_exercise_name(NEW.exercise_name_override);
    IF match_count = 1 THEN
      NEW.exercise_id := match_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pl_exercise_rows_autolink ON public.pl_exercise_rows;
CREATE TRIGGER trg_pl_exercise_rows_autolink
BEFORE INSERT OR UPDATE OF exercise_id, exercise_name_override ON public.pl_exercise_rows
FOR EACH ROW EXECUTE FUNCTION public.pl_exercise_rows_autolink();