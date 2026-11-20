-- Equipment & setups (Nov 19 2026).
--
-- An athlete's gyms, the racks and machines in them, and how each exercise is
-- set up on each one (J-hooks 9, safeties 4, seat 3…). Every logged set is
-- stamped with the equipment its card showed (pl_row_results.equipment_id),
-- so history, "Last time" and PRs can tell a Hammer Strength row from a Life
-- Fitness one. Weights on different machines are never converted into each
-- other: they're kept apart, never made "equivalent".
--
--   athlete_gyms             where they train (a name), per athlete
--   athlete_equipment        a rack / bench / machine / cable… (name, kind,
--                            brand, model, photo, favorite), optionally in a gym
--   athlete_exercise_setups  one exercise on one piece of equipment (or on
--                            nothing in particular): its settings, a note, a
--                            photo; last_used_at is the athlete's current pick
--                            for the exercise (the newest wins)
--
-- Reads: the athlete, their coach, an admin, and a linked staff login (read
-- only). Writes only through the equipment_* RPCs (workout_can_act_for_client).
-- Equipment that ever went on a logged set is retired (archived), never
-- deleted, so history keeps its name; never-used equipment is deleted.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_gyms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  archived_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athlete_gyms_name_uniq
  ON public.athlete_gyms (client_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS athlete_gyms_client_idx ON public.athlete_gyms (client_id);

CREATE TABLE IF NOT EXISTS public.athlete_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  gym_id uuid REFERENCES public.athlete_gyms(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('rack', 'bench', 'machine', 'cable', 'smith', 'cardio', 'other')),
  -- what they call it ("Rogue rack", "Hammer ISO row"); brand and model are optional
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  brand text CHECK (brand IS NULL OR char_length(brand) <= 60),
  model text CHECK (model IS NULL OR char_length(model) <= 60),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 280),
  photo_path text,
  favorite boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  archived_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- one "Rogue rack" per gym (a retired one doesn't count: it can be replaced)
CREATE UNIQUE INDEX IF NOT EXISTS athlete_equipment_name_uniq
  ON public.athlete_equipment (client_id, coalesce(gym_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS athlete_equipment_client_idx ON public.athlete_equipment (client_id);
CREATE INDEX IF NOT EXISTS athlete_equipment_gym_idx ON public.athlete_equipment (gym_id) WHERE gym_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.athlete_exercise_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  -- null: set up on nothing in particular (a bench press's "J-hooks 9" with no named rack)
  equipment_id uuid REFERENCES public.athlete_equipment(id) ON DELETE CASCADE,
  -- [{ "label": "J-hooks", "value": "9" }, …], cleaned by athlete_setup_clean_settings
  settings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(settings) = 'array'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 280),
  photo_path text,
  -- who wrote it last: the athlete, or their coach / an admin
  source text NOT NULL DEFAULT 'athlete' CHECK (source IN ('athlete', 'coach')),
  updated_by uuid DEFAULT auth.uid(),
  -- the newest across an exercise's setups is what its card shows and what new sets are stamped with
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athlete_exercise_setups_uniq
  ON public.athlete_exercise_setups (client_id, exercise_id, coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS athlete_exercise_setups_current_idx
  ON public.athlete_exercise_setups (client_id, exercise_id, last_used_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS athlete_exercise_setups_equipment_idx
  ON public.athlete_exercise_setups (equipment_id) WHERE equipment_id IS NOT NULL;

-- Which equipment a logged set was done on. SET NULL only matters for a whole
-- account purge: equipment that's on a set is retired, never deleted.
ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.athlete_equipment(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pl_row_results_equipment_idx
  ON public.pl_row_results (equipment_id) WHERE equipment_id IS NOT NULL;

COMMENT ON TABLE public.athlete_gyms IS 'Where an athlete trains (a gym or home), for grouping their saved equipment.';
COMMENT ON TABLE public.athlete_equipment IS 'An athlete''s racks, benches, machines and cables (name, kind, brand, model, gym, photo). Retired (archived_at) once used and removed; logged sets point at it through pl_row_results.equipment_id.';
COMMENT ON TABLE public.athlete_exercise_setups IS 'How an athlete sets up one exercise on one piece of equipment: settings like J-hooks / safeties / seat as [{label, value}], a note, a photo. The newest last_used_at per exercise is the setup their workout card shows.';
COMMENT ON COLUMN public.pl_row_results.equipment_id IS 'The athlete_equipment the set was done on (stamped from the exercise''s current setup when the set is logged).';

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
ALTER TABLE public.athlete_gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_exercise_setups ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['athlete_gyms', 'athlete_equipment', 'athlete_exercise_setups'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Equipment: own" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Equipment: own" ON public.%I FOR SELECT TO authenticated
      USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Equipment: linked login" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Equipment: linked login" ON public.%I FOR SELECT TO authenticated
      USING (client_id = (SELECT public.linked_client_id()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Equipment: coach" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Equipment: coach" ON public.%I FOR SELECT TO authenticated
      USING (client_id IN (SELECT public.coached_client_ids()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Equipment: admin" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Equipment: admin" ON public.%I FOR SELECT TO authenticated
      USING ((SELECT public.has_role((SELECT auth.uid()), ''admin'')))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Settings as stored: labelled values only, trimmed (label ≤ 32, value ≤ 40),
-- at most 12, in the order given; a label with nothing typed beside it is dropped.
-- equipment.ts cleanSettings is the same rule on the phone.
CREATE OR REPLACE FUNCTION public.athlete_setup_clean_settings(_s jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', t.l, 'value', t.v) ORDER BY t.ord), '[]'::jsonb)
  FROM (
    SELECT l, v, ord
    FROM (
      SELECT left(btrim(coalesce(e->>'label', '')), 32) AS l,
             left(btrim(coalesce(e->>'value', '')), 40) AS v,
             x.ord
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_s) = 'array' THEN _s ELSE '[]'::jsonb END)
           WITH ORDINALITY AS x(e, ord)
      WHERE jsonb_typeof(e) = 'object'
    ) raw
    WHERE l <> '' AND v <> ''
    ORDER BY ord
    LIMIT 12
  ) t
$$;

-- The equipment an athlete's card for this exercise shows now: the setup they
-- used last (null = nothing in particular, or nothing saved). Retired equipment
-- is never current.
CREATE OR REPLACE FUNCTION public.athlete_current_equipment(_client_id uuid, _exercise_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.equipment_id
    FROM public.athlete_exercise_setups s
    LEFT JOIN public.athlete_equipment e ON e.id = s.equipment_id
   WHERE s.client_id = _client_id
     AND s.exercise_id = _exercise_id
     AND s.last_used_at IS NOT NULL
     AND (s.equipment_id IS NULL OR e.archived_at IS NULL)
   ORDER BY s.last_used_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.athlete_current_equipment(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A set takes the exercise's current equipment the first time it's logged (or
-- when it's inserted logged), only while it's today's: editing a set from weeks
-- ago never stamps it with today's machine. A writer that names equipment wins.
CREATE OR REPLACE FUNCTION public.tg_pl_row_results_stamp_equipment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ex uuid;
BEGIN
  IF NEW.equipment_id IS NOT NULL OR NEW.completed_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.completed_at < now() - interval '18 hours' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.athlete_exercise_setups s WHERE s.client_id = NEW.client_id) THEN
    RETURN NEW;
  END IF;
  SELECT er.exercise_id INTO v_ex FROM public.pl_exercise_rows er WHERE er.id = NEW.row_id;
  IF v_ex IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.equipment_id := public.athlete_current_equipment(NEW.client_id, v_ex);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_pl_row_results_stamp_equipment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pl_row_results_stamp_equipment ON public.pl_row_results;
CREATE TRIGGER pl_row_results_stamp_equipment
  BEFORE INSERT OR UPDATE ON public.pl_row_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_row_results_stamp_equipment();

CREATE OR REPLACE FUNCTION public._equipment_assert(_client_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _client_id IS NULL OR auth.uid() IS NULL OR NOT public.workout_can_act_for_client(_client_id) THEN
    RAISE EXCEPTION 'You can''t change this athlete''s equipment' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._equipment_assert(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._equipment_source(_client_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = auth.uid())
              THEN 'athlete' ELSE 'coach' END
$$;
REVOKE ALL ON FUNCTION public._equipment_source(uuid) FROM PUBLIC, anon, authenticated;

-- Whether equipment is on any logged set (or on a set waiting in an exercise's
-- trash, which Restore would put back): then it's retired, never deleted.
CREATE OR REPLACE FUNCTION public._equipment_in_history(_equipment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.pl_row_results r WHERE r.equipment_id = _equipment_id)
      OR EXISTS (SELECT 1 FROM public.pl_exercise_row_trash t
                  WHERE t.results @> jsonb_build_array(jsonb_build_object('equipment_id', _equipment_id::text)))
$$;
REVOKE ALL ON FUNCTION public._equipment_in_history(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gyms
-- ---------------------------------------------------------------------------
-- Add (or rename, with _id) a gym. Adding a name they already have returns that
-- one (existed: true), never a second copy.
CREATE OR REPLACE FUNCTION public.equipment_gym_save(_client_id uuid, _name text, _id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(coalesce(_name, ''));
  v_id uuid;
BEGIN
  PERFORM public._equipment_assert(_client_id);
  IF v_name = '' OR char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'Give the gym a name (60 characters at most)' USING ERRCODE = '22023';
  END IF;
  IF _id IS NULL THEN
    SELECT g.id INTO v_id FROM public.athlete_gyms g
     WHERE g.client_id = _client_id AND g.archived_at IS NULL AND lower(btrim(g.name)) = lower(v_name);
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'existed', true);
    END IF;
    INSERT INTO public.athlete_gyms (client_id, name) VALUES (_client_id, v_name) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'existed', false);
  END IF;
  BEGIN
    UPDATE public.athlete_gyms SET name = v_name, updated_at = now()
     WHERE id = _id AND client_id = _client_id
     RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have a gym called %', v_name USING ERRCODE = '23505';
  END;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'That gym isn''t there any more' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', v_id, 'existed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Equipment
-- ---------------------------------------------------------------------------
-- Add (or edit, with _id) a piece of equipment. Adding one with the same name
-- in the same gym returns the one they have (existed: true).
CREATE OR REPLACE FUNCTION public.equipment_save(
  _client_id uuid,
  _name text,
  _kind text DEFAULT 'other',
  _gym_id uuid DEFAULT NULL,
  _brand text DEFAULT NULL,
  _model text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _photo_path text DEFAULT NULL,
  _id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(coalesce(_name, ''));
  v_kind text := coalesce(nullif(btrim(_kind), ''), 'other');
  v_brand text := nullif(btrim(coalesce(_brand, '')), '');
  v_model text := nullif(btrim(coalesce(_model, '')), '');
  v_notes text := nullif(btrim(coalesce(_notes, '')), '');
  v_photo text := nullif(btrim(coalesce(_photo_path, '')), '');
  v_id uuid;
BEGIN
  PERFORM public._equipment_assert(_client_id);
  IF v_name = '' OR char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'Give it a name (60 characters at most)' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('rack', 'bench', 'machine', 'cable', 'smith', 'cardio', 'other') THEN
    v_kind := 'other';
  END IF;
  IF char_length(coalesce(v_brand, '')) > 60 OR char_length(coalesce(v_model, '')) > 60 OR char_length(coalesce(v_notes, '')) > 280 THEN
    RAISE EXCEPTION 'That''s too long' USING ERRCODE = '22023';
  END IF;
  IF _gym_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.athlete_gyms g WHERE g.id = _gym_id AND g.client_id = _client_id) THEN
    RAISE EXCEPTION 'That gym isn''t theirs' USING ERRCODE = '42501';
  END IF;
  IF v_photo IS NOT NULL AND v_photo NOT LIKE _client_id::text || '/%' THEN
    RAISE EXCEPTION 'That photo isn''t theirs' USING ERRCODE = '42501';
  END IF;

  IF _id IS NULL THEN
    SELECT e.id INTO v_id FROM public.athlete_equipment e
     WHERE e.client_id = _client_id AND e.archived_at IS NULL
       AND e.gym_id IS NOT DISTINCT FROM _gym_id
       AND lower(btrim(e.name)) = lower(v_name);
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'existed', true);
    END IF;
    INSERT INTO public.athlete_equipment (client_id, gym_id, kind, name, brand, model, notes, photo_path)
    VALUES (_client_id, _gym_id, v_kind, v_name, v_brand, v_model, v_notes, v_photo)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'existed', false);
  END IF;

  BEGIN
    UPDATE public.athlete_equipment
       SET gym_id = _gym_id, kind = v_kind, name = v_name, brand = v_brand, model = v_model,
           notes = v_notes, photo_path = v_photo, updated_at = now()
     WHERE id = _id AND client_id = _client_id
     RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'There''s already a % there', v_name USING ERRCODE = '23505';
  END;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'That equipment isn''t there any more' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', v_id, 'existed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.equipment_set_favorite(_id uuid, _on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.athlete_equipment WHERE id = _id;
  PERFORM public._equipment_assert(v_client);
  UPDATE public.athlete_equipment SET favorite = coalesce(_on, false), updated_at = now() WHERE id = _id;
END;
$$;

-- Remove a piece of equipment: retired (kept for history, out of every picker)
-- when a logged set was done on it, else deleted with its setups.
CREATE OR REPLACE FUNCTION public.equipment_remove(_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.athlete_equipment WHERE id = _id;
  IF v_client IS NULL THEN
    RETURN 'gone';
  END IF;
  PERFORM public._equipment_assert(v_client);
  IF public._equipment_in_history(_id) THEN
    UPDATE public.athlete_equipment
       SET archived_at = coalesce(archived_at, now()), favorite = false, updated_at = now()
     WHERE id = _id;
    RETURN 'archived';
  END IF;
  DELETE FROM public.athlete_equipment WHERE id = _id;
  RETURN 'deleted';
END;
$$;

-- Bring retired equipment back.
CREATE OR REPLACE FUNCTION public.equipment_restore(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_client uuid; v_gym uuid;
BEGIN
  SELECT client_id, gym_id INTO v_client, v_gym FROM public.athlete_equipment WHERE id = _id;
  PERFORM public._equipment_assert(v_client);
  BEGIN
    UPDATE public.athlete_equipment SET archived_at = NULL, updated_at = now() WHERE id = _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'There''s already one with that name there. Rename one of them first.' USING ERRCODE = '23505';
  END;
  -- its gym comes back with it
  UPDATE public.athlete_gyms SET archived_at = NULL, updated_at = now()
   WHERE id = v_gym AND archived_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.athlete_gyms o
                      WHERE o.client_id = v_client AND o.archived_at IS NULL AND o.id <> v_gym
                        AND lower(btrim(o.name)) = (SELECT lower(btrim(name)) FROM public.athlete_gyms WHERE id = v_gym));
END;
$$;

-- Remove a gym (they don't train there any more): each piece of its equipment
-- is removed the same way (retired if it's in history, else deleted), and the
-- gym is retired while anything retired is still in it, else deleted.
CREATE OR REPLACE FUNCTION public.equipment_gym_remove(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  e record;
  v_retired int := 0;
  v_deleted int := 0;
  v_result text;
BEGIN
  SELECT client_id INTO v_client FROM public.athlete_gyms WHERE id = _id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('gym', 'gone', 'retired', 0, 'deleted', 0);
  END IF;
  PERFORM public._equipment_assert(v_client);
  FOR e IN SELECT id FROM public.athlete_equipment WHERE gym_id = _id AND archived_at IS NULL LOOP
    v_result := public.equipment_remove(e.id);
    IF v_result = 'archived' THEN v_retired := v_retired + 1; ELSE v_deleted := v_deleted + 1; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.athlete_equipment WHERE gym_id = _id) THEN
    UPDATE public.athlete_gyms SET archived_at = coalesce(archived_at, now()), updated_at = now() WHERE id = _id;
    RETURN jsonb_build_object('gym', 'archived', 'retired', v_retired, 'deleted', v_deleted);
  END IF;
  DELETE FROM public.athlete_gyms WHERE id = _id;
  RETURN jsonb_build_object('gym', 'deleted', 'retired', v_retired, 'deleted', v_deleted);
END;
$$;

-- ---------------------------------------------------------------------------
-- Setups
-- ---------------------------------------------------------------------------
-- Save how an exercise is set up on a piece of equipment (or on nothing in
-- particular). _make_current puts it on their workout card from now on; a
-- first setup for the exercise is current either way.
CREATE OR REPLACE FUNCTION public.equipment_setup_save(
  _client_id uuid,
  _exercise_id uuid,
  _equipment_id uuid DEFAULT NULL,
  _settings jsonb DEFAULT '[]'::jsonb,
  _notes text DEFAULT NULL,
  _photo_path text DEFAULT NULL,
  _make_current boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings jsonb := public.athlete_setup_clean_settings(_settings);
  v_notes text := nullif(btrim(coalesce(_notes, '')), '');
  v_photo text := nullif(btrim(coalesce(_photo_path, '')), '');
  v_source text;
  v_current boolean;
  v_row public.athlete_exercise_setups;
BEGIN
  PERFORM public._equipment_assert(_client_id);
  IF NOT EXISTS (SELECT 1 FROM public.exercises x WHERE x.id = _exercise_id) THEN
    RAISE EXCEPTION 'That exercise isn''t in the library' USING ERRCODE = 'P0002';
  END IF;
  IF _equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.athlete_equipment e WHERE e.id = _equipment_id AND e.client_id = _client_id
  ) THEN
    RAISE EXCEPTION 'That equipment isn''t theirs' USING ERRCODE = '42501';
  END IF;
  IF char_length(coalesce(v_notes, '')) > 280 THEN
    RAISE EXCEPTION 'The note is too long (280 characters at most)' USING ERRCODE = '22023';
  END IF;
  IF v_photo IS NOT NULL AND v_photo NOT LIKE _client_id::text || '/%' THEN
    RAISE EXCEPTION 'That photo isn''t theirs' USING ERRCODE = '42501';
  END IF;
  v_source := public._equipment_source(_client_id);
  v_current := coalesce(_make_current, false) OR NOT EXISTS (
    SELECT 1 FROM public.athlete_exercise_setups s
     WHERE s.client_id = _client_id AND s.exercise_id = _exercise_id AND s.last_used_at IS NOT NULL
  );

  -- one statement, so a pick made a moment earlier (equipment_choose) never races it
  INSERT INTO public.athlete_exercise_setups AS s
    (client_id, exercise_id, equipment_id, settings, notes, photo_path, source, updated_by, last_used_at)
  VALUES (_client_id, _exercise_id, _equipment_id, v_settings, v_notes, v_photo, v_source, auth.uid(),
          CASE WHEN v_current THEN clock_timestamp() END)
  ON CONFLICT (client_id, exercise_id, (coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET settings = EXCLUDED.settings, notes = EXCLUDED.notes, photo_path = EXCLUDED.photo_path,
                source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now(),
                last_used_at = CASE WHEN v_current THEN clock_timestamp() ELSE s.last_used_at END
  RETURNING * INTO v_row;
  IF v_current AND _equipment_id IS NOT NULL THEN
    UPDATE public.athlete_equipment SET last_used_at = clock_timestamp() WHERE id = _equipment_id;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- Forget a setup (the settings for one exercise on one piece of equipment).
-- Logged sets keep their equipment; only the saved settings go.
CREATE OR REPLACE FUNCTION public.equipment_setup_remove(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.athlete_exercise_setups WHERE id = _id;
  IF v_client IS NULL THEN
    RETURN;
  END IF;
  PERFORM public._equipment_assert(v_client);
  DELETE FROM public.athlete_exercise_setups WHERE id = _id;
END;
$$;

-- Switch which equipment an exercise is done on (_equipment_id null: nothing in
-- particular), in one tap from the workout card.
--   Live (default): it becomes the exercise's current setup (made, empty, if
--   they've never used it for this exercise), and the sets of this exercise
--   logged in this workout today move to it (a pick is a correction: they were
--   on it all along). When it's in a gym, the workout's other exercises whose
--   current equipment is in a different gym move to their setup in this gym,
--   when they have one ("you're at Gold's today").
--   _this_workout_only: a past workout's record is fixed (every set of the
--   exercise in that workout, or that one visit with _instance), and nothing
--   else changes.
CREATE OR REPLACE FUNCTION public.equipment_choose(
  _client_id uuid,
  _exercise_id uuid,
  _equipment_id uuid DEFAULT NULL,
  _day_id uuid DEFAULT NULL,
  _this_workout_only boolean DEFAULT false,
  _instance uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym uuid;
  v_restamped int := 0;
  v_n int;
  v_moved jsonb := '[]'::jsonb;
  v_source text;
  r record;
  v_cur uuid;
  v_cur_gym uuid;
  v_pick uuid;
  v_pick_setup uuid;
BEGIN
  PERFORM public._equipment_assert(_client_id);
  IF _equipment_id IS NOT NULL THEN
    SELECT e.gym_id INTO v_gym FROM public.athlete_equipment e
     WHERE e.id = _equipment_id AND e.client_id = _client_id AND e.archived_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That equipment isn''t available' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF _day_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pl_exercise_rows er WHERE er.day_id = _day_id AND er.exercise_id = _exercise_id
  ) THEN
    RAISE EXCEPTION 'That exercise isn''t in this workout' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(_this_workout_only, false) THEN
    IF _day_id IS NULL THEN
      RAISE EXCEPTION 'Which workout?' USING ERRCODE = '22023';
    END IF;
    UPDATE public.pl_row_results res
       SET equipment_id = _equipment_id
      FROM public.pl_exercise_rows er
     WHERE res.row_id = er.id AND er.day_id = _day_id AND er.exercise_id = _exercise_id
       AND res.client_id = _client_id AND res.completed_at IS NOT NULL
       AND (_instance IS NULL OR res.scheduled_workout_id = _instance)
       AND res.equipment_id IS DISTINCT FROM _equipment_id;
    GET DIAGNOSTICS v_restamped = ROW_COUNT;
    RETURN jsonb_build_object('restamped', v_restamped, 'moved', '[]'::jsonb);
  END IF;

  v_source := public._equipment_source(_client_id);
  INSERT INTO public.athlete_exercise_setups (client_id, exercise_id, equipment_id, source, updated_by, last_used_at)
  VALUES (_client_id, _exercise_id, _equipment_id, v_source, auth.uid(), clock_timestamp())
  ON CONFLICT (client_id, exercise_id, (coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET last_used_at = clock_timestamp();
  IF _equipment_id IS NOT NULL THEN
    UPDATE public.athlete_equipment SET last_used_at = clock_timestamp() WHERE id = _equipment_id;
  END IF;

  IF _day_id IS NULL THEN
    RETURN jsonb_build_object('restamped', 0, 'moved', '[]'::jsonb);
  END IF;

  UPDATE public.pl_row_results res
     SET equipment_id = _equipment_id
    FROM public.pl_exercise_rows er
   WHERE res.row_id = er.id AND er.day_id = _day_id AND er.exercise_id = _exercise_id
     AND res.client_id = _client_id AND res.completed_at >= now() - interval '18 hours'
     AND res.equipment_id IS DISTINCT FROM _equipment_id;
  GET DIAGNOSTICS v_restamped = ROW_COUNT;

  IF v_gym IS NOT NULL THEN
    FOR r IN
      SELECT DISTINCT er.exercise_id
        FROM public.pl_exercise_rows er
       WHERE er.day_id = _day_id AND er.exercise_id IS NOT NULL AND er.exercise_id <> _exercise_id
    LOOP
      v_cur := public.athlete_current_equipment(_client_id, r.exercise_id);
      CONTINUE WHEN v_cur IS NULL;
      SELECT e.gym_id INTO v_cur_gym FROM public.athlete_equipment e WHERE e.id = v_cur;
      CONTINUE WHEN v_cur_gym IS NULL OR v_cur_gym = v_gym;
      v_pick := NULL;
      v_pick_setup := NULL;
      SELECT s.id, s.equipment_id INTO v_pick_setup, v_pick
        FROM public.athlete_exercise_setups s
        JOIN public.athlete_equipment e ON e.id = s.equipment_id
       WHERE s.client_id = _client_id AND s.exercise_id = r.exercise_id
         AND e.gym_id = v_gym AND e.archived_at IS NULL
       ORDER BY s.last_used_at DESC NULLS LAST, s.updated_at DESC
       LIMIT 1;
      CONTINUE WHEN v_pick IS NULL;
      UPDATE public.athlete_exercise_setups SET last_used_at = clock_timestamp() WHERE id = v_pick_setup;
      UPDATE public.athlete_equipment SET last_used_at = clock_timestamp() WHERE id = v_pick;
      UPDATE public.pl_row_results res
         SET equipment_id = v_pick
        FROM public.pl_exercise_rows er
       WHERE res.row_id = er.id AND er.day_id = _day_id AND er.exercise_id = r.exercise_id
         AND res.client_id = _client_id AND res.completed_at >= now() - interval '18 hours'
         AND res.equipment_id IS DISTINCT FROM v_pick;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_restamped := v_restamped + v_n;
      v_moved := v_moved || jsonb_build_array(jsonb_build_object('exercise_id', r.exercise_id, 'equipment_id', v_pick));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('restamped', v_restamped, 'moved', v_moved);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.equipment_gym_save(uuid, text, uuid)',
    'public.equipment_save(uuid, text, text, uuid, text, text, text, text, uuid)',
    'public.equipment_set_favorite(uuid, boolean)',
    'public.equipment_remove(uuid)',
    'public.equipment_restore(uuid)',
    'public.equipment_gym_remove(uuid)',
    'public.equipment_setup_save(uuid, uuid, uuid, jsonb, text, text, boolean)',
    'public.equipment_setup_remove(uuid)',
    'public.equipment_choose(uuid, uuid, uuid, uuid, boolean, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- A merged duplicate exercise's setups move to the one it was merged into (the
-- canonical one's setup on the same equipment is kept when both exist).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_exercise_merge_athlete_setups()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.duplicate_id IS NULL OR NEW.canonical_id IS NULL OR NEW.duplicate_id = NEW.canonical_id THEN
    RETURN NEW;
  END IF;
  DELETE FROM public.athlete_exercise_setups d
   WHERE d.exercise_id = NEW.duplicate_id
     AND EXISTS (SELECT 1 FROM public.athlete_exercise_setups c
                  WHERE c.client_id = d.client_id AND c.exercise_id = NEW.canonical_id
                    AND c.equipment_id IS NOT DISTINCT FROM d.equipment_id);
  UPDATE public.athlete_exercise_setups SET exercise_id = NEW.canonical_id WHERE exercise_id = NEW.duplicate_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_exercise_merge_athlete_setups() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS exercise_merge_athlete_setups ON public.exercise_dedupe_audit;
CREATE TRIGGER exercise_merge_athlete_setups
  AFTER INSERT ON public.exercise_dedupe_audit
  FOR EACH ROW EXECUTE FUNCTION public.tg_exercise_merge_athlete_setups();

-- ---------------------------------------------------------------------------
-- Photos: private, under the athlete's folder (<client_id>/…), for the athlete,
-- their coach and an admin; a linked staff login reads.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('equipment-photos', 'equipment-photos', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "equipment photos read" ON storage.objects;
CREATE POLICY "equipment photos read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'equipment-photos' AND (
    (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    OR (storage.foldername(name))[1] IN (SELECT x::text FROM public.coached_client_ids() AS x)
    OR (storage.foldername(name))[1] = (SELECT public.linked_client_id())::text
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  ));
DROP POLICY IF EXISTS "equipment photos insert" ON storage.objects;
CREATE POLICY "equipment photos insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'equipment-photos' AND (
    (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    OR (storage.foldername(name))[1] IN (SELECT x::text FROM public.coached_client_ids() AS x)
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  ));
DROP POLICY IF EXISTS "equipment photos update" ON storage.objects;
CREATE POLICY "equipment photos update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'equipment-photos' AND (
    (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    OR (storage.foldername(name))[1] IN (SELECT x::text FROM public.coached_client_ids() AS x)
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  ));
DROP POLICY IF EXISTS "equipment photos delete" ON storage.objects;
CREATE POLICY "equipment photos delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'equipment-photos' AND (
    (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    OR (storage.foldername(name))[1] IN (SELECT x::text FROM public.coached_client_ids() AS x)
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  ));
