-- Membership + Coaching unification, Phase 3: retire the /m workout system.
--
-- Members now train on the shared program system (pl_blocks, started from the
-- Plan Library via the coach's assign engine), so the member-only copy of
-- workouts (enrollments, their day schedule, set logs, completions, reviews,
-- swaps, exercise notes and unit prefs) is history only. Members keep reading
-- their own rows (nothing is deleted: 3 old enrollments, 0 logged sets);
-- their write policies go. Admin policies stay, so an exercise merge
-- (merge_duplicate_exercise, run as the admin) still re-points old rows.
-- Dropping the tables waits until this has been live and verified.

DROP POLICY IF EXISTS "Member write own enrollments when active" ON public.member_plan_enrollments;
DROP POLICY IF EXISTS "Member write own schedule when active" ON public.member_plan_day_schedule;
DROP POLICY IF EXISTS "Member write own set logs when active" ON public.member_set_logs;
DROP POLICY IF EXISTS "Member write own completions when active" ON public.member_workout_completions;
DROP POLICY IF EXISTS "Member insert own member_workout_reviews" ON public.member_workout_reviews;
DROP POLICY IF EXISTS "Member update own member_workout_reviews" ON public.member_workout_reviews;

-- these three had one "manage own" policy for everything: now read-only
DROP POLICY IF EXISTS "members manage own swaps" ON public.member_exercise_swaps;
DROP POLICY IF EXISTS "Members read own swaps" ON public.member_exercise_swaps;
CREATE POLICY "Members read own swaps" ON public.member_exercise_swaps
  FOR SELECT TO authenticated
  USING (enrollment_id IN (
    SELECT e.id FROM public.member_plan_enrollments e
      JOIN public.app_members m ON m.id = e.member_id
     WHERE m.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Members manage own exercise notes" ON public.member_exercise_notes;
DROP POLICY IF EXISTS "Members read own exercise notes" ON public.member_exercise_notes;
CREATE POLICY "Members read own exercise notes" ON public.member_exercise_notes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Members manage own unit prefs" ON public.member_exercise_unit_prefs;
DROP POLICY IF EXISTS "Members read own unit prefs" ON public.member_exercise_unit_prefs;
CREATE POLICY "Members read own unit prefs" ON public.member_exercise_unit_prefs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
