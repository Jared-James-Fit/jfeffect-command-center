-- Nutrition Studio phase 2 (Nov 22 2026): meal plans brought in from somewhere
-- else, as a draft the person edits in the Studio before anything is saved.
--
--   import  a meal plan someone already has (pasted text, a .txt / .csv /
--           .xlsx / .docx the phone reads, or a PDF or 1-8 photos). The app's
--           own reader goes first (free); an AI read, only when it can't,
--           copies the plan into the app's meal-plan text and never invents.
--           The person ticks a rights confirmation first (its exact words and
--           the time are kept here). A JF member's (in their Studio) or a
--           coach's (the plan editor's Import a file).
--   create  Create with Cleo: a JF member's draft from a few answers, written
--           to their own saved targets (never targets a model decides), after
--           a safety screen in code.
--
-- One row per import:
--   * the server writes the row after its own checks (no client policies for
--     writes); the person reads their own rows;
--   * an AI read or draft is queued ('pending'), woken by
--     nutrition_imports_queue_run and a pg_cron catch-up, and runs in the
--     background (the nutrition-imports-tick hook), so closing the app never
--     loses it; a member's costs AI credits (ai_credit_cost 'nutrition_import'
--     / 'nutrition_create'), given back if it fails or is cancelled; a staff
--     member's is never charged (ai_credits_use: staff are unmetered);
--   * the files sit in the private nutrition-imports bucket under the
--     person's own folder and are deleted when the import is saved or
--     discarded, and 7 days after upload either way (a saved import's
--     original is filed in their documents first, documents library); after
--     30 days an import that wasn't saved is deleted, and a saved one keeps
--     only its record (the rights confirmation and when), its text, answers
--     and read cleared.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.nutrition_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('import', 'create')),
  -- a member's own (their Studio) or a staff member's (the coach's plan editor)
  audience text NOT NULL DEFAULT 'member' CHECK (audience IN ('member', 'staff')),
  source_kind text NOT NULL CHECK (source_kind IN ('text', 'csv', 'xlsx', 'docx', 'pdf', 'image', 'answers')),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  file_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(file_paths) <= 8),
  file_bytes bigint CHECK (file_bytes IS NULL OR file_bytes >= 0),
  -- what the phone read out of a paste / spreadsheet / document (an AI read is checked against it)
  source_text text CHECK (source_text IS NULL OR char_length(source_text) <= 100000),
  -- Create with Cleo: the answers and the targets snapshot the draft is written to
  answers jsonb,
  rights_confirmed_at timestamptz,
  rights_text text CHECK (rights_text IS NULL OR char_length(rights_text) BETWEEN 20 AND 600),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reading', 'ready', 'failed', 'saved', 'discarded')),
  method text CHECK (method IS NULL OR method IN ('parsed', 'ai')),
  -- the plan as read or written ({ text, flags, transcript }, src/lib/nutrition-import/types.ts)
  result jsonb,
  -- the AI calls in flight (staged-call.server.ts): answers kept, the call being polled
  progress jsonb,
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  attempts integer NOT NULL DEFAULT 0,
  credit_use_id uuid,
  model text,
  -- the plan it became (a member's) and the document its original was filed as
  saved_target_id uuid REFERENCES public.nutrition_targets(id) ON DELETE SET NULL,
  document_ids uuid[] NOT NULL DEFAULT '{}',
  files_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- an import is never read before its rights were confirmed
  CONSTRAINT nutrition_imports_rights CHECK (kind <> 'import' OR (rights_confirmed_at IS NOT NULL AND rights_text IS NOT NULL)),
  -- a draft is written from answers, only for a member
  CONSTRAINT nutrition_imports_create CHECK (kind <> 'create' OR (source_kind = 'answers' AND answers IS NOT NULL AND audience = 'member')),
  CONSTRAINT nutrition_imports_answers CHECK (kind = 'create' OR source_kind <> 'answers')
);

CREATE INDEX IF NOT EXISTS nutrition_imports_user_idx ON public.nutrition_imports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nutrition_imports_queue_idx ON public.nutrition_imports (updated_at)
  WHERE status IN ('pending', 'reading');
CREATE INDEX IF NOT EXISTS nutrition_imports_files_idx ON public.nutrition_imports (created_at)
  WHERE files_deleted_at IS NULL AND cardinality(file_paths) > 0;

ALTER TABLE public.nutrition_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own nutrition imports read" ON public.nutrition_imports;
CREATE POLICY "Own nutrition imports read" ON public.nutrition_imports
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- written only by the server, after its own checks
REVOKE ALL ON public.nutrition_imports FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.nutrition_imports FROM authenticated;
GRANT SELECT ON public.nutrition_imports TO authenticated;
GRANT ALL ON public.nutrition_imports TO service_role;

COMMENT ON TABLE public.nutrition_imports IS
  'A meal plan brought into the Nutrition Studio (src/lib/nutrition-import): imported from someone''s own file or text, or drafted by Cleo from a member''s answers. Private to them; written by the server; files kept at most 7 days, the text and read 30 (a saved import keeps its rights record).';

-- ---------------------------------------------------------------------------
-- The files: private, the person's own folder only (<user id>/<import>/<file>).
-- The original of a file the phone read itself is kept here too, so a saved
-- import can file it in their documents.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nutrition-imports', 'nutrition-imports', false, 26214400,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "nutrition imports own insert" ON storage.objects;
CREATE POLICY "nutrition imports own insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nutrition-imports' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "nutrition imports own read" ON storage.objects;
CREATE POLICY "nutrition imports own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nutrition-imports' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "nutrition imports own delete" ON storage.objects;
CREATE POLICY "nutrition imports own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nutrition-imports' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- ---------------------------------------------------------------------------
-- AI credits: an AI read of a meal plan costs 5, a Cleo draft 10 (given back
-- if it fails). Mirrors FEATURE_COSTS in src/lib/ai-credits/packs.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_credit_cost(_feature text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _feature
    WHEN 'meal_estimate' THEN 1
    WHEN 'program_import' THEN 10
    WHEN 'nutrition_import' THEN 5
    WHEN 'nutrition_create' THEN 10
    ELSE NULL
  END
$$;

-- The person's credit state lists what each AI feature costs (the import and Cleo screens say it).
CREATE OR REPLACE FUNCTION public.ai_credit_state(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t text := public.ai_credit_tier(_user);
  allowance int := public.ai_credit_allowance(_user);
  p date := public.ai_credit_period_start();
  w public.ai_credit_wallets;
  used int := 0;
  extra int := 0;
  free_left int;
BEGIN
  SELECT * INTO w FROM public.ai_credit_wallets WHERE user_id = _user;
  IF FOUND THEN
    extra := w.extra;
    IF w.period_start = p THEN used := w.period_used; END IF;
  END IF;
  free_left := CASE WHEN allowance IS NULL THEN NULL ELSE greatest(allowance - used, 0) END;
  RETURN jsonb_build_object(
    'tier', t,
    'unlimited', allowance IS NULL,
    'allowance', allowance,
    'used', used,
    'allowance_left', free_left,
    'extra', extra,
    'left', CASE WHEN allowance IS NULL THEN NULL ELSE free_left + extra END,
    'period_start', p,
    'resets_on', (p + interval '1 month')::date,
    'costs', jsonb_build_object(
      'meal_estimate', public.ai_credit_cost('meal_estimate'),
      'program_import', public.ai_credit_cost('program_import'),
      'nutrition_import', public.ai_credit_cost('nutrition_import'),
      'nutrition_create', public.ai_credit_cost('nutrition_create'))
  );
END $$;

-- ---------------------------------------------------------------------------
-- The queue: an import waiting on AI wakes the hook at once; pg_cron catches
-- anything it missed (and a read cut off mid-way), and clears out old files.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nutrition_imports_queue_run()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.status = 'pending'
     AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'pending' OR old.updated_at IS DISTINCT FROM new.updated_at) THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/nutrition-imports-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
        ),
        body := jsonb_build_object('importId', new.id),
        timeout_milliseconds := 300000
      );
    EXCEPTION WHEN others THEN
      -- never fail the write that queued it; the cron picks it up
      NULL;
    END;
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.nutrition_imports_queue_run() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nutrition_imports_queue_run ON public.nutrition_imports;
CREATE TRIGGER nutrition_imports_queue_run
  AFTER INSERT OR UPDATE OF status, updated_at ON public.nutrition_imports
  FOR EACH ROW EXECUTE FUNCTION public.nutrition_imports_queue_run();

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nutrition-imports-tick';
  PERFORM cron.schedule(
    'nutrition-imports-tick',
    '*/3 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/nutrition-imports-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) AS request_id
    WHERE EXISTS (
      SELECT 1 FROM public.nutrition_imports
       WHERE (status = 'pending' AND updated_at > now() - interval '2 days')
          OR (status = 'reading' AND updated_at < now() - interval '4 minutes' AND updated_at > now() - interval '2 days')
          OR (files_deleted_at IS NULL AND cardinality(file_paths) > 0
              AND (status IN ('saved', 'discarded') OR created_at < now() - interval '7 days'))
          OR (created_at < now() - interval '30 days'
              AND (status <> 'saved' OR source_text IS NOT NULL OR result IS NOT NULL OR answers IS NOT NULL))
    );
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END
$$;
