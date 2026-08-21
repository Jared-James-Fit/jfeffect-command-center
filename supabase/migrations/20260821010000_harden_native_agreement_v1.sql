-- Native Agreement v1 hardening
-- Additive only: preserves all legacy SignNow/manual records and existing native rows.
-- No legal wording or existing agreement content is changed by this migration.

ALTER TABLE public.na_template_versions
  ADD COLUMN IF NOT EXISTS source_pdf_bucket text,
  ADD COLUMN IF NOT EXISTS source_pdf_path text,
  ADD COLUMN IF NOT EXISTS source_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS source_pdf_page_count integer;

ALTER TABLE public.na_snapshots
  ADD COLUMN IF NOT EXISTS source_pdf_bucket text,
  ADD COLUMN IF NOT EXISTS source_pdf_path text,
  ADD COLUMN IF NOT EXISTS source_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS source_pdf_page_count integer;

ALTER TABLE public.na_packages
  ADD COLUMN IF NOT EXISTS artifact_status text NOT NULL DEFAULT 'not_requested'
    CHECK (artifact_status IN ('not_requested', 'pending', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS artifact_error text,
  ADD COLUMN IF NOT EXISTS artifact_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS artifact_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_dob_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS nap_artifact_status_idx
  ON public.na_packages(artifact_status)
  WHERE artifact_status IN ('pending', 'failed');

-- A completed package remains immutable except for the durable background-artifact
-- bookkeeping required to finish or retry its signed-copy generation.
CREATE OR REPLACE FUNCTION public.tg_na_package_protect_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
      OR NEW.jurisdiction_profile_id IS DISTINCT FROM OLD.jurisdiction_profile_id
      OR NEW.purchase_record_id IS DISTINCT FROM OLD.purchase_record_id
      OR NEW.custom_title IS DISTINCT FROM OLD.custom_title
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.service_order IS DISTINCT FROM OLD.service_order
      OR NEW.financial_terms IS DISTINCT FROM OLD.financial_terms
      OR NEW.contract_value_minor IS DISTINCT FROM OLD.contract_value_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.active_modules IS DISTINCT FROM OLD.active_modules
      OR NEW.parent_package_id IS DISTINCT FROM OLD.parent_package_id
      OR NEW.replaces_package_id IS DISTINCT FROM OLD.replaces_package_id
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.jurisdiction_supported IS DISTINCT FROM OLD.jurisdiction_supported
      OR NEW.jurisdiction_block_reasons IS DISTINCT FROM OLD.jurisdiction_block_reasons
    THEN
      RAISE EXCEPTION 'Completed native agreement package is immutable (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS na_package_protect_completed ON public.na_packages;
CREATE TRIGGER na_package_protect_completed
  BEFORE UPDATE ON public.na_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_na_package_protect_completed();

-- Native v1 does not permit guest signing. Existing historical rows remain readable;
-- new native signing must occur through the authenticated client portal.
REVOKE INSERT, UPDATE, DELETE ON public.na_guest_tokens FROM authenticated;

COMMENT ON COLUMN public.na_packages.artifact_status IS
  'Durable signed-artifact state. Completion may be valid while artifact_status is pending or failed; retries must not modify signature evidence.';
COMMENT ON COLUMN public.na_template_versions.source_pdf_path IS
  'Immutable authoritative legal source PDF path for the template version.';
COMMENT ON COLUMN public.na_snapshots.source_pdf_path IS
  'Frozen authoritative legal source PDF path used to render the signed artifact.';
