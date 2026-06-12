ALTER TABLE public.nf_forms
  ADD COLUMN IF NOT EXISTS popup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS popup_weekdays smallint[] NOT NULL DEFAULT '{}'::smallint[],
  ADD COLUMN IF NOT EXISTS popup_start_time text,
  ADD COLUMN IF NOT EXISTS popup_end_time text,
  ADD COLUMN IF NOT EXISTS popup_start_date date,
  ADD COLUMN IF NOT EXISTS popup_end_date date;

CREATE TABLE IF NOT EXISTS public.nf_form_popup_dismissals (
  user_id uuid NOT NULL,
  form_id uuid NOT NULL REFERENCES public.nf_forms(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_id, occurrence_date)
);

GRANT SELECT, INSERT, DELETE ON public.nf_form_popup_dismissals TO authenticated;
GRANT ALL ON public.nf_form_popup_dismissals TO service_role;

ALTER TABLE public.nf_form_popup_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self select nf_form_popup_dismissals" ON public.nf_form_popup_dismissals;
CREATE POLICY "self select nf_form_popup_dismissals"
  ON public.nf_form_popup_dismissals FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self insert nf_form_popup_dismissals" ON public.nf_form_popup_dismissals;
CREATE POLICY "self insert nf_form_popup_dismissals"
  ON public.nf_form_popup_dismissals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "self delete nf_form_popup_dismissals" ON public.nf_form_popup_dismissals;
CREATE POLICY "self delete nf_form_popup_dismissals"
  ON public.nf_form_popup_dismissals FOR DELETE TO authenticated
  USING (user_id = auth.uid());