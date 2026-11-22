-- Rollback for 20270509090000_coach_platform_early_access.sql
-- (JF Effect for coaches: early-access waitlist, launch settings, pricing history).
--
-- Nothing else depends on these objects. Export the waitlist first if any
-- applications are worth keeping:
--   COPY (SELECT * FROM public.coach_platform_applications) TO STDOUT WITH CSV HEADER;
-- The /coaches page keeps working without them: getCoachPlatformPublic()
-- reads no price on an error, and the application's submit then fails with
-- "That didn't send", so take the page down (or revert the code) with it.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.coach_platform_set_pricing(boolean, int, int, int, int);
DROP FUNCTION IF EXISTS public.coach_platform_get();
DROP FUNCTION IF EXISTS public.coach_platform_public();
DROP FUNCTION IF EXISTS public.coach_platform_settings();
DROP TABLE IF EXISTS public.coach_platform_pricing_history;
DROP TRIGGER IF EXISTS coach_platform_applications_touch ON public.coach_platform_applications;
DROP FUNCTION IF EXISTS public.tg_coach_platform_applications_touch();
DROP TABLE IF EXISTS public.coach_platform_applications;
DELETE FROM public.app_settings WHERE key = 'coach_platform';

COMMIT;
