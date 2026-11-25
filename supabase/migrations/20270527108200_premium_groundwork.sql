-- JF Effect Premium, groundwork only (T01). No purchase path exists yet (the
-- App Store decision is pending), so nobody has Premium unless the admin grants
-- it as complimentary from the member's Access card. Premium is an entitlement
-- (member_access 'jf_premium'), never a coaching package, so it can't appear on
-- the public pages. It gives Build with Cleo in the program builder and a Cleo
-- inbox (weekly recaps, notes), both checked by premium_active().

INSERT INTO public.access_levels (key, label, description, sort_order)
VALUES ('jf_premium', 'JF Effect Premium', 'Build with Cleo and the Cleo inbox. Granted by the admin until a purchase path exists.', 85)
ON CONFLICT (key) DO NOTHING;

-- Is this login Premium right now? (An active, unexpired jf_premium grant on their member row.)
CREATE OR REPLACE FUNCTION public.premium_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.app_members m
      JOIN public.member_access a ON a.member_id = m.id
     WHERE m.user_id = _user_id
       AND a.access_level_key = 'jf_premium'
       AND a.active
       AND (a.expires_at IS NULL OR a.expires_at > now())
  )
$$;
REVOKE ALL ON FUNCTION public.premium_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.premium_active(uuid) TO service_role;

-- The signed-in person's own answer (never anyone else's).
CREATE OR REPLACE FUNCTION public.my_premium()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.premium_active(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.my_premium() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_premium() TO authenticated, service_role;

-- The Cleo inbox: what Cleo leaves a Premium member (a welcome, weekly recaps).
-- Written only by the server; the member reads their own and marks it read.
CREATE TABLE IF NOT EXISTS public.cleo_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome', 'weekly_recap', 'note')),
  -- one per kind and period (a recap's ISO week start), so a rerun never doubles it
  period_key text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleo_inbox_one_per_period UNIQUE (user_id, kind, period_key)
);
CREATE INDEX IF NOT EXISTS cleo_inbox_messages_user_created ON public.cleo_inbox_messages (user_id, created_at DESC);

ALTER TABLE public.cleo_inbox_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.cleo_inbox_messages TO authenticated;
GRANT ALL ON public.cleo_inbox_messages TO service_role;

DROP POLICY IF EXISTS "cleo inbox: own" ON public.cleo_inbox_messages;
CREATE POLICY "cleo inbox: own" ON public.cleo_inbox_messages
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "cleo inbox: mark own read" ON public.cleo_inbox_messages;
CREATE POLICY "cleo inbox: mark own read" ON public.cleo_inbox_messages
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Only read_at may change from the app.
REVOKE UPDATE ON public.cleo_inbox_messages FROM authenticated;
GRANT UPDATE (read_at) ON public.cleo_inbox_messages TO authenticated;

SELECT public.rls_evaluate_once('cleo_inbox_messages');
