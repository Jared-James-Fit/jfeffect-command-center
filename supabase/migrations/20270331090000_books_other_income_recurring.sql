-- The books, ready for what isn't in them yet.
--
-- 1. Other income: money the business earns that isn't a client's sale (a
--    sponsorship, a workshop, a referral or affiliate payout, a product sold
--    outside the app). It counts in sales, GST/HST and the T2125 like any
--    payment; its GST/HST is what's inside the amount, and a payment with none
--    says why (outside Canada, not taxable, not charged) so it isn't flagged.
-- 2. Recurring expenses set up on purpose: a monthly or yearly bill (software,
--    a phone plan, gym rent) the app adds to the books on its day, as an
--    expense to check (needs_review, never "reviewed" by itself), once per day
--    it's due (external_key), so a bill that changed or stopped is caught when
--    it's checked, not filed blind.
--
-- Both are the owner's and the finance login's, like business_expenses:
-- the owner manages them, finance reads and records, only the owner deletes.

-- ---------------------------------------------------------------------------
-- Other income

CREATE TABLE IF NOT EXISTS public.business_other_income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_on date NOT NULL,
  payer text,
  description text,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('sponsorship', 'workshop', 'product', 'referral', 'other')),
  -- What came in, GST/HST included.
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  -- Why a payment carries no GST/HST (null when it does, or nobody's said).
  no_tax_reason text CHECK (no_tax_reason IN ('outside_canada', 'not_taxable', 'not_charged')),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  method text,
  deposit_account_id uuid REFERENCES public.deposit_accounts(id) ON DELETE SET NULL,
  reference text,
  proof_path text,
  proof_mime text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_other_income_tax_le_amount CHECK (tax_minor <= amount_minor),
  CONSTRAINT business_other_income_reason_only_without_tax CHECK (no_tax_reason IS NULL OR tax_minor = 0)
);

CREATE INDEX IF NOT EXISTS business_other_income_received_idx ON public.business_other_income (received_on DESC);

ALTER TABLE public.business_other_income ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage other income" ON public.business_other_income;
CREATE POLICY "owner manage other income" ON public.business_other_income FOR ALL TO authenticated
  USING ((SELECT public.is_business_owner((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_business_owner((SELECT auth.uid()))));
DROP POLICY IF EXISTS "finance read other income" ON public.business_other_income;
CREATE POLICY "finance read other income" ON public.business_other_income FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'finance.read')));
DROP POLICY IF EXISTS "finance record other income insert" ON public.business_other_income;
CREATE POLICY "finance record other income insert" ON public.business_other_income FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'finance.record')));
DROP POLICY IF EXISTS "finance record other income update" ON public.business_other_income;
CREATE POLICY "finance record other income update" ON public.business_other_income FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'finance.record')))
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'finance.record')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_other_income TO authenticated;

DROP TRIGGER IF EXISTS business_other_income_updated_at ON public.business_other_income;
CREATE TRIGGER business_other_income_updated_at BEFORE UPDATE ON public.business_other_income
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Recurring expenses

CREATE TABLE IF NOT EXISTS public.business_recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor text NOT NULL,
  description text,
  category text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method text,
  business_use_pct numeric NOT NULL DEFAULT 100 CHECK (business_use_pct >= 0 AND business_use_pct <= 100),
  every text NOT NULL CHECK (every IN ('month', 'year')),
  -- The day of the month it's charged (29-31 land on the month's last day in shorter months).
  day_of_month int NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  next_on date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_added_on date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_recurring_expenses_tax_le_amount CHECK (tax_minor <= amount_minor)
);

ALTER TABLE public.business_recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage recurring expenses" ON public.business_recurring_expenses;
CREATE POLICY "owner manage recurring expenses" ON public.business_recurring_expenses FOR ALL TO authenticated
  USING ((SELECT public.is_business_owner((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_business_owner((SELECT auth.uid()))));
DROP POLICY IF EXISTS "finance read recurring expenses" ON public.business_recurring_expenses;
CREATE POLICY "finance read recurring expenses" ON public.business_recurring_expenses FOR SELECT TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'finance.read')));
DROP POLICY IF EXISTS "finance record recurring expenses insert" ON public.business_recurring_expenses;
CREATE POLICY "finance record recurring expenses insert" ON public.business_recurring_expenses FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'finance.record')));
DROP POLICY IF EXISTS "finance record recurring expenses update" ON public.business_recurring_expenses;
CREATE POLICY "finance record recurring expenses update" ON public.business_recurring_expenses FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission((SELECT auth.uid()), 'finance.record')))
  WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'finance.record')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_recurring_expenses TO authenticated;

DROP TRIGGER IF EXISTS business_recurring_expenses_updated_at ON public.business_recurring_expenses;
CREATE TRIGGER business_recurring_expenses_updated_at BEFORE UPDATE ON public.business_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- The expenses it adds say so and point back at it.
ALTER TABLE public.business_expenses DROP CONSTRAINT IF EXISTS business_expenses_source_check;
ALTER TABLE public.business_expenses ADD CONSTRAINT business_expenses_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'receipt'::text, 'stripe_fees'::text, 'recurring'::text]));
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS recurring_id uuid REFERENCES public.business_recurring_expenses(id) ON DELETE SET NULL;

-- The day after `_from` in the template's rhythm: the next month (or the same
-- month next year) on its day, the month's last day when it's shorter.
CREATE OR REPLACE FUNCTION public.books_recurring_next(_from date, _every text, _day int)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  WITH m AS (
    SELECT (date_trunc('month', _from) + CASE WHEN _every = 'year' THEN interval '12 months' ELSE interval '1 month' END)::date AS first
  )
  SELECT (m.first + (LEAST(_day, EXTRACT(day FROM (m.first + interval '1 month - 1 day'))::int) - 1))::date FROM m
$$;

-- Adds every recurring expense that's due (today in Winnipeg, or the day
-- given), catching up any days a run missed (at most 24 a template), each as
-- an expense to check. Returns how many it added.
CREATE OR REPLACE FUNCTION public.books_add_recurring_expenses(_today date DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := COALESCE(_today, (public.instant_to_local(now(), 'America/Winnipeg'))::date);
  t record;
  v_on date;
  v_guard int;
  v_added int := 0;
  v_rows int;
BEGIN
  FOR t IN
    SELECT * FROM public.business_recurring_expenses
     WHERE active AND next_on <= v_today
     ORDER BY next_on
     FOR UPDATE SKIP LOCKED
  LOOP
    v_on := t.next_on;
    v_guard := 0;
    WHILE v_on <= v_today AND v_guard < 24 LOOP
      INSERT INTO public.business_expenses (
        expense_date, vendor, description, category, amount_minor, tax_minor, currency,
        payment_method, business_use_pct, status, source, external_key, recurring_id, notes
      ) VALUES (
        v_on, t.vendor, t.description, t.category, t.amount_minor, t.tax_minor, t.currency,
        t.payment_method, t.business_use_pct, 'needs_review', 'recurring',
        'recurring:' || t.id || ':' || v_on, t.id,
        CASE t.every WHEN 'year' THEN 'Added by its yearly repeat. Check the amount and add the receipt.'
                     ELSE 'Added by its monthly repeat. Check the amount and add the receipt.' END
      )
      ON CONFLICT (external_key) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_added := v_added + v_rows;
      UPDATE public.business_recurring_expenses SET last_added_on = v_on WHERE id = t.id;
      v_on := public.books_recurring_next(v_on, t.every, t.day_of_month);
      v_guard := v_guard + 1;
    END LOOP;
    UPDATE public.business_recurring_expenses SET next_on = v_on WHERE id = t.id;
  END LOOP;
  RETURN v_added;
END;
$$;
REVOKE ALL ON FUNCTION public.books_add_recurring_expenses(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.books_add_recurring_expenses(date) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'books-recurring-expenses';
  PERFORM cron.schedule('books-recurring-expenses', '17 11 * * *',
    $cmd$ SELECT public.books_add_recurring_expenses()
           WHERE EXISTS (SELECT 1 FROM public.business_recurring_expenses
                          WHERE active AND next_on <= (public.instant_to_local(now(), 'America/Winnipeg'))::date) $cmd$);
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;
