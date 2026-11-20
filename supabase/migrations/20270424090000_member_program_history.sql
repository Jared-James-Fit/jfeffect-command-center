-- A member's programs have a history: nothing they stop is ever thrown away.
--
-- Until now, ending a program deleted every block of it with nothing logged,
-- switching archived the old one with no way back, and a member could only see
-- their archived blocks one by one at the bottom of Workouts. Now:
--
-- 1. member_program_history: one row per program a member took off their
--    calendar (its pl_preps id for a program of several blocks, else its
--    block's id): why (paused, ended, switched), the day it came off their
--    calendar on their own clock, and whether they removed it from their
--    history list (hidden_at; nothing else changes). Written by the trigger on
--    pl_blocks and by the functions below only; the member reads their own.
-- 2. member_program_end(_block_id, _confirm, _reason): ending or pausing
--    ARCHIVES the whole program (never deletes a block): its logged workouts,
--    blocks, weeks, days and schedule stay exactly as they were. Older apps
--    call it with two arguments and get the same thing as 'ended'.
-- 3. member_program_history(): the member's past programs with what's done,
--    what's left and where they'd pick up, plus whether it can be resumed or
--    started over (its JF Effect plan is still live, or their own program
--    still exists).
-- 4. member_program_resume(_key, _start): puts a past program back on the
--    calendar where they left off. The program on the calendar now (theirs)
--    moves to the history first. The workouts still to do are re-dated from
--    _start when their old dates have gone by (whole program shifted so the
--    next one lands on the first training day from _start; done and missed
--    workouts keep their dates); then the app places them on their training
--    days (realignClientToCommittedDays), like starting a program.
-- 5. member_program_undo_start(_block_id, _restore_key): Undo right after a
--    switch: the program just started (only while nothing in it is opened or
--    logged, within 30 minutes) is removed and the one it replaced comes back.
-- 6. member_program_history_hide(_key, _hidden): removes a past program from
--    the history list, or puts it back (Undo). Its blocks and logs stay.
-- 7. athlete_program_delete keeps the link from a running copy to the program
--    it came from and leaves its sharing alone, so athlete_program_restore can
--    undo a delete exactly.

-- ---------------------------------------------------------------------------
-- 1. The history table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_program_history (
  program_key uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'ended' CHECK (reason IN ('paused', 'ended', 'switched')),
  off_on date NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_program_history_user_idx
  ON public.member_program_history (user_id, archived_at DESC);

ALTER TABLE public.member_program_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Member reads own program history" ON public.member_program_history;
CREATE POLICY "Member reads own program history" ON public.member_program_history
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Admins read program history" ON public.member_program_history;
CREATE POLICY "Admins read program history" ON public.member_program_history
  FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
REVOKE ALL ON public.member_program_history FROM anon, authenticated;
GRANT SELECT ON public.member_program_history TO authenticated;
GRANT ALL ON public.member_program_history TO service_role;

-- A day that's still to do: never opened, nothing logged, and not one that
-- was already missed before the program came off the calendar (_off).
CREATE OR REPLACE FUNCTION public.member_program_day_open(_day_id uuid, _off date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = _day_id)
     AND NOT EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id
                      WHERE r.day_id = _day_id)
     AND coalesce((SELECT min(s.scheduled_date) FROM public.pl_scheduled_workouts s WHERE s.source_day_id = _day_id),
                  (SELECT d.scheduled_date FROM public.pl_days d WHERE d.id = _day_id),
                  _off) >= _off;
$$;
REVOKE ALL ON FUNCTION public.member_program_day_open(uuid, date) FROM PUBLIC, anon, authenticated;

-- Every archive or un-archive of a block a member started themselves keeps the
-- history row in step, whichever path did it (end, pause, a switch from either
-- start function, a coach's archive). The reason comes from the function that
-- archived it (jf.program_off_reason); a member starting another program is a
-- switch; anything else reads as ended.
CREATE OR REPLACE FUNCTION public.tg_member_program_history()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_owner uuid;
  v_tz text;
  v_key uuid := coalesce(NEW.prep_id, NEW.id);
  v_reason text;
BEGIN
  IF NEW.archived IS NOT DISTINCT FROM OLD.archived THEN RETURN NULL; END IF;
  IF coalesce(NEW.source_template_block_key, '') LIKE 'at_home_backup%' THEN RETURN NULL; END IF;
  SELECT c.user_id, c.timezone INTO v_owner, v_tz FROM public.clients c WHERE c.id = NEW.client_id;
  -- only a program the athlete put on their calendar themselves; a coach's program is the coach's
  IF v_owner IS NULL OR NEW.created_by IS DISTINCT FROM v_owner THEN RETURN NULL; END IF;

  IF coalesce(NEW.archived, false) THEN
    v_reason := nullif(current_setting('jf.program_off_reason', true), '');
    IF v_reason IS NULL OR v_reason NOT IN ('paused', 'ended', 'switched') THEN
      v_reason := CASE WHEN auth.uid() = v_owner THEN 'switched' ELSE 'ended' END;
    END IF;
    INSERT INTO public.member_program_history (program_key, user_id, client_id, reason, off_on, archived_at)
    VALUES (v_key, v_owner, NEW.client_id, v_reason, public.pt_local_today(coalesce(v_tz, 'America/Winnipeg')), now())
    ON CONFLICT (program_key) DO UPDATE
      SET reason = excluded.reason, off_on = excluded.off_on, archived_at = excluded.archived_at,
          hidden_at = NULL, updated_at = now();
  ELSE
    -- back on the calendar: it isn't history any more
    DELETE FROM public.member_program_history WHERE program_key = v_key;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_member_program_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS member_program_history_trg ON public.pl_blocks;
CREATE TRIGGER member_program_history_trg
  AFTER UPDATE OF archived ON public.pl_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_program_history();

-- Programs archived before today: in the history as ended, on the day they came off.
INSERT INTO public.member_program_history (program_key, user_id, client_id, reason, off_on, archived_at)
SELECT coalesce(b.prep_id, b.id), c.user_id, b.client_id, 'ended',
       public.instant_to_local(max(coalesce(b.archived_at, b.updated_at, now())), coalesce(c.timezone, 'America/Winnipeg'))::date,
       max(coalesce(b.archived_at, b.updated_at, now()))
  FROM public.pl_blocks b JOIN public.clients c ON c.id = b.client_id
 WHERE b.archived = true AND b.created_by = c.user_id
   AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%'
 GROUP BY coalesce(b.prep_id, b.id), c.user_id, b.client_id, c.timezone
ON CONFLICT (program_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Archive a member's program (every block of it, and its pl_preps record).
-- Never deletes anything. Server only (the functions below, and starting a
-- JF Effect plan, which archives the plan it replaces as the server).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._member_program_archive(_client uuid, _uid uuid, _block_ids uuid[], _reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ids uuid[];
  v_n int := 0;
BEGIN
  IF _reason NOT IN ('paused', 'ended', 'switched') THEN
    RAISE EXCEPTION 'Unknown reason' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(x.id) INTO v_ids FROM public.pl_blocks x
   WHERE x.client_id = _client AND x.created_by = _uid AND x.archived = false
     AND coalesce(x.source_template_block_key, '') NOT LIKE 'at_home_backup%'
     AND (x.id = ANY (_block_ids)
          OR x.prep_id IN (SELECT b.prep_id FROM public.pl_blocks b WHERE b.id = ANY (_block_ids) AND b.prep_id IS NOT NULL));
  IF v_ids IS NULL THEN RETURN 0; END IF;
  PERFORM set_config('jf.program_off_reason', _reason, true);
  UPDATE public.pl_blocks SET status = 'Archived', archived = true, archived_at = now(), archived_by = _uid
   WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.pl_preps SET status = 'Archived', archived = true, archived_at = now(), archived_by = _uid
   WHERE created_by = _uid AND archived = false
     AND id IN (SELECT b.prep_id FROM public.pl_blocks b WHERE b.id = ANY (v_ids) AND b.prep_id IS NOT NULL);
  PERFORM set_config('jf.program_off_reason', '', true);
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._member_program_archive(uuid, uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._member_program_archive(uuid, uuid, uuid[], text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. End or pause the program a block belongs to: always archived.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.member_program_end(uuid, boolean);
CREATE OR REPLACE FUNCTION public.member_program_end(_block_id uuid, _confirm boolean DEFAULT false,
                                                     _reason text DEFAULT 'ended')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_tz text;
  v_today date;
  b public.pl_blocks%ROWTYPE;
  v_ids uuid[];
  v_name text;
  v_logged int;
  v_upcoming int;
  v_reason text := coalesce(nullif(_reason, ''), 'ended');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_reason NOT IN ('paused', 'ended') THEN
    RAISE EXCEPTION 'Pause or end only' USING ERRCODE = '22023';
  END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND coalesce(c.archived, false) = false LIMIT 1;
  SELECT * INTO b FROM public.pl_blocks
   WHERE id = _block_id AND client_id = v_client AND created_by = v_uid AND archived = false;
  IF v_client IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'This program isn''t yours to end. Your coach manages it.' USING ERRCODE = '42501';
  END IF;
  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));

  -- the whole program: a JF Effect plan with several blocks shares one pl_preps record
  SELECT array_agg(x.id ORDER BY x.start_date NULLS LAST, x.sort_order, x.created_at) INTO v_ids
    FROM public.pl_blocks x
   WHERE x.client_id = v_client AND x.created_by = v_uid AND x.archived = false
     AND (x.id = b.id OR (b.prep_id IS NOT NULL AND x.prep_id = b.prep_id));
  v_name := coalesce((SELECT nullif(btrim(pr.title), '') FROM public.pl_preps pr WHERE pr.id = b.prep_id), b.name);

  SELECT count(*) FILTER (WHERE public.pl_day_logged(d.id)),
         count(*) FILTER (WHERE NOT public.pl_day_logged(d.id) AND (d.scheduled_date IS NULL OR d.scheduled_date >= v_today))
    INTO v_logged, v_upcoming
    FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
   WHERE w.block_id = ANY (v_ids)
     AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
     AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL;

  IF NOT coalesce(_confirm, false) THEN
    RETURN jsonb_build_object('name', v_name, 'key', coalesce(b.prep_id, b.id),
                              'blocks', coalesce(array_length(v_ids, 1), 0),
                              'logged', coalesce(v_logged, 0), 'upcoming', coalesce(v_upcoming, 0),
                              'outcome', 'archive', 'ended', false);
  END IF;

  PERFORM public._member_program_archive(v_client, v_uid, v_ids, v_reason);

  RETURN jsonb_build_object('name', v_name, 'key', coalesce(b.prep_id, b.id),
                            'blocks', coalesce(array_length(v_ids, 1), 0),
                            'logged', coalesce(v_logged, 0), 'upcoming', coalesce(v_upcoming, 0),
                            'outcome', 'archive', 'archived', coalesce(array_length(v_ids, 1), 0),
                            'deleted', 0, 'reason', v_reason, 'ended', true);
END;
$$;
REVOKE ALL ON FUNCTION public.member_program_end(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_program_end(uuid, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The member's past programs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_program_history()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_tz text;
  v_self boolean;
  v_access boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT c.id, c.timezone, c.service_tier = 'self_serve' INTO v_client, v_tz, v_self
    FROM public.clients c WHERE c.user_id = v_uid AND coalesce(c.archived, false) = false LIMIT 1;
  IF v_client IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_access := coalesce(v_self, false) AND public.member_can_consume(v_uid);

  RETURN coalesce((
    WITH bl AS (
      SELECT b.id, b.name, b.prep_id, b.start_date, b.end_date, b.sort_order, b.created_at, b.archived_at,
             b.source_template_id, b.source_athlete_program_id, coalesce(b.prep_id, b.id) AS key
        FROM public.pl_blocks b
       WHERE b.client_id = v_client AND b.created_by = v_uid AND b.archived = true
         AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%'
    ),
    prog AS (
      SELECT bl.key,
             (array_agg(bl.name ORDER BY bl.start_date NULLS LAST, bl.sort_order, bl.created_at))[1] AS first_name,
             count(*) AS blocks,
             min(bl.start_date) AS start_date,
             max(bl.end_date) AS end_date,
             max(bl.archived_at) AS archived_at,
             (array_agg(bl.source_template_id) FILTER (WHERE bl.source_template_id IS NOT NULL))[1] AS block_template,
             (array_agg(bl.source_athlete_program_id) FILTER (WHERE bl.source_athlete_program_id IS NOT NULL))[1] AS own_program
        FROM bl GROUP BY bl.key
    ),
    meta AS (
      SELECT p.*, h.reason, h.hidden_at,
             coalesce(h.off_on,
                      public.instant_to_local(coalesce(p.archived_at, now()), coalesce(v_tz, 'America/Winnipeg'))::date) AS off_on,
             coalesce(h.archived_at, p.archived_at) AS off_at,
             pr.title AS prep_title,
             coalesce(pr.source_template_id, p.block_template) AS template_id
        FROM prog p
        LEFT JOIN public.member_program_history h ON h.program_key = p.key
        LEFT JOIN public.pl_preps pr ON pr.id = p.key
    ),
    dy AS (
      SELECT bl.key, d.id, d.day_index, d.title, coalesce(d.is_optional, false) AS optional, w.id AS week_id,
             dense_rank() OVER (PARTITION BY bl.key ORDER BY bl.start_date NULLS LAST, bl.sort_order, bl.created_at, bl.id, w.week_index) AS g,
             public.pl_day_logged(d.id) AS logged,
             (SELECT max(c.completed_at) FROM public.pl_day_completions c WHERE c.day_id = d.id) AS completed_at,
             public.member_program_day_open(d.id, m.off_on) AS open
        FROM bl
        JOIN meta m ON m.key = bl.key
        JOIN public.pl_weeks w ON w.block_id = bl.id AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
        JOIN public.pl_days d ON d.week_id = w.id AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL
    ),
    stats AS (
      SELECT dy.key,
             count(*) AS total,
             count(*) FILTER (WHERE dy.logged) AS done,
             count(*) FILTER (WHERE dy.open) AS remaining,
             max(dy.completed_at) AS last_trained,
             max(dy.g) AS weeks
        FROM dy GROUP BY dy.key
    ),
    per_week AS (
      SELECT dy.key, dy.week_id, count(*) FILTER (WHERE NOT dy.optional) AS core
        FROM dy GROUP BY dy.key, dy.week_id
    ),
    nxt AS (
      SELECT DISTINCT ON (dy.key) dy.key, dy.g, dy.day_index, dy.title
        FROM dy WHERE dy.open
       ORDER BY dy.key, dy.g, dy.day_index
    )
    SELECT jsonb_agg(jsonb_build_object(
             'key', m.key,
             'name', coalesce(nullif(btrim(m.prep_title), ''), m.first_name, 'Program'),
             'reason', coalesce(m.reason, 'ended'),
             'off_on', m.off_on,
             'off_at', m.off_at,
             'start', m.start_date,
             'end', m.end_date,
             'blocks', m.blocks,
             'weeks', coalesce(s.weeks, 0),
             'total', coalesce(s.total, 0),
             'done', coalesce(s.done, 0),
             'remaining', coalesce(s.remaining, 0),
             'last_trained', s.last_trained,
             'next', CASE WHEN n.key IS NULL THEN NULL
                          ELSE jsonb_build_object('week', n.g, 'day', n.day_index, 'title', n.title) END,
             'days_per_week', (SELECT max(pw.core) FROM per_week pw WHERE pw.key = m.key),
             'template_id', m.template_id,
             'plan_id', (SELECT mp.id FROM public.member_plans mp
                          WHERE m.template_id IS NOT NULL AND mp.source_template_id = m.template_id
                            AND mp.status = 'Published' AND mp.membership_status = 'live'
                          ORDER BY mp.updated_at DESC LIMIT 1),
             'program_id', (SELECT ap.id FROM public.athlete_programs ap
                             WHERE ap.id = m.own_program AND ap.owner_id = v_uid AND ap.archived_at IS NULL),
             'origin', CASE WHEN m.own_program IS NOT NULL THEN 'own'
                            WHEN m.template_id IS NOT NULL THEN 'jf' ELSE 'unknown' END,
             'copied', EXISTS (SELECT 1 FROM public.athlete_programs ap
                                WHERE ap.id = m.own_program AND ap.forked_from IS NOT NULL),
             'can_resume', v_access AND coalesce(s.remaining, 0) > 0
           ) ORDER BY m.off_at DESC NULLS LAST)
      FROM meta m
      LEFT JOIN stats s ON s.key = m.key
      LEFT JOIN nxt n ON n.key = m.key
     WHERE m.hidden_at IS NULL
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.member_program_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_program_history() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Resume a past program where they left off.
-- ---------------------------------------------------------------------------
-- The calendar's engine (realignClientToCommittedDays) places each week's
-- workouts on the training days inside that week's 7-day window, counted from
-- the block's start_date; a done or missed workout keeps its place in the
-- window. So when the old dates have gone by, the program is moved (its
-- block, every block after it, their weeks and its pl_preps record) so the
-- window of the week with the next workout starts just early enough that the
-- workouts already done that week sit before _start, and the next one falls
-- on their first training day from _start. Workouts still to do get a date in
-- their new week (never before _start); done and missed ones keep theirs.
CREATE OR REPLACE FUNCTION public._member_program_resume(_uid uuid, _key uuid, _start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_client uuid;
  v_tz text;
  v_days text[];
  v_today date;
  v_start date;
  v_off date;
  v_ids uuid[];
  v_running uuid[];
  v_dows int[];
  v_shift boolean := false;
  v_s date;
  v_newb date;
  v_delta int := 0;
  v_core_before int;
  v_n int;
  v_cnt int;
  v_dt date;
  v_fpos int;
  v_name text;
  f record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.id, c.timezone, c.committed_training_days INTO v_client, v_tz, v_days FROM public.clients c
   WHERE c.user_id = _uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Your coach writes your program, so it can''t be resumed here.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.member_can_consume(_uid) THEN
    RAISE EXCEPTION 'Your account doesn''t have access right now.' USING ERRCODE = '42501';
  END IF;
  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));
  v_start := coalesce(_start, v_today);
  IF v_start < v_today THEN RAISE EXCEPTION 'Pick a date from today on' USING ERRCODE = '22023'; END IF;
  IF v_start > v_today + 120 THEN RAISE EXCEPTION 'Pick a date in the next few months' USING ERRCODE = '22023'; END IF;

  SELECT array_agg(b.id ORDER BY b.start_date NULLS LAST, b.sort_order, b.created_at, b.id) INTO v_ids
    FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = _uid AND b.archived = true
     AND coalesce(b.prep_id, b.id) = _key
     AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%';
  IF v_ids IS NULL THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;

  v_off := coalesce(
    (SELECT h.off_on FROM public.member_program_history h WHERE h.program_key = _key AND h.user_id = _uid),
    (SELECT public.instant_to_local(max(coalesce(b.archived_at, now())), coalesce(v_tz, 'America/Winnipeg'))::date
       FROM public.pl_blocks b WHERE b.id = ANY (v_ids)));

  -- the next workout still to do
  SELECT d.id, d.day_index, coalesce(d.is_optional, false) AS optional, w.id AS week_id, w.week_index,
         b.id AS block_id, b.start_date AS bstart, coalesce(b.week_duration_days, 7) AS dur,
         coalesce((SELECT min(s.scheduled_date) FROM public.pl_scheduled_workouts s WHERE s.source_day_id = d.id),
                  d.scheduled_date) AS on_date
    INTO f
    FROM unnest(v_ids) WITH ORDINALITY AS o(bid, ord)
    JOIN public.pl_blocks b ON b.id = o.bid
    JOIN public.pl_weeks w ON w.block_id = b.id AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
    JOIN public.pl_days d ON d.week_id = w.id AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL
   WHERE public.member_program_day_open(d.id, v_off)
   ORDER BY o.ord, w.week_index, d.day_index
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Every workout in this program is done or past. Start it over instead.' USING ERRCODE = '22023';
  END IF;

  -- the program on their calendar now makes way (archived, never deleted)
  SELECT array_agg(b.id) INTO v_running FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = _uid AND b.archived = false
     AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%';
  IF v_running IS NOT NULL THEN
    PERFORM public._member_program_archive(v_client, _uid, v_running, 'switched');
  END IF;

  v_fpos := array_position(v_ids, f.block_id);
  v_shift := f.on_date IS NULL OR f.on_date < v_start;

  IF v_shift THEN
    SELECT array_agg(CASE lower(x) WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
                                   WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
                                   WHEN 'saturday' THEN 6 END)
      INTO v_dows FROM unnest(coalesce(v_days, '{}'::text[])) x
     WHERE lower(x) IN ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');
    SELECT count(*) INTO v_n FROM public.pl_days d
     WHERE d.week_id = f.week_id AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL;
    SELECT count(*) INTO v_core_before FROM public.pl_days d
     WHERE d.week_id = f.week_id AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL
       AND coalesce(d.is_optional, false) = false AND d.day_index < f.day_index;

    IF coalesce(cardinality(v_dows), 0) = 0 THEN
      -- no training days set: the program's own weekly pattern, the next workout on _start
      v_s := v_start - public.pl_week_day_offset(f.day_index, v_n);
    ELSIF v_core_before = 0 OR v_core_before >= cardinality(v_dows) THEN
      v_s := v_start;
    ELSE
      -- the week's window opens on the training day that leaves exactly the
      -- workouts already behind them that week before _start
      v_cnt := 0;
      v_dt := v_start;
      LOOP
        v_dt := v_dt - 1;
        IF extract(dow FROM v_dt)::int = ANY (v_dows) THEN
          v_cnt := v_cnt + 1;
          EXIT WHEN v_cnt >= v_core_before;
        END IF;
        EXIT WHEN v_dt <= v_start - 14;
      END LOOP;
      v_s := v_dt;
    END IF;

    v_newb := v_s - (f.week_index - 1) * f.dur;
    v_delta := v_newb - coalesce(f.bstart, v_newb);

    -- the block with the next workout and every block after it move together
    UPDATE public.pl_blocks b
       SET start_date = CASE WHEN b.id = f.block_id THEN v_newb ELSE b.start_date + v_delta END,
           end_date = CASE WHEN b.end_date IS NULL THEN NULL
                           WHEN b.id = f.block_id AND f.bstart IS NULL THEN v_newb + (b.weeks * f.dur - 1)
                           ELSE b.end_date + v_delta END
     WHERE b.id = ANY (v_ids[v_fpos:]);
    UPDATE public.pl_weeks w
       SET start_date = b.start_date + (w.week_index - 1) * coalesce(b.week_duration_days, 7),
           end_date = b.start_date + w.week_index * coalesce(b.week_duration_days, 7) - 1
      FROM public.pl_blocks b
     WHERE w.block_id = b.id AND b.id = ANY (v_ids[v_fpos:]) AND b.start_date IS NOT NULL;

    -- the workouts still to do: a date in their new week, never before _start
    WITH todo AS (
      SELECT d.id,
             greatest(coalesce(w.start_date, v_start)
                        + public.pl_week_day_offset(d.day_index,
                            (SELECT count(*)::int FROM public.pl_days x
                              WHERE x.week_id = w.id AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL)),
                      v_start) AS next_date
        FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
       WHERE w.block_id = ANY (v_ids[v_fpos:])
         AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
         AND coalesce(d.archived, false) = false AND d.deleted_at IS NULL
         AND public.member_program_day_open(d.id, v_off)
    ), moved AS (
      UPDATE public.pl_days d
         SET scheduled_date = t.next_date, schedule_source = 'builder_assignment', schedule_locked = false
        FROM todo t WHERE d.id = t.id
      RETURNING d.id, d.scheduled_date
    )
    UPDATE public.pl_scheduled_workouts s
       SET scheduled_date = m.scheduled_date, schedule_source = 'program'
      FROM moved m WHERE s.source_day_id = m.id;
  END IF;

  -- back on the calendar: done blocks completed, the one with the next workout active, the rest to come
  UPDATE public.pl_blocks b
     SET archived = false, archived_at = NULL, archived_by = NULL,
         status = CASE WHEN array_position(v_ids, b.id) < v_fpos THEN 'Completed'
                       WHEN b.id = f.block_id THEN 'Active' ELSE 'Draft' END
   WHERE b.id = ANY (v_ids);
  UPDATE public.pl_preps p
     SET archived = false, archived_at = NULL, archived_by = NULL, status = 'Active',
         start_date = (SELECT min(b.start_date) FROM public.pl_blocks b WHERE b.id = ANY (v_ids)),
         end_date = (SELECT max(b.end_date) FROM public.pl_blocks b WHERE b.id = ANY (v_ids))
   WHERE p.id = _key AND p.created_by = _uid;
  -- the trigger removed it from the history; make sure, even for a block a coach archived
  DELETE FROM public.member_program_history WHERE program_key = _key;

  v_name := coalesce((SELECT nullif(btrim(p.title), '') FROM public.pl_preps p WHERE p.id = _key),
                     (SELECT b.name FROM public.pl_blocks b WHERE b.id = v_ids[1]));
  RETURN jsonb_build_object('key', _key, 'name', v_name, 'block_id', f.block_id, 'client_id', v_client,
                            'next_day_id', f.id, 'moved', v_shift, 'shift_days', v_delta,
                            'replaced', coalesce(array_length(v_running, 1), 0));
END;
$$;
REVOKE ALL ON FUNCTION public._member_program_resume(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.member_program_resume(_key uuid, _start date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public._member_program_resume(auth.uid(), _key, _start);
$$;
REVOKE ALL ON FUNCTION public.member_program_resume(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_program_resume(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Undo a start: the program just started goes, the one it replaced comes back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_program_undo_start(_block_id uuid, _restore_key uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  b public.pl_blocks%ROWTYPE;
  v_ids uuid[];
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.id INTO v_client FROM public.clients c
   WHERE c.user_id = v_uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false;
  SELECT * INTO b FROM public.pl_blocks
   WHERE id = _block_id AND client_id = v_client AND created_by = v_uid AND archived = false;
  IF v_client IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'That program can''t be undone.' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(x.id) INTO v_ids FROM public.pl_blocks x
   WHERE x.client_id = v_client AND x.created_by = v_uid AND x.archived = false
     AND (x.id = b.id OR (b.prep_id IS NOT NULL AND x.prep_id = b.prep_id));
  IF EXISTS (SELECT 1 FROM public.pl_blocks x WHERE x.id = ANY (v_ids) AND x.created_at < now() - interval '30 minutes') THEN
    RAISE EXCEPTION 'It''s too late to undo. End it from Manage instead.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
              WHERE w.block_id = ANY (v_ids)
                AND (public.pl_day_logged(d.id) OR EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = d.id))) THEN
    RAISE EXCEPTION 'You''ve started a workout in it, so it stays. End it from Manage instead.' USING ERRCODE = '22023';
  END IF;

  -- nothing in it was opened or logged: it goes as if it was never started
  BEGIN
    DELETE FROM public.pl_blocks WHERE id = ANY (v_ids);
    IF b.prep_id IS NOT NULL THEN
      DELETE FROM public.pl_preps p WHERE p.id = b.prep_id AND p.created_by = v_uid
         AND NOT EXISTS (SELECT 1 FROM public.pl_blocks x WHERE x.prep_id = p.id);
    END IF;
  EXCEPTION WHEN others THEN
    -- anything that won't let go is archived and kept out of the history list instead
    PERFORM public._member_program_archive(v_client, v_uid, v_ids, 'ended');
    UPDATE public.member_program_history SET hidden_at = now() WHERE program_key = coalesce(b.prep_id, b.id);
  END;

  IF _restore_key IS NOT NULL THEN
    v_res := public._member_program_resume(v_uid, _restore_key, NULL);
  END IF;
  RETURN jsonb_build_object('removed', coalesce(array_length(v_ids, 1), 0), 'restored', v_res);
END;
$$;
REVOKE ALL ON FUNCTION public.member_program_undo_start(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_program_undo_start(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Remove a past program from the history list (or put it back).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_program_history_hide(_key uuid, _hidden boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_tz text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND coalesce(c.archived, false) = false LIMIT 1;
  IF v_client IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.pl_blocks b
        WHERE b.client_id = v_client AND b.created_by = v_uid AND b.archived = true
          AND coalesce(b.prep_id, b.id) = _key) THEN
    RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.member_program_history (program_key, user_id, client_id, reason, off_on, hidden_at)
  VALUES (_key, v_uid, v_client, 'ended', public.pt_local_today(coalesce(v_tz, 'America/Winnipeg')),
          CASE WHEN coalesce(_hidden, true) THEN now() END)
  ON CONFLICT (program_key) DO UPDATE
    SET hidden_at = CASE WHEN coalesce(_hidden, true) THEN now() END, updated_at = now()
  WHERE member_program_history.user_id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.member_program_history_hide(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_program_history_hide(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Deleting a saved program can be undone.
-- ---------------------------------------------------------------------------
-- It leaves My programs and the crew (athlete_program_visible reads
-- archived_at); the copy running on their calendar keeps its link (nothing
-- edits it while the program is deleted), and its sharing is kept for Undo.
CREATE OR REPLACE FUNCTION public.athlete_program_delete(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.athlete_programs
     SET archived_at = now(), updated_at = now()
   WHERE id = _id AND owner_id = auth.uid() AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_delete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.athlete_program_restore(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.athlete_programs WHERE owner_id = v_uid AND archived_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'You have 50 programs. Delete one first.' USING ERRCODE = '54000';
  END IF;
  UPDATE public.athlete_programs
     SET archived_at = NULL, updated_at = now()
   WHERE id = _id AND owner_id = v_uid AND archived_at IS NOT NULL AND archived_at > now() - interval '30 days';
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_restore(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_restore(uuid) TO authenticated;
