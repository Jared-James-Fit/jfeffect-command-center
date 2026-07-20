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
    'planner_replace_range',
    'planner_client_days'
  ]));