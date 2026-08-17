-- Preserve server-computed CRM linkage and lead intelligence on trusted
-- service-role application writes. Public anon/authenticated inserts remain
-- scrubbed by the existing guard below.
CREATE OR REPLACE FUNCTION public.tg_coaching_applications_anon_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server functions use the Supabase service-role JWT. They have already
  -- validated and computed client_id, lead score, and attribution server-side.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Preserve the original least-privilege behavior for direct public inserts.
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

COMMENT ON FUNCTION public.tg_coaching_applications_anon_defaults() IS
  'Scrubs protected coaching-application fields on direct public inserts while preserving trusted service-role server-function writes.';
