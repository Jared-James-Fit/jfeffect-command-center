-- Money that comes in by hand, and changing how a client pays.
--
-- 1. Where money lands (deposit_accounts): the business's own accounts an
--    e-transfer, cheque or bank deposit goes into, by name and the last 4
--    digits only (never a full account number). A payment recorded by hand
--    says which one it went into (payment_ledger.deposit_account_id).
-- 2. Proof (payment_ledger.proof_path): a screenshot of the transfer or a
--    photo of the cheque, in the private payment-proofs bucket under the
--    client's id. Admins and the finance login only: a bank screenshot shows
--    the business's own balance, so it never reaches the client.
-- 3. Changing auto-pay (auto_pay_changes): a new amount or schedule, or a new
--    card, is a new Stripe subscription the client sets up from a link
--    (/autopay/<token>), never a silent change to what they agreed to. The
--    current auto-pay keeps going until they finish it, then the webhook
--    attaches the new one to the package it pays and cancels the old one, so
--    there's never a gap and never two. The checkout lives on the change, not
--    the sale: a link on the package would take it out of what the current
--    auto-pay pays (session_plan_payment_target) while it waits.

CREATE TABLE IF NOT EXISTS public.deposit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  institution text CHECK (institution IS NULL OR char_length(institution) <= 60),
  last4 text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{3,4}$'),
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS deposit_accounts_one_default ON public.deposit_accounts ((true)) WHERE is_default AND archived_at IS NULL;
ALTER TABLE public.deposit_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deposit_accounts FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.deposit_accounts TO authenticated;
GRANT ALL ON public.deposit_accounts TO service_role;
DROP POLICY IF EXISTS "Admins manage deposit accounts" ON public.deposit_accounts;
CREATE POLICY "Admins manage deposit accounts" ON public.deposit_accounts FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
DROP POLICY IF EXISTS "Finance reads deposit accounts" ON public.deposit_accounts;
CREATE POLICY "Finance reads deposit accounts" ON public.deposit_accounts FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'finance.read')));

-- The coach's own account, as he named it (Nov 16, 2026).
INSERT INTO public.deposit_accounts (label, institution, last4, is_default)
SELECT 'Simplii Chequing', 'Simplii Financial', '6360', true
 WHERE NOT EXISTS (SELECT 1 FROM public.deposit_accounts WHERE last4 = '6360' AND archived_at IS NULL);

ALTER TABLE public.payment_ledger
  ADD COLUMN IF NOT EXISTS deposit_account_id uuid REFERENCES public.deposit_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proof_path text,
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz;

-- Proof files: private, admins write, admins and finance read. Path: <client_id>/<file>.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-proofs', 'payment-proofs', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "payment proofs admin read" ON storage.objects;
CREATE POLICY "payment proofs admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'finance.read')));
DROP POLICY IF EXISTS "payment proofs admin insert" ON storage.objects;
CREATE POLICY "payment proofs admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "payment proofs admin update" ON storage.objects;
CREATE POLICY "payment proofs admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "payment proofs admin delete" ON storage.objects;
CREATE POLICY "payment proofs admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Auto-pay changes: one row per "set up auto-pay" link sent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auto_pay_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- the package the new auto-pay pays first (it carries the subscription)
  sale_id uuid NOT NULL REFERENCES public.purchase_records(id) ON DELETE CASCADE,
  -- the auto-pay it replaces, cancelled once the new one is set up
  replaces_sale_id uuid REFERENCES public.purchase_records(id) ON DELETE SET NULL,
  replaces_subscription_id text,
  -- each payment before tax, how often, and the first charge
  each_cents integer NOT NULL CHECK (each_cents BETWEEN 100 AND 10000000),
  every text NOT NULL CHECK (every IN ('week', '2 weeks', 'month')),
  first_charge_date date,
  stripe_product_id text,
  stripe_price_id text,
  stripe_mode text,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'superseded')),
  checkout_session_id text,
  checkout_url text,
  checkout_expires_at timestamptz,
  new_subscription_id text,
  message_id uuid,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  replaced_cancel_error text
);
CREATE INDEX IF NOT EXISTS auto_pay_changes_client ON public.auto_pay_changes (client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS auto_pay_changes_one_pending_per_sale ON public.auto_pay_changes (sale_id) WHERE status = 'pending';
ALTER TABLE public.auto_pay_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_pay_changes FROM anon, authenticated;
GRANT SELECT ON public.auto_pay_changes TO authenticated;
GRANT ALL ON public.auto_pay_changes TO service_role;
DROP POLICY IF EXISTS "Staff read auto-pay changes" ON public.auto_pay_changes;
CREATE POLICY "Staff read auto-pay changes" ON public.auto_pay_changes FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'))
         OR (SELECT public.has_permission((SELECT auth.uid()), 'finance.read'))
         OR client_id IN (SELECT public.coached_client_ids()));
-- The client reads their own, so the card in their chat can say it's done.
DROP POLICY IF EXISTS "Client reads own auto-pay changes" ON public.auto_pay_changes;
CREATE POLICY "Client reads own auto-pay changes" ON public.auto_pay_changes FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
