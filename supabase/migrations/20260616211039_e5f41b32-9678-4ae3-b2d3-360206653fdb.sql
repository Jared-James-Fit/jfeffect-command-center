CREATE OR REPLACE FUNCTION public.user_can_see_recipe(_user_id uuid, _recipe_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.recipes r
    WHERE r.id = _recipe_id
      AND r.status = 'Published'
      AND (
        r.access_scope = 'everyone'
        OR (r.access_scope = 'coaching_clients' AND EXISTS (
              SELECT 1 FROM public.clients c
               WHERE c.user_id = _user_id AND c.archived = false AND c.status = 'Active'))
        OR (r.access_scope = 'app_members' AND EXISTS (
              SELECT 1 FROM public.app_members m
               WHERE m.user_id = _user_id
                 AND m.status = 'Active'
                 AND m.account_type IN ('app_member', 'jf_member')))
        OR (r.access_scope = 'program_members' AND EXISTS (
              SELECT 1 FROM public.app_members m
               WHERE m.user_id = _user_id AND m.status = 'Active' AND m.account_type = 'program_only'))
        OR (r.access_scope = 'selected_clients' AND EXISTS (
              SELECT 1 FROM public.recipe_client_access rca
              JOIN public.clients c ON c.id = rca.client_id
              WHERE rca.recipe_id = r.id AND c.user_id = _user_id))
      )
  )
$function$;