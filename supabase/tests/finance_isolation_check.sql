-- Finance isolation check. Read-only in effect: everything runs in one
-- transaction that is always rolled back.
--
-- Proves a finance login (MFA-verified) can't read coaching or health data,
-- can't see client POV data, and can't manage roles. Run it against a database
-- that HAS client data (a copy of production, or production itself if you're
-- comfortable; nothing is kept), after the finance migrations are applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/finance_isolation_check.sql
--
-- It creates a throwaway finance user inside the transaction, impersonates it
-- (role authenticated, aal2 JWT claims), and:
--   1. lists every public table and storage bucket where it can see rows;
--   2. fails if any coaching / health table shows a single row;
--   3. fails if it can grant a role or change role_permissions.
-- Expected output: NOTICEs listing only books tables (and shared reference
-- tables such as the exercise library), then "finance isolation: OK".

BEGIN;

-- Throwaway staff-only finance account (rolled back at the end).
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('f1a1c0de-0000-4000-8000-00000000f1a1', 'finance-isolation-check@invalid.local',
        '{"account_kind":"staff"}', '{}');
DELETE FROM public.user_roles WHERE user_id = 'f1a1c0de-0000-4000-8000-00000000f1a1';
INSERT INTO public.user_roles (user_id, role) VALUES ('f1a1c0de-0000-4000-8000-00000000f1a1', 'finance');

CREATE TEMP TABLE finance_visible (tbl text, n bigint) ON COMMIT DROP;
GRANT ALL ON finance_visible TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1a1c0de-0000-4000-8000-00000000f1a1","role":"authenticated","aal":"aal2"}', true);

DO $$
DECLARE
  t record;
  n bigint;
  sensitive text[] := ARRAY[
    -- check-ins and progress
    'weekly_checkin_threads','weekly_checkin_messages','progress_submissions','progress_media',
    'progress_measurements','progress_bodyweight','progress_metrics','progress_review_responses',
    'manual_check_in_reviews','manual_check_in_review_messages','submission_reviews','check_in_links',
    -- health screenings
    'health_screenings','health_screening_answers','medical_clearance_documents','progress_consents',
    -- messages
    'messages','message_reactions','group_messages','member_support_messages','conversation_state',
    -- programs and training logs
    'pl_preps','pl_blocks','pl_weeks','pl_days','pl_exercise_rows','pl_row_results','pl_day_completions',
    'pl_scheduled_workouts','pl_workout_feedback','pl_exercise_notes','pl_client_maxes','pl_warmup_sets',
    'pl_templates','lift_videos','lift_video_comments','athlete_xp_events','cardio_completions',
    -- nutrition
    'nutrition_targets','nutrition_target_days','nutrition_ai_plans','nf_submissions','member_meal_logs',
    'member_nutrition_targets','member_bodyweight_logs','nutrition_update_submissions',
    -- client records behind client POV, goals, wearables
    'clients','app_members','client_goals_setup','client_goals_setup_notes','wearable_daily_metrics',
    'wearable_connections','profiles','user_roles','admin_audit_log'
  ];
  leaks text[] := '{}';
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m')
     ORDER BY 1
  LOOP
    BEGIN
      -- Everyone may read their own role and profile rows; count other people's.
      IF t.relname = 'user_roles' THEN
        SELECT count(*) INTO n FROM public.user_roles WHERE user_id <> auth.uid();
      ELSIF t.relname = 'profiles' THEN
        SELECT count(*) INTO n FROM public.profiles WHERE id <> auth.uid();
      ELSE
        EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO n;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      n := 0;  -- no grant at all: can't read
    END;
    IF n > 0 THEN
      INSERT INTO finance_visible VALUES (t.relname, n);
      RAISE NOTICE 'finance can see %: % rows', t.relname, n;
      IF t.relname = ANY (sensitive) THEN leaks := leaks || t.relname; END IF;
    END IF;
  END LOOP;

  FOR t IN SELECT bucket_id, count(*) AS c FROM storage.objects GROUP BY bucket_id LOOP
    RAISE NOTICE 'finance can see storage bucket %: % objects', t.bucket_id, t.c;
    IF t.bucket_id <> 'business-receipts' THEN leaks := leaks || ('storage:' || t.bucket_id); END IF;
  END LOOP;

  IF array_length(leaks, 1) > 0 THEN
    RAISE EXCEPTION 'finance isolation FAILED: finance can read %', leaks;
  END IF;
END $$;

-- Role management: every attempt must fail.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES ('f1a1c0de-0000-4000-8000-00000000f1a1', 'admin');
    RAISE EXCEPTION 'finance isolation FAILED: finance granted itself admin';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN
    IF SQLERRM LIKE 'finance isolation FAILED%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.role_permissions (role, permission) VALUES ('finance', 'finance.delete');
    RAISE EXCEPTION 'finance isolation FAILED: finance changed role_permissions';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM LIKE 'finance isolation FAILED%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.user_roles SET role = 'admin' WHERE user_id = 'f1a1c0de-0000-4000-8000-00000000f1a1';
    IF FOUND THEN RAISE EXCEPTION 'finance isolation FAILED: finance changed its own role'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'finance isolation: OK';
END $$;

ROLLBACK;
