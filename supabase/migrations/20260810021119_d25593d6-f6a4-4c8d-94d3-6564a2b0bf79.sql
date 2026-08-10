CREATE TABLE public.booking_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  session_type text NOT NULL DEFAULT 'Personal Training Session',
  custom_type text,
  duration_minutes integer NOT NULL DEFAULT 60,
  location text,
  default_notes text,
  visible_to_client boolean NOT NULL DEFAULT true,
  client_visible_notes boolean NOT NULL DEFAULT true,
  reminders_enabled boolean NOT NULL DEFAULT true,
  send_confirmation_email boolean NOT NULL DEFAULT true,
  uses_credit boolean NOT NULL DEFAULT true,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_cards TO authenticated;
GRANT ALL ON public.booking_cards TO service_role;

ALTER TABLE public.booking_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches and admins manage booking cards"
ON public.booking_cards
FOR ALL
TO authenticated
USING (public.is_coach_or_admin(auth.uid()))
WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_booking_cards_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER booking_cards_touch_updated_at
BEFORE UPDATE ON public.booking_cards
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_cards_touch_updated_at();

ALTER TABLE public.pt_sessions ADD COLUMN booking_card_id uuid REFERENCES public.booking_cards(id) ON DELETE SET NULL;
ALTER TABLE public.pt_sessions ADD COLUMN uses_credit boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.tg_pt_session_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _used_event public.session_ledger_events;
  _last_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.uses_credit THEN
      IF NEW.status = 'Scheduled' THEN
        PERFORM public.reserve_session_for_pt(NEW.id);
      ELSIF NEW.status = 'Completed' THEN
        PERFORM public.consume_session_for_pt(NEW.id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Leaving Completed: restore the used credit (unless already reverted)
  IF OLD.uses_credit AND OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM 'Completed' THEN
    SELECT e.event_type INTO _last_type
    FROM public.session_ledger_events e
    WHERE e.pt_session_id = NEW.id
      AND (e.event_type = 'used' OR e.source = 'revert_on_uncomplete')
    ORDER BY e.created_at DESC
    LIMIT 1;
    IF _last_type = 'used' THEN
      SELECT * INTO _used_event
      FROM public.session_ledger_events
      WHERE pt_session_id = NEW.id AND event_type = 'used'
      ORDER BY created_at DESC
      LIMIT 1;
      INSERT INTO public.session_ledger_events(
        client_id, purchase_id, pt_session_id, event_type, session_count,
        unit_value_minor, currency, effective_date, source, note, related_event_id
      ) VALUES (
        NEW.client_id, _used_event.purchase_id, NEW.id, 'adjusted', 1,
        _used_event.unit_value_minor, _used_event.currency,
        (now() AT TIME ZONE 'UTC')::date, 'revert_on_uncomplete',
        'Session un-marked as completed — credit restored', _used_event.id
      );
    END IF;
  END IF;

  -- Entering Scheduled: hold a credit (no-op when one is already held)
  IF NEW.uses_credit AND NEW.status = 'Scheduled' THEN
    PERFORM public.reserve_session_for_pt(NEW.id);
  END IF;

  -- Leaving Scheduled
  IF OLD.uses_credit AND OLD.status = 'Scheduled' THEN
    IF NEW.status = 'Completed' THEN
      PERFORM public.consume_session_for_pt(NEW.id);
    ELSIF NEW.status = 'Cancelled' THEN
      PERFORM public.release_session_for_pt(NEW.id, 'Released 1 reserved session · booking cancelled');
    ELSIF NEW.status = 'Missed' THEN
      PERFORM public.release_session_for_pt(NEW.id, 'Released 1 reserved session · no-show (not deducted)');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;