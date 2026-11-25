-- Client context & relationship intelligence (Nov 25 2026).
--
-- Two kinds of information, kept apart at the database:
--
--   client_lifestyle          client-facing: employment, job title, employer, typical workday,
--                             work schedule, physical demand, what they declined, the check-in's
--                             ask / skip state and who set each value. The client reads and writes
--                             their own row; staff read and write their own clients' (admins all).
--   client_context_history    every change to the lifestyle profile, the private facts and the
--                             relationship labels, with its source (client_reported,
--                             coach_provided, ai_confirmed) and who made it and when. Written
--                             only by the triggers; staff read, never the client.
--   client_context_facts      coach-only private context (work, schedule, family, interests…), each
--                             with its source, active / historical, and an optional end date for a
--                             temporary one. Staff only; never the client.
--   client_relationships      coach-only relationship labels (Client, Friend, Close friend, Partner,
--                             Family member, Training partner, Professional acquaintance, Custom).
--                             Staff only; never the client.
--
-- No rows are written here: relationships and context are data the coach enters.
-- Policies check the signed-in user once per query (rls_evaluate_once style).
-- Idempotent.

SET lock_timeout = '3s';

-- ── 1. client_lifestyle ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_lifestyle (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  employment_status text CHECK (employment_status IS NULL OR employment_status IN ('full_time', 'part_time', 'self_employed', 'student', 'retired', 'not_working', 'other', 'prefer_not')),
  occupation text CHECK (occupation IS NULL OR char_length(occupation) <= 120),
  employer text CHECK (employer IS NULL OR char_length(employer) <= 120),
  workday_activity text CHECK (workday_activity IS NULL OR workday_activity IN ('mostly_sitting', 'mostly_standing', 'frequently_walking', 'physically_demanding', 'mixed', 'varies')),
  work_schedule text CHECK (work_schedule IS NULL OR work_schedule IN ('daytime', 'evenings', 'overnight', 'rotating', 'flexible', 'irregular')),
  physical_demand text CHECK (physical_demand IS NULL OR physical_demand IN ('low', 'moderate', 'high', 'very_high', 'varies')),
  declined text[] NOT NULL DEFAULT '{}',
  prompt_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_source text NOT NULL DEFAULT 'client_reported' CHECK (last_source IN ('client_reported', 'coach_provided', 'ai_confirmed', 'temporary', 'historical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.client_lifestyle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_lifestyle FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.client_lifestyle TO authenticated;
GRANT ALL ON public.client_lifestyle TO service_role;

DROP POLICY IF EXISTS "Client and staff read lifestyle" ON public.client_lifestyle;
CREATE POLICY "Client and staff read lifestyle" ON public.client_lifestyle FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS "Client and staff add lifestyle" ON public.client_lifestyle;
CREATE POLICY "Client and staff add lifestyle" ON public.client_lifestyle FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS "Client and staff edit lifestyle" ON public.client_lifestyle;
CREATE POLICY "Client and staff edit lifestyle" ON public.client_lifestyle FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS "Admins delete lifestyle" ON public.client_lifestyle;
CREATE POLICY "Admins delete lifestyle" ON public.client_lifestyle FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

-- ── 2. client_context_history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_context_history (
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_context_history_client ON public.client_context_history (client_id, changed_at DESC);

ALTER TABLE public.client_context_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_context_history FROM anon, authenticated;
GRANT SELECT ON public.client_context_history TO authenticated;
GRANT ALL ON public.client_context_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.client_context_history_id_seq TO service_role;

DROP POLICY IF EXISTS "Staff read lifestyle history" ON public.client_context_history;
CREATE POLICY "Staff read lifestyle history" ON public.client_context_history FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

-- Who set it: the client themselves is always client_reported (they can't claim a coach's
-- confirmation); staff are coach_provided unless the app says a confirmed Cleo suggestion or a
-- temporary value; the server (no signed-in user) says which. Each changed field gets its source
-- and time in field_meta, and an answer clears that field from declined.
CREATE OR REPLACE FUNCTION public.tg_client_lifestyle_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid();
  _own boolean := false;
  _staff boolean := false;
  _src text;
  _f text;
  _old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  _new jsonb := to_jsonb(NEW);
BEGIN
  IF _uid IS NOT NULL THEN
    _own := EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.user_id = _uid);
    _staff := public.has_role(_uid, 'admin'::app_role) OR NEW.client_id IN (SELECT public.coached_client_ids());
  END IF;
  IF _uid IS NOT NULL AND _own AND NOT _staff THEN
    _src := 'client_reported';
  ELSIF _uid IS NOT NULL THEN
    _src := CASE WHEN NEW.last_source IN ('coach_provided', 'ai_confirmed', 'temporary') THEN NEW.last_source ELSE 'coach_provided' END;
  ELSE
    _src := COALESCE(NEW.last_source, 'client_reported');
  END IF;
  NEW.last_source := _src;
  -- who set each field is the database's to say, never the caller's
  IF _uid IS NOT NULL THEN
    NEW.field_meta := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.field_meta, '{}'::jsonb) ELSE '{}'::jsonb END;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(_uid, NEW.updated_by);
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  END IF;
  FOREACH _f IN ARRAY ARRAY['employment_status', 'occupation', 'employer', 'workday_activity', 'work_schedule', 'physical_demand'] LOOP
    IF (_new ->> _f) IS DISTINCT FROM (_old ->> _f) THEN
      NEW.field_meta := jsonb_set(COALESCE(NEW.field_meta, '{}'::jsonb), ARRAY[_f], jsonb_build_object('source', _src, 'at', now()), true);
      IF (_new ->> _f) IS NOT NULL THEN
        NEW.declined := array_remove(COALESCE(NEW.declined, '{}'), _f);
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_client_lifestyle_stamp() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS client_lifestyle_stamp ON public.client_lifestyle;
CREATE TRIGGER client_lifestyle_stamp BEFORE INSERT OR UPDATE ON public.client_lifestyle
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_lifestyle_stamp();

-- Every change kept: the value before, the value after, its source and who.
CREATE OR REPLACE FUNCTION public.tg_client_context_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _f text;
  _old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  _new jsonb := to_jsonb(NEW);
  _was text[] := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.declined, '{}') ELSE '{}' END;
BEGIN
  FOREACH _f IN ARRAY ARRAY['employment_status', 'occupation', 'employer', 'workday_activity', 'work_schedule', 'physical_demand'] LOOP
    IF (_new ->> _f) IS DISTINCT FROM (_old ->> _f) THEN
      INSERT INTO public.client_context_history (client_id, field, old_value, new_value, source, changed_by)
      VALUES (NEW.client_id, _f, _old ->> _f, _new ->> _f, NEW.last_source, auth.uid());
    ELSIF _f = ANY (COALESCE(NEW.declined, '{}')) AND NOT (_f = ANY (_was)) THEN
      INSERT INTO public.client_context_history (client_id, field, old_value, new_value, source, changed_by)
      VALUES (NEW.client_id, _f, _old ->> _f, '(declined)', NEW.last_source, auth.uid());
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_client_context_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS client_context_history ON public.client_lifestyle;
CREATE TRIGGER client_context_history AFTER INSERT OR UPDATE ON public.client_lifestyle
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_context_history();

-- ── 3. client_context_facts (coach-only) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_context_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('work', 'schedule', 'lifestyle', 'family', 'interests', 'training_background', 'other')),
  fact text NOT NULL CHECK (char_length(fact) BETWEEN 1 AND 500),
  source text NOT NULL DEFAULT 'coach_provided' CHECK (source IN ('coach_provided', 'ai_confirmed')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'historical')),
  valid_until date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS idx_client_context_facts_client ON public.client_context_facts (client_id, status, created_at DESC);

ALTER TABLE public.client_context_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_context_facts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_context_facts TO authenticated;
GRANT ALL ON public.client_context_facts TO service_role;

DROP POLICY IF EXISTS "Staff read context facts" ON public.client_context_facts;
CREATE POLICY "Staff read context facts" ON public.client_context_facts FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff add context facts" ON public.client_context_facts;
CREATE POLICY "Staff add context facts" ON public.client_context_facts FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()))
  );
DROP POLICY IF EXISTS "Staff edit context facts" ON public.client_context_facts;
CREATE POLICY "Staff edit context facts" ON public.client_context_facts FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Admins delete context facts" ON public.client_context_facts;
CREATE POLICY "Admins delete context facts" ON public.client_context_facts FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

CREATE OR REPLACE FUNCTION public.tg_client_context_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.client_id := OLD.client_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_client_context_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS client_context_facts_touch ON public.client_context_facts;
CREATE TRIGGER client_context_facts_touch BEFORE UPDATE ON public.client_context_facts
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_context_touch();

-- ── 4. client_relationships (coach-only) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_relationships (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  labels text[] NOT NULL DEFAULT '{}' CHECK (labels <@ ARRAY['client', 'friend', 'close_friend', 'partner', 'family', 'training_partner', 'professional', 'custom']::text[]),
  custom_label text CHECK (custom_label IS NULL OR char_length(custom_label) <= 60),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

ALTER TABLE public.client_relationships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_relationships FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_relationships TO authenticated;
GRANT ALL ON public.client_relationships TO service_role;

DROP POLICY IF EXISTS "Staff read relationships" ON public.client_relationships;
CREATE POLICY "Staff read relationships" ON public.client_relationships FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff add relationships" ON public.client_relationships;
CREATE POLICY "Staff add relationships" ON public.client_relationships FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff edit relationships" ON public.client_relationships;
CREATE POLICY "Staff edit relationships" ON public.client_relationships FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff remove relationships" ON public.client_relationships;
CREATE POLICY "Staff remove relationships" ON public.client_relationships FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

CREATE OR REPLACE FUNCTION public.tg_client_relationships_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_client_relationships_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS client_relationships_touch ON public.client_relationships;
CREATE TRIGGER client_relationships_touch BEFORE INSERT OR UPDATE ON public.client_relationships
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_relationships_touch();

-- ── 5. History of the coach-only parts (same table, staff-only) ─────────────
-- A private fact added, edited, made historical or active again; a relationship set,
-- changed or cleared. Kept with who and when; a fact keeps its own source.
CREATE OR REPLACE FUNCTION public.tg_client_context_fact_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.client_context_history (client_id, field, old_value, new_value, source, changed_by)
    VALUES (NEW.client_id, 'fact:' || NEW.category, NULL, NEW.fact, NEW.source, auth.uid());
  ELSIF NEW.fact IS DISTINCT FROM OLD.fact OR NEW.status IS DISTINCT FROM OLD.status OR NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
    INSERT INTO public.client_context_history (client_id, field, old_value, new_value, source, changed_by)
    VALUES (
      NEW.client_id, 'fact:' || NEW.category,
      OLD.fact || CASE WHEN OLD.status = 'historical' THEN ' (historical)' ELSE '' END,
      NEW.fact || CASE WHEN NEW.status = 'historical' THEN ' (historical)' ELSE '' END || COALESCE(' (until ' || NEW.valid_until::text || ')', ''),
      'coach_provided', auth.uid()
    );
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_client_context_fact_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS client_context_facts_history ON public.client_context_facts;
CREATE TRIGGER client_context_facts_history AFTER INSERT OR UPDATE ON public.client_context_facts
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_context_fact_history();

CREATE OR REPLACE FUNCTION public.tg_client_relationships_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _old text;
  _new text;
  _cid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.client_id ELSE NEW.client_id END;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    _old := array_to_string(OLD.labels, ', ') || COALESCE(' · ' || OLD.custom_label, '') || COALESCE(' · ' || OLD.note, '');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    _new := array_to_string(NEW.labels, ', ') || COALESCE(' · ' || NEW.custom_label, '') || COALESCE(' · ' || NEW.note, '');
  END IF;
  -- a client being deleted takes its history with it: nothing to record
  IF _old IS DISTINCT FROM _new AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _cid) THEN
    INSERT INTO public.client_context_history (client_id, field, old_value, new_value, source, changed_by)
    VALUES (_cid, 'relationship', NULLIF(_old, ''), NULLIF(_new, ''), 'coach_provided', auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_client_relationships_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS client_relationships_history ON public.client_relationships;
CREATE TRIGGER client_relationships_history AFTER INSERT OR UPDATE OR DELETE ON public.client_relationships
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_relationships_history();

SELECT public.rls_evaluate_once('client_lifestyle');
SELECT public.rls_evaluate_once('client_context_history');
SELECT public.rls_evaluate_once('client_context_facts');
SELECT public.rls_evaluate_once('client_relationships');
