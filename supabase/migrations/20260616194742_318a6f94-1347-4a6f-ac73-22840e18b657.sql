REVOKE EXECUTE ON FUNCTION public.notif_mark_read(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notif_mark_unread(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notif_archive(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notif_restore(jsonb) FROM PUBLIC, anon;