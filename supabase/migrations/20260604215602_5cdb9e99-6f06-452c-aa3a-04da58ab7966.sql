
-- Singleton Drive integration settings
CREATE TABLE public.media_drive_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  root_folder_id text,
  root_folder_url text,
  root_folder_name text,
  status text NOT NULL DEFAULT 'Not Connected',
  share_uploads_with_link boolean NOT NULL DEFAULT true,
  last_test_at timestamptz,
  last_test_result text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_drive_settings TO authenticated;
GRANT ALL ON public.media_drive_settings TO service_role;
ALTER TABLE public.media_drive_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage media_drive_settings" ON public.media_drive_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER tg_media_drive_settings_updated_at BEFORE UPDATE ON public.media_drive_settings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
INSERT INTO public.media_drive_settings (singleton) VALUES (true);

-- Per-client folder records
CREATE TABLE public.client_drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE,
  folder_id text,
  folder_url text,
  folder_name text,
  subfolders jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'Not Created',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_drive_folders TO authenticated;
GRANT ALL ON public.client_drive_folders TO service_role;
ALTER TABLE public.client_drive_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage client_drive_folders" ON public.client_drive_folders FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage assigned client_drive_folders" ON public.client_drive_folders FOR ALL TO authenticated
  USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own client_drive_folders" ON public.client_drive_folders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_drive_folders.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_client_drive_folders_updated_at BEFORE UPDATE ON public.client_drive_folders FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Media submissions (parent batches)
CREATE TABLE public.media_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  submission_type text NOT NULL,
  title text,
  batch_note text,
  urgent_flag boolean NOT NULL DEFAULT false,
  pain_note text,
  status text NOT NULL DEFAULT 'Pending Review',
  clip_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_by_role text NOT NULL DEFAULT 'client',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_submissions TO authenticated;
GRANT ALL ON public.media_submissions TO service_role;
ALTER TABLE public.media_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage media_submissions" ON public.media_submissions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage assigned media_submissions" ON public.media_submissions FOR ALL TO authenticated
  USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own media_submissions" ON public.media_submissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_submissions.client_id AND c.user_id = auth.uid()));
CREATE POLICY "Client insert own media_submissions" ON public.media_submissions FOR INSERT TO authenticated
  WITH CHECK (created_by_role = 'client' AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_submissions.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_media_submissions_updated_at BEFORE UPDATE ON public.media_submissions FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_media_submissions_client ON public.media_submissions(client_id, created_at DESC);
CREATE INDEX idx_media_submissions_status ON public.media_submissions(status);

-- Individual media items
CREATE TABLE public.media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid,
  client_id uuid NOT NULL,
  media_type text NOT NULL,
  drive_file_id text,
  drive_url text,
  drive_embed_url text,
  drive_folder_id text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  duration_seconds numeric,
  thumbnail_url text,
  external_link text,
  clip_note text,
  clip_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending Review',
  urgent_flag boolean NOT NULL DEFAULT false,
  pain_note text,
  uploaded_by uuid,
  uploaded_by_role text NOT NULL DEFAULT 'client',
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_items TO authenticated;
GRANT ALL ON public.media_items TO service_role;
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage media_items" ON public.media_items FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage assigned media_items" ON public.media_items FOR ALL TO authenticated
  USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own media_items" ON public.media_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_items.client_id AND c.user_id = auth.uid()));
CREATE POLICY "Client insert own media_items" ON public.media_items FOR INSERT TO authenticated
  WITH CHECK (uploaded_by_role = 'client' AND uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_items.client_id AND c.user_id = auth.uid()));
CREATE POLICY "Client update own media_items" ON public.media_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_items.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_items.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_media_items_updated_at BEFORE UPDATE ON public.media_items FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_media_items_submission ON public.media_items(submission_id, clip_order);
CREATE INDEX idx_media_items_client ON public.media_items(client_id, created_at DESC);
CREATE INDEX idx_media_items_status ON public.media_items(status);

-- Media comments (timestamped feedback)
CREATE TABLE public.media_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_item_id uuid NOT NULL,
  client_id uuid NOT NULL,
  author_id uuid,
  author_role text NOT NULL,
  body text NOT NULL DEFAULT '',
  video_timestamp_seconds numeric,
  comment_type text NOT NULL DEFAULT 'General',
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_comments TO authenticated;
GRANT ALL ON public.media_comments TO service_role;
ALTER TABLE public.media_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage media_comments" ON public.media_comments FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Coach manage assigned media_comments" ON public.media_comments FOR ALL TO authenticated
  USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));
CREATE POLICY "Client read own non-internal media_comments" ON public.media_comments FOR SELECT TO authenticated
  USING (is_internal_note = false AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = media_comments.client_id AND c.user_id = auth.uid()));
CREATE TRIGGER tg_media_comments_updated_at BEFORE UPDATE ON public.media_comments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_media_comments_item ON public.media_comments(media_item_id, created_at);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.media_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.media_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.media_comments;
