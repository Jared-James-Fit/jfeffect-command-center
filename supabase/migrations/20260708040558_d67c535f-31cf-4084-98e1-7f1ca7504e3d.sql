
-- 1) Drop the overly-broad client UPDATE policy on purchase_records
DROP POLICY IF EXISTS "Client accept own purchase_records" ON public.purchase_records;

-- 2) Narrow SECURITY DEFINER RPC that only touches acceptance fields
CREATE OR REPLACE FUNCTION public.accept_my_purchase(p_purchase_id uuid)
RETURNS public.purchase_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client_id uuid;
  v_client_name text;
  v_client_email text;
  v_user_email text;
  v_row public.purchase_records;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.full_name, c.email
    INTO v_client_id, v_client_name, v_client_email
  FROM public.clients c
  WHERE c.user_id = v_uid
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No client profile for user' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_uid;

  UPDATE public.purchase_records
     SET terms_accepted = true,
         terms_accepted_at = COALESCE(terms_accepted_at, now()),
         terms_accepted_client_name = COALESCE(terms_accepted_client_name, v_client_name),
         terms_accepted_client_email = COALESCE(terms_accepted_client_email, v_client_email, v_user_email)
   WHERE id = p_purchase_id
     AND client_id = v_client_id
     AND COALESCE(terms_accepted, false) = false
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Purchase not found, not owned by caller, or already accepted' USING ERRCODE = '42501';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_my_purchase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_my_purchase(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_my_purchase(uuid) TO authenticated;
