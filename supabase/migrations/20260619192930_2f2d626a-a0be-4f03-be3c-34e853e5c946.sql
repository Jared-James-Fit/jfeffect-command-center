-- Trigger functions: revoke from PUBLIC and anon entirely (only the trigger system invokes them)
REVOKE EXECUTE ON FUNCTION public.prevent_app_member_self_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_client_self_privileged_message_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_client_self_privileged_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_coach_self_escalation() FROM PUBLIC, anon, authenticated;

-- User-facing helper: keep authenticated, drop anon/public
REVOKE EXECUTE ON FUNCTION public.get_my_referral_attribution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_attribution() TO authenticated;
