CREATE OR REPLACE FUNCTION public.pl_week_day_offset(p_day_index integer, p_days_per_week integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_day_index IS NULL OR p_day_index < 1 THEN 0
    WHEN COALESCE(p_days_per_week, 0) <= 1 THEN 0
    WHEN p_days_per_week = 2 THEN (ARRAY[0,3])[LEAST(p_day_index,2)]
    WHEN p_days_per_week = 3 THEN (ARRAY[0,2,4])[LEAST(p_day_index,3)]
    WHEN p_days_per_week = 4 THEN (ARRAY[0,1,3,4])[LEAST(p_day_index,4)]
    WHEN p_days_per_week = 5 THEN (ARRAY[0,1,2,3,4])[LEAST(p_day_index,5)]
    WHEN p_days_per_week = 6 THEN (ARRAY[0,1,2,3,4,5])[LEAST(p_day_index,6)]
    ELSE LEAST(p_day_index - 1, 6)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.pl_week_day_offset(integer, integer) TO authenticated, service_role;

DO $mig$
DECLARE
  v_def text;
  v_old text := 'CASE WHEN v_didx = 1 THEN 0 WHEN v_didx = 2 THEN 2 ELSE 4 END';
  v_new text := 'public.pl_week_day_offset(v_didx, jsonb_array_length(COALESCE(v_w->''days'',''[]''::jsonb)))';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'pl_assign_template_to_client'
    AND pronamespace = 'public'::regnamespace
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'pl_assign_template_to_client not found';
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE NOTICE 'legacy weekday pattern not present; nothing to patch';
    RETURN;
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$mig$;