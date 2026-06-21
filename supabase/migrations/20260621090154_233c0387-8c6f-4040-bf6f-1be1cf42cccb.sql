CREATE TABLE IF NOT EXISTS public.cardio_completions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cardio_target_id    UUID        REFERENCES public.cardio_targets(id) ON DELETE SET NULL,
  client_id           UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  completed_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
  completed           BOOLEAN     NOT NULL DEFAULT TRUE,
  duration_minutes    INTEGER,
  cardio_type         TEXT,
  rpe                 NUMERIC(3,1),
  notes               TEXT,
  day_type            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_completions TO authenticated;
GRANT ALL ON public.cardio_completions TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cardio_completions_target_date
  ON public.cardio_completions(client_id, cardio_target_id, completed_date)
  WHERE cardio_target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cardio_completions_client_date
  ON public.cardio_completions(client_id, completed_date DESC);

CREATE INDEX IF NOT EXISTS idx_cardio_completions_target_id
  ON public.cardio_completions(cardio_target_id)
  WHERE cardio_target_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_cardio_completions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cardio_completions_updated_at ON public.cardio_completions;
CREATE TRIGGER trg_cardio_completions_updated_at
  BEFORE UPDATE ON public.cardio_completions
  FOR EACH ROW EXECUTE FUNCTION public.update_cardio_completions_updated_at();

ALTER TABLE public.cardio_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_coach_cardio_completions" ON public.cardio_completions;
CREATE POLICY "admin_coach_cardio_completions"
  ON public.cardio_completions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'coach'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'coach'::public.app_role));

DROP POLICY IF EXISTS "client_own_cardio_completions" ON public.cardio_completions;
CREATE POLICY "client_own_cardio_completions"
  ON public.cardio_completions FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()))
  WITH CHECK (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));

COMMENT ON TABLE public.cardio_completions IS
  'Tracks client cardio completion per day. Links to cardio_targets for context.';