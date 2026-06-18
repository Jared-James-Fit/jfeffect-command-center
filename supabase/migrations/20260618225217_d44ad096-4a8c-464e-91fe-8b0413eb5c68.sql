
-- 1) Reply messages table
CREATE TABLE public.manual_check_in_review_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.manual_check_in_reviews(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('coach','client')),
  sender_user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX manual_check_in_review_messages_review_id_idx
  ON public.manual_check_in_review_messages(review_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_check_in_review_messages TO authenticated;
GRANT ALL ON public.manual_check_in_review_messages TO service_role;

ALTER TABLE public.manual_check_in_review_messages ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admin manage review messages"
  ON public.manual_check_in_review_messages
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Assigned coach read/post
CREATE POLICY "Coach read assigned review messages"
  ON public.manual_check_in_review_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.manual_check_in_reviews r
      WHERE r.id = review_id AND is_assigned_coach(r.client_id)
    )
  );

CREATE POLICY "Coach post assigned review messages"
  ON public.manual_check_in_review_messages
  FOR INSERT
  WITH CHECK (
    sender_role = 'coach'
    AND sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.manual_check_in_reviews r
      WHERE r.id = review_id AND is_assigned_coach(r.client_id)
    )
  );

-- Client read own thread
CREATE POLICY "Client read own review messages"
  ON public.manual_check_in_review_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.manual_check_in_reviews r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = review_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Client post own review messages"
  ON public.manual_check_in_review_messages
  FOR INSERT
  WITH CHECK (
    sender_role = 'client'
    AND sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.manual_check_in_reviews r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = review_id AND c.user_id = auth.uid()
    )
  );

-- 2) Last-read columns on the parent review
ALTER TABLE public.manual_check_in_reviews
  ADD COLUMN IF NOT EXISTS coach_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_last_read_at timestamptz;

-- 3) Bump parent updated_at when a new message lands
CREATE OR REPLACE FUNCTION public.bump_manual_check_in_review_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.manual_check_in_reviews
  SET updated_at = now()
  WHERE id = NEW.review_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_review_on_msg
AFTER INSERT ON public.manual_check_in_review_messages
FOR EACH ROW
EXECUTE FUNCTION public.bump_manual_check_in_review_updated_at();

-- 4) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.manual_check_in_review_messages;
