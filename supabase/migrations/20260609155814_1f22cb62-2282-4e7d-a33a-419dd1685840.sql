
-- =====================================================================
-- RECIPES
-- =====================================================================
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL DEFAULT 'Breakfast',
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Published','Archived')),
  access_scope text NOT NULL DEFAULT 'hidden' CHECK (access_scope IN ('everyone','coaching_clients','app_members','program_members','selected_clients','hidden')),
  body text NOT NULL DEFAULT '',
  video_url text,
  tags text[] NOT NULL DEFAULT '{}',
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_recipes_status ON public.recipes(status);
CREATE INDEX idx_recipes_category ON public.recipes(category);

CREATE TRIGGER tg_recipes_set_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- selected clients
CREATE TABLE public.recipe_client_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_client_access TO authenticated;
GRANT ALL ON public.recipe_client_access TO service_role;
ALTER TABLE public.recipe_client_access ENABLE ROW LEVEL SECURITY;

-- notifications/seen tracking
CREATE TABLE public.recipe_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_notifications TO authenticated;
GRANT ALL ON public.recipe_notifications TO service_role;
ALTER TABLE public.recipe_notifications ENABLE ROW LEVEL SECURITY;

-- Helper: can the given user see the given recipe?
CREATE OR REPLACE FUNCTION public.user_can_see_recipe(_user_id uuid, _recipe_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recipes r
    WHERE r.id = _recipe_id
      AND r.status = 'Published'
      AND (
        r.access_scope = 'everyone'
        OR (r.access_scope = 'coaching_clients' AND EXISTS (
              SELECT 1 FROM public.clients c
               WHERE c.user_id = _user_id AND c.archived = false AND c.status = 'Active'))
        OR (r.access_scope = 'app_members' AND EXISTS (
              SELECT 1 FROM public.app_members m
               WHERE m.user_id = _user_id AND m.status = 'Active' AND m.account_type = 'app_member'))
        OR (r.access_scope = 'program_members' AND EXISTS (
              SELECT 1 FROM public.app_members m
               WHERE m.user_id = _user_id AND m.status = 'Active' AND m.account_type = 'program_only'))
        OR (r.access_scope = 'selected_clients' AND EXISTS (
              SELECT 1 FROM public.recipe_client_access rca
              JOIN public.clients c ON c.id = rca.client_id
              WHERE rca.recipe_id = r.id AND c.user_id = _user_id))
      )
  )
$$;

-- Recipes RLS
CREATE POLICY "Admins manage recipes" ON public.recipes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL);

CREATE POLICY "Users read recipes they can see" ON public.recipes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.current_coach_id() IS NOT NULL
    OR public.user_can_see_recipe(auth.uid(), id)
  );

-- Recipe access list RLS
CREATE POLICY "Admins manage recipe access" ON public.recipe_client_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL);

CREATE POLICY "Clients can see their own access rows" ON public.recipe_client_access
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  );

-- Recipe notifications RLS
CREATE POLICY "Users manage their own recipe notifications" ON public.recipe_notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins read recipe notifications" ON public.recipe_notifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL);

-- =====================================================================
-- BROADCASTS
-- =====================================================================
CREATE TABLE public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL DEFAULT 'Message' CHECK (type IN ('Message','Quote','Voice Message','Video','Reminder','Update','Link')),
  body text NOT NULL DEFAULT '',
  voice_path text,
  voice_url text,
  transcript text,
  video_url text,
  video_path text,
  link_url text,
  link_label text,
  audience_scope text NOT NULL DEFAULT 'everyone' CHECK (audience_scope IN ('everyone','coaching_clients','app_members','program_members','selected_clients')),
  publish_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Scheduled','Active','Archived')),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_broadcasts_status ON public.broadcasts(status);
CREATE INDEX idx_broadcasts_publish_at ON public.broadcasts(publish_at);

CREATE TRIGGER tg_broadcasts_set_updated_at
  BEFORE UPDATE ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcast_recipients TO service_role;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.broadcast_seen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  got_it_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_seen TO authenticated;
GRANT ALL ON public.broadcast_seen TO service_role;
ALTER TABLE public.broadcast_seen ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_can_see_broadcast(_user_id uuid, _broadcast_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.broadcasts b
    WHERE b.id = _broadcast_id
      AND b.status IN ('Active','Scheduled','Archived')
      AND (
        b.audience_scope = 'everyone'
        OR (b.audience_scope = 'coaching_clients' AND EXISTS (
              SELECT 1 FROM public.clients c
               WHERE c.user_id = _user_id AND c.archived = false AND c.status = 'Active'))
        OR (b.audience_scope = 'app_members' AND EXISTS (
              SELECT 1 FROM public.app_members m
               WHERE m.user_id = _user_id AND m.status = 'Active' AND m.account_type = 'app_member'))
        OR (b.audience_scope = 'program_members' AND EXISTS (
              SELECT 1 FROM public.app_members m
               WHERE m.user_id = _user_id AND m.status = 'Active' AND m.account_type = 'program_only'))
        OR (b.audience_scope = 'selected_clients' AND EXISTS (
              SELECT 1 FROM public.broadcast_recipients br
              JOIN public.clients c ON c.id = br.client_id
              WHERE br.broadcast_id = b.id AND c.user_id = _user_id))
      )
  )
$$;

-- Broadcasts RLS
CREATE POLICY "Admins manage broadcasts" ON public.broadcasts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL);

CREATE POLICY "Users read broadcasts they can see" ON public.broadcasts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.current_coach_id() IS NOT NULL
    OR public.user_can_see_broadcast(auth.uid(), id)
  );

CREATE POLICY "Admins manage broadcast recipients" ON public.broadcast_recipients
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL);

CREATE POLICY "Clients see their broadcast recipient rows" ON public.broadcast_recipients
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

CREATE POLICY "Users manage their own seen rows" ON public.broadcast_seen
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins read broadcast seen" ON public.broadcast_seen
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL);

-- =====================================================================
-- Storage policies for broadcast-media bucket
-- =====================================================================
CREATE POLICY "Admins/coaches upload broadcast media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'broadcast-media'
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  );

CREATE POLICY "Admins/coaches update broadcast media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'broadcast-media'
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  );

CREATE POLICY "Admins/coaches delete broadcast media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'broadcast-media'
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.current_coach_id() IS NOT NULL)
  );

CREATE POLICY "Authenticated read broadcast media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'broadcast-media');
