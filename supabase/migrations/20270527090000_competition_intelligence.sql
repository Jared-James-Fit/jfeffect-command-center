-- Competition Intelligence (Nov 24 2026): every competition an athlete is
-- preparing for, its scheduled strategic assessments, the field, the evidence
-- and the meet day, so the coach opens a client and finds the research, the
-- projections, the strategy and the athlete's messages already done.
--
--  * competitions             one row per meet (several upcoming, one primary,
--                             finished ones kept as history), linked to the meet
--                             prep when there is one.
--  * competition_milestones   the job queue: Reconnaissance, Strategic
--                             foundation, Competitive intelligence, Forecasting,
--                             Game plan, Confirmation, Debrief (and interim
--                             updates), each due on a day counted back from the
--                             meet (src/lib/competition/milestones.ts), claimed
--                             by the competition-intel-tick worker on its day.
--  * competition_assessments  what each milestone produced, versioned: the
--                             internal coaching read and the athlete-facing
--                             version kept apart, the coach's review (opened,
--                             reviewed, changes asked for, approved, released)
--                             and the athlete's (delivered, opened,
--                             acknowledged) on the exact version. A new version
--                             supersedes the old one, never overwrites it.
--  * competition_events       append-only record of who did what and when.
--  * competition_competitors  the field: OpenPowerlifting history, identity
--                             status, training seen outside meets; entrants the
--                             research found are "suggested" until the coach
--                             confirms them.
--  * competition_resources    links, notes, rosters, rules, files the coach gave.
--  * competition_meet_log     meet-day attempts, ours and the field's, logged by
--                             hand (idempotent on the phone's key).
--
-- Staff read their own clients' rows (admins all); every write goes through the
-- server (service role) after a staff check. Athletes never read these tables:
-- their released updates come through the server, only the athlete version.

SET lock_timeout = '5s';

-- ── 1. Competitions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  prep_id uuid REFERENCES public.pl_preps (id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  meet_date date NOT NULL,
  meet_end_date date,
  federation text CHECK (federation IS NULL OR char_length(federation) <= 80),
  division text CHECK (division IS NULL OR char_length(division) <= 80),
  weight_class text CHECK (weight_class IS NULL OR char_length(weight_class) <= 20),
  location text CHECK (location IS NULL OR char_length(location) <= 160),
  level text CHECK (level IS NULL OR level IN ('international', 'national', 'regional', 'provincial', 'local')),
  objective text CHECK (objective IS NULL OR objective IN ('win', 'podium', 'qualify', 'record', 'pb_total', 'first_meet', 'return', 'experience')),
  objective_note text CHECK (objective_note IS NULL OR char_length(objective_note) <= 2000),
  target_total_kg numeric CHECK (target_total_kg IS NULL OR target_total_kg BETWEEN 20 AND 1500),
  target_place integer CHECK (target_place IS NULL OR target_place BETWEEN 1 AND 50),
  qualification_total_kg numeric CHECK (qualification_total_kg IS NULL OR qualification_total_kg BETWEEN 20 AND 1500),
  records_note text CHECK (records_note IS NULL OR char_length(records_note) <= 1000),
  athlete_goal_total_kg numeric CHECK (athlete_goal_total_kg IS NULL OR athlete_goal_total_kg BETWEEN 20 AND 1500),
  registration text NOT NULL DEFAULT 'unknown' CHECK (registration IN ('registered', 'not_registered', 'unknown')),
  lifting_start text CHECK (lifting_start IS NULL OR lifting_start ~ '^\d{2}:\d{2}$'),
  weigh_in_at text CHECK (weigh_in_at IS NULL OR weigh_in_at ~ '^\d{2}:\d{2}$'),
  flight text CHECK (flight IS NULL OR char_length(flight) <= 40),
  weigh_in_kg numeric CHECK (weigh_in_kg IS NULL OR weigh_in_kg BETWEEN 25 AND 300),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'completed', 'cancelled', 'archived')),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  release_policy text NOT NULL DEFAULT 'approve_all' CHECK (release_policy IN ('approve_all', 'auto_routine')),
  results jsonb,
  results_at timestamptz,
  -- the daily read: concerns (src/lib/competition/watch.ts) and the overview's numbers
  watch jsonb NOT NULL DEFAULT '[]'::jsonb,
  live jsonb,
  live_at timestamptz,
  schedule_dirty boolean NOT NULL DEFAULT true,
  -- automatic research: the field from OpenPowerlifting's rankings, an adjacent class's field
  research jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- an internal validation run on a staff member's own athlete account: releases go nowhere else
  internal_test boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'coach' CHECK (source IN ('coach', 'prep', 'plan', 'profile')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (meet_end_date IS NULL OR meet_end_date >= meet_date)
);
CREATE INDEX IF NOT EXISTS competitions_client_idx ON public.competitions (client_id, meet_date DESC);
CREATE INDEX IF NOT EXISTS competitions_upcoming_idx ON public.competitions (meet_date) WHERE status = 'upcoming';
CREATE UNIQUE INDEX IF NOT EXISTS competitions_one_primary ON public.competitions (client_id) WHERE is_primary AND status = 'upcoming';
CREATE UNIQUE INDEX IF NOT EXISTS competitions_one_per_prep ON public.competitions (prep_id) WHERE prep_id IS NOT NULL;

-- ── 2. Milestones: the job queue ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('recon', 'foundation', 'intel', 'forecast', 'game_plan', 'confirm', 'update', 'debrief')),
  -- interim updates can happen more than once
  seq integer NOT NULL DEFAULT 0,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'generating', 'waiting_ai', 'ready', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  last_error text,
  -- the staged model call's state (src/lib/ai/staged-call.server.ts)
  progress jsonb,
  -- what the coach asked to change, read by the next version
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 4000),
  why text,
  assessment_id uuid,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, kind, seq)
);
CREATE INDEX IF NOT EXISTS competition_milestones_due_idx ON public.competition_milestones (due_on) WHERE status IN ('scheduled', 'generating', 'waiting_ai', 'failed');

-- ── 3. Assessments, versioned ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.competition_milestones (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('recon', 'foundation', 'intel', 'forecast', 'game_plan', 'confirm', 'update', 'debrief')),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'reviewed', 'changes_requested', 'approved', 'released', 'superseded')),
  urgency text NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'attention', 'urgent')),
  needs_approval boolean NOT NULL DEFAULT false,
  headline text NOT NULL CHECK (char_length(headline) <= 300),
  internal jsonb NOT NULL,
  athlete jsonb NOT NULL,
  coach_message text CHECK (coach_message IS NULL OR char_length(coach_message) <= 600),
  call jsonb,
  inputs_hash text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  coach_opened_at timestamptz,
  coach_opened_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid,
  changes_requested_at timestamptz,
  changes_requested_by uuid,
  changes_note text CHECK (changes_note IS NULL OR char_length(changes_note) <= 4000),
  approved_at timestamptz,
  approved_by uuid,
  released_at timestamptz,
  released_by uuid,
  release_kind text CHECK (release_kind IS NULL OR release_kind IN ('approved', 'automated')),
  athlete_edited_at timestamptz,
  athlete_edited_by uuid,
  message_id uuid,
  athlete_delivered_at timestamptz,
  athlete_opened_at timestamptz,
  athlete_acknowledged_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid,
  UNIQUE (competition_id, kind, version)
);
CREATE INDEX IF NOT EXISTS competition_assessments_comp_idx ON public.competition_assessments (competition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS competition_assessments_open_idx ON public.competition_assessments (client_id) WHERE status IN ('ready', 'reviewed', 'changes_requested', 'approved');

-- ── 4. The record ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_events (
  id bigserial PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  assessment_id uuid,
  actor_id uuid,
  actor text NOT NULL CHECK (actor IN ('coach', 'athlete', 'system', 'cleo')),
  action text NOT NULL CHECK (char_length(action) <= 60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competition_events_comp_idx ON public.competition_events (competition_id, at DESC);

CREATE OR REPLACE FUNCTION public.tg_competition_events_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  -- a competition deleted with its client takes its record with it (cascade); nothing else changes one
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.competitions WHERE id = OLD.competition_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The competition record is append-only';
END;
$$;
DROP TRIGGER IF EXISTS competition_events_keep ON public.competition_events;
CREATE TRIGGER competition_events_keep BEFORE UPDATE OR DELETE ON public.competition_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_competition_events_keep();

-- ── 5. The field ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  sex text CHECK (sex IS NULL OR sex IN ('M', 'F')),
  weight_class text CHECK (weight_class IS NULL OR char_length(weight_class) <= 20),
  federation text CHECK (federation IS NULL OR char_length(federation) <= 80),
  country text CHECK (country IS NULL OR char_length(country) <= 60),
  opl_slug text CHECK (opl_slug IS NULL OR opl_slug ~ '^[a-z0-9]{2,80}$'),
  instagram text CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  identity text NOT NULL DEFAULT 'unverified' CHECK (identity IN ('unverified', 'matched', 'ambiguous', 'not_found', 'manual')),
  contenders jsonb NOT NULL DEFAULT '[]'::jsonb,
  meets jsonb NOT NULL DEFAULT '[]'::jsonb,
  meets_fetched_at timestamptz,
  fetch_error text,
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  bodyweight_kg numeric CHECK (bodyweight_kg IS NULL OR bodyweight_kg BETWEEN 25 AND 300),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'roster', 'opl')),
  -- suggested: found by research, not confirmed; confirmed: the coach says they're likely; registered: on a start list
  field_status text NOT NULL DEFAULT 'confirmed' CHECK (field_status IN ('suggested', 'confirmed', 'registered')),
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS competition_competitors_name ON public.competition_competitors (competition_id, lower(name)) WHERE NOT archived;

-- ── 6. Resources ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('link', 'note', 'document', 'roster', 'rules', 'schedule', 'caption', 'screenshot')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  url text CHECK (url IS NULL OR (char_length(url) <= 2000 AND url ~* '^https?://')),
  body text CHECK (body IS NULL OR char_length(body) <= 50000),
  document_id uuid REFERENCES public.documents (id) ON DELETE SET NULL,
  extracted jsonb,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competition_resources_comp_idx ON public.competition_resources (competition_id, created_at DESC);

-- ── 7. Meet day ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_meet_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  -- 'us' or a competitor's id
  entrant text NOT NULL CHECK (char_length(entrant) BETWEEN 2 AND 40),
  lift text NOT NULL CHECK (lift IN ('squat', 'bench', 'deadlift')),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 4),
  kg numeric CHECK (kg IS NULL OR kg BETWEEN 0 AND 600),
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('good', 'no_lift', 'pending')),
  rpe numeric CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  velocity numeric CHECK (velocity IS NULL OR velocity BETWEEN 0 AND 3),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'official')),
  client_key text CHECK (client_key IS NULL OR char_length(client_key) <= 80),
  logged_by uuid,
  logged_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, entrant, lift, attempt)
);

-- ── 8. Access: staff read their own clients'; the server writes ───────────
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_meet_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['competitions', 'competition_milestones', 'competition_assessments', 'competition_events', 'competition_competitors', 'competition_resources', 'competition_meet_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Staff read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Staff read %1$s" ON public.%1$I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::app_role)) OR client_id IN (SELECT public.coached_client_ids()))',
      t
    );
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$$;
GRANT USAGE, SELECT ON SEQUENCE public.competition_events_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.tg_competition_events_keep() FROM PUBLIC, anon, authenticated;

-- ── 9. Touch updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_competition_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_competition_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS competitions_touch ON public.competitions;
CREATE TRIGGER competitions_touch BEFORE UPDATE ON public.competitions FOR EACH ROW EXECUTE FUNCTION public.tg_competition_touch();
DROP TRIGGER IF EXISTS competition_milestones_touch ON public.competition_milestones;
CREATE TRIGGER competition_milestones_touch BEFORE UPDATE ON public.competition_milestones FOR EACH ROW EXECUTE FUNCTION public.tg_competition_touch();
DROP TRIGGER IF EXISTS competition_competitors_touch ON public.competition_competitors;
CREATE TRIGGER competition_competitors_touch BEFORE UPDATE ON public.competition_competitors FOR EACH ROW EXECUTE FUNCTION public.tg_competition_touch();
DROP TRIGGER IF EXISTS competition_meet_log_touch ON public.competition_meet_log;
CREATE TRIGGER competition_meet_log_touch BEFORE UPDATE ON public.competition_meet_log FOR EACH ROW EXECUTE FUNCTION public.tg_competition_touch();

-- A meet date, an end date or a status changed: the schedule is worked out again.
CREATE OR REPLACE FUNCTION public.tg_competition_schedule_dirty()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.meet_date IS DISTINCT FROM OLD.meet_date OR NEW.meet_end_date IS DISTINCT FROM OLD.meet_end_date
     OR NEW.status IS DISTINCT FROM OLD.status OR NEW.results_at IS DISTINCT FROM OLD.results_at THEN
    NEW.schedule_dirty := true;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_competition_schedule_dirty() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS competitions_schedule_dirty ON public.competitions;
CREATE TRIGGER competitions_schedule_dirty BEFORE UPDATE ON public.competitions FOR EACH ROW EXECUTE FUNCTION public.tg_competition_schedule_dirty();

-- A meet prep's date moved: the competition linked to it follows.
CREATE OR REPLACE FUNCTION public.tg_pl_prep_competition_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.event_date IS NOT NULL AND NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    UPDATE public.competitions
       SET meet_date = NEW.event_date,
           meet_end_date = CASE WHEN meet_end_date IS NOT NULL AND meet_end_date < NEW.event_date THEN NULL ELSE meet_end_date END
     WHERE prep_id = NEW.id AND status = 'upcoming';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_pl_prep_competition_date() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pl_preps_competition_date ON public.pl_preps;
CREATE TRIGGER pl_preps_competition_date AFTER UPDATE OF event_date ON public.pl_preps FOR EACH ROW EXECUTE FUNCTION public.tg_pl_prep_competition_date();

-- ── 10. Claim one due milestone (the worker) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.competition_milestone_claim(_id uuid DEFAULT NULL)
RETURNS SETOF public.competition_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
BEGIN
  UPDATE public.competition_milestones
     SET status = 'failed', last_error = coalesce(last_error, 'Stopped after three tries'), locked_at = NULL
   WHERE status = 'generating' AND locked_at < now() - interval '10 minutes' AND attempts >= 3;
  RETURN QUERY
  UPDATE public.competition_milestones m
     SET status = 'generating', locked_at = clock_timestamp(),
         attempts = CASE WHEN m.status = 'waiting_ai' THEN m.attempts ELSE m.attempts + 1 END
   WHERE m.id = (
     SELECT x.id FROM public.competition_milestones x
       JOIN public.competitions c ON c.id = x.competition_id
      WHERE (_id IS NULL OR x.id = _id)
        AND x.due_on <= today
        AND c.status IN ('upcoming', 'completed')
        AND (x.status = 'scheduled'
          OR (x.status = 'waiting_ai' AND x.updated_at < now() - interval '50 seconds')
          OR (x.status = 'generating' AND x.locked_at < now() - interval '10 minutes' AND x.attempts < 3)
          OR (x.status = 'failed' AND x.attempts < 3 AND x.updated_at < now() - interval '10 minutes'))
      ORDER BY x.due_on, x.created_at
      LIMIT 1
      FOR UPDATE OF x SKIP LOCKED
   )
  RETURNING m.*;
END;
$$;
REVOKE ALL ON FUNCTION public.competition_milestone_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_milestone_claim(uuid) TO service_role;

-- Is anything due right now (the cron's condition, kept in one place)?
CREATE OR REPLACE FUNCTION public.competition_intel_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions WHERE schedule_dirty AND status <> 'archived'
  ) OR EXISTS (
    SELECT 1 FROM public.competition_milestones x
      JOIN public.competitions c ON c.id = x.competition_id
     WHERE x.due_on <= public.instant_to_local(now(), 'America/Winnipeg')::date
       AND c.status IN ('upcoming', 'completed')
       AND (x.status = 'scheduled'
         OR (x.status = 'waiting_ai' AND x.updated_at < now() - interval '50 seconds')
         OR (x.status = 'generating' AND x.locked_at < now() - interval '10 minutes' AND x.attempts < 3)
         OR (x.status = 'failed' AND x.attempts < 3 AND x.updated_at < now() - interval '10 minutes'))
  )
$$;
REVOKE ALL ON FUNCTION public.competition_intel_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_intel_due() TO service_role, postgres;

-- ── 11. The worker: every minute while something's due, and a daily read ─
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('competition-intel-tick', 'competition-intel-daily');
  PERFORM cron.schedule(
    'competition-intel-tick',
    '* * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/competition-intel-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE public.competition_intel_due();
    $cmd$
  );
  -- 12:41 UTC = 7:41 Winnipeg: the day's read of every upcoming competition
  PERFORM cron.schedule(
    'competition-intel-daily',
    '41 12 * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/competition-intel-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{"scan":"daily"}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END
$$;

RESET lock_timeout;
