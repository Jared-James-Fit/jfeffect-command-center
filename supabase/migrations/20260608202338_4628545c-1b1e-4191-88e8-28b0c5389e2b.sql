
-- Phase 1: Training Block System schema updates

-- pl_blocks: completion tracking
ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_method text CHECK (completion_method IN ('auto','manual')),
  ADD COLUMN IF NOT EXISTS est_minutes_per_workout integer;

-- pl_weeks: status & manual completion & per-week details
ALTER TABLE public.pl_weeks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Not Started'
    CHECK (status IN ('Not Started','In Progress','Completed','Manually Completed')),
  ADD COLUMN IF NOT EXISTS manually_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_completed_by uuid,
  ADD COLUMN IF NOT EXISTS est_minutes integer,
  ADD COLUMN IF NOT EXISTS training_days text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Helper: required workouts in a week = count of pl_days in that week
CREATE OR REPLACE FUNCTION public.pl_week_required_workouts(_week_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.pl_days WHERE week_id = _week_id
$$;

-- Helper: completed workouts in a week for a client
CREATE OR REPLACE FUNCTION public.pl_week_completed_workouts(_week_id uuid, _client_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::int
    FROM public.pl_day_completions c
    JOIN public.pl_days d ON d.id = c.day_id
   WHERE d.week_id = _week_id
     AND c.client_id = _client_id
     AND c.completed_at IS NOT NULL
$$;

-- Recompute a single week's status (auto rolls up; manual flag wins)
CREATE OR REPLACE FUNCTION public.pl_recompute_week_status(_week_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_block_id uuid;
  v_client_id uuid;
  v_required int;
  v_done int;
  v_manual boolean;
  v_new text;
BEGIN
  SELECT w.block_id, b.client_id, w.manually_completed
    INTO v_block_id, v_client_id, v_manual
    FROM pl_weeks w JOIN pl_blocks b ON b.id = w.block_id
   WHERE w.id = _week_id;
  IF v_client_id IS NULL THEN RETURN NULL; END IF;

  IF v_manual THEN
    v_new := 'Manually Completed';
  ELSE
    v_required := public.pl_week_required_workouts(_week_id);
    v_done := public.pl_week_completed_workouts(_week_id, v_client_id);
    IF v_required > 0 AND v_done >= v_required THEN
      v_new := 'Completed';
    ELSIF v_done > 0 THEN
      v_new := 'In Progress';
    ELSE
      v_new := 'Not Started';
    END IF;
  END IF;

  UPDATE pl_weeks SET status = v_new, updated_at = now() WHERE id = _week_id;
  RETURN v_new;
END;
$$;

-- Recompute block status from its weeks; auto-mark Completed if all weeks done
CREATE OR REPLACE FUNCTION public.pl_recompute_block_status(_block_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total int;
  v_done int;
  v_current text;
  v_new text;
BEGIN
  SELECT status INTO v_current FROM pl_blocks WHERE id = _block_id;
  IF v_current IN ('Archived') THEN RETURN v_current; END IF;

  SELECT COUNT(*) INTO v_total FROM pl_weeks WHERE block_id = _block_id;
  SELECT COUNT(*) INTO v_done FROM pl_weeks
    WHERE block_id = _block_id AND status IN ('Completed','Manually Completed');

  IF v_total > 0 AND v_done >= v_total THEN
    v_new := 'Completed';
    UPDATE pl_blocks
       SET status = v_new,
           completed_at = COALESCE(completed_at, now()),
           completion_method = COALESCE(completion_method, 'auto'),
           updated_at = now()
     WHERE id = _block_id;
  ELSE
    IF v_current = 'Completed' THEN
      v_new := 'Active';
      UPDATE pl_blocks
         SET status = v_new, completed_at = NULL, completion_method = NULL, updated_at = now()
       WHERE id = _block_id;
    ELSE
      v_new := v_current;
    END IF;
  END IF;
  RETURN v_new;
END;
$$;

-- Trigger: when a pl_day_completion changes, recompute the owning week + block
CREATE OR REPLACE FUNCTION public.tg_pl_day_completion_recompute()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_day_id uuid;
  v_week_id uuid;
  v_block_id uuid;
BEGIN
  v_day_id := COALESCE(NEW.day_id, OLD.day_id);
  SELECT d.week_id, w.block_id INTO v_week_id, v_block_id
    FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id
   WHERE d.id = v_day_id;
  IF v_week_id IS NOT NULL THEN
    PERFORM public.pl_recompute_week_status(v_week_id);
    PERFORM public.pl_recompute_block_status(v_block_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_day_completion_recompute ON public.pl_day_completions;
CREATE TRIGGER pl_day_completion_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.pl_day_completions
FOR EACH ROW EXECUTE FUNCTION public.tg_pl_day_completion_recompute();
