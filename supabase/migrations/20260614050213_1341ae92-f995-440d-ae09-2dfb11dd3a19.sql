-- 1. Server-side feature toggle (defaults off; flipping flips the guards).
INSERT INTO public.app_settings (key, value)
VALUES ('pl_block_logger_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pl_block_logger_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.app_settings WHERE key = 'pl_block_logger_enabled'),
    'false'
  ) IN ('true','1','t','TRUE','True');
$$;

GRANT EXECUTE ON FUNCTION public.pl_block_logger_enabled() TO authenticated, service_role;

-- 2. Per-row unsupported-blocks predicate.
CREATE OR REPLACE FUNCTION public.pl_row_has_unsupported_blocks(p_row_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pl_exercise_blocks b
    WHERE b.row_id = p_row_id
    GROUP BY b.row_id
    HAVING COUNT(*) > 1 OR bool_or(b.block_type <> 'straight')
  );
$$;

GRANT EXECUTE ON FUNCTION public.pl_row_has_unsupported_blocks(uuid) TO authenticated, service_role;

-- 3. Trigger: prevent saving a non-legacy block on a row whose owning program is client-visible.
CREATE OR REPLACE FUNCTION public.pl_guard_block_save()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_client_visible boolean;
  v_other_count int;
BEGIN
  IF public.pl_block_logger_enabled() THEN
    RETURN NEW;
  END IF;

  -- Resolve the owning pl_blocks row, if any. Rows that don't trace up to a
  -- client-visible program (drafts, hidden blocks, or orphan templates) pass.
  SELECT b.client_visible
    INTO v_client_visible
    FROM public.pl_exercise_rows r
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
   WHERE r.id = NEW.row_id;

  IF v_client_visible IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  -- Sibling block count (excluding NEW itself on UPDATE).
  SELECT COUNT(*) INTO v_other_count
    FROM public.pl_exercise_blocks
   WHERE row_id = NEW.row_id AND id <> NEW.id;

  IF NEW.block_type <> 'straight' OR v_other_count > 0 THEN
    RAISE EXCEPTION 'Multi-block prescriptions are currently available in builder preview only. Client assignment will unlock after the block logger is enabled.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_guard_block_save_trg ON public.pl_exercise_blocks;
CREATE TRIGGER pl_guard_block_save_trg
BEFORE INSERT OR UPDATE ON public.pl_exercise_blocks
FOR EACH ROW EXECUTE FUNCTION public.pl_guard_block_save();

-- 4. Trigger: prevent flipping client_visible OFF->ON while unsupported blocks exist anywhere in the program.
CREATE OR REPLACE FUNCTION public.pl_guard_block_activation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bad int;
BEGIN
  IF public.pl_block_logger_enabled() THEN
    RETURN NEW;
  END IF;

  IF NEW.client_visible IS DISTINCT FROM OLD.client_visible
     AND NEW.client_visible = true THEN
    SELECT COUNT(*)
      INTO v_bad
      FROM public.pl_exercise_rows r
      JOIN public.pl_days d ON d.id = r.day_id
      JOIN public.pl_weeks w ON w.id = d.week_id
     WHERE w.block_id = NEW.id
       AND public.pl_row_has_unsupported_blocks(r.id);

    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Multi-block prescriptions are currently available in builder preview only. Client assignment will unlock after the block logger is enabled.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_guard_block_activation_trg ON public.pl_blocks;
CREATE TRIGGER pl_guard_block_activation_trg
BEFORE UPDATE ON public.pl_blocks
FOR EACH ROW EXECUTE FUNCTION public.pl_guard_block_activation();

-- 5. Atomic two-pass clone helper. Used by bulk-duplicate week/day, copy-week-to-block,
-- and the in-memory row clipboard's paste path.
-- p_mappings: jsonb array of { source_row_id: uuid, dest_row_id: uuid }
-- Pass 1 inserts blocks (and their set_rows / drop_stages) with reference_block_id=NULL.
-- Pass 2 remaps reference_block_id using an in-memory old->new map. References that
-- escape the copied selection cause the whole call to fail (the entire transaction
-- rolls back, so partial state never persists).
CREATE OR REPLACE FUNCTION public.pl_clone_blocks_for_rows(p_mappings jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m record;
  block_row record;
  id_map jsonb := '{}'::jsonb;
  new_block_id uuid;
  total int := 0;
BEGIN
  IF p_mappings IS NULL OR jsonb_array_length(p_mappings) = 0 THEN
    RETURN 0;
  END IF;

  -- Pass 1: clone blocks + children.
  FOR m IN
    SELECT (elem->>'source_row_id')::uuid AS src_row,
           (elem->>'dest_row_id')::uuid   AS dst_row
      FROM jsonb_array_elements(p_mappings) AS elem
  LOOP
    FOR block_row IN
      SELECT * FROM public.pl_exercise_blocks
       WHERE row_id = m.src_row
       ORDER BY sort_order
    LOOP
      INSERT INTO public.pl_exercise_blocks (
        row_id, sort_order, block_type, label, sets, reps_text, rpe, rir,
        load_type, load_value, load_unit, reference_block_id,
        rest_seconds_override, tempo, amrap, notes, config
      ) VALUES (
        m.dst_row, block_row.sort_order, block_row.block_type, block_row.label,
        block_row.sets, block_row.reps_text, block_row.rpe, block_row.rir,
        block_row.load_type, block_row.load_value, block_row.load_unit,
        NULL,
        block_row.rest_seconds_override, block_row.tempo, block_row.amrap,
        block_row.notes, block_row.config
      ) RETURNING id INTO new_block_id;

      id_map := id_map || jsonb_build_object(block_row.id::text, new_block_id::text);

      INSERT INTO public.pl_block_set_rows
        (block_id, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap)
      SELECT new_block_id, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap
        FROM public.pl_block_set_rows
       WHERE block_id = block_row.id
       ORDER BY sort_order;

      INSERT INTO public.pl_block_drop_stages
        (block_id, sort_order, reduction_type, reduction_value, reps_text, rpe, rir, amrap, rest_seconds)
      SELECT new_block_id, sort_order, reduction_type, reduction_value, reps_text, rpe, rir, amrap, rest_seconds
        FROM public.pl_block_drop_stages
       WHERE block_id = block_row.id
       ORDER BY sort_order;

      total := total + 1;
    END LOOP;
  END LOOP;

  -- Pass 2: remap reference_block_id within the same clone batch.
  FOR m IN
    SELECT (elem->>'source_row_id')::uuid AS src_row
      FROM jsonb_array_elements(p_mappings) AS elem
  LOOP
    FOR block_row IN
      SELECT id, reference_block_id
        FROM public.pl_exercise_blocks
       WHERE row_id = m.src_row AND reference_block_id IS NOT NULL
    LOOP
      IF NOT (id_map ? block_row.reference_block_id::text) THEN
        RAISE EXCEPTION 'Cannot copy block %: it references a block outside the copied selection. Copy the referenced block together with this exercise.', block_row.id
          USING ERRCODE = 'check_violation';
      END IF;
      UPDATE public.pl_exercise_blocks
         SET reference_block_id = (id_map->>block_row.reference_block_id::text)::uuid
       WHERE id = (id_map->>block_row.id::text)::uuid;
    END LOOP;
  END LOOP;

  RETURN total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pl_clone_blocks_for_rows(jsonb) TO authenticated, service_role;