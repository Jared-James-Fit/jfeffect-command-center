-- Scheduled-jobs health: stop alerting on deploy blips.
--
-- While a new build rolls out, the live site briefly answers hook calls with
-- its HTML "not found" page (404) for a few minutes, then recovers. The first
-- version counted those like real failures, so most deploys opened a
-- "Scheduled jobs failing" alert for nothing (seen 2026-10-08 14:35 and
-- 18:03-18:15 UTC: every hook route existed, every call after the rollout
-- returned 200).
--
-- Now:
--   * hard failures (5xx/4xx JSON responses from our handlers, timeouts / no
--     response) still alert at 3+ in the hour, as before;
--   * HTML 404s alert only when they persist: 3+ calls, spread over 20+
--     minutes, and still happening in the last 15. A route that is genuinely
--     gone keeps 404ing on every tick and still alerts within the hour.
-- The message is plain English; the raw numbers stay in details.

create or replace function public.check_scheduled_jobs_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window constant interval := interval '60 minutes';
  v_http_total integer;
  v_hard_failed integer;
  v_html404 integer;
  v_html404_first timestamptz;
  v_html404_last timestamptz;
  v_html404_persistent boolean;
  v_breakdown jsonb;
  v_failed_jobs jsonb;
  v_cron_failed integer;
  v_open_id uuid;
  v_unhealthy boolean;
  v_message text;
  v_details jsonb;
begin
  with recent as (
    select r.status_code,
           r.created,
           (r.status_code = 404 and coalesce(r.content, '') ilike '<!doctype html%') as html404
    from net._http_response r
    where r.created > now() - v_window
  )
  select count(*),
         count(*) filter (where (status_code is null or status_code >= 400) and not coalesce(html404, false)),
         count(*) filter (where html404),
         min(created) filter (where html404),
         max(created) filter (where html404)
    into v_http_total, v_hard_failed, v_html404, v_html404_first, v_html404_last
  from recent;

  v_html404_persistent := v_html404 >= 3
    and v_html404_last > now() - interval '15 minutes'
    and v_html404_last - v_html404_first >= interval '20 minutes';

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

  v_unhealthy := v_hard_failed >= 3 or v_html404_persistent or v_cron_failed >= 2;

  select id into v_open_id
  from public.support_alerts
  where error_type = 'scheduled_jobs_failing' and status in ('open', 'in_progress')
  order by created_at desc
  limit 1;

  if v_unhealthy then
    v_message := concat_ws(' ',
      case when v_hard_failed >= 3
        then format('%s scheduled calls failed in the last hour.', v_hard_failed) end,
      case when v_html404_persistent
        then format('A scheduled job has been hitting a missing page (404) for %s minutes.',
                    ceil(extract(epoch from (v_html404_last - v_html404_first)) / 60)::int) end,
      case when v_cron_failed >= 2
        then format('%s cron runs errored (%s).', v_cron_failed,
                    (select string_agg(x, ', ') from jsonb_array_elements_text(v_failed_jobs) x)) end,
      'Diagnose: select * from cron_http_health(60);'
    );
    v_details := jsonb_build_object(
      'http_total', v_http_total,
      'http_failed', v_hard_failed + v_html404,
      'hard_failed', v_hard_failed,
      'deploy_404s', case when v_html404_persistent then 0 else v_html404 end,
      'status_breakdown', v_breakdown,
      'cron_failed_runs', v_cron_failed,
      'cron_failed_jobs', v_failed_jobs,
      'last_checked', now()
    );

    if v_open_id is null then
      insert into public.support_alerts (error_type, error_message, page_route, details, status)
      values ('scheduled_jobs_failing', v_message, null, v_details, 'open');
    else
      update public.support_alerts
         set error_message = v_message,
             details = coalesce(details, '{}'::jsonb) || v_details,
             updated_at = now()
       where id = v_open_id;
    end if;
  elsif v_open_id is not null and v_http_total > 0 then
    update public.support_alerts
       set status = 'resolved',
           resolved_at = now(),
           details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
             'notes',
             coalesce(details -> 'notes', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'note', case
                 when v_hard_failed = 0 and v_html404 = 0
                   then format('Auto-resolved: %s scheduled calls in the last hour, none failed.', v_http_total)
                 else format('Auto-resolved: jobs are healthy. %s of %s calls in the last hour failed briefly (deploy rollout or a single timeout), nothing sustained.',
                             v_hard_failed + v_html404, v_http_total)
               end,
               'at', now()
             ))
           ),
           updated_at = now()
     where id = v_open_id;
  end if;

  return jsonb_build_object(
    'unhealthy', v_unhealthy, 'http_total', v_http_total, 'hard_failed', v_hard_failed,
    'html404', v_html404, 'html404_persistent', v_html404_persistent,
    'cron_failed_runs', v_cron_failed, 'open_alert', v_open_id
  );
end;
$$;

revoke all on function public.check_scheduled_jobs_health() from public, anon, authenticated;
