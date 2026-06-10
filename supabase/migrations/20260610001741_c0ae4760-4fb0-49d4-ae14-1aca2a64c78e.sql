
-- Extend sms_log.kind to allow new kinds
ALTER TABLE public.sms_log DROP CONSTRAINT IF EXISTS sms_log_kind_check;
ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_kind_check
  CHECK (kind = ANY (ARRAY['manual'::text, 'reminder'::text, 'automation'::text, 'bulk'::text]));

-- New table: sms_automations
CREATE TABLE public.sms_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Custom',
  trigger_type text NOT NULL,           -- e.g. unread_message, missed_check_in, missed_workout, payment_overdue, birthday, renewal_soon, new_program, new_recipe, new_broadcast, inactive_days, custom_datetime, manual, custom
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  delay_minutes integer NOT NULL DEFAULT 0,
  audience_type text NOT NULL DEFAULT 'all_active',  -- one_client, selected, all_active, app_members, program_members, unread_clients, missed_checkin, missed_workout, overdue, renewing_soon, birthdays_today, custom_filter
  audience_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  max_per_client_per_day integer NOT NULL DEFAULT 1,
  quiet_hours_start time NOT NULL DEFAULT '21:00',
  quiet_hours_end   time NOT NULL DEFAULT '08:00',
  respect_quiet_hours boolean NOT NULL DEFAULT true,
  internal_note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_automations TO authenticated;
GRANT ALL ON public.sms_automations TO service_role;

ALTER TABLE public.sms_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sms_automations"
  ON public.sms_automations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER sms_automations_set_updated_at
  BEFORE UPDATE ON public.sms_automations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
