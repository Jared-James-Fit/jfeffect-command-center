
-- 1. Add per-form Fillout identity flag
ALTER TABLE public.nf_forms
  ADD COLUMN IF NOT EXISTS requires_client_identity boolean NOT NULL DEFAULT true;

-- 2. Fillout submissions (external form responses received via webhook)
CREATE TABLE IF NOT EXISTS public.fillout_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid REFERENCES public.nf_forms(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  fillout_submission_id text UNIQUE,
  fillout_form_id text,
  form_type text,
  form_name text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  unread boolean NOT NULL DEFAULT true,
  unmatched boolean NOT NULL DEFAULT false,
  unmatch_reason text,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fillout_submissions TO authenticated;
GRANT ALL ON public.fillout_submissions TO service_role;

ALTER TABLE public.fillout_submissions ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "fillout_submissions admin all"
  ON public.fillout_submissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Coaches: read all (so they can triage unmatched)
CREATE POLICY "fillout_submissions coach read"
  ON public.fillout_submissions FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

-- Coaches: update submissions for clients assigned to them or unmatched
CREATE POLICY "fillout_submissions coach update"
  ON public.fillout_submissions FOR UPDATE TO authenticated
  USING (
    public.is_coach_or_admin(auth.uid())
    AND (client_id IS NULL OR public.is_assigned_coach(client_id))
  )
  WITH CHECK (
    public.is_coach_or_admin(auth.uid())
    AND (client_id IS NULL OR public.is_assigned_coach(client_id))
  );

CREATE INDEX IF NOT EXISTS fillout_submissions_client_idx ON public.fillout_submissions(client_id);
CREATE INDEX IF NOT EXISTS fillout_submissions_form_idx ON public.fillout_submissions(form_id);
CREATE INDEX IF NOT EXISTS fillout_submissions_unmatched_idx ON public.fillout_submissions(unmatched) WHERE unmatched;
CREATE INDEX IF NOT EXISTS fillout_submissions_unread_idx ON public.fillout_submissions(unread) WHERE unread;

CREATE TRIGGER fillout_submissions_set_updated_at
  BEFORE UPDATE ON public.fillout_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
