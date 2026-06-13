-- 1. Soft archive + soft delete columns on weeks and days
ALTER TABLE public.pl_weeks
  ADD COLUMN IF NOT EXISTS archived    boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid;

ALTER TABLE public.pl_days
  ADD COLUMN IF NOT EXISTS archived    boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid;

CREATE INDEX IF NOT EXISTS idx_pl_weeks_block_state
  ON public.pl_weeks (block_id, archived, deleted_at);

CREATE INDEX IF NOT EXISTS idx_pl_days_week_state
  ON public.pl_days (week_id, archived, deleted_at);

-- 2. Audit + idempotency table for bulk operations
CREATE TABLE IF NOT EXISTS public.pl_bulk_operations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id    uuid NOT NULL UNIQUE,
  action          text NOT NULL,        -- duplicate | copy | archive | restore | soft_delete | restore_trash | permanent_delete
  scope           text NOT NULL,        -- 'week' | 'day'
  source_ids      uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  destination_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_ids     uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  meta            jsonb  NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id   uuid,
  status          text   NOT NULL DEFAULT 'completed', -- completed | failed | undone
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pl_bulk_ops_actor_created
  ON public.pl_bulk_operations (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pl_bulk_ops_action_created
  ON public.pl_bulk_operations (action, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.pl_bulk_operations TO authenticated;
GRANT ALL ON public.pl_bulk_operations TO service_role;

ALTER TABLE public.pl_bulk_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage pl_bulk_operations"
  ON public.pl_bulk_operations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Actor read own pl_bulk_operations"
  ON public.pl_bulk_operations
  FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid());

CREATE POLICY "Actor insert own pl_bulk_operations"
  ON public.pl_bulk_operations
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

CREATE POLICY "Actor update own pl_bulk_operations"
  ON public.pl_bulk_operations
  FOR UPDATE TO authenticated
  USING (actor_user_id = auth.uid())
  WITH CHECK (actor_user_id = auth.uid());

CREATE TRIGGER tg_pl_bulk_operations_updated
  BEFORE UPDATE ON public.pl_bulk_operations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();