-- Manitoba kept UTC-5 when the clocks would have fallen back on Nov 1, 2026: Google
-- Calendar, iPhones and the app's server all put 10:00 America/Winnipeg on Nov 1 at
-- 15:00Z. This database's time-zone rules are older and still drop Winnipeg to UTC-6
-- that night, so every session it computed from then on was stored an hour late
-- (10 AM saved as 16:00Z): the app pushed 11 AM to Google, clients' calendars showed
-- 11 AM and the evening-before text said 11.
--
-- local_to_instant / instant_to_local are the database's conversions for a client's
-- zone: the zone's own rules, except Manitoba (America/Winnipeg and its links) from
-- Nov 1, 2026, which is a fixed UTC-5 ('Etc/GMT+5', POSIX sign). Before that date the
-- old rules already give UTC-5 from March 8, so nothing earlier moves. Once the
-- database's own rules know about Manitoba these give the same answers.

CREATE OR REPLACE FUNCTION public.zone_for_local(_local timestamp, _tz text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN COALESCE(NULLIF(_tz, ''), 'America/Winnipeg') IN ('America/Winnipeg', 'Canada/Central', 'America/Rainy_River')
         AND _local >= timestamp '2026-11-01 00:00'
      THEN 'Etc/GMT+5'
    ELSE COALESCE(NULLIF(_tz, ''), 'America/Winnipeg')
  END
$$;

CREATE OR REPLACE FUNCTION public.zone_for_instant(_at timestamptz, _tz text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN COALESCE(NULLIF(_tz, ''), 'America/Winnipeg') IN ('America/Winnipeg', 'Canada/Central', 'America/Rainy_River')
         AND _at >= timestamptz '2026-11-01 05:00+00'
      THEN 'Etc/GMT+5'
    ELSE COALESCE(NULLIF(_tz, ''), 'America/Winnipeg')
  END
$$;

/** A wall-clock time in a zone as an instant ("10:00 Winnipeg on Nov 1" → 15:00Z). */
CREATE OR REPLACE FUNCTION public.local_to_instant(_local timestamp, _tz text)
 RETURNS timestamptz
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT _local AT TIME ZONE public.zone_for_local(_local, _tz)
$$;

/** An instant as the wall-clock time in a zone. */
CREATE OR REPLACE FUNCTION public.instant_to_local(_at timestamptz, _tz text)
 RETURNS timestamp
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT _at AT TIME ZONE public.zone_for_instant(_at, _tz)
$$;

-- A session's start and end as instants.
CREATE OR REPLACE FUNCTION public.tg_pt_session_compute_ts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.starts_at := public.local_to_instant(NEW.session_date + NEW.start_time, NEW.timezone);
  NEW.ends_at   := public.local_to_instant(NEW.session_date + NEW.end_time, NEW.timezone);
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- "Today" where the session is (auto-complete, status follows date).
CREATE OR REPLACE FUNCTION public.pt_local_today(_tz text)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.instant_to_local(now(), _tz)::date;
EXCEPTION WHEN others THEN
  RETURN public.instant_to_local(now(), 'America/Winnipeg')::date;
END;
$function$;
