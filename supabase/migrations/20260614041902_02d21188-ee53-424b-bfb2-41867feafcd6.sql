
-- ============================================================
-- 1) pl_exercise_blocks  (one row per prescription block)
-- ============================================================
CREATE TABLE public.pl_exercise_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES public.pl_exercise_rows(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  block_type text NOT NULL DEFAULT 'straight',
  label text,
  sets integer,
  reps_text text,
  rpe text,
  rir text,
  load_type text,
  load_value numeric,
  load_unit text,
  reference_block_id uuid REFERENCES public.pl_exercise_blocks(id) ON DELETE SET NULL,
  rest_seconds_override integer,
  tempo text,
  amrap boolean NOT NULL DEFAULT false,
  notes text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pl_exercise_blocks_type_chk
    CHECK (block_type IN ('straight','top','backoff','ascending','drop','warmup','custom'))
);
CREATE INDEX pl_exercise_blocks_row_id_idx ON public.pl_exercise_blocks(row_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_exercise_blocks TO authenticated;
GRANT ALL ON public.pl_exercise_blocks TO service_role;
ALTER TABLE public.pl_exercise_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage pl_exercise_blocks"
ON public.pl_exercise_blocks
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage pl_exercise_blocks"
ON public.pl_exercise_blocks
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_rows r
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    WHERE r.id = pl_exercise_blocks.row_id
      AND is_assigned_coach(b.client_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_rows r
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    WHERE r.id = pl_exercise_blocks.row_id
      AND is_assigned_coach(b.client_id)
  )
);

CREATE POLICY "Client read pl_exercise_blocks"
ON public.pl_exercise_blocks
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_rows r
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    JOIN public.clients c ON c.id = b.client_id
    WHERE r.id = pl_exercise_blocks.row_id
      AND b.client_visible
      AND c.user_id = auth.uid()
  )
);

-- ============================================================
-- 2) pl_block_set_rows  (explicit rows: ascending + warm-up)
-- ============================================================
CREATE TABLE public.pl_block_set_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.pl_exercise_blocks(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  reps_text text,
  load_value numeric,
  load_unit text,
  rpe text,
  rir text,
  amrap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pl_block_set_rows_block_id_idx ON public.pl_block_set_rows(block_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_block_set_rows TO authenticated;
GRANT ALL ON public.pl_block_set_rows TO service_role;
ALTER TABLE public.pl_block_set_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage pl_block_set_rows"
ON public.pl_block_set_rows
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage pl_block_set_rows"
ON public.pl_block_set_rows
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_blocks eb
    JOIN public.pl_exercise_rows r ON r.id = eb.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    WHERE eb.id = pl_block_set_rows.block_id
      AND is_assigned_coach(b.client_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_blocks eb
    JOIN public.pl_exercise_rows r ON r.id = eb.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    WHERE eb.id = pl_block_set_rows.block_id
      AND is_assigned_coach(b.client_id)
  )
);

CREATE POLICY "Client read pl_block_set_rows"
ON public.pl_block_set_rows
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_blocks eb
    JOIN public.pl_exercise_rows r ON r.id = eb.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    JOIN public.clients c ON c.id = b.client_id
    WHERE eb.id = pl_block_set_rows.block_id
      AND b.client_visible
      AND c.user_id = auth.uid()
  )
);

-- ============================================================
-- 3) pl_block_drop_stages  (drop-set stages after initial set)
-- ============================================================
CREATE TABLE public.pl_block_drop_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.pl_exercise_blocks(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  reduction_type text,
  reduction_value numeric,
  reps_text text,
  rpe text,
  rir text,
  amrap boolean NOT NULL DEFAULT false,
  rest_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pl_block_drop_stages_block_id_idx ON public.pl_block_drop_stages(block_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_block_drop_stages TO authenticated;
GRANT ALL ON public.pl_block_drop_stages TO service_role;
ALTER TABLE public.pl_block_drop_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage pl_block_drop_stages"
ON public.pl_block_drop_stages
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage pl_block_drop_stages"
ON public.pl_block_drop_stages
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_blocks eb
    JOIN public.pl_exercise_rows r ON r.id = eb.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    WHERE eb.id = pl_block_drop_stages.block_id
      AND is_assigned_coach(b.client_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_blocks eb
    JOIN public.pl_exercise_rows r ON r.id = eb.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    WHERE eb.id = pl_block_drop_stages.block_id
      AND is_assigned_coach(b.client_id)
  )
);

CREATE POLICY "Client read pl_block_drop_stages"
ON public.pl_block_drop_stages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pl_exercise_blocks eb
    JOIN public.pl_exercise_rows r ON r.id = eb.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    JOIN public.clients c ON c.id = b.client_id
    WHERE eb.id = pl_block_drop_stages.block_id
      AND b.client_visible
      AND c.user_id = auth.uid()
  )
);

-- ============================================================
-- 4) Add per-set log linkage on member_set_logs (nullable, non-breaking)
-- ============================================================
ALTER TABLE public.member_set_logs
  ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES public.pl_exercise_blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS set_row_id uuid REFERENCES public.pl_block_set_rows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drop_stage_id uuid REFERENCES public.pl_block_drop_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS member_set_logs_block_id_idx ON public.member_set_logs(block_id);

-- ============================================================
-- 5) updated_at triggers (reuse existing helper)
-- ============================================================
CREATE TRIGGER trg_pl_exercise_blocks_updated_at
  BEFORE UPDATE ON public.pl_exercise_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_pl_block_set_rows_updated_at
  BEFORE UPDATE ON public.pl_block_set_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_pl_block_drop_stages_updated_at
  BEFORE UPDATE ON public.pl_block_drop_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 6) Backfill: every existing exercise row → one Straight Sets block
--    populated from current sets / reps_text / rpe / rir / load / rest / tempo.
--    Uses inserted timestamp ordering keyed by row.id so it's idempotent
--    for rows that already have a block from a partial replay (skipped).
-- ============================================================
INSERT INTO public.pl_exercise_blocks (
  row_id, sort_order, block_type, label,
  sets, reps_text, rpe, rir,
  load_type, load_value, load_unit,
  rest_seconds_override, tempo, amrap, notes
)
SELECT
  r.id,
  0,
  'straight',
  'Straight Sets',
  r.sets,
  r.reps_text,
  r.rpe,
  r.rir,
  CASE
    WHEN r.percentage IS NOT NULL THEN 'pct_1rm'
    WHEN r.load_kg IS NOT NULL OR r.load_lb IS NOT NULL THEN 'fixed'
    ELSE 'none'
  END,
  COALESCE(
    r.percentage,
    CASE WHEN COALESCE(r.load_unit,'') = 'kg' THEN r.load_kg ELSE r.load_lb END,
    r.load_kg,
    r.load_lb
  ),
  CASE
    WHEN r.percentage IS NOT NULL THEN '%'
    WHEN COALESCE(r.load_unit,'') <> '' THEN r.load_unit
    WHEN r.load_kg IS NOT NULL THEN 'kg'
    WHEN r.load_lb IS NOT NULL THEN 'lb'
    ELSE NULL
  END,
  r.rest_seconds_override,
  r.tempo,
  false,
  NULL
FROM public.pl_exercise_rows r
WHERE NOT EXISTS (
  SELECT 1 FROM public.pl_exercise_blocks b WHERE b.row_id = r.id
);
