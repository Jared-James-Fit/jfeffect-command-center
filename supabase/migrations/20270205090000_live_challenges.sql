-- Live challenges: real-world fitness competitions with a public page, live
-- leaderboard, verified scores, athlete profiles across events, prizes and
-- share cards. The first one is the Winnipeg 225 Bench Press Challenge (a
-- draft until its date and venue are set).
--
-- Who can do what is decided here, never in the app:
--   * Everything public goes through SECURITY DEFINER functions that return
--     only public fields (challenge_hub / _page / _board / _result /
--     challenge_athlete). Nobody reads the tables directly but staff.
--   * Contact details live in challenge_athlete_private: no policy, no grant;
--     only challenge_participants / challenge_awards_list hand them out, and
--     only to the owner (admin) or that challenge's event manager.
--   * Scores are written only by challenge_record_attempt / _correct_attempt
--     / _void_attempt, for a judge, manager or admin of that challenge; every
--     change is in challenge_audit with who did it and why. A retry with the
--     same client_key returns the saved attempt instead of a second one.
--   * Ranking is competition ranking (1, 2, 2, 4): a tie stays a tie unless
--     the tie-break published before the start separates everyone in it.
--     Submission time is never a tie-break. Scoring and the tie-break lock
--     the moment the challenge goes live or has a recorded attempt.
--   * Final results are a snapshot (final_rank / final_score) taken by
--     challenge_finalize after the coach reviews them; prizes for tied places
--     are split equally between the people tied.
--   * Live updates: challenge_live holds one public version number per
--     challenge (no names, no scores). Pages subscribe to it and refetch.

-- ── Tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  tagline text,
  description text,
  status text NOT NULL DEFAULT 'draft',
  is_template boolean NOT NULL DEFAULT false,
  activity text NOT NULL DEFAULT '',
  metric text NOT NULL DEFAULT 'reps',
  unit text NOT NULL DEFAULT 'reps',
  direction text NOT NULL DEFAULT 'higher',
  scoring text NOT NULL DEFAULT 'best',
  attempts_allowed int NOT NULL DEFAULT 1,
  load_value numeric(8,2),
  load_unit text,
  time_cap_seconds int,
  objective text,
  equipment text,
  judging_standard text,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility text,
  safety text,
  how_it_works text,
  acknowledgments jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_age int NOT NULL DEFAULT 18,
  reg_fields jsonb NOT NULL DEFAULT '{"phone":"optional","instagram":"optional"}'::jsonb,
  tiebreak text NOT NULL DEFAULT 'shared',
  tiebreak_note text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Winnipeg',
  registration_closes_at timestamptz,
  location_name text,
  location_address text,
  city text,
  max_participants int,
  entry_fee text NOT NULL DEFAULT 'Free',
  self_registration boolean NOT NULL DEFAULT true,
  registration_open boolean NOT NULL DEFAULT true,
  cover_path text,
  now_up_entry uuid,
  now_up_at timestamptz,
  published_at timestamptz,
  results_finalized_at timestamptz,
  finalized_by uuid,
  copied_from uuid REFERENCES public.challenges(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenges_slug_ok CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60),
  CONSTRAINT challenges_title_ok CHECK (length(btrim(title)) BETWEEN 3 AND 90),
  CONSTRAINT challenges_status_ok CHECK (status IN ('draft','upcoming','live','paused','verifying','completed','archived','cancelled')),
  CONSTRAINT challenges_template_draft CHECK (NOT is_template OR status = 'draft'),
  CONSTRAINT challenges_metric_ok CHECK (
    (metric = 'reps' AND unit = 'reps') OR
    (metric = 'weight' AND unit IN ('lb','kg')) OR
    (metric = 'time' AND unit = 's') OR
    (metric = 'distance' AND unit IN ('m','km','mi')) OR
    (metric = 'points' AND unit IN ('pts','cal'))),
  CONSTRAINT challenges_direction_ok CHECK (direction IN ('higher','lower')),
  CONSTRAINT challenges_scoring_ok CHECK (scoring IN ('best','total','bodyweight_ratio') AND (scoring <> 'bodyweight_ratio' OR metric = 'weight')),
  CONSTRAINT challenges_attempts_ok CHECK (attempts_allowed BETWEEN 1 AND 10),
  CONSTRAINT challenges_tiebreak_ok CHECK (tiebreak IN ('shared','bodyweight_lower','fewer_attempts','next_best')),
  CONSTRAINT challenges_load_ok CHECK ((load_value IS NULL OR load_value > 0) AND (load_unit IS NULL OR load_unit IN ('lb','kg'))),
  CONSTRAINT challenges_timecap_ok CHECK (time_cap_seconds IS NULL OR time_cap_seconds BETWEEN 1 AND 86400),
  CONSTRAINT challenges_lists_ok CHECK (jsonb_typeof(rules) = 'array' AND jsonb_typeof(acknowledgments) = 'array' AND jsonb_typeof(reg_fields) = 'object'),
  CONSTRAINT challenges_lengths_ok CHECK (
    coalesce(length(tagline), 0) <= 140 AND coalesce(length(description), 0) <= 4000 AND
    coalesce(length(objective), 0) <= 300 AND coalesce(length(activity), 0) <= 80 AND
    coalesce(length(equipment), 0) <= 1000 AND coalesce(length(judging_standard), 0) <= 2000 AND
    coalesce(length(eligibility), 0) <= 2000 AND coalesce(length(safety), 0) <= 4000 AND
    coalesce(length(how_it_works), 0) <= 4000 AND coalesce(length(tiebreak_note), 0) <= 500 AND
    coalesce(length(location_name), 0) <= 120 AND coalesce(length(location_address), 0) <= 200 AND
    coalesce(length(city), 0) <= 80 AND length(entry_fee) <= 60),
  CONSTRAINT challenges_age_ok CHECK (min_age BETWEEN 0 AND 99),
  CONSTRAINT challenges_cap_ok CHECK (max_participants IS NULL OR max_participants BETWEEN 1 AND 10000),
  CONSTRAINT challenges_dates_ok CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.challenge_divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  description text CHECK (coalesce(length(description), 0) <= 200),
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_divisions_challenge ON public.challenge_divisions (challenge_id, sort);

CREATE TABLE IF NOT EXISTS public.challenge_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  url text CHECK (url IS NULL OR url ~* '^https?://'),
  logo_path text,
  blurb text CHECK (coalesce(length(blurb), 0) <= 200),
  sort int NOT NULL DEFAULT 0,
  -- private: what they gave (never on a public page)
  contribution_cents int CHECK (contribution_cents IS NULL OR contribution_cents >= 0),
  contribution_note text CHECK (coalesce(length(contribution_note), 0) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_sponsors_challenge ON public.challenge_sponsors (challenge_id, sort);

CREATE TABLE IF NOT EXISTS public.challenge_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  place int NOT NULL CHECK (place BETWEEN 1 AND 100),
  division_id uuid REFERENCES public.challenge_divisions(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  description text CHECK (coalesce(length(description), 0) <= 500),
  value_cents int CHECK (value_cents IS NULL OR value_cents >= 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  sponsor_id uuid REFERENCES public.challenge_sponsors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_prizes_challenge ON public.challenge_prizes (challenge_id, place);

CREATE TABLE IF NOT EXISTS public.challenge_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_updates_challenge ON public.challenge_updates (challenge_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.challenge_staff (
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('manager','judge','registrar')),
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS challenge_staff_user ON public.challenge_staff (user_id);

-- One person, every challenge they enter.
CREATE TABLE IF NOT EXISTS public.challenge_athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle) BETWEEN 2 AND 40),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 40),
  instagram text CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  photo_path text,
  photo_consent_at timestamptz,
  user_id uuid UNIQUE,
  discoverable boolean NOT NULL DEFAULT true,
  merged_into uuid REFERENCES public.challenge_athletes(id) ON DELETE SET NULL,
  photo_nonce text,
  photo_nonce_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Private: only the owner (admin) and the challenge's manager ever see it.
CREATE TABLE IF NOT EXISTS public.challenge_athlete_private (
  athlete_id uuid PRIMARY KEY REFERENCES public.challenge_athletes(id) ON DELETE CASCADE,
  full_name text CHECK (coalesce(length(full_name), 0) <= 80),
  email text CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254)),
  phone text CHECK (coalesce(length(phone), 0) <= 30),
  marketing_opt_in boolean NOT NULL DEFAULT false,
  marketing_opt_in_at timestamptz,
  erased_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS challenge_athlete_private_email ON public.challenge_athlete_private (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.challenge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.challenge_athletes(id),
  division_id uuid REFERENCES public.challenge_divisions(id) ON DELETE SET NULL,
  bib int NOT NULL CHECK (bib BETWEEN 1 AND 99999),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','checked_in','withdrawn','disqualified')),
  status_reason text CHECK (coalesce(length(status_reason), 0) <= 300),
  source text NOT NULL CHECK (source IN ('staff','self')),
  registered_by uuid,
  referred_by uuid REFERENCES public.challenge_athletes(id) ON DELETE SET NULL,
  arrived_via text CHECK (arrived_via IS NULL OR arrived_via IN ('qr','link','friend','staff')),
  show_name boolean NOT NULL DEFAULT true,
  photo_consent boolean NOT NULL DEFAULT false,
  acknowledged jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at timestamptz,
  bodyweight_kg numeric(6,2) CHECK (bodyweight_kg IS NULL OR bodyweight_kg BETWEEN 20 AND 400),
  checked_in_at timestamptz,
  checked_in_by uuid,
  final_rank int,
  final_division_rank int,
  final_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, athlete_id),
  UNIQUE (challenge_id, bib)
);
CREATE INDEX IF NOT EXISTS challenge_entries_athlete ON public.challenge_entries (athlete_id);

CREATE TABLE IF NOT EXISTS public.challenge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
  attempt_no int NOT NULL CHECK (attempt_no BETWEEN 1 AND 10),
  value numeric(12,3) NOT NULL CHECK (value >= 0),
  result text NOT NULL CHECK (result IN ('valid','no_lift')),
  voided boolean NOT NULL DEFAULT false,
  void_reason text,
  note text CHECK (coalesce(length(note), 0) <= 500),
  video_url text CHECK (video_url IS NULL OR (video_url ~* '^https://' AND length(video_url) <= 500)),
  judge_id uuid,
  judged_at timestamptz NOT NULL DEFAULT now(),
  client_key uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_attempts_challenge ON public.challenge_attempts (challenge_id, judged_at DESC);
CREATE INDEX IF NOT EXISTS challenge_attempts_entry ON public.challenge_attempts (entry_id, attempt_no);
CREATE UNIQUE INDEX IF NOT EXISTS challenge_attempts_one_per_no ON public.challenge_attempts (entry_id, attempt_no) WHERE NOT voided;

-- A prize won: one row per winner (a tie splits a prize, `share`).
CREATE TABLE IF NOT EXISTS public.challenge_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  prize_id uuid NOT NULL REFERENCES public.challenge_prizes(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
  share numeric(6,4) NOT NULL DEFAULT 1 CHECK (share > 0 AND share <= 1),
  status text NOT NULL DEFAULT 'to_notify' CHECK (status IN ('to_notify','notified','claimed','unclaimed','forfeited')),
  notified_at timestamptz,
  notified_via text CHECK (coalesce(length(notified_via), 0) <= 40),
  claim_deadline date,
  collection_instructions text CHECK (coalesce(length(collection_instructions), 0) <= 1000),
  claimed_at timestamptz,
  notes text CHECK (coalesce(length(notes), 0) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prize_id, entry_id)
);

CREATE TABLE IF NOT EXISTS public.challenge_audit (
  id bigserial PRIMARY KEY,
  challenge_id uuid NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  actor uuid,
  reason text,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_audit_challenge ON public.challenge_audit (challenge_id, at DESC);

-- Measured, privacy-conscious analytics: a random per-browser id, never an IP or a name.
CREATE TABLE IF NOT EXISTS public.challenge_events (
  id bigserial PRIMARY KEY,
  challenge_id uuid REFERENCES public.challenges(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.challenge_athletes(id) ON DELETE SET NULL,
  kind text NOT NULL,
  ref_athlete uuid REFERENCES public.challenge_athletes(id) ON DELETE SET NULL,
  source text,
  visitor text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_events_challenge ON public.challenge_events (challenge_id, kind, at DESC);
CREATE INDEX IF NOT EXISTS challenge_events_visitor ON public.challenge_events (visitor, kind, at DESC);

-- Self-registration throttle (hashed, per challenge; kept a day).
CREATE TABLE IF NOT EXISTS public.challenge_reg_log (
  id bigserial PRIMARY KEY,
  challenge_id uuid NOT NULL,
  ip_hash text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_reg_log_lookup ON public.challenge_reg_log (challenge_id, ip_hash, at DESC);

-- The only thing the live pages subscribe to: a version number per challenge.
CREATE TABLE IF NOT EXISTS public.challenge_live (
  challenge_id uuid PRIMARY KEY REFERENCES public.challenges(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Who's who ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_is_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_role((SELECT auth.uid()), 'admin'::app_role), false)
$$;

CREATE OR REPLACE FUNCTION public.challenge_role(p_challenge uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text;
BEGIN
  IF uid IS NULL OR p_challenge IS NULL THEN RETURN NULL; END IF;
  IF public.has_role(uid, 'admin'::app_role) THEN RETURN 'owner'; END IF;
  SELECT s.role INTO r FROM public.challenge_staff s WHERE s.challenge_id = p_challenge AND s.user_id = uid;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.challenge_can(p_challenge uuid, p_need text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := public.challenge_role(p_challenge);
BEGIN
  RETURN coalesce(CASE p_need
    WHEN 'manage'   THEN r IN ('owner','manager')
    WHEN 'contacts' THEN r IN ('owner','manager')
    WHEN 'judge'    THEN r IN ('owner','manager','judge')
    WHEN 'register' THEN r IN ('owner','manager','judge','registrar')
    WHEN 'staff'    THEN r IS NOT NULL
    ELSE false END, false);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_public_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.challenges WHERE status <> 'draft' AND NOT is_template
$$;

CREATE OR REPLACE FUNCTION public.challenge_staff_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.challenges c WHERE (SELECT public.challenge_is_owner())
  UNION
  SELECT s.challenge_id FROM public.challenge_staff s WHERE s.user_id = (SELECT auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.challenge_managed_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.challenges c WHERE (SELECT public.challenge_is_owner())
  UNION
  SELECT s.challenge_id FROM public.challenge_staff s WHERE s.user_id = (SELECT auth.uid()) AND s.role = 'manager'
$$;

-- ── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_athlete_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_reg_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_live ENABLE ROW LEVEL SECURITY;

-- People, entries, scores, prizes won, the audit and analytics: functions only.
REVOKE ALL ON public.challenge_athletes, public.challenge_athlete_private, public.challenge_entries,
  public.challenge_attempts, public.challenge_awards, public.challenge_audit, public.challenge_events,
  public.challenge_reg_log, public.challenge_staff FROM anon, authenticated;
REVOKE ALL ON public.challenges, public.challenge_divisions, public.challenge_sponsors,
  public.challenge_prizes, public.challenge_updates, public.challenge_live FROM anon;
GRANT SELECT ON public.challenge_live TO anon;
REVOKE INSERT, UPDATE, DELETE ON public.challenge_live FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.challenges, public.challenge_divisions, public.challenge_sponsors,
  public.challenge_prizes, public.challenge_updates, public.challenge_live FROM authenticated;

DROP POLICY IF EXISTS "Challenge staff read" ON public.challenges;
CREATE POLICY "Challenge staff read" ON public.challenges FOR SELECT TO authenticated
  USING (id IN (SELECT public.challenge_staff_ids()));
DROP POLICY IF EXISTS "Owner creates challenges" ON public.challenges;
CREATE POLICY "Owner creates challenges" ON public.challenges FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.challenge_is_owner()));
DROP POLICY IF EXISTS "Managers edit challenges" ON public.challenges;
CREATE POLICY "Managers edit challenges" ON public.challenges FOR UPDATE TO authenticated
  USING (id IN (SELECT public.challenge_managed_ids()))
  WITH CHECK (id IN (SELECT public.challenge_managed_ids()));
DROP POLICY IF EXISTS "Owner deletes challenges" ON public.challenges;
CREATE POLICY "Owner deletes challenges" ON public.challenges FOR DELETE TO authenticated
  USING ((SELECT public.challenge_is_owner()));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['challenge_divisions','challenge_sponsors','challenge_prizes','challenge_updates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Challenge staff read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Challenge staff read" ON public.%I FOR SELECT TO authenticated USING (challenge_id IN (SELECT public.challenge_staff_ids()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Managers write" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Managers write" ON public.%I FOR ALL TO authenticated USING (challenge_id IN (SELECT public.challenge_managed_ids())) WITH CHECK (challenge_id IN (SELECT public.challenge_managed_ids()))', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Public challenge versions" ON public.challenge_live;
CREATE POLICY "Public challenge versions" ON public.challenge_live FOR SELECT TO anon, authenticated
  USING (challenge_id IN (SELECT public.challenge_public_ids()) OR challenge_id IN (SELECT public.challenge_staff_ids()));

-- ── Live version + audit + guards ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public._challenge_bump(p_challenge uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.challenge_live SET version = version + 1, updated_at = now() WHERE challenge_id = p_challenge;
  IF NOT FOUND THEN
    -- (skipped while a deleted challenge's rows cascade away)
    INSERT INTO public.challenge_live (challenge_id)
    SELECT p_challenge WHERE EXISTS (SELECT 1 FROM public.challenges c WHERE c.id = p_challenge)
    ON CONFLICT (challenge_id) DO UPDATE SET version = public.challenge_live.version + 1, updated_at = now();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tg_challenge_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  IF TG_TABLE_NAME = 'challenges' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    cid := NEW.id;
  ELSE
    cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.challenge_id ELSE NEW.challenge_id END;
  END IF;
  PERFORM public._challenge_bump(cid);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS challenge_bump ON public.challenges;
CREATE TRIGGER challenge_bump AFTER INSERT OR UPDATE ON public.challenges FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_bump();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['challenge_entries','challenge_attempts','challenge_divisions','challenge_prizes','challenge_sponsors','challenge_updates','challenge_awards'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS challenge_bump ON public.%I', t);
    EXECUTE format('CREATE TRIGGER challenge_bump AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_bump()', t);
  END LOOP;
END $$;

-- An athlete's name or photo shows on every board they're on.
CREATE OR REPLACE FUNCTION public.tg_challenge_athlete_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  NEW.updated_at := now();
  IF (NEW.display_name, NEW.photo_path, NEW.discoverable) IS DISTINCT FROM (OLD.display_name, OLD.photo_path, OLD.discoverable) THEN
    FOR cid IN SELECT e.challenge_id FROM public.challenge_entries e WHERE e.athlete_id = NEW.id LOOP
      PERFORM public._challenge_bump(cid);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS challenge_athlete_bump ON public.challenge_athletes;
CREATE TRIGGER challenge_athlete_bump BEFORE UPDATE ON public.challenge_athletes FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_athlete_bump();

CREATE OR REPLACE FUNCTION public.tg_challenge_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reason text := nullif(current_setting('jf.challenge_reason', true), '');
BEGIN
  IF TG_TABLE_NAME = 'challenges' THEN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.challenge_audit (challenge_id, entity, entity_id, action, actor, reason, before, after)
      VALUES (NEW.id, 'challenge', NEW.id, 'status', auth.uid(), reason,
        jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status));
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'challenge_entries' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.challenge_audit (challenge_id, entity, entity_id, action, actor, after)
      VALUES (NEW.challenge_id, 'entry', NEW.id, 'register', auth.uid(),
        jsonb_build_object('bib', NEW.bib, 'source', NEW.source, 'division_id', NEW.division_id));
    ELSIF (NEW.status, NEW.division_id, NEW.bodyweight_kg, NEW.show_name, NEW.athlete_id)
       IS DISTINCT FROM (OLD.status, OLD.division_id, OLD.bodyweight_kg, OLD.show_name, OLD.athlete_id) THEN
      INSERT INTO public.challenge_audit (challenge_id, entity, entity_id, action, actor, reason, before, after)
      VALUES (NEW.challenge_id, 'entry', NEW.id, 'update', auth.uid(), reason,
        jsonb_build_object('status', OLD.status, 'division_id', OLD.division_id, 'bodyweight_kg', OLD.bodyweight_kg, 'show_name', OLD.show_name, 'athlete_id', OLD.athlete_id),
        jsonb_build_object('status', NEW.status, 'division_id', NEW.division_id, 'bodyweight_kg', NEW.bodyweight_kg, 'show_name', NEW.show_name, 'athlete_id', NEW.athlete_id));
    END IF;
    RETURN NEW;
  ELSE -- attempts
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.challenge_audit (challenge_id, entity, entity_id, action, actor, after)
      VALUES (NEW.challenge_id, 'attempt', NEW.id, 'record', auth.uid(),
        jsonb_build_object('entry_id', NEW.entry_id, 'attempt_no', NEW.attempt_no, 'value', NEW.value, 'result', NEW.result));
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      INSERT INTO public.challenge_audit (challenge_id, entity, entity_id, action, actor, reason, before, after)
      VALUES (NEW.challenge_id, 'attempt', NEW.id, CASE WHEN NEW.voided AND NOT OLD.voided THEN 'void' ELSE 'correct' END, auth.uid(), reason,
        jsonb_build_object('value', OLD.value, 'result', OLD.result, 'voided', OLD.voided, 'note', OLD.note),
        jsonb_build_object('value', NEW.value, 'result', NEW.result, 'voided', NEW.voided, 'note', NEW.note));
      RETURN NEW;
    ELSE
      INSERT INTO public.challenge_audit (challenge_id, entity, entity_id, action, actor, reason, before)
      VALUES (OLD.challenge_id, 'attempt', OLD.id, 'delete', auth.uid(), reason, to_jsonb(OLD));
      RETURN OLD;
    END IF;
  END IF;
END $$;
DROP TRIGGER IF EXISTS challenge_audit ON public.challenges;
CREATE TRIGGER challenge_audit AFTER UPDATE ON public.challenges FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_audit();
DROP TRIGGER IF EXISTS challenge_audit ON public.challenge_entries;
CREATE TRIGGER challenge_audit AFTER INSERT OR UPDATE ON public.challenge_entries FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_audit();
DROP TRIGGER IF EXISTS challenge_audit ON public.challenge_attempts;
CREATE TRIGGER challenge_audit AFTER INSERT OR UPDATE OR DELETE ON public.challenge_attempts FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_audit();

-- Status, publishing and final results move only through the functions below;
-- scoring and the tie-break can't change once the competition has started.
CREATE OR REPLACE FUNCTION public.tg_challenge_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE via_rpc boolean := coalesce(current_setting('jf.challenge_rpc', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT via_rpc THEN
      NEW.status := 'draft';
      NEW.published_at := NULL; NEW.results_finalized_at := NULL; NEW.finalized_by := NULL;
    END IF;
    NEW.created_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.challenge_id = OLD.id) THEN
      RAISE EXCEPTION 'This challenge has participants, so it''s kept. Cancel or archive it instead.' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF NOT via_rpc AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.results_finalized_at IS DISTINCT FROM OLD.results_finalized_at
    OR NEW.finalized_by IS DISTINCT FROM OLD.finalized_by
    OR NEW.is_template IS DISTINCT FROM OLD.is_template AND OLD.status <> 'draft'
    OR NEW.now_up_entry IS DISTINCT FROM OLD.now_up_entry) THEN
    RAISE EXCEPTION 'Use the challenge''s controls to change its status.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT via_rpc
     AND (OLD.status IN ('live','paused','verifying','completed','archived')
          OR EXISTS (SELECT 1 FROM public.challenge_attempts a WHERE a.challenge_id = OLD.id AND NOT a.voided))
     AND (NEW.metric, NEW.unit, NEW.direction, NEW.scoring, NEW.tiebreak, NEW.attempts_allowed, NEW.load_value, NEW.load_unit)
         IS DISTINCT FROM (OLD.metric, OLD.unit, OLD.direction, OLD.scoring, OLD.tiebreak, OLD.attempts_allowed, OLD.load_value, OLD.load_unit) THEN
    RAISE EXCEPTION 'Scoring and the tie-break are locked once the challenge has started.' USING ERRCODE = 'P0001';
  END IF;
  NEW.id := OLD.id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS challenge_guard ON public.challenges;
CREATE TRIGGER challenge_guard BEFORE INSERT OR UPDATE OR DELETE ON public.challenges FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_guard();

-- ── Standings ──────────────────────────────────────────────────────────
-- Competition ranking. A tie stays a tie unless the published tie-break
-- separates everyone in it (a missing bodyweight never loses a tie).

CREATE OR REPLACE FUNCTION public._challenge_standings(p_challenge uuid)
RETURNS TABLE (entry_id uuid, division_id uuid, score numeric, best numeric, attempts_used int, valid_count int,
               rank int, division_rank int, tied boolean, division_tied boolean, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH c AS (
  SELECT ch.direction, ch.scoring, ch.tiebreak, ch.unit FROM public.challenges ch WHERE ch.id = p_challenge
),
att AS (
  SELECT a.entry_id, a.attempt_no, a.value, a.result, a.judged_at,
    CASE WHEN a.result = 'valid' THEN row_number() OVER (
      PARTITION BY a.entry_id, (a.result = 'valid')
      ORDER BY CASE WHEN c.direction = 'higher' THEN -a.value ELSE a.value END, a.attempt_no) END AS vrank
  FROM public.challenge_attempts a CROSS JOIN c
  WHERE a.challenge_id = p_challenge AND NOT a.voided
),
per AS (
  SELECT e.id AS entry_id, e.division_id, e.bodyweight_kg,
    count(att.attempt_no)::int AS attempts_used,
    (count(att.attempt_no) FILTER (WHERE att.result = 'valid'))::int AS valid_count,
    max(att.value) FILTER (WHERE att.vrank = 1) AS best,
    max(att.value) FILTER (WHERE att.vrank = 2) AS second,
    min(att.attempt_no) FILTER (WHERE att.vrank = 1) AS best_no,
    sum(att.value) FILTER (WHERE att.result = 'valid') AS total,
    max(att.judged_at) AS last_at
  FROM public.challenge_entries e
  LEFT JOIN att ON att.entry_id = e.id
  WHERE e.challenge_id = p_challenge AND e.status IN ('registered','checked_in')
  GROUP BY e.id, e.division_id, e.bodyweight_kg
),
scored AS (
  SELECT per.*, c.direction, c.tiebreak,
    CASE c.scoring
      WHEN 'total' THEN per.total
      WHEN 'bodyweight_ratio' THEN CASE WHEN per.bodyweight_kg > 0 AND per.best IS NOT NULL
        THEN round((CASE WHEN c.unit = 'lb' THEN per.best / 2.20462 ELSE per.best END) / per.bodyweight_kg, 4) END
      ELSE per.best END AS score
  FROM per CROSS JOIN c
),
keyed AS (
  SELECT s.*,
    CASE WHEN s.direction = 'higher' THEN -s.score ELSE s.score END AS k1,
    CASE s.tiebreak
      WHEN 'bodyweight_lower' THEN s.bodyweight_kg
      WHEN 'fewer_attempts' THEN s.best_no::numeric
      WHEN 'next_best' THEN CASE WHEN s.direction = 'higher' THEN coalesce(-s.second, 1e15) ELSE coalesce(s.second, 1e15) END
      ELSE NULL END AS k2
  FROM scored s WHERE s.score IS NOT NULL
),
grouped AS (
  SELECT k.*,
    bool_and(k.k2 IS NOT NULL) OVER (PARTITION BY k.k1) AS can_break,
    bool_and(k.k2 IS NOT NULL) OVER (PARTITION BY k.division_id, k.k1) AS can_break_div
  FROM keyed k
),
ranked AS (
  SELECT g.*,
    (rank() OVER (ORDER BY g.k1, CASE WHEN g.can_break THEN g.k2 END))::int AS rnk,
    (rank() OVER (PARTITION BY g.division_id ORDER BY g.k1, CASE WHEN g.can_break_div THEN g.k2 END))::int AS drnk
  FROM grouped g
)
SELECT r.entry_id, r.division_id, r.score, r.best, r.attempts_used, r.valid_count, r.rnk, r.drnk,
  count(*) OVER (PARTITION BY r.rnk) > 1,
  count(*) OVER (PARTITION BY r.division_id, r.drnk) > 1,
  r.last_at
FROM ranked r
$$;

-- What the public sees of a challenge (never contacts, contributions or staff).
CREATE OR REPLACE FUNCTION public._challenge_public_json(c public.challenges)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'title', c.title, 'tagline', c.tagline, 'description', c.description,
    'status', c.status, 'activity', c.activity, 'metric', c.metric, 'unit', c.unit, 'direction', c.direction,
    'scoring', c.scoring, 'attempts_allowed', c.attempts_allowed, 'load_value', c.load_value, 'load_unit', c.load_unit,
    'time_cap_seconds', c.time_cap_seconds, 'objective', c.objective, 'equipment', c.equipment,
    'judging_standard', c.judging_standard, 'rules', c.rules, 'eligibility', c.eligibility, 'safety', c.safety,
    'how_it_works', c.how_it_works, 'acknowledgments', c.acknowledgments, 'min_age', c.min_age,
    'reg_fields', c.reg_fields, 'tiebreak', c.tiebreak, 'tiebreak_note', c.tiebreak_note,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'timezone', c.timezone,
    'registration_closes_at', c.registration_closes_at, 'location_name', c.location_name,
    'location_address', c.location_address, 'city', c.city, 'max_participants', c.max_participants,
    'entry_fee', c.entry_fee, 'self_registration', c.self_registration, 'registration_open', c.registration_open,
    'cover_path', c.cover_path, 'published_at', c.published_at, 'final', c.results_finalized_at IS NOT NULL,
    'finalized_at', c.results_finalized_at, 'is_template', c.is_template)
$$;

CREATE OR REPLACE FUNCTION public._challenge_visible(c public.challenges)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id IS NOT NULL AND ((c.status <> 'draft' AND NOT c.is_template) OR public.challenge_can(c.id, 'staff'))
$$;

-- Can a new person sign up right now?
CREATE OR REPLACE FUNCTION public._challenge_reg_state(c public.challenges)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN c.is_template OR c.status NOT IN ('upcoming','live','paused') THEN 'closed'
    WHEN NOT c.registration_open THEN 'closed'
    WHEN c.registration_closes_at IS NOT NULL AND now() > c.registration_closes_at THEN 'closed'
    WHEN c.max_participants IS NOT NULL AND (SELECT count(*) FROM public.challenge_entries e
          WHERE e.challenge_id = c.id AND e.status IN ('registered','checked_in')) >= c.max_participants THEN 'full'
    ELSE 'open' END
$$;

-- ── Public reads ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_hub()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(card ORDER BY sort_group, sort_at), '[]'::jsonb)
  FROM (
    SELECT
      public._challenge_public_json(c) || jsonb_build_object(
        'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status IN ('registered','checked_in')),
        'competed', (SELECT count(DISTINCT a.entry_id) FROM public.challenge_attempts a JOIN public.challenge_entries e ON e.id = a.entry_id
                     WHERE a.challenge_id = c.id AND NOT a.voided AND e.status IN ('registered','checked_in')),
        'registration', public._challenge_reg_state(c),
        'prize', (SELECT p.title FROM public.challenge_prizes p WHERE p.challenge_id = c.id ORDER BY p.place, p.division_id NULLS FIRST LIMIT 1),
        'leader', CASE WHEN c.status IN ('cancelled','upcoming') THEN NULL
          WHEN c.results_finalized_at IS NOT NULL THEN (
            SELECT jsonb_build_object('name', CASE WHEN e.show_name THEN a.display_name ELSE 'Athlete #' || e.bib END,
              'photo', CASE WHEN e.show_name THEN a.photo_path END, 'score', e.final_score)
            FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
            WHERE e.challenge_id = c.id AND e.final_rank = 1 ORDER BY e.bib LIMIT 1)
          ELSE (
            SELECT jsonb_build_object('name', CASE WHEN e.show_name THEN a.display_name ELSE 'Athlete #' || e.bib END,
              'photo', CASE WHEN e.show_name THEN a.photo_path END, 'score', st.score)
            FROM public._challenge_standings(c.id) st
            JOIN public.challenge_entries e ON e.id = st.entry_id JOIN public.challenge_athletes a ON a.id = e.athlete_id
            WHERE st.rank = 1 ORDER BY e.bib LIMIT 1) END
      ) AS card,
      CASE c.status WHEN 'live' THEN 0 WHEN 'paused' THEN 0 WHEN 'verifying' THEN 1 WHEN 'upcoming' THEN 2 ELSE 3 END AS sort_group,
      CASE WHEN c.status IN ('completed','archived','cancelled') THEN -extract(epoch FROM coalesce(c.starts_at, c.created_at))
           ELSE extract(epoch FROM coalesce(c.starts_at, c.created_at)) END AS sort_at
    FROM public.challenges c
    WHERE c.status <> 'draft' AND NOT c.is_template
  ) x
$$;

CREATE OR REPLACE FUNCTION public.challenge_page(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; v jsonb; uid uuid := auth.uid(); mine jsonb;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(p_slug);
  IF NOT FOUND OR NOT public._challenge_visible(c) THEN RETURN NULL; END IF;
  IF uid IS NOT NULL THEN
    SELECT jsonb_build_object('bib', e.bib, 'handle', a.handle, 'status', e.status, 'entry_id', e.id)
      INTO mine
    FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
    WHERE e.challenge_id = c.id AND a.user_id = uid LIMIT 1;
  END IF;
  v := jsonb_build_object(
    'challenge', public._challenge_public_json(c),
    'version', coalesce((SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id), 0),
    'registration', public._challenge_reg_state(c),
    'preview', c.status = 'draft' OR c.is_template,
    'divisions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'description', d.description) ORDER BY d.sort, d.created_at)
                  FROM public.challenge_divisions d WHERE d.challenge_id = c.id), '[]'::jsonb),
    'prizes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'place', p.place, 'division_id', p.division_id,
                    'title', p.title, 'description', p.description,
                    'sponsor', (SELECT s.name FROM public.challenge_sponsors s WHERE s.id = p.sponsor_id)) ORDER BY p.place, p.created_at)
                  FROM public.challenge_prizes p WHERE p.challenge_id = c.id), '[]'::jsonb),
    'sponsors', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'logo_path', s.logo_path, 'blurb', s.blurb) ORDER BY s.sort, s.created_at)
                  FROM public.challenge_sponsors s WHERE s.challenge_id = c.id), '[]'::jsonb),
    'updates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'at', u.created_at) ORDER BY u.created_at DESC)
                  FROM (SELECT * FROM public.challenge_updates u0 WHERE u0.challenge_id = c.id ORDER BY u0.created_at DESC LIMIT 20) u), '[]'::jsonb),
    'counts', jsonb_build_object(
      'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status IN ('registered','checked_in')),
      'competed', (SELECT count(DISTINCT a.entry_id) FROM public.challenge_attempts a JOIN public.challenge_entries e ON e.id = a.entry_id
                   WHERE a.challenge_id = c.id AND NOT a.voided AND e.status IN ('registered','checked_in'))),
    'winners', CASE WHEN c.results_finalized_at IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object('place', p.place, 'division_id', p.division_id, 'prize', p.title, 'share', w.share,
          'name', CASE WHEN e.show_name THEN a.display_name ELSE 'Athlete #' || e.bib END,
          'handle', CASE WHEN e.show_name THEN a.handle END,
          'photo', CASE WHEN e.show_name THEN a.photo_path END,
          'score', e.final_score, 'rank', e.final_rank, 'division_rank', e.final_division_rank)
        ORDER BY p.place, e.bib)
      FROM public.challenge_awards w
      JOIN public.challenge_prizes p ON p.id = w.prize_id
      JOIN public.challenge_entries e ON e.id = w.entry_id
      JOIN public.challenge_athletes a ON a.id = e.athlete_id
      WHERE w.challenge_id = c.id AND w.status <> 'forfeited'), '[]'::jsonb) END,
    'viewer', jsonb_build_object('role', public.challenge_role(c.id), 'entry', mine)
  );
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public._challenge_entry_public(e public.challenge_entries, a public.challenge_athletes)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'bib', e.bib,
    'name', CASE WHEN e.show_name THEN a.display_name ELSE 'Athlete #' || e.bib END,
    'handle', CASE WHEN e.show_name THEN a.handle END,
    'listed', e.show_name AND a.discoverable,
    'photo', CASE WHEN e.show_name THEN a.photo_path END,
    'division_id', e.division_id)
$$;

CREATE OR REPLACE FUNCTION public.challenge_board(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; v_rows jsonb; v_recent jsonb; v_nowup jsonb; v_final boolean;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(p_slug);
  IF NOT FOUND OR NOT public._challenge_visible(c) THEN RETURN NULL; END IF;
  v_final := c.results_finalized_at IS NOT NULL;
  IF v_final THEN
    SELECT coalesce(jsonb_agg(public._challenge_entry_public(e, a) || jsonb_build_object(
        'rank', e.final_rank, 'division_rank', e.final_division_rank,
        'tied', (SELECT count(*) FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.final_rank = e.final_rank) > 1,
        'division_tied', (SELECT count(*) FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.final_division_rank = e.final_division_rank
                          AND x.division_id IS NOT DISTINCT FROM e.division_id) > 1,
        'score', e.final_score,
        'attempts', coalesce((SELECT jsonb_agg(jsonb_build_object('n', t.attempt_no, 'v', t.value, 'r', t.result) ORDER BY t.attempt_no)
                     FROM public.challenge_attempts t WHERE t.entry_id = e.id AND NOT t.voided), '[]'::jsonb))
      ORDER BY e.final_rank, e.bib), '[]'::jsonb)
    INTO v_rows
    FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
    WHERE e.challenge_id = c.id AND e.final_rank IS NOT NULL;
  ELSE
    SELECT coalesce(jsonb_agg(public._challenge_entry_public(e, a) || jsonb_build_object(
        'rank', s.rank, 'division_rank', s.division_rank, 'tied', s.tied, 'division_tied', s.division_tied,
        'score', s.score, 'best', s.best, 'last_at', s.last_at,
        'attempts', coalesce((SELECT jsonb_agg(jsonb_build_object('n', t.attempt_no, 'v', t.value, 'r', t.result) ORDER BY t.attempt_no)
                     FROM public.challenge_attempts t WHERE t.entry_id = e.id AND NOT t.voided), '[]'::jsonb))
      ORDER BY s.rank, e.bib), '[]'::jsonb)
    INTO v_rows
    FROM public._challenge_standings(c.id) s
    JOIN public.challenge_entries e ON e.id = s.entry_id
    JOIN public.challenge_athletes a ON a.id = e.athlete_id;
  END IF;

  SELECT coalesce(jsonb_agg(r ORDER BY (r->>'at') DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT public._challenge_entry_public(e, a) || jsonb_build_object('value', t.value, 'result', t.result, 'attempt', t.attempt_no, 'at', t.judged_at) AS r
    FROM public.challenge_attempts t
    JOIN public.challenge_entries e ON e.id = t.entry_id
    JOIN public.challenge_athletes a ON a.id = e.athlete_id
    WHERE t.challenge_id = c.id AND NOT t.voided AND e.status IN ('registered','checked_in')
    ORDER BY t.judged_at DESC LIMIT 8) q;

  IF c.now_up_entry IS NOT NULL AND c.status = 'live' AND c.now_up_at > now() - interval '30 minutes' THEN
    SELECT public._challenge_entry_public(e, a) || jsonb_build_object('at', c.now_up_at) INTO v_nowup
    FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
    WHERE e.id = c.now_up_entry AND e.status IN ('registered','checked_in');
  END IF;

  RETURN jsonb_build_object(
    'version', coalesce((SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id), 0),
    'status', c.status, 'final', v_final, 'rows', v_rows, 'recent', v_recent, 'now_up', v_nowup,
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status IN ('registered','checked_in')),
    'updated_at', now());
END $$;

-- One person's result in one challenge (the page their share card links to).
CREATE OR REPLACE FUNCTION public.challenge_result(p_slug text, p_handle text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; a public.challenge_athletes; e public.challenge_entries; s record;
  v_ranked int; v_div_ranked int; v_leader jsonb; v_above jsonb; v_final boolean; v_atts jsonb;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(p_slug);
  IF NOT FOUND OR NOT public._challenge_visible(c) THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.challenge_athletes WHERE handle = lower(p_handle);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF a.merged_into IS NOT NULL THEN
    RETURN jsonb_build_object('redirect', (SELECT x.handle FROM public.challenge_athletes x WHERE x.id = a.merged_into));
  END IF;
  SELECT * INTO e FROM public.challenge_entries WHERE challenge_id = c.id AND athlete_id = a.id;
  -- Someone who chose not to be named isn't findable by their handle.
  IF NOT FOUND OR (NOT e.show_name AND NOT coalesce(a.user_id = auth.uid(), false) AND NOT public.challenge_can(c.id, 'staff')) THEN
    RETURN NULL;
  END IF;
  v_final := c.results_finalized_at IS NOT NULL;
  IF v_final THEN
    SELECT e.final_rank AS rank, e.final_division_rank AS division_rank, e.final_score AS score,
      (SELECT count(*) FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.final_rank = e.final_rank) > 1 AS tied
      INTO s;
    SELECT count(*) INTO v_ranked FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.final_rank IS NOT NULL;
    SELECT count(*) INTO v_div_ranked FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.final_rank IS NOT NULL
      AND x.division_id IS NOT DISTINCT FROM e.division_id;
    SELECT jsonb_build_object('name', CASE WHEN x.show_name THEN xa.display_name ELSE 'Athlete #' || x.bib END, 'score', x.final_score)
      INTO v_leader FROM public.challenge_entries x JOIN public.challenge_athletes xa ON xa.id = x.athlete_id
      WHERE x.challenge_id = c.id AND x.final_rank = 1 ORDER BY x.bib LIMIT 1;
  ELSE
    SELECT st.rank, st.division_rank, st.score, st.tied INTO s FROM public._challenge_standings(c.id) st WHERE st.entry_id = e.id;
    SELECT count(*) INTO v_ranked FROM public._challenge_standings(c.id);
    SELECT count(*) INTO v_div_ranked FROM public._challenge_standings(c.id) st WHERE st.division_id IS NOT DISTINCT FROM e.division_id;
    SELECT jsonb_build_object('name', CASE WHEN x.show_name THEN xa.display_name ELSE 'Athlete #' || x.bib END, 'score', st.score)
      INTO v_leader FROM public._challenge_standings(c.id) st
      JOIN public.challenge_entries x ON x.id = st.entry_id JOIN public.challenge_athletes xa ON xa.id = x.athlete_id
      WHERE st.rank = 1 ORDER BY x.bib LIMIT 1;
    IF s.rank IS NOT NULL AND s.rank > 1 THEN
      SELECT jsonb_build_object('name', CASE WHEN x.show_name THEN xa.display_name ELSE 'Athlete #' || x.bib END, 'score', st.score, 'rank', st.rank)
        INTO v_above FROM public._challenge_standings(c.id) st
        JOIN public.challenge_entries x ON x.id = st.entry_id JOIN public.challenge_athletes xa ON xa.id = x.athlete_id
        WHERE st.rank < s.rank ORDER BY st.rank DESC, x.bib LIMIT 1;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('n', t.attempt_no, 'v', t.value, 'r', t.result, 'at', t.judged_at) ORDER BY t.attempt_no), '[]'::jsonb)
    INTO v_atts FROM public.challenge_attempts t WHERE t.entry_id = e.id AND NOT t.voided;
  RETURN jsonb_build_object(
    'challenge', public._challenge_public_json(c),
    'version', coalesce((SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id), 0),
    'athlete', public._challenge_entry_public(e, a) || jsonb_build_object('instagram', CASE WHEN e.show_name THEN a.instagram END,
                 'is_me', a.user_id IS NOT NULL AND a.user_id = auth.uid(), 'claimed', a.user_id IS NOT NULL),
    'division', (SELECT d.name FROM public.challenge_divisions d WHERE d.id = e.division_id),
    'status', e.status,
    'rank', s.rank, 'division_rank', s.division_rank, 'tied', coalesce(s.tied, false), 'score', s.score,
    'attempts', v_atts,
    'ranked', v_ranked, 'division_ranked', v_div_ranked,
    'divisions', (SELECT count(*) FROM public.challenge_divisions d WHERE d.challenge_id = c.id),
    'leader', v_leader, 'above', v_above, 'final', v_final,
    'won', coalesce((SELECT jsonb_agg(jsonb_build_object('prize', p.title, 'place', p.place, 'share', w.share))
             FROM public.challenge_awards w JOIN public.challenge_prizes p ON p.id = w.prize_id
             WHERE w.entry_id = e.id AND w.status <> 'forfeited'), '[]'::jsonb));
END $$;

-- An athlete's public profile: every challenge they've been named in.
CREATE OR REPLACE FUNCTION public.challenge_athlete(p_handle text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes; me boolean; hist jsonb;
BEGIN
  SELECT * INTO a FROM public.challenge_athletes WHERE handle = lower(p_handle);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF a.merged_into IS NOT NULL THEN
    RETURN jsonb_build_object('redirect', (SELECT x.handle FROM public.challenge_athletes x WHERE x.id = a.merged_into));
  END IF;
  me := a.user_id IS NOT NULL AND a.user_id = auth.uid();
  SELECT coalesce(jsonb_agg(h ORDER BY (h->>'starts_at') DESC NULLS LAST), '[]'::jsonb) INTO hist FROM (
    SELECT jsonb_build_object(
      'slug', c.slug, 'title', c.title, 'status', c.status, 'starts_at', coalesce(c.starts_at, c.created_at),
      'activity', c.activity, 'metric', c.metric, 'unit', c.unit, 'direction', c.direction, 'scoring', c.scoring,
      'load_value', c.load_value, 'load_unit', c.load_unit, 'city', c.city, 'final', c.results_finalized_at IS NOT NULL,
      'bib', e.bib, 'show_name', e.show_name, 'entry_status', e.status,
      'division', (SELECT d.name FROM public.challenge_divisions d WHERE d.id = e.division_id),
      'rank', CASE WHEN c.results_finalized_at IS NOT NULL THEN e.final_rank ELSE s.rank END,
      'score', CASE WHEN c.results_finalized_at IS NOT NULL THEN e.final_score ELSE s.score END,
      'field', CASE WHEN c.results_finalized_at IS NOT NULL
                 THEN (SELECT count(*) FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.final_rank IS NOT NULL)
                 ELSE (SELECT count(*) FROM public._challenge_standings(c.id)) END,
      'won', coalesce((SELECT jsonb_agg(p.title) FROM public.challenge_awards w JOIN public.challenge_prizes p ON p.id = w.prize_id
                       WHERE w.entry_id = e.id AND w.status <> 'forfeited'), '[]'::jsonb)) AS h
    FROM public.challenge_entries e
    JOIN public.challenges c ON c.id = e.challenge_id
    LEFT JOIN LATERAL (SELECT st.rank, st.score FROM public._challenge_standings(c.id) st WHERE st.entry_id = e.id) s
      ON c.results_finalized_at IS NULL
    WHERE e.athlete_id = a.id AND c.status <> 'draft' AND NOT c.is_template
      AND e.status <> 'withdrawn' AND (e.show_name OR me)
  ) q;
  IF NOT me AND jsonb_array_length(hist) = 0 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'handle', a.handle, 'name', a.display_name, 'photo', a.photo_path, 'instagram', a.instagram,
    'listed', a.discoverable, 'is_me', me, 'claimed', a.user_id IS NOT NULL, 'since', a.created_at,
    'history', hist);
END $$;

-- ── Analytics (measured: page loads and taps, never "posted") ─────────

CREATE OR REPLACE FUNCTION public.challenge_track(p_slug text, p_kind text, p_visitor text,
  p_handle text DEFAULT NULL, p_ref text DEFAULT NULL, p_source text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid; aid uuid; rid uuid; v text; src text;
BEGIN
  IF p_kind NOT IN ('page_view','result_view','profile_view','display_open','join_view','card_download','share_sheet',
                    'copy_link','copy_caption','invite_link','join_click','coaching_click','calendar_add') THEN RETURN; END IF;
  v := left(regexp_replace(coalesce(p_visitor, ''), '[^A-Za-z0-9-]', '', 'g'), 40);
  IF length(v) < 8 THEN RETURN; END IF;
  src := CASE WHEN p_source IN ('qr','link','friend','share','display','app') THEN p_source END;
  IF p_slug IS NOT NULL THEN
    SELECT c.id INTO cid FROM public.challenges c WHERE c.slug = lower(p_slug) AND c.status <> 'draft' AND NOT c.is_template;
    IF cid IS NULL THEN RETURN; END IF;
    -- staff browsing their own event don't count
    IF public.challenge_can(cid, 'staff') THEN RETURN; END IF;
  END IF;
  IF p_handle IS NOT NULL THEN SELECT x.id INTO aid FROM public.challenge_athletes x WHERE x.handle = lower(p_handle); END IF;
  IF p_ref IS NOT NULL THEN SELECT x.id INTO rid FROM public.challenge_athletes x WHERE x.handle = lower(p_ref); END IF;
  IF cid IS NULL AND aid IS NULL THEN RETURN; END IF;
  -- one of each per visitor per half hour
  IF EXISTS (SELECT 1 FROM public.challenge_events ev WHERE ev.visitor = v AND ev.kind = p_kind
             AND ev.challenge_id IS NOT DISTINCT FROM cid AND ev.athlete_id IS NOT DISTINCT FROM aid
             AND ev.at > now() - interval '30 minutes') THEN RETURN; END IF;
  -- a ceiling against floods
  IF (SELECT count(*) FROM public.challenge_events ev WHERE ev.challenge_id IS NOT DISTINCT FROM cid AND ev.at > now() - interval '1 minute') > 600 THEN RETURN; END IF;
  INSERT INTO public.challenge_events (challenge_id, athlete_id, kind, ref_athlete, source, visitor)
  VALUES (cid, aid, p_kind, rid, src, v);
END $$;

-- ── Registration ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._challenge_make_handle(p_name text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE base text; h text; i int := 1;
BEGIN
  base := trim(BOTH '-' FROM regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  base := left(base, 30);
  base := trim(BOTH '-' FROM base);
  IF length(base) < 2 THEN base := 'athlete'; END IF;
  h := base;
  -- words the challenge pages use in their own addresses (/challenges/<slug>/join …)
  WHILE h IN ('join','live','console','admin','new','edit','results','board','claim','me')
     OR EXISTS (SELECT 1 FROM public.challenge_athletes x WHERE x.handle = h) LOOP
    i := i + 1;
    h := base || '-' || i;
  END LOOP;
  RETURN h;
END $$;

CREATE OR REPLACE FUNCTION public._challenge_clean_ig(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN x ~ '^[A-Za-z0-9._]{1,30}$' THEN x END
  FROM (SELECT regexp_replace(regexp_replace(btrim(coalesce(p, '')), '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@|/.*$', '', 'g') AS x) q
$$;

-- Shared by staff and self registration. Returns the entry row as json.
CREATE OR REPLACE FUNCTION public._challenge_register(c public.challenges, p jsonb, p_source text, p_caller uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_disp text := btrim(coalesce(p->>'display_name', ''));
  v_full text := nullif(btrim(coalesce(p->>'full_name', '')), '');
  v_em text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_ph text := nullif(btrim(left(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+() -]', '', 'g'), 30)), '');
  v_ig text := public._challenge_clean_ig(p->>'instagram');
  v_acks jsonb := coalesce(p->'acks', '[]'::jsonb);
  v_photo boolean := coalesce((p->>'photo_consent')::boolean, false);
  v_show boolean := coalesce((p->>'show_name')::boolean, true);
  v_mkt boolean := coalesce((p->>'marketing')::boolean, false);
  v_bw numeric := nullif(p->>'bodyweight_kg', '')::numeric;
  v_checkin boolean := coalesce((p->>'check_in')::boolean, false);
  v_div uuid; v_ref uuid; v_login uuid; v_nonce text; v_bib int; v_via text; v_created boolean := false; v_trusted boolean;
  a public.challenge_athletes; e public.challenge_entries;
BEGIN
  IF length(v_disp) < 1 OR length(v_disp) > 40 THEN RAISE EXCEPTION 'Add the name to show on the leaderboard (up to 40 characters).' USING ERRCODE = 'P0001'; END IF;
  IF v_full IS NOT NULL AND length(v_full) > 80 THEN RAISE EXCEPTION 'That name is too long.' USING ERRCODE = 'P0001'; END IF;
  IF v_em IS NOT NULL AND (v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_em) > 254) THEN RAISE EXCEPTION 'That email doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF p_source = 'self' AND v_em IS NULL THEN RAISE EXCEPTION 'Add your email so we can send your result and reach you if you win.' USING ERRCODE = 'P0001'; END IF;
  IF p_source = 'self' AND coalesce(c.reg_fields->>'phone', 'optional') = 'required' AND v_ph IS NULL THEN
    RAISE EXCEPTION 'Add a phone number.' USING ERRCODE = 'P0001'; END IF;
  IF p_source = 'self' AND coalesce(c.reg_fields->>'instagram', 'optional') = 'required' AND v_ig IS NULL THEN
    RAISE EXCEPTION 'Add your Instagram handle.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(v_acks) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.acknowledgments) n WHERE NOT v_acks ? n) THEN
    RAISE EXCEPTION 'Every box under "Before you enter" has to be ticked to take part.' USING ERRCODE = 'P0001';
  END IF;
  IF v_bw IS NOT NULL AND (v_bw < 20 OR v_bw > 400) THEN RAISE EXCEPTION 'Check the bodyweight.' USING ERRCODE = 'P0001'; END IF;

  -- division (one division = everyone's in it)
  IF EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = c.id) THEN
    SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id::text = nullif(p->>'division_id', '');
    IF v_div IS NULL THEN
      IF (SELECT count(*) FROM public.challenge_divisions d WHERE d.challenge_id = c.id) = 1 THEN
        SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id;
      ELSE
        RAISE EXCEPTION 'Pick a division.' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF nullif(p->>'ref', '') IS NOT NULL THEN
    SELECT x.id INTO v_ref FROM public.challenge_athletes x WHERE x.handle = lower(p->>'ref') AND x.merged_into IS NULL;
  END IF;
  v_via := CASE WHEN p_source = 'staff' THEN 'staff' WHEN v_ref IS NOT NULL THEN 'friend'
                WHEN p->>'via' IN ('qr','link') THEN p->>'via' ELSE 'link' END;

  -- the same person across challenges: one profile per email
  IF v_em IS NOT NULL THEN
    SELECT x.* INTO a FROM public.challenge_athlete_private pr JOIN public.challenge_athletes x ON x.id = pr.athlete_id WHERE pr.email = v_em;
    IF a.id IS NOT NULL AND a.merged_into IS NOT NULL THEN
      SELECT x.* INTO a FROM public.challenge_athletes x WHERE x.id = a.merged_into;
    END IF;
  END IF;
  -- a signed-in person registering themselves with their own login's email
  IF a.id IS NULL AND p_caller IS NOT NULL AND p_source = 'self' AND v_em IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_caller AND lower(u.email) = v_em) THEN
    SELECT x.* INTO a FROM public.challenge_athletes x WHERE x.user_id = p_caller AND x.merged_into IS NULL;
  END IF;

  IF a.id IS NULL THEN
    INSERT INTO public.challenge_athletes (handle, display_name, instagram, discoverable)
    VALUES (public._challenge_make_handle(v_disp), v_disp, v_ig, coalesce((p->>'discoverable')::boolean, true))
    RETURNING * INTO a;
    INSERT INTO public.challenge_athlete_private (athlete_id, full_name, email, phone, marketing_opt_in, marketing_opt_in_at)
    VALUES (a.id, v_full, v_em, v_ph, v_mkt, CASE WHEN v_mkt THEN now() END);
    v_created := true;
  ELSE
    -- A public form never renames someone's existing profile; staff and the person themselves can.
    v_trusted := p_source = 'staff' OR (p_caller IS NOT NULL AND a.user_id = p_caller);
    IF v_trusted THEN
      UPDATE public.challenge_athletes x SET display_name = v_disp, instagram = coalesce(v_ig, x.instagram) WHERE x.id = a.id RETURNING * INTO a;
    END IF;
    INSERT INTO public.challenge_athlete_private (athlete_id) VALUES (a.id) ON CONFLICT (athlete_id) DO NOTHING;
    UPDATE public.challenge_athlete_private pr SET
      full_name = CASE WHEN v_trusted OR pr.full_name IS NULL THEN coalesce(v_full, pr.full_name) ELSE pr.full_name END,
      email = coalesce(pr.email, v_em),
      phone = CASE WHEN v_trusted OR pr.phone IS NULL THEN coalesce(v_ph, pr.phone) ELSE pr.phone END,
      marketing_opt_in = pr.marketing_opt_in OR v_mkt,
      marketing_opt_in_at = CASE WHEN v_mkt AND NOT pr.marketing_opt_in THEN now() ELSE pr.marketing_opt_in_at END,
      erased_at = NULL,
      updated_at = now()
    WHERE pr.athlete_id = a.id;
  END IF;

  -- link to a login: the caller's own, or (staff typed it) a confirmed login with that email
  IF a.user_id IS NULL AND v_em IS NOT NULL THEN
    IF p_caller IS NOT NULL AND p_source = 'self'
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_caller AND lower(u.email) = v_em AND u.email_confirmed_at IS NOT NULL) THEN
      v_login := p_caller;
    ELSIF p_source = 'staff' THEN
      SELECT u.id INTO v_login FROM auth.users u WHERE lower(u.email) = v_em AND u.email_confirmed_at IS NOT NULL LIMIT 1;
    END IF;
    IF v_login IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.challenge_athletes x WHERE x.user_id = v_login) THEN
      UPDATE public.challenge_athletes x SET user_id = v_login WHERE x.id = a.id RETURNING * INTO a;
    END IF;
  END IF;

  SELECT x.* INTO e FROM public.challenge_entries x WHERE x.challenge_id = c.id AND x.athlete_id = a.id;
  IF e.id IS NOT NULL THEN
    IF p_source = 'self' THEN
      RETURN jsonb_build_object('already', true, 'bib', e.bib, 'handle', a.handle, 'status', e.status);
    END IF;
    IF e.status = 'withdrawn' THEN
      UPDATE public.challenge_entries x SET status = 'registered', status_reason = NULL WHERE x.id = e.id RETURNING * INTO e;
    END IF;
    RETURN jsonb_build_object('already', true, 'entry_id', e.id, 'athlete_id', a.id, 'bib', e.bib, 'handle', a.handle, 'status', e.status);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('challenge-bib:' || c.id::text));
  SELECT coalesce(max(x.bib), 0) + 1 INTO v_bib FROM public.challenge_entries x WHERE x.challenge_id = c.id;
  INSERT INTO public.challenge_entries (challenge_id, athlete_id, division_id, bib, source, registered_by, referred_by, arrived_via,
      show_name, photo_consent, acknowledged, acknowledged_at, bodyweight_kg, status, checked_in_at, checked_in_by)
  VALUES (c.id, a.id, v_div, v_bib, p_source, p_caller, CASE WHEN v_ref <> a.id THEN v_ref END, v_via,
      v_show, v_photo, c.acknowledgments, now(), v_bw,
      CASE WHEN v_checkin THEN 'checked_in' ELSE 'registered' END,
      CASE WHEN v_checkin THEN now() END,
      CASE WHEN v_checkin THEN p_caller END)
  RETURNING * INTO e;

  -- a photo can follow, for a few minutes, only with consent and never over someone's existing one from a public form
  IF v_photo AND (a.photo_path IS NULL OR p_source = 'staff' OR (p_caller IS NOT NULL AND a.user_id = p_caller)) THEN
    v_nonce := replace(gen_random_uuid()::text, '-', '');
    UPDATE public.challenge_athletes x SET photo_nonce = v_nonce, photo_nonce_until = now() + interval '15 minutes' WHERE x.id = a.id;
  END IF;

  RETURN jsonb_build_object('entry_id', e.id, 'athlete_id', a.id, 'bib', e.bib, 'handle', a.handle,
    'status', e.status, 'created', v_created, 'photo_nonce', v_nonce, 'claimed', a.user_id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_self_register(p_slug text, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; ip text; iph text; st text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(p_slug);
  IF NOT FOUND OR c.is_template OR c.status = 'draft' THEN RAISE EXCEPTION 'This challenge isn''t open.' USING ERRCODE = 'P0001'; END IF;
  IF NOT c.self_registration THEN RAISE EXCEPTION 'Sign up with the event staff at the venue.' USING ERRCODE = 'P0001'; END IF;
  st := public._challenge_reg_state(c);
  IF st = 'full' THEN RAISE EXCEPTION 'This challenge is full.' USING ERRCODE = 'P0001'; END IF;
  IF st <> 'open' THEN RAISE EXCEPTION 'Registration is closed.' USING ERRCODE = 'P0001'; END IF;
  BEGIN
    ip := split_part(coalesce(
      (current_setting('request.headers', true)::json ->> 'cf-connecting-ip'),
      (current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ''), ',', 1);
  EXCEPTION WHEN others THEN ip := ''; END;
  iph := md5(c.id::text || ':' || coalesce(ip, ''));
  IF coalesce(ip, '') <> '' AND (SELECT count(*) FROM public.challenge_reg_log l WHERE l.challenge_id = c.id AND l.ip_hash = iph
        AND l.at > now() - interval '10 minutes') >= 6 THEN
    RAISE EXCEPTION 'Too many sign-ups from here. Try again in a few minutes.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.challenge_reg_log l WHERE l.challenge_id = c.id AND l.at > now() - interval '1 minute') >= 60 THEN
    RAISE EXCEPTION 'Lots of people are signing up right now. Try again in a minute.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.challenge_reg_log (challenge_id, ip_hash) VALUES (c.id, iph);
  DELETE FROM public.challenge_reg_log WHERE at < now() - interval '1 day';
  RETURN public._challenge_register(c, p - 'check_in' - 'bodyweight_kg', 'self', auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.challenge_staff_register(p_challenge uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND OR NOT public.challenge_can(c.id, 'register') THEN RAISE EXCEPTION 'You''re not on this event''s staff.' USING ERRCODE = '42501'; END IF;
  IF c.is_template THEN RAISE EXCEPTION 'Templates don''t take participants.' USING ERRCODE = 'P0001'; END IF;
  IF c.results_finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Results are final. Reopen them to add someone.' USING ERRCODE = 'P0001'; END IF;
  IF c.status IN ('cancelled','archived','completed') THEN RAISE EXCEPTION 'This challenge is closed.' USING ERRCODE = 'P0001'; END IF;
  IF c.max_participants IS NOT NULL AND (SELECT count(*) FROM public.challenge_entries e
       WHERE e.challenge_id = c.id AND e.status IN ('registered','checked_in')) >= c.max_participants
     AND NOT public.challenge_can(c.id, 'manage') THEN
    RAISE EXCEPTION 'This challenge is full. A manager can add more.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._challenge_register(c, p, 'staff', auth.uid());
END $$;

-- Attach a photo uploaded to challenge-media/athletes/<athlete>/<file>.
CREATE OR REPLACE FUNCTION public._challenge_photo_allowed(p_athlete uuid, p_file text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes; uid uuid := auth.uid();
BEGIN
  SELECT * INTO a FROM public.challenge_athletes WHERE id = p_athlete;
  IF NOT FOUND THEN RETURN false; END IF;
  IF uid IS NOT NULL AND a.user_id = uid THEN RETURN true; END IF;
  IF uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.athlete_id = a.id AND public.challenge_can(e.challenge_id, 'register')) THEN
    RETURN true;
  END IF;
  RETURN a.photo_nonce IS NOT NULL AND a.photo_nonce_until > now()
     AND p_file IS NOT NULL AND split_part(p_file, '.', 1) = a.photo_nonce;
END $$;

CREATE OR REPLACE FUNCTION public.challenge_media_can_write(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE parts text[]; file text;
BEGIN
  IF p_name IS NULL OR p_name !~ '^(challenges|athletes)/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$' THEN RETURN false; END IF;
  parts := string_to_array(p_name, '/');
  file := parts[3];
  IF parts[1] = 'challenges' THEN RETURN public.challenge_can(parts[2]::uuid, 'manage'); END IF;
  RETURN public._challenge_photo_allowed(parts[2]::uuid, file);
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.challenge_media_can_delete(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE parts text[];
BEGIN
  IF auth.uid() IS NULL OR p_name IS NULL THEN RETURN false; END IF;
  parts := string_to_array(p_name, '/');
  IF array_length(parts, 1) <> 3 THEN RETURN false; END IF;
  IF parts[1] = 'challenges' THEN RETURN public.challenge_can(parts[2]::uuid, 'manage'); END IF;
  IF parts[1] = 'athletes' THEN
    RETURN EXISTS (SELECT 1 FROM public.challenge_athletes a WHERE a.id = parts[2]::uuid AND a.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.athlete_id = parts[2]::uuid AND public.challenge_can(e.challenge_id, 'register'));
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.challenge_set_athlete_photo(p_athlete uuid, p_path text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes; parts text[]; old text;
BEGIN
  parts := string_to_array(coalesce(p_path, ''), '/');
  IF array_length(parts, 1) <> 3 OR parts[1] <> 'athletes' OR parts[2] <> p_athlete::text
     OR NOT public.challenge_media_can_write(p_path) THEN
    RAISE EXCEPTION 'That photo can''t be added here.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'challenge-media' AND o.name = p_path) THEN
    RAISE EXCEPTION 'The photo didn''t upload. Try again.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO a FROM public.challenge_athletes WHERE id = p_athlete;
  old := a.photo_path;
  UPDATE public.challenge_athletes
     SET photo_path = p_path, photo_consent_at = now(), photo_nonce = NULL, photo_nonce_until = NULL
   WHERE id = p_athlete;
  RETURN jsonb_build_object('photo', p_path, 'old', old);
END $$;

-- Taking a photo down (consent withdrawn): the person, or event staff.
CREATE OR REPLACE FUNCTION public.challenge_remove_athlete_photo(p_athlete uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes;
BEGIN
  SELECT * INTO a FROM public.challenge_athletes WHERE id = p_athlete;
  IF NOT FOUND OR NOT (a.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.athlete_id = a.id
       AND public.challenge_can(e.challenge_id, 'register'))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.challenge_athletes SET photo_path = NULL, photo_consent_at = NULL WHERE id = a.id;
  UPDATE public.challenge_entries SET photo_consent = false WHERE athlete_id = a.id;
  RETURN jsonb_build_object('old', a.photo_path);
END $$;

-- ── Event console (staff) ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_console(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; v_contacts boolean; v_rows jsonb;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND OR NOT public.challenge_can(c.id, 'staff') THEN RAISE EXCEPTION 'You''re not on this event''s staff.' USING ERRCODE = '42501'; END IF;
  v_contacts := public.challenge_can(c.id, 'contacts');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'entry_id', e.id, 'athlete_id', a.id, 'bib', e.bib, 'name', a.display_name, 'handle', a.handle,
      'photo', a.photo_path, 'show_name', e.show_name, 'division_id', e.division_id, 'status', e.status,
      'status_reason', e.status_reason, 'source', e.source, 'checked_in_at', e.checked_in_at,
      'bodyweight_kg', e.bodyweight_kg, 'photo_consent', e.photo_consent, 'created_at', e.created_at,
      'rank', s.rank, 'division_rank', s.division_rank, 'tied', s.tied, 'score', s.score,
      'final_rank', e.final_rank, 'final_score', e.final_score,
      'attempts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'n', t.attempt_no, 'v', t.value, 'r', t.result,
                    'voided', t.voided, 'void_reason', t.void_reason, 'note', t.note, 'video', t.video_url, 'at', t.judged_at)
                    ORDER BY t.attempt_no, t.judged_at) FROM public.challenge_attempts t WHERE t.entry_id = e.id), '[]'::jsonb),
      'contact', CASE WHEN v_contacts THEN (SELECT jsonb_build_object('full_name', pr.full_name, 'email', pr.email, 'phone', pr.phone,
                    'marketing', pr.marketing_opt_in, 'erased', pr.erased_at IS NOT NULL)
                    FROM public.challenge_athlete_private pr WHERE pr.athlete_id = a.id) END,
      'claimed', a.user_id IS NOT NULL)
    ORDER BY e.bib), '[]'::jsonb)
  INTO v_rows
  FROM public.challenge_entries e
  JOIN public.challenge_athletes a ON a.id = e.athlete_id
  LEFT JOIN public._challenge_standings(c.id) s ON s.entry_id = e.id
  WHERE e.challenge_id = c.id;
  RETURN jsonb_build_object(
    'challenge', public._challenge_public_json(c) || jsonb_build_object('now_up_entry', c.now_up_entry, 'now_up_at', c.now_up_at),
    'role', public.challenge_role(c.id), 'contacts', v_contacts,
    'version', coalesce((SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id), 0),
    'divisions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.sort, d.created_at)
                  FROM public.challenge_divisions d WHERE d.challenge_id = c.id), '[]'::jsonb),
    'entries', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_my_staff_challenges()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status,
    'starts_at', c.starts_at, 'role', public.challenge_role(c.id), 'is_template', c.is_template) ORDER BY c.starts_at DESC NULLS FIRST, c.created_at DESC), '[]'::jsonb)
  FROM public.challenges c WHERE c.id IN (SELECT public.challenge_staff_ids())
$$;

-- Value checks by what's measured.
CREATE OR REPLACE FUNCTION public._challenge_check_value(c public.challenges, p_value numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR p_value < 0 THEN RAISE EXCEPTION 'Enter a score of 0 or more.' USING ERRCODE = 'P0001'; END IF;
  IF c.metric = 'reps' THEN
    IF p_value <> trunc(p_value) THEN RAISE EXCEPTION 'Reps are whole numbers.' USING ERRCODE = 'P0001'; END IF;
    IF p_value > 10000 THEN RAISE EXCEPTION 'That''s more reps than we can record.' USING ERRCODE = 'P0001'; END IF;
  ELSIF c.metric = 'weight' AND p_value > 2000 THEN RAISE EXCEPTION 'Check the weight.' USING ERRCODE = 'P0001';
  ELSIF c.metric = 'time' AND p_value > 86400 THEN RAISE EXCEPTION 'Check the time.' USING ERRCODE = 'P0001';
  ELSIF c.metric = 'distance' AND p_value > 1000000 THEN RAISE EXCEPTION 'Check the distance.' USING ERRCODE = 'P0001';
  ELSIF p_value > 10000000 THEN RAISE EXCEPTION 'Check the score.' USING ERRCODE = 'P0001';
  END IF;
  RETURN round(p_value, 3);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_record_attempt(p_entry uuid, p_value numeric, p_result text, p_client_key uuid,
  p_note text DEFAULT NULL, p_video_url text DEFAULT NULL, p_bodyweight_kg numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries; c public.challenges; t public.challenge_attempts; n int; v numeric; s record; manage boolean;
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Only this event''s judges can record scores.' USING ERRCODE = '42501'; END IF;
  -- The same tap sent again (a dropped connection): hand back what was saved.
  IF p_client_key IS NOT NULL THEN
    SELECT * INTO t FROM public.challenge_attempts WHERE client_key = p_client_key;
    IF FOUND THEN
      SELECT st.rank, st.division_rank, st.score, st.tied INTO s FROM public._challenge_standings(t.challenge_id) st WHERE st.entry_id = t.entry_id;
      RETURN jsonb_build_object('attempt_id', t.id, 'attempt_no', t.attempt_no, 'duplicate', true,
        'rank', s.rank, 'division_rank', s.division_rank, 'score', s.score, 'tied', s.tied,
        'ranked', (SELECT count(*) FROM public._challenge_standings(t.challenge_id)));
    END IF;
  END IF;
  manage := public.challenge_can(c.id, 'manage');
  IF c.results_finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Results are final. Reopen them to change anything.' USING ERRCODE = 'P0001'; END IF;
  IF NOT (c.status = 'live' OR (c.status = 'verifying' AND manage)) THEN
    RAISE EXCEPTION '%', CASE c.status WHEN 'paused' THEN 'The challenge is paused. Resume it to record scores.'
      WHEN 'verifying' THEN 'Submissions are closed. A manager can still add a missed result.'
      ELSE 'Scores can be recorded once the challenge is live.' END USING ERRCODE = 'P0001';
  END IF;
  IF c.status = 'live' AND c.ends_at IS NOT NULL AND now() > c.ends_at AND NOT manage THEN
    RAISE EXCEPTION 'The deadline has passed. A manager can still add a missed result.' USING ERRCODE = 'P0001';
  END IF;
  IF e.status IN ('withdrawn','disqualified') THEN RAISE EXCEPTION 'This participant is %.', e.status USING ERRCODE = 'P0001'; END IF;
  IF p_result IS NULL OR p_result NOT IN ('valid','no_lift') THEN RAISE EXCEPTION 'Mark the attempt valid or no lift.' USING ERRCODE = 'P0001'; END IF;
  v := public._challenge_check_value(c, CASE WHEN p_result = 'no_lift' THEN coalesce(p_value, 0) ELSE p_value END);
  SELECT count(*) INTO n FROM public.challenge_attempts WHERE entry_id = e.id AND NOT voided;
  IF n >= c.attempts_allowed THEN
    RAISE EXCEPTION 'All % attempt(s) are used. Correct an attempt instead.', c.attempts_allowed USING ERRCODE = 'P0001';
  END IF;
  IF p_bodyweight_kg IS NOT NULL AND (p_bodyweight_kg < 20 OR p_bodyweight_kg > 400) THEN
    RAISE EXCEPTION 'Check the bodyweight.' USING ERRCODE = 'P0001';
  END IF;
  IF p_video_url IS NOT NULL AND btrim(p_video_url) <> '' AND btrim(p_video_url) !~* '^https://' THEN
    RAISE EXCEPTION 'Video links start with https://' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.challenge_attempts (challenge_id, entry_id, attempt_no, value, result, note, video_url, judge_id, client_key)
  VALUES (c.id, e.id, n + 1, v, p_result, nullif(left(btrim(coalesce(p_note, '')), 500), ''), nullif(btrim(coalesce(p_video_url, '')), ''), auth.uid(), p_client_key)
  RETURNING * INTO t;
  UPDATE public.challenge_entries SET
    status = 'checked_in',
    checked_in_at = coalesce(checked_in_at, now()), checked_in_by = coalesce(checked_in_by, auth.uid()),
    bodyweight_kg = coalesce(p_bodyweight_kg, bodyweight_kg), updated_at = now()
  WHERE id = e.id;
  IF c.now_up_entry = e.id THEN
    PERFORM set_config('jf.challenge_rpc', 'on', true);
    UPDATE public.challenges SET now_up_entry = NULL, now_up_at = NULL WHERE id = c.id;
    PERFORM set_config('jf.challenge_rpc', '', true);
  END IF;
  SELECT st.rank, st.division_rank, st.score, st.tied INTO s FROM public._challenge_standings(c.id) st WHERE st.entry_id = e.id;
  RETURN jsonb_build_object('attempt_id', t.id, 'attempt_no', t.attempt_no, 'duplicate', false,
    'rank', s.rank, 'division_rank', s.division_rank, 'score', s.score, 'tied', s.tied,
    'ranked', (SELECT count(*) FROM public._challenge_standings(c.id)));
END $$;

CREATE OR REPLACE FUNCTION public.challenge_correct_attempt(p_attempt uuid, p_value numeric, p_result text, p_reason text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.challenge_attempts; c public.challenges; v numeric;
BEGIN
  SELECT * INTO t FROM public.challenge_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = t.challenge_id;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Only this event''s judges can correct scores.' USING ERRCODE = '42501'; END IF;
  IF c.results_finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Results are final. Reopen them to change anything.' USING ERRCODE = 'P0001'; END IF;
  IF c.status NOT IN ('live','paused','verifying') THEN RAISE EXCEPTION 'Scores can''t be changed right now.' USING ERRCODE = 'P0001'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why the score is being corrected.' USING ERRCODE = 'P0001'; END IF;
  IF t.voided THEN RAISE EXCEPTION 'This attempt was voided.' USING ERRCODE = 'P0001'; END IF;
  IF p_result NOT IN ('valid','no_lift') THEN RAISE EXCEPTION 'Mark the attempt valid or no lift.' USING ERRCODE = 'P0001'; END IF;
  v := public._challenge_check_value(c, CASE WHEN p_result = 'no_lift' THEN coalesce(p_value, 0) ELSE p_value END);
  PERFORM set_config('jf.challenge_reason', left(btrim(p_reason), 300), true);
  UPDATE public.challenge_attempts SET value = v, result = p_result,
    note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note), judge_id = auth.uid(), updated_at = now()
  WHERE id = t.id;
  PERFORM set_config('jf.challenge_reason', '', true);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_void_attempt(p_attempt uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.challenge_attempts; c public.challenges;
BEGIN
  SELECT * INTO t FROM public.challenge_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = t.challenge_id;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  IF c.results_finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Results are final. Reopen them to change anything.' USING ERRCODE = 'P0001'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why the attempt is being voided.' USING ERRCODE = 'P0001'; END IF;
  IF t.voided THEN RETURN jsonb_build_object('ok', true); END IF;
  PERFORM set_config('jf.challenge_reason', left(btrim(p_reason), 300), true);
  UPDATE public.challenge_attempts SET voided = true, void_reason = left(btrim(p_reason), 300), updated_at = now() WHERE id = t.id;
  PERFORM set_config('jf.challenge_reason', '', true);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Division, bodyweight, check-in, name shown, withdraw / disqualify.
CREATE OR REPLACE FUNCTION public.challenge_update_entry(p_entry uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries; c public.challenges; st text; div uuid; reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF NOT public.challenge_can(c.id, 'register') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  IF c.results_finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Results are final. Reopen them to change anything.' USING ERRCODE = 'P0001'; END IF;
  st := coalesce(p->>'status', e.status);
  IF st NOT IN ('registered','checked_in','withdrawn','disqualified') THEN RAISE EXCEPTION 'Unknown status.' USING ERRCODE = 'P0001'; END IF;
  IF st = 'disqualified' AND st <> e.status THEN
    IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Only a judge can disqualify.' USING ERRCODE = '42501'; END IF;
    IF reason IS NULL THEN RAISE EXCEPTION 'Say why they''re disqualified.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF e.status = 'disqualified' AND st <> 'disqualified' AND NOT public.challenge_can(c.id, 'judge') THEN
    RAISE EXCEPTION 'Only a judge can reinstate a disqualified athlete.' USING ERRCODE = '42501';
  END IF;
  IF p ? 'division_id' THEN
    SELECT d.id INTO div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id = nullif(p->>'division_id', '')::uuid;
    IF div IS NULL AND nullif(p->>'division_id', '') IS NOT NULL THEN RAISE EXCEPTION 'Unknown division.' USING ERRCODE = 'P0001'; END IF;
  ELSE
    div := e.division_id;
  END IF;
  PERFORM set_config('jf.challenge_reason', coalesce(left(reason, 300), ''), true);
  UPDATE public.challenge_entries SET
    status = st,
    status_reason = CASE WHEN st IN ('withdrawn','disqualified') THEN left(reason, 300) ELSE NULL END,
    division_id = div,
    show_name = coalesce((p->>'show_name')::boolean, show_name),
    bodyweight_kg = CASE WHEN p ? 'bodyweight_kg' THEN nullif(p->>'bodyweight_kg', '')::numeric ELSE bodyweight_kg END,
    checked_in_at = CASE WHEN st = 'checked_in' THEN coalesce(checked_in_at, now()) WHEN st = 'registered' THEN NULL ELSE checked_in_at END,
    checked_in_by = CASE WHEN st = 'checked_in' THEN coalesce(checked_in_by, auth.uid()) WHEN st = 'registered' THEN NULL ELSE checked_in_by END,
    updated_at = now()
  WHERE id = e.id;
  PERFORM set_config('jf.challenge_reason', '', true);
  RETURN jsonb_build_object('ok', true);
END $$;

-- "Now on the platform" on the public page and the big screen.
CREATE OR REPLACE FUNCTION public.challenge_set_now_up(p_challenge uuid, p_entry uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'judge') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  IF p_entry IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.id = p_entry AND e.challenge_id = p_challenge) THEN
    RAISE EXCEPTION 'Participant not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('jf.challenge_rpc', 'on', true);
  UPDATE public.challenges SET now_up_entry = p_entry, now_up_at = CASE WHEN p_entry IS NULL THEN NULL ELSE now() END WHERE id = p_challenge;
  PERFORM set_config('jf.challenge_rpc', '', true);
END $$;

-- ── Lifecycle ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_set_status(p_challenge uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; ok boolean := false; missing text[] := '{}';
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR NOT public.challenge_can(c.id, 'manage') THEN RAISE EXCEPTION 'Only the owner or this event''s manager can do that.' USING ERRCODE = '42501'; END IF;
  IF c.is_template THEN RAISE EXCEPTION 'Templates stay drafts. Make a challenge from it first.' USING ERRCODE = 'P0001'; END IF;
  IF p_status = c.status THEN RETURN jsonb_build_object('status', c.status); END IF;
  ok := CASE c.status
    WHEN 'draft'     THEN p_status IN ('upcoming','live','cancelled')
    WHEN 'upcoming'  THEN p_status IN ('draft','live','cancelled')
    WHEN 'live'      THEN p_status IN ('paused','verifying','cancelled')
    WHEN 'paused'    THEN p_status IN ('live','verifying','cancelled')
    WHEN 'verifying' THEN p_status IN ('live','cancelled')
    WHEN 'completed' THEN p_status IN ('archived')
    WHEN 'archived'  THEN p_status IN ('completed')
    WHEN 'cancelled' THEN p_status IN ('draft')
    ELSE false END;
  IF NOT ok THEN RAISE EXCEPTION 'A % challenge can''t go to %.', c.status, p_status USING ERRCODE = 'P0001'; END IF;
  IF p_status IN ('upcoming','live') AND c.status IN ('draft','upcoming') THEN
    IF coalesce(btrim(c.activity), '') = '' THEN missing := array_append(missing, 'what''s being done'::text); END IF;
    IF c.starts_at IS NULL THEN missing := array_append(missing, 'a start date'::text); END IF;
    IF coalesce(btrim(c.location_name), '') = '' THEN missing := array_append(missing, 'a venue'::text); END IF;
    IF jsonb_array_length(c.rules) = 0 THEN missing := array_append(missing, 'the rules'::text); END IF;
    IF array_length(missing, 1) > 0 THEN
      RAISE EXCEPTION 'Add % before publishing.', array_to_string(missing, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_status = 'cancelled' AND length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Say why it''s cancelled (it shows on the page).' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('jf.challenge_rpc', 'on', true);
  PERFORM set_config('jf.challenge_reason', coalesce(left(btrim(p_reason), 300), ''), true);
  UPDATE public.challenges SET status = p_status,
    published_at = CASE WHEN p_status IN ('upcoming','live') THEN coalesce(published_at, now()) WHEN p_status = 'draft' THEN NULL ELSE published_at END,
    now_up_entry = CASE WHEN p_status = 'live' THEN now_up_entry END,
    now_up_at = CASE WHEN p_status = 'live' THEN now_up_at END
  WHERE id = c.id;
  IF p_status = 'cancelled' THEN
    INSERT INTO public.challenge_updates (challenge_id, body) VALUES (c.id, 'Cancelled: ' || left(btrim(p_reason), 480));
  END IF;
  PERFORM set_config('jf.challenge_rpc', '', true);
  PERFORM set_config('jf.challenge_reason', '', true);
  RETURN jsonb_build_object('status', p_status);
END $$;

-- The coach reviews the provisional standings (at `p_version`) and confirms.
CREATE OR REPLACE FUNCTION public.challenge_finalize(p_challenge uuid, p_version bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; cur bigint; pr record; awarded int := 0; ranked int;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR NOT public.challenge_can(c.id, 'manage') THEN RAISE EXCEPTION 'Only the owner or this event''s manager can confirm results.' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'verifying' THEN RAISE EXCEPTION 'End the challenge first (submissions closed), then confirm the results.' USING ERRCODE = 'P0001'; END IF;
  SELECT l.version INTO cur FROM public.challenge_live l WHERE l.challenge_id = c.id;
  IF p_version IS DISTINCT FROM cur THEN
    RAISE EXCEPTION 'The standings changed while you were reviewing. Check them again, then confirm.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('jf.challenge_rpc', 'on', true);
  UPDATE public.challenge_entries SET final_rank = NULL, final_division_rank = NULL, final_score = NULL WHERE challenge_id = c.id;
  UPDATE public.challenge_entries e SET final_rank = s.rank, final_division_rank = s.division_rank, final_score = s.score
    FROM public._challenge_standings(c.id) s WHERE e.id = s.entry_id;
  SELECT count(*) INTO ranked FROM public.challenge_entries WHERE challenge_id = c.id AND final_rank IS NOT NULL;
  DELETE FROM public.challenge_awards WHERE challenge_id = c.id;
  -- A tie covering a prize's place shares it equally.
  FOR pr IN SELECT * FROM public.challenge_prizes WHERE challenge_id = c.id LOOP
    INSERT INTO public.challenge_awards (challenge_id, prize_id, entry_id, share)
    SELECT c.id, pr.id, w.id, round(1.0 / w.n, 4)
    FROM (
      SELECT e.id, count(*) OVER (PARTITION BY CASE WHEN pr.division_id IS NULL THEN e.final_rank ELSE e.final_division_rank END) AS n,
             CASE WHEN pr.division_id IS NULL THEN e.final_rank ELSE e.final_division_rank END AS r
      FROM public.challenge_entries e
      WHERE e.challenge_id = c.id AND e.final_rank IS NOT NULL
        AND (pr.division_id IS NULL OR e.division_id = pr.division_id)
    ) w
    WHERE w.r <= pr.place AND w.r + w.n - 1 >= pr.place;
    GET DIAGNOSTICS cur = ROW_COUNT;
    awarded := awarded + cur;
  END LOOP;
  UPDATE public.challenges SET status = 'completed', results_finalized_at = now(), finalized_by = auth.uid(),
    now_up_entry = NULL, now_up_at = NULL WHERE id = c.id;
  PERFORM set_config('jf.challenge_rpc', '', true);
  RETURN jsonb_build_object('ranked', ranked, 'awards', awarded);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_reopen(p_challenge uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR NOT public.challenge_is_owner() THEN RAISE EXCEPTION 'Only the owner can reopen final results.' USING ERRCODE = '42501'; END IF;
  IF c.status NOT IN ('completed','archived') THEN RAISE EXCEPTION 'These results aren''t final.' USING ERRCODE = 'P0001'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why the results are being reopened.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.challenge_awards w WHERE w.challenge_id = c.id AND w.status = 'claimed') THEN
    RAISE EXCEPTION 'A prize has been collected already. Mark it unclaimed first if the result really changes.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('jf.challenge_rpc', 'on', true);
  PERFORM set_config('jf.challenge_reason', left(btrim(p_reason), 300), true);
  DELETE FROM public.challenge_awards WHERE challenge_id = c.id;
  UPDATE public.challenge_entries SET final_rank = NULL, final_division_rank = NULL, final_score = NULL WHERE challenge_id = c.id;
  UPDATE public.challenges SET status = 'verifying', results_finalized_at = NULL, finalized_by = NULL WHERE id = c.id;
  PERFORM set_config('jf.challenge_rpc', '', true);
  PERFORM set_config('jf.challenge_reason', '', true);
  RETURN jsonb_build_object('status', 'verifying');
END $$;

CREATE OR REPLACE FUNCTION public.challenge_duplicate(p_from uuid, p_title text, p_slug text, p_template boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE src public.challenges; nid uuid; d record; newdiv uuid; s record; news uuid; divmap jsonb := '{}'::jsonb; spmap jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO src FROM public.challenges WHERE id = p_from;
  IF NOT FOUND OR NOT public.challenge_can(src.id, 'manage') OR NOT public.challenge_is_owner() THEN
    RAISE EXCEPTION 'Only the owner can copy challenges.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.challenges (slug, title, tagline, description, is_template, activity, metric, unit, direction, scoring,
    attempts_allowed, load_value, load_unit, time_cap_seconds, objective, equipment, judging_standard, rules, eligibility,
    safety, how_it_works, acknowledgments, min_age, reg_fields, tiebreak, tiebreak_note, timezone, location_name,
    location_address, city, max_participants, entry_fee, self_registration, registration_open, cover_path, copied_from, created_by)
  VALUES (lower(p_slug), btrim(p_title), src.tagline, src.description, coalesce(p_template, false), src.activity, src.metric, src.unit,
    src.direction, src.scoring, src.attempts_allowed, src.load_value, src.load_unit, src.time_cap_seconds, src.objective,
    src.equipment, src.judging_standard, src.rules, src.eligibility, src.safety, src.how_it_works, src.acknowledgments,
    src.min_age, src.reg_fields, src.tiebreak, src.tiebreak_note, src.timezone,
    CASE WHEN p_template THEN NULL ELSE src.location_name END, CASE WHEN p_template THEN NULL ELSE src.location_address END,
    src.city, src.max_participants, src.entry_fee, src.self_registration, true, src.cover_path, src.id, auth.uid())
  RETURNING id INTO nid;
  FOR d IN SELECT * FROM public.challenge_divisions WHERE challenge_id = src.id LOOP
    INSERT INTO public.challenge_divisions (challenge_id, name, description, sort) VALUES (nid, d.name, d.description, d.sort) RETURNING id INTO newdiv;
    divmap := divmap || jsonb_build_object(d.id::text, newdiv);
  END LOOP;
  FOR s IN SELECT * FROM public.challenge_sponsors WHERE challenge_id = src.id LOOP
    INSERT INTO public.challenge_sponsors (challenge_id, name, url, logo_path, blurb, sort) VALUES (nid, s.name, s.url, s.logo_path, s.blurb, s.sort) RETURNING id INTO news;
    spmap := spmap || jsonb_build_object(s.id::text, news);
  END LOOP;
  INSERT INTO public.challenge_prizes (challenge_id, place, division_id, title, description, value_cents, currency, sponsor_id)
  SELECT nid, p.place, (divmap->>p.division_id::text)::uuid, p.title, p.description, p.value_cents, p.currency, (spmap->>p.sponsor_id::text)::uuid
  FROM public.challenge_prizes p WHERE p.challenge_id = src.id;
  RETURN nid;
END $$;

-- ── Staff, people, prizes (owner / manager) ───────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_add_staff(p_challenge uuid, p_email text, p_role text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.challenge_is_owner() THEN RAISE EXCEPTION 'Only the owner adds event staff.' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('manager','judge','registrar') THEN RAISE EXCEPTION 'Pick manager, judge or registration.' USING ERRCODE = 'P0001'; END IF;
  SELECT u.id INTO uid FROM auth.users u WHERE lower(u.email) = lower(btrim(p_email)) LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'No JF Effect login uses that email. They can make a free account at jfeffect.com/join first.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.challenge_staff (challenge_id, user_id, role, added_by) VALUES (p_challenge, uid, p_role, auth.uid())
  ON CONFLICT (challenge_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN jsonb_build_object('user_id', uid);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_remove_staff(p_challenge uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_is_owner() THEN RAISE EXCEPTION 'Only the owner changes event staff.' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.challenge_staff WHERE challenge_id = p_challenge AND user_id = p_user;
END $$;

CREATE OR REPLACE FUNCTION public.challenge_staff_list(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'manage') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id, 'role', s.role, 'email', u.email,
      'name', coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'first_name', ''), split_part(u.email, '@', 1)))
      ORDER BY s.created_at)
    FROM public.challenge_staff s LEFT JOIN auth.users u ON u.id = s.user_id WHERE s.challenge_id = p_challenge), '[]'::jsonb);
END $$;

-- Contact details for running the event: owner / manager only.
CREATE OR REPLACE FUNCTION public.challenge_participants(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'contacts') THEN RAISE EXCEPTION 'Only the owner or this event''s manager sees contact details.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'entry_id', e.id, 'athlete_id', a.id, 'bib', e.bib, 'name', a.display_name, 'handle', a.handle, 'photo', a.photo_path,
      'instagram', a.instagram, 'status', e.status, 'source', e.source, 'arrived_via', e.arrived_via,
      'referred_by', (SELECT r.display_name FROM public.challenge_athletes r WHERE r.id = e.referred_by),
      'show_name', e.show_name, 'photo_consent', e.photo_consent, 'acknowledged_at', e.acknowledged_at,
      'created_at', e.created_at, 'claimed', a.user_id IS NOT NULL, 'discoverable', a.discoverable,
      'other_events', (SELECT count(*) FROM public.challenge_entries x WHERE x.athlete_id = a.id AND x.challenge_id <> e.challenge_id),
      'full_name', pr.full_name, 'email', pr.email, 'phone', pr.phone, 'marketing', pr.marketing_opt_in,
      'marketing_at', pr.marketing_opt_in_at, 'erased', pr.erased_at IS NOT NULL) ORDER BY e.bib)
    FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
    LEFT JOIN public.challenge_athlete_private pr ON pr.athlete_id = a.id
    WHERE e.challenge_id = p_challenge), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_update_athlete(p_athlete uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes; staff boolean; me boolean; em text; disp text; ig text;
BEGIN
  SELECT * INTO a FROM public.challenge_athletes WHERE id = p_athlete FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Athlete not found.' USING ERRCODE = 'P0001'; END IF;
  me := a.user_id IS NOT NULL AND a.user_id = auth.uid();
  staff := public.challenge_is_owner() OR EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.athlete_id = a.id AND public.challenge_can(e.challenge_id, 'contacts'));
  IF NOT (me OR staff) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  disp := btrim(coalesce(p->>'display_name', a.display_name));
  IF length(disp) < 1 OR length(disp) > 40 THEN RAISE EXCEPTION 'Names are 1 to 40 characters.' USING ERRCODE = 'P0001'; END IF;
  ig := CASE WHEN p ? 'instagram' THEN public._challenge_clean_ig(p->>'instagram') ELSE a.instagram END;
  UPDATE public.challenge_athletes SET display_name = disp, instagram = ig,
    discoverable = coalesce((p->>'discoverable')::boolean, discoverable)
  WHERE id = a.id;
  INSERT INTO public.challenge_athlete_private (athlete_id) VALUES (a.id) ON CONFLICT (athlete_id) DO NOTHING;
  IF staff AND p ? 'email' THEN
    em := nullif(lower(btrim(p->>'email')), '');
    IF em IS NOT NULL AND NOT em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'That email doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
    IF em IS NOT NULL AND EXISTS (SELECT 1 FROM public.challenge_athlete_private x WHERE x.email = em AND x.athlete_id <> a.id) THEN
      RAISE EXCEPTION 'Another athlete profile already uses that email. Merge the two instead.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.challenge_athlete_private SET email = em, updated_at = now() WHERE athlete_id = a.id;
  END IF;
  UPDATE public.challenge_athlete_private SET
    full_name = CASE WHEN p ? 'full_name' THEN nullif(left(btrim(p->>'full_name'), 80), '') ELSE full_name END,
    phone = CASE WHEN p ? 'phone' THEN nullif(left(regexp_replace(p->>'phone', '[^0-9+() -]', '', 'g'), 30), '') ELSE phone END,
    marketing_opt_in = CASE WHEN me AND p ? 'marketing' THEN (p->>'marketing')::boolean ELSE marketing_opt_in END,
    marketing_opt_in_at = CASE WHEN me AND p ? 'marketing' AND (p->>'marketing')::boolean AND NOT marketing_opt_in THEN now()
                                WHEN me AND p ? 'marketing' AND NOT (p->>'marketing')::boolean THEN NULL ELSE marketing_opt_in_at END,
    updated_at = now()
  WHERE athlete_id = a.id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Delete someone's contact details (they asked, or the event is long over). Results stay.
CREATE OR REPLACE FUNCTION public.challenge_erase_contact(p_athlete uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes;
BEGIN
  SELECT * INTO a FROM public.challenge_athletes WHERE id = p_athlete;
  IF NOT FOUND OR NOT (public.challenge_is_owner() OR (a.user_id IS NOT NULL AND a.user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Only the owner (or the person) can erase contact details.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.challenge_athlete_private SET full_name = NULL, email = NULL, phone = NULL,
    marketing_opt_in = false, marketing_opt_in_at = NULL, erased_at = now(), updated_at = now()
  WHERE athlete_id = a.id;
END $$;

-- Find a profile across every challenge (owner only: it searches private emails too).
CREATE OR REPLACE FUNCTION public.challenge_athlete_search(p_q text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t text := lower(btrim(coalesce(p_q, '')));
BEGIN
  IF NOT public.challenge_is_owner() THEN RAISE EXCEPTION 'Only the owner searches all athletes.' USING ERRCODE = '42501'; END IF;
  IF length(t) < 2 THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('athlete_id', a.id, 'handle', a.handle, 'name', a.display_name,
      'email', pr.email, 'photo', a.photo_path, 'claimed', a.user_id IS NOT NULL,
      'entries', (SELECT count(*) FROM public.challenge_entries e WHERE e.athlete_id = a.id)) ORDER BY a.display_name)
    FROM (SELECT * FROM public.challenge_athletes x WHERE x.merged_into IS NULL AND (
            lower(x.display_name) LIKE '%' || t || '%' OR x.handle LIKE '%' || t || '%'
            OR EXISTS (SELECT 1 FROM public.challenge_athlete_private p2 WHERE p2.athlete_id = x.id AND (p2.email LIKE '%' || t || '%' OR lower(coalesce(p2.full_name, '')) LIKE '%' || t || '%')))
          LIMIT 20) a
    LEFT JOIN public.challenge_athlete_private pr ON pr.athlete_id = a.id), '[]'::jsonb);
END $$;

-- Two profiles that are one person: everything moves to `p_into`.
CREATE OR REPLACE FUNCTION public.challenge_merge_athletes(p_from uuid, p_into uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.challenge_athletes; t public.challenge_athletes; fp public.challenge_athlete_private; moved int;
BEGIN
  IF NOT public.challenge_is_owner() THEN RAISE EXCEPTION 'Only the owner merges profiles.' USING ERRCODE = '42501'; END IF;
  IF p_from = p_into THEN RAISE EXCEPTION 'Pick two different profiles.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO f FROM public.challenge_athletes WHERE id = p_from FOR UPDATE;
  SELECT * INTO t FROM public.challenge_athletes WHERE id = p_into FOR UPDATE;
  IF f.id IS NULL OR t.id IS NULL OR f.merged_into IS NOT NULL OR t.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.challenge_entries a JOIN public.challenge_entries b ON a.challenge_id = b.challenge_id
             WHERE a.athlete_id = f.id AND b.athlete_id = t.id) THEN
    RAISE EXCEPTION 'Both profiles are entered in the same challenge. Withdraw one entry first.' USING ERRCODE = 'P0001';
  END IF;
  IF f.user_id IS NOT NULL AND t.user_id IS NOT NULL AND f.user_id <> t.user_id THEN
    RAISE EXCEPTION 'Both profiles are claimed by different logins.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.challenge_entries SET athlete_id = t.id WHERE athlete_id = f.id;
  GET DIAGNOSTICS moved = ROW_COUNT;
  UPDATE public.challenge_entries SET referred_by = t.id WHERE referred_by = f.id;
  SELECT * INTO fp FROM public.challenge_athlete_private WHERE athlete_id = f.id;
  UPDATE public.challenge_athlete_private SET email = NULL WHERE athlete_id = f.id;
  INSERT INTO public.challenge_athlete_private (athlete_id) VALUES (t.id) ON CONFLICT (athlete_id) DO NOTHING;
  UPDATE public.challenge_athlete_private SET
    email = coalesce(email, fp.email), full_name = coalesce(full_name, fp.full_name), phone = coalesce(phone, fp.phone),
    marketing_opt_in = marketing_opt_in OR coalesce(fp.marketing_opt_in, false), updated_at = now()
  WHERE athlete_id = t.id;
  UPDATE public.challenge_athletes SET user_id = NULL, merged_into = t.id, photo_path = NULL WHERE id = f.id;
  UPDATE public.challenge_athletes SET
    user_id = coalesce(t.user_id, f.user_id),
    photo_path = coalesce(t.photo_path, f.photo_path),
    photo_consent_at = CASE WHEN t.photo_path IS NULL THEN f.photo_consent_at ELSE t.photo_consent_at END,
    instagram = coalesce(t.instagram, f.instagram)
  WHERE id = t.id;
  RETURN jsonb_build_object('moved', moved);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_awards_list(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'contacts') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', w.id, 'prize_id', p.id, 'prize', p.title, 'place', p.place, 'division_id', p.division_id,
      'value_cents', p.value_cents, 'currency', p.currency, 'share', w.share, 'status', w.status,
      'notified_at', w.notified_at, 'notified_via', w.notified_via, 'claim_deadline', w.claim_deadline,
      'collection_instructions', w.collection_instructions, 'claimed_at', w.claimed_at, 'notes', w.notes,
      'bib', e.bib, 'name', a.display_name, 'handle', a.handle, 'score', e.final_score, 'rank', e.final_rank,
      'full_name', pr.full_name, 'email', pr.email, 'phone', pr.phone) ORDER BY p.place, e.bib)
    FROM public.challenge_awards w
    JOIN public.challenge_prizes p ON p.id = w.prize_id
    JOIN public.challenge_entries e ON e.id = w.entry_id
    JOIN public.challenge_athletes a ON a.id = e.athlete_id
    LEFT JOIN public.challenge_athlete_private pr ON pr.athlete_id = a.id
    WHERE w.challenge_id = p_challenge), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_update_award(p_award uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.challenge_awards; st text;
BEGIN
  SELECT * INTO w FROM public.challenge_awards WHERE id = p_award FOR UPDATE;
  IF NOT FOUND OR NOT public.challenge_can(w.challenge_id, 'manage') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  st := coalesce(p->>'status', w.status);
  IF st NOT IN ('to_notify','notified','claimed','unclaimed','forfeited') THEN RAISE EXCEPTION 'Unknown prize status.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.challenge_awards SET
    status = st,
    notified_at = CASE WHEN st = 'notified' AND w.status = 'to_notify' THEN now() WHEN st = 'to_notify' THEN NULL ELSE notified_at END,
    notified_via = CASE WHEN p ? 'notified_via' THEN left(p->>'notified_via', 40) ELSE notified_via END,
    claim_deadline = CASE WHEN p ? 'claim_deadline' THEN nullif(p->>'claim_deadline', '')::date ELSE claim_deadline END,
    collection_instructions = CASE WHEN p ? 'collection_instructions' THEN left(p->>'collection_instructions', 1000) ELSE collection_instructions END,
    claimed_at = CASE WHEN st = 'claimed' THEN coalesce(claimed_at, now()) ELSE NULL END,
    notes = CASE WHEN p ? 'notes' THEN left(p->>'notes', 2000) ELSE notes END,
    updated_at = now()
  WHERE id = w.id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_audit_list(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'manage') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('at', x.at, 'entity', x.entity, 'action', x.action, 'reason', x.reason,
      'before', x.before, 'after', x.after,
      'actor', coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
      'bib', (SELECT e.bib FROM public.challenge_entries e WHERE e.id = CASE WHEN x.entity = 'entry' THEN x.entity_id
              ELSE coalesce((x.after->>'entry_id')::uuid, (x.before->>'entry_id')::uuid,
                            (SELECT t.entry_id FROM public.challenge_attempts t WHERE t.id = x.entity_id)) END))
      ORDER BY x.at DESC)
    FROM (SELECT * FROM public.challenge_audit a WHERE a.challenge_id = p_challenge ORDER BY a.at DESC LIMIT 300) x
    LEFT JOIN auth.users u ON u.id = x.actor), '[]'::jsonb);
END $$;

-- ── Analytics read ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_stats(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges; ev jsonb;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND OR NOT public.challenge_can(c.id, 'manage') THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_object_agg(kind, jsonb_build_object('total', total, 'unique', uniq)), '{}'::jsonb) INTO ev
  FROM (SELECT kind, count(*) AS total, count(DISTINCT visitor) AS uniq FROM public.challenge_events WHERE challenge_id = c.id GROUP BY kind) k;
  RETURN jsonb_build_object(
    'events', ev,
    'visitors', (SELECT count(DISTINCT visitor) FROM public.challenge_events WHERE challenge_id = c.id),
    'qr_visits', (SELECT count(*) FROM public.challenge_events WHERE challenge_id = c.id AND source = 'qr' AND kind IN ('page_view','join_view')),
    'referral_visits', (SELECT count(*) FROM public.challenge_events WHERE challenge_id = c.id AND ref_athlete IS NOT NULL AND kind IN ('page_view','join_view','result_view')),
    'registrations', (SELECT jsonb_build_object(
        'total', count(*) FILTER (WHERE status <> 'withdrawn'),
        'staff', count(*) FILTER (WHERE source = 'staff' AND status <> 'withdrawn'),
        'self', count(*) FILTER (WHERE source = 'self' AND status <> 'withdrawn'),
        'referred', count(*) FILTER (WHERE referred_by IS NOT NULL AND status <> 'withdrawn'),
        'via_qr', count(*) FILTER (WHERE arrived_via = 'qr' AND status <> 'withdrawn'),
        'checked_in', count(*) FILTER (WHERE checked_in_at IS NOT NULL),
        'withdrawn', count(*) FILTER (WHERE status = 'withdrawn'),
        'disqualified', count(*) FILTER (WHERE status = 'disqualified'),
        'photo_consent', count(*) FILTER (WHERE photo_consent))
      FROM public.challenge_entries WHERE challenge_id = c.id),
    'competed', (SELECT count(DISTINCT entry_id) FROM public.challenge_attempts WHERE challenge_id = c.id AND NOT voided),
    'returning', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND EXISTS (
        SELECT 1 FROM public.challenge_entries x WHERE x.athlete_id = e.athlete_id AND x.challenge_id <> c.id AND x.created_at < e.created_at)),
    'claimed', (SELECT count(*) FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
        WHERE e.challenge_id = c.id AND a.user_id IS NOT NULL),
    'new_accounts', (SELECT count(*) FROM public.challenge_entries e JOIN public.challenge_athletes a ON a.id = e.athlete_id
        JOIN auth.users u ON u.id = a.user_id WHERE e.challenge_id = c.id AND u.created_at > e.created_at),
    'marketing', (SELECT count(*) FROM public.challenge_entries e JOIN public.challenge_athlete_private pr ON pr.athlete_id = e.athlete_id
        WHERE e.challenge_id = c.id AND pr.marketing_opt_in),
    'prize_cents', (SELECT coalesce(sum(value_cents), 0) FROM public.challenge_prizes WHERE challenge_id = c.id),
    'sponsor_cents', (SELECT coalesce(sum(contribution_cents), 0) FROM public.challenge_sponsors WHERE challenge_id = c.id),
    'coaching_applications', (SELECT count(*) FROM public.coaching_applications ap
        WHERE ap.utm_source = 'challenge' AND ap.utm_campaign = c.slug),
    'top_sharers', coalesce((SELECT jsonb_agg(jsonb_build_object('name', a.display_name, 'handle', a.handle, 'visits', n) ORDER BY n DESC)
        FROM (SELECT ref_athlete, count(*) AS n FROM public.challenge_events WHERE challenge_id = c.id AND ref_athlete IS NOT NULL
              GROUP BY ref_athlete ORDER BY count(*) DESC LIMIT 5) r JOIN public.challenge_athletes a ON a.id = r.ref_athlete), '[]'::jsonb));
END $$;

-- Every challenge side by side (the admin list).
CREATE OR REPLACE FUNCTION public.challenge_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status, 'is_template', c.is_template,
    'starts_at', c.starts_at, 'city', c.city, 'activity', c.activity, 'role', public.challenge_role(c.id),
    'final', c.results_finalized_at IS NOT NULL, 'cover_path', c.cover_path,
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'competed', (SELECT count(DISTINCT t.entry_id) FROM public.challenge_attempts t WHERE t.challenge_id = c.id AND NOT t.voided),
    'views', (SELECT count(*) FROM public.challenge_events ev WHERE ev.challenge_id = c.id AND ev.kind = 'page_view'),
    'shares', (SELECT count(*) FROM public.challenge_events ev WHERE ev.challenge_id = c.id AND ev.kind IN ('card_download','share_sheet','copy_link','invite_link')),
    'referrals', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.referred_by IS NOT NULL))
    ORDER BY CASE c.status WHEN 'live' THEN 0 WHEN 'paused' THEN 0 WHEN 'verifying' THEN 1 WHEN 'upcoming' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
             c.starts_at DESC NULLS FIRST, c.created_at DESC), '[]'::jsonb)
  FROM public.challenges c WHERE c.id IN (SELECT public.challenge_staff_ids())
$$;

-- ── The person's own side ──────────────────────────────────────────────

-- Profiles registered with this login's (confirmed) email become theirs.
CREATE OR REPLACE FUNCTION public._challenge_link_login(p_user uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE em text; aid uuid; n int := 0;
BEGIN
  SELECT lower(u.email) INTO em FROM auth.users u WHERE u.id = p_user AND u.email_confirmed_at IS NOT NULL;
  IF em IS NULL OR EXISTS (SELECT 1 FROM public.challenge_athletes x WHERE x.user_id = p_user) THEN RETURN 0; END IF;
  SELECT a.id INTO aid FROM public.challenge_athlete_private pr JOIN public.challenge_athletes a ON a.id = pr.athlete_id
   WHERE pr.email = em AND a.user_id IS NULL AND a.merged_into IS NULL;
  IF aid IS NOT NULL THEN
    UPDATE public.challenge_athletes SET user_id = p_user WHERE id = aid;
    n := 1;
  END IF;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.challenge_claim_mine()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  RETURN public._challenge_link_login(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.challenge_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_athletes; pr public.challenge_athlete_private;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.challenge_athletes WHERE user_id = auth.uid() AND merged_into IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO pr FROM public.challenge_athlete_private WHERE athlete_id = a.id;
  RETURN jsonb_build_object('athlete_id', a.id, 'handle', a.handle, 'name', a.display_name, 'photo', a.photo_path,
    'instagram', a.instagram, 'discoverable', a.discoverable, 'email', pr.email, 'phone', pr.phone,
    'full_name', pr.full_name, 'marketing', coalesce(pr.marketing_opt_in, false),
    'entries', coalesce((SELECT jsonb_agg(jsonb_build_object('entry_id', e.id, 'slug', c.slug, 'title', c.title, 'status', c.status,
        'entry_status', e.status, 'show_name', e.show_name, 'bib', e.bib,
        'competed', EXISTS (SELECT 1 FROM public.challenge_attempts t WHERE t.entry_id = e.id AND NOT t.voided)) ORDER BY e.created_at DESC)
      FROM public.challenge_entries e JOIN public.challenges c ON c.id = e.challenge_id WHERE e.athlete_id = a.id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.challenge_my_entry(p_entry uuid, p_show_name boolean DEFAULT NULL, p_withdraw boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries; c public.challenges;
BEGIN
  SELECT e0.* INTO e FROM public.challenge_entries e0 JOIN public.challenge_athletes a ON a.id = e0.athlete_id
   WHERE e0.id = p_entry AND a.user_id = auth.uid() FOR UPDATE OF e0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not your entry.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF p_withdraw THEN
    IF EXISTS (SELECT 1 FROM public.challenge_attempts t WHERE t.entry_id = e.id AND NOT t.voided) THEN
      RAISE EXCEPTION 'You''ve already competed, so your result stays. You can hide your name instead.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.challenge_entries SET status = 'withdrawn', status_reason = 'Withdrew themselves', updated_at = now() WHERE id = e.id;
  END IF;
  IF p_show_name IS NOT NULL THEN
    IF c.results_finalized_at IS NOT NULL THEN
      PERFORM set_config('jf.challenge_rpc', 'on', true);
    END IF;
    UPDATE public.challenge_entries SET show_name = p_show_name, updated_at = now() WHERE id = e.id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- A login confirming its email picks up the profile registered with it.
CREATE OR REPLACE FUNCTION public.tg_challenge_link_login()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.email_confirmed_at IS NULL OR OLD.email IS DISTINCT FROM NEW.email) THEN
    BEGIN
      PERFORM public._challenge_link_login(NEW.id);
    EXCEPTION WHEN others THEN NULL; -- never fail a sign-in over this
    END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS challenge_link_login ON auth.users;
CREATE TRIGGER challenge_link_login AFTER INSERT OR UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_challenge_link_login();

-- ── Grants ─────────────────────────────────────────────────────────────

DO $$
DECLARE f text;
BEGIN
  -- internal: nobody calls these directly
  FOREACH f IN ARRAY ARRAY[
    'public._challenge_bump(uuid)', 'public.tg_challenge_bump()', 'public.tg_challenge_athlete_bump()',
    'public.tg_challenge_audit()', 'public.tg_challenge_guard()', 'public._challenge_standings(uuid)',
    'public._challenge_public_json(public.challenges)', 'public._challenge_visible(public.challenges)',
    'public._challenge_reg_state(public.challenges)', 'public._challenge_entry_public(public.challenge_entries, public.challenge_athletes)',
    'public._challenge_make_handle(text)', 'public._challenge_register(public.challenges, jsonb, text, uuid)',
    'public._challenge_photo_allowed(uuid, text)', 'public._challenge_check_value(public.challenges, numeric)',
    'public._challenge_link_login(uuid)', 'public.tg_challenge_link_login()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- public (signed out too)
  FOREACH f IN ARRAY ARRAY[
    'public.challenge_hub()', 'public.challenge_page(text)', 'public.challenge_board(text)',
    'public.challenge_result(text, text)', 'public.challenge_athlete(text)',
    'public.challenge_track(text, text, text, text, text, text)', 'public.challenge_self_register(text, jsonb)',
    'public.challenge_set_athlete_photo(uuid, text)', 'public.challenge_media_can_write(text)',
    'public.challenge_public_ids()', 'public._challenge_clean_ig(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f);
  END LOOP;
  -- signed in (each checks the role it needs)
  FOREACH f IN ARRAY ARRAY[
    'public.challenge_is_owner()', 'public.challenge_role(uuid)', 'public.challenge_can(uuid, text)',
    'public.challenge_staff_ids()', 'public.challenge_managed_ids()', 'public.challenge_media_can_delete(text)',
    'public.challenge_staff_register(uuid, jsonb)', 'public.challenge_remove_athlete_photo(uuid)',
    'public.challenge_console(uuid)', 'public.challenge_my_staff_challenges()',
    'public.challenge_record_attempt(uuid, numeric, text, uuid, text, text, numeric)',
    'public.challenge_correct_attempt(uuid, numeric, text, text, text)', 'public.challenge_void_attempt(uuid, text)',
    'public.challenge_update_entry(uuid, jsonb)', 'public.challenge_set_now_up(uuid, uuid)',
    'public.challenge_set_status(uuid, text, text)', 'public.challenge_finalize(uuid, bigint)',
    'public.challenge_reopen(uuid, text)', 'public.challenge_duplicate(uuid, text, text, boolean)',
    'public.challenge_add_staff(uuid, text, text)', 'public.challenge_remove_staff(uuid, uuid)',
    'public.challenge_staff_list(uuid)', 'public.challenge_participants(uuid)',
    'public.challenge_update_athlete(uuid, jsonb)', 'public.challenge_erase_contact(uuid)',
    'public.challenge_merge_athletes(uuid, uuid)', 'public.challenge_awards_list(uuid)', 'public.challenge_athlete_search(text)',
    'public.challenge_update_award(uuid, jsonb)', 'public.challenge_audit_list(uuid)',
    'public.challenge_stats(uuid)', 'public.challenge_overview()', 'public.challenge_claim_mine()',
    'public.challenge_me()', 'public.challenge_my_entry(uuid, boolean, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ── Storage: covers, sponsor logos, athlete photos (consented only) ───

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('challenge-media', 'challenge-media', true, 3145728, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 3145728, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS "Challenge media upload" ON storage.objects;
CREATE POLICY "Challenge media upload" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'challenge-media' AND public.challenge_media_can_write(name));
DROP POLICY IF EXISTS "Challenge media delete" ON storage.objects;
CREATE POLICY "Challenge media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'challenge-media' AND public.challenge_media_can_delete(name));

-- ── Realtime ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'challenge_live') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_live;
  END IF;
END $$;

-- ── The first event: Winnipeg 225 (a draft until its date and venue are set) ──

DO $$
DECLARE cid uuid; div uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.challenges WHERE slug = 'winnipeg-225') THEN RETURN; END IF;
  INSERT INTO public.challenges (slug, title, tagline, description, activity, metric, unit, direction, scoring, attempts_allowed,
    load_value, load_unit, objective, equipment, judging_standard, rules, eligibility, safety, how_it_works, acknowledgments,
    min_age, tiebreak, tiebreak_note, timezone, city, entry_fee, self_registration, registration_open, created_by)
  VALUES ('winnipeg-225', 'Winnipeg 225 Bench Press Challenge',
    'How many clean reps can you get with 225?',
    'One bar. 225 lb. One set. Most clean reps wins $225 and the trophy. Free to enter, judged on the spot, and every rep shows up on the live leaderboard.',
    'Barbell Bench Press', 'reps', 'reps', 'higher', 'best', 1, 225, 'lb',
    'Most valid reps with 225 lb (102.1 kg) in one continuous set.',
    'Competition bench with safety arms set just below chest height, a 20 kg (45 lb) bar, collars on, two spotters on every set.',
    'A rep counts when the bar touches the chest under control and is pressed to full elbow extension, with no bounce, no help and the lifter in contact with the bench the whole time. The judge calls every rep out loud.',
    '["The bar touches your chest under control on every rep.","Lock your elbows out fully at the top of every rep.","No bouncing the bar off your chest.","Your butt stays on the bench the whole set.","Your head and upper back stay on the bench.","Your feet stay planted.","No help from the spotters during a scored rep. A touch ends the set.","No more than 3 seconds between reps. Racking the bar ends the set.","The judges decide whether each rep counts, and their call is final.","Unsafe technique or losing control of the bar ends the attempt."]'::jsonb,
    'Adults 18 and older who already bench press regularly and can press 225 lb (102.1 kg) for at least one controlled rep in training. This is not the place for a first try at 225.',
    E'Your safety comes first, then your score.\n\n• Two spotters stand by on every set and safety arms are set just below chest height.\n• Collars stay on the bar.\n• Warm up properly before your set: there is a warm-up bar and plates, and staff will tell you when you''re on deck.\n• The judge or a spotter will stop the set the moment the bar stalls, tilts or you lose control. A stopped set keeps the reps you had already completed.\n• If you have an injury, a medical condition or you feel unwell, don''t take part. Tell a staff member if anything feels off.',
    E'1. Sign up online or with staff at the venue, then check in when you arrive.\n2. Warm up in the warm-up area. Build up gradually, for example the bar for 10, then 135 for 5, 185 for 3 and 205 for 1.\n3. When you''re called, the judge goes over the rules with you and the spotters hand off when you''re ready.\n4. Rep out. The judge counts every valid rep out loud.\n5. Your score goes on the live leaderboard right away, and you get a result card to share.',
    '["I''m 18 or older.","I can bench press 225 lb (102.1 kg) for at least one controlled rep in training.","I''ve read the rules and the safety policy, I''m healthy enough for a hard set, and I take part at my own risk."]'::jsonb,
    18, 'bodyweight_lower',
    'If two people tie on reps, the lighter lifter (weighed at check-in) places higher. If they weigh the same, they share the place and split the prize equally.',
    'America/Winnipeg', 'Winnipeg', 'Free', true, true, NULL)
  RETURNING id INTO cid;
  INSERT INTO public.challenge_divisions (challenge_id, name, description, sort) VALUES (cid, 'Open', 'Everyone 18+', 0) RETURNING id INTO div;
  INSERT INTO public.challenge_prizes (challenge_id, place, title, description, value_cents, currency)
  VALUES (cid, 1, '$225 CAD + the winner''s trophy', 'For the most valid reps with 225.', 22500, 'CAD');
  INSERT INTO public.challenge_live (challenge_id) VALUES (cid) ON CONFLICT DO NOTHING;
END $$;
