-- Live challenges: real-world competitions with registration, judged scores,
-- a live public leaderboard, persistent athlete profiles, share cards and prizes.
--
-- Access model
--   * Public (anon) reads only through SECURITY DEFINER functions that return
--     public fields: challenge_hub / challenge_public / challenge_board /
--     challenge_entry_public / challenge_athlete. No table is readable by anon
--     except challenge_live (a version counter for realtime, no names).
--   * Contact details live in challenge_people_private: admins only (and the
--     person themselves once they've claimed their profile).
--   * Scores are written only by challenge_record_attempt / _correct / _void
--     (judge, manager or admin of that challenge), idempotent on a client key,
--     every change in challenge_audit.
--   * A challenge's status only changes through challenge_set_status /
--     challenge_finalize (guard trigger), so a draft can't go public by an
--     edit and results can't be marked final by accident.
-- Idempotent: safe to run more than once.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 90),
  tagline text CHECK (tagline IS NULL OR length(tagline) <= 140),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','upcoming','live','paused','verifying','completed','archived','cancelled')),
  activity text NOT NULL CHECK (length(btrim(activity)) BETWEEN 2 AND 80),
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  measure text NOT NULL CHECK (measure IN ('reps','weight','time','distance','points')),
  direction text NOT NULL CHECK (direction IN ('higher','lower')),
  unit text NOT NULL CHECK (unit IN ('reps','lb','kg','s','m','km','pts')),
  aggregate text NOT NULL DEFAULT 'best' CHECK (aggregate IN ('best','sum')),
  attempts_allowed int NOT NULL DEFAULT 1 CHECK (attempts_allowed BETWEEN 1 AND 10),
  relative_to_bodyweight boolean NOT NULL DEFAULT false,
  load_label text CHECK (load_label IS NULL OR length(load_label) <= 40),
  objective text CHECK (objective IS NULL OR length(objective) <= 120),
  tiebreak text NOT NULL DEFAULT 'shared' CHECK (tiebreak IN ('shared','lighter','runoff')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Winnipeg',
  venue_name text CHECK (venue_name IS NULL OR length(venue_name) <= 120),
  city text CHECK (city IS NULL OR length(city) <= 120),
  address text CHECK (address IS NULL OR length(address) <= 200),
  max_participants int CHECK (max_participants IS NULL OR max_participants > 0),
  min_age int NOT NULL DEFAULT 18 CHECK (min_age BETWEEN 0 AND 99),
  eligibility text CHECK (eligibility IS NULL OR length(eligibility) <= 1000),
  rules jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rules) = 'array'),
  safety text CHECK (safety IS NULL OR length(safety) <= 2000),
  warmup text CHECK (warmup IS NULL OR length(warmup) <= 1000),
  prize_summary text CHECK (prize_summary IS NULL OR length(prize_summary) <= 140),
  entry_fee_label text DEFAULT 'Free' CHECK (entry_fee_label IS NULL OR length(entry_fee_label) <= 40),
  self_registration boolean NOT NULL DEFAULT true,
  -- what registration asks besides name + email: {"phone":"off|optional|required","instagram":"off|optional|required"}
  collect jsonb NOT NULL DEFAULT '{"phone":"optional","instagram":"optional"}'::jsonb,
  -- what every entrant ticks before they compete, stored with the entry
  acknowledgments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acknowledgments) = 'array'),
  cover_path text,
  announcement text CHECK (announcement IS NULL OR length(announcement) <= 280),
  announcement_at timestamptz,
  is_template boolean NOT NULL DEFAULT false,
  is_test boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  ended_at timestamptz,
  results_final_at timestamptz,
  final_by uuid,
  duplicated_from uuid REFERENCES public.challenges(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenges_relative_weight CHECK (NOT relative_to_bodyweight OR measure = 'weight'),
  CONSTRAINT challenges_ends_after_start CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.challenge_divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  -- a division with its own load ("135 lb") is ranked on its own, never mixed
  load_label text CHECK (load_label IS NULL OR length(load_label) <= 40),
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_divisions_challenge ON public.challenge_divisions(challenge_id);

-- One person across every challenge they enter. Public fields only.
CREATE TABLE IF NOT EXISTS public.challenge_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 40),
  photo_path text,
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  discoverable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Contact details: admins only (and the person once they've claimed the profile).
CREATE TABLE IF NOT EXISTS public.challenge_people_private (
  person_id uuid PRIMARY KEY REFERENCES public.challenge_people(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 80),
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 200),
  phone text CHECK (phone IS NULL OR length(phone) <= 30),
  instagram text CHECK (instagram IS NULL OR length(instagram) <= 60),
  marketing_opt_in boolean NOT NULL DEFAULT false,
  marketing_opt_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_people_private_email ON public.challenge_people_private (lower(email));

CREATE TABLE IF NOT EXISTS public.challenge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.challenge_people(id) ON DELETE RESTRICT,
  division_id uuid REFERENCES public.challenge_divisions(id) ON DELETE SET NULL,
  bib int NOT NULL CHECK (bib > 0),
  share_code text NOT NULL UNIQUE CHECK (share_code ~ '^[a-z0-9]{8,16}$'),
  public_name text NOT NULL CHECK (length(btrim(public_name)) BETWEEN 1 AND 40),
  show_photo boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','checked_in','withdrawn','disqualified')),
  status_reason text CHECK (status_reason IS NULL OR length(status_reason) <= 300),
  -- private: used only to break a tie when the challenge says so, never shown publicly
  bodyweight_kg numeric(6,2) CHECK (bodyweight_kg IS NULL OR bodyweight_kg BETWEEN 25 AND 350),
  source text NOT NULL CHECK (source IN ('staff','self')),
  ref_source text CHECK (ref_source IS NULL OR ref_source IN ('qr','link','friend','display')),
  referred_by uuid REFERENCES public.challenge_entries(id) ON DELETE SET NULL,
  acknowledged jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  registered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, person_id),
  UNIQUE (challenge_id, bib)
);
CREATE INDEX IF NOT EXISTS challenge_entries_person ON public.challenge_entries(person_id);

CREATE TABLE IF NOT EXISTS public.challenge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
  attempt_no int NOT NULL CHECK (attempt_no >= 0),
  value numeric(12,3) CHECK (value IS NULL OR value >= 0),
  valid boolean NOT NULL,
  is_tiebreak boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','void')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  video_url text CHECK (video_url IS NULL OR (length(video_url) <= 500 AND video_url ~* '^https?://')),
  judge_id uuid,
  client_key uuid NOT NULL UNIQUE,
  replaces uuid REFERENCES public.challenge_attempts(id) ON DELETE SET NULL,
  void_reason text CHECK (void_reason IS NULL OR length(void_reason) <= 300),
  voided_by uuid,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_attempts_valid_has_value CHECK (NOT valid OR value IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS challenge_attempts_entry ON public.challenge_attempts(entry_id);
CREATE INDEX IF NOT EXISTS challenge_attempts_challenge ON public.challenge_attempts(challenge_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.challenge_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  url text CHECK (url IS NULL OR (length(url) <= 300 AND url ~* '^https?://')),
  logo_path text,
  blurb text CHECK (blurb IS NULL OR length(blurb) <= 200),
  -- private (admins): what they put in
  contribution_cents int CHECK (contribution_cents IS NULL OR contribution_cents >= 0),
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_sponsors_challenge ON public.challenge_sponsors(challenge_id);

CREATE TABLE IF NOT EXISTS public.challenge_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  division_id uuid REFERENCES public.challenge_divisions(id) ON DELETE SET NULL,
  place int NOT NULL DEFAULT 1 CHECK (place BETWEEN 1 AND 50),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  value_cents int CHECK (value_cents IS NULL OR value_cents >= 0),
  sponsor_id uuid REFERENCES public.challenge_sponsors(id) ON DELETE SET NULL,
  winner_entry_id uuid REFERENCES public.challenge_entries(id) ON DELETE SET NULL,
  winner_source text CHECK (winner_source IS NULL OR winner_source IN ('auto','admin')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','notified','claimed','unclaimed')),
  notified_at timestamptz,
  notified_via text CHECK (notified_via IS NULL OR length(notified_via) <= 40),
  claim_by date,
  claimed_at timestamptz,
  collection_notes text CHECK (collection_notes IS NULL OR length(collection_notes) <= 500),
  fulfillment_notes text CHECK (fulfillment_notes IS NULL OR length(fulfillment_notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_prizes_challenge ON public.challenge_prizes(challenge_id);

-- Event staff who aren't admins: a manager runs the event, a judge enters
-- scores (and can register), registration staff only register and check in.
CREATE TABLE IF NOT EXISTS public.challenge_staff (
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('manager','judge','registration')),
  added_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS challenge_staff_user ON public.challenge_staff(user_id);

CREATE TABLE IF NOT EXISTS public.challenge_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id uuid REFERENCES public.challenges(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_audit_challenge ON public.challenge_audit(challenge_id, created_at DESC);

-- A version number per challenge that realtime pushes to every open page;
-- pages refetch the board when it moves. No names or scores in it.
CREATE TABLE IF NOT EXISTS public.challenge_live (
  challenge_id uuid PRIMARY KEY REFERENCES public.challenges(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.challenge_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id uuid REFERENCES public.challenges(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.challenge_people(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.challenge_entries(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('view','display_view','qr_visit','ref_visit','result_view','profile_view','share','download','copy_link','copy_caption','join_start')),
  visitor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_metrics_challenge ON public.challenge_metrics(challenge_id, kind, created_at);
CREATE INDEX IF NOT EXISTS challenge_metrics_person ON public.challenge_metrics(person_id, kind, created_at);

CREATE TABLE IF NOT EXISTS public.challenge_rate (
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_rate_key ON public.challenge_rate(key, at);

-- One-time photo upload tickets (hashed). The server redeems one with the
-- service role after checking the image, so nobody uploads without one.
CREATE TABLE IF NOT EXISTS public.challenge_photo_tickets (
  token_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES public.challenge_people(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Storage: public bucket for consented photos, covers and sponsor logos ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('challenge-media', 'challenge-media', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS "Admins upload challenge media" ON storage.objects;
CREATE POLICY "Admins upload challenge media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'challenge-media' AND (SELECT public.has_role((SELECT auth.uid()), 'admin')) AND (storage.foldername(name))[1] IN ('covers','sponsors'));
DROP POLICY IF EXISTS "Admins update challenge media" ON storage.objects;
CREATE POLICY "Admins update challenge media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'challenge-media' AND (SELECT public.has_role((SELECT auth.uid()), 'admin')));
DROP POLICY IF EXISTS "Admins delete challenge media" ON storage.objects;
CREATE POLICY "Admins delete challenge media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'challenge-media' AND (SELECT public.has_role((SELECT auth.uid()), 'admin')));

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- The caller's role on a challenge: admin | manager | judge | registration | null.
CREATE OR REPLACE FUNCTION public.challenge_role(p_challenge uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN public.has_role(auth.uid(), 'admin') THEN 'admin'
    ELSE (SELECT s.role FROM public.challenge_staff s WHERE s.challenge_id = p_challenge AND s.user_id = auth.uid())
  END
$$;

-- need: 'admin' | 'manage' | 'judge' | 'register' | 'any'
CREATE OR REPLACE FUNCTION public.challenge_can(p_challenge uuid, p_need text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_need
    WHEN 'admin' THEN r = 'admin'
    WHEN 'manage' THEN r IN ('admin','manager')
    WHEN 'judge' THEN r IN ('admin','manager','judge')
    WHEN 'register' THEN r IN ('admin','manager','judge','registration')
    WHEN 'any' THEN r IS NOT NULL
    ELSE false
  END
  FROM (SELECT public.challenge_role(p_challenge) AS r) x
$$;

-- Challenges the caller staffs (all of them for an admin).
CREATE OR REPLACE FUNCTION public.challenge_my_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.challenges c WHERE public.has_role(auth.uid(), 'admin')
  UNION
  SELECT s.challenge_id FROM public.challenge_staff s WHERE s.user_id = auth.uid()
$$;

-- Challenges anyone may see (everything that has been published).
CREATE OR REPLACE FUNCTION public.challenge_public_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.challenges c WHERE c.status <> 'draft' AND NOT c.is_template
$$;

CREATE OR REPLACE FUNCTION public._challenge_code(n int)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea := extensions.gen_random_bytes(n);
  s text := '';
BEGIN
  FOR i IN 0..n-1 LOOP
    s := s || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  END LOOP;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public._challenge_slugify(p text, p_max int DEFAULT 40)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(left(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), p_max), '')
$$;

CREATE OR REPLACE FUNCTION public._challenge_handle(p_name text)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE base text := coalesce(btrim(public._challenge_slugify(p_name, 24), '-'), 'athlete'); h text;
BEGIN
  IF base = '' THEN base := 'athlete'; END IF;
  LOOP
    h := base || '-' || public._challenge_code(4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.challenge_people WHERE handle = h);
  END LOOP;
  RETURN h;
END $$;

CREATE OR REPLACE FUNCTION public._challenge_client_ip()
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE h json;
BEGIN
  BEGIN
    h := nullif(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN h := NULL;
  END;
  RETURN coalesce(
    nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(h ->> 'x-real-ip', ''),
    'unknown');
END $$;

CREATE OR REPLACE FUNCTION public._challenge_rate_ok(p_key text, p_max int, p_window interval)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.challenge_rate WHERE key = p_key AND at < now() - p_window;
  SELECT count(*) INTO n FROM public.challenge_rate WHERE key = p_key;
  IF n >= p_max THEN RETURN false; END IF;
  INSERT INTO public.challenge_rate(key) VALUES (p_key);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public._challenge_audit(p_challenge uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.challenge_audit(challenge_id, actor, action, entity, entity_id, detail)
  VALUES (p_challenge, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public._challenge_bump(p_challenge uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  -- (skipped while the challenge itself is being deleted)
  INSERT INTO public.challenge_live(challenge_id, version, updated_at)
  SELECT p_challenge, 1, now() WHERE EXISTS (SELECT 1 FROM public.challenges WHERE id = p_challenge)
  ON CONFLICT (challenge_id) DO UPDATE SET version = public.challenge_live.version + 1, updated_at = now()
$$;

CREATE OR REPLACE FUNCTION public.challenge_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Every change to entries / attempts moves the challenge's live version.
CREATE OR REPLACE FUNCTION public.challenge_bump_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public._challenge_bump(OLD.challenge_id);
  ELSE PERFORM public._challenge_bump(NEW.challenge_id); END IF;
  RETURN NULL;
END $$;

-- Status, final results, start/end stamps and (once published) the slug only
-- change through the status functions.
CREATE OR REPLACE FUNCTION public.challenge_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE via_rpc boolean := coalesce(current_setting('jf.challenge_rpc', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT via_rpc AND (NEW.status <> 'draft' OR NEW.results_final_at IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.ended_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A new challenge starts as a draft.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT via_rpc THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.results_final_at IS DISTINCT FROM OLD.results_final_at
       OR NEW.final_by IS DISTINCT FROM OLD.final_by
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      RAISE EXCEPTION 'Change a challenge''s status with its status buttons.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.slug IS DISTINCT FROM OLD.slug AND OLD.status <> 'draft' AND NOT OLD.is_template THEN
      RAISE EXCEPTION 'The link can''t change once the challenge is published (shared links would break).' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_template IS DISTINCT FROM OLD.is_template AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft can become a template.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Results are history: only drafts, templates and test challenges can be deleted
-- (anything else is cancelled or archived instead).
CREATE OR REPLACE FUNCTION public.challenge_guard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND NOT OLD.is_template AND NOT OLD.is_test
     AND coalesce(current_setting('jf.allow_history_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A published challenge can''t be deleted. Cancel or archive it instead.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS challenges_guard_delete ON public.challenges;
CREATE TRIGGER challenges_guard_delete BEFORE DELETE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.challenge_guard_delete();

DROP TRIGGER IF EXISTS challenges_guard ON public.challenges;
CREATE TRIGGER challenges_guard BEFORE INSERT OR UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.challenge_guard();

CREATE OR REPLACE FUNCTION public.challenge_bump_self()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public._challenge_bump(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS challenges_bump ON public.challenges;
CREATE TRIGGER challenges_bump AFTER INSERT OR UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.challenge_bump_self();

DROP TRIGGER IF EXISTS challenge_entries_bump ON public.challenge_entries;
CREATE TRIGGER challenge_entries_bump AFTER INSERT OR UPDATE OR DELETE ON public.challenge_entries
  FOR EACH ROW EXECUTE FUNCTION public.challenge_bump_trigger();
DROP TRIGGER IF EXISTS challenge_attempts_bump ON public.challenge_attempts;
CREATE TRIGGER challenge_attempts_bump AFTER INSERT OR UPDATE OR DELETE ON public.challenge_attempts
  FOR EACH ROW EXECUTE FUNCTION public.challenge_bump_trigger();
DROP TRIGGER IF EXISTS challenge_divisions_bump ON public.challenge_divisions;
CREATE TRIGGER challenge_divisions_bump AFTER INSERT OR UPDATE OR DELETE ON public.challenge_divisions
  FOR EACH ROW EXECUTE FUNCTION public.challenge_bump_trigger();
DROP TRIGGER IF EXISTS challenge_sponsors_bump ON public.challenge_sponsors;
CREATE TRIGGER challenge_sponsors_bump AFTER INSERT OR UPDATE OR DELETE ON public.challenge_sponsors
  FOR EACH ROW EXECUTE FUNCTION public.challenge_bump_trigger();
DROP TRIGGER IF EXISTS challenge_prizes_bump ON public.challenge_prizes;
CREATE TRIGGER challenge_prizes_bump AFTER INSERT OR UPDATE OR DELETE ON public.challenge_prizes
  FOR EACH ROW EXECUTE FUNCTION public.challenge_bump_trigger();

DROP TRIGGER IF EXISTS challenge_entries_touch ON public.challenge_entries;
CREATE TRIGGER challenge_entries_touch BEFORE UPDATE ON public.challenge_entries
  FOR EACH ROW EXECUTE FUNCTION public.challenge_touch();
DROP TRIGGER IF EXISTS challenge_people_touch ON public.challenge_people;
CREATE TRIGGER challenge_people_touch BEFORE UPDATE ON public.challenge_people
  FOR EACH ROW EXECUTE FUNCTION public.challenge_touch();
DROP TRIGGER IF EXISTS challenge_people_private_touch ON public.challenge_people_private;
CREATE TRIGGER challenge_people_private_touch BEFORE UPDATE ON public.challenge_people_private
  FOR EACH ROW EXECUTE FUNCTION public.challenge_touch();
DROP TRIGGER IF EXISTS challenge_prizes_touch ON public.challenge_prizes;
CREATE TRIGGER challenge_prizes_touch BEFORE UPDATE ON public.challenge_prizes
  FOR EACH ROW EXECUTE FUNCTION public.challenge_touch();

-- ── Ranking engine ──────────────────────────────────────────────────────────
-- One row per active entry with a counted score:
--   score = best (or sum) of verified valid attempts, ÷ bodyweight when relative;
--   ranked by score in the challenge's direction, then by the published
--   tie-break ONLY when every lifter in that tie has the tie-break value
--   (lighter bodyweight, or a run-off attempt). Otherwise they share the place.
--   Submission time is never a tie-break.
CREATE OR REPLACE FUNCTION public._challenge_rank(p_challenge uuid)
RETURNS TABLE (entry_id uuid, division_id uuid, score numeric, rank_all int, rank_div int,
               tied_all boolean, tied_div boolean, valid_count int, attempt_count int, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (SELECT * FROM public.challenges WHERE id = p_challenge),
  s AS (
    SELECT e.id AS entry_id, e.division_id, e.bodyweight_kg,
      CASE WHEN c.aggregate = 'sum' THEN sum(a.value) FILTER (WHERE a.valid AND NOT a.is_tiebreak)
           WHEN c.direction = 'higher' THEN max(a.value) FILTER (WHERE a.valid AND NOT a.is_tiebreak)
           ELSE min(a.value) FILTER (WHERE a.valid AND NOT a.is_tiebreak) END AS raw,
      CASE WHEN c.direction = 'higher' THEN max(a.value) FILTER (WHERE a.valid AND a.is_tiebreak)
           ELSE min(a.value) FILTER (WHERE a.valid AND a.is_tiebreak) END AS runoff,
      (count(a.id) FILTER (WHERE NOT a.is_tiebreak))::int AS attempt_count,
      (count(a.id) FILTER (WHERE a.valid AND NOT a.is_tiebreak))::int AS valid_count,
      max(a.created_at) AS last_at
    FROM public.challenge_entries e
    CROSS JOIN c
    LEFT JOIN public.challenge_attempts a ON a.entry_id = e.id AND a.status = 'verified'
    WHERE e.challenge_id = p_challenge AND e.status NOT IN ('withdrawn','disqualified')
    GROUP BY e.id, e.division_id, e.bodyweight_kg, c.aggregate, c.direction
  ),
  k AS (
    SELECT s.*,
      CASE WHEN c.relative_to_bodyweight
           THEN CASE WHEN s.bodyweight_kg > 0 THEN round(s.raw / (s.bodyweight_kg * CASE WHEN c.unit = 'lb' THEN 2.2046226218 ELSE 1 END), 3) END
           ELSE s.raw END AS sc,
      c.direction, c.tiebreak
    FROM s CROSS JOIN c
  ),
  o AS (
    SELECT k.*,
      CASE WHEN k.direction = 'higher' THEN -k.sc ELSE k.sc END AS ord,
      CASE k.tiebreak
        WHEN 'lighter' THEN k.bodyweight_kg
        WHEN 'runoff' THEN CASE WHEN k.direction = 'higher' THEN -k.runoff ELSE k.runoff END
      END AS tbk
    FROM k WHERE k.sc IS NOT NULL
  ),
  g AS (
    SELECT o.*,
      CASE WHEN bool_and(o.tbk IS NOT NULL) OVER (PARTITION BY o.ord) THEN o.tbk END AS tb_all,
      CASE WHEN bool_and(o.tbk IS NOT NULL) OVER (PARTITION BY o.division_id, o.ord) THEN o.tbk END AS tb_div
    FROM o
  )
  SELECT g.entry_id, g.division_id, g.sc,
    (rank() OVER (ORDER BY g.ord, g.tb_all))::int,
    (rank() OVER (PARTITION BY g.division_id ORDER BY g.ord, g.tb_div))::int,
    (count(*) OVER (PARTITION BY g.ord, g.tb_all)) > 1,
    (count(*) OVER (PARTITION BY g.division_id, g.ord, g.tb_div)) > 1,
    g.valid_count, g.attempt_count, g.last_at
  FROM g
$$;

-- Ranks only ever mix divisions that share a load. A division with its own
-- load ("135 lb") is its own board.
CREATE OR REPLACE FUNCTION public._challenge_divisions_separate(p_challenge uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = p_challenge AND d.load_label IS NOT NULL)
$$;

-- ── Public reads ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._challenge_card(c public.challenges)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'title', c.title, 'tagline', c.tagline, 'status', c.status,
    'activity', c.activity, 'measure', c.measure, 'direction', c.direction, 'unit', c.unit,
    'aggregate', c.aggregate, 'attempts_allowed', c.attempts_allowed, 'relative', c.relative_to_bodyweight,
    'load_label', c.load_label, 'objective', c.objective, 'tiebreak', c.tiebreak,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'timezone', c.timezone,
    'venue_name', c.venue_name, 'city', c.city, 'cover_path', c.cover_path,
    'prize_summary', c.prize_summary, 'entry_fee_label', c.entry_fee_label,
    'is_test', c.is_test, 'final', c.results_final_at IS NOT NULL, 'results_final_at', c.results_final_at,
    'started_at', c.started_at, 'ended_at', c.ended_at,
    'separate_divisions', public._challenge_divisions_separate(c.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.challenge_hub()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(
    public._challenge_card(c) || jsonb_build_object(
      'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
      'competed', (SELECT count(*) FROM public._challenge_rank(c.id)),
      'leader', CASE WHEN NOT public._challenge_divisions_separate(c.id) THEN (
        SELECT jsonb_build_object('name', e.public_name, 'score', r.score, 'tied', r.tied_all,
                                  'photo', CASE WHEN e.show_photo THEN p.photo_path END)
        FROM public._challenge_rank(c.id) r
        JOIN public.challenge_entries e ON e.id = r.entry_id
        JOIN public.challenge_people p ON p.id = e.person_id
        WHERE r.rank_all = 1 ORDER BY e.public_name LIMIT 1) END
    ) ORDER BY coalesce(c.starts_at, c.created_at) DESC), '[]'::jsonb)
  FROM public.challenges c
  WHERE c.status NOT IN ('draft','cancelled') AND NOT c.is_template AND NOT c.is_test
$$;

CREATE OR REPLACE FUNCTION public.challenge_public(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(btrim(p_slug)) AND NOT is_template;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_role := public.challenge_role(c.id);
  IF c.status = 'draft' AND v_role IS NULL THEN RETURN NULL; END IF;
  RETURN public._challenge_card(c) || jsonb_build_object(
    'description', c.description, 'address', c.address,
    'max_participants', c.max_participants, 'min_age', c.min_age, 'eligibility', c.eligibility,
    'rules', c.rules, 'safety', c.safety, 'warmup', c.warmup,
    'self_registration', c.self_registration, 'collect', c.collect, 'acknowledgments', c.acknowledgments,
    'announcement', c.announcement, 'announcement_at', c.announcement_at,
    'my_role', v_role,
    'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id),
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'divisions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'load_label', d.load_label) ORDER BY d.sort, d.name)
                           FROM public.challenge_divisions d WHERE d.challenge_id = c.id), '[]'::jsonb),
    'sponsors', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'logo_path', s.logo_path, 'blurb', s.blurb) ORDER BY s.sort, s.name)
                          FROM public.challenge_sponsors s WHERE s.challenge_id = c.id), '[]'::jsonb),
    'prizes', coalesce((SELECT jsonb_agg(jsonb_build_object(
                  'place', pz.place, 'title', pz.title, 'value_cents', pz.value_cents, 'division_id', pz.division_id,
                  'sponsor', (SELECT s.name FROM public.challenge_sponsors s WHERE s.id = pz.sponsor_id),
                  'winner', CASE WHEN c.results_final_at IS NOT NULL AND pz.winner_entry_id IS NOT NULL THEN
                    (SELECT jsonb_build_object('name', e.public_name, 'code', e.share_code,
                                               'photo', CASE WHEN e.show_photo THEN p.photo_path END)
                     FROM public.challenge_entries e JOIN public.challenge_people p ON p.id = e.person_id
                     WHERE e.id = pz.winner_entry_id) END
                ) ORDER BY pz.division_id NULLS FIRST, pz.place)
                FROM public.challenge_prizes pz WHERE pz.challenge_id = c.id), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.challenge_board(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE slug = lower(btrim(p_slug)) AND NOT is_template;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_role := public.challenge_role(c.id);
  IF c.status = 'draft' AND v_role IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'challenge_id', c.id,
    'status', c.status,
    'final', c.results_final_at IS NOT NULL,
    'as_of', now(),
    'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id),
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'code', e.share_code, 'name', e.public_name,
        'photo', CASE WHEN e.show_photo THEN p.photo_path END,
        'handle', CASE WHEN p.discoverable THEN p.handle END,
        'division_id', r.division_id, 'score', r.score,
        'rank', r.rank_all, 'rank_div', r.rank_div, 'tied', r.tied_all, 'tied_div', r.tied_div,
        'valid', r.valid_count, 'attempts', r.attempt_count, 'at', r.last_at
      ) ORDER BY r.rank_all, e.public_name)
      FROM public._challenge_rank(c.id) r
      JOIN public.challenge_entries e ON e.id = r.entry_id
      JOIN public.challenge_people p ON p.id = e.person_id), '[]'::jsonb),
    'recent', coalesce((
      SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
        SELECT jsonb_build_object('id', a.id, 'code', e.share_code, 'name', e.public_name,
          'photo', CASE WHEN e.show_photo THEN p.photo_path END,
          'value', a.value, 'valid', a.valid, 'attempt_no', a.attempt_no, 'tiebreak', a.is_tiebreak,
          'division_id', e.division_id, 'at', a.created_at) AS x
        FROM public.challenge_attempts a
        JOIN public.challenge_entries e ON e.id = a.entry_id
        JOIN public.challenge_people p ON p.id = e.person_id
        WHERE a.challenge_id = c.id AND a.status = 'verified' AND e.status NOT IN ('withdrawn','disqualified')
        ORDER BY a.created_at DESC LIMIT 10) t), '[]'::jsonb)
  );
END $$;

-- One entry's result page (the link on a share card).
CREATE OR REPLACE FUNCTION public.challenge_entry_public(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE; c public.challenges%ROWTYPE; p public.challenge_people%ROWTYPE;
        v_score numeric; v_rank int; v_rank_div int; v_tied boolean; v_tied_div boolean;
        v_of_all int; v_of_div int; v_top numeric; v_top_div numeric;
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE share_code = lower(btrim(p_code));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF c.is_template OR (c.status = 'draft' AND public.challenge_role(c.id) IS NULL) THEN RETURN NULL; END IF;
  IF e.status = 'withdrawn' AND public.challenge_role(c.id) IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.challenge_people WHERE id = e.person_id;
  SELECT x.score, x.rank_all, x.rank_div, x.tied_all, x.tied_div INTO v_score, v_rank, v_rank_div, v_tied, v_tied_div
    FROM public._challenge_rank(c.id) x WHERE x.entry_id = e.id;
  SELECT count(*), min(CASE WHEN rank_all = 1 THEN score END) INTO v_of_all, v_top FROM public._challenge_rank(c.id);
  SELECT count(*), min(CASE WHEN rank_div = 1 THEN score END) INTO v_of_div, v_top_div
    FROM public._challenge_rank(c.id) x WHERE x.division_id IS NOT DISTINCT FROM e.division_id;
  RETURN jsonb_build_object(
    'challenge', public._challenge_card(c) || jsonb_build_object(
      'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = c.id),
      'divisions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'load_label', d.load_label) ORDER BY d.sort, d.name)
                             FROM public.challenge_divisions d WHERE d.challenge_id = c.id), '[]'::jsonb),
      'sponsors', coalesce((SELECT jsonb_agg(jsonb_build_object('name', s.name, 'logo_path', s.logo_path) ORDER BY s.sort, s.name)
                            FROM public.challenge_sponsors s WHERE s.challenge_id = c.id), '[]'::jsonb)),
    'code', e.share_code, 'name', e.public_name, 'status', e.status,
    'photo', CASE WHEN e.show_photo THEN p.photo_path END,
    'handle', CASE WHEN p.discoverable OR p.user_id = auth.uid() THEN p.handle END,
    'division_id', e.division_id,
    'score', v_score, 'rank', v_rank, 'rank_div', v_rank_div, 'tied', v_tied, 'tied_div', v_tied_div,
    'of', v_of_all, 'of_div', v_of_div, 'top', v_top, 'top_div', v_top_div,
    'attempts', coalesce((SELECT jsonb_agg(jsonb_build_object('no', a.attempt_no, 'value', a.value, 'valid', a.valid, 'tiebreak', a.is_tiebreak, 'at', a.created_at) ORDER BY a.is_tiebreak, a.attempt_no, a.created_at)
                          FROM public.challenge_attempts a WHERE a.entry_id = e.id AND a.status = 'verified'), '[]'::jsonb),
    'claimed', p.user_id IS NOT NULL,
    'is_mine', auth.uid() IS NOT NULL AND p.user_id = auth.uid()
  );
END $$;

-- A person's public profile across every challenge.
CREATE OR REPLACE FUNCTION public.challenge_athlete(p_handle text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.challenge_people%ROWTYPE; v_mine boolean; v_admin boolean;
BEGIN
  SELECT * INTO p FROM public.challenge_people WHERE handle = lower(btrim(p_handle));
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_mine := auth.uid() IS NOT NULL AND p.user_id = auth.uid();
  v_admin := auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin');
  IF NOT p.discoverable AND NOT v_mine AND NOT v_admin THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'handle', p.handle, 'name', p.display_name,
    -- a photo shows only while one of their entries carries photo consent
    'photo', CASE WHEN EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.person_id = p.id AND e.show_photo) THEN p.photo_path END,
    'discoverable', p.discoverable, 'claimed', p.user_id IS NOT NULL, 'is_mine', v_mine,
    'since', p.created_at,
    'entries', coalesce((
      SELECT jsonb_agg(public._challenge_card(c) || jsonb_build_object(
        'code', e.share_code, 'entry_name', e.public_name, 'entry_status', e.status,
        'division', (SELECT d.name FROM public.challenge_divisions d WHERE d.id = e.division_id),
        'score', r.score,
        'rank', CASE WHEN public._challenge_divisions_separate(c.id) THEN r.rank_div ELSE r.rank_all END,
        'tied', CASE WHEN public._challenge_divisions_separate(c.id) THEN r.tied_div ELSE r.tied_all END,
        'of', (SELECT count(*) FROM public._challenge_rank(c.id) x
               WHERE NOT public._challenge_divisions_separate(c.id) OR x.division_id IS NOT DISTINCT FROM e.division_id)
      ) ORDER BY coalesce(c.starts_at, e.created_at) DESC)
      FROM public.challenge_entries e
      JOIN public.challenges c ON c.id = e.challenge_id
      LEFT JOIN LATERAL (SELECT * FROM public._challenge_rank(c.id) x WHERE x.entry_id = e.id) r ON true
      WHERE e.person_id = p.id AND e.status <> 'withdrawn' AND c.status NOT IN ('draft','cancelled')
        AND NOT c.is_template AND (NOT c.is_test OR v_mine OR v_admin)), '[]'::jsonb)
  );
END $$;

-- ── Staff reads ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_staff_board(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := public.challenge_role(p_challenge); v_judge boolean;
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  v_judge := v_role IN ('admin','manager','judge');
  RETURN jsonb_build_object(
    'role', v_role,
    'version', (SELECT l.version FROM public.challenge_live l WHERE l.challenge_id = p_challenge),
    'entries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'bib', e.bib, 'code', e.share_code, 'name', e.public_name, 'status', e.status,
        'status_reason', e.status_reason, 'division_id', e.division_id, 'show_photo', e.show_photo,
        'photo', p.photo_path, 'person_id', CASE WHEN v_role = 'admin' THEN p.id END,
        'handle', p.handle, 'claimed', p.user_id IS NOT NULL,
        'bodyweight_kg', e.bodyweight_kg, 'source', e.source, 'created_at', e.created_at,
        'score', r.score, 'rank', r.rank_all, 'rank_div', r.rank_div, 'tied', r.tied_all, 'tied_div', r.tied_div,
        'attempts', CASE WHEN v_judge THEN coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', a.id, 'no', a.attempt_no, 'value', a.value, 'valid', a.valid,
            'tiebreak', a.is_tiebreak, 'status', a.status, 'note', a.note, 'video_url', a.video_url,
            'void_reason', a.void_reason, 'at', a.created_at, 'replaces', a.replaces) ORDER BY a.created_at)
          FROM public.challenge_attempts a WHERE a.entry_id = e.id), '[]'::jsonb) ELSE '[]'::jsonb END
      ) ORDER BY e.bib)
      FROM public.challenge_entries e
      JOIN public.challenge_people p ON p.id = e.person_id
      LEFT JOIN public._challenge_rank(p_challenge) r ON r.entry_id = e.id
      WHERE e.challenge_id = p_challenge), '[]'::jsonb)
  );
END $$;

-- ── Registration ────────────────────────────────────────────────────────────
-- Staff (register role) or the public (self-registration, rate limited).
-- p: {public_name, full_name, email, phone?, instagram?, division_id?, show_photo,
--     marketing_opt_in, acknowledged: [..], bodyweight_kg? (staff only), ref?, ref_source?}
CREATE OR REPLACE FUNCTION public.challenge_register(p_challenge uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.challenges%ROWTYPE;
  v_staff boolean := public.challenge_can(p_challenge, 'register');
  v_uid uuid := auth.uid();
  v_public text := btrim(coalesce(p ->> 'public_name', ''));
  v_full text := btrim(coalesce(p ->> 'full_name', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_phone text := nullif(btrim(coalesce(p ->> 'phone', '')), '');
  v_ig text := nullif(ltrim(btrim(coalesce(p ->> 'instagram', '')), '@'), '');
  v_div uuid;
  v_show boolean := coalesce((p ->> 'show_photo')::boolean, false);
  v_mkt boolean := coalesce((p ->> 'marketing_opt_in')::boolean, false);
  v_ack jsonb := coalesce(p -> 'acknowledged', '[]'::jsonb);
  v_bw numeric := CASE WHEN v_staff THEN nullif(p ->> 'bodyweight_kg', '')::numeric END;
  v_ref uuid;
  v_ref_source text := nullif(p ->> 'ref_source', '');
  v_person uuid; v_entry uuid; v_bib int; v_code text; v_token text; v_existing uuid;
  v_count int; v_ip text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR c.is_template THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;

  IF v_staff THEN
    IF c.status NOT IN ('draft','upcoming','live','paused','verifying') THEN
      RAISE EXCEPTION 'Registration is closed for this challenge.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT c.self_registration OR c.status NOT IN ('upcoming','live','paused') THEN
      RAISE EXCEPTION 'Registration is closed for this challenge.' USING ERRCODE = 'P0001';
    END IF;
    v_ip := public._challenge_client_ip();
    IF NOT public._challenge_rate_ok('reg:' || p_challenge || ':' || v_ip, 8, interval '15 minutes')
       OR NOT public._challenge_rate_ok('reg:' || v_ip, 20, interval '1 hour') THEN
      RAISE EXCEPTION 'Too many sign-ups from this connection. Ask event staff to register you.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- validation
  IF length(v_public) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Add the name to show on the leaderboard (40 characters max).' USING ERRCODE = 'P0001'; END IF;
  IF length(v_full) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Add your full name.' USING ERRCODE = 'P0001'; END IF;
  IF v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 200 THEN RAISE EXCEPTION 'Add a valid email.' USING ERRCODE = 'P0001'; END IF;
  IF v_phone IS NOT NULL AND (length(regexp_replace(v_phone, '\D', '', 'g')) NOT BETWEEN 7 AND 15) THEN RAISE EXCEPTION 'That phone number doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'phone', 'optional') = 'required' AND v_phone IS NULL THEN RAISE EXCEPTION 'Add a phone number.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'instagram', 'optional') = 'required' AND v_ig IS NULL THEN RAISE EXCEPTION 'Add your Instagram.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'phone', 'optional') = 'off' THEN v_phone := NULL; END IF;
  IF coalesce(c.collect ->> 'instagram', 'optional') = 'off' THEN v_ig := NULL; END IF;
  IF v_ig IS NOT NULL AND v_ig !~ '^[A-Za-z0-9._]{1,30}$' THEN RAISE EXCEPTION 'That Instagram handle doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(v_ack) <> 'array' OR jsonb_array_length(v_ack) < jsonb_array_length(c.acknowledgments)
     OR NOT (c.acknowledgments <@ v_ack) THEN
    RAISE EXCEPTION 'Every box has to be ticked to compete.' USING ERRCODE = 'P0001';
  END IF;
  IF v_bw IS NOT NULL AND (v_bw < 25 OR v_bw > 350) THEN RAISE EXCEPTION 'That bodyweight doesn''t look right.' USING ERRCODE = 'P0001'; END IF;

  IF EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = c.id) THEN
    SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id = nullif(p ->> 'division_id', '')::uuid;
    IF v_div IS NULL THEN RAISE EXCEPTION 'Pick a division.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  IF c.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.challenge_entries WHERE challenge_id = c.id AND status <> 'withdrawn';
    IF v_count >= c.max_participants THEN RAISE EXCEPTION 'This challenge is full.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  -- already in this challenge with that email?
  SELECT e.id INTO v_existing FROM public.challenge_entries e
    JOIN public.challenge_people_private pp ON pp.person_id = e.person_id
    WHERE e.challenge_id = c.id AND lower(pp.email) = v_email AND e.status <> 'withdrawn' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_staff THEN
      RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true) FROM public.challenge_entries e WHERE e.id = v_existing);
    END IF;
    RAISE EXCEPTION 'That email is already registered for this challenge. Find event staff if you need a hand.' USING ERRCODE = 'P0001';
  END IF;

  -- who is this? staff entries (trusted) and signed-in people reuse their profile;
  -- a public sign-up never attaches to someone else's profile by typing their email.
  IF v_uid IS NOT NULL AND NOT v_staff THEN
    SELECT id INTO v_person FROM public.challenge_people WHERE user_id = v_uid;
  END IF;
  IF v_person IS NULL AND v_staff THEN
    SELECT pp.person_id INTO v_person FROM public.challenge_people_private pp
      JOIN public.challenge_people pe ON pe.id = pp.person_id
      WHERE lower(pp.email) = v_email
      ORDER BY (pe.user_id IS NOT NULL) DESC, pe.created_at LIMIT 1;
  END IF;
  -- a withdrawn entry in this challenge comes back instead of a second row
  IF v_person IS NOT NULL THEN
    SELECT e.id INTO v_existing FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.person_id = v_person;
    IF v_existing IS NOT NULL THEN
      IF (SELECT status FROM public.challenge_entries WHERE id = v_existing) <> 'withdrawn' THEN
        IF v_staff THEN
          RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true) FROM public.challenge_entries e WHERE e.id = v_existing);
        END IF;
        RAISE EXCEPTION 'You''re already registered for this challenge.' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.challenge_entries SET status = 'registered', status_reason = NULL, public_name = v_public,
        division_id = v_div, show_photo = v_show, acknowledged = v_ack, acknowledged_at = now(),
        bodyweight_kg = coalesce(v_bw, bodyweight_kg)
      WHERE id = v_existing;
      PERFORM public._challenge_audit(c.id, 'reregister', 'entry', v_existing, jsonb_build_object('source', CASE WHEN v_staff THEN 'staff' ELSE 'self' END));
      IF v_show THEN
        v_token := encode(extensions.gen_random_bytes(24), 'hex');
        INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id) VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person, v_existing);
      END IF;
      RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true, 'photo_ticket', v_token) FROM public.challenge_entries e WHERE e.id = v_existing);
    END IF;
  END IF;

  IF v_person IS NULL THEN
    INSERT INTO public.challenge_people(handle, display_name, user_id)
    VALUES (public._challenge_handle(v_public), v_public,
            CASE WHEN v_uid IS NOT NULL AND NOT v_staff
                      AND lower((SELECT u.email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL)) = v_email
                 THEN v_uid END)
    RETURNING id INTO v_person;
    INSERT INTO public.challenge_people_private(person_id, full_name, email, phone, instagram, marketing_opt_in, marketing_opt_in_at)
    VALUES (v_person, v_full, v_email, v_phone, v_ig, v_mkt, CASE WHEN v_mkt THEN now() END);
  ELSE
    -- keep their contact details current; marketing consent is only ever added here, never removed silently
    UPDATE public.challenge_people_private SET
      full_name = v_full, phone = coalesce(v_phone, phone), instagram = coalesce(v_ig, instagram),
      marketing_opt_in = marketing_opt_in OR v_mkt,
      marketing_opt_in_at = CASE WHEN v_mkt AND NOT marketing_opt_in THEN now() ELSE marketing_opt_in_at END
    WHERE person_id = v_person;
  END IF;

  IF p ->> 'ref' IS NOT NULL THEN
    SELECT e.id INTO v_ref FROM public.challenge_entries e WHERE e.share_code = lower(btrim(p ->> 'ref'));
  END IF;
  IF v_ref_source IS NOT NULL AND v_ref_source NOT IN ('qr','link','friend','display') THEN v_ref_source := NULL; END IF;
  IF v_ref IS NOT NULL THEN v_ref_source := 'friend'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('challenge_bib:' || c.id::text));
  SELECT coalesce(max(bib), 0) + 1 INTO v_bib FROM public.challenge_entries WHERE challenge_id = c.id;
  LOOP
    v_code := public._challenge_code(8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.challenge_entries WHERE share_code = v_code);
  END LOOP;

  INSERT INTO public.challenge_entries(challenge_id, person_id, division_id, bib, share_code, public_name, show_photo,
    bodyweight_kg, source, ref_source, referred_by, acknowledged, registered_by)
  VALUES (c.id, v_person, v_div, v_bib, v_code, v_public, v_show, v_bw,
    CASE WHEN v_staff THEN 'staff' ELSE 'self' END, v_ref_source, v_ref, v_ack, v_uid)
  RETURNING id INTO v_entry;

  IF v_show THEN
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id)
    VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person, v_entry);
  END IF;

  PERFORM public._challenge_audit(c.id, 'register', 'entry', v_entry,
    jsonb_build_object('source', CASE WHEN v_staff THEN 'staff' ELSE 'self' END, 'bib', v_bib, 'ref_source', v_ref_source));

  RETURN jsonb_build_object('entry_id', v_entry, 'code', v_code, 'bib', v_bib, 'existing', false,
    'photo_ticket', v_token, 'handle', (SELECT handle FROM public.challenge_people WHERE id = v_person));
END $$;

-- Staff edits to an entry. p: {public_name?, division_id?, status?, status_reason?, bodyweight_kg?, show_photo?}
CREATE OR REPLACE FUNCTION public.challenge_update_entry(p_entry uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE; c public.challenges%ROWTYPE; v_status text; v_div uuid; v_bw numeric;
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF NOT public.challenge_can(c.id, 'register') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status IN ('completed','archived') AND NOT public.challenge_can(c.id, 'admin') THEN
    RAISE EXCEPTION 'Results are final. Reopen them to change an entry.' USING ERRCODE = 'P0001';
  END IF;
  v_status := coalesce(p ->> 'status', e.status);
  IF v_status NOT IN ('registered','checked_in','withdrawn','disqualified') THEN RAISE EXCEPTION 'Unknown status.' USING ERRCODE = 'P0001'; END IF;
  IF v_status = 'disqualified' AND e.status <> 'disqualified' THEN
    IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Only a judge can disqualify.' USING ERRCODE = '42501'; END IF;
    IF length(btrim(coalesce(p ->> 'status_reason', ''))) < 3 THEN RAISE EXCEPTION 'Say why they''re disqualified.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF e.status = 'disqualified' AND v_status <> 'disqualified' AND NOT public.challenge_can(c.id, 'manage') THEN
    RAISE EXCEPTION 'Only the event manager can reinstate a disqualified entry.' USING ERRCODE = '42501';
  END IF;
  IF p ? 'division_id' THEN
    SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id = nullif(p ->> 'division_id', '')::uuid;
    IF v_div IS NULL AND EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = c.id) THEN
      RAISE EXCEPTION 'Pick a division.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_div := e.division_id;
  END IF;
  v_bw := CASE WHEN p ? 'bodyweight_kg' THEN nullif(p ->> 'bodyweight_kg', '')::numeric ELSE e.bodyweight_kg END;
  IF v_bw IS NOT NULL AND (v_bw < 25 OR v_bw > 350) THEN RAISE EXCEPTION 'That bodyweight doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF p ? 'public_name' AND length(btrim(coalesce(p ->> 'public_name', ''))) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Add the name to show on the leaderboard.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.challenge_entries SET
    public_name = CASE WHEN p ? 'public_name' THEN btrim(p ->> 'public_name') ELSE public_name END,
    division_id = v_div,
    status = v_status,
    status_reason = CASE WHEN v_status IN ('withdrawn','disqualified') THEN nullif(btrim(coalesce(p ->> 'status_reason', status_reason, '')), '') ELSE NULL END,
    bodyweight_kg = v_bw,
    show_photo = CASE WHEN p ? 'show_photo' THEN (p ->> 'show_photo')::boolean ELSE show_photo END
  WHERE id = e.id;

  PERFORM public._challenge_audit(c.id, 'update', 'entry', e.id, jsonb_build_object(
    'before', jsonb_build_object('public_name', e.public_name, 'division_id', e.division_id, 'status', e.status, 'bodyweight_kg', e.bodyweight_kg, 'show_photo', e.show_photo),
    'change', p - 'bodyweight_kg' || CASE WHEN p ? 'bodyweight_kg' THEN jsonb_build_object('bodyweight_kg', 'changed') ELSE '{}'::jsonb END));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Delete a mistaken registration (admin; never once a score is on it).
CREATE OR REPLACE FUNCTION public.challenge_delete_entry(p_entry uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.challenge_can(e.challenge_id, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.challenge_attempts a WHERE a.entry_id = e.id) THEN
    RAISE EXCEPTION 'This entry has scores. Withdraw it instead, so its history stays.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.challenge_entries WHERE id = e.id;
  PERFORM public._challenge_audit(e.challenge_id, 'delete', 'entry', e.id, jsonb_build_object('public_name', e.public_name, 'bib', e.bib));
  DELETE FROM public.challenge_people pe WHERE pe.id = e.person_id AND pe.user_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.challenge_entries x WHERE x.person_id = pe.id);
END $$;

-- ── Scores ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._challenge_attempt_result(p_attempt uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', a.id, 'entry_id', a.entry_id, 'attempt_no', a.attempt_no, 'value', a.value, 'valid', a.valid,
    'status', a.status, 'tiebreak', a.is_tiebreak,
    'score', r.score, 'rank', r.rank_all, 'rank_div', r.rank_div, 'tied', r.tied_all,
    'of', (SELECT count(*) FROM public._challenge_rank(a.challenge_id)))
  FROM public.challenge_attempts a
  LEFT JOIN LATERAL (SELECT * FROM public._challenge_rank(a.challenge_id) x WHERE x.entry_id = a.entry_id) r ON true
  WHERE a.id = p_attempt
$$;

CREATE OR REPLACE FUNCTION public.challenge_record_attempt(
  p_entry uuid, p_value numeric, p_valid boolean, p_client_key uuid,
  p_note text DEFAULT NULL, p_video_url text DEFAULT NULL, p_tiebreak boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE; c public.challenges%ROWTYPE; v_id uuid; v_no int;
BEGIN
  IF p_client_key IS NULL THEN RAISE EXCEPTION 'missing_client_key' USING ERRCODE = 'P0001'; END IF;
  -- the same save sent twice (a retry on a bad connection) is the same attempt
  SELECT id INTO v_id FROM public.challenge_attempts WHERE client_key = p_client_key;
  IF v_id IS NOT NULL THEN RETURN public._challenge_attempt_result(v_id) || jsonb_build_object('replayed', true); END IF;

  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Only a judge can record scores.' USING ERRCODE = '42501'; END IF;
  IF c.status = 'paused' THEN RAISE EXCEPTION 'The event is paused. Resume it to record scores.' USING ERRCODE = 'P0001'; END IF;
  IF c.status NOT IN ('draft','live','verifying') THEN
    RAISE EXCEPTION 'Scores can only be recorded while the event is live.' USING ERRCODE = 'P0001';
  END IF;
  IF e.status IN ('withdrawn','disqualified') THEN RAISE EXCEPTION 'This entry is %.', e.status USING ERRCODE = 'P0001'; END IF;
  IF p_valid AND p_value IS NULL THEN RAISE EXCEPTION 'Enter the score.' USING ERRCODE = 'P0001'; END IF;
  IF p_value IS NOT NULL AND (p_value < 0 OR p_value > 100000) THEN RAISE EXCEPTION 'That score is out of range.' USING ERRCODE = 'P0001'; END IF;
  IF c.measure = 'reps' AND p_value IS NOT NULL AND p_value <> trunc(p_value) THEN RAISE EXCEPTION 'Reps are whole numbers.' USING ERRCODE = 'P0001'; END IF;

  IF p_tiebreak THEN
    IF c.tiebreak <> 'runoff' THEN RAISE EXCEPTION 'This challenge breaks ties another way.' USING ERRCODE = 'P0001'; END IF;
    v_no := 0;
  ELSE
    SELECT count(*) + 1 INTO v_no FROM public.challenge_attempts
      WHERE entry_id = e.id AND status = 'verified' AND NOT is_tiebreak;
    IF v_no > c.attempts_allowed THEN
      RAISE EXCEPTION 'All % attempt(s) are recorded. Correct one instead.', c.attempts_allowed USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.challenge_attempts(challenge_id, entry_id, attempt_no, value, valid, is_tiebreak, note, video_url, judge_id, client_key)
    VALUES (c.id, e.id, v_no, p_value, p_valid, coalesce(p_tiebreak, false), nullif(btrim(coalesce(p_note, '')), ''),
            nullif(btrim(coalesce(p_video_url, '')), ''), auth.uid(), p_client_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.challenge_attempts WHERE client_key = p_client_key;
    RETURN public._challenge_attempt_result(v_id) || jsonb_build_object('replayed', true);
  END;

  IF e.status = 'registered' THEN
    UPDATE public.challenge_entries SET status = 'checked_in' WHERE id = e.id;
  END IF;
  PERFORM public._challenge_audit(c.id, 'record', 'attempt', v_id,
    jsonb_build_object('entry_id', e.id, 'attempt_no', v_no, 'value', p_value, 'valid', p_valid, 'tiebreak', p_tiebreak));
  RETURN public._challenge_attempt_result(v_id);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_void_attempt(p_attempt uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_attempts%ROWTYPE; c public.challenges%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.challenge_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = a.challenge_id;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status NOT IN ('draft','live','paused','verifying') THEN RAISE EXCEPTION 'Results are final. Reopen them to correct a score.' USING ERRCODE = 'P0001'; END IF;
  IF a.status = 'void' THEN RETURN jsonb_build_object('ok', true); END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why this score is being removed.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.challenge_attempts SET status = 'void', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now() WHERE id = a.id;
  PERFORM public._challenge_audit(c.id, 'void', 'attempt', a.id, jsonb_build_object('entry_id', a.entry_id, 'value', a.value, 'valid', a.valid, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- A correction keeps the old score (void, with the reason) and records the new one in its place.
CREATE OR REPLACE FUNCTION public.challenge_correct_attempt(p_attempt uuid, p_value numeric, p_valid boolean, p_reason text, p_client_key uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.challenge_attempts%ROWTYPE; c public.challenges%ROWTYPE; v_id uuid;
BEGIN
  IF p_client_key IS NULL THEN RAISE EXCEPTION 'missing_client_key' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_id FROM public.challenge_attempts WHERE client_key = p_client_key;
  IF v_id IS NOT NULL THEN RETURN public._challenge_attempt_result(v_id) || jsonb_build_object('replayed', true); END IF;
  SELECT * INTO a FROM public.challenge_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = a.challenge_id;
  IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status NOT IN ('draft','live','paused','verifying') THEN RAISE EXCEPTION 'Results are final. Reopen them to correct a score.' USING ERRCODE = 'P0001'; END IF;
  IF a.status = 'void' THEN RAISE EXCEPTION 'That score was already removed.' USING ERRCODE = 'P0001'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why the score is changing.' USING ERRCODE = 'P0001'; END IF;
  IF p_valid AND p_value IS NULL THEN RAISE EXCEPTION 'Enter the score.' USING ERRCODE = 'P0001'; END IF;
  IF p_value IS NOT NULL AND (p_value < 0 OR p_value > 100000) THEN RAISE EXCEPTION 'That score is out of range.' USING ERRCODE = 'P0001'; END IF;
  IF c.measure = 'reps' AND p_value IS NOT NULL AND p_value <> trunc(p_value) THEN RAISE EXCEPTION 'Reps are whole numbers.' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.challenge_attempts SET status = 'void', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now() WHERE id = a.id;
  INSERT INTO public.challenge_attempts(challenge_id, entry_id, attempt_no, value, valid, is_tiebreak, note, video_url, judge_id, client_key, replaces)
  VALUES (a.challenge_id, a.entry_id, a.attempt_no, p_value, p_valid, a.is_tiebreak, a.note, a.video_url, auth.uid(), p_client_key, a.id)
  RETURNING id INTO v_id;
  PERFORM public._challenge_audit(c.id, 'correct', 'attempt', v_id, jsonb_build_object(
    'entry_id', a.entry_id, 'replaces', a.id, 'from', jsonb_build_object('value', a.value, 'valid', a.valid),
    'to', jsonb_build_object('value', p_value, 'valid', p_valid), 'reason', btrim(p_reason)));
  RETURN public._challenge_attempt_result(v_id);
END $$;

-- ── Lifecycle ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_set_status(p_challenge uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; v_move text; v_need text; v_missing text[] := '{}';
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR c.is_template THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;
  IF c.status = p_status THEN RETURN jsonb_build_object('status', c.status); END IF;
  v_move := c.status || '>' || p_status;
  IF v_move IN ('upcoming>live','live>paused','paused>live','live>verifying','paused>verifying','verifying>live') THEN
    v_need := 'manage';
  ELSIF v_move IN ('draft>upcoming','upcoming>draft','completed>verifying','completed>archived','archived>completed','cancelled>draft')
     OR (p_status = 'cancelled' AND c.status IN ('draft','upcoming','live','paused','verifying')) THEN
    v_need := 'admin';
  ELSE
    RAISE EXCEPTION 'A challenge can''t go from % to %.', c.status, p_status USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.challenge_can(c.id, v_need) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;

  IF v_move = 'draft>upcoming' THEN
    IF c.starts_at IS NULL THEN v_missing := array_append(v_missing, 'a start date and time'); END IF;
    IF c.venue_name IS NULL THEN v_missing := array_append(v_missing, 'a venue'); END IF;
    IF jsonb_array_length(c.rules) = 0 THEN v_missing := array_append(v_missing, 'the rules'); END IF;
    IF array_length(v_missing, 1) > 0 THEN
      RAISE EXCEPTION 'Add % before publishing.', array_to_string(v_missing, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('jf.challenge_rpc', 'on', true);
  UPDATE public.challenges SET
    status = p_status,
    started_at = CASE WHEN p_status = 'live' THEN coalesce(started_at, now()) ELSE started_at END,
    ended_at = CASE WHEN p_status = 'verifying' AND c.status IN ('live','paused') THEN now()
                    WHEN p_status = 'live' THEN NULL ELSE ended_at END,
    results_final_at = CASE WHEN p_status IN ('verifying','draft','cancelled','live') THEN NULL ELSE results_final_at END,
    final_by = CASE WHEN p_status IN ('verifying','draft','cancelled','live') THEN NULL ELSE final_by END
  WHERE id = c.id;
  PERFORM set_config('jf.challenge_rpc', 'off', true);

  -- reopening results takes back the winners the system picked (an admin's own pick stays)
  IF v_move = 'completed>verifying' THEN
    UPDATE public.challenge_prizes SET winner_entry_id = NULL, winner_source = NULL
      WHERE challenge_id = c.id AND winner_source = 'auto' AND status = 'open';
  END IF;

  PERFORM public._challenge_audit(c.id, 'status', 'challenge', c.id, jsonb_build_object('from', c.status, 'to', p_status));
  RETURN jsonb_build_object('status', p_status);
END $$;

-- Confirm final results: verifying → completed, winners filled in by place.
-- A tie for a prize's place is never broken here: it's returned for the admin.
CREATE OR REPLACE FUNCTION public.challenge_finalize(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; pz record; v_ids uuid[]; v_ties jsonb := '[]'::jsonb; v_sep boolean; v_assigned int := 0;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.challenge_can(c.id, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'verifying' THEN RAISE EXCEPTION 'End the event before confirming results.' USING ERRCODE = 'P0001'; END IF;
  v_sep := public._challenge_divisions_separate(c.id);

  FOR pz IN SELECT * FROM public.challenge_prizes WHERE challenge_id = c.id ORDER BY place LOOP
    IF pz.winner_source = 'admin' AND pz.winner_entry_id IS NOT NULL THEN CONTINUE; END IF;
    SELECT array_agg(r.entry_id) INTO v_ids FROM public._challenge_rank(c.id) r
     WHERE (CASE WHEN pz.division_id IS NULL AND NOT v_sep THEN r.rank_all ELSE r.rank_div END) = pz.place
       AND (pz.division_id IS NULL OR r.division_id = pz.division_id);
    IF coalesce(array_length(v_ids, 1), 0) = 1 THEN
      UPDATE public.challenge_prizes SET winner_entry_id = v_ids[1], winner_source = 'auto' WHERE id = pz.id;
      v_assigned := v_assigned + 1;
    ELSE
      UPDATE public.challenge_prizes SET winner_entry_id = NULL, winner_source = NULL WHERE id = pz.id;
      IF coalesce(array_length(v_ids, 1), 0) > 1 THEN
        v_ties := v_ties || jsonb_build_object('prize_id', pz.id, 'place', pz.place, 'title', pz.title,
          'names', (SELECT jsonb_agg(e.public_name ORDER BY e.public_name) FROM public.challenge_entries e WHERE e.id = ANY(v_ids)));
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('jf.challenge_rpc', 'on', true);
  UPDATE public.challenges SET status = 'completed', results_final_at = now(), final_by = auth.uid(),
    ended_at = coalesce(ended_at, now()) WHERE id = c.id;
  PERFORM set_config('jf.challenge_rpc', 'off', true);
  PERFORM public._challenge_audit(c.id, 'finalize', 'challenge', c.id, jsonb_build_object('assigned', v_assigned, 'ties', v_ties));
  RETURN jsonb_build_object('assigned', v_assigned, 'ties', v_ties);
END $$;

-- Copy a challenge (as a new draft, or a reusable template): details,
-- divisions, sponsors and prizes; never entries, scores or winners.
CREATE OR REPLACE FUNCTION public.challenge_duplicate(p_challenge uuid, p_as_template boolean DEFAULT false, p_title text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; v_new uuid; v_title text; v_slug text; d record; v_map jsonb := '{}'::jsonb; v_div uuid; s record; v_smap jsonb := '{}'::jsonb; v_sid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;
  v_title := coalesce(nullif(btrim(p_title), ''), c.title);
  LOOP
    v_slug := coalesce(public._challenge_slugify(v_title, 48), 'challenge') || '-' || public._challenge_code(4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.challenges WHERE slug = v_slug);
  END LOOP;
  INSERT INTO public.challenges(slug, title, tagline, description, activity, exercise_id, measure, direction, unit, aggregate,
    attempts_allowed, relative_to_bodyweight, load_label, objective, tiebreak, timezone, venue_name, city, address,
    max_participants, min_age, eligibility, rules, safety, warmup, prize_summary, entry_fee_label, self_registration,
    collect, acknowledgments, cover_path, is_template, duplicated_from)
  VALUES (v_slug, v_title, c.tagline, c.description, c.activity, c.exercise_id, c.measure, c.direction, c.unit, c.aggregate,
    c.attempts_allowed, c.relative_to_bodyweight, c.load_label, c.objective, c.tiebreak, c.timezone, c.venue_name, c.city, c.address,
    c.max_participants, c.min_age, c.eligibility, c.rules, c.safety, c.warmup, c.prize_summary, c.entry_fee_label, c.self_registration,
    c.collect, c.acknowledgments, c.cover_path, coalesce(p_as_template, false), c.id)
  RETURNING id INTO v_new;
  FOR d IN SELECT * FROM public.challenge_divisions WHERE challenge_id = c.id LOOP
    INSERT INTO public.challenge_divisions(challenge_id, name, load_label, sort) VALUES (v_new, d.name, d.load_label, d.sort) RETURNING id INTO v_div;
    v_map := v_map || jsonb_build_object(d.id::text, v_div);
  END LOOP;
  FOR s IN SELECT * FROM public.challenge_sponsors WHERE challenge_id = c.id LOOP
    INSERT INTO public.challenge_sponsors(challenge_id, name, url, logo_path, blurb, contribution_cents, sort)
    VALUES (v_new, s.name, s.url, s.logo_path, s.blurb, s.contribution_cents, s.sort) RETURNING id INTO v_sid;
    v_smap := v_smap || jsonb_build_object(s.id::text, v_sid);
  END LOOP;
  INSERT INTO public.challenge_prizes(challenge_id, division_id, place, title, value_cents, sponsor_id, collection_notes)
  SELECT v_new, (v_map ->> pz.division_id::text)::uuid, pz.place, pz.title, pz.value_cents, (v_smap ->> pz.sponsor_id::text)::uuid, pz.collection_notes
  FROM public.challenge_prizes pz WHERE pz.challenge_id = c.id;
  PERFORM public._challenge_audit(v_new, 'duplicate', 'challenge', v_new, jsonb_build_object('from', c.id, 'template', p_as_template));
  RETURN v_new;
END $$;

-- Clear a draft's practice run (entries and scores). Drafts only.
CREATE OR REPLACE FUNCTION public.challenge_reset_practice(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; v_people uuid[]; n int;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.challenge_can(c.id, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft''s practice run can be cleared.' USING ERRCODE = 'P0001'; END IF;
  SELECT array_agg(person_id), count(*) INTO v_people, n FROM public.challenge_entries WHERE challenge_id = c.id;
  UPDATE public.challenge_prizes SET winner_entry_id = NULL, winner_source = NULL, status = 'open', notified_at = NULL, claimed_at = NULL WHERE challenge_id = c.id;
  DELETE FROM public.challenge_attempts WHERE challenge_id = c.id;
  DELETE FROM public.challenge_entries WHERE challenge_id = c.id;
  DELETE FROM public.challenge_metrics WHERE challenge_id = c.id;
  DELETE FROM public.challenge_people pe WHERE pe.id = ANY(coalesce(v_people, '{}')) AND pe.user_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.challenge_entries x WHERE x.person_id = pe.id);
  PERFORM public._challenge_audit(c.id, 'reset_practice', 'challenge', c.id, jsonb_build_object('entries', coalesce(n, 0)));
  RETURN jsonb_build_object('cleared', coalesce(n, 0));
END $$;

-- ── Photos ──────────────────────────────────────────────────────────────────

-- Staff: a fresh upload ticket for an entrant's photo (retake / add later).
CREATE OR REPLACE FUNCTION public.challenge_photo_ticket(p_entry uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE; v_token text;
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.challenge_can(e.challenge_id, 'register') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id) VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), e.person_id, e.id);
  RETURN v_token;
END $$;

-- The person themselves (claimed profile): a ticket to change their photo.
CREATE OR REPLACE FUNCTION public.challenge_my_photo_ticket()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_person uuid; v_token text;
BEGIN
  SELECT id INTO v_person FROM public.challenge_people WHERE user_id = auth.uid();
  IF v_person IS NULL THEN RAISE EXCEPTION 'Claim your profile first.' USING ERRCODE = 'P0001'; END IF;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.challenge_photo_tickets(token_hash, person_id) VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person);
  RETURN v_token;
END $$;

-- Server only (service role): check a ticket before uploading.
CREATE OR REPLACE FUNCTION public.challenge_photo_ticket_check(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('person_id', t.person_id, 'entry_id', t.entry_id, 'old_path', p.photo_path)
  FROM public.challenge_photo_tickets t JOIN public.challenge_people p ON p.id = t.person_id
  WHERE t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    AND t.used_at IS NULL AND t.expires_at > now()
$$;

-- Server only: the upload worked, put it on the person and spend the ticket.
CREATE OR REPLACE FUNCTION public.challenge_photo_ticket_redeem(p_token text, p_path text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.challenge_photo_tickets%ROWTYPE; v_old text; v_challenge uuid;
BEGIN
  SELECT * INTO t FROM public.challenge_photo_tickets
   WHERE token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') AND used_at IS NULL AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That photo link has expired.' USING ERRCODE = 'P0001'; END IF;
  IF p_path !~ ('^people/' || t.person_id::text || '/[a-z0-9]+\.(jpg|png|webp)$') THEN RAISE EXCEPTION 'bad_path' USING ERRCODE = 'P0001'; END IF;
  SELECT photo_path INTO v_old FROM public.challenge_people WHERE id = t.person_id;
  UPDATE public.challenge_photo_tickets SET used_at = now() WHERE token_hash = t.token_hash;
  UPDATE public.challenge_people SET photo_path = p_path WHERE id = t.person_id;
  IF t.entry_id IS NOT NULL THEN
    UPDATE public.challenge_entries SET show_photo = true WHERE id = t.entry_id RETURNING challenge_id INTO v_challenge;
  END IF;
  INSERT INTO public.challenge_audit(challenge_id, actor, action, entity, entity_id, detail)
  VALUES (v_challenge, NULL, 'photo', 'person', t.person_id, jsonb_build_object('entry_id', t.entry_id));
  RETURN jsonb_build_object('old_path', v_old);
END $$;

-- Remove a person's photo (themselves, or staff of a challenge they entered).
-- Returns the old file's path; the server deletes the file.
CREATE OR REPLACE FUNCTION public.challenge_photo_clear(p_person uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.challenge_people%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.challenge_people WHERE id = p_person FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
          OR EXISTS (SELECT 1 FROM public.challenge_entries e WHERE e.person_id = p.id AND public.challenge_can(e.challenge_id, 'register'))) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.challenge_people SET photo_path = NULL WHERE id = p.id;
  UPDATE public.challenge_entries SET show_photo = false WHERE person_id = p.id AND show_photo;
  PERFORM public._challenge_audit(NULL, 'photo_removed', 'person', p.id, '{}'::jsonb);
  RETURN p.photo_path;
END $$;

-- ── Profiles ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._challenge_merge(p_keep uuid, p_drop uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.challenge_people%ROWTYPE; d public.challenge_people%ROWTYPE; v_moved int; v_left int;
BEGIN
  IF p_keep = p_drop THEN RAISE EXCEPTION 'Pick two different athletes.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO k FROM public.challenge_people WHERE id = p_keep FOR UPDATE;
  SELECT * INTO d FROM public.challenge_people WHERE id = p_drop FOR UPDATE;
  IF k.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'Athlete not found.' USING ERRCODE = 'P0002'; END IF;
  IF k.user_id IS NOT NULL AND d.user_id IS NOT NULL AND k.user_id <> d.user_id THEN
    RAISE EXCEPTION 'Both profiles are claimed by different logins.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.challenge_entries e SET person_id = k.id
   WHERE e.person_id = d.id AND NOT EXISTS (SELECT 1 FROM public.challenge_entries x WHERE x.person_id = k.id AND x.challenge_id = e.challenge_id);
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  SELECT count(*) INTO v_left FROM public.challenge_entries WHERE person_id = d.id;
  IF v_left = 0 THEN
    -- the dropped profile lets go of its login first (user_id is unique)
    UPDATE public.challenge_people SET user_id = NULL WHERE id = d.id;
    UPDATE public.challenge_people SET photo_path = coalesce(k.photo_path, d.photo_path),
      user_id = coalesce(k.user_id, d.user_id) WHERE id = k.id AND (k.photo_path IS NULL OR k.user_id IS NULL);
    UPDATE public.challenge_people_private kp SET
      phone = coalesce(kp.phone, dp.phone), instagram = coalesce(kp.instagram, dp.instagram),
      marketing_opt_in = kp.marketing_opt_in OR dp.marketing_opt_in,
      marketing_opt_in_at = coalesce(kp.marketing_opt_in_at, dp.marketing_opt_in_at)
    FROM public.challenge_people_private dp WHERE kp.person_id = k.id AND dp.person_id = d.id;
    UPDATE public.challenge_metrics SET person_id = k.id WHERE person_id = d.id;
    DELETE FROM public.challenge_people WHERE id = d.id;
  END IF;
  PERFORM public._challenge_audit(NULL, 'merge', 'person', k.id, jsonb_build_object('dropped', d.id, 'moved', v_moved, 'left_behind', v_left));
  RETURN jsonb_build_object('moved', v_moved, 'left_behind', v_left);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_merge_people(p_keep uuid, p_drop uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN public._challenge_merge(p_keep, p_drop);
END $$;

-- Claim: link every challenge profile registered with this login's confirmed
-- email (Supabase verified the email, so no link token is needed), merged into one.
CREATE OR REPLACE FUNCTION public.challenge_claim()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_keep uuid; r record; n int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to claim your profile.' USING ERRCODE = '42501'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Confirm your email first.' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_keep FROM public.challenge_people WHERE user_id = v_uid;
  FOR r IN SELECT pe.id FROM public.challenge_people pe JOIN public.challenge_people_private pp ON pp.person_id = pe.id
           WHERE lower(pp.email) = v_email AND pe.user_id IS NULL ORDER BY pe.created_at LOOP
    IF v_keep IS NULL THEN
      UPDATE public.challenge_people SET user_id = v_uid WHERE id = r.id;
      v_keep := r.id;
    ELSE
      PERFORM public._challenge_merge(v_keep, r.id);
    END IF;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('handle', (SELECT handle FROM public.challenge_people WHERE id = v_keep), 'claimed', n);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_update_my_profile(p_display_name text, p_discoverable boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.challenge_people%ROWTYPE; v_name text := btrim(coalesce(p_display_name, ''));
BEGIN
  SELECT * INTO p FROM public.challenge_people WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim your profile first.' USING ERRCODE = 'P0001'; END IF;
  IF length(v_name) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Your name has to be 1 to 40 characters.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.challenge_people SET display_name = v_name, discoverable = coalesce(p_discoverable, discoverable) WHERE id = p.id;
  -- entries still showing the old name follow it (final results keep theirs)
  UPDATE public.challenge_entries e SET public_name = v_name
    FROM public.challenges c
   WHERE e.person_id = p.id AND e.public_name = p.display_name AND c.id = e.challenge_id AND c.results_final_at IS NULL;
  RETURN jsonb_build_object('handle', p.handle);
END $$;

-- The signed-in person's own profile handle (if they have one).
CREATE OR REPLACE FUNCTION public.challenge_my_handle()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT handle FROM public.challenge_people WHERE user_id = auth.uid()
$$;

-- ── Analytics ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_track(p_slug text, p_kind text, p_visitor text, p_code text DEFAULT NULL, p_handle text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c uuid; v_entry uuid; v_person uuid; v_ip text;
BEGIN
  IF p_kind NOT IN ('view','display_view','qr_visit','ref_visit','result_view','profile_view','share','download','copy_link','copy_caption','join_start') THEN RETURN; END IF;
  IF p_visitor IS NULL OR p_visitor !~ '^[A-Za-z0-9-]{8,64}$' THEN RETURN; END IF;
  IF p_kind = 'profile_view' THEN
    SELECT id INTO v_person FROM public.challenge_people WHERE handle = lower(btrim(coalesce(p_handle, '')));
    IF v_person IS NULL OR EXISTS (SELECT 1 FROM public.challenge_people WHERE id = v_person AND user_id = auth.uid()) THEN RETURN; END IF;
  ELSE
    SELECT id INTO v_c FROM public.challenges WHERE slug = lower(btrim(coalesce(p_slug, ''))) AND status <> 'draft' AND NOT is_template;
    IF v_c IS NULL THEN RETURN; END IF;
    -- staff looking at their own event don't count
    IF public.challenge_role(v_c) IS NOT NULL THEN RETURN; END IF;
    IF p_code IS NOT NULL THEN
      SELECT id INTO v_entry FROM public.challenge_entries WHERE share_code = lower(btrim(p_code)) AND challenge_id = v_c;
    END IF;
  END IF;
  v_ip := public._challenge_client_ip();
  IF NOT public._challenge_rate_ok('track:' || v_ip, 400, interval '1 hour') THEN RETURN; END IF;
  -- one of each kind per visitor per half hour
  IF EXISTS (SELECT 1 FROM public.challenge_metrics m
             WHERE m.kind = p_kind AND m.visitor = p_visitor AND m.created_at > now() - interval '30 minutes'
               AND m.challenge_id IS NOT DISTINCT FROM v_c AND m.person_id IS NOT DISTINCT FROM v_person
               AND m.entry_id IS NOT DISTINCT FROM v_entry) THEN RETURN; END IF;
  INSERT INTO public.challenge_metrics(challenge_id, person_id, entry_id, kind, visitor) VALUES (v_c, v_person, v_entry, p_kind, p_visitor);
END $$;

-- Admin list with each challenge's headline numbers.
CREATE OR REPLACE FUNCTION public.challenge_admin_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(public._challenge_card(c) || jsonb_build_object(
      'is_template', c.is_template, 'created_at', c.created_at, 'updated_at', c.updated_at,
      'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
      'competed', (SELECT count(*) FROM public._challenge_rank(c.id)),
      'visitors', (SELECT count(DISTINCT m.visitor) FROM public.challenge_metrics m WHERE m.challenge_id = c.id AND m.kind = 'view'),
      'shares', (SELECT count(*) FROM public.challenge_metrics m WHERE m.challenge_id = c.id AND m.kind IN ('share','download','copy_link'))
    ) ORDER BY c.is_template, (c.status IN ('archived','cancelled')), coalesce(c.starts_at, c.created_at) DESC)
    FROM public.challenges c), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_insights(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE;
BEGIN
  IF NOT public.challenge_can(p_challenge, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge;
  RETURN jsonb_build_object(
    'registered', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'checked_in', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status IN ('checked_in','disqualified')),
    'competed', (SELECT count(*) FROM public._challenge_rank(c.id)),
    'withdrawn', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status = 'withdrawn'),
    'disqualified', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status = 'disqualified'),
    'by_source', (SELECT jsonb_build_object(
        'staff', count(*) FILTER (WHERE e.source = 'staff'),
        'self', count(*) FILTER (WHERE e.source = 'self'),
        'qr', count(*) FILTER (WHERE e.ref_source = 'qr'),
        'friend', count(*) FILTER (WHERE e.referred_by IS NOT NULL),
        'display', count(*) FILTER (WHERE e.ref_source = 'display'))
      FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'),
    'returning', (SELECT count(DISTINCT e.person_id) FROM public.challenge_entries e
       WHERE e.challenge_id = c.id AND e.status <> 'withdrawn'
         AND EXISTS (SELECT 1 FROM public.challenge_entries x JOIN public.challenges xc ON xc.id = x.challenge_id
                     WHERE x.person_id = e.person_id AND x.challenge_id <> c.id AND NOT xc.is_test AND x.created_at < e.created_at)),
    'photo_consent', (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.show_photo AND e.status <> 'withdrawn'),
    'marketing_opt_in', (SELECT count(*) FROM public.challenge_entries e JOIN public.challenge_people_private pp ON pp.person_id = e.person_id
       WHERE e.challenge_id = c.id AND pp.marketing_opt_in AND e.status <> 'withdrawn'),
    'claimed', (SELECT count(*) FROM public.challenge_entries e JOIN public.challenge_people p ON p.id = e.person_id
       WHERE e.challenge_id = c.id AND p.user_id IS NOT NULL AND e.status <> 'withdrawn'),
    'coaching_inquiries', (SELECT count(DISTINCT lower(ca.email)) FROM public.coaching_applications ca
       JOIN public.challenge_people_private pp ON lower(pp.email) = lower(ca.email)
       JOIN public.challenge_entries e ON e.person_id = pp.person_id AND e.challenge_id = c.id
       WHERE coalesce(ca.is_test, false) = false AND ca.created_at >= e.created_at),
    'metrics', (SELECT coalesce(jsonb_object_agg(kind, jsonb_build_object('events', n, 'visitors', v)), '{}'::jsonb)
       FROM (SELECT m.kind, count(*) AS n, count(DISTINCT m.visitor) AS v FROM public.challenge_metrics m WHERE m.challenge_id = c.id GROUP BY m.kind) t),
    'profile_views', (SELECT count(*) FROM public.challenge_metrics m WHERE m.kind = 'profile_view'
       AND m.person_id IN (SELECT e.person_id FROM public.challenge_entries e WHERE e.challenge_id = c.id)),
    'prize_value_cents', (SELECT coalesce(sum(value_cents), 0) FROM public.challenge_prizes WHERE challenge_id = c.id),
    'sponsor_cents', (SELECT coalesce(sum(contribution_cents), 0) FROM public.challenge_sponsors WHERE challenge_id = c.id),
    'by_day', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'views', v, 'registrations', r) ORDER BY d), '[]'::jsonb) FROM (
       SELECT d::date AS d,
         (SELECT count(DISTINCT m.visitor) FROM public.challenge_metrics m WHERE m.challenge_id = c.id AND m.kind = 'view'
            AND (public.instant_to_local(m.created_at, c.timezone))::date = d::date) AS v,
         (SELECT count(*) FROM public.challenge_entries e WHERE e.challenge_id = c.id
            AND (public.instant_to_local(e.created_at, c.timezone))::date = d::date) AS r
       FROM generate_series((public.instant_to_local(c.created_at, c.timezone))::date,
                            (public.instant_to_local(now(), c.timezone))::date, interval '1 day') d
       ORDER BY d DESC LIMIT 60) t)
  );
END $$;

-- ── Staff management (admin) ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.challenge_staff_list(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id, 'role', s.role, 'email', u.email,
      'name', coalesce(nullif(pr.full_name, ''), u.raw_user_meta_data ->> 'full_name', u.email)) ORDER BY s.created_at)
    FROM public.challenge_staff s JOIN auth.users u ON u.id = s.user_id LEFT JOIN public.profiles pr ON pr.id = s.user_id
    WHERE s.challenge_id = p_challenge), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_add_staff(p_challenge uuid, p_email text, p_role text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid;
BEGIN
  IF NOT public.challenge_can(p_challenge, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('manager','judge','registration') THEN RAISE EXCEPTION 'Pick a role.' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(btrim(p_email));
  IF v_user IS NULL THEN RAISE EXCEPTION 'No JF Effect login uses that email. Ask them to sign up first (it''s free).' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.challenge_staff(challenge_id, user_id, role) VALUES (p_challenge, v_user, p_role)
  ON CONFLICT (challenge_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  PERFORM public._challenge_audit(p_challenge, 'staff_add', 'user', v_user, jsonb_build_object('role', p_role));
  RETURN jsonb_build_object('user_id', v_user);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_remove_staff(p_challenge uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.challenge_can(p_challenge, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.challenge_staff WHERE challenge_id = p_challenge AND user_id = p_user;
  PERFORM public._challenge_audit(p_challenge, 'staff_remove', 'user', p_user, '{}'::jsonb);
END $$;

-- Challenges this login helps run (for the event-day screen's picker).
CREATE OR REPLACE FUNCTION public.challenge_my_events()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public._challenge_card(c) || jsonb_build_object('my_role', public.challenge_role(c.id))
    ORDER BY coalesce(c.starts_at, c.created_at) DESC), '[]'::jsonb)
  FROM public.challenges c
  WHERE c.id IN (SELECT public.challenge_my_ids()) AND NOT c.is_template AND c.status NOT IN ('archived','cancelled')
$$;

-- ── Row level security ──────────────────────────────────────────────────────

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_people_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_live ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_photo_tickets ENABLE ROW LEVEL SECURITY;

-- Nothing here is for anon directly (the public functions are the way in),
-- except the live version counter.
REVOKE ALL ON public.challenges, public.challenge_divisions, public.challenge_people, public.challenge_people_private,
  public.challenge_entries, public.challenge_attempts, public.challenge_sponsors, public.challenge_prizes,
  public.challenge_staff, public.challenge_audit, public.challenge_metrics, public.challenge_rate,
  public.challenge_photo_tickets FROM anon;
REVOKE ALL ON public.challenge_metrics, public.challenge_rate, public.challenge_photo_tickets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.challenge_entries, public.challenge_attempts, public.challenge_audit, public.challenge_live FROM authenticated;
GRANT SELECT ON public.challenge_live TO anon, authenticated;

DROP POLICY IF EXISTS "Staff read their challenges" ON public.challenges;
CREATE POLICY "Staff read their challenges" ON public.challenges FOR SELECT TO authenticated
  USING (id IN (SELECT public.challenge_my_ids()));
DROP POLICY IF EXISTS "Admins write challenges" ON public.challenges;
CREATE POLICY "Admins write challenges" ON public.challenges FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Staff read divisions" ON public.challenge_divisions;
CREATE POLICY "Staff read divisions" ON public.challenge_divisions FOR SELECT TO authenticated
  USING (challenge_id IN (SELECT public.challenge_my_ids()));
DROP POLICY IF EXISTS "Admins write divisions" ON public.challenge_divisions;
CREATE POLICY "Admins write divisions" ON public.challenge_divisions FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Staff read sponsors" ON public.challenge_sponsors;
CREATE POLICY "Staff read sponsors" ON public.challenge_sponsors FOR SELECT TO authenticated
  USING (challenge_id IN (SELECT public.challenge_my_ids()));
DROP POLICY IF EXISTS "Admins write sponsors" ON public.challenge_sponsors;
CREATE POLICY "Admins write sponsors" ON public.challenge_sponsors FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Admins manage prizes" ON public.challenge_prizes;
CREATE POLICY "Admins manage prizes" ON public.challenge_prizes FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Admins read people" ON public.challenge_people;
CREATE POLICY "Admins read people" ON public.challenge_people FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Admins edit people" ON public.challenge_people;
CREATE POLICY "Admins edit people" ON public.challenge_people FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Admins read contact details" ON public.challenge_people_private;
CREATE POLICY "Admins read contact details" ON public.challenge_people_private FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
         OR person_id IN (SELECT pe.id FROM public.challenge_people pe WHERE pe.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Admins edit contact details" ON public.challenge_people_private;
CREATE POLICY "Admins edit contact details" ON public.challenge_people_private FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Staff read entries" ON public.challenge_entries;
CREATE POLICY "Staff read entries" ON public.challenge_entries FOR SELECT TO authenticated
  USING (challenge_id IN (SELECT public.challenge_my_ids()));
DROP POLICY IF EXISTS "Staff read attempts" ON public.challenge_attempts;
CREATE POLICY "Staff read attempts" ON public.challenge_attempts FOR SELECT TO authenticated
  USING (challenge_id IN (SELECT public.challenge_my_ids()));

DROP POLICY IF EXISTS "Admins read staff" ON public.challenge_staff;
CREATE POLICY "Admins read staff" ON public.challenge_staff FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins read audit" ON public.challenge_audit;
CREATE POLICY "Admins read audit" ON public.challenge_audit FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Anyone reads live versions of published challenges" ON public.challenge_live;
CREATE POLICY "Anyone reads live versions of published challenges" ON public.challenge_live FOR SELECT TO anon, authenticated
  USING (challenge_id IN (SELECT public.challenge_public_ids()) OR challenge_id IN (SELECT public.challenge_my_ids()));

-- ── Function access ─────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION
  public._challenge_code(int), public._challenge_handle(text), public._challenge_client_ip(),
  public._challenge_rate_ok(text, int, interval), public._challenge_audit(uuid, text, text, uuid, jsonb),
  public._challenge_bump(uuid), public._challenge_rank(uuid), public._challenge_divisions_separate(uuid),
  public._challenge_card(public.challenges), public._challenge_attempt_result(uuid), public._challenge_merge(uuid, uuid),
  public.challenge_photo_ticket_check(text), public.challenge_photo_ticket_redeem(text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_photo_ticket_check(text), public.challenge_photo_ticket_redeem(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION
  public.challenge_staff_board(uuid), public.challenge_update_entry(uuid, jsonb), public.challenge_delete_entry(uuid),
  public.challenge_record_attempt(uuid, numeric, boolean, uuid, text, text, boolean),
  public.challenge_void_attempt(uuid, text), public.challenge_correct_attempt(uuid, numeric, boolean, text, uuid),
  public.challenge_set_status(uuid, text), public.challenge_finalize(uuid), public.challenge_duplicate(uuid, boolean, text),
  public.challenge_reset_practice(uuid), public.challenge_photo_ticket(uuid), public.challenge_my_photo_ticket(),
  public.challenge_photo_clear(uuid), public.challenge_merge_people(uuid, uuid), public.challenge_claim(),
  public.challenge_update_my_profile(text, boolean), public.challenge_my_handle(), public.challenge_admin_list(),
  public.challenge_insights(uuid), public.challenge_staff_list(uuid), public.challenge_add_staff(uuid, text, text),
  public.challenge_remove_staff(uuid, uuid), public.challenge_my_events()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.challenge_staff_board(uuid), public.challenge_update_entry(uuid, jsonb), public.challenge_delete_entry(uuid),
  public.challenge_record_attempt(uuid, numeric, boolean, uuid, text, text, boolean),
  public.challenge_void_attempt(uuid, text), public.challenge_correct_attempt(uuid, numeric, boolean, text, uuid),
  public.challenge_set_status(uuid, text), public.challenge_finalize(uuid), public.challenge_duplicate(uuid, boolean, text),
  public.challenge_reset_practice(uuid), public.challenge_photo_ticket(uuid), public.challenge_my_photo_ticket(),
  public.challenge_photo_clear(uuid), public.challenge_merge_people(uuid, uuid), public.challenge_claim(),
  public.challenge_update_my_profile(text, boolean), public.challenge_my_handle(), public.challenge_admin_list(),
  public.challenge_insights(uuid), public.challenge_staff_list(uuid), public.challenge_add_staff(uuid, text, text),
  public.challenge_remove_staff(uuid, uuid), public.challenge_my_events()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.challenge_hub(), public.challenge_public(text), public.challenge_board(text),
  public.challenge_entry_public(text), public.challenge_athlete(text), public.challenge_register(uuid, jsonb),
  public.challenge_track(text, text, text, text, text), public.challenge_role(uuid), public.challenge_can(uuid, text),
  public.challenge_my_ids(), public.challenge_public_ids()
TO anon, authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'challenge_live') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_live;
  END IF;
END $$;

SELECT public.rls_evaluate_once('challenges');
SELECT public.rls_evaluate_once('challenge_entries');
SELECT public.rls_evaluate_once('challenge_attempts');

-- ── The first event: Winnipeg 225, as a draft ───────────────────────────────
-- Date, venue and sponsors are left empty on purpose: it can't be published
-- until they're filled in.
INSERT INTO public.challenges (slug, title, tagline, description, activity, exercise_id, measure, direction, unit, aggregate,
  attempts_allowed, load_label, objective, tiebreak, city, min_age, eligibility, rules, safety, warmup, prize_summary,
  entry_fee_label, self_registration, collect, acknowledgments)
SELECT 'winnipeg-225', 'Winnipeg 225 Bench Press Challenge',
  '225 lb. One set. As many clean reps as you''ve got.',
  'One bar loaded to 225 lb, one set, judged rep by rep. The most valid reps wins $225 and the trophy. Free to enter for experienced lifters 18 and older.',
  'Barbell bench press',
  (SELECT x.id FROM public.exercises x WHERE lower(x.name) IN ('barbell bench press','bench press') AND NOT coalesce(x.archived, false)
     ORDER BY (lower(x.name) = 'barbell bench press') DESC, x.created_at LIMIT 1),
  'reps', 'higher', 'reps', 'best', 1, '225 lb', 'Most valid reps in one continuous set', 'lighter', 'Winnipeg, Manitoba', 18,
  'Adults 18 and older who already bench 225 lb for clean reps. If 225 is close to your max, this isn''t your event yet: come cheer and try the next one.',
  '["The bar touches your chest under control on every rep.","Lock your elbows out fully at the top of every rep.","No bouncing the bar off your chest.","Your butt stays on the bench.","Your head and upper back stay on the bench.","Your feet stay planted.","No help from a spotter during scored reps.","No more than three seconds between reps.","The judge decides whether each rep counts.","Unsafe technique or losing control of the bar ends the set."]'::jsonb,
  'Every scored set has a judge and two experienced spotters at the bar, and the safety arms are set just below where the bar touches your chest. A spotter takes the bar the moment it stalls or the judge calls the set. You can stop whenever you want, and your reps up to then still count.',
  'Warm up before your set in the warm-up area. A good start: the bar for 10, 135 for 5, 185 for 2 or 3, 205 for 1, then rest a few minutes. Staff will call you about 2 minutes before your set.',
  '$225 CAD + winner''s trophy', 'Free', true, '{"phone":"optional","instagram":"optional"}'::jsonb,
  '["I''m 18 or older.","I already bench 225 lb for reps, and I''ve read the rules and the safety plan.","I take part at my own risk and will stop the moment a judge or spotter tells me to."]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.challenges WHERE slug = 'winnipeg-225');

INSERT INTO public.challenge_prizes (challenge_id, place, title, value_cents)
SELECT c.id, 1, '$225 CAD + winner''s trophy', 22500
FROM public.challenges c
WHERE c.slug = 'winnipeg-225' AND NOT EXISTS (SELECT 1 FROM public.challenge_prizes pz WHERE pz.challenge_id = c.id);
