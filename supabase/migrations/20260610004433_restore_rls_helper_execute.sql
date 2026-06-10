-- Restore EXECUTE for SECURITY DEFINER helpers used by RLS policies.
-- They are SECURITY DEFINER + STABLE, only read membership tables; safe to expose
-- to authenticated/anon since policies invoke them with auth.uid().
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_coach(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_coach_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_can_see_recipe(uuid, uuid) TO authenticated, anon;
