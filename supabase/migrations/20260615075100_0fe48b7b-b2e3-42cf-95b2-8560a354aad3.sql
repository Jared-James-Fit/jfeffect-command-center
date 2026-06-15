REVOKE EXECUTE ON FUNCTION public.admin_clients_directory(text, text, text, uuid, text, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_clients_directory(text, text, text, uuid, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_clients_directory(text, text, text, uuid, text, int, int) TO authenticated;