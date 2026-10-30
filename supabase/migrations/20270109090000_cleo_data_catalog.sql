-- Cleo can find anything in the app: the list of tables and their columns,
-- for find_data / read_data (cleo-data-access.ts). It only says what exists;
-- reading still goes through the person's own login, so RLS decides what
-- comes back, exactly as in the app. Admins and the finance login only.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.cleo_data_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN (SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()) THEN
      coalesce(jsonb_agg(jsonb_build_object(
        't', c.relname,
        'v', c.relkind IN ('v', 'm'),
        'n', greatest(c.reltuples, -1)::bigint,
        'd', obj_description(c.oid, 'pg_class'),
        'c', (SELECT coalesce(jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum), '[]'::jsonb)
                FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
      ) ORDER BY c.relname), '[]'::jsonb)
  END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND NOT c.relispartition
    AND has_table_privilege('authenticated', c.oid, 'SELECT')
$$;
REVOKE ALL ON FUNCTION public.cleo_data_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_data_catalog() TO authenticated;
