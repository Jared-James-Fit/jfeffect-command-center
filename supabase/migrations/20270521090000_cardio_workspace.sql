-- Cardio gets its own workspace (Nov 23 2026): a dedicated Cardio tab with a
-- builder, drafts the coach publishes when ready, a dated history of every
-- published plan, Cleo's proposals kept with the coach's decision on each, and
-- one coordinated recommendation per weekly check-in.
--
-- Nothing here moves or rewrites a client's cardio. `cardio_targets` stays the
-- one live plan everything already reads (the Workouts day card, the workout's
-- last exercise through program_cardio_sync, analytics, the weight-management
-- engine); its new columns only describe a session more precisely, and every
-- existing row reads exactly as before (null = the old meaning).
--
--   * cardio_plan_drafts            the coach's draft, one per client, until published
--   * cardio_plan_versions          every published plan (append-only): what, from when, why
--   * cardio_cleo_proposals         what Cleo proposed and whether the coach used it
--   * client_coaching_recommendations  one coordinated read per weekly check-in, and the
--                                   coach's decision (applied / edited / dismissed)
--
-- All four are written only by the server (service role) after a staff check
-- through the caller's own login; staff read them (the admin, and a coach for
-- the clients they coach). Clients never see any of it: the client sees only
-- what the coach publishes, through cardio_targets and the chat message.
--
-- program_cardio_sync now places each workout's cardio from the session in
-- force on that workout's own date, so a plan scheduled to start next Monday
-- reaches only the workouts from Monday on.

-- 1. A session described precisely (all optional; old rows keep reading as before).
ALTER TABLE public.cardio_targets
  ADD COLUMN IF NOT EXISTS modality text,
  ADD COLUMN IF NOT EXISTS day_rule text,
  ADD COLUMN IF NOT EXISTS timing text,
  ADD COLUMN IF NOT EXISTS progression jsonb,
  ADD COLUMN IF NOT EXISTS hr_min integer,
  ADD COLUMN IF NOT EXISTS hr_max integer,
  ADD COLUMN IF NOT EXISTS rpe_min numeric,
  ADD COLUMN IF NOT EXISTS rpe_max numeric,
  ADD COLUMN IF NOT EXISTS incline_max numeric,
  ADD COLUMN IF NOT EXISTS speed_unit text,
  ADD COLUMN IF NOT EXISTS plan_version_id uuid;

DO $$ BEGIN
  ALTER TABLE public.cardio_targets ADD CONSTRAINT cardio_targets_modality_check
    CHECK (modality IS NULL OR modality IN ('treadmill_flat','treadmill_incline','treadmill_variable','outdoor_walk','bike','elliptical','stair_climber','run','row','conditioning','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cardio_targets ADD CONSTRAINT cardio_targets_day_rule_check
    CHECK (day_rule IS NULL OR day_rule IN ('training','non_training','weekdays','daily','high'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cardio_targets ADD CONSTRAINT cardio_targets_timing_check
    CHECK (timing IS NULL OR timing IN ('any','after_lifting','before_lifting','separate'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cardio_targets ADD CONSTRAINT cardio_targets_speed_unit_check
    CHECK (speed_unit IS NULL OR speed_unit IN ('mph','kmh'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cardio_targets ADD CONSTRAINT cardio_targets_effort_check
    CHECK ((rpe_min IS NULL OR rpe_min BETWEEN 1 AND 10) AND (rpe_max IS NULL OR rpe_max BETWEEN 1 AND 10)
       AND (hr_min IS NULL OR hr_min BETWEEN 40 AND 230) AND (hr_max IS NULL OR hr_max BETWEEN 40 AND 230));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.cardio_targets.modality IS 'The cardio builder''s kind of cardio (cardio/modalities.ts); null = read from cardio_type.';
COMMENT ON COLUMN public.cardio_targets.day_rule IS 'training | non_training | weekdays | daily | high: how the builder picked scheduled_weekdays.';
COMMENT ON COLUMN public.cardio_targets.timing IS 'When it goes relative to lifting: any | after_lifting | before_lifting | separate.';
COMMENT ON COLUMN public.cardio_targets.progression IS '{kind: none|minutes|incline|speed|sessions, step, everyWeeks, cap}: how the coach means it to progress (a guide; nothing changes it by itself).';
COMMENT ON COLUMN public.cardio_targets.speed_unit IS 'mph | kmh: how speed is shown to this client (speed_*_mph always stores mph).';
COMMENT ON COLUMN public.cardio_targets.plan_version_id IS 'The cardio_plan_versions row that published it.';

-- 2. The coach's draft.
CREATE TABLE IF NOT EXISTS public.cardio_plan_drafts (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  sessions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sessions) = 'array'),
  effective_date date,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  -- the plan it started from (a version or the live rows' fingerprint): a stale draft is said, never applied blind
  base_version_id uuid,
  base_hash text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Every published plan.
CREATE TABLE IF NOT EXISTS public.cardio_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  sessions jsonb NOT NULL CHECK (jsonb_typeof(sessions) = 'array'),
  effective_date date NOT NULL,
  -- 'live' once in force; 'scheduled' while it waits for its date; 'replaced' when another
  -- publish took it back before its date (its rows were removed and the old end dates put back)
  state text NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'scheduled', 'replaced')),
  weekly_minutes integer,
  weekly_sessions integer,
  change_lines text[] NOT NULL DEFAULT '{}',
  -- what a scheduled version did, so it can be taken back: rows it made, end dates it set
  created_ids uuid[] NOT NULL DEFAULT '{}',
  closes jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- coach | cleo | restore | recommendation (where the draft came from)
  source text NOT NULL DEFAULT 'coach' CHECK (source IN ('coach', 'cleo', 'restore', 'recommendation')),
  restored_from uuid REFERENCES public.cardio_plan_versions(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  quality jsonb,
  message_id uuid,
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, version_no)
);
CREATE INDEX IF NOT EXISTS cardio_plan_versions_client_idx ON public.cardio_plan_versions (client_id, published_at DESC);

-- the record is kept: only a scheduled version's state (taken back, or reached), its message and
-- what it did (to take a waiting change back) ever change; nobody but the server can delete one
CREATE OR REPLACE FUNCTION public.tg_cardio_plan_versions_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sessions IS DISTINCT FROM OLD.sessions OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
     OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.change_lines IS DISTINCT FROM OLD.change_lines OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
    RAISE EXCEPTION 'A published cardio plan is part of the record and can''t be rewritten' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cardio_plan_versions_keep ON public.cardio_plan_versions;
CREATE TRIGGER cardio_plan_versions_keep
  BEFORE UPDATE ON public.cardio_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_cardio_plan_versions_keep();

-- 4. Cleo's proposals and what the coach did with them.
CREATE TABLE IF NOT EXISTS public.cardio_cleo_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by uuid,
  instructions text NOT NULL CHECK (char_length(instructions) BETWEEN 1 AND 2000),
  -- the draft it read, and what it answered: words, and the plan it proposes (null for a question)
  base jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer text,
  sessions jsonb,
  change_lines text[] NOT NULL DEFAULT '{}',
  nutrition_note text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'dismissed', 'answered', 'failed')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  model text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cardio_cleo_proposals_client_idx ON public.cardio_cleo_proposals (client_id, created_at DESC);

-- 5. One coordinated recommendation per weekly check-in, and the coach's call on it.
CREATE TABLE IF NOT EXISTS public.client_coaching_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  checkin_id uuid,
  source text NOT NULL DEFAULT 'checkin' CHECK (source IN ('checkin', 'coach')),
  hash text NOT NULL,
  headline text NOT NULL,
  hold boolean NOT NULL DEFAULT false,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  -- open → applied (put on a draft) / edited (the coach's own words) / dismissed; superseded by a newer one
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'edited', 'dismissed', 'superseded')),
  coach_note text CHECK (coach_note IS NULL OR char_length(coach_note) <= 2000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_coaching_recommendations_checkin_uidx
  ON public.client_coaching_recommendations (checkin_id) WHERE checkin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_coaching_recommendations_client_idx
  ON public.client_coaching_recommendations (client_id, created_at DESC);

-- 6. Who reads them: staff for the clients they coach; nobody writes but the server.
ALTER TABLE public.cardio_plan_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardio_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardio_cleo_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_coaching_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read cardio drafts" ON public.cardio_plan_drafts;
CREATE POLICY "Staff read cardio drafts" ON public.cardio_plan_drafts
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff read cardio plan versions" ON public.cardio_plan_versions;
CREATE POLICY "Staff read cardio plan versions" ON public.cardio_plan_versions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff read cardio Cleo proposals" ON public.cardio_cleo_proposals;
CREATE POLICY "Staff read cardio Cleo proposals" ON public.cardio_cleo_proposals
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Staff read coaching recommendations" ON public.client_coaching_recommendations;
CREATE POLICY "Staff read coaching recommendations" ON public.client_coaching_recommendations
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

REVOKE INSERT, UPDATE, DELETE ON public.cardio_plan_drafts, public.cardio_plan_versions, public.cardio_cleo_proposals, public.client_coaching_recommendations FROM anon, authenticated;
REVOKE ALL ON public.cardio_plan_drafts, public.cardio_plan_versions, public.cardio_cleo_proposals, public.client_coaching_recommendations FROM anon;
GRANT SELECT ON public.cardio_plan_drafts, public.cardio_plan_versions, public.cardio_cleo_proposals, public.client_coaching_recommendations TO authenticated;
GRANT ALL ON public.cardio_plan_drafts, public.cardio_plan_versions, public.cardio_cleo_proposals, public.client_coaching_recommendations TO service_role;
REVOKE ALL ON FUNCTION public.tg_cardio_plan_versions_keep() FROM PUBLIC, anon, authenticated;

-- 7. The workout's cardio note says how hard too (RPE when there's no heart-rate zone), in the client's speed unit.
CREATE OR REPLACE FUNCTION public.cardio_row_notes(t public.cardio_targets)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH k AS (
    SELECT CASE WHEN t.speed_unit = 'kmh' THEN 1.609344 ELSE 1 END AS f,
           CASE WHEN t.speed_unit = 'kmh' THEN ' km/h' ELSE ' mph' END AS u
  ), parts AS (
    SELECT
      nullif(concat_ws(' · ',
        CASE WHEN t.incline IS NOT NULL AND t.incline_max IS NOT NULL AND t.incline_max > t.incline
               THEN 'Incline ' || trim_scale(t.incline)::text || '–' || trim_scale(t.incline_max)::text || '%'
             WHEN t.incline IS NOT NULL THEN 'Incline ' || trim_scale(t.incline)::text || '%' END,
        CASE WHEN t.speed_min_mph IS NOT NULL AND t.speed_max_mph IS NOT NULL AND t.speed_max_mph <> t.speed_min_mph
               THEN trim_scale(round(t.speed_min_mph * k.f, 1))::text || '–' || trim_scale(round(t.speed_max_mph * k.f, 1))::text || k.u
             WHEN coalesce(t.speed_min_mph, t.speed_max_mph) IS NOT NULL
               THEN trim_scale(round(coalesce(t.speed_min_mph, t.speed_max_mph) * k.f, 1))::text || k.u END,
        coalesce(nullif(trim(coalesce(t.heart_rate_zone, '')), ''),
          CASE WHEN t.rpe_min IS NOT NULL AND t.rpe_max IS NOT NULL AND t.rpe_max <> t.rpe_min
                 THEN 'RPE ' || trim_scale(t.rpe_min)::text || '–' || trim_scale(t.rpe_max)::text
               WHEN coalesce(t.rpe_min, t.rpe_max) IS NOT NULL THEN 'RPE ' || trim_scale(coalesce(t.rpe_min, t.rpe_max))::text END)
      ), '') AS rx,
      (SELECT string_agg(rtrim(trim(x.sentence), '.'), '. ' ORDER BY x.n)
         FROM (
           SELECT sentence, n
             FROM regexp_split_to_table(coalesce(t.client_notes, ''), '(?<=[.!?])\s+') WITH ORDINALITY AS s(sentence, n)
            WHERE trim(sentence) <> ''
              AND trim(sentence) !~* '(any one target|whichever target|target comes first|targets? (is|are) reached)'
              AND NOT (t.incline IS NOT NULL AND trim(sentence) ~* '^incline\M')
            ORDER BY n
            LIMIT 2
         ) x) AS cue
    FROM k
  )
  SELECT coalesce(
    nullif(left(concat_ws('. ', rx, nullif(cue, '')) || CASE WHEN rx IS NOT NULL OR cue IS NOT NULL THEN '.' ELSE '' END, 140), ''),
    'Easy pace: you can talk, but not sing.'
  )
  FROM parts;
$$;

-- 8. The sync places each workout's cardio from the session in force on its own date.
CREATE OR REPLACE FUNCTION public.program_cardio_sync(p_client uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client record;
  v_today date;
  v_train public.cardio_targets;
  v_high public.cardio_targets;
  v_day_train public.cardio_targets;
  v_day_high public.cardio_targets;
  v_target public.cardio_targets;
  v_ex uuid;
  v_notes text;
  v_derive record;
  d record;
  v_linked uuid;
  v_cand uuid;
  n_ins int := 0;
  n_upd int := 0;
  n_adopt int := 0;
  n_del int := 0;
  n_derived int := 0;
BEGIN
  SELECT c.id, c.timezone, c.committed_training_days, c.preferred_high_days, c.archived, c.status
    INTO v_client FROM public.clients c WHERE c.id = p_client;
  IF v_client.id IS NULL THEN RETURN jsonb_build_object('skipped', 'no client'); END IF;
  v_today := public.pt_local_today(coalesce(nullif(v_client.timezone, ''), 'America/Winnipeg'));

  PERFORM set_config('jf.cardio_sync', 'on', true);

  -- the plan's training-day (and high-day) session: active, shown, not a multi-week cardio program
  SELECT t.* INTO v_train FROM public.cardio_targets t
   WHERE t.client_id = p_client AND t.status = 'Active' AND t.enabled AND t.visible_to_client
     AND t.program_name IS NULL AND public.cardio_day_kind(t.day_type) = 'training'
     AND coalesce(t.duration_minutes, 0) > 0
     AND (t.start_date IS NULL OR t.start_date <= v_today + 28) AND (t.end_date IS NULL OR t.end_date >= v_today)
   ORDER BY (t.source = 'program_rows') NULLS FIRST, t.start_date DESC NULLS LAST, t.updated_at DESC
   LIMIT 1;
  SELECT t.* INTO v_high FROM public.cardio_targets t
   WHERE t.client_id = p_client AND t.status = 'Active' AND t.enabled AND t.visible_to_client
     AND t.program_name IS NULL AND public.cardio_day_kind(t.day_type) = 'high'
     AND coalesce(t.duration_minutes, 0) > 0
     AND (t.end_date IS NULL OR t.end_date >= v_today)
   ORDER BY t.start_date DESC NULLS LAST, t.updated_at DESC
   LIMIT 1;

  -- Program first: no cardio plan for training days, but the program has cardio in it.
  IF v_train.id IS NULL AND coalesce(v_client.archived, false) = false THEN
    SELECT coalesce(e.name, r.exercise_name_override) AS name,
           round(percentile_disc(0.5) WITHIN GROUP (ORDER BY r.duration_seconds) / 60.0)::int AS minutes,
           count(DISTINCT r.day_id) AS days
      INTO v_derive
      FROM public.pl_exercise_rows r
      JOIN public.pl_days dd ON dd.id = r.day_id AND dd.archived = false AND dd.deleted_at IS NULL
      JOIN public.pl_weeks w ON w.id = dd.week_id AND w.deleted_at IS NULL
      JOIN public.pl_blocks b ON b.id = w.block_id
      LEFT JOIN public.exercises e ON e.id = r.exercise_id
     WHERE b.client_id = p_client AND b.client_visible AND coalesce(b.archived, false) = false
       AND coalesce(b.status, '') <> 'Archived'
       AND coalesce(b.source_template_block_key, '') NOT IN ('at_home_backup_definitions_v1', 'at_home_backup_sessions_v1')
       AND coalesce(dd.scheduled_date, v_today) >= v_today
       AND r.cardio_target_id IS NULL AND coalesce(r.duration_seconds, 0) > 0
       AND public.is_timed_cardio_name(coalesce(e.name, r.exercise_name_override))
     GROUP BY 1
     ORDER BY count(*) DESC
     LIMIT 1;
    IF v_derive.name IS NOT NULL AND coalesce(v_derive.minutes, 0) > 0 THEN
      INSERT INTO public.cardio_targets (
        client_id, day_type, cardio_type, duration_minutes, frequency_per_week, scheduled_weekdays,
        status, enabled, visible_to_client, start_date, completion_rule, source, client_notes, last_updated_at
      ) VALUES (
        p_client, 'Training Day', v_derive.name, v_derive.minutes,
        greatest(1, coalesce(cardinality(v_client.committed_training_days), 0)),
        coalesce(v_client.committed_training_days, '{}'::text[]),
        'Active', true, true, v_today, 'any_target', 'program_rows',
        'The cardio in your training program. Your nutrition plan will set it when it''s made.', now()
      ) RETURNING * INTO v_train;
      n_derived := 1;
    END IF;
  END IF;

  FOR d IN
    SELECT dd.id AS day_id,
           coalesce((SELECT min(sw.scheduled_date) FROM public.pl_scheduled_workouts sw WHERE sw.source_day_id = dd.id), dd.scheduled_date) AS on_date
      FROM public.pl_days dd
      JOIN public.pl_weeks w ON w.id = dd.week_id AND w.deleted_at IS NULL
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE b.client_id = p_client AND b.client_visible AND coalesce(b.archived, false) = false
       AND coalesce(b.status, '') <> 'Archived'
       AND coalesce(b.source_template_block_key, '') NOT IN ('at_home_backup_definitions_v1', 'at_home_backup_sessions_v1')
       AND dd.archived = false AND dd.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.pl_day_completions dc
                        WHERE dc.day_id = dd.id AND (dc.completed_at IS NOT NULL OR dc.started_at IS NOT NULL OR dc.in_progress_at IS NOT NULL))
  LOOP
    CONTINUE WHEN d.on_date IS NULL OR d.on_date < v_today;
    -- the sessions in force on this workout's own date: a change the coach scheduled for a later
    -- date (the cardio builder's effective date) reaches only the workouts from that date on
    v_day_train := NULL;
    v_day_high := NULL;
    SELECT t.* INTO v_day_train FROM public.cardio_targets t
     WHERE t.client_id = p_client AND t.status = 'Active' AND t.enabled AND t.visible_to_client
       AND t.program_name IS NULL AND public.cardio_day_kind(t.day_type) = 'training'
       AND coalesce(t.duration_minutes, 0) > 0
       AND (t.start_date IS NULL OR t.start_date <= d.on_date) AND (t.end_date IS NULL OR t.end_date >= d.on_date)
     ORDER BY (t.source = 'program_rows') NULLS FIRST, t.start_date DESC NULLS LAST, t.updated_at DESC
     LIMIT 1;
    IF v_day_train.id IS NULL AND v_train.id IS NOT NULL AND v_train.source = 'program_rows' THEN
      v_day_train := v_train;
    END IF;
    SELECT t.* INTO v_day_high FROM public.cardio_targets t
     WHERE t.client_id = p_client AND t.status = 'Active' AND t.enabled AND t.visible_to_client
       AND t.program_name IS NULL AND public.cardio_day_kind(t.day_type) = 'high'
       AND coalesce(t.duration_minutes, 0) > 0
       AND (t.start_date IS NULL OR t.start_date <= d.on_date) AND (t.end_date IS NULL OR t.end_date >= d.on_date)
     ORDER BY t.start_date DESC NULLS LAST, t.updated_at DESC
     LIMIT 1;
    -- a high day takes the plan's high-day session when it has one
    v_target := CASE
      WHEN v_day_high.id IS NOT NULL AND trim(to_char(d.on_date, 'Day')) = ANY (coalesce(v_client.preferred_high_days, '{}'::text[])) THEN v_day_high
      ELSE v_day_train END;

    SELECT r.id INTO v_linked FROM public.pl_exercise_rows r
     WHERE r.day_id = d.day_id AND r.cardio_target_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
     ORDER BY r.sort_order LIMIT 1;

    IF v_target.id IS NULL THEN
      -- cardio taken off the plan: its unlogged workout rows go
      WITH gone AS (
        DELETE FROM public.pl_exercise_rows r
         WHERE r.day_id = d.day_id AND r.cardio_target_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
        RETURNING 1)
      SELECT n_del + count(*) INTO n_del FROM gone;
      CONTINUE;
    END IF;

    IF v_linked IS NULL THEN
      -- cardio the program already has that day (a coach's or an older generator's walk) becomes the plan's
      SELECT r.id INTO v_cand FROM public.pl_exercise_rows r LEFT JOIN public.exercises e ON e.id = r.exercise_id
       WHERE r.day_id = d.day_id AND r.cardio_target_id IS NULL
         AND public.is_timed_cardio_name(coalesce(e.name, r.exercise_name_override))
         AND NOT EXISTS (SELECT 1 FROM public.pl_row_results rr WHERE rr.row_id = r.id)
       ORDER BY r.sort_order DESC LIMIT 1;
    ELSE
      v_cand := NULL;
    END IF;

    IF v_target.source = 'program_rows' THEN
      -- the plan was read from the program: the program's rows stay as written, they're only linked
      IF v_cand IS NOT NULL THEN
        UPDATE public.pl_exercise_rows SET cardio_target_id = v_target.id WHERE id = v_cand;
        n_adopt := n_adopt + 1;
      ELSIF v_linked IS NOT NULL THEN
        UPDATE public.pl_exercise_rows SET cardio_target_id = v_target.id WHERE id = v_linked AND cardio_target_id IS DISTINCT FROM v_target.id;
      END IF;
      CONTINUE;
    END IF;

    v_ex := public.cardio_exercise_for(v_target.cardio_type, v_target.custom_type, v_target.machine_preference);
    v_notes := public.cardio_row_notes(v_target);

    IF coalesce(v_linked, v_cand) IS NOT NULL THEN
      UPDATE public.pl_exercise_rows r
         SET cardio_target_id = v_target.id,
             exercise_id = coalesce(v_ex, r.exercise_id),
             exercise_name_override = CASE WHEN v_ex IS NULL THEN coalesce(v_target.custom_type, v_target.cardio_type) ELSE NULL END,
             sets = 1, reps_text = NULL, rpe = NULL, rest_seconds = 0,
             measurement_type = 'time', tracking_type = 'time', time_profile = 'conditioning',
             duration_seconds = v_target.duration_minutes * 60,
             notes = v_notes, purpose_label = 'Cardio'
       WHERE r.id = coalesce(v_linked, v_cand)
         AND (r.cardio_target_id IS DISTINCT FROM v_target.id
              OR r.exercise_id IS DISTINCT FROM coalesce(v_ex, r.exercise_id)
              OR r.duration_seconds IS DISTINCT FROM v_target.duration_minutes * 60
              OR r.notes IS DISTINCT FROM v_notes
              OR r.measurement_type IS DISTINCT FROM 'time'
              OR r.sets IS DISTINCT FROM 1);
      IF FOUND THEN
        IF v_linked IS NULL THEN n_adopt := n_adopt + 1; ELSE n_upd := n_upd + 1; END IF;
      END IF;
    ELSE
      INSERT INTO public.pl_exercise_rows (
        day_id, sort_order, exercise_id, exercise_name_override, sets, rest_seconds,
        measurement_type, tracking_type, time_profile, duration_seconds, notes, purpose_label, cardio_target_id
      ) VALUES (
        d.day_id,
        coalesce((SELECT max(x.sort_order) FROM public.pl_exercise_rows x WHERE x.day_id = d.day_id), -1) + 1,
        v_ex, CASE WHEN v_ex IS NULL THEN coalesce(v_target.custom_type, v_target.cardio_type) END,
        1, 0, 'time', 'time', 'conditioning', v_target.duration_minutes * 60, v_notes, 'Cardio', v_target.id
      );
      n_ins := n_ins + 1;
    END IF;
  END LOOP;

  PERFORM set_config('jf.cardio_sync', 'off', true);
  RETURN jsonb_build_object('added', n_ins, 'updated', n_upd, 'adopted', n_adopt, 'removed', n_del, 'plan_from_program', n_derived);
END;
$function$;

REVOKE ALL ON FUNCTION public.program_cardio_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.program_cardio_sync(uuid) TO service_role;

-- 9. A scheduled version is live once its date comes (read by the coach's history; the rows already carry the dates).
CREATE OR REPLACE FUNCTION public.cardio_plan_versions_reach()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH done AS (
    UPDATE public.cardio_plan_versions v SET state = 'live'
     WHERE v.state = 'scheduled'
       AND v.effective_date <= public.pt_local_today(coalesce((SELECT nullif(c.timezone, '') FROM public.clients c WHERE c.id = v.client_id), 'America/Winnipeg'))
    RETURNING 1)
  SELECT count(*)::int FROM done;
$$;
REVOKE ALL ON FUNCTION public.cardio_plan_versions_reach() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cardio_plan_versions_reach() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cardio-plan-versions-reach';
    PERFORM cron.schedule('cardio-plan-versions-reach', '23 * * * *', 'SELECT public.cardio_plan_versions_reach();');
  END IF;
END
$$;

-- 10. Publishing, in one transaction (the server works out the writes, cardio/publish.ts; this applies them):
--     take back a change still waiting, end what changes the day before, write what hasn't gone live yet,
--     add the new sessions from their date (today's completion moves with a session that changed today),
--     record the version, clear the draft, then place the workouts' cardio once.
CREATE OR REPLACE FUNCTION public.cardio_plan_publish(p_client uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_today date;
  v_effective date := (p_payload->>'effective')::date;
  v_scheduled boolean := coalesce((p_payload->>'scheduled')::boolean, false);
  v_version_id uuid := gen_random_uuid();
  v_version_no int;
  v_ids jsonb := '{}'::jsonb;
  v_sessions jsonb;
  v_created uuid[] := '{}';
  i jsonb;
  v_id uuid;
  v_old public.cardio_targets;
  r public.cardio_targets;
BEGIN
  IF p_client IS NULL OR v_effective IS NULL THEN RAISE EXCEPTION 'client and effective date required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cardio_publish:' || p_client::text));
  v_today := public.pt_local_today(coalesce((SELECT nullif(c.timezone, '') FROM public.clients c WHERE c.id = p_client), 'America/Winnipeg'));
  IF v_effective < v_today THEN v_effective := v_today; END IF;
  -- the sync runs once at the end, not once per row
  PERFORM set_config('jf.cardio_sync', 'on', true);

  -- a change still waiting for its date is taken back first
  IF p_payload->>'pending_version_id' IS NOT NULL THEN
    DELETE FROM public.cardio_targets t
     WHERE t.client_id = p_client AND t.start_date > v_today
       AND t.id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(coalesce(p_payload#>'{revert,deleteIds}', '[]')) x);
    UPDATE public.cardio_targets t SET end_date = nullif(x->>'end_date', '')::date, last_updated_at = now()
      FROM jsonb_array_elements(coalesce(p_payload#>'{revert,restore}', '[]')) x
     WHERE t.client_id = p_client AND t.id = (x->>'id')::uuid;
    UPDATE public.cardio_plan_versions SET state = 'replaced'
     WHERE id = (p_payload->>'pending_version_id')::uuid AND client_id = p_client AND state = 'scheduled';
  END IF;

  -- what changes ends the day before the change
  UPDATE public.cardio_targets t SET end_date = (x->>'end_date')::date, last_updated_at = now()
    FROM jsonb_array_elements(coalesce(p_payload->'end', '[]')) x
   WHERE t.client_id = p_client AND t.id = (x->>'id')::uuid
     AND (x->>'end_date')::date >= coalesce(t.start_date, (x->>'end_date')::date);

  -- what never went live and isn't wanted goes
  DELETE FROM public.cardio_targets t
   WHERE t.client_id = p_client AND t.start_date >= v_effective
     AND t.id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(coalesce(p_payload->'remove', '[]')) x);

  -- rewritten in place: a row that hasn't gone live yet, or only its private note
  FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'update', '[]')) LOOP
    SELECT * INTO v_old FROM public.cardio_targets WHERE id = (i->>'id')::uuid AND client_id = p_client FOR UPDATE;
    CONTINUE WHEN v_old.id IS NULL;
    r := jsonb_populate_record(v_old, i->'fields');
    UPDATE public.cardio_targets SET
      modality = r.modality, cardio_type = r.cardio_type, custom_type = r.custom_type, machine_preference = r.machine_preference,
      day_type = r.day_type, day_rule = r.day_rule, custom_day_type = r.custom_day_type, scheduled_weekdays = r.scheduled_weekdays,
      frequency_per_week = r.frequency_per_week, duration_minutes = r.duration_minutes,
      speed_min_mph = r.speed_min_mph, speed_max_mph = r.speed_max_mph, speed_unit = r.speed_unit,
      incline = r.incline, incline_max = r.incline_max, heart_rate_zone = r.heart_rate_zone,
      hr_min = r.hr_min, hr_max = r.hr_max, rpe_min = r.rpe_min, rpe_max = r.rpe_max, intensity = r.intensity,
      timing = r.timing, progression = r.progression, client_notes = r.client_notes, admin_notes = r.admin_notes,
      enabled = r.enabled, visible_to_client = r.visible_to_client, completion_rule = r.completion_rule,
      plan_version_id = v_version_id, last_updated_at = now()
     WHERE id = v_old.id;
    v_ids := v_ids || jsonb_build_object(i->>'key', v_old.id);
  END LOOP;

  -- new rows from the effective date (ids made first, so the version records them)
  FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'insert', '[]')) LOOP
    v_ids := v_ids || jsonb_build_object(i->>'key', gen_random_uuid());
  END LOOP;

  v_sessions := coalesce((
    SELECT jsonb_agg(CASE WHEN v_ids ? (s->>'key') THEN s || jsonb_build_object('id', v_ids->>(s->>'key'), 'key', v_ids->>(s->>'key')) ELSE s END ORDER BY o)
      FROM jsonb_array_elements(coalesce(p_payload#>'{version,sessions}', '[]')) WITH ORDINALITY AS e(s, o)), '[]'::jsonb);

  SELECT coalesce(max(version_no), 0) + 1 INTO v_version_no FROM public.cardio_plan_versions WHERE client_id = p_client;
  INSERT INTO public.cardio_plan_versions (
    id, client_id, version_no, sessions, effective_date, state, weekly_minutes, weekly_sessions, change_lines,
    created_ids, closes, source, restored_from, note, quality, published_by
  ) VALUES (
    v_version_id, p_client, v_version_no, v_sessions, v_effective, CASE WHEN v_scheduled THEN 'scheduled' ELSE 'live' END,
    nullif(p_payload#>>'{version,weekly_minutes}', '')::int, nullif(p_payload#>>'{version,weekly_sessions}', '')::int,
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload#>'{version,change_lines}', '[]'))), '{}'),
    '{}', CASE WHEN v_scheduled THEN coalesce(p_payload->'end', '[]') ELSE '[]'::jsonb END,
    coalesce(nullif(p_payload#>>'{version,source}', ''), 'coach'), nullif(p_payload#>>'{version,restored_from}', '')::uuid,
    nullif(p_payload#>>'{version,note}', ''), p_payload#>'{version,quality}', nullif(p_payload#>>'{version,published_by}', '')::uuid
  );

  FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'insert', '[]')) LOOP
    v_id := (v_ids->>(i->>'key'))::uuid;
    INSERT INTO public.cardio_targets (
      id, client_id, start_date, status, source, plan_version_id, last_updated_at,
      modality, cardio_type, custom_type, machine_preference, day_type, day_rule, custom_day_type, scheduled_weekdays,
      frequency_per_week, duration_minutes, speed_min_mph, speed_max_mph, speed_unit, incline, incline_max,
      heart_rate_zone, hr_min, hr_max, rpe_min, rpe_max, intensity, timing, progression,
      client_notes, admin_notes, enabled, visible_to_client, completion_rule
    )
    SELECT v_id, p_client, greatest(v_effective, coalesce((i->>'start_date')::date, v_effective)), 'Active', 'coach', v_version_id, now(),
      x.modality, coalesce(x.cardio_type, 'Incline Treadmill Walk'), x.custom_type, x.machine_preference, coalesce(x.day_type, 'General'), x.day_rule,
      x.custom_day_type, coalesce(x.scheduled_weekdays, '{}'), x.frequency_per_week, x.duration_minutes, x.speed_min_mph, x.speed_max_mph,
      x.speed_unit, x.incline, x.incline_max, x.heart_rate_zone, x.hr_min, x.hr_max, x.rpe_min, x.rpe_max, x.intensity, x.timing, x.progression,
      x.client_notes, x.admin_notes, coalesce(x.enabled, true), coalesce(x.visible_to_client, true), coalesce(x.completion_rule, 'any_target')
    FROM jsonb_populate_record(null::public.cardio_targets, i->'fields') x;
    v_created := v_created || v_id;
    -- a session changed today keeps today's logged cardio
    IF NOT v_scheduled AND i->>'replaces' IS NOT NULL THEN
      UPDATE public.cardio_completions c SET cardio_target_id = v_id, updated_at = now()
       WHERE c.client_id = p_client AND c.cardio_target_id = (i->>'replaces')::uuid AND c.completed_date >= v_effective
         AND NOT EXISTS (SELECT 1 FROM public.cardio_completions d WHERE d.client_id = p_client AND d.cardio_target_id = v_id AND d.completed_date = c.completed_date);
    END IF;
  END LOOP;
  IF v_scheduled THEN
    UPDATE public.cardio_plan_versions SET created_ids = v_created WHERE id = v_version_id;
  END IF;

  DELETE FROM public.cardio_plan_drafts WHERE client_id = p_client;

  PERFORM set_config('jf.cardio_sync', 'off', true);
  PERFORM public.program_cardio_sync(p_client);
  RETURN jsonb_build_object('version_id', v_version_id, 'version_no', v_version_no, 'ids', v_ids, 'effective', v_effective, 'scheduled', v_scheduled);
END;
$function$;
REVOKE ALL ON FUNCTION public.cardio_plan_publish(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cardio_plan_publish(uuid, jsonb) TO service_role;
