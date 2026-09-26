-- Powerlifting records contract: the client board must be able to read the complete JF athlete roster,
-- including historical/retired athletes, while performances remain constrained to each athlete's JF window.
create or replace function public.get_powerlifting_athlete_roster()
returns table(
 athlete_id uuid, client_id uuid, athlete_name text, sex text,
 jf_start_date date, jf_end_date date, openpowerlifting_url text, country_filter text,
 result_count bigint
)
language sql stable security definer set search_path=public as $$
 select a.id,a.client_id,a.athlete_name,a.sex,a.jf_start_date,a.jf_end_date,a.openpowerlifting_url,a.country_filter,
        count(r.id) filter (
          where (a.jf_start_date is null or r.meet_date>=a.jf_start_date)
            and (a.jf_end_date is null or r.meet_date<=a.jf_end_date)
        ) as result_count
 from public.powerlifting_athletes a
 left join public.athlete_powerlifting_results r on r.athlete_id=a.id
 where auth.uid() is not null
 group by a.id,a.client_id,a.athlete_name,a.sex,a.jf_start_date,a.jf_end_date,a.openpowerlifting_url,a.country_filter
 order by a.athlete_name;
$$;
revoke execute on function public.get_powerlifting_athlete_roster() from public,anon;
grant execute on function public.get_powerlifting_athlete_roster() to authenticated;
