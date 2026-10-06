-- Daily training load per athlete, for overlaying recovery (sleep / HRV / resting HR).
--
-- Read-only and derived from completed set logs (pl_row_results); it never writes and
-- never touches XP. Access uses the same gate as the other training-record RPCs: the
-- athlete, their assigned coach, or an admin.
--
-- Days are the athlete's own calendar days (clients.timezone, falling back to the
-- coaching timezone) so a late-evening session lands on the day it was trained.
--  sets       completed working sets with reps (any load type)
--  hard_sets  sets logged at RPE >= 8 (RPE only; RIR is not converted or guessed)
--  tonnage_kg external-load working sets only (same rules as client_qualifying_sets)
--  avg_rpe    mean RPE across sets that have one

CREATE OR REPLACE FUNCTION public.client_daily_training_load(_client_id uuid, _days int DEFAULT 90)
RETURNS TABLE(day date, sets int, hard_sets int, tonnage_kg numeric, avg_rpe numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tz text;
BEGIN
  IF NOT public.can_view_client_training(_client_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(c.timezone, ''), 'America/Winnipeg') INTO tz
    FROM public.clients c WHERE c.id = _client_id;
  tz := coalesce(tz, 'America/Winnipeg');
  -- An unknown zone name must not break the whole view.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = tz) THEN
    tz := 'America/Winnipeg';
  END IF;

  RETURN QUERY
  SELECT (r.completed_at AT TIME ZONE tz)::date AS day,
         count(*)::int AS sets,
         count(*) FILTER (WHERE r.actual_rpe_num >= 8)::int AS hard_sets,
         coalesce(round(sum(r.normalized_kg * r.actual_reps) FILTER (
           WHERE coalesce(r.load_type, 'external') = 'external'
             AND NOT coalesce(r.is_bodyweight, false)
             AND r.normalized_kg > 0), 1), 0) AS tonnage_kg,
         round(avg(r.actual_rpe_num) FILTER (WHERE r.actual_rpe_num BETWEEN 1 AND 10), 1) AS avg_rpe
    FROM public.pl_row_results r
   WHERE r.client_id = _client_id
     AND r.completed_at IS NOT NULL
     AND r.completed_at >= now() - make_interval(days => least(greatest(_days, 1), 365))
     AND coalesce(r.actual_reps, 0) > 0
     AND coalesce(r.is_working_set, true)
   GROUP BY 1
   ORDER BY 1;
END
$$;
REVOKE ALL ON FUNCTION public.client_daily_training_load(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_daily_training_load(uuid, int) TO authenticated;
