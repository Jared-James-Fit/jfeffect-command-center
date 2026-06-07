
-- 1. Alert review acknowledgements (generic by alert_key)
CREATE TABLE public.coach_intel_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  alert_kind text NOT NULL,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (client_id, alert_key)
);
CREATE INDEX idx_intel_reviews_client ON public.coach_intel_reviews(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_intel_reviews TO authenticated;
GRANT ALL ON public.coach_intel_reviews TO service_role;
ALTER TABLE public.coach_intel_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intel_reviews_admin_all" ON public.coach_intel_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "intel_reviews_coach_all" ON public.coach_intel_reviews FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id)) WITH CHECK (public.is_assigned_coach(client_id));

-- 2. Pain flags (status tracking)
CREATE TABLE public.coach_pain_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL,            -- 'day' | 'set'
  source_id uuid NOT NULL,         -- pl_day_completions.id or pl_row_results.id
  note_text text NOT NULL,
  matched_keywords text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new', -- new | reviewed | followup | resolved | dismissed
  day_title text,
  exercise text,
  note_date timestamptz,
  updated_by uuid REFERENCES auth.users(id),
  status_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, source_id)
);
CREATE INDEX idx_pain_flags_client ON public.coach_pain_flags(client_id, status);
CREATE TRIGGER trg_pain_flags_updated BEFORE UPDATE ON public.coach_pain_flags
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_pain_flags TO authenticated;
GRANT ALL ON public.coach_pain_flags TO service_role;
ALTER TABLE public.coach_pain_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pain_flags_admin_all" ON public.coach_pain_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "pain_flags_coach_all" ON public.coach_pain_flags FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id)) WITH CHECK (public.is_assigned_coach(client_id));

-- 3. Follow-ups
CREATE TABLE public.coach_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reason text NOT NULL,
  source text,                       -- missed | pain | low_compliance | pr | event | note | manual
  due_date date,
  status text NOT NULL DEFAULT 'open', -- open | completed | dismissed
  notes text,
  created_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_followups_client ON public.coach_followups(client_id, status);
CREATE TRIGGER trg_followups_updated BEFORE UPDATE ON public.coach_followups
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_followups TO authenticated;
GRANT ALL ON public.coach_followups TO service_role;
ALTER TABLE public.coach_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "followups_admin_all" ON public.coach_followups FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "followups_coach_all" ON public.coach_followups FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id)) WITH CHECK (public.is_assigned_coach(client_id));
