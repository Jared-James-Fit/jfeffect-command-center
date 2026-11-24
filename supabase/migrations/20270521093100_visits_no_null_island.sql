-- Visits never sit at 0°, 0° (Nov 23 2026). The host gives a visit only its country, and the
-- first recorder read the missing coordinates as 0, so every visit landed in the Atlantic. The
-- server now leaves them empty (pulse-rules.ts coarsePlace) and places a visit at its device's time
-- zone's main city (tz-places.ts); this keeps the table honest whatever writes it: a point needs
-- both halves, and 0°, 0° is never a visitor. Idempotent.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.app_sessions_no_null_island()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL OR (NEW.lat = 0 AND NEW.lng = 0) THEN
    NEW.lat := NULL;
    NEW.lng := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.app_sessions_no_null_island() FROM PUBLIC, anon, authenticated;

-- created only when missing: CREATE TRIGGER's lock lets reads go on, DROP TRIGGER's doesn't
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'app_sessions_no_null_island'
                  AND tgrelid = 'public.app_sessions'::regclass) THEN
    CREATE TRIGGER app_sessions_no_null_island
      BEFORE INSERT OR UPDATE OF lat, lng ON public.app_sessions
      FOR EACH ROW EXECUTE FUNCTION public.app_sessions_no_null_island();
  END IF;
END $$;

UPDATE public.app_sessions SET lat = NULL, lng = NULL
 WHERE (lat = 0 AND lng = 0) OR (lat IS NULL) <> (lng IS NULL);
