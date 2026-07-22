-- Fix: nutrition-submissions storage reads must be limited to the client's assigned coach or an admin.

-- Helper: is the current authenticated user the assigned coach for a given client user_id?
CREATE OR REPLACE FUNCTION public.is_assigned_coach_by_user_id(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
    WHERE c.user_id = _user_id
      AND co.user_id = auth.uid()
      AND co.archived = false
      AND co.status = 'Active'
  )
$$;

-- Replace the overly broad admin/coach read policy with one scoped to admins or assigned coaches.
DROP POLICY IF EXISTS "nutrition_subs_admin_read" ON storage.objects;

CREATE POLICY "nutrition_subs_coach_read_assigned"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'nutrition-submissions'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.is_assigned_coach_by_user_id((storage.foldername(name))[1]::uuid)
  )
);
