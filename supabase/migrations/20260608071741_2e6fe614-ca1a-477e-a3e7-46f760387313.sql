CREATE OR REPLACE FUNCTION public.tg_nf_autoassign_new_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.archived = true OR COALESCE(NEW.status, 'Active') NOT IN ('Active', 'New Client') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.nf_assignments (form_id, client_id)
  SELECT f.id, NEW.id
    FROM public.nf_forms f
   WHERE f.auto_assign_new_clients = true
     AND f.active = true
     AND f.archived = false
  ON CONFLICT (form_id, client_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_client_created_assign_forms ON public.clients;
DROP TRIGGER IF EXISTS nf_autoassign_new_client ON public.clients;
DROP TRIGGER IF EXISTS nf_autoassign_new_client_insert ON public.clients;
DROP TRIGGER IF EXISTS nf_autoassign_new_client_update ON public.clients;

CREATE TRIGGER nf_autoassign_new_client_insert
AFTER INSERT ON public.clients
FOR EACH ROW
WHEN (NEW.archived = false AND COALESCE(NEW.status, 'Active') IN ('Active', 'New Client'))
EXECUTE FUNCTION public.tg_nf_autoassign_new_client();

CREATE TRIGGER nf_autoassign_new_client_update
AFTER UPDATE OF status, archived ON public.clients
FOR EACH ROW
WHEN (
  NEW.archived = false
  AND COALESCE(NEW.status, 'Active') IN ('Active', 'New Client')
  AND (OLD.archived IS DISTINCT FROM NEW.archived OR OLD.status IS DISTINCT FROM NEW.status)
)
EXECUTE FUNCTION public.tg_nf_autoassign_new_client();

DROP POLICY IF EXISTS "Client read assigned nf_forms" ON public.nf_forms;
CREATE POLICY "Client read assigned nf_forms"
ON public.nf_forms
FOR SELECT
TO authenticated
USING (
  active = true
  AND archived = false
  AND EXISTS (
    SELECT 1
    FROM public.nf_assignments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.form_id = nf_forms.id
      AND c.user_id = auth.uid()
      AND c.archived = false
  )
);

DROP POLICY IF EXISTS "Client read assigned nf_questions" ON public.nf_questions;
CREATE POLICY "Client read assigned nf_questions"
ON public.nf_questions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.nf_forms f
    JOIN public.nf_assignments a ON a.form_id = f.id
    JOIN public.clients c ON c.id = a.client_id
    WHERE f.id = nf_questions.form_id
      AND f.active = true
      AND f.archived = false
      AND c.user_id = auth.uid()
      AND c.archived = false
  )
);

DROP POLICY IF EXISTS "Client insert own nf_submissions" ON public.nf_submissions;
CREATE POLICY "Client insert own nf_submissions"
ON public.nf_submissions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.nf_forms f ON f.id = nf_submissions.form_id
    WHERE c.id = nf_submissions.client_id
      AND c.user_id = auth.uid()
      AND c.archived = false
      AND f.active = true
      AND f.archived = false
      AND (
        EXISTS (
          SELECT 1
          FROM public.nf_assignments a
          WHERE a.form_id = f.id
            AND a.client_id = c.id
        )
        OR (
          f.visibility = 'all_active_clients'
          AND COALESCE(c.status, 'Active') IN ('Active', 'New Client')
        )
      )
  )
);

DROP POLICY IF EXISTS "Client update own nf_submissions" ON public.nf_submissions;
CREATE POLICY "Client update own nf_submissions"
ON public.nf_submissions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.nf_forms f ON f.id = nf_submissions.form_id
    WHERE c.id = nf_submissions.client_id
      AND c.user_id = auth.uid()
      AND c.archived = false
      AND f.active = true
      AND f.archived = false
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.nf_forms f ON f.id = nf_submissions.form_id
    WHERE c.id = nf_submissions.client_id
      AND c.user_id = auth.uid()
      AND c.archived = false
      AND f.active = true
      AND f.archived = false
  )
);