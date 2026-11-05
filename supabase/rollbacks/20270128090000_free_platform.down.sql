-- Rollback for 20270128090000_free_platform.sql (run by hand only if the
-- release has to be undone). Free members created meanwhile keep their rows;
-- with 'free' removed from the access checks they lose access, so set them
-- to 'Complimentary' first if they should keep it.

DROP TRIGGER IF EXISTS auth_user_free_join ON auth.users;
DROP FUNCTION IF EXISTS public.tg_auth_user_free_join();
DROP FUNCTION IF EXISTS public.member_free_join();
DROP FUNCTION IF EXISTS public._member_free_join(uuid);

DROP FUNCTION IF EXISTS public.community_report_resolve(text, uuid, text);
DROP FUNCTION IF EXISTS public.community_reports_open();
DROP FUNCTION IF EXISTS public.community_report(text, uuid, text, text);
DROP TABLE IF EXISTS public.community_reports;

DROP FUNCTION IF EXISTS public.athlete_program_start(uuid, date);
DROP FUNCTION IF EXISTS public.athlete_program_detail(uuid);
DROP FUNCTION IF EXISTS public.athlete_programs_browse(text, text, text, text, integer, text, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.athlete_program_card(public.athlete_programs);
DROP FUNCTION IF EXISTS public.athlete_program_moderate(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.athlete_program_delete(uuid);
DROP FUNCTION IF EXISTS public.athlete_program_copy(uuid);
DROP FUNCTION IF EXISTS public.athlete_program_set_shared(uuid, boolean);
DROP FUNCTION IF EXISTS public.athlete_program_save(uuid, text, text, text, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.athlete_program_count_exercises(jsonb);
DROP FUNCTION IF EXISTS public.athlete_program_clean_days(jsonb);
DROP FUNCTION IF EXISTS public.athlete_program_can_author();
DROP FUNCTION IF EXISTS public.athlete_program_visible(uuid, text, timestamptz, timestamptz);
-- Programs people built are data: keep the table unless you're sure.
-- DROP TABLE IF EXISTS public.athlete_programs;

-- Access checks as they were before (without 'free')
CREATE OR REPLACE FUNCTION public.member_can_consume(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_members m
    WHERE m.user_id = _user_id
      AND COALESCE(m.manual_access_disabled, false) = false
      AND (
        COALESCE(m.manual_access_override, false) = true
        OR COALESCE(m.in_grace, false) = true
        OR (
          (m.access_end_date IS NULL OR m.access_end_date > now())
          AND lower(COALESCE(m.status, '')) NOT IN ('expired', 'cancelled', 'canceled')
          AND (
            lower(btrim(COALESCE(m.subscription_status, ''))) IN ('active', 'trialing', 'admin_granted', 'complimentary')
            OR (lower(btrim(COALESCE(m.subscription_status, ''))) = 'active (cancels at period end)'
                AND COALESCE(m.cancel_at, m.current_period_end, 'infinity'::timestamptz) > now())
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.jf_member_has_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members
     WHERE user_id = _user_id
       AND account_type = 'jf_member'
       AND status = 'Active'
       AND (
         subscription_status IN ('Trialing', 'Active', 'Complimentary')
         OR (subscription_status = 'Active (Cancels at period end)'
             AND COALESCE(cancel_at, current_period_end, 'infinity'::timestamptz) > now())
       )
  )
$$;

-- handle_new_user is deliberately NOT reverted: linking an unconfirmed
-- self-signup to a coach's client record by email was a security hole.
