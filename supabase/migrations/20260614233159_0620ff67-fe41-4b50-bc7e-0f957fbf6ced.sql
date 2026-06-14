ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS intake_lifts_known boolean,
  ADD COLUMN IF NOT EXISTS intake_lift_unit text,
  ADD COLUMN IF NOT EXISTS intake_squat_1rm numeric(6,2),
  ADD COLUMN IF NOT EXISTS intake_bench_1rm numeric(6,2),
  ADD COLUMN IF NOT EXISTS intake_deadlift_1rm numeric(6,2),
  ADD COLUMN IF NOT EXISTS intake_lifts_recorded_at timestamptz;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_intake_lift_unit_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_intake_lift_unit_check
  CHECK (intake_lift_unit IS NULL OR intake_lift_unit IN ('kg','lb'));

ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS goals_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_level text;

ALTER TABLE public.app_members
  DROP CONSTRAINT IF EXISTS app_members_experience_level_check;
ALTER TABLE public.app_members
  ADD CONSTRAINT app_members_experience_level_check
  CHECK (experience_level IS NULL OR experience_level IN ('new','beginner','intermediate','advanced'));

-- Update setup-complete RPC: accept either goals/training_background OR the new
-- structured fields so existing complete members stay complete.
CREATE OR REPLACE FUNCTION public.member_setup_complete(_member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members m
    WHERE m.id = _member_id
      AND m.avatar_url IS NOT NULL AND length(btrim(m.avatar_url)) > 0
      AND m.phone IS NOT NULL AND length(btrim(m.phone)) > 0
      AND (m.sms_opt_out = false OR m.sms_consent_at IS NOT NULL)
      AND m.date_of_birth IS NOT NULL
      AND m.address_line1 IS NOT NULL AND length(btrim(m.address_line1)) > 0
      AND m.emergency_contact_name IS NOT NULL AND length(btrim(m.emergency_contact_name)) > 0
      AND m.emergency_contact_phone IS NOT NULL AND length(btrim(m.emergency_contact_phone)) > 0
      AND (
        (m.goals IS NOT NULL AND length(btrim(m.goals)) > 0)
        OR array_length(m.goals_tags, 1) >= 1
      )
      AND (
        (m.training_background IS NOT NULL AND length(btrim(m.training_background)) > 0)
        OR m.experience_level IS NOT NULL
      )
  )
$function$;