-- Personal booking links (Nov 20 2026).
--
-- A link the coach sends one client (from their chat or profile) carries an
-- opaque random token: jfeffect.com/b/<token>. Only a SHA-256 of the token is
-- stored here, the URL never names the client, and the server resolves it to
-- the client, the booking type and the length the coach picked. A link can be
-- cancelled (revoked_at) and runs out (expires_at), and it holds one booking
-- at a time: while the session it booked is booked, done or counted as missed
-- it shows that booking; once that session is cancelled or moved away it can
-- book again. Before this a personal link was "<client uuid>.<expiry>.<hmac>", which
-- put the client's id in the URL and couldn't be cancelled, and the chat's
-- Booking Link card had no token at all, so anyone not signed in as the client
-- (a forwarded text, Safari, the coach's View as client) was asked to sign in
-- or apply for coaching.
--
-- Written only by the server (service role) after a staff check; staff read
-- their own clients' links (admins all); clients and the public never read it.

CREATE TABLE IF NOT EXISTS public.booking_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  booking_card_id uuid NOT NULL REFERENCES public.booking_cards(id) ON DELETE CASCADE,
  -- The length the coach picked for a type that offers several (a General Call); null = the type's own.
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Opened at all (the coach's card says "Opened" when they haven't booked yet).
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  -- The session it booked (the link shows it while it stands).
  booked_session_id uuid REFERENCES public.pt_sessions(id) ON DELETE SET NULL,
  booked_at timestamptz,
  -- A booking in progress (two taps on one link never book twice).
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS booking_invites_client_idx ON public.booking_invites (client_id, created_at DESC);

ALTER TABLE public.booking_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Booking invites: admin read" ON public.booking_invites;
CREATE POLICY "Booking invites: admin read" ON public.booking_invites
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Booking invites: coach read" ON public.booking_invites;
CREATE POLICY "Booking invites: coach read" ON public.booking_invites
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));

REVOKE INSERT, UPDATE, DELETE ON public.booking_invites FROM anon, authenticated;
REVOKE ALL ON public.booking_invites FROM anon;
GRANT SELECT ON public.booking_invites TO authenticated;

-- Hold a link for one booking: 'ok' (held), or why not: 'invalid', 'revoked',
-- 'expired', 'booked' (its session still stands), 'busy' (another tap is booking it).
CREATE OR REPLACE FUNCTION public.booking_invite_claim(_invite uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.booking_invites%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.booking_invites WHERE id = _invite FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  IF r.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF r.booked_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pt_sessions s
     WHERE s.id = r.booked_session_id
       AND s.status IN ('Scheduled', 'Completed', 'Missed')
  ) THEN
    RETURN 'booked';
  END IF;
  IF r.claimed_at IS NOT NULL AND r.claimed_at > now() - interval '2 minutes' THEN
    RETURN 'busy';
  END IF;
  UPDATE public.booking_invites SET claimed_at = now() WHERE id = _invite;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.booking_invite_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_invite_claim(uuid) TO service_role;

SELECT public.rls_evaluate_once('booking_invites');
