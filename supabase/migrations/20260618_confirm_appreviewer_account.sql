-- Migration: Confirm reviewer and demo accounts for App Store review
-- Run: 20260618_confirm_appreviewer_account

-- Confirm appreviewer@jfeffect.com (Apple App Store reviewer account)
UPDATE auth.users 
SET 
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  confirmation_token = '',
  raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"email_verified": true, "first_name": "App", "last_name": "Reviewer"}'::jsonb
WHERE email = 'appreviewer@jfeffect.com';

-- Confirm reviewer@jfeffect.com (legacy reviewer account)
UPDATE auth.users 
SET 
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  confirmation_token = ''
WHERE email = 'reviewer@jfeffect.com';

-- Confirm demo accounts
UPDATE auth.users 
SET 
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  confirmation_token = ''
WHERE email IN ('demo.member@jfeffect.com', 'demo.client@jfeffect.com');

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Reviewer accounts confirmed successfully';
END $$;
