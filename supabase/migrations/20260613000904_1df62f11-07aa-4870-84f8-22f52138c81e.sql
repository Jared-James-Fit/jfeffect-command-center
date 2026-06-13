UPDATE public.exercises
SET exercise_category = 'competition',
    is_competition_lift = true,
    competition_lift_type = CASE
      WHEN lower(name) LIKE '%squat%'    THEN 'squat'
      WHEN lower(name) LIKE '%bench%'    THEN 'bench'
      WHEN lower(name) LIKE '%deadlift%' THEN 'deadlift'
    END
WHERE name IN ('Competition Squat', 'Competition Bench Press', 'Competition Deadlift');