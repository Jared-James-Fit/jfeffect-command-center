-- Reference maxes are traceable and reversible (Strength Intelligence, Nov 26 2026).
--
-- Every add, change and removal of a client's 1RM / training max / pinned
-- estimate (`pl_client_maxes`) is kept here by a trigger, with who did it and
-- when, so the coach can see why a % load moved and put any earlier version back
-- (the maxes panel's History, src/lib/strength-intel/max-history.ts). Written
-- only by the trigger; staff read their own clients' rows. A removal caused by
-- deleting the client or the block (a cascade) isn't kept: the client's own
-- history goes with them.

-- never wait long on a busy table (a backup's read lock must not queue the app behind this)
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.pl_client_max_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  op text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pl_client_max_history_client_idx
  ON public.pl_client_max_history (client_id, changed_at DESC);

ALTER TABLE public.pl_client_max_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read their clients' max history" ON public.pl_client_max_history;
CREATE POLICY "Staff read their clients' max history" ON public.pl_client_max_history
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'))
    OR client_id IN (SELECT public.coached_client_ids())
  );

REVOKE INSERT, UPDATE, DELETE ON public.pl_client_max_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_pl_client_max_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pl_client_max_history (max_id, client_id, op, before, after, changed_by)
    VALUES (NEW.id, NEW.client_id, 'insert', NULL, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- a save that changed nothing (only the timestamp) is no change
    IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.pl_client_max_history (max_id, client_id, op, before, after, changed_by)
    VALUES (NEW.id, NEW.client_id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSE
    -- removed by a cascade (the client or the block deleted): nothing to restore into
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    INSERT INTO public.pl_client_max_history (max_id, client_id, op, before, after, changed_by)
    VALUES (OLD.id, OLD.client_id, 'delete', to_jsonb(OLD), NULL, auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_pl_client_max_history() FROM PUBLIC, anon, authenticated;

-- created only when missing: DROP TRIGGER would take an exclusive lock on pl_client_maxes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'pl_client_max_history' AND tgrelid = 'public.pl_client_maxes'::regclass
  ) THEN
    CREATE TRIGGER pl_client_max_history
      AFTER INSERT OR UPDATE OR DELETE ON public.pl_client_maxes
      FOR EACH ROW EXECUTE FUNCTION public.tg_pl_client_max_history();
  END IF;
END $$;
