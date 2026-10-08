-- Member history -> pl_* : DRY RUN. Read-only. Changes nothing.
--
-- Run in the Supabase SQL editor (or psql) as one script. Everything is
-- inside a READ ONLY transaction that ends in ROLLBACK, so even a pasted
-- typo can't write. See docs/member-history-move.md for what each result
-- means and the decisions the real move needs.
--
-- Source (member plan engine):
--   member_plan_enrollments  one per member per plan they started
--   member_workout_completions (enrollment, week, day)          -> pl_day_completions
--   member_set_logs (enrollment, week, day, exercise, set)      -> pl_row_results
--   member_exercise_notes (enrollment, week, day, exercise)     -> pl_exercise_notes
--   member_workout_reviews (enrollment, week, day)              -> pl_workout_feedback
--   member_plans.published_payload  weeks_data[w-1].days[d-1].rows[e]
--     (week/day are 1-based, exercise_index is 0-based, same as
--      src/lib/workout-context/member-adapter.ts)
--
-- Target: the member's athlete row (clients.athlete_kind = 'member'), one
-- archived pl_block per enrollment with logged history.

BEGIN TRANSACTION READ ONLY;

-- 1. Per member: how much history, and whether it has somewhere to go.
WITH enr AS (
  SELECT member_id, count(*) AS enrollments
    FROM public.member_plan_enrollments GROUP BY member_id
), comp AS (
  SELECT e.member_id, count(*) AS completions,
         min(c.completed_at) AS first_completed_at, max(c.completed_at) AS last_completed_at
    FROM public.member_workout_completions c
    JOIN public.member_plan_enrollments e ON e.id = c.enrollment_id
   GROUP BY e.member_id
), sets AS (
  SELECT e.member_id, count(*) AS set_logs,
         count(DISTINCT (s.enrollment_id, s.week_index, s.day_index)) AS logged_days
    FROM public.member_set_logs s
    JOIN public.member_plan_enrollments e ON e.id = s.enrollment_id
   GROUP BY e.member_id
)
SELECT m.id AS member_id, m.full_name, m.email, m.status AS member_status,
       enr.enrollments,
       coalesce(comp.completions, 0) AS completions,
       coalesce(sets.set_logs, 0) AS set_logs,
       coalesce(sets.logged_days, 0) AS logged_days,
       comp.first_completed_at, comp.last_completed_at,
       ath.id AS athlete_client_id, ath.athlete_kind,
       CASE
         WHEN coalesce(comp.completions, 0) = 0 AND coalesce(sets.set_logs, 0) = 0 THEN 'skip: no history'
         WHEN m.user_id IS NULL THEN 'decide: no login linked'
         WHEN ath.athlete_kind = 'coaching' THEN 'decide: login is also a coaching client'
         WHEN ath.id IS NOT NULL THEN 'ready: athlete row exists'
         WHEN public.member_has_access(m.id, 'app_membership') THEN 'ready: athlete row would be created'
         ELSE 'decide: lapsed member, no athlete row'
       END AS move_status
  FROM enr
  JOIN public.app_members m ON m.id = enr.member_id
  LEFT JOIN comp ON comp.member_id = m.id
  LEFT JOIN sets ON sets.member_id = m.id
  LEFT JOIN LATERAL (
    SELECT c.id, c.athlete_kind FROM public.clients c
     WHERE m.user_id IS NOT NULL AND c.user_id = m.user_id
     ORDER BY (c.athlete_kind = 'coaching') DESC, c.created_at
     LIMIT 1
  ) ath ON true
 ORDER BY move_status, set_logs DESC;

-- 2. Totals by move_status: the size of the move.
WITH per AS (
  SELECT e.member_id,
         (SELECT count(*) FROM public.member_workout_completions c
            JOIN public.member_plan_enrollments e2 ON e2.id = c.enrollment_id
           WHERE e2.member_id = e.member_id) AS completions,
         (SELECT count(*) FROM public.member_set_logs s
            JOIN public.member_plan_enrollments e2 ON e2.id = s.enrollment_id
           WHERE e2.member_id = e.member_id) AS set_logs
    FROM (SELECT DISTINCT member_id FROM public.member_plan_enrollments) e
)
SELECT CASE
         WHEN per.completions = 0 AND per.set_logs = 0 THEN 'skip: no history'
         WHEN m.user_id IS NULL THEN 'decide: no login linked'
         WHEN EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = m.user_id AND c.athlete_kind = 'coaching')
           THEN 'decide: login is also a coaching client'
         WHEN EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = m.user_id) THEN 'ready: athlete row exists'
         WHEN public.member_has_access(m.id, 'app_membership') THEN 'ready: athlete row would be created'
         ELSE 'decide: lapsed member, no athlete row'
       END AS move_status,
       count(*) AS members,
       sum(per.completions) AS completions,
       sum(per.set_logs) AS set_logs
  FROM per JOIN public.app_members m ON m.id = per.member_id
 GROUP BY 1 ORDER BY 1;

-- 3. What the move would create in pl_*, per enrollment with history.
--    blocks = 1 per enrollment, days = distinct (week, day) touched,
--    rows = distinct (week, day, exercise) with set logs,
--    results = set logs, completions = completions.
WITH touched_days AS (
  SELECT enrollment_id, week_index, day_index FROM public.member_workout_completions
  UNION
  SELECT enrollment_id, week_index, day_index FROM public.member_set_logs
), touched_rows AS (
  SELECT DISTINCT enrollment_id, week_index, day_index, exercise_index FROM public.member_set_logs
)
SELECT e.member_id, e.id AS enrollment_id, p.name AS plan_name, e.status AS enrollment_status,
       (SELECT count(*) FROM touched_days t WHERE t.enrollment_id = e.id) AS pl_days,
       (SELECT count(*) FROM touched_rows r WHERE r.enrollment_id = e.id) AS pl_exercise_rows,
       (SELECT count(*) FROM public.member_set_logs s WHERE s.enrollment_id = e.id) AS pl_row_results,
       (SELECT count(*) FROM public.member_workout_completions c WHERE c.enrollment_id = e.id) AS pl_day_completions,
       (SELECT count(*) FROM public.member_exercise_notes n WHERE n.enrollment_id = e.id) AS pl_exercise_notes,
       (SELECT count(*) FROM public.member_workout_reviews v WHERE v.enrollment_id = e.id) AS pl_workout_feedback
  FROM public.member_plan_enrollments e
  JOIN public.member_plans p ON p.id = e.plan_id
 WHERE EXISTS (SELECT 1 FROM touched_days t WHERE t.enrollment_id = e.id)
 ORDER BY e.member_id, e.started_at;

-- 4. Exercise mapping: every (enrollment, week, day, exercise) that has set
--    logs, resolved the way the member app resolves it (logged exercise_id,
--    then the member's swap, then the published plan row, then the name
--    through resolve_exercise_id). 'unmapped' rows would land with no
--    library exercise: only the name, as exercise_name_override.
WITH grp AS (
  SELECT s.enrollment_id, s.week_index, s.day_index, s.exercise_index,
         count(*) AS set_logs,
         (array_agg(s.exercise_id ORDER BY s.logged_at DESC) FILTER (WHERE s.exercise_id IS NOT NULL))[1] AS logged_exercise_id
    FROM public.member_set_logs s
   GROUP BY 1, 2, 3, 4
), resolved AS (
  SELECT g.*,
         sw.exercise_id AS swap_exercise_id,
         pr.row_json,
         CASE WHEN pr.row_json ? 'exercise_id' AND (pr.row_json->>'exercise_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (pr.row_json->>'exercise_id')::uuid END AS payload_exercise_id,
         coalesce(pr.row_json->>'exercise', pr.row_json->>'name') AS payload_name
    FROM grp g
    JOIN public.member_plan_enrollments e ON e.id = g.enrollment_id
    JOIN public.member_plans p ON p.id = e.plan_id
    LEFT JOIN public.member_exercise_swaps sw
      ON sw.enrollment_id = g.enrollment_id AND sw.week_index = g.week_index
     AND sw.day_index = g.day_index AND sw.exercise_index = g.exercise_index
    LEFT JOIN LATERAL (
      SELECT p.published_payload->'weeks_data'->(g.week_index - 1)->'days'->(g.day_index - 1)->'rows'->g.exercise_index AS row_json
    ) pr ON true
), final AS (
  SELECT r.*,
         coalesce(r.logged_exercise_id, r.swap_exercise_id, r.payload_exercise_id) AS exercise_id
    FROM resolved r
)
SELECT f.enrollment_id, f.week_index, f.day_index, f.exercise_index, f.set_logs,
       f.exercise_id, x.name AS library_name, f.payload_name,
       -- What pl_exercise_rows_autolink would pick from the name (same
       -- resolver every import path uses), so no duplicate exercises.
       CASE WHEN x.id IS NULL THEN public.resolve_exercise_id(f.payload_name) END AS name_resolves_to,
       CASE
         WHEN x.id IS NOT NULL THEN 'ok'
         WHEN public.resolve_exercise_id(f.payload_name) IS NOT NULL THEN 'ok: resolved by name'
         WHEN f.exercise_id IS NOT NULL THEN 'unmapped: exercise deleted from library'
         WHEN f.row_json IS NULL THEN 'unmapped: day/exercise not in published plan'
         WHEN f.payload_name IS NOT NULL THEN 'unmapped: name not in library'
         ELSE 'unmapped: no id or name'
       END AS mapping
  FROM final f
  LEFT JOIN public.exercises x ON x.id = f.exercise_id
 ORDER BY (x.id IS NOT NULL), f.enrollment_id, f.week_index, f.day_index, f.exercise_index;

-- 5. Mapping summary (counts of 4).
WITH grp AS (
  SELECT s.enrollment_id, s.week_index, s.day_index, s.exercise_index, count(*) AS set_logs,
         (array_agg(s.exercise_id) FILTER (WHERE s.exercise_id IS NOT NULL))[1] AS logged_exercise_id
    FROM public.member_set_logs s GROUP BY 1, 2, 3, 4
), final AS (
  SELECT g.*,
         p.published_payload->'weeks_data'->(g.week_index - 1)->'days'->(g.day_index - 1)->'rows'->g.exercise_index AS row_json,
         coalesce(g.logged_exercise_id, sw.exercise_id,
           CASE WHEN (p.published_payload->'weeks_data'->(g.week_index - 1)->'days'->(g.day_index - 1)->'rows'->g.exercise_index->>'exercise_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (p.published_payload->'weeks_data'->(g.week_index - 1)->'days'->(g.day_index - 1)->'rows'->g.exercise_index->>'exercise_id')::uuid END
         ) AS exercise_id
    FROM grp g
    JOIN public.member_plan_enrollments e ON e.id = g.enrollment_id
    JOIN public.member_plans p ON p.id = e.plan_id
    LEFT JOIN public.member_exercise_swaps sw
      ON sw.enrollment_id = g.enrollment_id AND sw.week_index = g.week_index
     AND sw.day_index = g.day_index AND sw.exercise_index = g.exercise_index
)
SELECT CASE
         WHEN x.id IS NOT NULL THEN 'ok'
         WHEN public.resolve_exercise_id(coalesce(f.row_json->>'exercise', f.row_json->>'name')) IS NOT NULL THEN 'ok: resolved by name'
         WHEN f.exercise_id IS NOT NULL THEN 'unmapped: exercise deleted from library'
         WHEN f.row_json IS NULL THEN 'unmapped: day/exercise not in published plan'
         WHEN coalesce(f.row_json->>'exercise', f.row_json->>'name') IS NOT NULL THEN 'unmapped: name not in library'
         ELSE 'unmapped: no id or name'
       END AS mapping,
       count(*) AS exercise_rows, sum(f.set_logs) AS set_logs
  FROM final f LEFT JOIN public.exercises x ON x.id = f.exercise_id
 GROUP BY 1 ORDER BY 1;

-- 6. Edge cases the move has to handle on purpose.
SELECT 'set logs with no reps and no load' AS check_name, count(*) AS n
  FROM public.member_set_logs WHERE reps IS NULL AND load_kg IS NULL AND load_lb IS NULL AND entered_value IS NULL
UNION ALL
SELECT 'logged days never marked complete', count(*) FROM (
  SELECT DISTINCT s.enrollment_id, s.week_index, s.day_index FROM public.member_set_logs s
   WHERE NOT EXISTS (SELECT 1 FROM public.member_workout_completions c
                      WHERE c.enrollment_id = s.enrollment_id AND c.week_index = s.week_index AND c.day_index = s.day_index)) d
UNION ALL
SELECT 'completions with no set logs', count(*) FROM public.member_workout_completions c
 WHERE NOT EXISTS (SELECT 1 FROM public.member_set_logs s
                    WHERE s.enrollment_id = c.enrollment_id AND s.week_index = c.week_index AND s.day_index = c.day_index)
UNION ALL
SELECT 'completions that would fire trg_award_workout_xp', count(*) FROM public.member_workout_completions
UNION ALL
SELECT 'reviews that would fire trg_xp_workout_feedback', count(*) FROM public.member_workout_reviews
UNION ALL
SELECT 'enrollments whose plan has no published weeks', count(*) FROM public.member_plan_enrollments e
  JOIN public.member_plans p ON p.id = e.plan_id
 WHERE jsonb_typeof(p.published_payload->'weeks_data') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p.published_payload->'weeks_data') = 0;

ROLLBACK;
