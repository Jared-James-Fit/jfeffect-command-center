
-- ============ pl_preps ============
CREATE TABLE public.pl_preps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  title text NOT NULL,
  goal_type text NOT NULL DEFAULT 'Custom',
  event_name text,
  event_date date,
  event_location text,
  federation text,
  weight_class text,
  division text,
  start_date date,
  end_date date,
  total_weeks integer,
  current_focus text,
  status text NOT NULL DEFAULT 'Planned',
  coach_notes text,
  client_visible boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_preps TO authenticated;
GRANT ALL ON public.pl_preps TO service_role;
ALTER TABLE public.pl_preps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_preps" ON public.pl_preps FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage assigned pl_preps" ON public.pl_preps FOR ALL TO authenticated USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own pl_preps" ON public.pl_preps FOR SELECT TO authenticated USING (client_visible AND EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_preps.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_preps_updated BEFORE UPDATE ON public.pl_preps FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_pl_preps_client ON public.pl_preps(client_id);

-- ============ pl_blocks ============
CREATE TABLE public.pl_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  prep_id uuid REFERENCES public.pl_preps(id) ON DELETE SET NULL,
  name text NOT NULL,
  week_start_index integer,
  weeks integer NOT NULL DEFAULT 4,
  start_date date,
  end_date date,
  training_focus text,
  goal text,
  status text NOT NULL DEFAULT 'Draft',
  coach_notes text,
  client_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_blocks TO authenticated;
GRANT ALL ON public.pl_blocks TO service_role;
ALTER TABLE public.pl_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_blocks" ON public.pl_blocks FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage assigned pl_blocks" ON public.pl_blocks FOR ALL TO authenticated USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own pl_blocks" ON public.pl_blocks FOR SELECT TO authenticated USING (client_visible AND EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_blocks.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_blocks_updated BEFORE UPDATE ON public.pl_blocks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_pl_blocks_client ON public.pl_blocks(client_id);
CREATE INDEX idx_pl_blocks_prep ON public.pl_blocks(prep_id);

-- ============ pl_weeks ============
CREATE TABLE public.pl_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.pl_blocks(id) ON DELETE CASCADE,
  week_index integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, week_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_weeks TO authenticated;
GRANT ALL ON public.pl_weeks TO service_role;
ALTER TABLE public.pl_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_weeks" ON public.pl_weeks FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_weeks" ON public.pl_weeks FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM pl_blocks b WHERE b.id = pl_weeks.block_id AND is_assigned_coach(b.client_id))) WITH CHECK (EXISTS (SELECT 1 FROM pl_blocks b WHERE b.id = pl_weeks.block_id AND is_assigned_coach(b.client_id)));
CREATE POLICY "Client read pl_weeks" ON public.pl_weeks FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM pl_blocks b JOIN clients c ON c.id = b.client_id WHERE b.id = pl_weeks.block_id AND b.client_visible AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_weeks_updated BEFORE UPDATE ON public.pl_weeks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ pl_days ============
CREATE TABLE public.pl_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id uuid NOT NULL REFERENCES public.pl_weeks(id) ON DELETE CASCADE,
  day_index integer NOT NULL,
  title text,
  focus text,
  notes text,
  duration_estimate_min integer,
  duration_override_min integer,
  duration_source text NOT NULL DEFAULT 'auto',
  scheduled_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_days TO authenticated;
GRANT ALL ON public.pl_days TO service_role;
ALTER TABLE public.pl_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_days" ON public.pl_days FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_days" ON public.pl_days FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM pl_weeks w JOIN pl_blocks b ON b.id = w.block_id WHERE w.id = pl_days.week_id AND is_assigned_coach(b.client_id))) WITH CHECK (EXISTS (SELECT 1 FROM pl_weeks w JOIN pl_blocks b ON b.id = w.block_id WHERE w.id = pl_days.week_id AND is_assigned_coach(b.client_id)));
CREATE POLICY "Client read pl_days" ON public.pl_days FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM pl_weeks w JOIN pl_blocks b ON b.id = w.block_id JOIN clients c ON c.id = b.client_id WHERE w.id = pl_days.week_id AND b.client_visible AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_days_updated BEFORE UPDATE ON public.pl_days FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_pl_days_week ON public.pl_days(week_id);

-- ============ pl_exercise_rows ============
CREATE TABLE public.pl_exercise_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES public.pl_days(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  exercise_name_override text,
  sets integer,
  reps_text text,
  rpe text,
  rir text,
  percentage numeric,
  percentage_basis text,
  basis_row_id uuid REFERENCES public.pl_exercise_rows(id) ON DELETE SET NULL,
  load_kg numeric,
  load_lb numeric,
  rest_seconds integer,
  tempo text,
  time_profile text NOT NULL DEFAULT 'accessory_compound',
  intensity_techniques text[] NOT NULL DEFAULT '{}',
  progression_method text,
  notes text,
  estimated_seconds integer,
  estimated_seconds_override integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_exercise_rows TO authenticated;
GRANT ALL ON public.pl_exercise_rows TO service_role;
ALTER TABLE public.pl_exercise_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_exercise_rows" ON public.pl_exercise_rows FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_exercise_rows" ON public.pl_exercise_rows FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id JOIN pl_blocks b ON b.id = w.block_id WHERE d.id = pl_exercise_rows.day_id AND is_assigned_coach(b.client_id))) WITH CHECK (EXISTS (SELECT 1 FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id JOIN pl_blocks b ON b.id = w.block_id WHERE d.id = pl_exercise_rows.day_id AND is_assigned_coach(b.client_id)));
CREATE POLICY "Client read pl_exercise_rows" ON public.pl_exercise_rows FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM pl_days d JOIN pl_weeks w ON w.id = d.week_id JOIN pl_blocks b ON b.id = w.block_id JOIN clients c ON c.id = b.client_id WHERE d.id = pl_exercise_rows.day_id AND b.client_visible AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_exercise_rows_updated BEFORE UPDATE ON public.pl_exercise_rows FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_pl_rows_day ON public.pl_exercise_rows(day_id);

-- ============ pl_row_results ============
CREATE TABLE public.pl_row_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES public.pl_exercise_rows(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  set_index integer NOT NULL,
  actual_load numeric,
  actual_load_unit text,
  actual_reps integer,
  actual_rpe text,
  actual_rir text,
  notes text,
  video_url text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_row_results TO authenticated;
GRANT ALL ON public.pl_row_results TO service_role;
ALTER TABLE public.pl_row_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_row_results" ON public.pl_row_results FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_row_results" ON public.pl_row_results FOR ALL TO authenticated USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client manage own pl_row_results" ON public.pl_row_results FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_row_results.client_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_row_results.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_row_results_updated BEFORE UPDATE ON public.pl_row_results FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_pl_row_results_row ON public.pl_row_results(row_id);
CREATE INDEX idx_pl_row_results_client ON public.pl_row_results(client_id);

-- ============ pl_day_completions ============
CREATE TABLE public.pl_day_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES public.pl_days(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  actual_duration_min integer,
  client_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_day_completions TO authenticated;
GRANT ALL ON public.pl_day_completions TO service_role;
ALTER TABLE public.pl_day_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_day_completions" ON public.pl_day_completions FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_day_completions" ON public.pl_day_completions FOR ALL TO authenticated USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client manage own pl_day_completions" ON public.pl_day_completions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_day_completions.client_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_day_completions.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_day_completions_updated BEFORE UPDATE ON public.pl_day_completions FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ pl_client_maxes ============
CREATE TABLE public.pl_client_maxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  lift text NOT NULL,
  one_rm numeric,
  training_max numeric,
  estimated_1rm numeric,
  unit text NOT NULL DEFAULT 'kg',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, lift)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_client_maxes TO authenticated;
GRANT ALL ON public.pl_client_maxes TO service_role;
ALTER TABLE public.pl_client_maxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_client_maxes" ON public.pl_client_maxes FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage pl_client_maxes" ON public.pl_client_maxes FOR ALL TO authenticated USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own pl_client_maxes" ON public.pl_client_maxes FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = pl_client_maxes.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_pl_client_maxes_updated BEFORE UPDATE ON public.pl_client_maxes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ pl_templates ============
CREATE TABLE public.pl_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  template_type text NOT NULL DEFAULT 'block',
  training_style text NOT NULL DEFAULT 'custom',
  training_focus text,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'Draft',
  weeks integer,
  days_per_week integer,
  est_duration_min integer,
  goal text,
  notes text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_templates TO authenticated;
GRANT ALL ON public.pl_templates TO service_role;
ALTER TABLE public.pl_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage pl_templates" ON public.pl_templates FOR ALL TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach read pl_templates" ON public.pl_templates FOR SELECT TO authenticated USING (archived = false AND EXISTS (SELECT 1 FROM coaches co WHERE co.user_id = auth.uid() AND co.archived = false AND co.status = 'Active'));
CREATE TRIGGER tg_pl_templates_updated BEFORE UPDATE ON public.pl_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_pl_templates_type ON public.pl_templates(template_type);
CREATE INDEX idx_pl_templates_style ON public.pl_templates(training_style);
