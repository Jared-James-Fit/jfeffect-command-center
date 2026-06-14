
ALTER TABLE public.agreement_templates
  ADD COLUMN IF NOT EXISTS manually_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_hide_reason text;

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS custom_title text;

ALTER TABLE public.agreements
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS signer_email text,
  ADD COLUMN IF NOT EXISTS signer_name  text;

CREATE INDEX IF NOT EXISTS agreements_unlinked_idx
  ON public.agreements (created_at DESC)
  WHERE client_id IS NULL;
