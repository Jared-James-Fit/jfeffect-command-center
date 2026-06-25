
ALTER TABLE public.media_content_records
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_version integer,
  ADD COLUMN IF NOT EXISTS approved_version integer,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_change_request text,
  ADD COLUMN IF NOT EXISTS last_change_requested_by uuid,
  ADD COLUMN IF NOT EXISTS last_change_requested_at timestamptz;

CREATE TABLE IF NOT EXISTS public.media_content_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES public.media_content_records(id) ON DELETE CASCADE,
  author_id uuid,
  body text NOT NULL,
  version integer,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_content_comments TO authenticated;
GRANT ALL ON public.media_content_comments TO service_role;
ALTER TABLE public.media_content_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcc_admin_media_all" ON public.media_content_comments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'));
CREATE INDEX IF NOT EXISTS mcc_content_idx ON public.media_content_comments(content_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.media_content_review_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES public.media_content_records(id) ON DELETE CASCADE,
  actor_id uuid,
  kind text NOT NULL, -- submitted | approved | changes_requested | reopened
  version integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.media_content_review_events TO authenticated;
GRANT ALL ON public.media_content_review_events TO service_role;
ALTER TABLE public.media_content_review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcre_admin_media_read" ON public.media_content_review_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'));
CREATE POLICY "mcre_admin_media_insert" ON public.media_content_review_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'media_manager') OR public.has_role(auth.uid(),'coach'));
CREATE INDEX IF NOT EXISTS mcre_content_idx ON public.media_content_review_events(content_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS mcc_set_updated_at ON public.media_content_comments;
CREATE TRIGGER mcc_set_updated_at BEFORE UPDATE ON public.media_content_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
