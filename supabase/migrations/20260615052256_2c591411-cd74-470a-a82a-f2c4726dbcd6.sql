
ALTER TABLE public.pl_assignment_operations
  ADD COLUMN IF NOT EXISTS selected_week_keys      text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS selected_day_keys       text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS selected_exercise_keys  text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS assignment_method       text,
  ADD COLUMN IF NOT EXISTS training_weekdays       text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS conflict_decisions      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publish_status          text   NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS publish_at              timestamptz,
  ADD COLUMN IF NOT EXISTS published_at            timestamptz,
  ADD COLUMN IF NOT EXISTS workouts_added          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_merged         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_replaced       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_skipped        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_moved          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planner_payload         jsonb  NOT NULL DEFAULT '{}'::jsonb;

-- Loosen the existing mode check to also allow new planner modes alongside
-- the legacy ones. Safe to re-run (drop-if-exists then add).
ALTER TABLE public.pl_assignment_operations
  DROP CONSTRAINT IF EXISTS pl_assignment_operations_mode_chk;

ALTER TABLE public.pl_assignment_operations
  ADD CONSTRAINT pl_assignment_operations_mode_chk
  CHECK (mode = ANY (ARRAY[
    'entire_program',
    'selected_blocks',
    'start_from_block',
    'planner_entire_sequence',
    'planner_weekday_map',
    'planner_manual_dates',
    'planner_fill_empty',
    'planner_insert',
    'planner_replace_range'
  ]));

ALTER TABLE public.pl_assignment_operations
  DROP CONSTRAINT IF EXISTS pl_assignment_operations_publish_status_chk;

ALTER TABLE public.pl_assignment_operations
  ADD CONSTRAINT pl_assignment_operations_publish_status_chk
  CHECK (publish_status = ANY (ARRAY['draft','scheduled','published']));

-- A planner batch can be undone; record that here so we don't need a new
-- table just for status tracking.
ALTER TABLE public.pl_assignment_operations
  ADD COLUMN IF NOT EXISTS undone_at    timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by    uuid;

-- Index for the assignment history panel (client profile).
CREATE INDEX IF NOT EXISTS pl_assignment_ops_planner_idx
  ON public.pl_assignment_operations (client_id, created_at DESC)
  WHERE planner_payload <> '{}'::jsonb;

-- Index so the publish-scheduler can find due batches quickly.
CREATE INDEX IF NOT EXISTS pl_assignment_ops_publish_due_idx
  ON public.pl_assignment_operations (publish_at)
  WHERE publish_status = 'scheduled' AND publish_at IS NOT NULL;
