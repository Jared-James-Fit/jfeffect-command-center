-- ============================================================
-- Migration: Add cardio_completions table
-- Purpose: Track when clients/members complete their assigned cardio.
--          Links to cardio_targets for context.
--          Preserves all existing cardio history.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cardio_completions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Link to the assigned cardio target (optional — allows free-form logging)
  cardio_target_id    UUID        REFERENCES public.cardio_targets(id) ON DELETE SET NULL,
  client_id           UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Date this cardio was completed (local date, not UTC)
  completed_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
  -- Completion details
  completed           BOOLEAN     NOT NULL DEFAULT TRUE,
  duration_minutes    INTEGER,
  cardio_type         TEXT,         -- e.g. "Walking", "Cycling", "LISS", "HIIT"
  rpe                 NUMERIC(3,1), -- 1-10
  notes               TEXT,
  -- Day context
  day_type            TEXT,         -- "Training Day", "Rest Day", "General"
  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one completion per target per date (idempotent logging)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cardio_completions_target_date
  ON public.cardio_completions(client_id, cardio_target_id, completed_date)
  WHERE cardio_target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cardio_completions_client_date
  ON public.cardio_completions(client_id, completed_date DESC);

CREATE INDEX IF NOT EXISTS idx_cardio_completions_target_id
  ON public.cardio_completions(cardio_target_id)
  WHERE cardio_target_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_cardio_completions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cardio_completions_updated_at ON public.cardio_completions;
CREATE TRIGGER trg_cardio_completions_updated_at
  BEFORE UPDATE ON public.cardio_completions
  FOR EACH ROW EXECUTE FUNCTION update_cardio_completions_updated_at();

-- RLS
ALTER TABLE public.cardio_completions ENABLE ROW LEVEL SECURITY;

-- Admin/coach: full access
CREATE POLICY "admin_coach_cardio_completions"
  ON public.cardio_completions FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'coach')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'coach')
  ));

-- Client: can read/write their own completions
CREATE POLICY "client_own_cardio_completions"
  ON public.cardio_completions FOR ALL TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.cardio_completions IS
  'Tracks client cardio completion per day. Links to cardio_targets for context.';
