-- Stop storing raw signup passwords. Switch jf_pending_signups to a user_id reference;
-- the auth user is now created up-front and the password lives only in Supabase Auth.
-- Drop any pending rows mid-flight (they cannot complete with the old password column gone).
DELETE FROM public.jf_pending_signups;
ALTER TABLE public.jf_pending_signups DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.jf_pending_signups ADD COLUMN IF NOT EXISTS user_id uuid;