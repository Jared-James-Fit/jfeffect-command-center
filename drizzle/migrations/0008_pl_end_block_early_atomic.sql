CREATE OR REPLACE FUNCTION public.pl_end_block_early(_block_id uuid, _new_end date)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _client uuid;
  _removed int := 0;
  _cleared int := 0;
BEGIN
  SELECT client_id INTO _client FROM public.pl_blocks WHERE id = _block_id;
  IF _client IS NULL THEN
    RAISE EXCEPTION 'Block not found.';
  END IF;

  DELETE FROM public.pl_scheduled_workouts s
  USING public.pl_days d, public.pl_weeks w
  WHERE s.source_day_id = d.id
    AND w.id = d.week_id
    AND w.block_id = _block_id
    AND COALESCE(d.archived, false) = false
    AND d.deleted_at IS NULL
    AND s.scheduled_date IS NOT NULL
    AND s.scheduled_date > _new_end
    AND NOT EXISTS (
      SELECT 1 FROM public.pl_day_completions c
      WHERE c.completed_at IS NOT NULL
        AND (c.scheduled_workout_id = s.id OR c.day_id = d.id)
    );
  GET DIAGNOSTICS _removed = ROW_COUNT;

  UPDATE public.pl_days d
  SET scheduled_date = NULL
  FROM public.pl_weeks w
  WHERE w.id = d.week_id
    AND w.block_id = _block_id
    AND COALESCE(d.archived, false) = false
    AND d.deleted_at IS NULL
    AND d.scheduled_date IS NOT NULL
    AND d.scheduled_date > _new_end
    AND NOT EXISTS (
      SELECT 1 FROM public.pl_scheduled_workouts s WHERE s.source_day_id = d.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.pl_day_completions c
      WHERE c.day_id = d.id AND c.completed_at IS NOT NULL
    );
  GET DIAGNOSTICS _cleared = ROW_COUNT;

  UPDATE public.pl_blocks
  SET end_date = _new_end,
      status = 'Completed',
      completed_at = now(),
      completion_method = 'manual'
  WHERE id = _block_id;

  RETURN jsonb_build_object('removed', _removed, 'cleared', _cleared);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pl_end_block_early(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pl_end_block_early(uuid, date) TO service_role;