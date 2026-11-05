-- Rollback for 20270201090000_free_platform_hardening.sql (by hand, only if
-- this hardening has to be undone). Re-run the function definitions from
-- 20270128090000_free_platform.sql for: _member_free_join,
-- athlete_program_clean_days, athlete_program_copy, athlete_program_moderate,
-- community_report, athlete_program_start, athlete_program_card and
-- athlete_programs_browse; then:

DROP TRIGGER IF EXISTS exercise_merge_athlete_programs ON public.exercise_dedupe_audit;
DROP FUNCTION IF EXISTS public.tg_exercise_merge_athlete_programs();
GRANT EXECUTE ON FUNCTION public.athlete_program_visible(uuid, text, timestamptz, timestamptz) TO authenticated;
-- Who started what (it only feeds start_count): safe to drop.
DROP TABLE IF EXISTS public.athlete_program_starts;
-- Leads already linked by a free join stay linked (that's their record now).
