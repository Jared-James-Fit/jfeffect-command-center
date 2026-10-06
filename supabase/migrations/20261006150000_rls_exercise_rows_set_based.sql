-- Speed: opening a workout / loading the calendar was slow because of the
-- row-level-security rules on pl_exercise_rows.
--
-- The client-read and coach-manage rules each joined pl_days -> pl_weeks ->
-- pl_blocks -> clients inline. Every one of those tables has its own RLS, and
-- Postgres applies it inside the policy subquery too, so the check expanded
-- recursively (a ~230-line plan with 27 scans of `clients`) and was repeated
-- per row. Measured as a client on production data:
--
--   open a workout (6 exercises)      planning ~110 ms + exec ~31 ms  = ~142 ms
--   calendar (~3 weeks, 843 rows)     planning  ~90 ms + exec ~106 ms = ~196 ms
--
-- Same rules, expressed as "which day ids may this user see" via two
-- SECURITY DEFINER set-returning functions. The policy is then an uncorrelated
-- `day_id IN (SELECT ...)` that Postgres evaluates ONCE per query, with no RLS
-- recursion. Same data on a temporary copy of the table with these policies:
--
--   open a workout                    ~2.4 ms
--   calendar                          ~4.8 ms
--
-- Access is unchanged. Verified on production data for every client account
-- (22), the admin, the coach and an unknown user: the set of rows visible under
-- the old and the new rules was identical in every case (stratified sample of
-- the user's own visible rows, their hidden rows, and other people's rows).
--
-- Rules kept exactly:
--   client : SELECT on rows of their own blocks that are client_visible
--   coach  : ALL on rows of blocks of clients assigned to them. The coach join
--            below mirrors is_assigned_coach(): coaches.user_id = auth.uid(),
--            not archived, status 'Active'. If is_assigned_coach changes,
--            change coach_manageable_pl_day_ids() with it.
--   admin  : unchanged (separate policy)
--
-- Rollback (restores the previous rules verbatim):
--   DROP POLICY "Client read pl_exercise_rows" ON public.pl_exercise_rows;
--   CREATE POLICY "Client read pl_exercise_rows" ON public.pl_exercise_rows
--     FOR SELECT TO authenticated USING (EXISTS (
--       SELECT 1 FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id
--         JOIN pl_blocks b ON b.id = w.block_id JOIN clients c ON c.id = b.client_id
--       WHERE d.id = pl_exercise_rows.day_id AND b.client_visible AND c.user_id = auth.uid()));
--   DROP POLICY "Coach manage pl_exercise_rows" ON public.pl_exercise_rows;
--   CREATE POLICY "Coach manage pl_exercise_rows" ON public.pl_exercise_rows
--     FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id
--         JOIN pl_blocks b ON b.id = w.block_id
--       WHERE d.id = pl_exercise_rows.day_id AND is_assigned_coach(b.client_id)))
--     WITH CHECK (EXISTS (SELECT 1 FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id
--         JOIN pl_blocks b ON b.id = w.block_id
--       WHERE d.id = pl_exercise_rows.day_id AND is_assigned_coach(b.client_id)));

CREATE OR REPLACE FUNCTION public.client_visible_pl_day_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id
    FROM public.pl_days d
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    JOIN public.clients c ON c.id = b.client_id
   WHERE b.client_visible AND c.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.coach_manageable_pl_day_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id
    FROM public.coaches co
    JOIN public.clients c ON c.assigned_coach_id = co.id
    JOIN public.pl_blocks b ON b.client_id = c.id
    JOIN public.pl_weeks w ON w.block_id = b.id
    JOIN public.pl_days d ON d.week_id = w.id
   WHERE co.user_id = auth.uid() AND co.archived = false AND co.status = 'Active'
$$;

REVOKE ALL ON FUNCTION public.client_visible_pl_day_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_manageable_pl_day_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_visible_pl_day_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_manageable_pl_day_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "Client read pl_exercise_rows" ON public.pl_exercise_rows;
CREATE POLICY "Client read pl_exercise_rows" ON public.pl_exercise_rows
  FOR SELECT TO authenticated
  USING (day_id IN (SELECT public.client_visible_pl_day_ids()));

DROP POLICY IF EXISTS "Coach manage pl_exercise_rows" ON public.pl_exercise_rows;
CREATE POLICY "Coach manage pl_exercise_rows" ON public.pl_exercise_rows
  FOR ALL TO authenticated
  USING (day_id IN (SELECT public.coach_manageable_pl_day_ids()))
  WITH CHECK (day_id IN (SELECT public.coach_manageable_pl_day_ids()));
