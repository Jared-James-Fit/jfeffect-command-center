CREATE OR REPLACE FUNCTION public.pl_assign_template_to_client(
  p_template_id uuid,
  p_client_id uuid,
  p_placement jsonb,
  p_name text,
  p_client_visible boolean,
  p_start_date date,
  p_end_date date,
  p_selected_block_ids text[],
  p_start_from_block_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tpl pl_templates%ROWTYPE;
  v_payload jsonb;
  v_type text;
  v_mode text;
  v_name text;
  v_visible boolean := COALESCE(p_client_visible, true);
  v_prep_id uuid;
  v_block_id uuid;
  v_week_id uuid;
  v_day_id uuid;
  v_assignable jsonb;
  v_b jsonb;
  v_weeks_data jsonb;
  v_w jsonb;
  v_d jsonb;
  v_r jsonb;
  v_widx integer;
  v_didx integer;
  v_sort integer;
  v_start_idx integer;
  v_target_block_id uuid;
  v_target_week_id uuid;
  v_target_day_id uuid;
  v_max_idx integer;
  v_v2_source jsonb;
  v_blk_idx integer;
  v_blk_weeks integer;
  v_blk_start date;
  v_blk_end date;
  v_blk_status text;
  v_cursor_date date;
  v_day_date date;
  v_days_data jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(p_client_id)) THEN
    RAISE EXCEPTION 'Not authorized to assign programs to this client';
  END IF;

  SELECT * INTO v_tpl FROM public.pl_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  v_payload := COALESCE(v_tpl.payload, '{}'::jsonb);
  v_type := v_tpl.template_type;
  v_mode := COALESCE(p_placement->>'mode', 'standalone_block');
  v_name := COALESCE(NULLIF(p_name, ''), v_tpl.name);

  IF v_type = 'block'
     AND COALESCE(v_payload->>'schema_version', '') = '2'
     AND (jsonb_typeof(v_payload->'blocks') = 'array' OR jsonb_typeof(v_payload->'blocks_data') = 'array') THEN

    v_v2_source := COALESCE(
      CASE WHEN jsonb_typeof(v_payload->'blocks') = 'array' AND jsonb_array_length(v_payload->'blocks') > 0 THEN v_payload->'blocks' END,
      v_payload->'blocks_data',
      '[]'::jsonb
    );

    SELECT COALESCE(jsonb_agg(b ORDER BY COALESCE(public.pl_safe_first_int(b->>'order_index'), 0)), '[]'::jsonb)
      INTO v_assignable
    FROM jsonb_array_elements(v_v2_source) b
    WHERE COALESCE((b->>'archived')::boolean, false) = false
      AND (b->>'deleted_at') IS NULL
      AND (
        p_selected_block_ids IS NULL
        OR array_length(p_selected_block_ids, 1) IS NULL
        OR (b->>'id') = ANY(p_selected_block_ids)
      );

    IF p_start_from_block_id IS NOT NULL AND jsonb_array_length(v_assignable) > 0 THEN
      SELECT MIN(idx) INTO v_start_idx
      FROM (
        SELECT (ord - 1)::int AS idx, val
        FROM jsonb_array_elements(v_assignable) WITH ORDINALITY AS t(val, ord)
      ) s
      WHERE (s.val->>'id') = p_start_from_block_id;

      IF v_start_idx IS NOT NULL AND v_start_idx > 0 THEN
        SELECT COALESCE(jsonb_agg(val ORDER BY idx), '[]'::jsonb) INTO v_assignable
        FROM (
          SELECT (ord - 1)::int AS idx, val
          FROM jsonb_array_elements(v_assignable) WITH ORDINALITY AS t(val, ord)
        ) s WHERE s.idx >= v_start_idx;
      END IF;
    END IF;

    IF v_assignable IS NULL OR jsonb_array_length(v_assignable) = 0 THEN
      RAISE EXCEPTION 'At least one block must be selected for assignment';
    END IF;

    IF jsonb_array_length(v_assignable) > 1 THEN
      INSERT INTO public.pl_preps (client_id, title, goal_type, status, client_visible, source_template_id, start_date, end_date, total_weeks)
      VALUES (
        p_client_id,
        v_name,
        COALESCE(NULLIF(v_payload->'prep'->>'goal_type',''), 'Custom'),
        'Active',
        v_visible,
        v_tpl.id,
        p_start_date,
        p_end_date,
        NULLIF(public.pl_safe_first_int(COALESCE(v_payload->'prep'->>'total_weeks', v_payload->>'total_weeks')), 0)
      )
      RETURNING id INTO v_prep_id;

      v_blk_idx := 0;
      v_cursor_date := p_start_date;

      FOR v_b IN SELECT val FROM jsonb_array_elements(v_assignable) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
        v_weeks_data := COALESCE(v_b->'weeks', v_b->'weeks_data', '[]'::jsonb);
        v_blk_weeks := GREATEST(COALESCE(jsonb_array_length(v_weeks_data), public.pl_safe_first_int(v_b->>'weeks'), 4), 1);
        v_blk_start := v_cursor_date;
        v_blk_end := CASE WHEN v_cursor_date IS NULL THEN NULL ELSE v_cursor_date + ((v_blk_weeks * 7) - 1) END;
        v_blk_status := CASE WHEN v_blk_idx = 0 THEN 'Active' ELSE 'Draft' END;

        INSERT INTO public.pl_blocks (
          client_id, prep_id, name, weeks, training_focus, status, client_visible,
          source_template_id, source_template_block_key, source_template_schema_version,
          start_date, end_date, sort_order
        ) VALUES (
          p_client_id,
          v_prep_id,
          COALESCE(NULLIF(v_b->>'name',''), 'Block ' || (v_blk_idx + 1)),
          v_blk_weeks,
          NULLIF(v_b->>'training_focus',''),
          v_blk_status,
          v_visible,
          v_tpl.id,
          NULLIF(v_b->>'id',''),
          2,
          v_blk_start,
          v_blk_end,
          v_blk_idx
        ) RETURNING id INTO v_block_id;

        v_widx := 0;
        FOR v_w IN SELECT val FROM jsonb_array_elements(v_weeks_data) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
          v_widx := v_widx + 1;
          INSERT INTO public.pl_weeks (block_id, week_index, notes, phase, start_date, end_date)
          VALUES (
            v_block_id,
            v_widx,
            NULLIF(v_w->>'notes',''),
            NULLIF(v_w->>'phase',''),
            CASE WHEN v_blk_start IS NULL THEN NULL ELSE v_blk_start + ((v_widx - 1) * 7) END,
            CASE WHEN v_blk_start IS NULL THEN NULL ELSE v_blk_start + ((v_widx * 7) - 1) END
          ) RETURNING id INTO v_week_id;

          v_didx := 0;
          v_days_data := COALESCE(v_w->'days','[]'::jsonb);
          FOR v_d IN SELECT val FROM jsonb_array_elements(v_days_data) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
            v_didx := v_didx + 1;
            v_day_date := COALESCE(
              NULLIF(v_d->>'scheduled_date','')::date,
              CASE WHEN v_blk_start IS NULL THEN NULL ELSE v_blk_start + ((v_widx - 1) * 7) + CASE WHEN v_didx = 1 THEN 0 WHEN v_didx = 2 THEN 2 ELSE 4 END END
            );

            INSERT INTO public.pl_days (week_id, day_index, title, focus, notes, scheduled_date, schedule_source)
            VALUES (
              v_week_id,
              v_didx,
              COALESCE(NULLIF(v_d->>'title',''), 'Day ' || v_didx),
              NULLIF(v_d->>'focus',''),
              NULLIF(v_d->>'notes',''),
              v_day_date,
              CASE WHEN v_day_date IS NULL THEN NULL ELSE 'builder_assignment' END
            ) RETURNING id INTO v_day_id;

            v_sort := 0;
            FOR v_r IN SELECT val FROM jsonb_array_elements(COALESCE(v_d->'rows','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
              INSERT INTO public.pl_exercise_rows (
                day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text,
                rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit,
                rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds
              ) VALUES (
                v_day_id,
                COALESCE(public.pl_safe_first_int(v_r->>'sort_order'), v_sort),
                NULLIF(v_r->>'exercise_id','')::uuid,
                COALESCE(NULLIF(v_r->>'exercise_name_override',''), NULLIF(v_r->>'title',''), NULLIF(v_r->>'name',''), NULLIF(v_r->>'exercise_name','')),
                public.pl_safe_first_int(v_r->>'sets'),
                COALESCE(NULLIF(v_r->>'reps_text',''), NULLIF(v_r->>'reps',''), NULLIF(v_r->>'rep_range','')),
                NULLIF(v_r->>'rpe',''),
                NULLIF(v_r->>'rir',''),
                NULLIF(v_r->>'percentage','')::numeric,
                NULLIF(v_r->>'percentage_basis',''),
                NULLIF(COALESCE(v_r->>'load_kg', v_r->>'weight_kg', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit')) = 'kg' THEN v_r->>'weight' END), '')::numeric,
                NULLIF(COALESCE(v_r->>'load_lb', v_r->>'weight_lb', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_r->>'weight' END), '')::numeric,
                NULLIF(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit'), ''),
                public.pl_safe_first_int(COALESCE(v_r->>'rest_seconds', v_r->>'rest')),
                NULLIF(v_r->>'tempo',''),
                COALESCE(NULLIF(v_r->>'time_profile',''), 'accessory_compound'),
                NULLIF(v_r->>'notes',''),
                CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END,
                CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END,
                public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds'))
              );
              v_sort := v_sort + 1;
            END LOOP;
          END LOOP;
        END LOOP;

        v_cursor_date := CASE WHEN v_blk_end IS NULL THEN NULL ELSE v_blk_end + 1 END;
        v_blk_idx := v_blk_idx + 1;
      END LOOP;

      RETURN jsonb_build_object('prep_id', v_prep_id);
    END IF;

    v_b := v_assignable->0;
    v_weeks_data := COALESCE(v_b->'weeks', v_b->'weeks_data', '[]'::jsonb);

    INSERT INTO public.pl_blocks (
      client_id, prep_id, name, weeks, training_focus, status, client_visible,
      source_template_id, source_template_block_key, source_template_schema_version,
      start_date, end_date, sort_order
    ) VALUES (
      p_client_id,
      NULL,
      COALESCE(NULLIF(v_b->>'name',''), v_name),
      GREATEST(COALESCE(jsonb_array_length(v_weeks_data), public.pl_safe_first_int(v_b->>'weeks'), 4), 1),
      NULLIF(v_b->>'training_focus',''),
      'Active',
      v_visible,
      v_tpl.id,
      NULLIF(v_b->>'id',''),
      2,
      p_start_date,
      p_end_date,
      0
    ) RETURNING id INTO v_block_id;

    v_widx := 0;
    FOR v_w IN SELECT val FROM jsonb_array_elements(v_weeks_data) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
      v_widx := v_widx + 1;
      INSERT INTO public.pl_weeks (block_id, week_index, notes, phase, start_date, end_date)
      VALUES (
        v_block_id,
        v_widx,
        NULLIF(v_w->>'notes',''),
        NULLIF(v_w->>'phase',''),
        CASE WHEN p_start_date IS NULL THEN NULL ELSE p_start_date + ((v_widx - 1) * 7) END,
        CASE WHEN p_start_date IS NULL THEN NULL ELSE p_start_date + ((v_widx * 7) - 1) END
      ) RETURNING id INTO v_week_id;

      v_didx := 0;
      FOR v_d IN SELECT val FROM jsonb_array_elements(COALESCE(v_w->'days','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
        v_didx := v_didx + 1;
        v_day_date := COALESCE(
          NULLIF(v_d->>'scheduled_date','')::date,
          CASE WHEN p_start_date IS NULL THEN NULL ELSE p_start_date + ((v_widx - 1) * 7) + CASE WHEN v_didx = 1 THEN 0 WHEN v_didx = 2 THEN 2 ELSE 4 END END
        );
        INSERT INTO public.pl_days (week_id, day_index, title, focus, notes, scheduled_date, schedule_source)
        VALUES (
          v_week_id,
          v_didx,
          COALESCE(NULLIF(v_d->>'title',''), 'Day ' || v_didx),
          NULLIF(v_d->>'focus',''),
          NULLIF(v_d->>'notes',''),
          v_day_date,
          CASE WHEN v_day_date IS NULL THEN NULL ELSE 'builder_assignment' END
        ) RETURNING id INTO v_day_id;

        v_sort := 0;
        FOR v_r IN SELECT val FROM jsonb_array_elements(COALESCE(v_d->'rows','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
          INSERT INTO public.pl_exercise_rows (
            day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text,
            rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit,
            rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds
          ) VALUES (
            v_day_id,
            COALESCE(public.pl_safe_first_int(v_r->>'sort_order'), v_sort),
            NULLIF(v_r->>'exercise_id','')::uuid,
            COALESCE(NULLIF(v_r->>'exercise_name_override',''), NULLIF(v_r->>'title',''), NULLIF(v_r->>'name',''), NULLIF(v_r->>'exercise_name','')),
            public.pl_safe_first_int(v_r->>'sets'),
            COALESCE(NULLIF(v_r->>'reps_text',''), NULLIF(v_r->>'reps',''), NULLIF(v_r->>'rep_range','')),
            NULLIF(v_r->>'rpe',''),
            NULLIF(v_r->>'rir',''),
            NULLIF(v_r->>'percentage','')::numeric,
            NULLIF(v_r->>'percentage_basis',''),
            NULLIF(COALESCE(v_r->>'load_kg', v_r->>'weight_kg', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit')) = 'kg' THEN v_r->>'weight' END), '')::numeric,
            NULLIF(COALESCE(v_r->>'load_lb', v_r->>'weight_lb', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_r->>'weight' END), '')::numeric,
            NULLIF(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit'), ''),
            public.pl_safe_first_int(COALESCE(v_r->>'rest_seconds', v_r->>'rest')),
            NULLIF(v_r->>'tempo',''),
            COALESCE(NULLIF(v_r->>'time_profile',''), 'accessory_compound'),
            NULLIF(v_r->>'notes',''),
            CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END,
            CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END,
            public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds'))
          );
          v_sort := v_sort + 1;
        END LOOP;
      END LOOP;
    END LOOP;

    RETURN jsonb_build_object('block_id', v_block_id);
  END IF;

  IF v_type = 'full_prep' THEN
    INSERT INTO public.pl_preps (
      client_id, title, goal_type, event_name, event_date, total_weeks,
      status, client_visible, source_template_id, start_date, end_date
    ) VALUES (
      p_client_id,
      COALESCE(NULLIF(p_placement->'prep'->>'title',''), v_name),
      COALESCE(NULLIF(p_placement->'prep'->>'goal_type',''), NULLIF(v_payload->'prep'->>'goal_type',''), 'Custom'),
      COALESCE(NULLIF(p_placement->'prep'->>'event_name',''), NULLIF(v_payload->'prep'->>'event_name','')),
      NULLIF(COALESCE(p_placement->'prep'->>'event_date', v_payload->'prep'->>'event_date'),'')::date,
      public.pl_safe_first_int(COALESCE(v_payload->'prep'->>'total_weeks', v_payload->>'total_weeks')),
      'Active', v_visible, v_tpl.id, p_start_date, p_end_date
    ) RETURNING id INTO v_prep_id;

    v_blk_idx := 0;
    v_cursor_date := p_start_date;
    FOR v_b IN SELECT val FROM jsonb_array_elements(COALESCE(NULLIF(v_payload->'blocks_data','[]'::jsonb), NULLIF(v_payload->'blocks','[]'::jsonb), '[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
      v_weeks_data := COALESCE(v_b->'weeks_data', v_b->'weeks', '[]'::jsonb);
      v_blk_weeks := GREATEST(COALESCE(jsonb_array_length(v_weeks_data), public.pl_safe_first_int(v_b->>'weeks'), 4), 1);
      v_blk_start := v_cursor_date;
      v_blk_end := CASE WHEN v_cursor_date IS NULL THEN NULL ELSE v_cursor_date + ((v_blk_weeks * 7) - 1) END;
      v_blk_status := CASE WHEN v_blk_idx = 0 THEN 'Active' ELSE 'Draft' END;

      INSERT INTO public.pl_blocks (client_id, prep_id, name, weeks, training_focus, status, client_visible, source_template_id, source_template_block_key, source_template_schema_version, start_date, end_date, sort_order)
      VALUES (p_client_id, v_prep_id, COALESCE(NULLIF(v_b->>'name',''), 'Block'), v_blk_weeks, NULLIF(v_b->>'training_focus',''), v_blk_status, v_visible, v_tpl.id, NULLIF(v_b->>'id',''), COALESCE(public.pl_safe_first_int(v_payload->>'schema_version'), 1), v_blk_start, v_blk_end, v_blk_idx)
      RETURNING id INTO v_block_id;

      v_widx := 0;
      FOR v_w IN SELECT val FROM jsonb_array_elements(v_weeks_data) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
        v_widx := v_widx + 1;
        INSERT INTO public.pl_weeks (block_id, week_index, notes, phase, start_date, end_date)
        VALUES (v_block_id, v_widx, NULLIF(v_w->>'notes',''), NULLIF(v_w->>'phase',''), CASE WHEN v_blk_start IS NULL THEN NULL ELSE v_blk_start + ((v_widx - 1) * 7) END, CASE WHEN v_blk_start IS NULL THEN NULL ELSE v_blk_start + ((v_widx * 7) - 1) END)
        RETURNING id INTO v_week_id;

        v_didx := 0;
        FOR v_d IN SELECT val FROM jsonb_array_elements(COALESCE(v_w->'days','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
          v_didx := v_didx + 1;
          v_day_date := COALESCE(NULLIF(v_d->>'scheduled_date','')::date, CASE WHEN v_blk_start IS NULL THEN NULL ELSE v_blk_start + ((v_widx - 1) * 7) + CASE WHEN v_didx = 1 THEN 0 WHEN v_didx = 2 THEN 2 ELSE 4 END END);
          INSERT INTO public.pl_days (week_id, day_index, title, focus, notes, scheduled_date, schedule_source)
          VALUES (v_week_id, v_didx, COALESCE(NULLIF(v_d->>'title',''), 'Day ' || v_didx), NULLIF(v_d->>'focus',''), NULLIF(v_d->>'notes',''), v_day_date, CASE WHEN v_day_date IS NULL THEN NULL ELSE 'builder_assignment' END)
          RETURNING id INTO v_day_id;

          v_sort := 0;
          FOR v_r IN SELECT val FROM jsonb_array_elements(COALESCE(v_d->'rows','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
            INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds)
            VALUES (
              v_day_id, COALESCE(public.pl_safe_first_int(v_r->>'sort_order'), v_sort), NULLIF(v_r->>'exercise_id','')::uuid,
              COALESCE(NULLIF(v_r->>'exercise_name_override',''), NULLIF(v_r->>'title',''), NULLIF(v_r->>'name',''), NULLIF(v_r->>'exercise_name','')),
              public.pl_safe_first_int(v_r->>'sets'), COALESCE(NULLIF(v_r->>'reps_text',''), NULLIF(v_r->>'reps',''), NULLIF(v_r->>'rep_range','')),
              NULLIF(v_r->>'rpe',''), NULLIF(v_r->>'rir',''), NULLIF(v_r->>'percentage','')::numeric, NULLIF(v_r->>'percentage_basis',''),
              NULLIF(COALESCE(v_r->>'load_kg', v_r->>'weight_kg', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit')) = 'kg' THEN v_r->>'weight' END), '')::numeric,
              NULLIF(COALESCE(v_r->>'load_lb', v_r->>'weight_lb', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_r->>'weight' END), '')::numeric,
              NULLIF(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit'), ''), public.pl_safe_first_int(COALESCE(v_r->>'rest_seconds', v_r->>'rest')),
              NULLIF(v_r->>'tempo',''), COALESCE(NULLIF(v_r->>'time_profile',''), 'accessory_compound'), NULLIF(v_r->>'notes',''),
              CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END,
              CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END,
              public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds'))
            );
            v_sort := v_sort + 1;
          END LOOP;
        END LOOP;
      END LOOP;

      v_cursor_date := CASE WHEN v_blk_end IS NULL THEN NULL ELSE v_blk_end + 1 END;
      v_blk_idx := v_blk_idx + 1;
    END LOOP;

    RETURN jsonb_build_object('prep_id', v_prep_id);
  END IF;

  IF v_mode = 'new_prep' THEN
    INSERT INTO public.pl_preps (client_id, title, goal_type, event_name, event_date, status, client_visible, source_template_id, start_date, end_date)
    VALUES (p_client_id, COALESCE(NULLIF(p_placement->'prep'->>'title',''), v_name), COALESCE(NULLIF(p_placement->'prep'->>'goal_type',''), 'Custom'), NULLIF(p_placement->'prep'->>'event_name',''), NULLIF(p_placement->'prep'->>'event_date','')::date, 'Active', v_visible, v_tpl.id, p_start_date, p_end_date)
    RETURNING id INTO v_prep_id;
  ELSIF v_mode = 'existing_prep' THEN
    v_prep_id := (p_placement->>'prepId')::uuid;
  END IF;

  IF v_mode IN ('into_block','into_week','into_day') THEN
    IF v_mode = 'into_block' THEN
      v_target_block_id := (p_placement->>'blockId')::uuid;
    ELSIF v_mode = 'into_week' THEN
      v_target_week_id := (p_placement->>'weekId')::uuid;
      SELECT block_id INTO v_target_block_id FROM public.pl_weeks WHERE id = v_target_week_id;
    ELSE
      v_target_day_id := (p_placement->>'dayId')::uuid;
      SELECT w.id, w.block_id INTO v_target_week_id, v_target_block_id
      FROM public.pl_days d JOIN public.pl_weeks w ON w.id = d.week_id
      WHERE d.id = v_target_day_id;
    END IF;

    IF v_target_block_id IS NULL THEN
      RAISE EXCEPTION 'Target block not found';
    END IF;

    IF v_type = 'week' THEN
      SELECT COALESCE(MAX(week_index), 0) + 1 INTO v_widx FROM public.pl_weeks WHERE block_id = v_target_block_id;
      INSERT INTO public.pl_weeks (block_id, week_index, notes, phase)
      VALUES (v_target_block_id, v_widx, NULLIF(v_payload->>'notes',''), NULLIF(v_payload->>'phase',''))
      RETURNING id INTO v_week_id;
      v_didx := 0;
      FOR v_d IN SELECT val FROM jsonb_array_elements(COALESCE(v_payload->'days','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
        v_didx := v_didx + 1;
        INSERT INTO public.pl_days (week_id, day_index, title, focus, notes)
        VALUES (v_week_id, v_didx, COALESCE(NULLIF(v_d->>'title',''), 'Day ' || v_didx), NULLIF(v_d->>'focus',''), NULLIF(v_d->>'notes',''))
        RETURNING id INTO v_day_id;
        v_sort := 0;
        FOR v_r IN SELECT val FROM jsonb_array_elements(COALESCE(v_d->'rows','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
          INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds)
          VALUES (v_day_id, COALESCE(public.pl_safe_first_int(v_r->>'sort_order'), v_sort), NULLIF(v_r->>'exercise_id','')::uuid, COALESCE(NULLIF(v_r->>'exercise_name_override',''), NULLIF(v_r->>'title',''), NULLIF(v_r->>'name',''), NULLIF(v_r->>'exercise_name','')), public.pl_safe_first_int(v_r->>'sets'), COALESCE(NULLIF(v_r->>'reps_text',''), NULLIF(v_r->>'reps',''), NULLIF(v_r->>'rep_range','')), NULLIF(v_r->>'rpe',''), NULLIF(v_r->>'rir',''), NULLIF(v_r->>'percentage','')::numeric, NULLIF(v_r->>'percentage_basis',''), NULLIF(COALESCE(v_r->>'load_kg', v_r->>'weight_kg', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit')) = 'kg' THEN v_r->>'weight' END), '')::numeric, NULLIF(COALESCE(v_r->>'load_lb', v_r->>'weight_lb', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_r->>'weight' END), '')::numeric, NULLIF(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit'), ''), public.pl_safe_first_int(COALESCE(v_r->>'rest_seconds', v_r->>'rest')), NULLIF(v_r->>'tempo',''), COALESCE(NULLIF(v_r->>'time_profile',''), 'accessory_compound'), NULLIF(v_r->>'notes',''), CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END, CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END, public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')));
          v_sort := v_sort + 1;
        END LOOP;
      END LOOP;
      RETURN jsonb_build_object('block_id', v_target_block_id, 'week_id', v_week_id);
    END IF;

    IF v_type = 'day' THEN
      IF v_target_week_id IS NULL THEN
        RAISE EXCEPTION 'Week target required for day insertion';
      END IF;
      SELECT COALESCE(MAX(day_index), 0) + 1 INTO v_didx FROM public.pl_days WHERE week_id = v_target_week_id;
      INSERT INTO public.pl_days (week_id, day_index, title, focus, notes)
      VALUES (v_target_week_id, v_didx, COALESCE(NULLIF(v_payload->>'title',''), 'Day ' || v_didx), NULLIF(v_payload->>'focus',''), NULLIF(v_payload->>'notes',''))
      RETURNING id INTO v_day_id;
      v_sort := 0;
      FOR v_r IN SELECT val FROM jsonb_array_elements(COALESCE(v_payload->'rows','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
        INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds)
        VALUES (v_day_id, COALESCE(public.pl_safe_first_int(v_r->>'sort_order'), v_sort), NULLIF(v_r->>'exercise_id','')::uuid, COALESCE(NULLIF(v_r->>'exercise_name_override',''), NULLIF(v_r->>'title',''), NULLIF(v_r->>'name',''), NULLIF(v_r->>'exercise_name','')), public.pl_safe_first_int(v_r->>'sets'), COALESCE(NULLIF(v_r->>'reps_text',''), NULLIF(v_r->>'reps',''), NULLIF(v_r->>'rep_range','')), NULLIF(v_r->>'rpe',''), NULLIF(v_r->>'rir',''), NULLIF(v_r->>'percentage','')::numeric, NULLIF(v_r->>'percentage_basis',''), NULLIF(COALESCE(v_r->>'load_kg', v_r->>'weight_kg', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit')) = 'kg' THEN v_r->>'weight' END), '')::numeric, NULLIF(COALESCE(v_r->>'load_lb', v_r->>'weight_lb', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_r->>'weight' END), '')::numeric, NULLIF(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit'), ''), public.pl_safe_first_int(COALESCE(v_r->>'rest_seconds', v_r->>'rest')), NULLIF(v_r->>'tempo',''), COALESCE(NULLIF(v_r->>'time_profile',''), 'accessory_compound'), NULLIF(v_r->>'notes',''), CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END, CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END, public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')));
        v_sort := v_sort + 1;
      END LOOP;
      RETURN jsonb_build_object('block_id', v_target_block_id, 'day_id', v_day_id);
    END IF;

    IF v_type = 'exercise_row' THEN
      IF v_target_day_id IS NULL THEN
        RAISE EXCEPTION 'Day target required for exercise row insertion';
      END IF;
      SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.pl_exercise_rows WHERE day_id = v_target_day_id;
      INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds)
      VALUES (v_target_day_id, v_sort, NULLIF(v_payload->>'exercise_id','')::uuid, COALESCE(NULLIF(v_payload->>'exercise_name_override',''), NULLIF(v_payload->>'title',''), NULLIF(v_payload->>'name',''), NULLIF(v_payload->>'exercise_name','')), public.pl_safe_first_int(v_payload->>'sets'), COALESCE(NULLIF(v_payload->>'reps_text',''), NULLIF(v_payload->>'reps',''), NULLIF(v_payload->>'rep_range','')), NULLIF(v_payload->>'rpe',''), NULLIF(v_payload->>'rir',''), NULLIF(v_payload->>'percentage','')::numeric, NULLIF(v_payload->>'percentage_basis',''), NULLIF(COALESCE(v_payload->>'load_kg', v_payload->>'weight_kg', CASE WHEN lower(COALESCE(v_payload->>'weight_unit', v_payload->>'load_unit', v_payload->>'unit')) = 'kg' THEN v_payload->>'weight' END), '')::numeric, NULLIF(COALESCE(v_payload->>'load_lb', v_payload->>'weight_lb', CASE WHEN lower(COALESCE(v_payload->>'weight_unit', v_payload->>'load_unit', v_payload->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_payload->>'weight' END), '')::numeric, NULLIF(COALESCE(v_payload->>'weight_unit', v_payload->>'load_unit', v_payload->>'unit'), ''), public.pl_safe_first_int(COALESCE(v_payload->>'rest_seconds', v_payload->>'rest')), NULLIF(v_payload->>'tempo',''), COALESCE(NULLIF(v_payload->>'time_profile',''), 'accessory_compound'), NULLIF(v_payload->>'notes',''), CASE WHEN public.pl_safe_first_int(COALESCE(v_payload->>'time_seconds', v_payload->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END, CASE WHEN public.pl_safe_first_int(COALESCE(v_payload->>'time_seconds', v_payload->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END, public.pl_safe_first_int(COALESCE(v_payload->>'time_seconds', v_payload->>'duration_seconds')));
      RETURN jsonb_build_object('block_id', v_target_block_id, 'day_id', v_target_day_id);
    END IF;
  END IF;

  v_weeks_data := COALESCE(v_payload->'weeks_data', v_payload->'weeks', '[]'::jsonb);
  INSERT INTO public.pl_blocks (client_id, prep_id, name, weeks, training_focus, status, client_visible, source_template_id, start_date, end_date)
  VALUES (p_client_id, v_prep_id, v_name, GREATEST(COALESCE(jsonb_array_length(v_weeks_data), public.pl_safe_first_int(v_payload->>'weeks'), 4), 1), NULLIF(v_payload->>'training_focus',''), 'Active', v_visible, v_tpl.id, p_start_date, p_end_date)
  RETURNING id INTO v_block_id;

  v_widx := 0;
  FOR v_w IN SELECT val FROM jsonb_array_elements(v_weeks_data) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
    v_widx := v_widx + 1;
    INSERT INTO public.pl_weeks (block_id, week_index, notes, phase)
    VALUES (v_block_id, v_widx, NULLIF(v_w->>'notes',''), NULLIF(v_w->>'phase',''))
    RETURNING id INTO v_week_id;
    v_didx := 0;
    FOR v_d IN SELECT val FROM jsonb_array_elements(COALESCE(v_w->'days','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
      v_didx := v_didx + 1;
      INSERT INTO public.pl_days (week_id, day_index, title, focus, notes)
      VALUES (v_week_id, v_didx, COALESCE(NULLIF(v_d->>'title',''), 'Day ' || v_didx), NULLIF(v_d->>'focus',''), NULLIF(v_d->>'notes',''))
      RETURNING id INTO v_day_id;
      v_sort := 0;
      FOR v_r IN SELECT val FROM jsonb_array_elements(COALESCE(v_d->'rows','[]'::jsonb)) WITH ORDINALITY AS t(val, ord) ORDER BY ord LOOP
        INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, rest_seconds, tempo, time_profile, notes, measurement_type, tracking_type, duration_seconds)
        VALUES (v_day_id, COALESCE(public.pl_safe_first_int(v_r->>'sort_order'), v_sort), NULLIF(v_r->>'exercise_id','')::uuid, COALESCE(NULLIF(v_r->>'exercise_name_override',''), NULLIF(v_r->>'title',''), NULLIF(v_r->>'name',''), NULLIF(v_r->>'exercise_name','')), public.pl_safe_first_int(v_r->>'sets'), COALESCE(NULLIF(v_r->>'reps_text',''), NULLIF(v_r->>'reps',''), NULLIF(v_r->>'rep_range','')), NULLIF(v_r->>'rpe',''), NULLIF(v_r->>'rir',''), NULLIF(v_r->>'percentage','')::numeric, NULLIF(v_r->>'percentage_basis',''), NULLIF(COALESCE(v_r->>'load_kg', v_r->>'weight_kg', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit')) = 'kg' THEN v_r->>'weight' END), '')::numeric, NULLIF(COALESCE(v_r->>'load_lb', v_r->>'weight_lb', CASE WHEN lower(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit', 'lb')) IN ('lb','lbs','pound','pounds') THEN v_r->>'weight' END), '')::numeric, NULLIF(COALESCE(v_r->>'weight_unit', v_r->>'load_unit', v_r->>'unit'), ''), public.pl_safe_first_int(COALESCE(v_r->>'rest_seconds', v_r->>'rest')), NULLIF(v_r->>'tempo',''), COALESCE(NULLIF(v_r->>'time_profile',''), 'accessory_compound'), NULLIF(v_r->>'notes',''), CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps' END, CASE WHEN public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')) IS NOT NULL THEN 'time' ELSE 'reps_weight' END, public.pl_safe_first_int(COALESCE(v_r->>'time_seconds', v_r->>'duration_seconds')));
        v_sort := v_sort + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('block_id', v_block_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.pl_assign_template_to_client(uuid, uuid, jsonb, text, boolean, date, date, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pl_assign_template_to_client(uuid, uuid, jsonb, text, boolean, date, date, text[], text) TO authenticated, service_role;