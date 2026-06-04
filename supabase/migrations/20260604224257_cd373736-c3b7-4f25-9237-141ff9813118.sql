
-- 1. Drop old internal-signing tables
DROP TABLE IF EXISTS public.agreement_field_values CASCADE;
DROP TABLE IF EXISTS public.agreement_template_fields CASCADE;

-- 2. agreement_templates: drop internal builder columns, add SignNow columns
ALTER TABLE public.agreement_templates
  DROP COLUMN IF EXISTS pdf_storage_path,
  DROP COLUMN IF EXISTS page_count,
  DROP COLUMN IF EXISTS requires_coach_signature,
  DROP COLUMN IF EXISTS supports_payor,
  DROP COLUMN IF EXISTS supports_minor;

ALTER TABLE public.agreement_templates
  ADD COLUMN IF NOT EXISTS signnow_template_id text,
  ADD COLUMN IF NOT EXISTS agreement_type text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS signnow_url text;

-- Convert version column from integer to text (display-friendly)
ALTER TABLE public.agreement_templates
  ALTER COLUMN version TYPE text USING version::text;

-- 3. agreements: drop internal-signing columns, add SignNow + verification columns
ALTER TABLE public.agreements
  DROP COLUMN IF EXISTS fields_snapshot,
  DROP COLUMN IF EXISTS template_pdf_path,
  DROP COLUMN IF EXISTS signing_token,
  DROP COLUMN IF EXISTS signed_pdf_path,
  DROP COLUMN IF EXISTS signed_pdf_sha256,
  DROP COLUMN IF EXISTS client_signed_at,
  DROP COLUMN IF EXISTS coach_signed_at,
  DROP COLUMN IF EXISTS payor_required,
  DROP COLUMN IF EXISTS minor_required,
  DROP COLUMN IF EXISTS requires_coach_signature,
  DROP COLUMN IF EXISTS template_version;

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS signnow_template_id text,
  ADD COLUMN IF NOT EXISTS signnow_document_id text,
  ADD COLUMN IF NOT EXISTS signnow_signing_link text,
  ADD COLUMN IF NOT EXISTS signnow_completed_link text,
  ADD COLUMN IF NOT EXISTS signed_copy_url text,
  ADD COLUMN IF NOT EXISTS signed_copy_storage_path text,
  ADD COLUMN IF NOT EXISTS drive_file_id text,
  ADD COLUMN IF NOT EXISTS drive_file_url text,
  ADD COLUMN IF NOT EXISTS agreement_type text,
  ADD COLUMN IF NOT EXISTS offer_name text,
  ADD COLUMN IF NOT EXISTS signer_name_in_signnow text,
  ADD COLUMN IF NOT EXISTS correct_client_name text,
  ADD COLUMN IF NOT EXISTS signer_mismatch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'Not Verified',
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_note text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_full_name text,
  ADD COLUMN IF NOT EXISTS client_email text,
  ADD COLUMN IF NOT EXISTS client_phone text,
  ADD COLUMN IF NOT EXISTS client_address text,
  ADD COLUMN IF NOT EXISTS client_dob date;

-- 4. signnow_settings singleton
CREATE TABLE IF NOT EXISTS public.signnow_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  status text NOT NULL DEFAULT 'Manual Mode',
  account_email text,
  default_template_id uuid,
  auto_reminders_enabled boolean NOT NULL DEFAULT false,
  reminder_intervals_days integer[] NOT NULL DEFAULT ARRAY[1,3,7],
  signnow_dashboard_url text DEFAULT 'https://app.signnow.com',
  last_test_at timestamptz,
  last_test_result text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signnow_settings TO authenticated;
GRANT ALL ON public.signnow_settings TO service_role;

ALTER TABLE public.signnow_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage signnow_settings"
  ON public.signnow_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER signnow_settings_updated_at
  BEFORE UPDATE ON public.signnow_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.signnow_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

-- 5. offers: agreement requirement linkage
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS agreement_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS required_agreement_template_id uuid,
  ADD COLUMN IF NOT EXISTS agreement_before_service boolean NOT NULL DEFAULT false;
