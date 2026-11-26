-- Atomic immediate switch between coaching subscriptions. An admin explicitly
-- selects the new package; the old enrollment is history, never deleted.
-- This does not charge, refund, cancel, or modify a purchase/subscription.
CREATE OR REPLACE FUNCTION public.switch_client_service_package(
  _client_id uuid, _package_id uuid, _expected_enrollment_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $$
DECLARE
  old_row public.coaching_package_enrollments%ROWTYPE;
  client_row public.clients%ROWTYPE;
  new_id uuid;
  today date := (now() AT TIME ZONE 'America/Winnipeg')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an admin can change a client service.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_client_id::text, 0));
  SELECT * INTO client_row FROM public.clients WHERE id = _client_id FOR UPDATE;
  IF NOT FOUND OR client_row.service_tier <> 'coaching' OR coalesce(client_row.archived,false)
      OR coalesce(client_row.status,'') IN ('Archived','Deactivated') THEN
    RAISE EXCEPTION 'This client must have an active coaching account first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coaching_packages WHERE id = _package_id AND status = 'active' AND kind = 'subscription') THEN
    RAISE EXCEPTION 'Choose an active coaching subscription.';
  END IF;
  SELECT * INTO old_row FROM public.coaching_package_enrollments
    WHERE client_id = _client_id AND status = 'active' FOR UPDATE;
  IF old_row.id IS DISTINCT FROM _expected_enrollment_id THEN
    RAISE EXCEPTION 'Their service changed. Reopen the sheet and try again.';
  END IF;
  IF old_row.package_id = _package_id THEN RETURN old_row.id; END IF;
  IF old_row.starts_on > today THEN
    RAISE EXCEPTION 'The current service starts in the future. Review it in Billing first.';
  END IF;
  IF old_row.id IS NOT NULL THEN
    UPDATE public.coaching_package_enrollments SET status = 'ended', ends_on = greatest(old_row.starts_on, today - 1)
      WHERE id = old_row.id;
  END IF;
  INSERT INTO public.coaching_package_enrollments
    (client_id, package_id, starts_on, sale_id, period_anchor, contracted_price_cents)
    VALUES (_client_id, _package_id, today, old_row.sale_id, old_row.period_anchor, old_row.contracted_price_cents)
    RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.switch_client_service_package(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_client_service_package(uuid,uuid,uuid) TO authenticated;
