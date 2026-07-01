-- Remove stale "client" role rows from jf_members who have no clients record.
-- These leftovers cause the auth resolver and role-based RLS to treat them
-- as clients instead of members. The resolver already prefers member when
-- no clients row exists, but cleaning the data avoids ambiguity elsewhere.
DELETE FROM public.user_roles ur
WHERE ur.role = 'client'
  AND EXISTS (
    SELECT 1 FROM public.app_members m
    WHERE m.user_id = ur.user_id
      AND m.account_type = 'jf_member'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.user_id = ur.user_id
  );