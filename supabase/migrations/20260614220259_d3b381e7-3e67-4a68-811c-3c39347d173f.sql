
-- ============================================================
-- Phase 1: Financial foundation
-- ============================================================

-- Extend purchase_records with cents-based, snapshot, and normalized status fields
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS offer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS contract_value_cents bigint,
  ADD COLUMN IF NOT EXISTS amount_paid_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_refunded_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_credited_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_outstanding_cents bigint,
  ADD COLUMN IF NOT EXISTS purchase_status_v2 text;

-- Backfill contract value in cents from existing dollar columns where missing
UPDATE public.purchase_records
SET contract_value_cents = ROUND(COALESCE(full_payable_amount, 0) * 100)::bigint
WHERE contract_value_cents IS NULL;

UPDATE public.purchase_records
SET amount_paid_cents = ROUND(COALESCE(amount_paid, 0) * 100)::bigint
WHERE amount_paid_cents = 0 AND amount_paid IS NOT NULL AND amount_paid > 0;

UPDATE public.purchase_records
SET amount_outstanding_cents = GREATEST(COALESCE(contract_value_cents, 0) - COALESCE(amount_paid_cents, 0), 0)
WHERE amount_outstanding_cents IS NULL;

-- ============================================================
-- payment_ledger (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  purchase_id uuid REFERENCES public.purchase_records(id) ON DELETE RESTRICT,
  txn_type text NOT NULL CHECK (txn_type IN (
    'payment','deposit','credit_applied','credit_created',
    'refund','partial_refund','reversal','write_off','adjustment','transfer'
  )),
  method text NOT NULL CHECK (method IN (
    'stripe','etransfer','cash','debit','credit_card','bank_transfer',
    'cheque','credit_balance','legacy_backfill','other'
  )),
  amount_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  transaction_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  received_at timestamptz NOT NULL DEFAULT now(),
  external_reference text,
  stripe_event_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_invoice_id text,
  receipt_number text,
  internal_note text,
  client_note text,
  reversal_of uuid REFERENCES public.payment_ledger(id),
  voided boolean NOT NULL DEFAULT false,
  void_reason text,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_stripe_event_unique
  ON public.payment_ledger(stripe_event_id) WHERE stripe_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_ledger_client_idx ON public.payment_ledger(client_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS payment_ledger_purchase_idx ON public.payment_ledger(purchase_id);
CREATE INDEX IF NOT EXISTS payment_ledger_reversal_idx ON public.payment_ledger(reversal_of) WHERE reversal_of IS NOT NULL;

GRANT SELECT, INSERT ON public.payment_ledger TO authenticated;
GRANT ALL ON public.payment_ledger TO service_role;
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;

-- Block deletes entirely via trigger (extra defense beyond missing GRANT)
CREATE OR REPLACE FUNCTION public.prevent_payment_ledger_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_ledger rows are append-only; insert a reversal instead';
END;
$$;
DROP TRIGGER IF EXISTS no_delete_payment_ledger ON public.payment_ledger;
CREATE TRIGGER no_delete_payment_ledger BEFORE DELETE ON public.payment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_ledger_delete();

CREATE POLICY "Admins read payment_ledger" ON public.payment_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write payment_ledger" ON public.payment_ledger FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients read own payment_ledger" ON public.payment_ledger FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = payment_ledger.client_id AND c.user_id = auth.uid()));

-- ============================================================
-- payment_allocations (one payment -> many purchases)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id uuid NOT NULL REFERENCES public.payment_ledger(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.purchase_records(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_allocations_ledger_idx ON public.payment_allocations(ledger_id);
CREATE INDEX IF NOT EXISTS payment_allocations_purchase_idx ON public.payment_allocations(purchase_id);

GRANT SELECT, INSERT ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage payment_allocations" ON public.payment_allocations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- client_account_credits
-- ============================================================
CREATE TABLE IF NOT EXISTS public.client_account_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  kind text NOT NULL CHECK (kind IN ('issued','applied','expired','adjusted')),
  source_ledger_id uuid REFERENCES public.payment_ledger(id),
  applied_to_purchase_id uuid REFERENCES public.purchase_records(id),
  reason text,
  internal_note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_credits_client_idx ON public.client_account_credits(client_id, created_at DESC);

GRANT SELECT, INSERT ON public.client_account_credits TO authenticated;
GRANT ALL ON public.client_account_credits TO service_role;
ALTER TABLE public.client_account_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage client_credits" ON public.client_account_credits FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients read own credits" ON public.client_account_credits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_account_credits.client_id AND c.user_id = auth.uid()));

-- ============================================================
-- financial_audit_events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id),
  actor_role text,
  action text NOT NULL,
  record_type text NOT NULL,
  record_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_audit_client_idx ON public.financial_audit_events(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_audit_record_idx ON public.financial_audit_events(record_type, record_id);

GRANT SELECT, INSERT ON public.financial_audit_events TO authenticated;
GRANT ALL ON public.financial_audit_events TO service_role;
ALTER TABLE public.financial_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read financial_audit" ON public.financial_audit_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert financial_audit" ON public.financial_audit_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Helper: recompute purchase money totals from the ledger
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_purchase_totals(_purchase_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paid bigint;
  v_refunded bigint;
  v_credited bigint;
  v_contract bigint;
  v_status text;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN txn_type IN ('payment','deposit') AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN txn_type IN ('refund','partial_refund') AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN txn_type = 'credit_applied' AND NOT voided THEN amount_minor ELSE 0 END), 0)
    INTO v_paid, v_refunded, v_credited
  FROM public.payment_ledger
  WHERE purchase_id = _purchase_id;

  SELECT contract_value_cents INTO v_contract FROM public.purchase_records WHERE id = _purchase_id;
  v_contract := COALESCE(v_contract, 0);

  v_status := CASE
    WHEN v_paid + v_credited - v_refunded >= v_contract AND v_contract > 0 THEN 'Paid'
    WHEN v_paid + v_credited - v_refunded > 0 THEN 'Partially Paid'
    WHEN v_refunded > 0 THEN 'Refunded'
    ELSE 'Unpaid'
  END;

  UPDATE public.purchase_records
  SET amount_paid_cents = v_paid,
      amount_refunded_cents = v_refunded,
      amount_credited_cents = v_credited,
      amount_outstanding_cents = GREATEST(v_contract - (v_paid + v_credited - v_refunded), 0),
      payment_status = v_status,
      last_payment_update_source = 'ledger',
      last_payment_update_at = now(),
      updated_at = now()
  WHERE id = _purchase_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_ledger_after_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purchase_id IS NOT NULL THEN
    PERFORM public.recompute_purchase_totals(NEW.purchase_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payment_ledger_recompute ON public.payment_ledger;
CREATE TRIGGER payment_ledger_recompute AFTER INSERT OR UPDATE ON public.payment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.payment_ledger_after_change();

-- ============================================================
-- Backfill: replay existing amount_paid > 0 into the ledger ONCE
-- ============================================================
INSERT INTO public.payment_ledger
  (client_id, purchase_id, txn_type, method, amount_minor, currency, transaction_date, internal_note, source)
SELECT pr.client_id,
       pr.id,
       'payment',
       'legacy_backfill',
       ROUND(pr.amount_paid * 100)::bigint,
       COALESCE(pr.currency, 'USD'),
       COALESCE(pr.paid_at::date, pr.purchased_at::date, CURRENT_DATE),
       'Backfilled from purchase_records.amount_paid on Phase 1 migration',
       'backfill'
FROM public.purchase_records pr
WHERE COALESCE(pr.amount_paid, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_ledger l
    WHERE l.purchase_id = pr.id AND l.source = 'backfill'
  );
