-- ROLLBACK for supabase/migrations/20270527107000_ai_data_consent.sql
--
-- NOT a migration: it lives outside supabase/migrations so it never runs by itself.
-- The app's AI paths check consent through ai_consent_ok / ai_consent_ok_for_client and
-- FAIL CLOSED: dropping them stops every AI feature for clients and members. So:
--
-- R0. Emergency switch (prefer this to R1): every login counts as having allowed AI
--     processing again. This re-opens sharing without permission (App Store 5.1.2(i)),
--     so only to stop an outage, and put the real functions back (re-run the migration)
--     once fixed. Run as the database owner.
--
-- CREATE OR REPLACE FUNCTION public.ai_consent_ok(_user uuid, _version integer)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $$ SELECT _user IS NOT NULL $$;
--
-- R1. Remove the feature entirely: only together with reverting the app code that calls
--     these (src/lib/ai-consent and its callers), never on its own. The answers people
--     gave are lost with the tables; export ai_data_consent_events first if they matter.

SET lock_timeout = '5s';
BEGIN;
DROP FUNCTION IF EXISTS public.ai_consent_ok_for_client(uuid, integer);
DROP FUNCTION IF EXISTS public.ai_consent_ok(uuid, integer);
DROP FUNCTION IF EXISTS public.ai_consent_set(boolean, integer);
DROP TABLE IF EXISTS public.ai_data_consent_events;
DROP TABLE IF EXISTS public.ai_data_consents;
COMMIT;
