-- Finance role: the books, and nothing else.
--
--   finance.read   : payment_ledger, member_payment_ledger, Taxes & Books
--                    (settings, expenses, tax payments, receipts)
--   finance.record : add and edit expenses, receipts, tax payments, settings
--   No delete, refund, comp or cancellation.
--
-- The owner-only policies from #339 ("owner manage …") stay exactly as they
-- are; these are additional, permission-based policies. has_permission()
-- needs an MFA-verified session for your own permissions.

-- Ledgers: read-only.
DROP POLICY IF EXISTS "Finance read payment_ledger" ON public.payment_ledger;
CREATE POLICY "Finance read payment_ledger" ON public.payment_ledger
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'finance.read'));

DROP POLICY IF EXISTS "Finance read member_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "Finance read member_payment_ledger" ON public.member_payment_ledger
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'finance.read'));

-- Taxes & Books tables: read and record (insert/update), no delete.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_tax_settings', 'business_expenses', 'business_tax_payments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'finance read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'finance record insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'finance record update', t);
    EXECUTE format($p$CREATE POLICY "finance read" ON public.%I FOR SELECT TO authenticated
      USING (public.has_permission(auth.uid(), 'finance.read'))$p$, t);
    EXECUTE format($p$CREATE POLICY "finance record insert" ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.has_permission(auth.uid(), 'finance.record'))$p$, t);
    EXECUTE format($p$CREATE POLICY "finance record update" ON public.%I FOR UPDATE TO authenticated
      USING (public.has_permission(auth.uid(), 'finance.record'))
      WITH CHECK (public.has_permission(auth.uid(), 'finance.record'))$p$, t);
  END LOOP;
END $$;

-- Receipts bucket: read and upload, no delete.
DROP POLICY IF EXISTS "business receipts finance read" ON storage.objects;
DROP POLICY IF EXISTS "business receipts finance insert" ON storage.objects;
DROP POLICY IF EXISTS "business receipts finance update" ON storage.objects;
CREATE POLICY "business receipts finance read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.read'));
CREATE POLICY "business receipts finance insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.record'));
CREATE POLICY "business receipts finance update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.record'));

-- Names for the books. Finance can't read clients, app_members or
-- purchase_records (coaching and health data live there), so the books get
-- just the payer name and offer name through these two functions.
CREATE OR REPLACE FUNCTION public.books_labels(_client_ids uuid[], _purchase_ids uuid[], _member_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_business_owner(auth.uid()) OR public.has_permission(auth.uid(), 'finance.read')) THEN
    RAISE EXCEPTION 'Forbidden: missing finance.read' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'clients',   coalesce((SELECT jsonb_object_agg(c.id, c.full_name) FROM public.clients c WHERE c.id = ANY (_client_ids)), '{}'::jsonb),
    'purchases', coalesce((SELECT jsonb_object_agg(p.id, p.offer_name) FROM public.purchase_records p WHERE p.id = ANY (_purchase_ids)), '{}'::jsonb),
    'members',   coalesce((SELECT jsonb_object_agg(m.id, m.full_name) FROM public.app_members m WHERE m.id = ANY (_member_ids)), '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.books_open_sales(_statuses text[])
RETURNS TABLE (
  id uuid, offer_name text, payment_status text, amount_outstanding_cents bigint,
  full_payable_amount numeric, amount_paid numeric, created_at timestamptz, client_full_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_business_owner(auth.uid()) OR public.has_permission(auth.uid(), 'finance.read')) THEN
    RAISE EXCEPTION 'Forbidden: missing finance.read' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.offer_name, p.payment_status, p.amount_outstanding_cents::bigint,
           p.full_payable_amount::numeric, p.amount_paid::numeric, p.created_at, c.full_name
      FROM public.purchase_records p
      LEFT JOIN public.clients c ON c.id = p.client_id
     WHERE p.payment_status = ANY (_statuses)
       AND p.archived_at IS NULL
     ORDER BY p.created_at DESC
     LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.books_labels(uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.books_open_sales(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.books_labels(uuid[], uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.books_open_sales(text[]) TO authenticated;
