-- The meet-preparation reminder gate reads Winnipeg's day through
-- instant_to_local (Nov 26 2026), never a bare AT TIME ZONE: this database's
-- rules still drop Winnipeg to UTC-6 after Nov 1 2026, so the bare form put
-- the day boundary an hour late. Same window, same answer otherwise.
CREATE OR REPLACE FUNCTION public.competition_prep_due()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions c
     WHERE c.status = 'upcoming'
       AND c.prep_reminders
       AND c.internal_test = false
       AND c.meet_date BETWEEN public.instant_to_local(now(), 'America/Winnipeg')::date - 1
                           AND public.instant_to_local(now(), 'America/Winnipeg')::date + 60
       AND (c.meet_date <= public.instant_to_local(now(), 'America/Winnipeg')::date + 1
            OR extract(minute FROM now()) < 5)
  );
$function$;

REVOKE ALL ON FUNCTION public.competition_prep_due() FROM PUBLIC, anon, authenticated;
