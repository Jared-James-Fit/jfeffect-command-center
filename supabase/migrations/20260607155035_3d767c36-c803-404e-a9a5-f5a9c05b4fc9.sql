
-- =========================================================
-- TABLES
-- =========================================================

CREATE TABLE public.nf_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  form_type text NOT NULL DEFAULT 'check_in',
  recurrence text NOT NULL DEFAULT 'none',
  recurrence_day text,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nf_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.nf_forms(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  question_type text NOT NULL,
  label text NOT NULL,
  help_text text,
  required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditional_logic jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nf_questions_form_id_idx ON public.nf_questions(form_id, order_index);

CREATE TABLE public.nf_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.nf_forms(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  recurrence text NOT NULL DEFAULT 'inherit',
  next_due_at timestamptz,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, client_id)
);

CREATE TABLE public.nf_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.nf_forms(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  period_start date,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nf_submissions_client_form_idx ON public.nf_submissions(client_id, form_id, period_start);
CREATE INDEX nf_submissions_status_idx ON public.nf_submissions(status);

CREATE TABLE public.nf_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.nf_submissions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.nf_questions(id) ON DELETE CASCADE,
  value_text text,
  value_number numeric,
  value_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, question_id)
);
CREATE INDEX nf_answers_submission_idx ON public.nf_answers(submission_id);

CREATE TABLE public.nf_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.nf_submissions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.nf_questions(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  original_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nf_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.nf_submissions(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL,
  reply_text text NOT NULL,
  sent_to_messenger_at timestamptz,
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================
-- GRANTS
-- =========================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_forms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_submissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_answers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_reviews TO authenticated;
GRANT ALL ON public.nf_forms, public.nf_questions, public.nf_assignments,
              public.nf_submissions, public.nf_answers, public.nf_files,
              public.nf_reviews TO service_role;

-- =========================================================
-- RLS
-- =========================================================
ALTER TABLE public.nf_forms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_answers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_files       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_reviews     ENABLE ROW LEVEL SECURITY;

-- nf_forms
CREATE POLICY "Admin manage nf_forms" ON public.nf_forms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read active nf_forms" ON public.nf_forms FOR SELECT TO authenticated
  USING (active = true AND archived = false
    AND EXISTS (SELECT 1 FROM public.coaches co WHERE co.user_id = auth.uid() AND co.archived = false));
CREATE POLICY "Client read assigned nf_forms" ON public.nf_forms FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_assignments a JOIN public.clients c ON c.id = a.client_id
                 WHERE a.form_id = nf_forms.id AND c.user_id = auth.uid()));

-- nf_questions
CREATE POLICY "Admin manage nf_questions" ON public.nf_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read nf_questions" ON public.nf_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coaches co WHERE co.user_id = auth.uid() AND co.archived = false));
CREATE POLICY "Client read assigned nf_questions" ON public.nf_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_assignments a JOIN public.clients c ON c.id = a.client_id
                 WHERE a.form_id = nf_questions.form_id AND c.user_id = auth.uid()));

-- nf_assignments
CREATE POLICY "Admin manage nf_assignments" ON public.nf_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach manage assigned nf_assignments" ON public.nf_assignments FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));
CREATE POLICY "Client read own nf_assignments" ON public.nf_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nf_assignments.client_id AND c.user_id = auth.uid()));

-- nf_submissions
CREATE POLICY "Admin manage nf_submissions" ON public.nf_submissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach manage assigned nf_submissions" ON public.nf_submissions FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));
CREATE POLICY "Client read own nf_submissions" ON public.nf_submissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nf_submissions.client_id AND c.user_id = auth.uid()));
CREATE POLICY "Client insert own nf_submissions" ON public.nf_submissions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nf_submissions.client_id AND c.user_id = auth.uid()));
CREATE POLICY "Client update own nf_submissions" ON public.nf_submissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nf_submissions.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nf_submissions.client_id AND c.user_id = auth.uid()));

-- nf_answers
CREATE POLICY "Admin manage nf_answers" ON public.nf_answers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read assigned nf_answers" ON public.nf_answers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_submissions s WHERE s.id = nf_answers.submission_id
                 AND public.is_assigned_coach(s.client_id)));
CREATE POLICY "Client manage own nf_answers" ON public.nf_answers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_submissions s JOIN public.clients c ON c.id = s.client_id
                 WHERE s.id = nf_answers.submission_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.nf_submissions s JOIN public.clients c ON c.id = s.client_id
                      WHERE s.id = nf_answers.submission_id AND c.user_id = auth.uid()));

-- nf_files
CREATE POLICY "Admin manage nf_files" ON public.nf_files FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read assigned nf_files" ON public.nf_files FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_submissions s WHERE s.id = nf_files.submission_id
                 AND public.is_assigned_coach(s.client_id)));
CREATE POLICY "Client manage own nf_files" ON public.nf_files FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_submissions s JOIN public.clients c ON c.id = s.client_id
                 WHERE s.id = nf_files.submission_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.nf_submissions s JOIN public.clients c ON c.id = s.client_id
                      WHERE s.id = nf_files.submission_id AND c.user_id = auth.uid()));

-- nf_reviews
CREATE POLICY "Admin manage nf_reviews" ON public.nf_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach manage assigned nf_reviews" ON public.nf_reviews FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_submissions s WHERE s.id = nf_reviews.submission_id
                 AND public.is_assigned_coach(s.client_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.nf_submissions s WHERE s.id = nf_reviews.submission_id
                      AND public.is_assigned_coach(s.client_id)));
CREATE POLICY "Client read own nf_reviews" ON public.nf_reviews FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.nf_submissions s JOIN public.clients c ON c.id = s.client_id
                 WHERE s.id = nf_reviews.submission_id AND c.user_id = auth.uid()));

-- =========================================================
-- TRIGGERS
-- =========================================================
CREATE TRIGGER nf_forms_set_updated_at       BEFORE UPDATE ON public.nf_forms       FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER nf_questions_set_updated_at   BEFORE UPDATE ON public.nf_questions   FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER nf_assignments_set_updated_at BEFORE UPDATE ON public.nf_assignments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER nf_submissions_set_updated_at BEFORE UPDATE ON public.nf_submissions FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER nf_answers_set_updated_at     BEFORE UPDATE ON public.nf_answers     FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- SEED: JF Weekly Check-In (23 questions)
-- =========================================================
DO $$
DECLARE v_form uuid;
BEGIN
  INSERT INTO public.nf_forms (title, description, form_type, recurrence, recurrence_day, active)
  VALUES (
    'JF Weekly Check-In',
    'Your weekly check-in with Coach Jared. Be honest — the more detail, the better I can coach you.',
    'check_in', 'weekly', 'Sunday', true
  ) RETURNING id INTO v_form;

  INSERT INTO public.nf_questions (form_id, order_index, question_type, label, required, options) VALUES
    (v_form, 1,  'short_text',    'Name', true, '[]'::jsonb),
    (v_form, 2,  'number',        'What week of your current training block are you going into?', true, '[]'::jsonb),
    (v_form, 3,  'short_text',    'What phase / block are you in?', true, '[]'::jsonb),
    (v_form, 4,  'single_choice', 'Did you add your fasted bodyweight to the app this week?', true, '["Yes","No"]'::jsonb),
    (v_form, 5,  'long_text',     'Wins, PRs & injuries this week?', false, '[]'::jsonb),
    (v_form, 6,  'long_text',     'How did your workouts feel this week?', true, '[]'::jsonb),
    (v_form, 7,  'rating',        'Nutrition adherence (1-10)', true, '[]'::jsonb),
    (v_form, 8,  'long_text',     'If nutrition was off, what got in the way?', false, '[]'::jsonb),
    (v_form, 9,  'rating',        'Water intake (1-10)', true, '[]'::jsonb),
    (v_form, 10, 'rating',        'Hunger levels (1-10)', true, '[]'::jsonb),
    (v_form, 11, 'single_choice', 'Did you experience extreme hunger or feel starved at any point?', true, '["Yes","No"]'::jsonb),
    (v_form, 12, 'long_text',     'Any digestion issues this week?', false, '[]'::jsonb),
    (v_form, 13, 'rating',        'Sleep quality (1-10)', true, '[]'::jsonb),
    (v_form, 14, 'number',        'Average hours of sleep per night', true, '[]'::jsonb),
    (v_form, 15, 'rating',        'Stress level (1-10)', true, '[]'::jsonb),
    (v_form, 16, 'long_text',     'What is causing your stress?', false, '[]'::jsonb),
    (v_form, 17, 'long_text',     'How did cardio go this week?', false, '[]'::jsonb),
    (v_form, 18, 'long_text',     'If you fell short of your cardio targets, why?', false, '[]'::jsonb),
    (v_form, 19, 'long_text',     'Life updates — good or bad news, travel, stress, mental dips. Anything to help me coach you better.', false, '[]'::jsonb),
    (v_form, 20, 'long_text',     'What is one thing you are grateful for this week?', false, '[]'::jsonb),
    (v_form, 21, 'video',         'Upload your weekly check-in video (optional)', false, '[]'::jsonb),
    (v_form, 22, 'file',          'Upload progress photos (optional)', false, '[]'::jsonb),
    (v_form, 23, 'long_text',     'Anything else you want Coach Jared to know?', false, '[]'::jsonb);
END $$;
