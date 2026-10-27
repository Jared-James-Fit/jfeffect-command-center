-- The coach inbox's Brief: the last AI read of each client, kept against a
-- hash of exactly what it was written from (getClientBriefAi), so reopening a
-- Brief nothing changed in costs no new AI call. Server only: no client or
-- staff role reads it directly (the server fn checks the coach can see the
-- client first, through their own RLS).

CREATE TABLE IF NOT EXISTS public.inbox_client_briefs (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  summary text NOT NULL,
  next_step text,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbox_client_briefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_client_briefs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.inbox_client_briefs TO service_role;
