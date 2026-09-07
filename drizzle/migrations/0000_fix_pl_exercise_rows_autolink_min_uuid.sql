CREATE OR REPLACE FUNCTION public.pl_exercise_rows_autolink()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  match_count integer;
  match_id uuid;
BEGIN
  IF NEW.exercise_id IS NULL AND btrim(coalesce(NEW.exercise_name_override, '')) <> '' THEN
    SELECT count(*), min(e.id::text)::uuid INTO match_count, match_id
    FROM public.exercises e
    WHERE NOT e.archived
      AND public.pl_norm_exercise_name(e.name) = public.pl_norm_exercise_name(NEW.exercise_name_override);
    IF match_count = 1 THEN
      NEW.exercise_id := match_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;