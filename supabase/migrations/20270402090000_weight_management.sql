-- Weight management: the bodyweight trajectory, treadmill cardio, water and
-- digestion read as one (src/lib/weight-management/, pure and tested), on top
-- of what's already here: weigh-ins (progress_bodyweight), the bodyweight goal
-- on clients, meets (pl_preps), the cardio plan (cardio_targets), water
-- (progress_water_targets) and the weekly check-in (messenger_checkins).
--
-- 1. The bodyweight goal gets the date it's for (a meet's date comes from its
--    pl_preps row instead).
-- 2. weight_management_profiles: what the engine can't read from records
--    (the treadmill's unit and top incline, a hot gym, how much they sweat,
--    the longest session they have time for, whether the meet is the one that
--    matters). One row a client, staff only.
-- 3. weight_management_reviews: every recommendation the engine made after a
--    weekly check-in (or a coach's own look), what it was based on, and what
--    the coach did with it: approved (and exactly what changed), dismissed,
--    or superseded by a newer one. Nothing material is applied without the
--    coach. Staff only; clients never read it. Written by the server (the
--    check-in hook runs as the service role) and updated by the coach.
-- 4. progress_water_targets.training_extra_ml: how much more water a
--    training day is, so a training day's target differs from a day off.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS bodyweight_goal_date date;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.weight_management_profiles (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  speed_unit text CHECK (speed_unit IN ('mph', 'kmh')),
  climate text CHECK (climate IN ('temperate', 'hot')),
  sweat_level text CHECK (sweat_level IN ('light', 'average', 'heavy')),
  max_incline numeric(4,1) CHECK (max_incline IS NULL OR (max_incline >= 0 AND max_incline <= 40)),
  max_session_minutes integer CHECK (max_session_minutes IS NULL OR (max_session_minutes BETWEEN 10 AND 180)),
  meet_importance text CHECK (meet_importance IN ('primary', 'tune_up')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_weight_management_profiles_updated_at ON public.weight_management_profiles;
CREATE TRIGGER trg_weight_management_profiles_updated_at BEFORE UPDATE ON public.weight_management_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.weight_management_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read weight management profiles" ON public.weight_management_profiles;
CREATE POLICY "Staff read weight management profiles" ON public.weight_management_profiles
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff add weight management profiles" ON public.weight_management_profiles;
CREATE POLICY "Staff add weight management profiles" ON public.weight_management_profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff update weight management profiles" ON public.weight_management_profiles;
CREATE POLICY "Staff update weight management profiles" ON public.weight_management_profiles
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

REVOKE ALL ON public.weight_management_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.weight_management_profiles TO authenticated;
GRANT ALL ON public.weight_management_profiles TO service_role;

SELECT public.rls_evaluate_once('weight_management_profiles');

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.weight_management_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('checkin', 'coach')),
  checkin_id uuid REFERENCES public.messenger_checkins(id) ON DELETE SET NULL,
  -- the engine's read, hashed: the same records never make a second review
  hash text NOT NULL CHECK (char_length(hash) BETWEEN 4 AND 64),
  engine_version integer NOT NULL DEFAULT 1,
  verdict text NOT NULL CHECK (verdict IN ('maintain', 'adjust', 'reduce_load', 'investigate', 'reconsider_target', 'need_data')),
  headline text NOT NULL CHECK (char_length(headline) <= 300),
  -- material = a nutrition or cardio change: it waits on the coach
  material boolean NOT NULL DEFAULT false,
  assessment jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'dismissed', 'superseded', 'noted')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  -- what changed on approval: [{kind, target, before, after}]
  applied jsonb,
  notified_at timestamptz,
  UNIQUE (client_id, hash)
);

CREATE INDEX IF NOT EXISTS weight_management_reviews_client_idx ON public.weight_management_reviews (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS weight_management_reviews_open_idx ON public.weight_management_reviews (client_id) WHERE status = 'open';

ALTER TABLE public.weight_management_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read weight management reviews" ON public.weight_management_reviews;
CREATE POLICY "Staff read weight management reviews" ON public.weight_management_reviews
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff add weight management reviews" ON public.weight_management_reviews;
CREATE POLICY "Staff add weight management reviews" ON public.weight_management_reviews
  FOR INSERT TO authenticated
  WITH CHECK (source = 'coach' AND ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids())));

DROP POLICY IF EXISTS "Staff decide weight management reviews" ON public.weight_management_reviews;
CREATE POLICY "Staff decide weight management reviews" ON public.weight_management_reviews
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

-- the record of what the engine said can't be rewritten: only the decision on it
CREATE OR REPLACE FUNCTION public.weight_management_reviews_keep_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.checkin_id IS DISTINCT FROM OLD.checkin_id
     OR NEW.hash IS DISTINCT FROM OLD.hash
     OR NEW.verdict IS DISTINCT FROM OLD.verdict
     OR NEW.headline IS DISTINCT FROM OLD.headline
     OR NEW.material IS DISTINCT FROM OLD.material
     OR NEW.assessment IS DISTINCT FROM OLD.assessment THEN
    RAISE EXCEPTION 'A weight management review keeps what it said; only its decision changes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_weight_management_reviews_keep_record ON public.weight_management_reviews;
CREATE TRIGGER trg_weight_management_reviews_keep_record BEFORE UPDATE ON public.weight_management_reviews
  FOR EACH ROW EXECUTE FUNCTION public.weight_management_reviews_keep_record();

REVOKE ALL ON public.weight_management_reviews FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.weight_management_reviews TO authenticated;
GRANT ALL ON public.weight_management_reviews TO service_role;

SELECT public.rls_evaluate_once('weight_management_reviews');

-- ---------------------------------------------------------------------------

ALTER TABLE public.progress_water_targets
  ADD COLUMN IF NOT EXISTS training_extra_ml integer
  CHECK (training_extra_ml IS NULL OR (training_extra_ml BETWEEN 0 AND 3000));
