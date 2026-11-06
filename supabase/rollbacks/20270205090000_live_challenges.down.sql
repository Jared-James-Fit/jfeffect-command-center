-- Rollback for 20270205090000_live_challenges.sql (by hand, only if live
-- challenges have to be removed entirely). This DELETES every challenge,
-- participant, score and prize record: export them first.
DROP TRIGGER IF EXISTS challenge_link_login ON auth.users;
DROP POLICY IF EXISTS "Challenge media upload" ON storage.objects;
DROP POLICY IF EXISTS "Challenge media delete" ON storage.objects;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'challenge_live') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.challenge_live;
  END IF;
END $$;
DROP TABLE IF EXISTS public.challenge_live, public.challenge_reg_log, public.challenge_events, public.challenge_audit,
  public.challenge_awards, public.challenge_attempts, public.challenge_entries, public.challenge_athlete_private,
  public.challenge_athletes, public.challenge_staff, public.challenge_updates, public.challenge_prizes,
  public.challenge_sponsors, public.challenge_divisions, public.challenges CASCADE;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND (p.proname LIKE 'challenge\_%' OR p.proname LIKE '\_challenge\_%' OR p.proname LIKE 'tg\_challenge\_%') LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || f.sig || ' CASCADE';
  END LOOP;
END $$;
-- Storage objects under challenge-media are removed through the Storage API (bucket left in place).
