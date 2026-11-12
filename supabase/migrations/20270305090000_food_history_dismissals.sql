-- A client's food history keeps every allergy, diet and health condition
-- they've ever named (food-history.ts) until the coach marks one as no longer
-- applying. That mark is a row here: per client, the kind and the fact's key,
-- when. A mention after it brings the fact back (the builder compares dates).
-- Staff only (admins and the client's own coach); clients never read it.

CREATE TABLE IF NOT EXISTS public.client_food_history_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('allergy', 'diet', 'health')),
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 300),
  dismissed_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind, key)
);

ALTER TABLE public.client_food_history_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read food history dismissals" ON public.client_food_history_dismissals;
CREATE POLICY "Staff read food history dismissals" ON public.client_food_history_dismissals
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff add food history dismissals" ON public.client_food_history_dismissals;
CREATE POLICY "Staff add food history dismissals" ON public.client_food_history_dismissals
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff update food history dismissals" ON public.client_food_history_dismissals;
CREATE POLICY "Staff update food history dismissals" ON public.client_food_history_dismissals
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff remove food history dismissals" ON public.client_food_history_dismissals;
CREATE POLICY "Staff remove food history dismissals" ON public.client_food_history_dismissals
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

REVOKE ALL ON public.client_food_history_dismissals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_food_history_dismissals TO authenticated;

SELECT public.rls_evaluate_once('client_food_history_dismissals');
