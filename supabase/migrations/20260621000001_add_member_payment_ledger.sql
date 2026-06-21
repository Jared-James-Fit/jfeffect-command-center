-- ============================================================
-- Migration: Add member_payment_ledger table
-- Purpose: Track all membership payments (Stripe + manual) with
--          full audit trail. Entries are never deleted, only
--          marked with a status change.
-- ============================================================

CREATE TABLE IF NOT EXISTS member_payment_ledger (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           UUID        NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,

  -- When and how much
  payment_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_cents        INT,
  currency            TEXT        NOT NULL DEFAULT 'usd',

  -- What it was for
  service_product     TEXT,
  payment_method      TEXT,

  -- Stripe reference (null for manual payments)
  stripe_payment_id   TEXT,
  stripe_invoice_id   TEXT,

  -- Manual payment details
  manual_note         TEXT,
  admin_user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Access grant details
  access_granted      BOOLEAN     NOT NULL DEFAULT FALSE,
  access_start_date   TIMESTAMPTZ,
  access_end_date     TIMESTAMPTZ,

  -- Status: paid | failed | refunded | comped | manual | pending
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('paid', 'failed', 'refunded', 'comped', 'manual', 'pending')),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_member_payment_ledger_member_id
  ON member_payment_ledger(member_id);

CREATE INDEX IF NOT EXISTS idx_member_payment_ledger_payment_date
  ON member_payment_ledger(payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_member_payment_ledger_stripe_payment_id
  ON member_payment_ledger(stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_member_payment_ledger_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_payment_ledger_updated_at ON member_payment_ledger;
CREATE TRIGGER trg_member_payment_ledger_updated_at
  BEFORE UPDATE ON member_payment_ledger
  FOR EACH ROW EXECUTE FUNCTION update_member_payment_ledger_updated_at();

-- RLS: admins/coaches can read all; members can read their own (no write from client)
ALTER TABLE member_payment_ledger ENABLE ROW LEVEL SECURITY;

-- Admin/coach: full access
CREATE POLICY "admin_coach_full_access_payment_ledger"
  ON member_payment_ledger
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'coach')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'coach')
    )
  );

-- Members: read their own ledger only
CREATE POLICY "member_read_own_payment_ledger"
  ON member_payment_ledger
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_members
      WHERE app_members.id = member_payment_ledger.member_id
        AND app_members.user_id = auth.uid()
    )
  );

-- Comment
COMMENT ON TABLE member_payment_ledger IS
  'Immutable ledger of all membership payments. Entries are never deleted. '
  'Status changes (refund, comp, etc.) add new rows or update status field only.';
