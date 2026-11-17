-- A lifter's competition profile (src/lib/competition-profile.ts): the weight
-- class they compete in and the age classes they enter, on their account, so
-- every powerlifting form starts from it and the coach always has it.
--
-- Who changes it: the athlete (Account → Competition), their coach or an admin
-- (Training → Athlete setup), and a form they send writes back what they
-- answered (the server, after form_submitted). Classes are stored one way
-- ("83", "120+", "open", "master 1"), whatever a form's options call them.

CREATE TABLE IF NOT EXISTS public.athlete_competition_profiles (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  weight_class text CHECK (weight_class IS NULL OR weight_class ~ '^[0-9]{2,3}(\.[0-9])?\+?$'),
  age_classes text[] NOT NULL DEFAULT '{}'
    CHECK (age_classes <@ ARRAY['sub-junior', 'junior', 'open', 'master 1', 'master 2', 'master 3', 'master 4']::text[]),
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('form', 'client', 'coach')),
  source_submission_id uuid REFERENCES public.nf_submissions(id) ON DELETE SET NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- who changed it last is the signed-in person (the server's form write-back has none)
CREATE OR REPLACE FUNCTION public.tg_athlete_competition_profiles_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS athlete_competition_profiles_stamp ON public.athlete_competition_profiles;
CREATE TRIGGER athlete_competition_profiles_stamp
  BEFORE INSERT OR UPDATE ON public.athlete_competition_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_competition_profiles_stamp();

ALTER TABLE public.athlete_competition_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own competition profile" ON public.athlete_competition_profiles;
CREATE POLICY "Clients read own competition profile" ON public.athlete_competition_profiles
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Clients add own competition profile" ON public.athlete_competition_profiles;
CREATE POLICY "Clients add own competition profile" ON public.athlete_competition_profiles
  FOR INSERT TO authenticated
  WITH CHECK (source = 'client' AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Clients change own competition profile" ON public.athlete_competition_profiles;
CREATE POLICY "Clients change own competition profile" ON public.athlete_competition_profiles
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())))
  WITH CHECK (source = 'client' AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Coaches read coached competition profiles" ON public.athlete_competition_profiles;
CREATE POLICY "Coaches read coached competition profiles" ON public.athlete_competition_profiles
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()) OR (SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Coaches add coached competition profiles" ON public.athlete_competition_profiles;
CREATE POLICY "Coaches add coached competition profiles" ON public.athlete_competition_profiles
  FOR INSERT TO authenticated
  WITH CHECK (source = 'coach' AND (client_id IN (SELECT public.coached_client_ids()) OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))));

DROP POLICY IF EXISTS "Coaches change coached competition profiles" ON public.athlete_competition_profiles;
CREATE POLICY "Coaches change coached competition profiles" ON public.athlete_competition_profiles
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()) OR (SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK (source = 'coach' AND (client_id IN (SELECT public.coached_client_ids()) OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))));

REVOKE ALL ON public.athlete_competition_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.athlete_competition_profiles TO authenticated;
GRANT ALL ON public.athlete_competition_profiles TO service_role;

SELECT public.rls_evaluate_once('athlete_competition_profiles');
