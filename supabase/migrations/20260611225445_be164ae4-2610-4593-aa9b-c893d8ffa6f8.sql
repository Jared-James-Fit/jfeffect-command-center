ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'admin';
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_scope_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_scope_check CHECK (scope IN ('admin','media'));
CREATE INDEX IF NOT EXISTS tasks_scope_status_idx ON public.tasks (scope, status, position);