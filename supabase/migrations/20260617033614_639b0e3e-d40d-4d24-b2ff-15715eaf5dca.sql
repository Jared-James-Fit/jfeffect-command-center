CREATE TYPE public.progress_owner_type AS ENUM ('client', 'member');
CREATE TYPE public.progress_submission_type AS ENUM ('photo', 'video');
CREATE TYPE public.progress_video_format AS ENUM ('four_angle', 'continuous');
CREATE TYPE public.progress_angle AS ENUM ('front', 'left', 'back', 'right', 'all');
CREATE TYPE public.progress_review_status AS ENUM ('draft', 'submitted', 'awaiting_review', 'reviewed', 'needs_update', 'self_tracking');
CREATE TYPE public.progress_upload_status AS ENUM ('draft', 'uploading', 'processing', 'ready', 'syncing_drive', 'saved_to_drive', 'upload_failed', 'sync_failed');
CREATE TYPE public.progress_schedule_kind AS ENUM ('photos', 'videos', 'bodyweight', 'measurements');
CREATE TYPE public.progress_schedule_frequency AS ENUM ('weekly', 'biweekly', 'monthly', 'per_block', 'custom', 'none');

CREATE TABLE public.progress_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  owner_type public.progress_owner_type NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.app_members(id) ON DELETE SET NULL,
  assigned_coach_id uuid,
  submission_type public.progress_submission_type NOT NULL,
  video_format public.progress_video_format,
  submission_date date NOT NULL DEFAULT CURRENT_DATE,
  check_in_label text,
  training_phase_id uuid REFERENCES public.training_phases(id) ON DELETE SET NULL,
  bodyweight numeric,
  weight_unit text CHECK (weight_unit IN ('kg','lb')),
  notes text,
  review_status public.progress_review_status NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_submissions_user ON public.progress_submissions(user_id, submission_date DESC);
CREATE INDEX idx_progress_submissions_client ON public.progress_submissions(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_progress_submissions_status ON public.progress_submissions(review_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_submissions TO authenticated;
GRANT ALL ON public.progress_submissions TO service_role;
ALTER TABLE public.progress_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage own submissions" ON public.progress_submissions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin all submissions" ON public.progress_submissions
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach read assigned submissions" ON public.progress_submissions
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.assigned_coach_id = auth.uid())
  );
CREATE POLICY "Coach update assigned submissions" ON public.progress_submissions
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.assigned_coach_id = auth.uid())
  );

CREATE TABLE public.progress_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.progress_submissions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  media_type public.progress_submission_type NOT NULL,
  angle public.progress_angle NOT NULL,
  original_filename text,
  file_size_bytes bigint,
  mime_type text,
  storage_path text,
  thumbnail_path text,
  drive_file_id text,
  drive_url text,
  drive_folder_id text,
  upload_status public.progress_upload_status NOT NULL DEFAULT 'draft',
  drive_sync_status text DEFAULT 'pending',
  retry_count int NOT NULL DEFAULT 0,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_media_submission ON public.progress_media(submission_id);
CREATE INDEX idx_progress_media_user ON public.progress_media(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_media TO authenticated;
GRANT ALL ON public.progress_media TO service_role;
ALTER TABLE public.progress_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage own media" ON public.progress_media
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin all media" ON public.progress_media
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach read assigned media" ON public.progress_media
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND EXISTS (
      SELECT 1 FROM public.progress_submissions s
      JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = submission_id AND c.assigned_coach_id = auth.uid()
    )
  );

CREATE TABLE public.progress_bodyweight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  logged_date date NOT NULL DEFAULT CURRENT_DATE,
  weight_value numeric NOT NULL,
  weight_unit text NOT NULL CHECK (weight_unit IN ('kg','lb')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_bodyweight_user_date ON public.progress_bodyweight(user_id, logged_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_bodyweight TO authenticated;
GRANT ALL ON public.progress_bodyweight TO service_role;
ALTER TABLE public.progress_bodyweight ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage bodyweight" ON public.progress_bodyweight
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin all bodyweight" ON public.progress_bodyweight
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach read assigned bodyweight" ON public.progress_bodyweight
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = progress_bodyweight.user_id AND c.assigned_coach_id = auth.uid())
  );

CREATE TABLE public.progress_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  measured_date date NOT NULL DEFAULT CURRENT_DATE,
  unit text NOT NULL DEFAULT 'cm' CHECK (unit IN ('cm','in')),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_measurements_user_date ON public.progress_measurements(user_id, measured_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_measurements TO authenticated;
GRANT ALL ON public.progress_measurements TO service_role;
ALTER TABLE public.progress_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage measurements" ON public.progress_measurements
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin all measurements" ON public.progress_measurements
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach read assigned measurements" ON public.progress_measurements
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = progress_measurements.user_id AND c.assigned_coach_id = auth.uid())
  );

CREATE TABLE public.progress_check_in_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind public.progress_schedule_kind NOT NULL,
  frequency public.progress_schedule_frequency NOT NULL DEFAULT 'weekly',
  custom_days int,
  enabled boolean NOT NULL DEFAULT true,
  next_due date,
  last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_check_in_schedules TO authenticated;
GRANT ALL ON public.progress_check_in_schedules TO service_role;
ALTER TABLE public.progress_check_in_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manage schedules" ON public.progress_check_in_schedules
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin all schedules" ON public.progress_check_in_schedules
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach read assigned schedules" ON public.progress_check_in_schedules
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = progress_check_in_schedules.user_id AND c.assigned_coach_id = auth.uid())
  );

CREATE TABLE public.progress_review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.progress_submissions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  body text NOT NULL,
  angle public.progress_angle,
  kind text NOT NULL DEFAULT 'overall' CHECK (kind IN ('overall','angle','internal')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_review_responses_submission ON public.progress_review_responses(submission_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_review_responses TO authenticated;
GRANT ALL ON public.progress_review_responses TO service_role;
ALTER TABLE public.progress_review_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin all review responses" ON public.progress_review_responses
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach manage assigned review responses" ON public.progress_review_responses
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'coach')
    AND EXISTS (
      SELECT 1 FROM public.progress_submissions s
      JOIN public.clients c ON c.id = s.client_id
      WHERE s.id = submission_id AND c.assigned_coach_id = auth.uid()
    )
  ) WITH CHECK (reviewer_id = auth.uid());
CREATE POLICY "Owner read non-internal review responses" ON public.progress_review_responses
  FOR SELECT TO authenticated USING (
    kind <> 'internal'
    AND EXISTS (SELECT 1 FROM public.progress_submissions s WHERE s.id = submission_id AND s.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.touch_progress_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_progress_submissions_touch BEFORE UPDATE ON public.progress_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_progress_updated_at();
CREATE TRIGGER trg_progress_media_touch BEFORE UPDATE ON public.progress_media
  FOR EACH ROW EXECUTE FUNCTION public.touch_progress_updated_at();
CREATE TRIGGER trg_progress_bodyweight_touch BEFORE UPDATE ON public.progress_bodyweight
  FOR EACH ROW EXECUTE FUNCTION public.touch_progress_updated_at();
CREATE TRIGGER trg_progress_measurements_touch BEFORE UPDATE ON public.progress_measurements
  FOR EACH ROW EXECUTE FUNCTION public.touch_progress_updated_at();
CREATE TRIGGER trg_progress_schedules_touch BEFORE UPDATE ON public.progress_check_in_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_progress_updated_at();

-- Storage RLS on the existing private 'progress-media' bucket
CREATE POLICY "Owner read own progress-media objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'progress-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner upload own progress-media objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'progress-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner update own progress-media objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'progress-media' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'progress-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner delete own progress-media objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'progress-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Admin manage progress-media objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'progress-media' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'progress-media' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach read assigned progress-media objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'progress-media'
    AND public.has_role(auth.uid(), 'coach')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id::text = (storage.foldername(storage.objects.name))[1]
        AND c.assigned_coach_id = auth.uid()
    )
  );