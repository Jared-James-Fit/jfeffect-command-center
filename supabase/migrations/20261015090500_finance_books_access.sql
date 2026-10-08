-- Finance role: access to the books, and nothing else.
--
--   finance.read   : payment_ledger, member_payment_ledger, Taxes & Books
--                    (settings, expenses, tax payments, receipts) and Summer
--   finance.record : insert/update expenses, receipts, tax payments, settings
--   finance.delete : delete books records (admin only; not granted to finance)
--
-- has_permission() requires an MFA-verified session and gives admin every
-- permission, so admin keeps everything here but needs MFA for the books.
-- Existing admin policies on payment_ledger / member_payment_ledger stay as
-- they are; finance gets an extra read-only policy. The Taxes & Books
-- policies (admin-only until now) are replaced by permission-based ones.

-- Ledgers: read-only for finance (no refunds, comps or voids).
DROP POLICY IF EXISTS "Finance read payment_ledger" ON public.payment_ledger;
CREATE POLICY "Finance read payment_ledger" ON public.payment_ledger
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'finance.read'));

DROP POLICY IF EXISTS "Finance read member_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "Finance read member_payment_ledger" ON public.member_payment_ledger
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'finance.read'));

-- Taxes & Books tables: read / record / delete.
DO $$
DECLARE
  t text;
  old_policy text;
BEGIN
  FOR t, old_policy IN VALUES
    ('business_tax_settings', 'admin manage tax settings'),
    ('business_expenses',     'admin manage expenses'),
    ('business_tax_payments', 'admin manage tax payments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old_policy, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'books read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'books record insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'books record update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'books delete', t);
    EXECUTE format($p$CREATE POLICY "books read" ON public.%I FOR SELECT TO authenticated
      USING (public.has_permission(auth.uid(), 'finance.read'))$p$, t);
    EXECUTE format($p$CREATE POLICY "books record insert" ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.has_permission(auth.uid(), 'finance.record'))$p$, t);
    EXECUTE format($p$CREATE POLICY "books record update" ON public.%I FOR UPDATE TO authenticated
      USING (public.has_permission(auth.uid(), 'finance.record'))
      WITH CHECK (public.has_permission(auth.uid(), 'finance.record'))$p$, t);
    EXECUTE format($p$CREATE POLICY "books delete" ON public.%I FOR DELETE TO authenticated
      USING (public.has_permission(auth.uid(), 'finance.delete'))$p$, t);
  END LOOP;
END $$;

-- Summer: each person's own chat, for anyone who can read the books.
DROP POLICY IF EXISTS "admin own summer messages" ON public.summer_messages;
DROP POLICY IF EXISTS "books own summer messages" ON public.summer_messages;
CREATE POLICY "books own summer messages" ON public.summer_messages
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'finance.read'))
  WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'finance.read'));

-- Receipts bucket.
DROP POLICY IF EXISTS "business receipts admin read" ON storage.objects;
DROP POLICY IF EXISTS "business receipts admin insert" ON storage.objects;
DROP POLICY IF EXISTS "business receipts admin update" ON storage.objects;
DROP POLICY IF EXISTS "business receipts admin delete" ON storage.objects;
DROP POLICY IF EXISTS "business receipts read" ON storage.objects;
DROP POLICY IF EXISTS "business receipts insert" ON storage.objects;
DROP POLICY IF EXISTS "business receipts update" ON storage.objects;
DROP POLICY IF EXISTS "business receipts delete" ON storage.objects;
CREATE POLICY "business receipts read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.read'));
CREATE POLICY "business receipts insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.record'));
CREATE POLICY "business receipts update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.record'));
CREATE POLICY "business receipts delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'business-receipts' AND public.has_permission(auth.uid(), 'finance.delete'));

-- Names for the books. Finance can't read clients, app_members or
-- purchase_records rows (coaching and health data live there), so the books
-- get just the payer name and offer name through these two functions.
CREATE OR REPLACE FUNCTION public.books_labels(_client_ids uuid[], _purchase_ids uuid[], _member_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'finance.read') THEN
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
  IF NOT public.has_permission(auth.uid(), 'finance.read') THEN
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
