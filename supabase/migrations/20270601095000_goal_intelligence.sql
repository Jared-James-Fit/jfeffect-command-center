-- Goal & Performance Intelligence (Nov 26 2026, docs/GOAL_INTELLIGENCE.md).
--
-- One goal ledger, the single source of truth for what a client is working
-- toward, keeping three numbers apart: what the client said (with the words
-- and where they said it), Cleo's projection (worked out on every read, kept
-- here only as the latest read), and the coach-approved target (the only one
-- the rest of the app plans around).
--
--   * client_goals: one row per goal (one open row per goal identity,
--     dedupe_key), its feasibility read and Cleo's recommendation, the outcome
--     once its date has passed. Written only by the server after it checked
--     who's asking, and by the sync triggers below.
--   * client_goal_events: append-only history of every change, who and when.
--   * client_goal_sources: what's been read for goals already (a meeting's
--     analysis, a check-in), so nothing is read twice.
--   * client_update_outbox: one waiting message per client telling them about
--     approved, client-facing changes; it waits out the coach's review window
--     and goes by itself only when the client is offline (goal-intel/outbox.ts).
--
-- Sync, both ways, by trigger, so every path stays in step:
--   forward: an approved goal writes what the app already reads
--     (competitions.target_total_kg / athlete_goal_total_kg, the client's
--     bodyweight goal, program_intel_profiles.long_term_goal);
--   back: a coach (or the client, for their own bodyweight goal) setting one of
--     those directly updates the ledger.
-- A setting (jf.goal_sync) stops a write made by one direction from echoing
-- back through the other. A sync that fails never fails the write that set it
-- off on the other tables (a warning, and the ledger catches up on the next
-- coach action).
--
-- Clients read none of it; staff read their own clients' rows (admins all).

SET lock_timeout = '10s';

-- ── 1. The ledger ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('lift', 'total', 'bodyweight', 'physique', 'performance', 'event', 'preference')),
  lift text CHECK (lift IS NULL OR lift IN ('squat', 'bench', 'deadlift')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  -- a bodyweight goal goes down (a cut) or up (a gain); lifts go up
  direction text CHECK (direction IS NULL OR direction IN ('up', 'down')),
  -- what the client said, as they said it (a range keeps both ends)
  client_value numeric CHECK (client_value IS NULL OR client_value > 0),
  client_value_max numeric CHECK (client_value_max IS NULL OR client_value_max > 0),
  client_unit text CHECK (client_unit IS NULL OR client_unit IN ('kg', 'lb')),
  client_unit_source text CHECK (client_unit_source IS NULL OR client_unit_source IN ('stated', 'inferred', 'coach')),
  client_kg numeric,
  client_kg_max numeric,
  client_text text CHECK (client_text IS NULL OR char_length(client_text) <= 600),
  -- the coach-approved target
  approved_value numeric CHECK (approved_value IS NULL OR approved_value > 0),
  approved_unit text CHECK (approved_unit IS NULL OR approved_unit IN ('kg', 'lb')),
  approved_kg numeric,
  approved_text text CHECK (approved_text IS NULL OR char_length(approved_text) <= 600),
  approved_approach text CHECK (approved_approach IS NULL OR approved_approach IN ('easy', 'conservative', 'moderate', 'high', 'very_aggressive', 'extreme')),
  approved_at timestamptz,
  approved_by uuid,
  -- what the read said when the target was approved (projection, now), for learning from the outcome
  approved_read jsonb,
  deadline date,
  competition_id uuid REFERENCES public.competitions (id) ON DELETE SET NULL,
  event_title text CHECK (event_title IS NULL OR char_length(event_title) <= 160),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'dismissed', 'achieved', 'missed', 'archived')),
  -- approved changes are worth telling the client about (the coach can turn it off per goal)
  client_facing boolean NOT NULL DEFAULT true,
  -- where it came from: the words, never rewritten
  source_kind text CHECK (source_kind IS NULL OR source_kind IN ('meeting', 'checkin', 'message', 'coach', 'profile', 'competition', 'form')),
  source_id text CHECK (source_id IS NULL OR char_length(source_id) <= 80),
  source_quote text CHECK (source_quote IS NULL OR char_length(source_quote) <= 600),
  source_context text CHECK (source_context IS NULL OR char_length(source_context) <= 1200),
  source_speaker text CHECK (source_speaker IS NULL OR source_speaker IN ('athlete', 'coach', 'unclear')),
  source_at timestamptz,
  tentative boolean NOT NULL DEFAULT false,
  -- the latest read (goal-intel/feasibility.ts) and what it was read from
  feasibility jsonb,
  assessed_at timestamptz,
  data_hash text,
  recommendation jsonb,
  recommendation_status text NOT NULL DEFAULT 'none'
    CHECK (recommendation_status IN ('none', 'open', 'approved', 'edited', 'dismissed', 'maintained')),
  recommendation_at timestamptz,
  outcome jsonb,
  version integer NOT NULL DEFAULT 1,
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 3 AND 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (client_value_max IS NULL OR client_value IS NULL OR client_value_max >= client_value),
  CHECK (kind <> 'lift' OR lift IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_goals_one_open ON public.client_goals (client_id, dedupe_key) WHERE status IN ('proposed', 'active');
CREATE INDEX IF NOT EXISTS client_goals_client_idx ON public.client_goals (client_id, status);
CREATE INDEX IF NOT EXISTS client_goals_competition_idx ON public.client_goals (competition_id) WHERE competition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_goals_open_idx ON public.client_goals (assessed_at) WHERE status IN ('proposed', 'active');

CREATE TABLE IF NOT EXISTS public.client_goal_events (
  id bigserial PRIMARY KEY,
  goal_id uuid,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (actor IN ('coach', 'cleo', 'athlete', 'system')),
  actor_id uuid,
  action text NOT NULL CHECK (char_length(action) BETWEEN 2 AND 60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_goal_events_goal_idx ON public.client_goal_events (goal_id, at);
CREATE INDEX IF NOT EXISTS client_goal_events_client_idx ON public.client_goal_events (client_id, at DESC);

CREATE TABLE IF NOT EXISTS public.client_goal_sources (
  source_kind text NOT NULL CHECK (source_kind IN ('meeting', 'checkin', 'message')),
  source_id text NOT NULL,
  client_id uuid REFERENCES public.clients (id) ON DELETE CASCADE,
  content_hash text,
  goals integer NOT NULL DEFAULT 0,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id)
);

CREATE TABLE IF NOT EXISTS public.client_update_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  -- the coach it goes out as
  sender_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'sending', 'sent', 'cancelled', 'failed')),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  edited_at timestamptz,
  edited_by uuid,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  last_change_at timestamptz NOT NULL DEFAULT now(),
  review_minutes integer NOT NULL DEFAULT 30 CHECK (review_minutes BETWEEN 5 AND 1440),
  send_after timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz,
  wait_reason text CHECK (wait_reason IS NULL OR wait_reason IN ('window', 'online', 'quiet', 'presence_unknown')),
  hold_reason text CHECK (hold_reason IS NULL OR hold_reason IN ('presence_unknown', 'auto_off', 'changed_after_edit', 'nothing_current', 'coach')),
  status_line text CHECK (status_line IS NULL OR char_length(status_line) <= 200),
  attempts integer NOT NULL DEFAULT 0,
  message_id uuid,
  sent_at timestamptz,
  -- null = sent by itself; a coach's id = they tapped Send
  sent_by uuid,
  closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_update_outbox_one_open ON public.client_update_outbox (client_id) WHERE status IN ('pending', 'held', 'sending');
CREATE INDEX IF NOT EXISTS client_update_outbox_due_idx ON public.client_update_outbox ((coalesce(next_attempt_at, send_after))) WHERE status = 'pending';

-- ── 2. History is append-only (an account's purge still takes it) ─────────
CREATE OR REPLACE FUNCTION public.tg_client_goal_events_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN
    RETURN OLD; -- the client is being deleted (an account purge): the history goes with them
  END IF;
  RAISE EXCEPTION 'The goal history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS client_goal_events_keep ON public.client_goal_events;
CREATE TRIGGER client_goal_events_keep BEFORE UPDATE OR DELETE ON public.client_goal_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_goal_events_keep();

-- ── 3. updated_at, and a new version whenever what the goal says changes ──
CREATE OR REPLACE FUNCTION public.tg_client_goals_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_kg IS DISTINCT FROM OLD.approved_kg
     OR NEW.approved_text IS DISTINCT FROM OLD.approved_text
     OR NEW.deadline IS DISTINCT FROM OLD.deadline
     OR NEW.client_kg IS DISTINCT FROM OLD.client_kg
     OR NEW.client_kg_max IS DISTINCT FROM OLD.client_kg_max
     OR NEW.client_text IS DISTINCT FROM OLD.client_text
     OR NEW.client_facing IS DISTINCT FROM OLD.client_facing THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS client_goals_touch ON public.client_goals;
CREATE TRIGGER client_goals_touch BEFORE UPDATE ON public.client_goals
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_goals_touch();

CREATE OR REPLACE FUNCTION public.tg_client_update_outbox_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS client_update_outbox_touch ON public.client_update_outbox;
CREATE TRIGGER client_update_outbox_touch BEFORE UPDATE ON public.client_update_outbox
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_update_outbox_touch();

-- ── 4. Forward: an approved goal writes what the app already reads ────────
CREATE OR REPLACE FUNCTION public.tg_client_goals_mirror()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  was_active boolean := TG_OP = 'UPDATE' AND OLD.status = 'active';
  now_active boolean := NEW.status = 'active';
  closed boolean := NEW.status IN ('dismissed', 'archived');
  v_type text;
  v_total numeric;
BEGIN
  -- a write the sync made from the other side: don't echo it back
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  PERFORM set_config('jf.goal_sync', 'on', true);

  IF NEW.kind = 'total' AND NEW.competition_id IS NOT NULL THEN
    IF now_active THEN
      IF NEW.approved_kg BETWEEN 20 AND 1500 THEN
        UPDATE public.competitions SET target_total_kg = round(NEW.approved_kg, 1)
          WHERE id = NEW.competition_id AND target_total_kg IS DISTINCT FROM round(NEW.approved_kg, 1);
      END IF;
      v_total := coalesce(NEW.client_kg_max, NEW.client_kg);
      IF v_total BETWEEN 20 AND 1500 THEN
        UPDATE public.competitions SET athlete_goal_total_kg = round(v_total, 1)
          WHERE id = NEW.competition_id AND athlete_goal_total_kg IS DISTINCT FROM round(v_total, 1);
      END IF;
    ELSIF was_active AND closed AND OLD.approved_kg IS NOT NULL THEN
      UPDATE public.competitions SET target_total_kg = NULL
        WHERE id = NEW.competition_id AND target_total_kg = round(OLD.approved_kg, 1);
    END IF;

  ELSIF NEW.kind = 'bodyweight' THEN
    IF now_active AND NEW.approved_value IS NOT NULL THEN
      v_type := CASE
        WHEN NEW.direction = 'down' AND NEW.competition_id IS NOT NULL THEN 'performance_cut'
        WHEN NEW.direction = 'down' THEN 'lose'
        WHEN NEW.direction = 'up' THEN 'gain'
        ELSE 'custom' END;
      UPDATE public.clients
        SET bodyweight_goal_type = v_type,
            bodyweight_goal_value = NEW.approved_value,
            bodyweight_goal_value_max = NULL,
            bodyweight_goal_unit = coalesce(NEW.approved_unit, 'kg'),
            bodyweight_goal_date = NEW.deadline,
            bodyweight_goal_set_at = now()
        WHERE id = NEW.client_id
          AND (bodyweight_goal_value IS DISTINCT FROM NEW.approved_value
               OR bodyweight_goal_unit IS DISTINCT FROM coalesce(NEW.approved_unit, 'kg')
               OR bodyweight_goal_date IS DISTINCT FROM NEW.deadline
               OR bodyweight_goal_type IS DISTINCT FROM v_type);
    ELSIF was_active AND closed AND OLD.approved_value IS NOT NULL THEN
      UPDATE public.clients
        SET bodyweight_goal_type = NULL, bodyweight_goal_value = NULL, bodyweight_goal_value_max = NULL,
            bodyweight_goal_unit = NULL, bodyweight_goal_date = NULL
        WHERE id = NEW.client_id AND bodyweight_goal_value = OLD.approved_value
          AND bodyweight_goal_unit IS NOT DISTINCT FROM coalesce(OLD.approved_unit, 'kg');
    END IF;

  ELSIF NEW.kind = 'event' THEN
    IF now_active AND NEW.deadline IS NOT NULL THEN
      INSERT INTO public.program_intel_profiles (client_id, long_term_goal, updated_at)
      VALUES (NEW.client_id, jsonb_build_object('text', coalesce(NEW.approved_text, NEW.title), 'date', NEW.deadline, 'savedAt', now(), 'goalId', NEW.id), now())
      ON CONFLICT (client_id) DO UPDATE
        SET long_term_goal = EXCLUDED.long_term_goal, updated_at = now()
        WHERE public.program_intel_profiles.long_term_goal IS NULL
           OR public.program_intel_profiles.long_term_goal ->> 'goalId' = NEW.id::text
           OR NEW.dedupe_key = 'event:long_term';
    ELSIF was_active AND closed THEN
      UPDATE public.program_intel_profiles SET long_term_goal = NULL, updated_at = now()
        WHERE client_id = NEW.client_id AND long_term_goal ->> 'goalId' = NEW.id::text;
    END IF;
  END IF;

  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS client_goals_mirror ON public.client_goals;
CREATE TRIGGER client_goals_mirror AFTER INSERT OR UPDATE ON public.client_goals
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_goals_mirror();

-- ── 5. Back: what's set directly elsewhere lands in the ledger ────────────
-- a competition's targets, its date, name and status
CREATE OR REPLACE FUNCTION public.tg_competitions_goal_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := 'total:comp:' || NEW.id::text;
  g public.client_goals;
  v_targets boolean := TG_OP = 'INSERT'
    OR NEW.target_total_kg IS DISTINCT FROM OLD.target_total_kg
    OR NEW.athlete_goal_total_kg IS DISTINCT FROM OLD.athlete_goal_total_kg;
BEGIN
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  PERFORM set_config('jf.goal_sync', 'on', true);
  BEGIN
    -- every open goal at this meet follows its date and name; a cancelled meet closes them
    IF TG_OP = 'UPDATE' AND (NEW.meet_date IS DISTINCT FROM OLD.meet_date OR NEW.name IS DISTINCT FROM OLD.name) THEN
      UPDATE public.client_goals SET deadline = NEW.meet_date, event_title = left(NEW.name, 160)
        WHERE competition_id = NEW.id AND status IN ('proposed', 'active');
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      WITH closed AS (
        UPDATE public.client_goals SET status = 'archived'
          WHERE competition_id = NEW.id AND status IN ('proposed', 'active') RETURNING id, client_id)
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        SELECT id, client_id, 'system', auth.uid(), 'archived', jsonb_build_object('why', 'The competition was cancelled') FROM closed;
    END IF;

    IF v_targets AND (NEW.target_total_kg IS NOT NULL OR NEW.athlete_goal_total_kg IS NOT NULL) THEN
      SELECT * INTO g FROM public.client_goals
        WHERE client_id = NEW.client_id AND dedupe_key = v_key AND status IN ('proposed', 'active') LIMIT 1;
      IF g.id IS NULL THEN
        INSERT INTO public.client_goals (
          client_id, kind, title, direction, competition_id, event_title, deadline, status,
          approved_value, approved_unit, approved_kg, approved_at, approved_by,
          client_value, client_unit, client_unit_source, client_kg,
          source_kind, source_id, source_context, dedupe_key, created_by)
        VALUES (
          NEW.client_id, 'total', left('Total · ' || NEW.name, 160), 'up', NEW.id, left(NEW.name, 160), NEW.meet_date,
          CASE WHEN NEW.target_total_kg IS NOT NULL THEN 'active' ELSE 'proposed' END,
          NEW.target_total_kg, CASE WHEN NEW.target_total_kg IS NOT NULL THEN 'kg' END, NEW.target_total_kg,
          CASE WHEN NEW.target_total_kg IS NOT NULL THEN now() END, CASE WHEN NEW.target_total_kg IS NOT NULL THEN auth.uid() END,
          NEW.athlete_goal_total_kg, CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN 'kg' END,
          CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN 'coach' END, NEW.athlete_goal_total_kg,
          'competition', NEW.id::text, 'Set on the competition', v_key, auth.uid())
        RETURNING * INTO g;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, 'coach', auth.uid(), 'created', jsonb_build_object('from', 'competition'));
      ELSE
        UPDATE public.client_goals SET
          status = CASE WHEN NEW.target_total_kg IS NOT NULL THEN 'active' ELSE status END,
          approved_value = coalesce(NEW.target_total_kg, approved_value),
          approved_unit = CASE WHEN NEW.target_total_kg IS NOT NULL THEN 'kg' ELSE approved_unit END,
          approved_kg = coalesce(NEW.target_total_kg, approved_kg),
          approved_at = CASE WHEN NEW.target_total_kg IS DISTINCT FROM approved_kg AND NEW.target_total_kg IS NOT NULL THEN now() ELSE approved_at END,
          approved_by = CASE WHEN NEW.target_total_kg IS DISTINCT FROM approved_kg AND NEW.target_total_kg IS NOT NULL THEN auth.uid() ELSE approved_by END,
          approved_approach = CASE WHEN NEW.target_total_kg IS DISTINCT FROM approved_kg THEN NULL ELSE approved_approach END,
          client_value = coalesce(NEW.athlete_goal_total_kg, client_value),
          client_value_max = CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN NULL ELSE client_value_max END,
          client_unit = CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN 'kg' ELSE client_unit END,
          client_unit_source = CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN 'coach' ELSE client_unit_source END,
          client_kg = coalesce(NEW.athlete_goal_total_kg, client_kg),
          client_kg_max = CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN NULL ELSE client_kg_max END,
          deadline = NEW.meet_date
        WHERE id = g.id;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, 'coach', auth.uid(), 'synced', jsonb_build_object('from', 'competition', 'target_total_kg', NEW.target_total_kg, 'athlete_goal_total_kg', NEW.athlete_goal_total_kg));
      END IF;
    ELSIF v_targets AND TG_OP = 'UPDATE' AND NEW.target_total_kg IS NULL AND OLD.target_total_kg IS NOT NULL THEN
      WITH closed AS (
        UPDATE public.client_goals SET status = 'archived'
          WHERE client_id = NEW.client_id AND dedupe_key = v_key AND status = 'active' AND round(approved_kg, 1) = OLD.target_total_kg
          RETURNING id, client_id)
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        SELECT id, client_id, 'coach', auth.uid(), 'archived', jsonb_build_object('why', 'Target cleared on the competition') FROM closed;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'goal sync from competitions skipped: %', SQLERRM;
  END;
  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS competitions_goal_sync ON public.competitions;
CREATE TRIGGER competitions_goal_sync
  AFTER INSERT OR UPDATE OF target_total_kg, athlete_goal_total_kg, meet_date, name, status ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_competitions_goal_sync();

-- a bodyweight goal set on the client (by staff: approved; by the client themselves: what they said)
CREATE OR REPLACE FUNCTION public.tg_clients_bodyweight_goal_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  g public.client_goals;
  v_staff boolean := auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.user_id;
  v_kg numeric;
  v_dir text;
  v_key text;
BEGIN
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  IF NEW.bodyweight_goal_value IS NOT DISTINCT FROM OLD.bodyweight_goal_value
     AND NEW.bodyweight_goal_unit IS NOT DISTINCT FROM OLD.bodyweight_goal_unit
     AND NEW.bodyweight_goal_date IS NOT DISTINCT FROM OLD.bodyweight_goal_date
     AND NEW.bodyweight_goal_type IS NOT DISTINCT FROM OLD.bodyweight_goal_type THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('jf.goal_sync', 'on', true);
  BEGIN
    SELECT * INTO g FROM public.client_goals
      WHERE client_id = NEW.id AND kind = 'bodyweight' AND status IN ('proposed', 'active')
      ORDER BY (status = 'active') DESC, updated_at DESC LIMIT 1;
    IF NEW.bodyweight_goal_value IS NULL THEN
      IF g.id IS NOT NULL AND (v_staff OR g.status = 'proposed') THEN
        UPDATE public.client_goals SET status = 'archived' WHERE id = g.id;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, CASE WHEN v_staff THEN 'coach' ELSE 'athlete' END, auth.uid(), 'archived', jsonb_build_object('why', 'Bodyweight goal cleared on their profile'));
      END IF;
    ELSE
      v_kg := CASE WHEN NEW.bodyweight_goal_unit = 'lb' THEN NEW.bodyweight_goal_value / 2.2046226218 ELSE NEW.bodyweight_goal_value END;
      v_dir := CASE NEW.bodyweight_goal_type WHEN 'gain' THEN 'up' WHEN 'lose' THEN 'down' WHEN 'performance_cut' THEN 'down' ELSE NULL END;
      v_key := 'bodyweight:' || coalesce('date:' || NEW.bodyweight_goal_date::text, 'open');
      IF g.id IS NULL THEN
        INSERT INTO public.client_goals (
          client_id, kind, title, direction, deadline, status,
          approved_value, approved_unit, approved_kg, approved_at, approved_by,
          client_value, client_unit, client_unit_source, client_kg,
          source_kind, source_context, source_speaker, source_at, dedupe_key, created_by)
        VALUES (
          NEW.id, 'bodyweight', 'Bodyweight' || coalesce(' by ' || to_char(NEW.bodyweight_goal_date, 'Mon FMDD, YYYY'), ''), v_dir, NEW.bodyweight_goal_date,
          CASE WHEN v_staff THEN 'active' ELSE 'proposed' END,
          CASE WHEN v_staff THEN NEW.bodyweight_goal_value END, CASE WHEN v_staff THEN coalesce(NEW.bodyweight_goal_unit, 'kg') END,
          CASE WHEN v_staff THEN v_kg END, CASE WHEN v_staff THEN now() END, CASE WHEN v_staff THEN auth.uid() END,
          CASE WHEN NOT v_staff THEN NEW.bodyweight_goal_value END, CASE WHEN NOT v_staff THEN coalesce(NEW.bodyweight_goal_unit, 'kg') END,
          CASE WHEN NOT v_staff THEN 'stated' END, CASE WHEN NOT v_staff THEN v_kg END,
          'profile', CASE WHEN v_staff THEN 'Set on their profile by their coach' ELSE 'Set by the client on their bodyweight card' END,
          CASE WHEN v_staff THEN 'coach' ELSE 'athlete' END, now(), v_key, auth.uid())
        ON CONFLICT DO NOTHING
        RETURNING * INTO g;
      ELSIF v_staff THEN
        UPDATE public.client_goals SET
          status = 'active', direction = coalesce(v_dir, direction), deadline = NEW.bodyweight_goal_date,
          approved_value = NEW.bodyweight_goal_value, approved_unit = coalesce(NEW.bodyweight_goal_unit, 'kg'), approved_kg = v_kg,
          approved_at = now(), approved_by = auth.uid(), approved_approach = NULL,
          dedupe_key = CASE WHEN EXISTS (SELECT 1 FROM public.client_goals x WHERE x.client_id = NEW.id AND x.dedupe_key = v_key AND x.status IN ('proposed', 'active') AND x.id <> g.id) THEN dedupe_key ELSE v_key END
        WHERE id = g.id
        RETURNING * INTO g;
      ELSE
        UPDATE public.client_goals SET
          client_value = NEW.bodyweight_goal_value, client_value_max = NULL, client_unit = coalesce(NEW.bodyweight_goal_unit, 'kg'),
          client_unit_source = 'stated', client_kg = v_kg, client_kg_max = NULL,
          direction = coalesce(direction, v_dir), deadline = coalesce(deadline, NEW.bodyweight_goal_date)
        WHERE id = g.id
        RETURNING * INTO g;
      END IF;
      IF g.id IS NOT NULL THEN
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, CASE WHEN v_staff THEN 'coach' ELSE 'athlete' END, auth.uid(), 'synced',
                  jsonb_build_object('from', 'profile', 'value', NEW.bodyweight_goal_value, 'unit', NEW.bodyweight_goal_unit, 'date', NEW.bodyweight_goal_date));
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'goal sync from the bodyweight goal skipped: %', SQLERRM;
  END;
  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS clients_bodyweight_goal_sync ON public.clients;
CREATE TRIGGER clients_bodyweight_goal_sync
  AFTER UPDATE OF bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_value_max, bodyweight_goal_unit, bodyweight_goal_date ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_clients_bodyweight_goal_sync();

-- the dated long-term goal on the athlete's intel profile (coach-set)
CREATE OR REPLACE FUNCTION public.tg_intel_profile_goal_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  g public.client_goals;
  v_text text := nullif(btrim(NEW.long_term_goal ->> 'text'), '');
  v_date date;
BEGIN
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.long_term_goal IS NOT DISTINCT FROM OLD.long_term_goal THEN RETURN NULL; END IF;
  PERFORM set_config('jf.goal_sync', 'on', true);
  BEGIN
    v_date := CASE WHEN (NEW.long_term_goal ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (NEW.long_term_goal ->> 'date')::date END;
    SELECT * INTO g FROM public.client_goals
      WHERE client_id = NEW.client_id AND dedupe_key = 'event:long_term' AND status IN ('proposed', 'active') LIMIT 1;
    IF v_text IS NULL THEN
      IF g.id IS NOT NULL THEN
        UPDATE public.client_goals SET status = 'archived' WHERE id = g.id;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, 'coach', auth.uid(), 'archived', jsonb_build_object('why', 'Long-term goal cleared'));
      END IF;
    ELSIF g.id IS NULL THEN
      INSERT INTO public.client_goals (client_id, kind, title, deadline, status, approved_text, approved_at, approved_by, source_kind, source_context, source_speaker, source_at, dedupe_key, created_by)
        VALUES (NEW.client_id, 'event', left(v_text, 160), v_date, 'active', left(v_text, 600), now(), auth.uid(), 'profile', 'The long-term goal on their training profile', 'coach', now(), 'event:long_term', auth.uid())
        RETURNING * INTO g;
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        VALUES (g.id, g.client_id, 'coach', auth.uid(), 'created', jsonb_build_object('from', 'long_term_goal'));
    ELSE
      UPDATE public.client_goals SET title = left(v_text, 160), approved_text = left(v_text, 600), deadline = v_date, approved_at = now(), approved_by = auth.uid()
        WHERE id = g.id;
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        VALUES (g.id, g.client_id, 'coach', auth.uid(), 'synced', jsonb_build_object('from', 'long_term_goal', 'text', v_text, 'date', v_date));
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'goal sync from the long-term goal skipped: %', SQLERRM;
  END;
  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS program_intel_profiles_goal_sync ON public.program_intel_profiles;
CREATE TRIGGER program_intel_profiles_goal_sync
  AFTER INSERT OR UPDATE OF long_term_goal ON public.program_intel_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_intel_profile_goal_sync();

-- ── 6. Who reads what: staff their own clients, nobody writes but the server
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_goals', 'client_goal_events', 'client_goal_sources', 'client_update_outbox']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff read their clients" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Staff read their clients" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin'')) OR client_id IN (SELECT public.coached_client_ids()))',
      t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.client_goal_events_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.tg_client_goals_mirror() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_competitions_goal_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_clients_bodyweight_goal_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_intel_profile_goal_sync() FROM PUBLIC, anon, authenticated;

-- ── 7. Settings: the review window and whether updates go by themselves ───
INSERT INTO public.app_settings (key, value)
VALUES ('goal_updates', jsonb_build_object('review_minutes', 30, 'auto_send', true))
ON CONFLICT (key) DO NOTHING;

-- ── 8. What's waiting for the worker (the cron asks before it calls) ─────
CREATE OR REPLACE FUNCTION public.goal_intel_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    -- a message whose window (or retry) is up
    EXISTS (SELECT 1 FROM public.client_update_outbox o
            WHERE o.status = 'pending' AND coalesce(o.next_attempt_at, o.send_after) <= now())
    -- a meeting read since it was last scanned for goals
    OR EXISTS (SELECT 1 FROM public.coaching_sessions s
               WHERE s.analysis_status = 'ready' AND s.updated_at > now() - interval '180 days'
                 AND NOT EXISTS (SELECT 1 FROM public.client_goal_sources x
                                 WHERE x.source_kind = 'meeting' AND x.source_id = s.id::text AND x.scanned_at >= s.updated_at))
    -- a weekly check-in not read yet
    OR EXISTS (SELECT 1 FROM public.messenger_checkins c
               WHERE c.task_type = 'weekly_checkin' AND c.status = 'completed' AND c.submitted_at > now() - interval '14 days'
                 AND NOT EXISTS (SELECT 1 FROM public.client_goal_sources x WHERE x.source_kind = 'checkin' AND x.source_id = c.id::text))
    -- an open goal not read in 6 hours (a goal whose date has passed gets its outcome on that read)
    OR EXISTS (SELECT 1 FROM public.client_goals g
               WHERE g.status IN ('proposed', 'active') AND (g.assessed_at IS NULL OR g.assessed_at < now() - interval '6 hours'))
    -- clients' own messages, read at most every 30 minutes
    OR (coalesce((SELECT (value ->> 'messages_at')::timestamptz FROM public.app_settings WHERE key = 'goal_intel_scan'), now() - interval '7 days') < now() - interval '30 minutes'
        AND EXISTS (SELECT 1 FROM public.messages m
                    WHERE m.sender_role = 'client' AND m.created_at > coalesce((SELECT (value ->> 'messages_at')::timestamptz FROM public.app_settings WHERE key = 'goal_intel_scan'), now() - interval '7 days')));
$$;
REVOKE ALL ON FUNCTION public.goal_intel_due() FROM PUBLIC, anon, authenticated;

-- ── 9. What's already on file becomes the ledger's first rows ────────────
SELECT set_config('jf.goal_sync', 'on', true);

INSERT INTO public.client_goals (
  client_id, kind, title, direction, deadline, status, approved_value, approved_unit, approved_kg,
  source_kind, source_context, source_speaker, source_at, dedupe_key)
SELECT c.id, 'bodyweight',
       'Bodyweight' || coalesce(' by ' || to_char(c.bodyweight_goal_date, 'Mon FMDD, YYYY'), ''),
       CASE c.bodyweight_goal_type WHEN 'gain' THEN 'up' WHEN 'lose' THEN 'down' WHEN 'performance_cut' THEN 'down' END,
       c.bodyweight_goal_date, 'active', c.bodyweight_goal_value, coalesce(c.bodyweight_goal_unit, 'kg'),
       CASE WHEN c.bodyweight_goal_unit = 'lb' THEN c.bodyweight_goal_value / 2.2046226218 ELSE c.bodyweight_goal_value END,
       'profile', 'On their profile before goals were tracked', 'unclear', coalesce(c.bodyweight_goal_set_at, now()),
       'bodyweight:' || coalesce('date:' || c.bodyweight_goal_date::text, 'open')
FROM public.clients c
WHERE c.bodyweight_goal_value IS NOT NULL AND c.archived IS NOT TRUE
ON CONFLICT DO NOTHING;

INSERT INTO public.client_goals (
  client_id, kind, title, deadline, status, approved_text, approved_at, source_kind, source_context, source_speaker, source_at, dedupe_key)
SELECT p.client_id, 'event', left(btrim(p.long_term_goal ->> 'text'), 160),
       CASE WHEN (p.long_term_goal ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.long_term_goal ->> 'date')::date END,
       'active', left(btrim(p.long_term_goal ->> 'text'), 600),
       CASE WHEN (p.long_term_goal ->> 'savedAt') ~ '^\d{4}-' THEN (p.long_term_goal ->> 'savedAt')::timestamptz END,
       'profile', 'The long-term goal on their training profile', 'coach',
       CASE WHEN (p.long_term_goal ->> 'savedAt') ~ '^\d{4}-' THEN (p.long_term_goal ->> 'savedAt')::timestamptz END,
       'event:long_term'
FROM public.program_intel_profiles p
WHERE char_length(btrim(coalesce(p.long_term_goal ->> 'text', ''))) >= 2
ON CONFLICT DO NOTHING;

INSERT INTO public.client_goals (
  client_id, kind, title, direction, competition_id, event_title, deadline, status,
  approved_value, approved_unit, approved_kg, client_value, client_unit, client_unit_source, client_kg,
  source_kind, source_id, source_context, dedupe_key)
SELECT c.client_id, 'total', left('Total · ' || c.name, 160), 'up', c.id, left(c.name, 160), c.meet_date,
       CASE WHEN c.target_total_kg IS NOT NULL THEN 'active' ELSE 'proposed' END,
       c.target_total_kg, CASE WHEN c.target_total_kg IS NOT NULL THEN 'kg' END, c.target_total_kg,
       c.athlete_goal_total_kg, CASE WHEN c.athlete_goal_total_kg IS NOT NULL THEN 'kg' END,
       CASE WHEN c.athlete_goal_total_kg IS NOT NULL THEN 'coach' END, c.athlete_goal_total_kg,
       'competition', c.id::text, 'Set on the competition', 'total:comp:' || c.id::text
FROM public.competitions c
WHERE c.status = 'upcoming' AND (c.target_total_kg IS NOT NULL OR c.athlete_goal_total_kg IS NOT NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.client_goal_events (goal_id, client_id, actor, action, detail)
SELECT g.id, g.client_id, 'system', 'created', jsonb_build_object('from', 'backfill', 'source', g.source_kind)
FROM public.client_goals g
WHERE NOT EXISTS (SELECT 1 FROM public.client_goal_events e WHERE e.goal_id = g.id);

SELECT set_config('jf.goal_sync', '', true);

-- ── 10. The worker: every 5 minutes, only when something's waiting ───────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: goal-intel-tick not scheduled';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'goal-intel-tick';
  PERFORM cron.schedule(
    'goal-intel-tick',
    '3-59/5 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/goal-intel-tick',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) WHERE public.goal_intel_due();
    $cmd$
  );
END $$;
