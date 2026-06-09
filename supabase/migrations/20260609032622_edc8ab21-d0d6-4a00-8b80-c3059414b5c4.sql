
CREATE TABLE public.manual_check_in_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  check_in_date date,
  title text NOT NULL DEFAULT 'Check-In Review',
  message text NOT NULL,
  action_items text,
  priority text,
  internal_notes text,
  external_link text,
  notify_client boolean NOT NULL DEFAULT true,
  seen_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX manual_check_in_reviews_client_idx ON public.manual_check_in_reviews(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_check_in_reviews TO authenticated;
GRANT ALL ON public.manual_check_in_reviews TO service_role;

ALTER TABLE public.manual_check_in_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage manual_check_in_reviews"
  ON public.manual_check_in_reviews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned manual_check_in_reviews"
  ON public.manual_check_in_reviews
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE POLICY "Client read own manual_check_in_reviews"
  ON public.manual_check_in_reviews
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = manual_check_in_reviews.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client mark own manual_check_in_reviews read"
  ON public.manual_check_in_reviews
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = manual_check_in_reviews.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = manual_check_in_reviews.client_id AND c.user_id = auth.uid()));

CREATE TRIGGER manual_check_in_reviews_set_updated_at
  BEFORE UPDATE ON public.manual_check_in_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
