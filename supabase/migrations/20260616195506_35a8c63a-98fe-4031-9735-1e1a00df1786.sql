CREATE OR REPLACE FUNCTION public.is_assigned_coach_for_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
    WHERE c.id = _client_id
      AND co.user_id = auth.uid()
      AND co.archived = false
      AND co.status = 'Active'
  );
$$;