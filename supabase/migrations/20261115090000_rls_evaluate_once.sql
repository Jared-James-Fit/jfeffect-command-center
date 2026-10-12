-- Row-level security that checks the signed-in user once per query, not once per row.
--
-- Most policies called helpers like has_role(auth.uid(), 'admin') or
-- is_assigned_coach(client_id) bare, so Postgres re-ran them for every row it
-- looked at: loading one training block as a client took ~260ms to plan and
-- ~280ms to run for 136 rows. Wrapping a user-only check in (SELECT ...) makes
-- it an InitPlan (run once), and "client_id IN (SELECT coached_client_ids())"
-- is one hashed lookup instead of a function call per row.
--
-- Who can see or change what is unchanged: every rewrite is the same check,
-- evaluated once. public.rls_evaluate_once() is idempotent; a migration that
-- adds policies can run it again (optionally for one table).
--
-- ALTER POLICY takes a brief exclusive lock on its table. Never hold that behind
-- a long-running reader (a backup): give up fast instead of stalling the app.
SET lock_timeout = '3s';

-- The clients an active coach is assigned (what is_assigned_coach checks, as a set).
CREATE OR REPLACE FUNCTION public.coached_client_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE co.user_id = auth.uid()
     AND co.archived = false
     AND co.status = 'Active'
$$;

-- The app members whose client account that coach is assigned (is_assigned_coach_for_member, as a set).
CREATE OR REPLACE FUNCTION public.coached_member_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
    FROM public.app_members m
    JOIN public.clients c ON c.user_id = m.user_id
   WHERE c.id IN (SELECT public.coached_client_ids())
$$;

GRANT EXECUTE ON FUNCTION public.coached_client_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coached_member_ids() TO anon, authenticated;

-- One policy expression, rewritten so its user-only checks run once.
CREATE OR REPLACE FUNCTION public.rls_once_expr(e text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF e IS NULL THEN
    RETURN NULL;
  END IF;
  -- helpers of the signed-in user (and a constant): has_role(auth.uid(), 'admin'::app_role)
  e := regexp_replace(e,
    '(?<![._[:alnum:]])(?<!SELECT )(has_role|has_permission|is_coach_or_admin|is_admin_or_media_manager|is_media_manager|is_business_owner|is_active_coach)\(auth\.uid\(\)((, ''[^'']*''::[a-z_]+)?)\)',
    '(SELECT \1((SELECT auth.uid())\2))', 'g');
  -- helpers with no arguments that only read the signed-in user
  e := regexp_replace(e,
    '(?<![._[:alnum:]])(?<!SELECT )(current_member_id|current_coach_id|linked_client_id|is_admin_viewer|is_exercise_library_staff|is_community_staff)\(\)',
    '(SELECT \1())', 'g');
  -- per-row coach checks become one set lookup
  e := regexp_replace(e,
    '(?<![._[:alnum:]])is_assigned_coach_for_member\(([a-z_]+(\.[a-z_]+)?)\)',
    '(\1 IN (SELECT coached_member_ids()))', 'g');
  e := regexp_replace(e,
    '(?<![._[:alnum:]])is_assigned_coach(_for_client)?\(([a-z_]+(\.[a-z_]+)?)\)',
    '(\2 IN (SELECT coached_client_ids()))', 'g');
  -- whatever auth.uid() / auth.role() is left
  e := regexp_replace(e, '(?<!SELECT )auth\.(uid|role)\(\)', '(SELECT auth.\1())', 'g');
  RETURN e;
END;
$$;

-- Apply it to every policy in public (or one table's); returns how many changed.
CREATE OR REPLACE FUNCTION public.rls_evaluate_once(_table text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
  nq text;
  nw text;
  stmt text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (_table IS NULL OR tablename = _table)
  LOOP
    nq := public.rls_once_expr(r.qual);
    nw := public.rls_once_expr(r.with_check);
    CONTINUE WHEN nq IS NOT DISTINCT FROM r.qual AND nw IS NOT DISTINCT FROM r.with_check;
    stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF nq IS DISTINCT FROM r.qual THEN
      stmt := stmt || format(' USING (%s)', nq);
    END IF;
    IF nw IS DISTINCT FROM r.with_check THEN
      stmt := stmt || format(' WITH CHECK (%s)', nw);
    END IF;
    EXECUTE stmt;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.rls_once_expr(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_evaluate_once(text) FROM PUBLIC, anon, authenticated;

-- The training-plan tree (blocks > weeks > days > exercise rows) checked each
-- row with a multi-table EXISTS, which the planner inlined into every query
-- (~190ms of planning to load one block). The same visibility as sets:
CREATE OR REPLACE FUNCTION public.client_visible_pl_block_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.pl_blocks b JOIN public.clients c ON c.id = b.client_id
   WHERE b.client_visible AND c.user_id = auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.linked_visible_pl_block_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.pl_blocks b
   WHERE b.client_visible AND b.client_id = public.linked_client_id()
$$;
CREATE OR REPLACE FUNCTION public.coach_manageable_pl_block_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.pl_blocks b WHERE b.client_id IN (SELECT public.coached_client_ids())
$$;
CREATE OR REPLACE FUNCTION public.client_visible_pl_week_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id FROM public.pl_weeks w WHERE w.block_id IN (SELECT public.client_visible_pl_block_ids())
$$;
CREATE OR REPLACE FUNCTION public.linked_visible_pl_week_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id FROM public.pl_weeks w WHERE w.block_id IN (SELECT public.linked_visible_pl_block_ids())
$$;
CREATE OR REPLACE FUNCTION public.coach_manageable_pl_week_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id FROM public.pl_weeks w WHERE w.block_id IN (SELECT public.coach_manageable_pl_block_ids())
$$;
CREATE OR REPLACE FUNCTION public.linked_visible_pl_day_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id FROM public.pl_days d WHERE d.week_id IN (SELECT public.linked_visible_pl_week_ids())
$$;
GRANT EXECUTE ON FUNCTION public.client_visible_pl_block_ids(), public.linked_visible_pl_block_ids(),
  public.coach_manageable_pl_block_ids(), public.client_visible_pl_week_ids(), public.linked_visible_pl_week_ids(),
  public.coach_manageable_pl_week_ids(), public.linked_visible_pl_day_ids() TO anon, authenticated;

ALTER POLICY "Client read pl_weeks" ON public.pl_weeks
  USING (block_id IN (SELECT public.client_visible_pl_block_ids()));
ALTER POLICY "Linked login reads own pl_weeks" ON public.pl_weeks
  USING (block_id IN (SELECT public.linked_visible_pl_block_ids()));
ALTER POLICY "Coach manage pl_weeks" ON public.pl_weeks
  USING (block_id IN (SELECT public.coach_manageable_pl_block_ids()))
  WITH CHECK (block_id IN (SELECT public.coach_manageable_pl_block_ids()));
ALTER POLICY "Client read pl_days" ON public.pl_days
  USING (week_id IN (SELECT public.client_visible_pl_week_ids()));
ALTER POLICY "Linked login reads own pl_days" ON public.pl_days
  USING (week_id IN (SELECT public.linked_visible_pl_week_ids()));
ALTER POLICY "Coach manage pl_days" ON public.pl_days
  USING (week_id IN (SELECT public.coach_manageable_pl_week_ids()))
  WITH CHECK (week_id IN (SELECT public.coach_manageable_pl_week_ids()));
ALTER POLICY "Linked login reads own pl_exercise_rows" ON public.pl_exercise_rows
  USING (day_id IN (SELECT public.linked_visible_pl_day_ids()));

SELECT public.rls_evaluate_once();
