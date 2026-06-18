-- Confirm reviewer account email and set up demo data
-- Migration: 20260618_confirm_reviewer_account

-- Confirm the reviewer account email
UPDATE auth.users 
SET 
  email_confirmed_at = NOW(),
  confirmation_token = '',
  raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"first_name": "App", "last_name": "Reviewer", "email_verified": true}'::jsonb
WHERE email = 'reviewer@jfeffect.com';

-- Also confirm any other demo accounts
UPDATE auth.users 
SET 
  email_confirmed_at = NOW(),
  confirmation_token = ''
WHERE email IN ('demo.member@jfeffect.com', 'demo.client@jfeffect.com');
