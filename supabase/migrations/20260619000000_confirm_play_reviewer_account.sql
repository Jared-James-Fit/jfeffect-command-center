-- ============================================================
-- Google Play reviewer account setup
-- Migration: 20260619000000_confirm_play_reviewer_account
-- ============================================================
-- Confirm email for the Google Play reviewer account.
-- This account was created via the Auth API but requires
-- email confirmation to be bypassed for review purposes.
UPDATE auth.users
SET
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  confirmation_token = '',
  raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{
    "first_name": "App",
    "last_name": "Reviewer",
    "email_verified": true
  }'::jsonb
WHERE email = 'appreviewer@jfeffect.com';

-- Also confirm any legacy reviewer accounts
UPDATE auth.users
SET
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  confirmation_token = ''
WHERE email IN ('reviewer@jfeffect.com', 'demo.member@jfeffect.com');

-- Create app_members record for the reviewer account if not exists
-- JF members use account_type='jf_member' and do NOT have a user_roles entry
INSERT INTO public.app_members (
  user_id,
  email,
  full_name,
  status,
  account_type
)
SELECT
  u.id,
  'appreviewer@jfeffect.com',
  'App Reviewer',
  'Active',
  'jf_member'
FROM auth.users u
WHERE u.email = 'appreviewer@jfeffect.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.app_members m WHERE m.user_id = u.id
  )
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'Play reviewer account confirmed and provisioned';
END $$;
