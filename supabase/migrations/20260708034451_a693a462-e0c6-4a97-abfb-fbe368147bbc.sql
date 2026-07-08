REVOKE EXECUTE ON FUNCTION public.app_members_block_self_privileged_updates() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clients_block_self_privileged_updates() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_privileged_writer() FROM PUBLIC, anon;