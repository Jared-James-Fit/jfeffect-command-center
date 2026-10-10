-- OpenPowerlifting sync: survive pg_net request ids being reused.
--
-- pg_net numbers requests from 1 again after a database restart, so a new
-- download can get the id of an older one: a row already in
-- powerlifting_opl_sync_requests, or a response still kept in
-- net._http_response (pg_net keeps them for hours). Matching on the id alone
-- could then merge one lifter's meets into another lifter's career.
--
--  * A new request with a reused id takes over that row (it was the old
--    request's; that download can't be told apart any more).
--  * Only a response written after the request counts, newest first.

create or replace function public.powerlifting_opl_request(_athlete uuid default null)
returns bigint[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  rid bigint;
  ids bigint[] := '{}';
begin
  for a in
    select pa.id, p.host, p.slug
    from public.powerlifting_athletes pa
    cross join lateral public.powerlifting_opl_profile(pa.openpowerlifting_url) p
    where p.slug is not null
      and (case when _athlete is null then coalesce(pa.auto_sync, false) else pa.id = _athlete end)
  loop
    rid := net.http_get(url := a.host || '/api/liftercsv/' || a.slug, timeout_milliseconds := 30000);
    insert into public.powerlifting_opl_sync_requests (request_id, athlete_id, slug) values (rid, a.id, a.slug)
    on conflict (request_id) do update set
      athlete_id = excluded.athlete_id,
      slug = excluded.slug,
      requested_at = now(),
      collected_at = null,
      result = null;
    ids := ids || rid;
  end loop;
  return ids;
end;
$$;
revoke all on function public.powerlifting_opl_request(uuid) from public, anon, authenticated;

create or replace function public.powerlifting_opl_collect(_only bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q record;
  res jsonb;
  done integer := 0;
  failed integer := 0;
begin
  for q in
    select s.request_id, s.athlete_id, s.slug, s.requested_at, h.status_code, h.content, h.error_msg, h.timed_out,
      h.id is not null responded
    from public.powerlifting_opl_sync_requests s
    left join lateral (
      select r.id, r.status_code, r.content, r.error_msg, r.timed_out
      from net._http_response r
      where r.id = s.request_id and r.created >= s.requested_at
      order by r.created desc
      limit 1
    ) h on true
    where s.collected_at is null and (_only is null or s.request_id = _only)
    order by s.requested_at
  loop
    if not q.responded then
      if q.requested_at < now() - interval '30 minutes' then
        update public.powerlifting_opl_sync_requests set collected_at = now(), result = jsonb_build_object('error', 'No response') where request_id = q.request_id;
        update public.powerlifting_athletes set opl_sync_status = 'OpenPowerlifting did not respond' where id = q.athlete_id;
        failed := failed + 1;
      end if;
      continue;
    end if;
    begin
      if q.status_code = 200 and q.content like 'Name,%' then
        res := public.powerlifting_opl_apply(q.athlete_id, q.slug, q.content);
        done := done + 1;
      else
        res := jsonb_build_object('error', coalesce(q.error_msg, 'HTTP ' || q.status_code));
        update public.powerlifting_athletes
          set opl_sync_status = case when q.status_code = 404 then 'Profile not found on OpenPowerlifting' else 'Sync failed: ' || (res->>'error') end
          where id = q.athlete_id;
        failed := failed + 1;
      end if;
    exception when others then
      res := jsonb_build_object('error', sqlerrm);
      update public.powerlifting_athletes set opl_sync_status = 'Sync failed: ' || sqlerrm where id = q.athlete_id;
      failed := failed + 1;
    end;
    update public.powerlifting_opl_sync_requests set collected_at = now(), result = res where request_id = q.request_id;
  end loop;
  delete from public.powerlifting_opl_sync_requests where requested_at < now() - interval '30 days';
  return jsonb_build_object('merged', done, 'failed', failed);
end;
$$;
revoke all on function public.powerlifting_opl_collect(bigint) from public, anon, authenticated;
