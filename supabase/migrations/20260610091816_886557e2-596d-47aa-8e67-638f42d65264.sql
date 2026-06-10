
CREATE TYPE public.task_quadrant AS ENUM ('do','schedule','delegate','eliminate');
CREATE TYPE public.task_status AS ENUM ('open','done');

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text,
  quadrant public.task_quadrant NOT NULL DEFAULT 'do',
  status public.task_status NOT NULL DEFAULT 'open',
  priority int NOT NULL DEFAULT 0,
  due_at timestamptz,
  created_by uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_status_idx ON public.tasks(status);
CREATE INDEX tasks_assigned_to_idx ON public.tasks(assigned_to);
CREATE INDEX tasks_quadrant_idx ON public.tasks(quadrant);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_admins_select_tasks" ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "coaches_admins_insert_tasks" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "coaches_admins_update_tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "coaches_admins_delete_tasks" ON public.tasks
  FOR DELETE TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
