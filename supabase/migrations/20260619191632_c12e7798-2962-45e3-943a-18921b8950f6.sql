-- Lock down member self-update on app_members to a safe column allowlist.
-- RLS already restricts to user_id = auth.uid(). We add Postgres column-level
-- UPDATE grants so the authenticated role can ONLY update non-sensitive
-- profile/preference columns. service_role (admin server fns) keeps full UPDATE.

REVOKE UPDATE ON public.app_members FROM authenticated;

GRANT UPDATE (
  full_name,
  avatar_url,
  phone,
  sms_opt_out,
  sms_consent_at,
  date_of_birth,
  address_line1,
  address_city,
  address_state,
  address_zip,
  address_country,
  emergency_contact_name,
  emergency_contact_phone,
  goals,
  goals_tags,
  experience_level,
  training_background,
  committed_training_days,
  committed_training_frequency,
  setup_completed_at,
  install_detected_at,
  install_platform,
  install_dismissed_at,
  email_marketing_opt_in
) ON public.app_members TO authenticated;

-- Make sure service_role retains full privileges for admin/billing server fns.
GRANT ALL ON public.app_members TO service_role;