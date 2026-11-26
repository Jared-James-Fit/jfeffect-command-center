-- Goal intelligence fixes (Nov 26 2026, after the review of
-- 20270601095000_goal_intelligence.sql; docs/GOAL_INTELLIGENCE.md).
--
--  * The forward mirror writes only when what the goal says changed (never on
--    a read's assessed_at refresh), keeps the profile's own bodyweight goal
--    type and its maintain range (profile_type, approved_value_max), and only
--    one bodyweight goal is active at a time, so the profile never flips.
--  * A target cleared on a competition un-approves the goal (it never comes
--    back); a cleared athlete total clears the client's number. Cancelling a
--    meet closes its goals through the mirror (so what they wrote is cleared),
--    and putting it back on reopens them.
--  * The bodyweight back-sync is for coaching clients only (a member's own
--    goal is theirs, never "approved by their coach"); a write with no
--    signed-in person is never an approval; a goal with no unit is read in the
--    client's own unit.
--  * An account purge deletes the goal history (jf.allow_history_delete).
--  * The client update outbox: one waiting update per client is pending or
--    held (a stuck send never blocks the next one); a claim is stamped
--    (claimed_at) so a send cut off part way is picked up again; send failures
--    are counted apart from waits.
--  * The worker asks the database for the meetings and check-ins it hasn't
--    read (never the same oldest 50 again).

SET lock_timeout = '10s';

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.client_goals ADD COLUMN IF NOT EXISTS profile_type text;
ALTER TABLE public.client_goals DROP CONSTRAINT IF EXISTS client_goals_profile_type_check;
ALTER TABLE public.client_goals ADD CONSTRAINT client_goals_profile_type_check
  CHECK (profile_type IS NULL OR profile_type IN ('lose', 'gain', 'maintain', 'performance_cut', 'custom'));
ALTER TABLE public.client_goals ADD COLUMN IF NOT EXISTS approved_value_max numeric;
ALTER TABLE public.client_goals DROP CONSTRAINT IF EXISTS client_goals_approved_value_max_check;
ALTER TABLE public.client_goals ADD CONSTRAINT client_goals_approved_value_max_check
  CHECK (approved_value_max IS NULL OR approved_value_max > 0);

ALTER TABLE public.client_update_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.client_update_outbox ADD COLUMN IF NOT EXISTS send_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.client_update_outbox DROP CONSTRAINT IF EXISTS client_update_outbox_hold_reason_check;
ALTER TABLE public.client_update_outbox ADD CONSTRAINT client_update_outbox_hold_reason_check
  CHECK (hold_reason IS NULL OR hold_reason IN ('presence_unknown', 'auto_off', 'changed_after_edit', 'nothing_current', 'coach', 'send_failed'));

-- a send in flight never blocks the next update (a stuck one is recovered by the worker)
DROP INDEX IF EXISTS public.client_update_outbox_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS client_update_outbox_one_open ON public.client_update_outbox (client_id) WHERE status IN ('pending', 'held');

-- ── 2. History: append-only, but an account purge takes it ─────────────────
CREATE OR REPLACE FUNCTION public.tg_client_goal_events_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
       NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id)
       OR coalesce(current_setting('jf.allow_history_delete', true), '') = 'on') THEN
    RETURN OLD; -- the client is being deleted, or purged (_account_purge_personal)
  END IF;
  RAISE EXCEPTION 'The goal history is append-only';
END;
$$;

-- ── 3. Forward: only when what the goal says changed ─────────────────────────
CREATE OR REPLACE FUNCTION public.tg_client_goals_mirror()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  was_active boolean := TG_OP = 'UPDATE' AND OLD.status = 'active';
  now_active boolean := NEW.status = 'active';
  closed boolean := NEW.status IN ('dismissed', 'archived');
  v_type text;
  v_unit text;
  v_total numeric;
  v_text text;
BEGIN
  -- a write the sync made from the other side: don't echo it back
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  -- a read (assessed_at, feasibility, the recommendation) or a source note changes nothing elsewhere
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.approved_value IS NOT DISTINCT FROM OLD.approved_value
     AND NEW.approved_value_max IS NOT DISTINCT FROM OLD.approved_value_max
     AND NEW.approved_unit IS NOT DISTINCT FROM OLD.approved_unit
     AND NEW.approved_kg IS NOT DISTINCT FROM OLD.approved_kg
     AND NEW.approved_text IS NOT DISTINCT FROM OLD.approved_text
     AND NEW.deadline IS NOT DISTINCT FROM OLD.deadline
     AND NEW.competition_id IS NOT DISTINCT FROM OLD.competition_id
     AND NEW.direction IS NOT DISTINCT FROM OLD.direction
     AND NEW.profile_type IS NOT DISTINCT FROM OLD.profile_type
     AND NEW.client_kg IS NOT DISTINCT FROM OLD.client_kg
     AND NEW.client_kg_max IS NOT DISTINCT FROM OLD.client_kg_max
     AND NEW.title IS NOT DISTINCT FROM OLD.title THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('jf.goal_sync', 'on', true);

  IF NEW.kind = 'total' AND NEW.competition_id IS NOT NULL THEN
    IF now_active THEN
      IF NEW.approved_kg BETWEEN 20 AND 1500 THEN
        UPDATE public.competitions SET target_total_kg = round(NEW.approved_kg, 1)
          WHERE id = NEW.competition_id AND target_total_kg IS DISTINCT FROM round(NEW.approved_kg, 1);
      END IF;
      -- the athlete's own total, only from what the athlete (or the competition) said, never a coach's note
      v_total := coalesce(NEW.client_kg_max, NEW.client_kg);
      IF v_total BETWEEN 20 AND 1500 AND NEW.source_speaker IS DISTINCT FROM 'coach' THEN
        UPDATE public.competitions SET athlete_goal_total_kg = round(v_total, 1)
          WHERE id = NEW.competition_id AND athlete_goal_total_kg IS DISTINCT FROM round(v_total, 1);
      END IF;
    ELSIF was_active AND closed AND OLD.approved_kg IS NOT NULL THEN
      UPDATE public.competitions SET target_total_kg = NULL
        WHERE id = NEW.competition_id AND target_total_kg = round(OLD.approved_kg, 1);
    END IF;

  ELSIF NEW.kind = 'bodyweight' THEN
    IF now_active AND NEW.approved_value IS NOT NULL THEN
      -- one bodyweight goal at a time: this one replaces any other that was active
      WITH other AS (
        UPDATE public.client_goals SET status = 'archived'
          WHERE client_id = NEW.client_id AND kind = 'bodyweight' AND status = 'active' AND id <> NEW.id
          RETURNING id, client_id)
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        SELECT id, client_id, 'system', auth.uid(), 'archived', jsonb_build_object('why', 'Replaced by another bodyweight goal', 'by', NEW.id) FROM other;
      -- the profile's own type when it came from there, else read from the goal (never 'custom' over a maintain)
      v_type := coalesce(
        NEW.profile_type,
        CASE
          WHEN NEW.direction = 'down' AND NEW.competition_id IS NOT NULL THEN 'performance_cut'
          WHEN NEW.direction = 'down' THEN 'lose'
          WHEN NEW.direction = 'up' THEN 'gain'
        END,
        (SELECT c.bodyweight_goal_type FROM public.clients c WHERE c.id = NEW.client_id AND c.bodyweight_goal_type IN ('maintain', 'custom')),
        'custom');
      v_unit := coalesce(NEW.approved_unit, (SELECT CASE WHEN c.preferred_weight_unit = 'kg' THEN 'kg' ELSE 'lb' END FROM public.clients c WHERE c.id = NEW.client_id), 'kg');
      UPDATE public.clients
        SET bodyweight_goal_type = v_type,
            bodyweight_goal_value = NEW.approved_value,
            bodyweight_goal_value_max = CASE WHEN v_type = 'maintain' THEN NEW.approved_value_max END,
            bodyweight_goal_unit = v_unit,
            bodyweight_goal_date = NEW.deadline,
            bodyweight_goal_set_at = now()
        WHERE id = NEW.client_id
          AND (bodyweight_goal_value IS DISTINCT FROM NEW.approved_value
               OR bodyweight_goal_value_max IS DISTINCT FROM (CASE WHEN v_type = 'maintain' THEN NEW.approved_value_max END)
               OR bodyweight_goal_unit IS DISTINCT FROM v_unit
               OR bodyweight_goal_date IS DISTINCT FROM NEW.deadline
               OR bodyweight_goal_type IS DISTINCT FROM v_type);
    ELSIF was_active AND closed AND OLD.approved_value IS NOT NULL THEN
      UPDATE public.clients
        SET bodyweight_goal_type = NULL, bodyweight_goal_value = NULL, bodyweight_goal_value_max = NULL,
            bodyweight_goal_unit = NULL, bodyweight_goal_date = NULL
        WHERE id = NEW.client_id AND bodyweight_goal_value = OLD.approved_value
          AND (bodyweight_goal_unit IS NOT DISTINCT FROM OLD.approved_unit OR bodyweight_goal_unit IS NULL OR OLD.approved_unit IS NULL);
    END IF;

  ELSIF NEW.kind = 'event' THEN
    IF now_active AND NEW.deadline IS NOT NULL THEN
      v_text := coalesce(NEW.approved_text, NEW.title);
      INSERT INTO public.program_intel_profiles (client_id, long_term_goal, updated_at)
      VALUES (NEW.client_id, jsonb_build_object('text', v_text, 'date', NEW.deadline, 'savedAt', now(), 'goalId', NEW.id), now())
      ON CONFLICT (client_id) DO UPDATE
        SET long_term_goal = coalesce(public.program_intel_profiles.long_term_goal, '{}'::jsonb)
                             || jsonb_build_object('text', v_text, 'date', NEW.deadline, 'savedAt', now(), 'goalId', NEW.id),
            updated_at = now()
        WHERE (public.program_intel_profiles.long_term_goal IS NULL
               OR public.program_intel_profiles.long_term_goal ->> 'goalId' = NEW.id::text
               OR NEW.dedupe_key = 'event:long_term')
          AND (public.program_intel_profiles.long_term_goal IS NULL
               OR public.program_intel_profiles.long_term_goal ->> 'text' IS DISTINCT FROM v_text
               OR public.program_intel_profiles.long_term_goal ->> 'date' IS DISTINCT FROM NEW.deadline::text);
    ELSIF was_active AND closed THEN
      UPDATE public.program_intel_profiles SET long_term_goal = NULL, updated_at = now()
        WHERE client_id = NEW.client_id AND long_term_goal ->> 'goalId' = NEW.id::text;
    END IF;
  END IF;

  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;

-- ── 4. Back: a competition's targets, date, name and status ─────────────────
CREATE OR REPLACE FUNCTION public.tg_competitions_goal_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := 'total:comp:' || NEW.id::text;
  g public.client_goals;
  v_target_changed boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.target_total_kg IS NOT NULL ELSE NEW.target_total_kg IS DISTINCT FROM OLD.target_total_kg END;
  v_athlete_changed boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.athlete_goal_total_kg IS NOT NULL ELSE NEW.athlete_goal_total_kg IS DISTINCT FROM OLD.athlete_goal_total_kg END;
  v_cancelled boolean := CASE WHEN TG_OP = 'UPDATE' THEN NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' ELSE false END;
  v_back_on boolean := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' ELSE false END;
  v_moved boolean := CASE WHEN TG_OP = 'UPDATE' THEN NEW.meet_date IS DISTINCT FROM OLD.meet_date OR NEW.name IS DISTINCT FROM OLD.name ELSE false END;
BEGIN
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  BEGIN
    -- these go through the mirror on purpose: a closed goal clears what it wrote, a reopened one writes it again
    IF v_cancelled THEN
      WITH closed AS (
        UPDATE public.client_goals SET status = 'archived'
          WHERE competition_id = NEW.id AND status IN ('proposed', 'active') RETURNING id, client_id)
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        SELECT id, client_id, 'system', auth.uid(), 'archived', jsonb_build_object('why', 'The competition was cancelled', 'reason', 'competition_cancelled') FROM closed;
    ELSIF v_back_on THEN
      WITH back AS (
        UPDATE public.client_goals cg SET
            status = CASE WHEN cg.approved_kg IS NOT NULL OR cg.approved_text IS NOT NULL THEN 'active' ELSE 'proposed' END,
            deadline = NEW.meet_date, event_title = left(NEW.name, 160), assessed_at = NULL, data_hash = NULL
          WHERE cg.competition_id = NEW.id AND cg.status = 'archived'
            AND (SELECT e.detail ->> 'reason' FROM public.client_goal_events e WHERE e.goal_id = cg.id ORDER BY e.at DESC, e.id DESC LIMIT 1) = 'competition_cancelled'
            AND NOT EXISTS (SELECT 1 FROM public.client_goals x WHERE x.client_id = cg.client_id AND x.dedupe_key = cg.dedupe_key AND x.status IN ('proposed', 'active'))
          RETURNING cg.id, cg.client_id)
      INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
        SELECT id, client_id, 'system', auth.uid(), 'reopened', jsonb_build_object('why', 'The competition is back on') FROM back;
    END IF;
    IF v_moved AND NOT v_cancelled THEN
      UPDATE public.client_goals SET deadline = NEW.meet_date, event_title = left(NEW.name, 160), assessed_at = NULL, data_hash = NULL
        WHERE competition_id = NEW.id AND status IN ('proposed', 'active');
    END IF;

    PERFORM set_config('jf.goal_sync', 'on', true);
    -- the approved target: set, changed, or cleared
    IF v_target_changed THEN
      SELECT * INTO g FROM public.client_goals
        WHERE client_id = NEW.client_id AND dedupe_key = v_key AND status IN ('proposed', 'active') LIMIT 1;
      IF NEW.target_total_kg IS NOT NULL THEN
        IF g.id IS NULL THEN
          INSERT INTO public.client_goals (
            client_id, kind, title, direction, competition_id, event_title, deadline, status,
            approved_value, approved_unit, approved_kg, approved_at, approved_by,
            client_value, client_unit, client_unit_source, client_kg,
            source_kind, source_id, source_context, dedupe_key, created_by)
          VALUES (
            NEW.client_id, 'total', left('Total · ' || NEW.name, 160), 'up', NEW.id, left(NEW.name, 160), NEW.meet_date, 'active',
            NEW.target_total_kg, 'kg', NEW.target_total_kg, now(), auth.uid(),
            NEW.athlete_goal_total_kg, CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN 'kg' END,
            CASE WHEN NEW.athlete_goal_total_kg IS NOT NULL THEN 'coach' END, NEW.athlete_goal_total_kg,
            'competition', NEW.id::text, 'Set on the competition', v_key, auth.uid())
          RETURNING * INTO g;
          INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
            VALUES (g.id, g.client_id, 'coach', auth.uid(), 'created', jsonb_build_object('from', 'competition'));
          v_athlete_changed := false; -- written with it
        ELSE
          UPDATE public.client_goals SET
            status = 'active', approved_value = NEW.target_total_kg, approved_unit = 'kg', approved_kg = NEW.target_total_kg,
            approved_at = CASE WHEN approved_kg IS DISTINCT FROM NEW.target_total_kg THEN now() ELSE approved_at END,
            approved_by = CASE WHEN approved_kg IS DISTINCT FROM NEW.target_total_kg THEN auth.uid() ELSE approved_by END,
            approved_approach = CASE WHEN approved_kg IS DISTINCT FROM NEW.target_total_kg THEN NULL ELSE approved_approach END,
            deadline = NEW.meet_date, assessed_at = NULL, data_hash = NULL
          WHERE id = g.id;
          INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
            VALUES (g.id, g.client_id, 'coach', auth.uid(), 'synced', jsonb_build_object('from', 'competition', 'target_total_kg', NEW.target_total_kg));
        END IF;
      ELSIF g.id IS NOT NULL AND g.approved_kg IS NOT NULL THEN
        -- cleared on the competition: the approval goes (their own number stays, as a proposal)
        UPDATE public.client_goals SET
          approved_value = NULL, approved_value_max = NULL, approved_unit = NULL, approved_kg = NULL, approved_approach = NULL,
          approved_at = NULL, approved_by = NULL,
          status = CASE WHEN client_kg IS NOT NULL THEN 'proposed' ELSE 'archived' END,
          assessed_at = NULL, data_hash = NULL
        WHERE id = g.id;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, 'coach', auth.uid(), 'target_cleared', jsonb_build_object('why', 'Target cleared on the competition', 'was_kg', OLD.target_total_kg));
      END IF;
    END IF;
    -- the athlete's own total: set, changed, or cleared
    IF v_athlete_changed THEN
      SELECT * INTO g FROM public.client_goals
        WHERE client_id = NEW.client_id AND dedupe_key = v_key AND status IN ('proposed', 'active') LIMIT 1;
      IF NEW.athlete_goal_total_kg IS NOT NULL THEN
        IF g.id IS NULL THEN
          INSERT INTO public.client_goals (
            client_id, kind, title, direction, competition_id, event_title, deadline, status,
            client_value, client_unit, client_unit_source, client_kg,
            source_kind, source_id, source_context, dedupe_key, created_by)
          VALUES (
            NEW.client_id, 'total', left('Total · ' || NEW.name, 160), 'up', NEW.id, left(NEW.name, 160), NEW.meet_date, 'proposed',
            NEW.athlete_goal_total_kg, 'kg', 'coach', NEW.athlete_goal_total_kg,
            'competition', NEW.id::text, 'Set on the competition', v_key, auth.uid())
          RETURNING * INTO g;
          INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
            VALUES (g.id, g.client_id, 'coach', auth.uid(), 'created', jsonb_build_object('from', 'competition'));
        ELSE
          UPDATE public.client_goals SET
            client_value = NEW.athlete_goal_total_kg, client_value_max = NULL, client_unit = 'kg', client_unit_source = 'coach',
            client_kg = NEW.athlete_goal_total_kg, client_kg_max = NULL, assessed_at = NULL, data_hash = NULL
          WHERE id = g.id;
          INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
            VALUES (g.id, g.client_id, 'coach', auth.uid(), 'synced', jsonb_build_object('from', 'competition', 'athlete_goal_total_kg', NEW.athlete_goal_total_kg));
        END IF;
      ELSIF g.id IS NOT NULL AND g.client_kg IS NOT NULL THEN
        UPDATE public.client_goals SET
          client_value = NULL, client_value_max = NULL, client_unit = NULL, client_unit_source = NULL, client_kg = NULL, client_kg_max = NULL,
          status = CASE WHEN status = 'proposed' AND approved_kg IS NULL THEN 'archived' ELSE status END,
          assessed_at = NULL, data_hash = NULL
        WHERE id = g.id;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, 'coach', auth.uid(), 'client_target_cleared', jsonb_build_object('why', 'Their total cleared on the competition'));
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'goal sync from competitions skipped: %', SQLERRM;
  END;
  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;

-- ── 5. Back: a coaching client's bodyweight goal on their profile ──────────
CREATE OR REPLACE FUNCTION public.tg_clients_bodyweight_goal_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  g public.client_goals;
  -- a coach approves; the client says what they want; a write with nobody signed in is neither (never an approval)
  v_actor text := CASE WHEN auth.uid() IS NULL THEN 'system' WHEN auth.uid() = NEW.user_id THEN 'athlete' ELSE 'coach' END;
  v_staff boolean;
  v_unit text;
  v_kg numeric;
  v_dir text;
  v_key text;
BEGIN
  IF coalesce(current_setting('jf.goal_sync', true), '') = 'on' THEN RETURN NULL; END IF;
  -- the ledger is coaching's: a member's own goal stays theirs
  IF NEW.service_tier IS DISTINCT FROM 'coaching' THEN RETURN NULL; END IF;
  IF NEW.bodyweight_goal_value IS NOT DISTINCT FROM OLD.bodyweight_goal_value
     AND NEW.bodyweight_goal_value_max IS NOT DISTINCT FROM OLD.bodyweight_goal_value_max
     AND NEW.bodyweight_goal_unit IS NOT DISTINCT FROM OLD.bodyweight_goal_unit
     AND NEW.bodyweight_goal_date IS NOT DISTINCT FROM OLD.bodyweight_goal_date
     AND NEW.bodyweight_goal_type IS NOT DISTINCT FROM OLD.bodyweight_goal_type THEN
    RETURN NULL;
  END IF;
  v_staff := v_actor = 'coach';
  PERFORM set_config('jf.goal_sync', 'on', true);
  BEGIN
    SELECT * INTO g FROM public.client_goals
      WHERE client_id = NEW.id AND kind = 'bodyweight' AND status IN ('proposed', 'active')
      ORDER BY (status = 'active') DESC, updated_at DESC LIMIT 1;
    IF NEW.bodyweight_goal_value IS NULL THEN
      IF g.id IS NOT NULL AND (v_staff OR g.status = 'proposed') THEN
        UPDATE public.client_goals SET status = 'archived' WHERE id = g.id;
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, v_actor, auth.uid(), 'archived', jsonb_build_object('why', 'Bodyweight goal cleared on their profile'));
      END IF;
    ELSE
      -- no unit on the profile reads as their own unit (as the app reads it)
      v_unit := coalesce(NEW.bodyweight_goal_unit, CASE WHEN NEW.preferred_weight_unit = 'kg' THEN 'kg' ELSE 'lb' END);
      v_kg := CASE WHEN v_unit = 'lb' THEN NEW.bodyweight_goal_value / 2.2046226218 ELSE NEW.bodyweight_goal_value END;
      v_dir := CASE NEW.bodyweight_goal_type WHEN 'gain' THEN 'up' WHEN 'lose' THEN 'down' WHEN 'performance_cut' THEN 'down' ELSE NULL END;
      v_key := 'bodyweight:' || coalesce('date:' || NEW.bodyweight_goal_date::text, 'open');
      IF g.id IS NULL THEN
        INSERT INTO public.client_goals (
          client_id, kind, title, direction, deadline, status, profile_type,
          approved_value, approved_value_max, approved_unit, approved_kg, approved_at, approved_by,
          client_value, client_value_max, client_unit, client_unit_source, client_kg,
          source_kind, source_context, source_speaker, source_at, dedupe_key, created_by)
        VALUES (
          NEW.id, 'bodyweight', 'Bodyweight' || coalesce(' by ' || to_char(NEW.bodyweight_goal_date, 'Mon FMDD, YYYY'), ''), v_dir, NEW.bodyweight_goal_date,
          CASE WHEN v_staff THEN 'active' ELSE 'proposed' END, NEW.bodyweight_goal_type,
          CASE WHEN v_staff THEN NEW.bodyweight_goal_value END, CASE WHEN v_staff THEN NEW.bodyweight_goal_value_max END,
          CASE WHEN v_staff THEN v_unit END, CASE WHEN v_staff THEN v_kg END, CASE WHEN v_staff THEN now() END, CASE WHEN v_staff THEN auth.uid() END,
          CASE WHEN NOT v_staff THEN NEW.bodyweight_goal_value END,
          CASE WHEN NOT v_staff AND NEW.bodyweight_goal_value_max >= NEW.bodyweight_goal_value THEN NEW.bodyweight_goal_value_max END,
          CASE WHEN NOT v_staff THEN v_unit END,
          CASE WHEN NOT v_staff THEN 'stated' END, CASE WHEN NOT v_staff THEN v_kg END,
          'profile',
          CASE v_actor WHEN 'coach' THEN 'Set on their profile by their coach' WHEN 'athlete' THEN 'Set by the client on their bodyweight card' ELSE 'Set on their profile' END,
          CASE v_actor WHEN 'coach' THEN 'coach' WHEN 'athlete' THEN 'athlete' ELSE 'unclear' END, now(), v_key, auth.uid())
        ON CONFLICT DO NOTHING
        RETURNING * INTO g;
      ELSIF v_staff THEN
        UPDATE public.client_goals SET
          status = 'active', direction = coalesce(v_dir, direction), deadline = NEW.bodyweight_goal_date, profile_type = NEW.bodyweight_goal_type,
          approved_value = NEW.bodyweight_goal_value, approved_value_max = NEW.bodyweight_goal_value_max, approved_unit = v_unit, approved_kg = v_kg,
          approved_at = now(), approved_by = auth.uid(), approved_approach = NULL, assessed_at = NULL, data_hash = NULL,
          dedupe_key = CASE WHEN EXISTS (SELECT 1 FROM public.client_goals x WHERE x.client_id = NEW.id AND x.dedupe_key = v_key AND x.status IN ('proposed', 'active') AND x.id <> g.id) THEN dedupe_key ELSE v_key END
        WHERE id = g.id
        RETURNING * INTO g;
      ELSE
        UPDATE public.client_goals SET
          client_value = NEW.bodyweight_goal_value,
          client_value_max = CASE WHEN NEW.bodyweight_goal_value_max >= NEW.bodyweight_goal_value THEN NEW.bodyweight_goal_value_max END,
          client_unit = v_unit, client_unit_source = 'stated', client_kg = v_kg, client_kg_max = NULL,
          profile_type = coalesce(profile_type, NEW.bodyweight_goal_type),
          direction = coalesce(direction, v_dir), deadline = coalesce(deadline, NEW.bodyweight_goal_date), assessed_at = NULL, data_hash = NULL
        WHERE id = g.id
        RETURNING * INTO g;
      END IF;
      IF g.id IS NOT NULL THEN
        INSERT INTO public.client_goal_events (goal_id, client_id, actor, actor_id, action, detail)
          VALUES (g.id, g.client_id, v_actor, auth.uid(), 'synced',
                  jsonb_build_object('from', 'profile', 'value', NEW.bodyweight_goal_value, 'unit', v_unit, 'date', NEW.bodyweight_goal_date, 'type', NEW.bodyweight_goal_type));
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'goal sync from the bodyweight goal skipped: %', SQLERRM;
  END;
  PERFORM set_config('jf.goal_sync', '', true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_client_goals_mirror() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_competitions_goal_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_clients_bodyweight_goal_sync() FROM PUBLIC, anon, authenticated;

-- ── 6. What the worker hasn't read yet (oldest first, never the same 50) ────
CREATE OR REPLACE FUNCTION public.goal_intel_meetings_to_scan(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, updated_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s.id, s.updated_at FROM public.coaching_sessions s
  WHERE s.analysis_status = 'ready' AND s.updated_at > now() - interval '180 days'
    AND NOT EXISTS (SELECT 1 FROM public.client_goal_sources x
                    WHERE x.source_kind = 'meeting' AND x.source_id = s.id::text AND x.scanned_at >= s.updated_at)
  ORDER BY s.updated_at ASC
  LIMIT greatest(1, least(coalesce(_limit, 50), 200));
$$;
CREATE OR REPLACE FUNCTION public.goal_intel_checkins_to_scan(_limit integer DEFAULT 60)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id FROM public.messenger_checkins c
  WHERE c.task_type = 'weekly_checkin' AND c.status = 'completed' AND c.submitted_at > now() - interval '14 days'
    AND NOT EXISTS (SELECT 1 FROM public.client_goal_sources x WHERE x.source_kind = 'checkin' AND x.source_id = c.id::text)
  ORDER BY c.submitted_at ASC
  LIMIT greatest(1, least(coalesce(_limit, 60), 200));
$$;
REVOKE ALL ON FUNCTION public.goal_intel_meetings_to_scan(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.goal_intel_checkins_to_scan(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.goal_intel_meetings_to_scan(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.goal_intel_checkins_to_scan(integer) TO service_role;

-- ── 7. What's waiting (a send cut off part way too) ─────────────────────────
CREATE OR REPLACE FUNCTION public.goal_intel_due()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.client_update_outbox o
            WHERE o.status = 'pending' AND coalesce(o.next_attempt_at, o.send_after) <= now())
    -- a send that was claimed and never finished
    OR EXISTS (SELECT 1 FROM public.client_update_outbox o
               WHERE o.status = 'sending' AND coalesce(o.claimed_at, o.updated_at) < now() - interval '10 minutes')
    OR EXISTS (SELECT 1 FROM public.coaching_sessions s
               WHERE s.analysis_status = 'ready' AND s.updated_at > now() - interval '180 days'
                 AND NOT EXISTS (SELECT 1 FROM public.client_goal_sources x
                                 WHERE x.source_kind = 'meeting' AND x.source_id = s.id::text AND x.scanned_at >= s.updated_at))
    OR EXISTS (SELECT 1 FROM public.messenger_checkins c
               WHERE c.task_type = 'weekly_checkin' AND c.status = 'completed' AND c.submitted_at > now() - interval '14 days'
                 AND NOT EXISTS (SELECT 1 FROM public.client_goal_sources x WHERE x.source_kind = 'checkin' AND x.source_id = c.id::text))
    OR EXISTS (SELECT 1 FROM public.client_goals g
               WHERE g.status IN ('proposed', 'active') AND (g.assessed_at IS NULL OR g.assessed_at < now() - interval '6 hours'))
    OR (coalesce((SELECT (value::jsonb ->> 'messages_at')::timestamptz FROM public.app_settings WHERE key = 'goal_intel_scan'), now() - interval '7 days') < now() - interval '30 minutes'
        AND EXISTS (SELECT 1 FROM public.messages m
                    WHERE m.sender_role = 'client' AND m.created_at > coalesce((SELECT (value::jsonb ->> 'messages_at')::timestamptz FROM public.app_settings WHERE key = 'goal_intel_scan'), now() - interval '7 days')));
$$;
REVOKE ALL ON FUNCTION public.goal_intel_due() FROM PUBLIC, anon, authenticated;

-- ── 8. Goals already on file: the profile's own type and range ─────────────
SELECT set_config('jf.goal_sync', 'on', true);
UPDATE public.client_goals g SET
  profile_type = c.bodyweight_goal_type,
  approved_value_max = CASE WHEN c.bodyweight_goal_type = 'maintain' THEN c.bodyweight_goal_value_max END
FROM public.clients c
WHERE g.client_id = c.id AND g.kind = 'bodyweight' AND g.status = 'active' AND g.source_kind = 'profile'
  AND g.profile_type IS NULL AND c.bodyweight_goal_type IS NOT NULL
  AND c.bodyweight_goal_value IS NOT DISTINCT FROM g.approved_value;
SELECT set_config('jf.goal_sync', '', true);
