-- Clear stale auto-computed week dates that fall outside their block's
-- date range. This happens when a block's start_date is moved but its
-- weeks were never recomputed, causing later-block workouts to render
-- on top of earlier-block dates in the calendar.
-- Only touches week date metadata (date_source = 'auto'). Manual
-- overrides, day rows, completions, logs, and program structure are
-- left untouched.
UPDATE public.pl_weeks w
SET start_date = NULL,
    end_date = NULL,
    date_source = 'auto'
FROM public.pl_blocks b
WHERE w.block_id = b.id
  AND COALESCE(w.date_source, 'auto') = 'auto'
  AND w.start_date IS NOT NULL
  AND b.start_date IS NOT NULL
  AND b.end_date IS NOT NULL
  AND (w.start_date < b.start_date OR w.end_date > b.end_date);