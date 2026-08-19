-- Canonical bodyweight mutation contract.
--
-- This migration is intentionally additive/non-destructive: it does not delete,
-- merge, or rewrite historical progress_metrics or progress_bodyweight rows.
-- Existing historical same-day duplicates are preserved for production review.
-- New writes are serialized per (user, date) through RPC rather than a client-side
-- cross-table mirror, so future saves cannot create another same-day duplicate.

CREATE OR REPLACE FUNCTION public.save_progress_bodyweight(
  p_user_id uuid,
  p_weight_value numeric,
  p_weight_unit text,
  p_logged_date date,
  p_note text DEFAULT NULL,
  p_entry_id uuid DEFAULT NULL
)
RETURNS public.progress_bodyweight
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_existing public.progress_bodyweight;
  v_result public.progress_bodyweight;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT public.has_role(v_actor, 'admin') INTO v_is_admin;
  IF p_user_id IS NULL OR (p_user_id <> v_actor AND NOT COALESCE(v_is_admin, false)) THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  IF p_logged_date IS NULL
    OR p_weight_unit NOT IN ('kg', 'lb')
    OR p_weight_value IS NULL
    OR p_weight_value <= 0
    OR p_weight_value = 'NaN'::numeric
  THEN
    RAISE EXCEPTION 'A positive bodyweight in kg or lb and a date are required.' USING ERRCODE = '22023';
  END IF;

  -- Serialize every save for this user/date. This prevents concurrent browser
  -- requests from creating duplicate rows without requiring destructive cleanup
  -- of pre-existing historical duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_logged_date::text, 0));

  IF p_entry_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.progress_bodyweight
    WHERE id = p_entry_id
    FOR UPDATE;

    IF NOT FOUND OR v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Bodyweight entry not found.' USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.progress_bodyweight
      WHERE user_id = p_user_id
        AND logged_date = p_logged_date
        AND id <> p_entry_id
    ) THEN
      RAISE EXCEPTION 'A bodyweight entry already exists for this date.' USING ERRCODE = '23505';
    END IF;

    UPDATE public.progress_bodyweight
    SET weight_value = p_weight_value,
        weight_unit = p_weight_unit,
        logged_date = p_logged_date,
        note = p_note
    WHERE id = p_entry_id
    RETURNING * INTO v_result;

    RETURN v_result;
  END IF;

  -- Saving without an entry ID is a per-date upsert. If historical duplicate
  -- rows already exist, only the newest row is updated; nothing is deleted.
  SELECT * INTO v_existing
  FROM public.progress_bodyweight
  WHERE user_id = p_user_id
    AND logged_date = p_logged_date
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.progress_bodyweight
    SET weight_value = p_weight_value,
        weight_unit = p_weight_unit,
        note = p_note
    WHERE id = v_existing.id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.progress_bodyweight (
      user_id,
      weight_value,
      weight_unit,
      logged_date,
      note
    ) VALUES (
      p_user_id,
      p_weight_value,
      p_weight_unit,
      p_logged_date,
      p_note
    )
    RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_progress_bodyweight(
  p_user_id uuid,
  p_entry_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT public.has_role(v_actor, 'admin') INTO v_is_admin;
  IF p_user_id IS NULL OR (p_user_id <> v_actor AND NOT COALESCE(v_is_admin, false)) THEN
    RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.progress_bodyweight
  WHERE id = p_entry_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bodyweight entry not found.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_progress_bodyweight(uuid, numeric, text, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_progress_bodyweight(uuid, uuid) TO authenticated;

-- All user-facing bodyweight writes now go through the authorization and
-- serialization checks above. Reads retain existing RLS policies; this change
-- does not broaden who can view another client’s data.
REVOKE INSERT, UPDATE, DELETE ON public.progress_bodyweight FROM authenticated;
