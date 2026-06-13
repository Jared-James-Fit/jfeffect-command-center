-- Membership Launch Readiness: safe cron-job status reader.
--
-- Exposes ONLY the single pending-signup cleanup job's existence, enabled
-- state, schedule, and last run metadata. Does not expose the command,
-- arbitrary jobs, secrets, or tokens. Admin-only. Additive and reversible
-- (DROP FUNCTION public.get_membership_cleanup_job_status() to roll back).

CREATE OR REPLACE FUNCTION public.get_membership_cleanup_job_status()
RETURNS TABLE (
  exists_ boolean,
  jobname text,
  schedule text,
  active boolean,
  last_run_started_at timestamptz,
  last_run_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_jobid bigint;
  v_jobname text := 'jf-cleanup-pending-signups-hourly';
BEGIN
  -- Admin authorization is verified INSIDE the function.
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT j.jobid, j.jobname, j.schedule, j.active
    INTO v_jobid, jobname, schedule, active
  FROM cron.job j
  WHERE j.jobname = v_jobname
  LIMIT 1;

  IF v_jobid IS NULL THEN
    exists_ := false;
    jobname := v_jobname;
    schedule := NULL;
    active := NULL;
    last_run_started_at := NULL;
    last_run_status := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  exists_ := true;

  SELECT d.start_time, d.status
    INTO last_run_started_at, last_run_status
  FROM cron.job_run_details d
  WHERE d.jobid = v_jobid
  ORDER BY d.start_time DESC
  LIMIT 1;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_membership_cleanup_job_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_membership_cleanup_job_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_membership_cleanup_job_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_membership_cleanup_job_status() TO service_role;