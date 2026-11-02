-- Clients list: several filters can mean "any of these" (the default in the
-- app now) or "all of these".
--
-- Every filter used to narrow the list: ticking No Payment (4) and No Program
-- (4) showed only clients with both, often nobody, while each chip's count
-- said how many it finds alone, so picking a second filter looked broken.
-- admin_clients_directory gains p_match: 'any' shows clients with at least one
-- of the picked filters, 'all' (the default, so an older build keeps working)
-- only clients with every one. Nothing else in the function changes, so it is
-- rewritten in place from the live definition, which must be the one this was
-- written against (its fingerprint below) unless it already has p_match.
SET lock_timeout = '3s';

DO $$
DECLARE
  f oid;
  def text;
  nxt text;
BEGIN
  SELECT p.oid INTO f
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_clients_directory'
     AND pg_get_function_identity_arguments(p.oid) = 'p_search text, p_status text, p_coaching_type text, p_coach_id uuid, p_sort text, p_limit integer, p_offset integer, p_lifecycle text, p_flags text[]';
  IF f IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_clients_directory'
                AND pg_get_function_identity_arguments(p.oid) LIKE '%p_match text') THEN
      RETURN; -- already done
    END IF;
    RAISE EXCEPTION 'admin_clients_directory is not the 9-argument version this was written against';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = f) <> 'd90a949e8c1a30fa7b8335ded9c3e492' THEN
    RAISE EXCEPTION 'admin_clients_directory changed since this was written: redo the edit against the live definition';
  END IF;

  def := pg_get_functiondef(f);
  nxt := replace(def,
    'p_flags text[] DEFAULT NULL::text[])',
    'p_flags text[] DEFAULT NULL::text[], p_match text DEFAULT ''all''::text)');
  nxt := replace(nxt,
    '  -- Every filter the caller asked for; a client must match ALL of them. p_status is the',
    E'  -- Every filter the caller asked for; a client matches ALL of them (p_match ''all'') or at least\n  -- one (p_match ''any'', what the app sends unless the coach picks "all"). p_status is the');
  nxt := replace(nxt,
    E'  ), ''{}''::text[]);\n  v_rows jsonb;',
    E'  ), ''{}''::text[]);\n  v_match_all boolean := coalesce(nullif(p_match, ''''), ''all'') <> ''any'';\n  v_rows jsonb;');
  nxt := replace(nxt,
    E'    where cs.flags @> v_flags\n',
    E'    where cardinality(v_flags) = 0\n       or (v_match_all and cs.flags @> v_flags)\n       or (not v_match_all and cs.flags && v_flags)\n');
  IF position('p_match text DEFAULT' IN nxt) = 0
     OR position('v_match_all boolean :=' IN nxt) = 0
     OR position('(not v_match_all and cs.flags && v_flags)' IN nxt) = 0
     OR position('at least' IN nxt) = 0 THEN
    RAISE EXCEPTION 'admin_clients_directory: an edit did not apply';
  END IF;

  DROP FUNCTION public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text, text[]);
  EXECUTE nxt;
END $$;

REVOKE ALL ON FUNCTION public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text, text[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text, text[], text) TO authenticated, service_role;
