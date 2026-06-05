ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS default_agreement_template_id uuid REFERENCES public.agreement_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offers_default_agreement_template_id
  ON public.offers(default_agreement_template_id);

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS signed_pdf_pulled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS webhook_last_event text,
  ADD COLUMN IF NOT EXISTS webhook_last_event_at timestamp with time zone;