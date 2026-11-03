-- community_username_on_member() is the trigger on both clients and user_roles.
-- Its condition read NEW.role directly, and PL/pgSQL resolves every field in an
-- expression before it evaluates the OR, so on clients (no role column) every
-- INSERT and every UPDATE OF user_id failed with 'record "new" has no field
-- "role"': Add client, linking a login and new JF members (app_members_ensure_client)
-- all errored. Reading the role through to_jsonb works for both tables, and the
-- trigger is back to never blocking the write that added the person.
CREATE OR REPLACE FUNCTION public.community_username_on_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND (TG_TABLE_NAME <> 'user_roles' OR (to_jsonb(NEW) ->> 'role') IN ('admin', 'coach')) THEN
    BEGIN
      PERFORM public.community_ensure_username(NEW.user_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.community_username_on_member() FROM PUBLIC, anon, authenticated;
