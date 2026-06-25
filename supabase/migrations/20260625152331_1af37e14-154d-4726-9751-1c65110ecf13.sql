
-- Extend tasks (non-destructive)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS due_time time,
  ADD COLUMN IF NOT EXISTS important boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_label text,
  ADD COLUMN IF NOT EXISTS status_label text,
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS linked_content_id uuid REFERENCES public.media_content_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_asset_id uuid,
  ADD COLUMN IF NOT EXISTS recurring_rule jsonb,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS description text;

-- Subtasks
CREATE TABLE IF NOT EXISTS public.task_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_subtasks TO authenticated;
GRANT ALL ON public.task_subtasks TO service_role;
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage subtasks" ON public.task_subtasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'media_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'media_manager'));

-- Task comments
CREATE TABLE IF NOT EXISTS public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage task comments" ON public.task_comments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'media_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'media_manager'));

-- Media quick notes (DB-backed; complements existing localStorage)
CREATE TABLE IF NOT EXISTS public.media_quick_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  converted_to text,
  converted_ref_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_quick_notes TO authenticated;
GRANT ALL ON public.media_quick_notes TO service_role;
ALTER TABLE public.media_quick_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own notes" ON public.media_quick_notes FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Owner writes own notes" ON public.media_quick_notes FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner updates own notes" ON public.media_quick_notes FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner deletes own notes" ON public.media_quick_notes FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_media_quick_notes_updated_at
  BEFORE UPDATE ON public.media_quick_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Media activity events
CREATE TABLE IF NOT EXISTS public.media_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  kind text NOT NULL,
  subject_type text,
  subject_id uuid,
  summary text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.media_activity_events TO authenticated;
GRANT ALL ON public.media_activity_events TO service_role;
ALTER TABLE public.media_activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read media activity" ON public.media_activity_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'media_manager'));
CREATE POLICY "Staff insert media activity" ON public.media_activity_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'coach') OR public.has_role(auth.uid(),'media_manager'));

CREATE INDEX IF NOT EXISTS idx_media_activity_created ON public.media_activity_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_archived ON public.tasks (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_quick_notes_owner ON public.media_quick_notes (owner_id, archived, pinned DESC, updated_at DESC);
