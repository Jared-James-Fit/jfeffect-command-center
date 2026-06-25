-- Coaching applications: allow public/anon submissions via PostgREST.
-- The current production path uses a service-role server function, but adding
-- a scoped anon INSERT policy ensures direct PostgREST submissions never
-- silently fail and clearly documents which fields are user-supplied vs admin-only.

CREATE OR REPLACE FUNCTION public.tg_coaching_applications_anon_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Force admin-controlled fields to safe defaults on anon/authenticated (non-admin) inserts.
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    NEW.status := 'New';
    NEW.application_status := COALESCE(NEW.application_status, 'submitted');
    NEW.call_status := 'not_booked';
    NEW.assigned_to := NULL;
    NEW.notes_admin := NULL;
    NEW.client_id := NULL;
    NEW.lead_score := NULL;
    NEW.lead_temperature := NULL;
    NEW.recommended_offer := NULL;
    NEW.qualification_label := NULL;
    NEW.scoring := NULL;
    NEW.appointment_id := NULL;
    NEW.follow_up_at := NULL;
    NEW.source := COALESCE(NEW.source, 'coaching_page');
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_coaching_applications_anon_defaults ON public.coaching_applications;
CREATE TRIGGER tg_coaching_applications_anon_defaults
  BEFORE INSERT ON public.coaching_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_coaching_applications_anon_defaults();

-- Grant INSERT to anon and authenticated so PostgREST accepts the call.
GRANT INSERT ON public.coaching_applications TO anon, authenticated;

-- Allow anyone to submit an application. Admin-only fields are scrubbed by the
-- BEFORE INSERT trigger above, so the WITH CHECK only needs to enforce the
-- required user-supplied fields.
CREATE POLICY "coaching_applications public submit"
  ON public.coaching_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    full_name IS NOT NULL
    AND email IS NOT NULL
    AND char_length(full_name) BETWEEN 1 AND 200
    AND char_length(email) BETWEEN 3 AND 320
  );

-- jf_pending_signups: all inserts go through a service-role server function
-- (src/lib/jf-billing.functions.ts -> supabaseAdmin.from('jf_pending_signups').insert).
-- Service role bypasses RLS, so no anon policy is required. Keep the table
-- locked down to admins to prevent any direct PostgREST writes. Documented in
-- security memory as intentional.
COMMENT ON TABLE public.jf_pending_signups IS
  'Pending signup staging. Writes happen exclusively via the service-role server function in src/lib/jf-billing.functions.ts; no anon RLS policy is intentional.';
