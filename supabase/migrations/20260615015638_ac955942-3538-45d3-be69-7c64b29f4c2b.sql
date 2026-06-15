
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS committed_training_days text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS committed_training_frequency integer;

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
      AND array_length(m.committed_training_days, 1) >= 1
  )
$function$;
