-- Program imports (Nov 21 2026): a person brings a program they already have
-- (a spreadsheet, a document, a PDF, photos or pasted text) and it becomes a
-- program of their own in the app, the same athlete_programs plan the builder
-- writes, private until they choose to share it.
--
-- The phone reads spreadsheets, documents and text itself (no upload); a PDF
-- or photos go to the private program-imports bucket under the person's own
-- folder, for the server's AI to read. One row per import:
--   * the person confirms they made the program or may use it
--     (rights_confirmed_at + the exact words they agreed to);
--   * the server writes the row after its own checks (no client policies for
--     writes); the person reads their own rows;
--   * an AI read is queued ('pending'), woken by program_imports_queue_run and
--     a pg_cron catch-up, and runs in the background (program-imports-tick
--     hook), so closing the app never loses it; it costs AI credits
--     (ai_credit_cost 'program_import'), given back if it fails;
--   * files are deleted from storage as soon as the import is saved or
--     discarded, and in any case 7 days after upload; after 30 days an
--     import that wasn't saved is deleted, and a saved one keeps only its
--     record (the rights confirmation and the program it made), its text and
--     read cleared. The saved program stays.

CREATE TABLE IF NOT EXISTS public.program_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('text', 'csv', 'xlsx', 'docx', 'pdf', 'image')),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  file_paths text[] NOT NULL DEFAULT '{}',
  file_bytes bigint,
  -- what the phone read out of a spreadsheet / document / paste (an AI read is checked against it)
  source_text text CHECK (source_text IS NULL OR char_length(source_text) <= 150000),
  rights_confirmed_at timestamptz NOT NULL,
  rights_text text NOT NULL CHECK (char_length(rights_text) BETWEEN 20 AND 600),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reading', 'ready', 'failed', 'saved', 'discarded')),
  method text CHECK (method IS NULL OR method IN ('parsed', 'ai')),
  -- the program as read (ImportedProgram, src/lib/program-import/types.ts)
  result jsonb,
  -- the AI call in flight (staged-call.server.ts): prompts, answers, the call being polled
  progress jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  credit_use_id uuid,
  model text,
  program_id uuid REFERENCES public.athlete_programs(id) ON DELETE SET NULL,
  files_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS program_imports_user_idx ON public.program_imports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS program_imports_queue_idx ON public.program_imports (updated_at)
  WHERE status IN ('pending', 'reading');
CREATE INDEX IF NOT EXISTS program_imports_files_idx ON public.program_imports (created_at)
  WHERE files_deleted_at IS NULL AND cardinality(file_paths) > 0;
CREATE INDEX IF NOT EXISTS program_imports_program_idx ON public.program_imports (program_id) WHERE program_id IS NOT NULL;

ALTER TABLE public.program_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own program imports read" ON public.program_imports;
CREATE POLICY "Own program imports read" ON public.program_imports
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- written only by the server, after its own checks
REVOKE INSERT, UPDATE, DELETE ON public.program_imports FROM anon, authenticated;
GRANT SELECT ON public.program_imports TO authenticated;

COMMENT ON TABLE public.program_imports IS
  'A program a person imported from their own file or text (src/lib/program-import). Private to them; written by the server; files kept at most 7 days, the text and read 30 (a saved import keeps its rights record).';

-- ---------------------------------------------------------------------------
-- The files: private, the person's own folder only (<user id>/<import>/<file>).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('program-imports', 'program-imports', false, 26214400,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "program imports own insert" ON storage.objects;
CREATE POLICY "program imports own insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'program-imports' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "program imports own read" ON storage.objects;
CREATE POLICY "program imports own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'program-imports' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "program imports own delete" ON storage.objects;
CREATE POLICY "program imports own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'program-imports' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- ---------------------------------------------------------------------------
-- AI credits: an AI read of a program costs 10 (given back if it fails).
-- Mirrors FEATURE_COSTS in src/lib/ai-credits/packs.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_credit_cost(_feature text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _feature
    WHEN 'meal_estimate' THEN 1
    WHEN 'program_import' THEN 10
    ELSE NULL
  END
$$;

-- The person's credit state lists what each AI feature costs (the import screen says it).
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
      'program_import', public.ai_credit_cost('program_import'))
  );
END $$;

-- ---------------------------------------------------------------------------
-- The queue: an import waiting on AI wakes the hook at once; pg_cron catches
-- anything it missed (and a read cut off mid-way), and clears out old files.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.program_imports_queue_run()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.status = 'pending'
     AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'pending' OR old.updated_at IS DISTINCT FROM new.updated_at) THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-imports-tick',
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
REVOKE ALL ON FUNCTION public.program_imports_queue_run() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS program_imports_queue_run ON public.program_imports;
CREATE TRIGGER program_imports_queue_run
  AFTER INSERT OR UPDATE OF status, updated_at ON public.program_imports
  FOR EACH ROW EXECUTE FUNCTION public.program_imports_queue_run();

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'program-imports-tick';
  PERFORM cron.schedule(
    'program-imports-tick',
    '*/3 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-imports-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) AS request_id
    WHERE EXISTS (
      SELECT 1 FROM public.program_imports
       WHERE (status = 'pending' AND updated_at > now() - interval '2 days')
          OR (status = 'reading' AND updated_at < now() - interval '4 minutes' AND updated_at > now() - interval '2 days')
          OR (files_deleted_at IS NULL AND cardinality(file_paths) > 0
              AND (status IN ('saved', 'discarded') OR created_at < now() - interval '7 days'))
          OR (created_at < now() - interval '30 days'
              AND (status <> 'saved' OR source_text IS NOT NULL OR result IS NOT NULL))
    );
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function THEN
    NULL;
END
$$;
