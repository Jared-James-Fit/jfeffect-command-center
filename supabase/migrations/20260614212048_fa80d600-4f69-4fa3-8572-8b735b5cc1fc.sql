
-- =========================================================================
-- Phase 1 closeout + Phase 2 foundation
-- =========================================================================

-- 1. APPEND-ONLY AUDIT EVENTS ---------------------------------------------
-- Replace the FOR ALL admin policy with read-only admin + explicit deny.
DROP POLICY IF EXISTS "Admin all on pl_template_distribution_events"
  ON public.pl_template_distribution_events;

CREATE POLICY "Admin read all template events"
  ON public.pl_template_distribution_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Hard-revoke UPDATE/DELETE at the GRANT layer so policies cannot ever
-- re-enable mutation, regardless of future RLS edits.
REVOKE UPDATE, DELETE ON public.pl_template_distribution_events
  FROM authenticated, anon, public;
-- Keep service_role full access for controlled DB functions / migrations.
GRANT ALL ON public.pl_template_distribution_events TO service_role;
GRANT SELECT, INSERT ON public.pl_template_distribution_events TO authenticated;

-- 2. MEMBERSHIP PUBLISHING COLUMNS ----------------------------------------
-- member_plans is the Membership publication record. Extend it to track
-- version, verification, scheduling, unpublish reason, and publisher.
ALTER TABLE public.member_plans
  ADD COLUMN IF NOT EXISTS published_version bigint,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS unpublished_at timestamptz,
  ADD COLUMN IF NOT EXISTS unpublish_reason text,
  ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_reason text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

-- Constrain status enums via CHECK (triggers not needed; values are static).
DO $$ BEGIN
  ALTER TABLE public.member_plans
    ADD CONSTRAINT member_plans_membership_status_chk
    CHECK (membership_status IN (
      'private','pending_approval','changes_requested','approved',
      'scheduled','live','live_update_available','live_access_issue',
      'rejected','unpublished','archived'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.member_plans
    ADD CONSTRAINT member_plans_verification_status_chk
    CHECK (verification_status IN (
      'verified','pending','access_issue','missing_version',
      'missing_metadata','not_yet_scheduled','unpublished'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for verification sweeps.
CREATE INDEX IF NOT EXISTS member_plans_verification_idx
  ON public.member_plans (membership_status, last_verified_at);

-- Index for source-template lookups used to compute "update available".
CREATE INDEX IF NOT EXISTS member_plans_source_template_idx
  ON public.member_plans (source_template_id) WHERE source_template_id IS NOT NULL;
