
-- ============ lift_videos ============
CREATE TABLE public.lift_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  uploaded_by uuid,
  exercise text NOT NULL DEFAULT '',
  training_day text,
  custom_training_day text,
  program_day text,
  phase_id uuid,
  important_date_id uuid,
  date_performed date,
  set_number integer,
  reps integer,
  load_text text,
  rpe numeric(3,1),
  client_notes text,
  question_for_coach text,
  tag text NOT NULL DEFAULT 'Normal Review',
  custom_tag text,
  is_urgent boolean NOT NULL DEFAULT false,
  video_url text,
  video_storage_path text,
  video_source text NOT NULL DEFAULT 'link',
  thumbnail_url text,
  status text NOT NULL DEFAULT 'New Upload',
  watched_at timestamptz,
  watched_by uuid,
  liked_at timestamptz,
  liked_by uuid,
  reviewed_at timestamptz,
  reviewed_by uuid,
  client_last_viewed_at timestamptz,
  admin_last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lift_videos TO authenticated;
GRANT ALL ON public.lift_videos TO service_role;

ALTER TABLE public.lift_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage lift_videos" ON public.lift_videos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Client read own lift_videos" ON public.lift_videos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = lift_videos.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client insert own lift_videos" ON public.lift_videos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = lift_videos.client_id AND c.user_id = auth.uid())
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Client update own lift_videos" ON public.lift_videos
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = lift_videos.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = lift_videos.client_id AND c.user_id = auth.uid()));

CREATE TRIGGER tg_lift_videos_updated_at BEFORE UPDATE ON public.lift_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_lift_videos_client ON public.lift_videos(client_id, created_at DESC);
CREATE INDEX idx_lift_videos_status ON public.lift_videos(status);

ALTER PUBLICATION supabase_realtime ADD TABLE public.lift_videos;

-- ============ lift_video_comments ============
CREATE TABLE public.lift_video_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL,
  client_id uuid NOT NULL,
  author_id uuid,
  author_role text NOT NULL,
  body text NOT NULL DEFAULT '',
  video_timestamp_seconds numeric,
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lift_video_comments TO authenticated;
GRANT ALL ON public.lift_video_comments TO service_role;

ALTER TABLE public.lift_video_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage lift_video_comments" ON public.lift_video_comments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Client read own video comments" ON public.lift_video_comments
  FOR SELECT TO authenticated
  USING (
    is_internal_note = false
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = lift_video_comments.client_id AND c.user_id = auth.uid())
  );

CREATE TRIGGER tg_lift_video_comments_updated_at BEFORE UPDATE ON public.lift_video_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_lift_comments_video ON public.lift_video_comments(video_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.lift_video_comments;
