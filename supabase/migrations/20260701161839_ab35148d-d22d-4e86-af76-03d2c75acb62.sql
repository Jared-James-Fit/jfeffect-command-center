
-- 1. Ticket number for support threads (bigserial, formatted at the app layer).
ALTER TABLE public.member_support_threads
  ADD COLUMN IF NOT EXISTS ticket_number BIGINT;

CREATE SEQUENCE IF NOT EXISTS public.member_support_ticket_seq START 1000;

-- Backfill existing rows in creation order.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.member_support_threads WHERE ticket_number IS NULL ORDER BY created_at LOOP
    UPDATE public.member_support_threads SET ticket_number = nextval('public.member_support_ticket_seq') WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.member_support_threads
  ALTER COLUMN ticket_number SET DEFAULT nextval('public.member_support_ticket_seq'),
  ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS member_support_threads_ticket_number_idx
  ON public.member_support_threads (ticket_number);

-- 2. Live support agent availability.
CREATE TABLE IF NOT EXISTS public.live_support_agents (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_support_agents TO authenticated;
GRANT ALL ON public.live_support_agents TO service_role;

ALTER TABLE public.live_support_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read live agents" ON public.live_support_agents;
CREATE POLICY "auth read live agents"
  ON public.live_support_agents FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "manage own agent row" ON public.live_support_agents;
CREATE POLICY "manage own agent row"
  ON public.live_support_agents FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins manage all agents" ON public.live_support_agents;
CREATE POLICY "admins manage all agents"
  ON public.live_support_agents FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_support_agents;
