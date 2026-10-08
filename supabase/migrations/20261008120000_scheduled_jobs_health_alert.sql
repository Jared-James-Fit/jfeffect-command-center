-- Alert when scheduled jobs start failing, so a silent outage like the one in
-- Oct 2026 (every hook call returned 401 for ~4 days while pg_cron reported
-- "succeeded") shows up in the admin Support Alerts inbox (with its nav badge)
-- within the hour.
--
-- Runs entirely in SQL on purpose: it must keep working when the app hooks are
-- the thing that is broken.
--
-- Signals over the last 60 minutes:
--   * HTTP calls made by the cron jobs (pg_net) that failed: status >= 400 or no
--     response at all
--   * pg_cron runs that errored (SQL jobs like the payment reminders)
-- Opens one 'scheduled_jobs_failing' alert (never duplicates; refreshes the open
-- one), and resolves it automatically with a note once a full hour is clean.

create or replace function public.check_scheduled_jobs_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window constant interval := interval '60 minutes';
  v_http_total integer;
  v_http_failed integer;
  v_breakdown jsonb;
  v_failed_jobs jsonb;
  v_cron_failed integer;
  v_open_id uuid;
  v_unhealthy boolean;
  v_message text;
  v_details jsonb;
begin
  select count(*),
         count(*) filter (where r.status_code is null or r.status_code >= 400)
    into v_http_total, v_http_failed
  from net._http_response r
  where r.created > now() - v_window;

  select coalesce(jsonb_object_agg(coalesce(s.code, 'no response'), s.n), '{}'::jsonb)
    into v_breakdown
  from (
    select r.status_code::text as code, count(*) as n
    from net._http_response r
    where r.created > now() - v_window
      and (r.status_code is null or r.status_code >= 400)
    group by r.status_code
  ) s;

  select count(*), coalesce(jsonb_agg(distinct j.jobname), '[]'::jsonb)
    into v_cron_failed, v_failed_jobs
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where d.start_time > now() - v_window
    and d.status = 'failed';

  v_unhealthy := v_http_failed >= 3 or v_cron_failed >= 2;

  select id into v_open_id
  from public.support_alerts
  where error_type = 'scheduled_jobs_failing' and status in ('open', 'in_progress')
  order by created_at desc
  limit 1;

  if v_unhealthy then
    v_message := format(
      '%s of %s scheduled hook calls failed in the last hour%s%s. Run: select * from cron_http_health(60);',
      v_http_failed, v_http_total,
      case when v_breakdown <> '{}'::jsonb then ' (' || v_breakdown::text || ')' else '' end,
      case when v_cron_failed > 0 then format('; %s cron run(s) errored: %s', v_cron_failed, v_failed_jobs::text) else '' end
    );
    v_details := jsonb_build_object(
      'http_total', v_http_total, 'http_failed', v_http_failed, 'status_breakdown', v_breakdown,
      'cron_failed_runs', v_cron_failed, 'cron_failed_jobs', v_failed_jobs, 'last_checked', now()
    );

    if v_open_id is null then
      insert into public.support_alerts (error_type, error_message, page_route, details, status)
      values ('scheduled_jobs_failing', v_message, '/admin', v_details, 'open');
    else
      -- Keep one alert, refreshed, and keep any notes the admin added.
      update public.support_alerts
         set error_message = v_message,
             details = coalesce(details, '{}'::jsonb) || v_details,
             updated_at = now()
       where id = v_open_id;
    end if;
  elsif v_open_id is not null and v_http_total > 0 then
    -- A full clean hour (and the jobs are actually running): close it with a note.
    update public.support_alerts
       set status = 'resolved',
           resolved_at = now(),
           details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
             'notes',
             coalesce(details -> 'notes', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'note', format('Auto-resolved: %s scheduled calls in the last hour, none failed.', v_http_total),
               'at', now()
             ))
           ),
           updated_at = now()
     where id = v_open_id;
  end if;

  return jsonb_build_object(
    'unhealthy', v_unhealthy, 'http_total', v_http_total, 'http_failed', v_http_failed,
    'cron_failed_runs', v_cron_failed, 'open_alert', v_open_id
  );
end;
$$;

revoke all on function public.check_scheduled_jobs_health() from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'scheduled-jobs-health' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule('scheduled-jobs-health', '23,53 * * * *', 'select public.check_scheduled_jobs_health();');
exception
  when undefined_table or undefined_function then
    null;
end
$$;
