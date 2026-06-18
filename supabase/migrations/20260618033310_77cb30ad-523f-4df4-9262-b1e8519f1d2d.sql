REVOKE SELECT (password_hash) ON public.jf_pending_signups FROM authenticated;
REVOKE SELECT (password_hash) ON public.jf_pending_signups FROM anon;
GRANT SELECT (password_hash) ON public.jf_pending_signups TO service_role;