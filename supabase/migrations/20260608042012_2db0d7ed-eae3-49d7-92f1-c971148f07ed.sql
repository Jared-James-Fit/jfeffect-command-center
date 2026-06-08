ALTER TABLE public.nf_forms
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS button_label text,
  ADD COLUMN IF NOT EXISTS open_style text NOT NULL DEFAULT 'embed',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'selected',
  ADD COLUMN IF NOT EXISTS auto_assign_new_clients boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Client read broadcast nf_forms" ON public.nf_forms;
CREATE POLICY "Client read broadcast nf_forms"
ON public.nf_forms FOR SELECT
TO authenticated
USING (
  visibility = 'all_active_clients'
  AND active = true
  AND archived = false
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.archived = false
      AND COALESCE(c.status, 'Active') IN ('Active', 'New Client')
  )
);

DROP POLICY IF EXISTS "Client read broadcast nf_questions" ON public.nf_questions;
CREATE POLICY "Client read broadcast nf_questions"
ON public.nf_questions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.nf_forms f
    WHERE f.id = nf_questions.form_id
      AND f.visibility = 'all_active_clients'
      AND f.active = true
      AND f.archived = false
  )
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.archived = false
  )
);

CREATE OR REPLACE FUNCTION public.tg_nf_autoassign_new_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.archived = true THEN
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
$$;

DROP TRIGGER IF EXISTS nf_autoassign_after_client_insert ON public.clients;
CREATE TRIGGER nf_autoassign_after_client_insert
AFTER INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.tg_nf_autoassign_new_client();