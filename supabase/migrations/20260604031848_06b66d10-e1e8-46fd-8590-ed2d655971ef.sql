
-- Messaging system

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('admin','client')),
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_type text NOT NULL DEFAULT 'General',
  priority text,
  is_internal_note boolean NOT NULL DEFAULT false,
  read_by_admin_at timestamptz,
  read_by_client_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_client_idx ON public.messages(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage messages" ON public.messages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Client read own messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    is_internal_note = false
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.user_id = auth.uid())
  );

CREATE POLICY "Client send own messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_role = 'client'
    AND is_internal_note = false
    AND priority IS NULL
    AND sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.user_id = auth.uid())
  );

CREATE POLICY "Client update own read marker" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = messages.client_id AND c.user_id = auth.uid())
  );

CREATE TRIGGER tg_messages_updated_at BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Conversation state
CREATE TABLE public.conversation_state (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  priority text NOT NULL DEFAULT 'Normal',
  status text NOT NULL DEFAULT 'open',
  admin_last_read_at timestamptz,
  client_last_read_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_state TO authenticated;
GRANT ALL ON public.conversation_state TO service_role;

ALTER TABLE public.conversation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage conversation_state" ON public.conversation_state
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Client read own conversation_state" ON public.conversation_state
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = conversation_state.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client update own conversation_state" ON public.conversation_state
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = conversation_state.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = conversation_state.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client insert own conversation_state" ON public.conversation_state
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = conversation_state.client_id AND c.user_id = auth.uid()));

CREATE TRIGGER tg_conversation_state_updated_at BEFORE UPDATE ON public.conversation_state
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Trigger to update conversation_state when a message is sent
CREATE OR REPLACE FUNCTION public.tg_message_touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_internal_note THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.conversation_state (client_id, last_message_at, status)
  VALUES (
    NEW.client_id,
    NEW.created_at,
    CASE WHEN NEW.sender_role = 'client' THEN 'needs_response' ELSE 'open' END
  )
  ON CONFLICT (client_id) DO UPDATE
    SET last_message_at = EXCLUDED.last_message_at,
        status = CASE
          WHEN NEW.sender_role = 'client' THEN 'needs_response'
          WHEN public.conversation_state.status = 'needs_response' THEN 'open'
          ELSE public.conversation_state.status
        END,
        updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_message_touch_conversation();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_state;
