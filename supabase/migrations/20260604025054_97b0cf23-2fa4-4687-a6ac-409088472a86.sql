CREATE TABLE public.important_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  title text NOT NULL,
  date_type text NOT NULL DEFAULT 'Competition',
  custom_type text,
  target_date date NOT NULL,
  start_date date,
  countdown_label text,
  notes text,
  phase_id uuid,
  program_link text,
  status text NOT NULL DEFAULT 'Active',
  visible_to_client boolean NOT NULL DEFAULT true,
  approaching_soon_days integer NOT NULL DEFAULT 14,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.important_dates TO authenticated;
GRANT ALL ON public.important_dates TO service_role;

ALTER TABLE public.important_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage important_dates"
  ON public.important_dates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Client read own important_dates"
  ON public.important_dates FOR SELECT TO authenticated
  USING (
    visible_to_client AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = important_dates.client_id AND c.user_id = auth.uid()
    )
  );

CREATE TRIGGER tg_important_dates_updated_at
  BEFORE UPDATE ON public.important_dates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_important_dates_client ON public.important_dates(client_id);
CREATE INDEX idx_important_dates_target ON public.important_dates(target_date);