-- Nutrition roadmaps (Nov 22 2026, src/lib/nutrition-roadmap/): a goal turned
-- into a periodized plan of nutrition blocks from where the athlete is to the
-- date, read against their data every day, with adaptive check-ins and safe,
-- approved adjustments. The engine is code (deterministic, tested); these
-- tables only keep what it decided and who approved it.
--
-- nutrition_roadmaps: one row per athlete. The active (approved or accepted)
-- revision, today's status and the next check-in with its reason, the
-- coach's preferences (cadence, locked competition phases), a self-coached
-- athlete's consent to small automatic changes, and their own competition.
-- nutrition_roadmap_revisions: every plan the engine proposed, append-only:
-- what it said never changes, only its decision. A coached athlete sees a
-- revision only once their coach approved it; a self-coached athlete sees the
-- ones waiting on them.
-- nutrition_roadmap_checkins: a self-coached athlete's roadmap check-ins
-- (coached athletes answer the same follow-ups in their weekly check-in).
-- Writes are the server's only, after its own checks (roadmap.functions.ts,
-- the nutrition-roadmap-tick hook); reads follow the usual staff / own rules.

-- fail fast rather than queue behind a long-held lock
SET lock_timeout = '8s';

CREATE TABLE IF NOT EXISTS public.nutrition_roadmaps (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  active_revision_id uuid,
  status text CHECK (status IN ('ahead', 'on_track', 'behind', 'insufficient_data', 'needs_attention')),
  status_headline text CHECK (status_headline IS NULL OR char_length(status_headline) <= 300),
  status_detail text CHECK (status_detail IS NULL OR char_length(status_detail) <= 1500),
  -- the latest decision as the engine made it: {action, headline, approval}
  decision jsonb,
  -- a proposal waiting on the coach, or something worth the coach's look
  needs_coach boolean NOT NULL DEFAULT false,
  next_checkin_on date,
  next_checkin_kind text CHECK (next_checkin_kind IN ('quick', 'full', 'professional')),
  next_checkin_reason text CHECK (next_checkin_reason IS NULL OR char_length(next_checkin_reason) <= 400),
  asks text[] NOT NULL DEFAULT '{}',
  last_evaluated_at timestamptz,
  last_reminded_on date,
  last_flagged_on date,
  -- consecutive daily reads off the planned path (a reforecast trigger)
  off_plan_days integer NOT NULL DEFAULT 0,
  -- coach: {everyDays: 3..28|null, lockCompetition: bool, reminders: bool}
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_adjust boolean NOT NULL DEFAULT false,
  auto_adjust_at timestamptz,
  -- a self-coached athlete's own competition: {name, date, weightClass, federation, sport}
  athlete_goal jsonb,
  engine_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_nutrition_roadmaps_updated_at ON public.nutrition_roadmaps;
CREATE TRIGGER trg_nutrition_roadmaps_updated_at BEFORE UPDATE ON public.nutrition_roadmaps
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.nutrition_roadmap_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL CHECK (trigger IN ('initial', 'reforecast', 'goal_change', 'adjustment', 'coach', 'checkin')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'superseded', 'rejected')),
  -- who says yes: the coach for a coached athlete, the athlete when self-coached
  decider text NOT NULL CHECK (decider IN ('coach', 'athlete')),
  plan jsonb NOT NULL,
  hash text NOT NULL CHECK (char_length(hash) BETWEEN 4 AND 64),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 1500),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- the change to the current targets offered with it (the engine's decision)
  proposal jsonb,
  -- the words a model wrote for it (validated against the numbers), never the numbers
  explanation jsonb,
  explained_at timestamptz,
  engine_version integer NOT NULL DEFAULT 1,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  -- what changed when it was accepted: {targets: {before, after}}
  applied jsonb,
  auto_applied boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS nutrition_roadmap_revisions_client_idx ON public.nutrition_roadmap_revisions (client_id, created_at DESC);
-- the same plan is never proposed twice while one is waiting or in effect
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_roadmap_revisions_live_hash ON public.nutrition_roadmap_revisions (client_id, hash) WHERE status IN ('proposed', 'active');
-- one roadmap in effect per athlete
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_roadmap_revisions_one_active ON public.nutrition_roadmap_revisions (client_id) WHERE status = 'active';

DO $$
BEGIN
  ALTER TABLE public.nutrition_roadmaps
    ADD CONSTRAINT nutrition_roadmaps_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES public.nutrition_roadmap_revisions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.nutrition_roadmap_revisions_keep_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.trigger IS DISTINCT FROM OLD.trigger
     OR NEW.decider IS DISTINCT FROM OLD.decider
     OR NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.hash IS DISTINCT FROM OLD.hash
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.changes IS DISTINCT FROM OLD.changes
     OR NEW.proposal IS DISTINCT FROM OLD.proposal THEN
    RAISE EXCEPTION 'A roadmap revision keeps what it said; only its decision and explanation change' USING ERRCODE = '42501';
  END IF;
  -- a decision is final: an accepted or rejected revision is never reopened
  IF OLD.status IN ('rejected', 'superseded') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A closed roadmap revision stays closed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nutrition_roadmap_revisions_keep_record ON public.nutrition_roadmap_revisions;
CREATE TRIGGER trg_nutrition_roadmap_revisions_keep_record BEFORE UPDATE ON public.nutrition_roadmap_revisions
  FOR EACH ROW EXECUTE FUNCTION public.nutrition_roadmap_revisions_keep_record();

CREATE TABLE IF NOT EXISTS public.nutrition_roadmap_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  kind text NOT NULL DEFAULT 'quick' CHECK (kind IN ('quick', 'full', 'professional')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 400),
  asks text[] NOT NULL DEFAULT '{}',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, due_on)
);

CREATE INDEX IF NOT EXISTS nutrition_roadmap_checkins_client_idx ON public.nutrition_roadmap_checkins (client_id, due_on DESC);

ALTER TABLE public.nutrition_roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_roadmap_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_roadmap_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read nutrition roadmaps" ON public.nutrition_roadmaps;
CREATE POLICY "Staff read nutrition roadmaps" ON public.nutrition_roadmaps
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Athletes read own nutrition roadmap" ON public.nutrition_roadmaps;
CREATE POLICY "Athletes read own nutrition roadmap" ON public.nutrition_roadmaps
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff read nutrition roadmap revisions" ON public.nutrition_roadmap_revisions;
CREATE POLICY "Staff read nutrition roadmap revisions" ON public.nutrition_roadmap_revisions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

-- an athlete never sees a draft waiting on their coach
DROP POLICY IF EXISTS "Athletes read own nutrition roadmap revisions" ON public.nutrition_roadmap_revisions;
CREATE POLICY "Athletes read own nutrition roadmap revisions" ON public.nutrition_roadmap_revisions
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    AND (decider = 'athlete' OR status IN ('active', 'superseded'))
  );

DROP POLICY IF EXISTS "Staff read nutrition roadmap check-ins" ON public.nutrition_roadmap_checkins;
CREATE POLICY "Staff read nutrition roadmap check-ins" ON public.nutrition_roadmap_checkins
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Athletes read own nutrition roadmap check-ins" ON public.nutrition_roadmap_checkins;
CREATE POLICY "Athletes read own nutrition roadmap check-ins" ON public.nutrition_roadmap_checkins
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.nutrition_roadmaps FROM anon;
REVOKE ALL ON public.nutrition_roadmap_revisions FROM anon;
REVOKE ALL ON public.nutrition_roadmap_checkins FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.nutrition_roadmaps FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.nutrition_roadmap_revisions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.nutrition_roadmap_checkins FROM authenticated;
GRANT SELECT ON public.nutrition_roadmaps TO authenticated;
GRANT SELECT ON public.nutrition_roadmap_revisions TO authenticated;
GRANT SELECT ON public.nutrition_roadmap_checkins TO authenticated;
GRANT ALL ON public.nutrition_roadmaps TO service_role;
GRANT ALL ON public.nutrition_roadmap_revisions TO service_role;
GRANT ALL ON public.nutrition_roadmap_checkins TO service_role;

SELECT public.rls_evaluate_once('nutrition_roadmaps');
SELECT public.rls_evaluate_once('nutrition_roadmap_revisions');
SELECT public.rls_evaluate_once('nutrition_roadmap_checkins');

-- a self-coached athlete's targets from an accepted roadmap are member_nutrition_targets rows like any
-- other (source 'calculated', input_snapshot.roadmap_revision_id says which revision): no change to that table.

-- Passive monitoring, once a day at 8:17 in Winnipeg (13:17 UTC: Manitoba is a
-- fixed UTC-5 from Nov 1, 2026): every roadmap is read against the day's data,
-- its status and next check-in kept, a reforecast proposed only when the
-- journey really changed, a due check-in reminded once by push, and the coach
-- told only about what genuinely needs them (nutrition-roadmap/evaluate.server.ts).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nutrition-roadmap-tick';
  perform cron.schedule(
    'nutrition-roadmap-tick',
    '17 13 * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/nutrition-roadmap-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
