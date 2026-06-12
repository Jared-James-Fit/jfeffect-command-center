
-- Helper: admin or media_manager
CREATE OR REPLACE FUNCTION public.is_admin_or_media_manager(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'admin'::app_role)
      OR public.has_role(_uid, 'media_manager'::app_role)
$$;

-- ============ media_resource_folders ============
CREATE TABLE public.media_resource_folders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id uuid REFERENCES public.media_resource_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_resource_folders_parent_idx ON public.media_resource_folders(parent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_resource_folders TO authenticated;
GRANT ALL ON public.media_resource_folders TO service_role;
ALTER TABLE public.media_resource_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mrf_admin_media_all" ON public.media_resource_folders
  TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));
CREATE TRIGGER trg_media_resource_folders_updated_at
  BEFORE UPDATE ON public.media_resource_folders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ media_resources ============
CREATE TABLE public.media_resources (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_id uuid REFERENCES public.media_resource_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
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
CREATE INDEX media_resources_folder_idx ON public.media_resources(folder_id);
CREATE INDEX media_resources_search_idx ON public.media_resources USING gin(search_text);
CREATE INDEX media_resources_tags_idx ON public.media_resources USING gin(tags);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_resources TO authenticated;
GRANT ALL ON public.media_resources TO service_role;
ALTER TABLE public.media_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mr_admin_media_all" ON public.media_resources
  TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()))
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_media_resources_search()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.search_text :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_media_resources_search
  BEFORE INSERT OR UPDATE ON public.media_resources
  FOR EACH ROW EXECUTE FUNCTION public.tg_media_resources_search();

-- ============ media_resource_comments ============
CREATE TABLE public.media_resource_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES public.media_resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_resource_comments_resource_idx ON public.media_resource_comments(resource_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_resource_comments TO authenticated;
GRANT ALL ON public.media_resource_comments TO service_role;
ALTER TABLE public.media_resource_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mrc_read" ON public.media_resource_comments FOR SELECT TO authenticated
  USING (public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "mrc_insert" ON public.media_resource_comments FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_media_manager(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "mrc_update" ON public.media_resource_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "mrc_delete" ON public.media_resource_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_media_resource_comments_updated_at
  BEFORE UPDATE ON public.media_resource_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ Storage policies on media-resource-library ============
CREATE POLICY "media_resource_library_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media-resource-library' AND public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_resource_library_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media-resource-library' AND public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_resource_library_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media-resource-library' AND public.is_admin_or_media_manager(auth.uid()))
  WITH CHECK (bucket_id = 'media-resource-library' AND public.is_admin_or_media_manager(auth.uid()));
CREATE POLICY "media_resource_library_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media-resource-library' AND public.is_admin_or_media_manager(auth.uid()));
