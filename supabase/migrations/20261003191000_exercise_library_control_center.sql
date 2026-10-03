-- Exercise Library control center backend: alias guards, usage visibility,
-- merge preview + admin-only "Make alias" consolidation.

CREATE OR REPLACE FUNCTION public.is_exercise_library_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach')
$$;

-- Aliases are other names for ONE exercise. Keep the key normalized and never
-- let an alias shadow a different, real exercise.
CREATE OR REPLACE FUNCTION public.exercise_aliases_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE clash text;
BEGIN
  NEW.alias_name := btrim(coalesce(NEW.alias_name, ''));
  NEW.alias_key := public.pl_norm_exercise_name(NEW.alias_name);
  IF NEW.alias_key = '' THEN RAISE EXCEPTION 'Alias name is required.' USING ERRCODE = '23514'; END IF;
  SELECT e.name INTO clash FROM public.exercises e
   WHERE NOT e.archived AND public.pl_norm_exercise_name(e.name) = NEW.alias_key AND e.id <> NEW.exercise_id
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION '"%" is already its own exercise. Use "Make alias" on it instead so its history moves safely.', clash
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exercises e WHERE e.id = NEW.exercise_id
              AND public.pl_norm_exercise_name(e.name) = NEW.alias_key) THEN
    RAISE EXCEPTION 'An alias cannot be the exercise''s own name.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS exercise_aliases_guard_trg ON public.exercise_aliases;
CREATE TRIGGER exercise_aliases_guard_trg BEFORE INSERT OR UPDATE ON public.exercise_aliases
FOR EACH ROW EXECUTE FUNCTION public.exercise_aliases_guard();

-- Coaches can read the queue; admins (and coaches) maintain aliases.
DROP POLICY IF EXISTS "Admin manage exercise aliases" ON public.exercise_aliases;
CREATE POLICY "Staff manage exercise aliases" ON public.exercise_aliases FOR ALL TO authenticated
  USING (public.is_exercise_library_staff()) WITH CHECK (public.is_exercise_library_staff());
DROP POLICY IF EXISTS "Admin manage duplicate dismissals" ON public.exercise_duplicate_dismissals;
CREATE POLICY "Staff manage duplicate dismissals" ON public.exercise_duplicate_dismissals FOR ALL TO authenticated
  USING (public.is_exercise_library_staff()) WITH CHECK (public.is_exercise_library_staff());

-- One row per referenced exercise. Programs = distinct client blocks.
CREATE OR REPLACE FUNCTION public.exercise_library_usage()
RETURNS TABLE(exercise_id uuid, programs int, active_clients int, templates int, logged_workouts int, logged_sets int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_exercise_library_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH rows AS (
    SELECT r.exercise_id, r.id row_id, r.day_id, b.id block_id, b.client_id, b.status
      FROM public.pl_exercise_rows r
      JOIN public.pl_days d ON d.id = r.day_id
      JOIN public.pl_weeks w ON w.id = d.week_id
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE r.exercise_id IS NOT NULL AND NOT coalesce(b.archived, false)
  ), prog AS (
    SELECT x.exercise_id, count(DISTINCT x.block_id)::int programs,
           count(DISTINCT x.client_id) FILTER (WHERE lower(x.status) = 'active')::int active_clients
      FROM rows x GROUP BY 1
  ), logged AS (
    SELECT x.exercise_id, count(DISTINCT x.day_id)::int logged_workouts, count(*)::int logged_sets
      FROM public.pl_row_results rr JOIN rows x ON x.row_id = rr.row_id
     WHERE rr.actual_reps IS NOT NULL OR rr.completed_duration_seconds IS NOT NULL
     GROUP BY 1
  ), tpl AS (
    -- One regex pass over each template payload (~10 MB total), not one scan per exercise.
    SELECT m[1]::uuid exercise_id, count(DISTINCT t.id)::int templates
      FROM public.pl_templates t
     CROSS JOIN LATERAL regexp_matches(t.payload::text, '"exercise_id": "([0-9a-f-]{36})"', 'g') m
     WHERE NOT coalesce(t.archived, false)
     GROUP BY 1
  )
  SELECT ids.id, coalesce(p.programs,0), coalesce(p.active_clients,0), coalesce(t.templates,0),
         coalesce(l.logged_workouts,0), coalesce(l.logged_sets,0)
    FROM (SELECT p.exercise_id id FROM prog p UNION SELECT t.exercise_id FROM tpl t) ids
    LEFT JOIN prog p ON p.exercise_id = ids.id
    LEFT JOIN logged l ON l.exercise_id = ids.id
    LEFT JOIN tpl t ON t.exercise_id = ids.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.exercise_library_usage() TO authenticated;

-- Where exactly an exercise is used (inspect before changing anything).
CREATE OR REPLACE FUNCTION public.exercise_usage_detail(_exercise_id uuid)
RETURNS TABLE(client_id uuid, client_name text, block_id uuid, block_name text, block_status text,
              program_rows int, logged_sets int, last_logged_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_exercise_library_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT b.client_id, coalesce(c.preferred_name, c.full_name, 'Client'), b.id, b.name, b.status,
         count(DISTINCT r.id)::int, count(rr.id)::int, max(rr.completed_at)
    FROM public.pl_exercise_rows r
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    LEFT JOIN public.clients c ON c.id = b.client_id
    LEFT JOIN public.pl_row_results rr ON rr.row_id = r.id
   WHERE r.exercise_id = _exercise_id AND NOT coalesce(b.archived, false)
   GROUP BY b.client_id, c.preferred_name, c.full_name, b.id, b.name, b.status, b.start_date
   ORDER BY (lower(b.status) = 'active') DESC, b.start_date DESC NULLS LAST
   LIMIT 200;
END;
$$;
GRANT EXECUTE ON FUNCTION public.exercise_usage_detail(uuid) TO authenticated;

-- Exactly what "Make alias" will do, before it does it.
CREATE OR REPLACE FUNCTION public.exercise_merge_preview(_duplicate uuid, _canonical uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE dup public.exercises; can public.exercises;
BEGIN
  IF NOT public.is_exercise_library_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO dup FROM public.exercises WHERE id = _duplicate;
  SELECT * INTO can FROM public.exercises WHERE id = _canonical;
  IF dup.id IS NULL OR can.id IS NULL OR dup.id = can.id THEN RAISE EXCEPTION 'Pick two different exercises.'; END IF;
  RETURN jsonb_build_object(
    'duplicate_name', dup.name,
    'canonical_name', can.name,
    'program_rows', (SELECT count(*) FROM public.pl_exercise_rows WHERE exercise_id = _duplicate),
    'logged_sets', (SELECT count(*) FROM public.pl_row_results rr JOIN public.pl_exercise_rows r ON r.id = rr.row_id WHERE r.exercise_id = _duplicate),
    'member_logs', (SELECT count(*) FROM public.member_set_logs WHERE exercise_id = _duplicate),
    'maxes', (SELECT count(*) FROM public.pl_client_maxes WHERE exercise_id = _duplicate OR source_exercise_id = _duplicate),
    'notes', (SELECT count(*) FROM public.pl_exercise_notes WHERE exercise_id = _duplicate)
             + (SELECT count(*) FROM public.member_exercise_notes WHERE exercise_id = _duplicate),
    'templates', (SELECT count(*) FROM public.pl_templates WHERE position(_duplicate::text IN payload::text) > 0),
    'aliases', (SELECT count(*) FROM public.exercise_aliases WHERE exercise_id = _duplicate),
    'clients', (SELECT count(DISTINCT b.client_id) FROM public.pl_exercise_rows r JOIN public.pl_days d ON d.id = r.day_id
                  JOIN public.pl_weeks w ON w.id = d.week_id JOIN public.pl_blocks b ON b.id = w.block_id
                 WHERE r.exercise_id = _duplicate),
    'video_moves', coalesce(can.vimeo_embed_url, can.video_url, can.youtube_url) IS NULL
                   AND coalesce(dup.vimeo_embed_url, dup.video_url, dup.youtube_url) IS NOT NULL,
    'canonical_has_video', coalesce(can.vimeo_embed_url, can.video_url, can.youtube_url) IS NOT NULL,
    'duplicate_has_video', coalesce(dup.vimeo_embed_url, dup.video_url, dup.youtube_url) IS NOT NULL
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.exercise_merge_preview(uuid, uuid) TO authenticated;

-- Admin-only consolidation. Moves every reference, keeps the duplicate's name
-- as an alias, re-points the duplicate's own aliases, archives (never deletes).
CREATE OR REPLACE FUNCTION public.admin_make_exercise_alias(_duplicate uuid, _canonical uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE preview jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can consolidate exercises.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exercises WHERE id = _canonical AND archived) THEN
    RAISE EXCEPTION 'The exercise you keep must be active.';
  END IF;
  preview := public.exercise_merge_preview(_duplicate, _canonical);
  UPDATE public.exercise_aliases SET exercise_id = _canonical WHERE exercise_id = _duplicate;
  PERFORM public.merge_duplicate_exercise(_duplicate, _canonical, 'coach review: make alias');
  UPDATE public.exercises SET archived_by = auth.uid() WHERE id = _duplicate;
  DELETE FROM public.exercise_duplicate_dismissals
   WHERE exercise_a IN (_duplicate, _canonical) AND exercise_b IN (_duplicate, _canonical);
  RETURN preview;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_make_exercise_alias(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_make_exercise_alias(uuid, uuid) TO authenticated;
