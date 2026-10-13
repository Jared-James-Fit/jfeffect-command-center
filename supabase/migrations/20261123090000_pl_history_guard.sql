-- Logged training is never deleted by editing a program.
--
-- Deleting a program block, week, day or exercise row cascades to the
-- client's logged sets (pl_row_results) and finished workouts
-- (pl_day_completions). Editing a program could silently wipe history: the
-- block editor's save deletes whatever was removed, "Copy week" and
-- "Copy day" replaced the target days, "Clear future weeks" emptied days.
--
-- Now the database refuses to delete any of those when it holds a logged set
-- or a finished workout. The app checks first (pl_logged_ids) and keeps those
-- parts instead of failing; a whole program with logged workouts is archived
-- instead of deleted. Only a direct delete is checked: deleting a client
-- (which cascades to their programs) is a deliberate purge, and an admin can
-- set jf.allow_history_delete = 'on' for one transaction when it's intended.
--
-- "Logged" = a set was logged, or the workout was finished. A workout that was
-- only opened (nothing logged) isn't history and can still be removed.

CREATE OR REPLACE FUNCTION public.pl_day_logged(_day_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = _day_id AND c.completed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id WHERE r.day_id = _day_id);
$$;
REVOKE ALL ON FUNCTION public.pl_day_logged(uuid) FROM PUBLIC, anon, authenticated;

-- Which of these rows / days / weeks / blocks hold logged training (for the
-- editor, before it deletes anything). Runs as the caller, so it only ever
-- answers about programs the caller can already see.
CREATE OR REPLACE FUNCTION public.pl_logged_ids(_kind text, _ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT DISTINCT r.id FROM public.pl_exercise_rows r
   WHERE _kind = 'row' AND r.id = ANY (_ids)
     AND EXISTS (SELECT 1 FROM public.pl_row_results x WHERE x.row_id = r.id)
  UNION
  SELECT d.id FROM public.pl_days d
   WHERE _kind = 'day' AND d.id = ANY (_ids)
     AND (EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = d.id AND c.completed_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id WHERE r.day_id = d.id))
  UNION
  SELECT DISTINCT d.week_id FROM public.pl_days d
   WHERE _kind = 'week' AND d.week_id = ANY (_ids)
     AND (EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = d.id AND c.completed_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id WHERE r.day_id = d.id))
  UNION
  SELECT DISTINCT w.block_id FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
   WHERE _kind = 'block' AND w.block_id = ANY (_ids)
     AND (EXISTS (SELECT 1 FROM public.pl_day_completions c WHERE c.day_id = d.id AND c.completed_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.pl_exercise_rows r JOIN public.pl_row_results x ON x.row_id = r.id WHERE r.day_id = d.id));
$$;
REVOKE ALL ON FUNCTION public.pl_logged_ids(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_logged_ids(text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.pl_guard_history_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_logged boolean;
  v_msg text;
BEGIN
  -- a cascade (deleting a client, or this block's own weeks) was already checked at the top
  IF pg_trigger_depth() > 1 OR coalesce(current_setting('jf.allow_history_delete', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'pl_exercise_rows' THEN
    v_logged := EXISTS (SELECT 1 FROM public.pl_row_results x WHERE x.row_id = OLD.id);
    v_msg := 'This exercise has logged sets, so it stays. Workout history is never deleted.';
  ELSIF TG_TABLE_NAME = 'pl_days' THEN
    v_logged := public.pl_day_logged(OLD.id);
    v_msg := 'This workout has been logged, so it stays. Workout history is never deleted.';
  ELSIF TG_TABLE_NAME = 'pl_weeks' THEN
    v_logged := EXISTS (SELECT 1 FROM public.pl_days d WHERE d.week_id = OLD.id AND public.pl_day_logged(d.id));
    v_msg := 'This week has logged workouts, so it stays. Workout history is never deleted.';
  ELSE
    v_logged := EXISTS (SELECT 1 FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
                         WHERE w.block_id = OLD.id AND public.pl_day_logged(d.id));
    v_msg := 'This program has logged workouts, so it can''t be deleted. Archive it instead.';
  END IF;
  IF v_logged THEN
    RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001', HINT = 'pl_history_locked';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.pl_guard_history_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pl_guard_history_delete ON public.pl_exercise_rows;
CREATE TRIGGER pl_guard_history_delete BEFORE DELETE ON public.pl_exercise_rows
  FOR EACH ROW EXECUTE FUNCTION public.pl_guard_history_delete();
DROP TRIGGER IF EXISTS pl_guard_history_delete ON public.pl_days;
CREATE TRIGGER pl_guard_history_delete BEFORE DELETE ON public.pl_days
  FOR EACH ROW EXECUTE FUNCTION public.pl_guard_history_delete();
DROP TRIGGER IF EXISTS pl_guard_history_delete ON public.pl_weeks;
CREATE TRIGGER pl_guard_history_delete BEFORE DELETE ON public.pl_weeks
  FOR EACH ROW EXECUTE FUNCTION public.pl_guard_history_delete();
DROP TRIGGER IF EXISTS pl_guard_history_delete ON public.pl_blocks;
CREATE TRIGGER pl_guard_history_delete BEFORE DELETE ON public.pl_blocks
  FOR EACH ROW EXECUTE FUNCTION public.pl_guard_history_delete();
