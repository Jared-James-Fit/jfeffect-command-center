-- Program drafts and version history (Nov 24 2026).
--
--   * athlete_program_drafts: the builder's unsaved work, kept on the server a
--     beat after every edit so it follows the person to another device and
--     survives a lost phone. One per login per program (program_id null = a new
--     program not saved yet). Own rows only; a draft never touches the program
--     itself (nothing reaches a running program until Save).
--   * athlete_program_versions: every saved state of a program, written by the
--     database on every insert and plan / name change, never by the app, so no
--     save can skip it. Saves by the same person within VERSION_COALESCE_S of
--     each other fold into one checkpoint (a burst of saves is one version, never
--     one per keystroke); a named checkpoint is never folded or trimmed. Restoring
--     loads an old version into the builder and saving it makes a new version
--     (tagged 'restore'), so later history is never lost. The owner reads their
--     own programs' versions; admins read all.
--   * athlete_program_version_tag(): says where the newest version came from
--     (an import, a restore, a crew copy) right after the save that made it.
--   * athlete_program_version_name(): names (or un-names) a checkpoint.

SET lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_program_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id uuid REFERENCES public.athlete_programs(id) ON DELETE CASCADE,
  -- { title, description, goal, level, plan }
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object' AND octet_length(draft::text) <= 1500000),
  -- the program's updated_at the draft started from (null for a new program)
  base text,
  title text GENERATED ALWAYS AS (left(coalesce(draft ->> 'title', ''), 80)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athlete_program_drafts_one
  ON public.athlete_program_drafts (user_id, (coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid)));
CREATE INDEX IF NOT EXISTS athlete_program_drafts_user_idx ON public.athlete_program_drafts (user_id, updated_at DESC);

ALTER TABLE public.athlete_program_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.athlete_program_drafts FROM anon;
GRANT SELECT, DELETE ON public.athlete_program_drafts TO authenticated;
GRANT ALL ON public.athlete_program_drafts TO service_role;

DROP POLICY IF EXISTS "Own program drafts read" ON public.athlete_program_drafts;
CREATE POLICY "Own program drafts read" ON public.athlete_program_drafts FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Own program drafts delete" ON public.athlete_program_drafts;
CREATE POLICY "Own program drafts delete" ON public.athlete_program_drafts FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

/** Keeps the builder's draft for the caller (one per program, null = a new one). Returns when it was kept. */
CREATE OR REPLACE FUNCTION public.athlete_program_draft_put(_program_id uuid, _draft jsonb, _base text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _draft IS NULL OR jsonb_typeof(_draft) <> 'object' THEN
    RAISE EXCEPTION 'Nothing to keep' USING ERRCODE = '22023';
  END IF;
  -- a draft of someone else's program is never kept
  IF _program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.athlete_programs WHERE id = _program_id AND owner_id = v_uid AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.athlete_program_drafts
     WHERE user_id = v_uid AND program_id IS NOT DISTINCT FROM _program_id
  ) AND (SELECT count(*) FROM public.athlete_program_drafts WHERE user_id = v_uid) >= 30 THEN
    -- the oldest goes first: a person never collects drafts without end
    DELETE FROM public.athlete_program_drafts
     WHERE id = (SELECT id FROM public.athlete_program_drafts WHERE user_id = v_uid ORDER BY updated_at LIMIT 1);
  END IF;
  INSERT INTO public.athlete_program_drafts (user_id, program_id, draft, base, updated_at)
  VALUES (v_uid, _program_id, _draft, _base, v_at)
  ON CONFLICT (user_id, (coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET draft = EXCLUDED.draft, base = EXCLUDED.base, updated_at = EXCLUDED.updated_at;
  RETURN v_at;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_draft_put(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_draft_put(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.athlete_programs(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  title text NOT NULL,
  description text,
  plan jsonb,
  -- where it came from: create (the first save), save, import, restore, copy,
  -- cleo, baseline (the state on the day history started being kept)
  source text NOT NULL DEFAULT 'save'
    CHECK (source IN ('create', 'save', 'import', 'restore', 'copy', 'cleo', 'baseline')),
  restored_from integer,
  label text CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 80),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, version_no)
);
CREATE INDEX IF NOT EXISTS athlete_program_versions_program_idx
  ON public.athlete_program_versions (program_id, version_no DESC);

ALTER TABLE public.athlete_program_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.athlete_program_versions FROM anon;
GRANT SELECT ON public.athlete_program_versions TO authenticated;
GRANT ALL ON public.athlete_program_versions TO service_role;

/** The caller's own programs, as a set (read once per query). */
CREATE OR REPLACE FUNCTION public.my_athlete_program_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM public.athlete_programs WHERE owner_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.my_athlete_program_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_athlete_program_ids() TO authenticated;

DROP POLICY IF EXISTS "Own program versions" ON public.athlete_program_versions;
CREATE POLICY "Own program versions" ON public.athlete_program_versions FOR SELECT TO authenticated
  USING (
    program_id IN (SELECT public.my_athlete_program_ids())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  );

/**
 * Every saved state, written here and only here. A save by the same person
 * within 3 minutes of their last unnamed 'save' / 'create' version folds into
 * it (one checkpoint for a burst of saves); otherwise a new version. Only the
 * newest 150 unnamed versions are kept per program.
 */
CREATE OR REPLACE FUNCTION public.tg_athlete_program_keep_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := coalesce(auth.uid(), NEW.owner_id);
  v_source text := nullif(current_setting('jf.program_version_source', true), '');
  v_last public.athlete_program_versions%ROWTYPE;
  v_no integer;
BEGIN
  IF NEW.plan IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.plan IS NOT DISTINCT FROM OLD.plan
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;
  END IF;
  IF v_source IS NULL OR v_source NOT IN ('create', 'save', 'import', 'restore', 'copy', 'cleo') THEN
    v_source := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'save' END;
  END IF;

  SELECT * INTO v_last FROM public.athlete_program_versions
   WHERE program_id = NEW.id ORDER BY version_no DESC LIMIT 1;

  IF FOUND AND v_source = 'save' AND v_last.source IN ('save', 'create')
     AND v_last.label IS NULL AND v_last.created_by IS NOT DISTINCT FROM v_uid
     AND v_last.updated_at > now() - interval '3 minutes' THEN
    UPDATE public.athlete_program_versions
       SET title = NEW.title, description = NEW.description, plan = NEW.plan, updated_at = now()
     WHERE id = v_last.id;
    RETURN NEW;
  END IF;

  v_no := coalesce(v_last.version_no, 0) + 1;
  INSERT INTO public.athlete_program_versions (program_id, version_no, title, description, plan, source, created_by)
  VALUES (NEW.id, v_no, NEW.title, NEW.description, NEW.plan, v_source, v_uid);

  DELETE FROM public.athlete_program_versions
   WHERE program_id = NEW.id AND label IS NULL AND version_no > 1
     AND version_no <= v_no - 150;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS athlete_program_keep_version ON public.athlete_programs;
CREATE TRIGGER athlete_program_keep_version
  AFTER INSERT OR UPDATE OF plan, title, description ON public.athlete_programs
  FOR EACH ROW EXECUTE FUNCTION public.tg_athlete_program_keep_version();

/** Says where the caller's newest version of a program came from (right after the save that made it). */
CREATE OR REPLACE FUNCTION public.athlete_program_version_tag(_program_id uuid, _source text, _restored_from integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_no integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _source NOT IN ('import', 'restore', 'copy', 'cleo') THEN
    RAISE EXCEPTION 'Unknown source' USING ERRCODE = '22023';
  END IF;
  SELECT v.id, v.version_no INTO v_id, v_no
    FROM public.athlete_program_versions v
    JOIN public.athlete_programs p ON p.id = v.program_id AND p.owner_id = v_uid
   WHERE v.program_id = _program_id AND v.created_by = v_uid AND v.updated_at > now() - interval '5 minutes'
   ORDER BY v.version_no DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.athlete_program_versions
     SET source = _source,
         restored_from = CASE WHEN _source = 'restore' THEN _restored_from ELSE restored_from END
   WHERE id = v_id;
  RETURN v_no;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_version_tag(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_version_tag(uuid, text, integer) TO authenticated;

/** Names a checkpoint (null or blank takes the name off). The owner only. */
CREATE OR REPLACE FUNCTION public.athlete_program_version_name(_version_id uuid, _label text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.athlete_program_versions v
     SET label = nullif(left(btrim(coalesce(_label, '')), 80), '')
    FROM public.athlete_programs p
   WHERE v.id = _version_id AND p.id = v.program_id AND p.owner_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_version_name(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_version_name(uuid, text) TO authenticated;

-- The state every program is in today is its first version ("when history started").
INSERT INTO public.athlete_program_versions (program_id, version_no, title, description, plan, source, created_by, created_at, updated_at)
SELECT p.id, 1, p.title, p.description, p.plan, 'baseline', p.owner_id, p.updated_at, p.updated_at
  FROM public.athlete_programs p
 WHERE p.plan IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.athlete_program_versions v WHERE v.program_id = p.id);

-- ---------------------------------------------------------------------------
-- Block colours: muted violet (Strength) and amber (Intensification) join the swatches
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.program_block_types') IS NOT NULL THEN
    ALTER TABLE public.program_block_types DROP CONSTRAINT IF EXISTS program_block_types_color_check;
    ALTER TABLE public.program_block_types ADD CONSTRAINT program_block_types_color_check
      CHECK (color IN ('slate', 'stone', 'sky', 'blue', 'violet', 'cyan', 'teal', 'emerald', 'lime', 'yellow', 'amber', 'orange', 'rose', 'pink'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Program template versions (the coach's library builder)
-- ---------------------------------------------------------------------------
-- Every saved state of a template's training (its payload), written by the
-- database. The editor saves as the coach types, so saves by the same person
-- within 10 minutes fold into one checkpoint (never a version a keystroke);
-- a named one is never folded or trimmed; the newest 150 unnamed are kept.
-- Whoever can read the template reads its versions (the template's own rules).
CREATE TABLE IF NOT EXISTS public.pl_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.pl_templates(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  name text,
  payload jsonb NOT NULL,
  payload_revision bigint,
  source text NOT NULL DEFAULT 'save' CHECK (source IN ('create', 'save', 'restore', 'cleo', 'baseline')),
  restored_from integer,
  label text CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 80),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_no)
);
CREATE INDEX IF NOT EXISTS pl_template_versions_template_idx
  ON public.pl_template_versions (template_id, version_no DESC);

ALTER TABLE public.pl_template_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_template_versions FROM anon;
GRANT SELECT ON public.pl_template_versions TO authenticated;
GRANT ALL ON public.pl_template_versions TO service_role;

DROP POLICY IF EXISTS "Template versions follow the template" ON public.pl_template_versions;
CREATE POLICY "Template versions follow the template" ON public.pl_template_versions FOR SELECT TO authenticated
  USING (template_id IN (SELECT id FROM public.pl_templates));

CREATE OR REPLACE FUNCTION public.tg_pl_template_keep_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_source text := nullif(current_setting('jf.template_version_source', true), '');
  v_last public.pl_template_versions%ROWTYPE;
  v_no integer;
BEGIN
  IF NEW.payload IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.payload IS NOT DISTINCT FROM OLD.payload THEN RETURN NEW; END IF;
  IF v_source IS NULL OR v_source NOT IN ('create', 'save', 'restore', 'cleo') THEN
    v_source := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'save' END;
  END IF;
  SELECT * INTO v_last FROM public.pl_template_versions
   WHERE template_id = NEW.id ORDER BY version_no DESC LIMIT 1;
  IF FOUND AND v_source = 'save' AND v_last.source IN ('save', 'create')
     AND v_last.label IS NULL AND v_last.created_by IS NOT DISTINCT FROM v_uid
     AND v_last.updated_at > now() - interval '10 minutes' THEN
    UPDATE public.pl_template_versions
       SET payload = NEW.payload, name = NEW.name, payload_revision = NEW.payload_revision, updated_at = now()
     WHERE id = v_last.id;
    RETURN NEW;
  END IF;
  v_no := coalesce(v_last.version_no, 0) + 1;
  INSERT INTO public.pl_template_versions (template_id, version_no, name, payload, payload_revision, source, created_by)
  VALUES (NEW.id, v_no, NEW.name, NEW.payload, NEW.payload_revision, v_source, v_uid);
  DELETE FROM public.pl_template_versions
   WHERE template_id = NEW.id AND label IS NULL AND version_no > 1 AND version_no <= v_no - 150;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_template_keep_version ON public.pl_templates;
CREATE TRIGGER pl_template_keep_version
  AFTER INSERT OR UPDATE OF payload ON public.pl_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_template_keep_version();

/** Says the caller's newest version of a template was a restore (or Cleo's), right after the save that made it. */
CREATE OR REPLACE FUNCTION public.pl_template_version_tag(_template_id uuid, _source text, _restored_from integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_no integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _source NOT IN ('restore', 'cleo') THEN RAISE EXCEPTION 'Unknown source' USING ERRCODE = '22023'; END IF;
  SELECT id, version_no INTO v_id, v_no FROM public.pl_template_versions
   WHERE template_id = _template_id AND created_by = v_uid AND updated_at > now() - interval '5 minutes'
   ORDER BY version_no DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.pl_template_versions
     SET source = _source, restored_from = CASE WHEN _source = 'restore' THEN _restored_from ELSE restored_from END
   WHERE id = v_id;
  RETURN v_no;
END;
$$;
REVOKE ALL ON FUNCTION public.pl_template_version_tag(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_template_version_tag(uuid, text, integer) TO authenticated;

/** Names a template checkpoint: whoever may edit the template (an admin, or its owner). */
CREATE OR REPLACE FUNCTION public.pl_template_version_name(_version_id uuid, _label text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.pl_template_versions v
     SET label = nullif(left(btrim(coalesce(_label, '')), 80), '')
    FROM public.pl_templates t
   WHERE v.id = _version_id AND t.id = v.template_id
     AND (t.owner_user_id = v_uid OR public.has_role(v_uid, 'admin'::app_role));
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pl_template_version_name(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_template_version_name(uuid, text) TO authenticated;

INSERT INTO public.pl_template_versions (template_id, version_no, name, payload, payload_revision, source, created_by, created_at, updated_at)
SELECT t.id, 1, t.name, t.payload, t.payload_revision, 'baseline', t.owner_user_id, t.updated_at, t.updated_at
  FROM public.pl_templates t
 WHERE t.payload IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.pl_template_versions v WHERE v.template_id = t.id);
