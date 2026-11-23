-- Starred clients (Nov 23 2026): each coach's or admin's own short list of the
-- athletes they keep coming back to (in-person sessions, calls, program
-- reviews). The Clients list filters by it or puts them first, and the
-- workout quick view switches between them in one tap.
--
-- A star is the person's own: nobody else reads it (a second admin never sees
-- the owner's), and it only ever names a client that login can already see:
-- an admin any client, a coach only the clients assigned to them
-- (coached_client_ids). Starring changes nothing about the client and tells
-- nobody. A star goes with its client or its login (cascade); it holds no
-- client data, so an account's day-30 purge has nothing here to keep.
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.staff_client_stars (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

COMMENT ON TABLE public.staff_client_stars IS
  'A coach''s or admin''s own starred clients (Clients list Starred filter, the workout quick view''s switcher). Own rows only.';

CREATE INDEX IF NOT EXISTS staff_client_stars_client_idx ON public.staff_client_stars (client_id);

ALTER TABLE public.staff_client_stars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own stars: read" ON public.staff_client_stars;
CREATE POLICY "Own stars: read" ON public.staff_client_stars
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Starring is for staff, and only a client they can already see.
DROP POLICY IF EXISTS "Own stars: add" ON public.staff_client_stars;
CREATE POLICY "Own stars: add" ON public.staff_client_stars
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR client_id IN (SELECT public.coached_client_ids())
    )
  );

DROP POLICY IF EXISTS "Own stars: remove" ON public.staff_client_stars;
CREATE POLICY "Own stars: remove" ON public.staff_client_stars
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- No UPDATE: a star is added or removed, never changed.
REVOKE ALL ON public.staff_client_stars FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.staff_client_stars TO authenticated;
GRANT ALL ON public.staff_client_stars TO service_role;
