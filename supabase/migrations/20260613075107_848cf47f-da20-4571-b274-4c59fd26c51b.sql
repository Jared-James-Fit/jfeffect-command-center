-- Migration A: Atomic multi-Block assignment

CREATE TABLE IF NOT EXISTS public.pl_assignment_operations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.pl_templates(id) ON DELETE CASCADE,
  actor_user_id uuid,
  idempotency_key text NOT NULL,
  mode text NOT NULL,
  selected_block_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  template_payload_revision bigint,
  template_schema_version integer,
  prep_id uuid,
  created_block_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pl_assignment_operations_mode_chk CHECK (
    mode IN ('entire_program','selected_blocks','start_from_block')
  ),
  CONSTRAINT pl_assignment_operations_status_chk CHECK (
    status IN ('completed','failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS pl_assignment_ops_idem_uniq
  ON public.pl_assignment_operations (client_id, template_id, idempotency_key);

CREATE INDEX IF NOT EXISTS pl_assignment_ops_client_created_idx
  ON public.pl_assignment_operations (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pl_assignment_ops_template_created_idx
  ON public.pl_assignment_operations (template_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.pl_assignment_operations TO authenticated;
GRANT ALL ON public.pl_assignment_operations TO service_role;

ALTER TABLE public.pl_assignment_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage pl_assignment_operations"
  ON public.pl_assignment_operations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach read assigned pl_assignment_operations"
  ON public.pl_assignment_operations
  FOR SELECT TO authenticated
  USING (public.is_assigned_coach(client_id));

CREATE POLICY "Coach insert assigned pl_assignment_operations"
  ON public.pl_assignment_operations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_assigned_coach(client_id) AND actor_user_id = auth.uid());

-- Atomic assignment function.
-- Receives already-normalized relational rows (built by the TS server function from the
-- template payload) and inserts them in one transaction with idempotency + auth + source stamping.
--
-- _blocks: jsonb array; each element:
--   {
--     "source_template_block_key": text,
--     "name": text, "training_focus": text|null, "goal": text|null, "coach_notes": text|null,
--     "weeks": int, "week_duration_days": int|null, "est_minutes_per_workout": int|null,
--     "sort_order": int,
--     "weeks_data": [
--        { "week_index": int, "notes": text|null, "training_days": text[]|null, "est_minutes": int|null,
--          "days": [
--             { "day_index": int, "title": text|null, "focus": text|null, "notes": text|null,
--               "duration_estimate_min": int|null, "duration_override_min": int|null,
--               "rows": [
--                  { "sort_order": int, "exercise_id": uuid|null, "exercise_name_override": text|null,
--                    "sets": int|null, "reps_text": text|null, "rpe": text|null, "rir": text|null,
--                    "percentage": numeric|null, "percentage_basis": text|null,
--                    "load_kg": numeric|null, "load_lb": numeric|null, "load_unit": text|null,
--                    "rest_seconds": int|null, "tempo": text|null,
--                    "time_profile": text|null, "intensity_techniques": text[]|null,
--                    "progression_method": text|null, "notes": text|null,
--                    "estimated_seconds": int|null, "card_color": text|null, "purpose_label": text|null
--                  }, ...
--               ]
--             }, ...
--          ]
--        }, ...
--     ]
--   }
CREATE OR REPLACE FUNCTION public.pl_assign_template_blocks_atomic(
  _client_id uuid,
  _template_id uuid,
  _expected_template_revision bigint,
  _mode text,
  _selected_block_keys text[],
  _blocks jsonb,
  _create_prep boolean,
  _prep_title text,
  _idempotency_key text
)
RETURNS TABLE(
  operation_id uuid,
  prep_id uuid,
  created_block_ids uuid[],
  was_idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_is_coach boolean;
  v_template public.pl_templates;
  v_template_schema_version integer;
  v_existing public.pl_assignment_operations;
  v_op_id uuid;
  v_prep_id uuid := NULL;
  v_created_block_ids uuid[] := ARRAY[]::uuid[];
  v_block jsonb;
  v_block_id uuid;
  v_week jsonb;
  v_week_id uuid;
  v_day jsonb;
  v_day_id uuid;
  v_row jsonb;
  v_sort_order int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT public.has_role(v_actor, 'admin'::app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    SELECT public.is_assigned_coach(_client_id) INTO v_is_coach;
    IF NOT v_is_coach THEN
      RAISE EXCEPTION 'not_authorized_for_client' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF _idempotency_key IS NULL OR length(btrim(_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent short-circuit.
  SELECT * INTO v_existing
    FROM public.pl_assignment_operations
   WHERE client_id = _client_id
     AND template_id = _template_id
     AND idempotency_key = _idempotency_key
   LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing.id, v_existing.prep_id, v_existing.created_block_ids, true;
    RETURN;
  END IF;

  -- Template lookup + revision check.
  SELECT * INTO v_template FROM public.pl_templates WHERE id = _template_id;
  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;
  IF _expected_template_revision IS NOT NULL
     AND v_template.payload_revision <> _expected_template_revision THEN
    RAISE EXCEPTION 'template_revision_conflict' USING ERRCODE = 'serialization_failure';
  END IF;
  v_template_schema_version := COALESCE((v_template.payload->>'schema_version')::int, 1);

  IF jsonb_typeof(_blocks) <> 'array' OR jsonb_array_length(_blocks) = 0 THEN
    RAISE EXCEPTION 'no_blocks_to_assign' USING ERRCODE = 'check_violation';
  END IF;

  IF _mode NOT IN ('entire_program','selected_blocks','start_from_block') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = 'check_violation';
  END IF;

  -- Optional prep wrapper.
  IF COALESCE(_create_prep, false) THEN
    INSERT INTO public.pl_preps (client_id, title, goal_type, source_template_id, created_by)
    VALUES (_client_id, COALESCE(_prep_title, v_template.name), 'Custom', _template_id, v_actor)
    RETURNING id INTO v_prep_id;
  END IF;

  -- Insert blocks → weeks → days → rows.
  FOR v_block IN SELECT * FROM jsonb_array_elements(_blocks)
  LOOP
    INSERT INTO public.pl_blocks (
      client_id, prep_id, name, weeks, training_focus, goal, coach_notes,
      week_duration_days, est_minutes_per_workout, sort_order,
      source_template_id, source_template_block_key, source_template_schema_version,
      created_by
    ) VALUES (
      _client_id,
      v_prep_id,
      COALESCE(v_block->>'name', 'Block'),
      COALESCE((v_block->>'weeks')::int, 4),
      v_block->>'training_focus',
      v_block->>'goal',
      v_block->>'coach_notes',
      COALESCE((v_block->>'week_duration_days')::int, 7),
      NULLIF(v_block->>'est_minutes_per_workout','')::int,
      COALESCE((v_block->>'sort_order')::int, 0),
      _template_id,
      v_block->>'source_template_block_key',
      v_template_schema_version,
      v_actor
    ) RETURNING id INTO v_block_id;

    v_created_block_ids := v_created_block_ids || v_block_id;

    IF jsonb_typeof(v_block->'weeks_data') = 'array' THEN
      FOR v_week IN SELECT * FROM jsonb_array_elements(v_block->'weeks_data')
      LOOP
        INSERT INTO public.pl_weeks (
          block_id, week_index, notes, training_days, est_minutes
        ) VALUES (
          v_block_id,
          COALESCE((v_week->>'week_index')::int, 1),
          v_week->>'notes',
          CASE WHEN jsonb_typeof(v_week->'training_days')='array'
               THEN ARRAY(SELECT jsonb_array_elements_text(v_week->'training_days'))
               ELSE ARRAY[]::text[] END,
          NULLIF(v_week->>'est_minutes','')::int
        ) RETURNING id INTO v_week_id;

        IF jsonb_typeof(v_week->'days') = 'array' THEN
          FOR v_day IN SELECT * FROM jsonb_array_elements(v_week->'days')
          LOOP
            INSERT INTO public.pl_days (
              week_id, day_index, title, focus, notes,
              duration_estimate_min, duration_override_min
            ) VALUES (
              v_week_id,
              COALESCE((v_day->>'day_index')::int, 1),
              v_day->>'title',
              v_day->>'focus',
              v_day->>'notes',
              NULLIF(v_day->>'duration_estimate_min','')::int,
              NULLIF(v_day->>'duration_override_min','')::int
            ) RETURNING id INTO v_day_id;

            IF jsonb_typeof(v_day->'rows') = 'array' THEN
              v_sort_order := 0;
              FOR v_row IN SELECT * FROM jsonb_array_elements(v_day->'rows')
              LOOP
                INSERT INTO public.pl_exercise_rows (
                  day_id, sort_order, exercise_id, exercise_name_override,
                  sets, reps_text, rpe, rir,
                  percentage, percentage_basis,
                  load_kg, load_lb, load_unit,
                  rest_seconds, tempo,
                  time_profile, intensity_techniques,
                  progression_method, notes,
                  estimated_seconds, card_color, purpose_label
                ) VALUES (
                  v_day_id,
                  COALESCE((v_row->>'sort_order')::int, v_sort_order),
                  NULLIF(v_row->>'exercise_id','')::uuid,
                  v_row->>'exercise_name_override',
                  NULLIF(v_row->>'sets','')::int,
                  v_row->>'reps_text',
                  v_row->>'rpe',
                  v_row->>'rir',
                  NULLIF(v_row->>'percentage','')::numeric,
                  v_row->>'percentage_basis',
                  NULLIF(v_row->>'load_kg','')::numeric,
                  NULLIF(v_row->>'load_lb','')::numeric,
                  v_row->>'load_unit',
                  NULLIF(v_row->>'rest_seconds','')::int,
                  v_row->>'tempo',
                  COALESCE(v_row->>'time_profile','accessory_compound'),
                  CASE WHEN jsonb_typeof(v_row->'intensity_techniques')='array'
                       THEN ARRAY(SELECT jsonb_array_elements_text(v_row->'intensity_techniques'))
                       ELSE ARRAY[]::text[] END,
                  v_row->>'progression_method',
                  v_row->>'notes',
                  NULLIF(v_row->>'estimated_seconds','')::int,
                  v_row->>'card_color',
                  v_row->>'purpose_label'
                );
                v_sort_order := v_sort_order + 1;
              END LOOP;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Record assignment operation.
  INSERT INTO public.pl_assignment_operations (
    client_id, template_id, actor_user_id, idempotency_key, mode,
    selected_block_keys, template_payload_revision, template_schema_version,
    prep_id, created_block_ids, status
  ) VALUES (
    _client_id, _template_id, v_actor, _idempotency_key, _mode,
    COALESCE(_selected_block_keys, ARRAY[]::text[]),
    v_template.payload_revision, v_template_schema_version,
    v_prep_id, v_created_block_ids, 'completed'
  ) RETURNING id INTO v_op_id;

  RETURN QUERY SELECT v_op_id, v_prep_id, v_created_block_ids, false;
END;
$$;

REVOKE ALL ON FUNCTION public.pl_assign_template_blocks_atomic(
  uuid, uuid, bigint, text, text[], jsonb, boolean, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pl_assign_template_blocks_atomic(
  uuid, uuid, bigint, text, text[], jsonb, boolean, text, text
) TO authenticated, service_role;
