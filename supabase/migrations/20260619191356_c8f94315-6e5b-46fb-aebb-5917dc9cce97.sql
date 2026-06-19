-- Remove overly permissive client UPDATE policy on agreements.
-- Clients do not update agreement rows from the portal; all signing/verification
-- is performed by admin or coach server functions (which match their own policies).
DROP POLICY IF EXISTS "Client update own agreements" ON public.agreements;