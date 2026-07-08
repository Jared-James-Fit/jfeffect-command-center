-- 1. Permission column on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS workout_scheduling_permission text NOT NULL DEFAULT 'move';

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_workout_scheduling_permission_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_workout_scheduling_permission_check
  CHECK (workout_scheduling_permission IN ('off','move','add_current_block','full_program'));

-- 2. pl_scheduled_workouts (the scheduling layer)
CREATE TABLE IF NOT EXISTS public.pl_scheduled_workouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_day_id    uuid NOT NULL REFERENCES public.pl_days(id) ON DELETE CASCADE,
  scheduled_date   date NOT NULL,
  scheduled_time   time NULL,
  order_index      integer NOT NULL DEFAULT 0,
  schedule_source  text NOT NULL DEFAULT 'manual',
  created_by       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  original_date    date NULL,
  note             text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pl_scheduled_workouts_source_check
    CHECK (schedule_source IN ('program','manual','moved','copied'))
);

CREATE INDEX IF NOT EXISTS pl_scheduled_workouts_client_date_idx
  ON public.pl_scheduled_workouts (client_id, scheduled_date);
CREATE INDEX IF NOT EXISTS pl_scheduled_workouts_source_day_idx
  ON public.pl_scheduled_workouts (source_day_id);
CREATE UNIQUE INDEX IF NOT EXISTS pl_scheduled_workouts_unique_instance
  ON public.pl_scheduled_workouts (client_id, source_day_id, scheduled_date, order_index);

-- 3. Grants (Data API access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_scheduled_workouts TO authenticated;
GRANT ALL ON public.pl_scheduled_workouts TO service_role;

-- 4. RLS
ALTER TABLE public.pl_scheduled_workouts ENABLE ROW LEVEL SECURITY;

-- Client can read own rows
CREATE POLICY "Client reads own scheduled workouts"
  ON public.pl_scheduled_workouts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = pl_scheduled_workouts.client_id
        AND c.user_id = auth.uid()
    )
  );

-- Client can move/re-time/reorder own rows (INSERT/DELETE restricted to admins)
CREATE POLICY "Client updates own scheduled workouts"
  ON public.pl_scheduled_workouts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = pl_scheduled_workouts.client_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = pl_scheduled_workouts.client_id
        AND c.user_id = auth.uid()
    )
  );

-- Admin/coach full access
CREATE POLICY "Admins and coaches manage scheduled workouts"
  ON public.pl_scheduled_workouts
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'coach'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'coach'::app_role)
  );

-- 5. updated_at trigger
CREATE OR REPLACE FUNCTION public.pl_scheduled_workouts_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pl_scheduled_workouts_touch ON public.pl_scheduled_workouts;
CREATE TRIGGER trg_pl_scheduled_workouts_touch
  BEFORE UPDATE ON public.pl_scheduled_workouts
  FOR EACH ROW EXECUTE FUNCTION public.pl_scheduled_workouts_touch_updated_at();

-- 6. Backfill: every pl_days row that currently has a scheduled_date becomes
-- a `program`-sourced instance so existing calendars keep working while the
-- frontend switches to reading pl_scheduled_workouts.
INSERT INTO public.pl_scheduled_workouts
  (client_id, source_day_id, scheduled_date, order_index, schedule_source, original_date)
SELECT
  b.client_id,
  d.id AS source_day_id,
  d.scheduled_date,
  0 AS order_index,
  CASE WHEN d.schedule_source = 'manual' THEN 'moved' ELSE 'program' END,
  d.scheduled_date
FROM public.pl_days d
JOIN public.pl_weeks w  ON w.id = d.week_id
JOIN public.pl_blocks b ON b.id = w.block_id
WHERE d.scheduled_date IS NOT NULL
  AND d.deleted_at IS NULL
  AND b.client_id IS NOT NULL
ON CONFLICT (client_id, source_day_id, scheduled_date, order_index) DO NOTHING;
