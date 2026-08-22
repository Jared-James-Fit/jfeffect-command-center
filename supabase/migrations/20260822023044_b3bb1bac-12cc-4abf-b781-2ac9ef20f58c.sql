CREATE TABLE public.payment_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  purchase_record_id uuid NOT NULL REFERENCES public.purchase_records(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked boolean NOT NULL DEFAULT false,
  last_resolved_at timestamptz,
  resolve_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_share_links_purchase ON public.payment_share_links(purchase_record_id);

GRANT SELECT ON public.payment_share_links TO authenticated;
GRANT ALL ON public.payment_share_links TO service_role;

ALTER TABLE public.payment_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view payment share links"
ON public.payment_share_links FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach'));