
-- Clean up JF Membership test account for jaredmcintyrefitness@gmail.com
-- so the email can be reused for another JF Membership test signup.
DELETE FROM public.member_access WHERE member_id = '726e0da3-36a0-4986-bdc2-0e5759999c05';
DELETE FROM public.app_members  WHERE id        = '726e0da3-36a0-4986-bdc2-0e5759999c05';
DELETE FROM public.jf_pending_signups WHERE lower(email) = 'jaredmcintyrefitness@gmail.com';
DELETE FROM public.jf_trial_emails    WHERE email_lc     = 'jaredmcintyrefitness@gmail.com';
DELETE FROM auth.users WHERE id = '9778a81a-6637-4c8d-8631-85a0b7920002';
