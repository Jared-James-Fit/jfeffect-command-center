ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read processed events"
  ON public.processed_stripe_events
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Service role insert processed events"
  ON public.processed_stripe_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);