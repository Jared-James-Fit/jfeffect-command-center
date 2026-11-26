-- Exercise setups: several photos, every earlier version kept, and a way back
-- (Nov 26 2026).
--
-- The setup sheet now saves as it's typed (no Save / Discard), so a change
-- made by accident has to be easy to undo. Every version a save, a restore or
-- a removal replaces is kept in athlete_exercise_setup_revisions (written only
-- by the trigger below), and equipment_setup_restore puts one back. A setup
-- can hold up to 4 photos (photo_paths); photo_path stays the first one, so
-- every reader that knows only it (the coach's workout quick view, older apps)
-- still shows a photo.
--
-- Folding: one editing session is one version. A save by the person who saved
-- the setup last, within 10 minutes of their last save, replaces a state that
-- was itself typed in that session, so it isn't kept again (the version from
-- before the session already is). A save over somebody else's version (the
-- coach's, or the athlete's when the coach edits), a restore and a removal
-- always keep what they replace. An empty setup (nothing typed, no photo)
-- is never a version. At most 30 versions are kept per setup.
--
-- Nothing existing changes: settings, notes and photos stay as they are, the
-- one photo each setup has (none in production on Nov 26 2026) becomes its
-- photo_paths, and the 7-argument equipment_setup_save older apps call still
-- works (the new _photo_paths argument defaults to null and the one photo an
-- older app sends replaces only the first).

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------
ALTER TABLE public.athlete_exercise_setups
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'athlete_exercise_setups_photo_paths_max') THEN
    ALTER TABLE public.athlete_exercise_setups
      ADD CONSTRAINT athlete_exercise_setups_photo_paths_max CHECK (cardinality(photo_paths) <= 4);
  END IF;
END $$;

UPDATE public.athlete_exercise_setups
   SET photo_paths = ARRAY[photo_path]
 WHERE photo_path IS NOT NULL AND cardinality(photo_paths) = 0;

COMMENT ON COLUMN public.athlete_exercise_setups.photo_paths IS
  'The setup''s photos (at most 4, in order). photo_path is always the first (tg_athlete_setup_cover).';

-- photo_path is the first photo, whoever writes the row.
CREATE OR REPLACE FUNCTION public.tg_athlete_setup_cover()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.photo_paths := coalesce(NEW.photo_paths, '{}'::text[]);
  NEW.photo_path := NEW.photo_paths[1];
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_athlete_setup_cover() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS athlete_setup_cover ON public.athlete_exercise_setups;
CREATE TRIGGER athlete_setup_cover
  BEFORE INSERT OR UPDATE ON public.athlete_exercise_setups
  FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_setup_cover();

-- ---------------------------------------------------------------------------
-- Earlier versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_exercise_setup_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the setup it's a version of (kept after the setup itself is removed)
  setup_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL,
  -- the equipment it was on (null: nothing in particular); no foreign key, so
  -- a version outlives equipment that was deleted (it just can't go back on it)
  equipment_id uuid,
  settings jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  photo_paths text[] NOT NULL DEFAULT '{}'::text[],
  -- who wrote this version, and when
  source text NOT NULL DEFAULT 'athlete',
  saved_by uuid,
  saved_at timestamptz,
  -- what replaced it: a save ('edit'), a restore of another version, or the setup being removed
  reason text NOT NULL DEFAULT 'edit' CHECK (reason IN ('edit', 'restore', 'removed')),
  replaced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS athlete_setup_revisions_exercise_idx
  ON public.athlete_exercise_setup_revisions (client_id, exercise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS athlete_setup_revisions_setup_idx
  ON public.athlete_exercise_setup_revisions (setup_id, created_at DESC);

COMMENT ON TABLE public.athlete_exercise_setup_revisions IS
  'Earlier versions of an athlete''s exercise setups (settings, note, photos), kept by tg_athlete_setup_keep_version whenever a save, a restore or a removal replaces one; equipment_setup_restore puts one back. Read by whoever reads the setups; written only by the trigger.';

ALTER TABLE public.athlete_exercise_setup_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Equipment: own" ON public.athlete_exercise_setup_revisions;
CREATE POLICY "Equipment: own" ON public.athlete_exercise_setup_revisions FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Equipment: linked login" ON public.athlete_exercise_setup_revisions;
CREATE POLICY "Equipment: linked login" ON public.athlete_exercise_setup_revisions FOR SELECT TO authenticated
  USING (client_id = (SELECT public.linked_client_id()));
DROP POLICY IF EXISTS "Equipment: coach" ON public.athlete_exercise_setup_revisions;
CREATE POLICY "Equipment: coach" ON public.athlete_exercise_setup_revisions FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Equipment: admin" ON public.athlete_exercise_setup_revisions;
CREATE POLICY "Equipment: admin" ON public.athlete_exercise_setup_revisions FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
REVOKE ALL ON public.athlete_exercise_setup_revisions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.athlete_exercise_setup_revisions FROM authenticated;
GRANT SELECT ON public.athlete_exercise_setup_revisions TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_athlete_setup_keep_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := nullif(current_setting('jf.setup_change', true), '');
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.settings = NEW.settings
     AND OLD.notes IS NOT DISTINCT FROM NEW.notes
     AND OLD.photo_paths = NEW.photo_paths THEN
    RETURN NULL; -- a pick (last_used_at) or a merge, not a change to the setup
  END IF;
  IF OLD.settings = '[]'::jsonb AND OLD.notes IS NULL AND cardinality(OLD.photo_paths) = 0 THEN
    RETURN NULL; -- nothing worth keeping
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- the whole account going (its client record is already gone): nothing to keep it for
    IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.client_id) THEN
      RETURN NULL;
    END IF;
    v_reason := 'removed';
  ELSIF v_reason IS DISTINCT FROM 'restore' THEN
    v_reason := 'edit';
    -- one editing session is one version: the state this save replaces was
    -- typed by the same person moments ago, and the one before it is kept
    IF OLD.updated_by IS NOT DISTINCT FROM auth.uid() AND OLD.updated_at > now() - interval '10 minutes' THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.athlete_exercise_setup_revisions
    (setup_id, client_id, exercise_id, equipment_id, settings, notes, photo_paths,
     source, saved_by, saved_at, reason, replaced_by)
  VALUES (OLD.id, OLD.client_id, OLD.exercise_id, OLD.equipment_id, OLD.settings, OLD.notes, OLD.photo_paths,
          OLD.source, OLD.updated_by, OLD.updated_at, v_reason, auth.uid());

  -- the newest 30 per setup
  DELETE FROM public.athlete_exercise_setup_revisions r
   WHERE r.setup_id = OLD.id
     AND r.id NOT IN (SELECT k.id FROM public.athlete_exercise_setup_revisions k
                       WHERE k.setup_id = OLD.id ORDER BY k.created_at DESC, k.id DESC LIMIT 30);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_athlete_setup_keep_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS athlete_setup_keep_version ON public.athlete_exercise_setups;
CREATE TRIGGER athlete_setup_keep_version
  AFTER UPDATE OR DELETE ON public.athlete_exercise_setups
  FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_setup_keep_version();

-- ---------------------------------------------------------------------------
-- Photos in order, cleaned the way the database keeps them: trimmed, no
-- blanks, no repeats, each in the athlete's own folder, at most 4.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._athlete_setup_clean_photos(_client_id uuid, _paths text[])
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_out text[] := '{}'::text[];
  p text;
BEGIN
  FOREACH p IN ARRAY coalesce(_paths, '{}'::text[]) LOOP
    p := nullif(btrim(coalesce(p, '')), '');
    CONTINUE WHEN p IS NULL OR p = ANY (v_out);
    IF p NOT LIKE _client_id::text || '/%' THEN
      RAISE EXCEPTION 'That photo isn''t theirs' USING ERRCODE = '42501';
    END IF;
    v_out := v_out || p;
  END LOOP;
  IF cardinality(v_out) > 4 THEN
    RAISE EXCEPTION 'A setup holds 4 photos at most' USING ERRCODE = '22023';
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._athlete_setup_clean_photos(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Save (now with photos). The old 7-argument call still matches: _photo_paths
-- defaults to null, and then the one _photo_path sent replaces only the first
-- photo (null: the first photo goes), so an older app never drops the rest.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.equipment_setup_save(uuid, uuid, uuid, jsonb, text, text, boolean);
CREATE OR REPLACE FUNCTION public.equipment_setup_save(
  _client_id uuid,
  _exercise_id uuid,
  _equipment_id uuid DEFAULT NULL,
  _settings jsonb DEFAULT '[]'::jsonb,
  _notes text DEFAULT NULL,
  _photo_path text DEFAULT NULL,
  _make_current boolean DEFAULT false,
  _photo_paths text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings jsonb := public.athlete_setup_clean_settings(_settings);
  v_notes text := nullif(btrim(coalesce(_notes, '')), '');
  v_photo text := nullif(btrim(coalesce(_photo_path, '')), '');
  v_paths text[];
  v_had text[];
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

  IF _photo_paths IS NOT NULL THEN
    v_paths := public._athlete_setup_clean_photos(_client_id, _photo_paths);
  ELSE
    SELECT s.photo_paths INTO v_had FROM public.athlete_exercise_setups s
     WHERE s.client_id = _client_id AND s.exercise_id = _exercise_id
       AND s.equipment_id IS NOT DISTINCT FROM _equipment_id;
    v_had := coalesce(v_had, '{}'::text[]);
    v_paths := public._athlete_setup_clean_photos(
      _client_id,
      CASE WHEN v_photo IS NULL THEN v_had[2:] ELSE ARRAY[v_photo] || v_had[2:] END
    );
  END IF;

  v_source := public._equipment_source(_client_id);
  v_current := coalesce(_make_current, false) OR NOT EXISTS (
    SELECT 1 FROM public.athlete_exercise_setups s
     WHERE s.client_id = _client_id AND s.exercise_id = _exercise_id AND s.last_used_at IS NOT NULL
  );

  -- one statement, so a pick made a moment earlier (equipment_choose) never races it
  INSERT INTO public.athlete_exercise_setups AS s
    (client_id, exercise_id, equipment_id, settings, notes, photo_paths, source, updated_by, last_used_at)
  VALUES (_client_id, _exercise_id, _equipment_id, v_settings, v_notes, v_paths, v_source, auth.uid(),
          CASE WHEN v_current THEN clock_timestamp() END)
  ON CONFLICT (client_id, exercise_id, (coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET settings = EXCLUDED.settings, notes = EXCLUDED.notes, photo_paths = EXCLUDED.photo_paths,
                source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now(),
                last_used_at = CASE WHEN v_current THEN clock_timestamp() ELSE s.last_used_at END
  RETURNING * INTO v_row;
  IF v_current AND _equipment_id IS NOT NULL THEN
    UPDATE public.athlete_equipment SET last_used_at = clock_timestamp() WHERE id = _equipment_id;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- Put an earlier version back (on the equipment it was on). What it replaces
-- is kept as a version too, so a restore can itself be undone. A version on
-- equipment that's since been deleted can't come back; on retired equipment
-- it can (and stays on the retired equipment, which is never current).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_setup_restore(_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.athlete_exercise_setup_revisions;
  v_source text;
  v_current boolean;
  v_row public.athlete_exercise_setups;
BEGIN
  SELECT * INTO r FROM public.athlete_exercise_setup_revisions WHERE id = _revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That version isn''t there any more' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._equipment_assert(r.client_id);
  IF NOT EXISTS (SELECT 1 FROM public.exercises x WHERE x.id = r.exercise_id) THEN
    RAISE EXCEPTION 'That exercise isn''t in the library any more' USING ERRCODE = 'P0002';
  END IF;
  IF r.equipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.athlete_equipment e WHERE e.id = r.equipment_id AND e.client_id = r.client_id
  ) THEN
    RAISE EXCEPTION 'That equipment was deleted, so this version can''t go back on it' USING ERRCODE = 'P0002';
  END IF;

  v_source := public._equipment_source(r.client_id);
  v_current := NOT EXISTS (
    SELECT 1 FROM public.athlete_exercise_setups s
     WHERE s.client_id = r.client_id AND s.exercise_id = r.exercise_id AND s.last_used_at IS NOT NULL
  );
  PERFORM set_config('jf.setup_change', 'restore', true);
  INSERT INTO public.athlete_exercise_setups AS s
    (client_id, exercise_id, equipment_id, settings, notes, photo_paths, source, updated_by, last_used_at)
  VALUES (r.client_id, r.exercise_id, r.equipment_id, public.athlete_setup_clean_settings(r.settings), r.notes,
          public._athlete_setup_clean_photos(r.client_id, r.photo_paths), v_source, auth.uid(),
          CASE WHEN v_current THEN clock_timestamp() END)
  ON CONFLICT (client_id, exercise_id, (coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET settings = EXCLUDED.settings, notes = EXCLUDED.notes, photo_paths = EXCLUDED.photo_paths,
                source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING * INTO v_row;
  PERFORM set_config('jf.setup_change', '', true);
  RETURN to_jsonb(v_row);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.equipment_setup_save(uuid, uuid, uuid, jsonb, text, text, boolean, text[])',
    'public.equipment_setup_restore(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- A merged duplicate exercise's setups (and now their versions) move to the
-- exercise it was merged into.
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
  UPDATE public.athlete_exercise_setup_revisions SET exercise_id = NEW.canonical_id WHERE exercise_id = NEW.duplicate_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_exercise_merge_athlete_setups() FROM PUBLIC, anon, authenticated;
