-- "Block N · Week W" counted every block the athlete ever had, across all
-- their programs, so someone on Block 1 of a new program read "Block 7".
-- Blocks are numbered within their own program (prep) now, which is how
-- the coach names them.
CREATE OR REPLACE FUNCTION public.community_public_session_title(_day_id uuid, _client_id uuid, _at timestamp with time zone)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT coalesce(
    (SELECT 'Block ' || (SELECT count(*) FROM public.pl_blocks b2
                          WHERE b2.client_id = b.client_id AND NOT coalesce(b2.archived, false)
                            AND b2.prep_id IS NOT DISTINCT FROM b.prep_id
                            AND (coalesce(b2.start_date, '9999-12-31'::date), b2.created_at) <= (coalesce(b.start_date, '9999-12-31'::date), b.created_at))
            || CASE WHEN w.week_index IS NOT NULL AND w.week_index > 0 THEN ' · Week ' || w.week_index ELSE '' END
       FROM public.pl_days d
       JOIN public.pl_weeks w ON w.id = d.week_id
       JOIN public.pl_blocks b ON b.id = w.block_id
      WHERE d.id = _day_id AND NOT coalesce(b.archived, false)),
    to_char(coalesce(_at, now()) AT TIME ZONE coalesce((SELECT nullif(btrim(c.timezone), '') FROM public.clients c WHERE c.id = _client_id), 'America/Winnipeg'), 'FMDay') || ' session');
$f$;
