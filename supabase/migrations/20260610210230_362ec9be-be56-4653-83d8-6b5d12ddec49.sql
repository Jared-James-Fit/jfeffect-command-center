
CREATE TABLE public.resource_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.resource_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  icon text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_folders_parent_idx ON public.resource_folders(parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_folders TO authenticated;
GRANT ALL ON public.resource_folders TO service_role;
ALTER TABLE public.resource_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rf_admin_coach_all" ON public.resource_folders FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid())) WITH CHECK (public.is_coach_or_admin(auth.uid()));
CREATE TRIGGER trg_resource_folders_updated_at BEFORE UPDATE ON public.resource_folders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid REFERENCES public.resource_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  storage_path text,
  external_url text,
  mime_type text,
  file_size bigint,
  thumbnail_path text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_text tsvector
);
CREATE INDEX resources_folder_idx ON public.resources(folder_id);
CREATE INDEX resources_search_idx ON public.resources USING GIN(search_text);
CREATE INDEX resources_tags_idx ON public.resources USING GIN(tags);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "r_admin_coach_all" ON public.resources FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid())) WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_resources_search()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.search_text :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_resources_search BEFORE INSERT OR UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.tg_resources_search();

CREATE TABLE public.resource_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_comments_resource_idx ON public.resource_comments(resource_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_comments TO authenticated;
GRANT ALL ON public.resource_comments TO service_role;
ALTER TABLE public.resource_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rc_read" ON public.resource_comments FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));
CREATE POLICY "rc_insert" ON public.resource_comments FOR INSERT TO authenticated
  WITH CHECK (public.is_coach_or_admin(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "rc_update" ON public.resource_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "rc_delete" ON public.resource_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_resource_comments_updated_at BEFORE UPDATE ON public.resource_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "resource_library_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resource-library' AND public.is_coach_or_admin(auth.uid()));
CREATE POLICY "resource_library_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resource-library' AND public.is_coach_or_admin(auth.uid()));
CREATE POLICY "resource_library_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resource-library' AND public.is_coach_or_admin(auth.uid()))
  WITH CHECK (bucket_id = 'resource-library' AND public.is_coach_or_admin(auth.uid()));
CREATE POLICY "resource_library_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resource-library' AND public.is_coach_or_admin(auth.uid()));
