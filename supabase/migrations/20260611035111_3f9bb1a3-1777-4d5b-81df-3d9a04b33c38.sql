
-- ============================================================
-- WARM-UP PROTOCOLS
-- ============================================================
CREATE TABLE public.warmup_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  target_lift text,
  estimated_minutes int,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  internal_notes text,
  visible_to_client boolean NOT NULL DEFAULT true,
  is_default_general boolean NOT NULL DEFAULT false,
  is_default_powerlifting boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warmup_protocols TO authenticated;
GRANT ALL ON public.warmup_protocols TO service_role;

ALTER TABLE public.warmup_protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warmup_protocols_admin_coach_all"
ON public.warmup_protocols
FOR ALL
TO authenticated
USING (public.is_coach_or_admin(auth.uid()))
WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "warmup_protocols_client_read_visible"
ON public.warmup_protocols
FOR SELECT
TO authenticated
USING (
  archived = false
  AND (visible_to_client = true OR is_default_general = true OR is_default_powerlifting = true)
);

CREATE TRIGGER trg_warmup_protocols_updated_at
BEFORE UPDATE ON public.warmup_protocols
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_warmup_protocols_category ON public.warmup_protocols(category) WHERE archived = false;
CREATE INDEX idx_warmup_protocols_defaults ON public.warmup_protocols(is_default_general, is_default_powerlifting) WHERE archived = false;

-- ============================================================
-- WARM-UP ASSIGNMENTS (multi-scope)
-- ============================================================
CREATE TABLE public.warmup_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES public.warmup_protocols(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('exercise','pl_day','pl_block','client')),
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE CASCADE,
  pl_day_id uuid REFERENCES public.pl_days(id) ON DELETE CASCADE,
  pl_block_id uuid REFERENCES public.pl_blocks(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warmup_assignments TO authenticated;
GRANT ALL ON public.warmup_assignments TO service_role;

ALTER TABLE public.warmup_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warmup_assignments_admin_coach_all"
ON public.warmup_assignments
FOR ALL
TO authenticated
USING (public.is_coach_or_admin(auth.uid()))
WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "warmup_assignments_client_read_own"
ON public.warmup_assignments
FOR SELECT
TO authenticated
USING (
  -- client-scope: matches their own client row
  (scope = 'client' AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = warmup_assignments.client_id AND c.user_id = auth.uid()
  ))
  OR
  -- block-scope: client owns the block
  (scope = 'pl_block' AND EXISTS (
    SELECT 1 FROM public.pl_blocks b
    JOIN public.clients c ON c.id = b.client_id
    WHERE b.id = warmup_assignments.pl_block_id AND c.user_id = auth.uid()
  ))
  OR
  -- day-scope: client owns the parent block
  (scope = 'pl_day' AND EXISTS (
    SELECT 1 FROM public.pl_days d
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    JOIN public.clients c ON c.id = b.client_id
    WHERE d.id = warmup_assignments.pl_day_id AND c.user_id = auth.uid()
  ))
  OR
  -- exercise-scope: visible to any authenticated client (exercise library is shared)
  (scope = 'exercise')
);

CREATE TRIGGER trg_warmup_assignments_updated_at
BEFORE UPDATE ON public.warmup_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_warmup_assignments_protocol ON public.warmup_assignments(protocol_id);
CREATE INDEX idx_warmup_assignments_exercise ON public.warmup_assignments(exercise_id) WHERE exercise_id IS NOT NULL;
CREATE INDEX idx_warmup_assignments_day ON public.warmup_assignments(pl_day_id) WHERE pl_day_id IS NOT NULL;
CREATE INDEX idx_warmup_assignments_block ON public.warmup_assignments(pl_block_id) WHERE pl_block_id IS NOT NULL;
CREATE INDEX idx_warmup_assignments_client ON public.warmup_assignments(client_id) WHERE client_id IS NOT NULL;

-- ============================================================
-- Column additions
-- ============================================================
ALTER TABLE public.pl_days
  ADD COLUMN IF NOT EXISTS warmup_mode text NOT NULL DEFAULT 'auto' CHECK (warmup_mode IN ('auto','general','powerlifting','custom','none')),
  ADD COLUMN IF NOT EXISTS warmup_protocol_id uuid REFERENCES public.warmup_protocols(id) ON DELETE SET NULL;

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS warmup_notes text,
  ADD COLUMN IF NOT EXISTS warmup_protocol_id uuid REFERENCES public.warmup_protocols(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_powerlifting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pl_lift_group text CHECK (pl_lift_group IN ('squat','bench','deadlift'));

ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS warmup_protocol_id uuid REFERENCES public.warmup_protocols(id) ON DELETE SET NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS warmup_protocol_id uuid REFERENCES public.warmup_protocols(id) ON DELETE SET NULL;
