
-- Restrict audit insert to admins only (server fns use service_role which bypasses RLS)
DROP POLICY IF EXISTS "Authenticated insert audit events" ON public.discount_code_audit_log;
CREATE POLICY "Admins insert audit events"
  ON public.discount_code_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Lock down SECURITY DEFINER validator: revoke anon
REVOKE EXECUTE ON FUNCTION public.validate_discount_codes(TEXT[], UUID, UUID) FROM anon;
