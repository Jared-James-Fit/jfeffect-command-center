-- Logging Level XP for member-built workouts: once per calendar day.
--
-- A member can build as many workouts as they like, so per-completion XP
-- (100 + 20 per completion) would be free points. For workouts in a member's
-- "My workouts" container, the workout XP is keyed per athlete per day instead
-- of per completion: still awarded only by this trigger, and the unique
-- (client_id, source_key) makes it idempotent. Programmed workouts (coach or
-- membership plans) are unchanged.
--
-- Body otherwise identical to drizzle/migrations/0009_athlete_xp.sql.
CREATE OR REPLACE FUNCTION public.award_workout_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  completed_key text;
  logged_key text;
BEGIN
  IF NEW.completed_at IS NULL OR NEW.client_id IS NULL THEN RETURN NEW; END IF;

  completed_key := 'workout_completed:' || NEW.id;
  logged_key := 'workout_fully_logged:' || NEW.id;
  IF EXISTS (
    SELECT 1 FROM public.pl_days d
      JOIN public.pl_weeks w ON w.id = d.week_id
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE d.id = NEW.day_id AND b.source_template_block_key = 'member_workouts_v1'
  ) THEN
    completed_key := 'workout_completed_member:' || NEW.client_id || ':' || (NEW.completed_at AT TIME ZONE public.league_tz())::date;
    logged_key := 'workout_fully_logged_member:' || NEW.client_id || ':' || (NEW.completed_at AT TIME ZONE public.league_tz())::date;
  END IF;

  INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
  VALUES (NEW.client_id, 'workout_completed', 'pl_day_completions', NEW.id, completed_key, 100, 'Completed workout', NEW.completed_at)
  ON CONFLICT (client_id, source_key) DO NOTHING;
  IF NEW.logging_quality::text = 'complete' THEN
    INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
    VALUES (NEW.client_id, 'workout_fully_logged', 'pl_day_completions', NEW.id, logged_key, 20, 'Fully logged workout', NEW.completed_at)
    ON CONFLICT (client_id, source_key) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'award_workout_xp failed: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.award_workout_xp() FROM PUBLIC, anon, authenticated;
