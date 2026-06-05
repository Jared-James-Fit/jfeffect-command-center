ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS bodyweight_goal_type text
    CHECK (bodyweight_goal_type IN ('lose','gain','maintain','performance_cut','custom')),
  ADD COLUMN IF NOT EXISTS bodyweight_goal_value numeric(6,2),
  ADD COLUMN IF NOT EXISTS bodyweight_goal_value_max numeric(6,2),
  ADD COLUMN IF NOT EXISTS bodyweight_goal_unit text
    CHECK (bodyweight_goal_unit IN ('lb','kg')),
  ADD COLUMN IF NOT EXISTS bodyweight_goal_set_at timestamptz;