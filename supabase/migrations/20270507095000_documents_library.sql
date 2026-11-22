-- Documents: a private library per person (Nov 22 2026, src/lib/documents).
--
-- Files people upload (a program they follow, a meal plan, a doctor's note),
-- and records other features file for them (the original of an imported meal
-- plan or program, through recordDocument in documents.server.ts). One row per
-- file, the file itself in the private `documents` bucket under the uploader's
-- own folder: <owner_user_id>/<uuid>-<safe name>.
--
-- Who reads a row (RLS, the user checked once per query):
--   * its owner, always (their Recently deleted too);
--   * visibility 'client' (a coach saved it for a client): that client too;
--   * visibility 'coach' or 'client': the client's assigned coach
--     (coached_client_ids()) and admins;
--   * nobody else, and never a 'private' row but its owner's.
-- A staff member's own documents (no client) are always private.
--
-- Who writes: the owner only. A person files a document for themselves, a
-- coach for an assigned client, an admin for any client; only the server files
-- imports and exports or links a document to a record. The file must already
-- be in the uploader's own folder: its size and type are read from storage,
-- never taken from the caller. Only the name, category, tags, who can see it
-- and deleting / restoring change after that (documents_guard). Deleting is a
-- 30-day Recently deleted; the documents-purge hook deletes for good after.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  file_path text NOT NULL,
  mime text NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'upload',
  linked_kind text,
  linked_id uuid,
  visibility text NOT NULL DEFAULT 'private',
  rights_confirmed_at timestamptz,
  rights_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT documents_file_path_key UNIQUE (file_path),
  CONSTRAINT documents_category_check CHECK (category IN
    ('training_program', 'nutrition_plan', 'recipe', 'checkin_report', 'client_document', 'template', 'other')),
  CONSTRAINT documents_source_check CHECK (source IN ('upload', 'import', 'export')),
  CONSTRAINT documents_visibility_check CHECK (visibility IN ('private', 'coach', 'client')),
  -- a document with no client (a staff member's own) is theirs alone
  CONSTRAINT documents_own_is_private CHECK (client_id IS NOT NULL OR visibility = 'private'),
  CONSTRAINT documents_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT documents_tags_check CHECK (cardinality(tags) <= 10),
  CONSTRAINT documents_bytes_check CHECK (bytes BETWEEN 0 AND 26214400),
  CONSTRAINT documents_mime_check CHECK (mime IN (
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain')),
  CONSTRAINT documents_linked_check CHECK ((linked_kind IS NULL) = (linked_id IS NULL)
    AND (linked_kind IS NULL OR linked_kind ~ '^[a-z][a-z_]{0,39}$')),
  -- an upload always says the person confirmed they may upload it
  CONSTRAINT documents_rights_check CHECK (source <> 'upload'
    OR (rights_confirmed_at IS NOT NULL AND rights_text IS NOT NULL)),
  CONSTRAINT documents_rights_text_check CHECK (rights_text IS NULL OR char_length(rights_text) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS documents_owner_idx ON public.documents (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_client_idx ON public.documents (client_id, created_at DESC)
  WHERE client_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_deleted_idx ON public.documents (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_linked_idx ON public.documents (linked_kind, linked_id) WHERE linked_id IS NOT NULL;

COMMENT ON TABLE public.documents IS
  'A person''s documents (src/lib/documents): their uploads and originals other features file for them. Files in the private documents bucket under the uploader''s folder. RLS: the owner; a client sees what a coach saved for them (visibility client); their assigned coach and admins see coach / client ones. Deleted rows wait 30 days (documents-purge).';

-- ---------------------------------------------------------------------------
-- Tags: trimmed, one space, no leading #, at most 30 characters, each once
-- (case-insensitive, the first spelling kept), at most 10. cleanTags in
-- documents.ts is the same rule (documents.test.ts and the SQL tests share cases).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.documents_clean_tags(_tags text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(t ORDER BY first), '{}'::text[])
    FROM (
      SELECT t, first FROM (
        SELECT DISTINCT ON (lower(t)) t, first
          FROM (
            SELECT left(btrim(regexp_replace(regexp_replace(x, '^\s*#+', ''), '\s+', ' ', 'g')), 30) AS t, ord AS first
              FROM unnest(coalesce(_tags, '{}'::text[])) WITH ORDINALITY AS u(x, ord)
          ) raw
         WHERE t <> ''
         ORDER BY lower(t), first
      ) uniq
      ORDER BY first
      LIMIT 10
    ) kept
$$;

-- The client records that are the signed-in person's own (a member or a coaching client).
CREATE OR REPLACE FUNCTION public.documents_own_client_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id FROM public.clients c WHERE c.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.documents_own_client_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.documents_own_client_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- The guard: what a person may set, and the file's facts from storage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.documents_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();  -- null for the server (service role, jobs)
  _meta jsonb;
  _found boolean;
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF _uid IS NOT NULL THEN
      IF new.id IS DISTINCT FROM old.id
         OR new.owner_user_id IS DISTINCT FROM old.owner_user_id
         OR new.client_id IS DISTINCT FROM old.client_id
         OR new.file_path IS DISTINCT FROM old.file_path
         OR new.mime IS DISTINCT FROM old.mime
         OR new.bytes IS DISTINCT FROM old.bytes
         OR new.source IS DISTINCT FROM old.source
         OR new.linked_kind IS DISTINCT FROM old.linked_kind
         OR new.linked_id IS DISTINCT FROM old.linked_id
         OR new.rights_confirmed_at IS DISTINCT FROM old.rights_confirmed_at
         OR new.rights_text IS DISTINCT FROM old.rights_text
         OR new.created_at IS DISTINCT FROM old.created_at THEN
        RAISE EXCEPTION 'Only a document''s name, category, tags and who can see it can change.'
          USING ERRCODE = '42501';
      END IF;
      -- deleting stamps the server's clock; restoring only within the 30 days
      IF new.deleted_at IS NOT NULL AND old.deleted_at IS NULL THEN
        new.deleted_at := now();
      ELSIF new.deleted_at IS NULL AND old.deleted_at IS NOT NULL THEN
        IF old.deleted_at < now() - interval '30 days' THEN
          RAISE EXCEPTION 'That document was deleted more than 30 days ago.' USING ERRCODE = '42501';
        END IF;
      ELSIF new.deleted_at IS NOT NULL THEN
        new.deleted_at := old.deleted_at;
      END IF;
    END IF;
  ELSE
    IF _uid IS NOT NULL THEN
      IF new.owner_user_id IS DISTINCT FROM _uid THEN
        RAISE EXCEPTION 'A document is filed under the person uploading it.' USING ERRCODE = '42501';
      END IF;
      IF new.source <> 'upload' OR new.linked_kind IS NOT NULL OR new.linked_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only the app files imports and exports.' USING ERRCODE = '42501';
      END IF;
      IF new.rights_confirmed_at IS NULL OR new.rights_text IS NULL THEN
        RAISE EXCEPTION 'Confirm you may upload it first.' USING ERRCODE = '23514';
      END IF;
      new.rights_confirmed_at := now();
      new.created_at := now();
      new.deleted_at := NULL;
    END IF;

    -- the file: already uploaded, in the documents bucket, in the owner's own folder
    IF new.file_path IS NULL
       OR new.file_path !~ ('^' || new.owner_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$')
       OR position('..' IN new.file_path) > 0 THEN
      RAISE EXCEPTION 'That file isn''t in the uploader''s folder.' USING ERRCODE = '42501';
    END IF;
    SELECT o.metadata, true INTO _meta, _found
      FROM storage.objects o
     WHERE o.bucket_id = 'documents' AND o.name = new.file_path;
    IF NOT coalesce(_found, false) THEN
      RAISE EXCEPTION 'Upload the file first.' USING ERRCODE = '23514';
    END IF;
    -- what storage measured wins over anything the caller said
    IF (_meta ->> 'size') ~ '^\d+$' THEN
      new.bytes := (_meta ->> 'size')::bigint;
    END IF;
    IF nullif(btrim(_meta ->> 'mimetype'), '') IS NOT NULL THEN
      new.mime := lower(btrim(split_part(_meta ->> 'mimetype', ';', 1)));
    END IF;
  END IF;

  new.title := left(btrim(regexp_replace(coalesce(new.title, ''), '\s+', ' ', 'g')), 200);
  new.tags := public.documents_clean_tags(new.tags);
  new.updated_at := now();
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.documents_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documents_guard ON public.documents;
CREATE TRIGGER documents_guard
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_guard();

-- ---------------------------------------------------------------------------
-- RLS. Every user check runs once per query: (SELECT auth.uid()), set lookups.
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Documents read" ON public.documents;
CREATE POLICY "Documents read" ON public.documents
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    OR (deleted_at IS NULL AND (
         (visibility = 'client' AND client_id IN (SELECT public.documents_own_client_ids()))
      OR (visibility IN ('coach', 'client') AND client_id IN (SELECT public.coached_client_ids()))
      OR (visibility IN ('coach', 'client') AND client_id IS NOT NULL
          AND (SELECT public.has_role((SELECT auth.uid()), 'admin')))
    ))
  );

DROP POLICY IF EXISTS "Documents file" ON public.documents;
CREATE POLICY "Documents file" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND source = 'upload'
    AND (
      client_id IS NULL
      OR client_id IN (SELECT public.documents_own_client_ids())
      OR client_id IN (SELECT public.coached_client_ids())
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
    )
  );

DROP POLICY IF EXISTS "Documents owner edits" ON public.documents;
CREATE POLICY "Documents owner edits" ON public.documents
  FOR UPDATE TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

-- no DELETE for anyone signed in: a delete is the 30-day bin, the server purges
REVOKE ALL ON public.documents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

-- ---------------------------------------------------------------------------
-- The files: private, 25 MB, PDF / images / DOCX / XLSX / CSV / TXT. Uploads
-- go only into the uploader's own folder; a file is readable by its uploader
-- and by whoever may read a document that points at it (the documents RLS
-- above, through the subquery); an uploader can remove a file no document
-- points at (a failed upload), never one that's filed.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 26214400,
        ARRAY['application/pdf',
              'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'text/csv', 'text/plain'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "documents own upload" ON storage.objects;
CREATE POLICY "documents own upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "documents read" ON storage.objects;
CREATE POLICY "documents read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR name IN (SELECT d.file_path FROM public.documents d WHERE d.deleted_at IS NULL)
  ));

DROP POLICY IF EXISTS "documents own unfiled delete" ON storage.objects;
CREATE POLICY "documents own unfiled delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND name NOT IN (SELECT d.file_path FROM public.documents d));

-- ---------------------------------------------------------------------------
-- Day 30: the documents-purge hook deletes the files and rows for good, daily
-- while anything is due (the Storage API removes files; SQL can't).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'documents-purge';
  PERFORM cron.schedule(
    'documents-purge',
    '41 9 * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/documents-purge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE EXISTS (SELECT 1 FROM public.documents WHERE deleted_at < now() - interval '30 days');
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END $$;

SELECT public.rls_evaluate_once('documents');
