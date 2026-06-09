CREATE TABLE public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX message_reactions_message_idx ON public.message_reactions(message_id);

GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Read: anyone who can see the underlying message thread
CREATE POLICY "Read reactions on visible messages"
  ON public.message_reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND (
          public.has_role(auth.uid(), 'admin'::app_role)
          OR public.is_assigned_coach(m.client_id)
          OR (
            m.is_internal_note = false
            AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = m.client_id AND c.user_id = auth.uid())
          )
        )
    )
  );

-- Insert: only own reactions, on messages they can see, message not deleted
CREATE POLICY "Insert own reactions"
  ON public.message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reactions.message_id
        AND m.deleted_at IS NULL
        AND (
          public.has_role(auth.uid(), 'admin'::app_role)
          OR public.is_assigned_coach(m.client_id)
          OR (
            m.is_internal_note = false
            AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = m.client_id AND c.user_id = auth.uid())
          )
        )
    )
  );

-- Delete: only own reactions
CREATE POLICY "Delete own reactions"
  ON public.message_reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;