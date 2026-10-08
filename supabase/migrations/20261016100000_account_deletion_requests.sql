-- Account deletion requests with a 30-day hold.
--
-- Anyone signed in can ask for their account to be deleted. The request sits
-- for 30 days (set by the database, not the app) and can be cancelled until
-- then. Admins see every request. Carrying out a deletion is a separate,
-- reviewed step: some records must be kept (e.g. payment_ledger, for tax).
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT now() + interval '30 days',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1000),
  cancelled_at timestamptz,
  completed_at timestamptz,
  completed_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_pending
  ON public.account_deletion_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_deletion_requests_due
  ON public.account_deletion_requests (delete_after) WHERE status = 'pending';

-- The hold can't be shortened from the app: requested_at / delete_after are
-- always set here on insert, and only an admin can move a request on.
CREATE OR REPLACE FUNCTION public.tg_account_deletion_request_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.requested_at := now();
    NEW.delete_after := now() + interval '30 days';
    NEW.status := 'pending';
    NEW.cancelled_at := NULL;
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
    RETURN NEW;
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.uid() IS NOT NULL THEN
    -- The owner may only cancel a pending request.
    IF OLD.status <> 'pending' OR NEW.status <> 'cancelled'
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.delete_after IS DISTINCT FROM OLD.delete_after
       OR NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL THEN
      RAISE EXCEPTION 'You can only cancel a pending deletion request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_deletion_request_guard ON public.account_deletion_requests;
CREATE TRIGGER account_deletion_request_guard
  BEFORE INSERT OR UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_account_deletion_request_guard();

GRANT SELECT, INSERT, UPDATE ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own deletion requests read" ON public.account_deletion_requests;
CREATE POLICY "Own deletion requests read" ON public.account_deletion_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Own deletion request create" ON public.account_deletion_requests;
CREATE POLICY "Own deletion request create" ON public.account_deletion_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Own deletion request cancel" ON public.account_deletion_requests;
CREATE POLICY "Own deletion request cancel" ON public.account_deletion_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
