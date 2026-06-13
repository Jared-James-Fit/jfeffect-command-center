
-- =========================================================================
-- AI Coaching Review Layer — additive migration
-- =========================================================================

-- ---------- 1. global_ai_config (singleton) ------------------------------
CREATE TABLE public.global_ai_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  brand_voice text,
  tone text,
  safety_rules text,
  prohibited_phrases text[] NOT NULL DEFAULT ARRAY[]::text[],
  escalation_rules text,
  default_analysis_structure text,
  default_response_structure text,
  default_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_ai_config_singleton_uniq UNIQUE (singleton)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.global_ai_config TO authenticated;
GRANT ALL ON public.global_ai_config TO service_role;

ALTER TABLE public.global_ai_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "global_ai_config admin all"
  ON public.global_ai_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "global_ai_config coach read"
  ON public.global_ai_config FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

CREATE TRIGGER global_ai_config_touch
  BEFORE UPDATE ON public.global_ai_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed one row so the playground/admin UI always has something to load.
INSERT INTO public.global_ai_config (singleton, brand_voice, tone, default_analysis_structure, default_response_structure)
VALUES (
  true,
  'Direct, evidence-based, encouraging. Speak like a coach who actually trains, not a hype account.',
  'Warm but professional. Short paragraphs. No emojis unless the client used them first.',
  'summary -> wins -> concerns -> risks -> recommendations -> follow_up_questions -> suggested_actions -> urgency',
  'Acknowledge -> address the biggest concern -> give 1-3 specific actions -> ask one follow-up question.'
);

-- ---------- 2. form_ai_configs (per nf_forms) ----------------------------
CREATE TABLE public.form_ai_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.nf_forms(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  instructions text,
  allowed_client_context text[] NOT NULL DEFAULT ARRAY[
    'goal','current_program','current_week','phase','bodyweight_trend',
    'calorie_target','macro_targets','cardio_target','adherence',
    'prior_check_in','unresolved_notes','injuries'
  ]::text[],
  response_tone text,
  response_length text NOT NULL DEFAULT 'medium' CHECK (response_length IN ('short','medium','long')),
  internal_analysis_structure text,
  client_response_structure text,
  escalation_rules text,
  priority_rules text,
  allow_recommend_programming boolean NOT NULL DEFAULT false,
  allow_recommend_nutrition boolean NOT NULL DEFAULT false,
  require_coach_approval boolean NOT NULL DEFAULT true,
  default_assigned_coach uuid,
  review_sla_hours integer,
  model text,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_ai_configs_form_uniq UNIQUE (form_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_ai_configs TO authenticated;
GRANT ALL ON public.form_ai_configs TO service_role;

ALTER TABLE public.form_ai_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_ai_configs admin all"
  ON public.form_ai_configs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "form_ai_configs coach read"
  ON public.form_ai_configs FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

CREATE TRIGGER form_ai_configs_touch
  BEFORE UPDATE ON public.form_ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- 3. submission_reviews (unified review queue) -----------------
CREATE TABLE public.submission_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source linkage (multi-table). Not a hard FK so we can point at any of:
  --   'native'      -> public.nf_submissions.id
  --   'fillout'     -> public.fillout_submissions.id
  --   'application' -> public.coaching_applications.id
  source_type text NOT NULL CHECK (source_type IN ('native','fillout','application')),
  source_id uuid NOT NULL,

  form_id uuid REFERENCES public.nf_forms(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  application_id uuid,  -- soft link to coaching_applications when source_type='application'

  assigned_coach_user_id uuid,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),

  -- Status fields
  review_status text NOT NULL DEFAULT 'submitted'
    CHECK (review_status IN ('submitted','processing','needs_review','draft_ready','coach_editing','approved','scheduled','sending','sent','delivery_failed','archived')),
  ai_status text NOT NULL DEFAULT 'pending'
    CHECK (ai_status IN ('pending','processing','ready','failed','skipped')),

  -- Generation + delivery pointers
  latest_generation_id uuid,
  latest_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,

  -- Coach-edited client-facing draft (never overwritten by regeneration)
  coach_draft text,
  approved_response text,
  delivered_response text,

  -- Schedule
  scheduled_at timestamptz,
  scheduled_by uuid,
  schedule_cancelled_at timestamptz,

  -- Send metadata
  approved_at timestamptz,
  approved_by uuid,
  sent_at timestamptz,
  sent_by uuid,
  last_delivery_error text,

  -- Idempotency
  send_idempotency_key text,

  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT submission_reviews_source_uniq UNIQUE (source_type, source_id)
);

CREATE INDEX submission_reviews_status_idx ON public.submission_reviews (review_status, submitted_at DESC);
CREATE INDEX submission_reviews_client_idx ON public.submission_reviews (client_id, submitted_at DESC);
CREATE INDEX submission_reviews_coach_idx  ON public.submission_reviews (assigned_coach_user_id, submitted_at DESC);
CREATE INDEX submission_reviews_form_idx   ON public.submission_reviews (form_id, submitted_at DESC);
CREATE INDEX submission_reviews_sched_idx  ON public.submission_reviews (scheduled_at)
  WHERE scheduled_at IS NOT NULL AND review_status IN ('scheduled','approved');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.submission_reviews TO authenticated;
GRANT ALL ON public.submission_reviews TO service_role;

ALTER TABLE public.submission_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submission_reviews admin all"
  ON public.submission_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "submission_reviews coach read assigned"
  ON public.submission_reviews FOR SELECT TO authenticated
  USING (
    public.is_coach_or_admin(auth.uid())
    AND (
      client_id IS NULL
      OR public.is_assigned_coach(client_id)
    )
  );

CREATE POLICY "submission_reviews coach update assigned"
  ON public.submission_reviews FOR UPDATE TO authenticated
  USING (
    public.is_coach_or_admin(auth.uid())
    AND client_id IS NOT NULL
    AND public.is_assigned_coach(client_id)
  )
  WITH CHECK (
    public.is_coach_or_admin(auth.uid())
    AND client_id IS NOT NULL
    AND public.is_assigned_coach(client_id)
  );

CREATE TRIGGER submission_reviews_touch
  BEFORE UPDATE ON public.submission_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- 4. submission_ai_generations (history) -----------------------
CREATE TABLE public.submission_ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.submission_reviews(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  model text,

  global_config_version integer,
  form_config_version integer,
  submission_instruction text,

  input_context jsonb,
  structured_output jsonb,
  client_response text,
  urgency text,

  error text,
  usage jsonb,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX submission_ai_generations_review_idx
  ON public.submission_ai_generations (review_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.submission_ai_generations TO authenticated;
GRANT ALL ON public.submission_ai_generations TO service_role;

ALTER TABLE public.submission_ai_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submission_ai_generations admin all"
  ON public.submission_ai_generations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "submission_ai_generations coach read assigned"
  ON public.submission_ai_generations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.submission_reviews r
      WHERE r.id = submission_ai_generations.review_id
        AND public.is_coach_or_admin(auth.uid())
        AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))
    )
  );

-- Coaches do not insert generations directly; the server function does that
-- through service_role / a SECURITY DEFINER server fn. No coach INSERT policy.

-- ---------- 5. scheduled_submission_responses ----------------------------
CREATE TABLE public.scheduled_submission_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.submission_reviews(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','cancelled','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  idempotency_key text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_responses_idem_uniq UNIQUE (idempotency_key)
);

CREATE INDEX scheduled_responses_due_idx
  ON public.scheduled_submission_responses (status, scheduled_at)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_submission_responses TO authenticated;
GRANT ALL ON public.scheduled_submission_responses TO service_role;

ALTER TABLE public.scheduled_submission_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_responses admin all"
  ON public.scheduled_submission_responses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "scheduled_responses coach read"
  ON public.scheduled_submission_responses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.submission_reviews r
      WHERE r.id = scheduled_submission_responses.review_id
        AND public.is_coach_or_admin(auth.uid())
        AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))
    )
  );

CREATE TRIGGER scheduled_responses_touch
  BEFORE UPDATE ON public.scheduled_submission_responses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- 6. submission_delivery_attempts ------------------------------
CREATE TABLE public.submission_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.submission_reviews(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.scheduled_submission_responses(id) ON DELETE SET NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('success','failed','skipped_duplicate')),
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  error text,
  initiated_by uuid,
  delivery_channel text NOT NULL DEFAULT 'in_app_message'
);

CREATE INDEX delivery_attempts_review_idx
  ON public.submission_delivery_attempts (review_id, attempted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.submission_delivery_attempts TO authenticated;
GRANT ALL ON public.submission_delivery_attempts TO service_role;

ALTER TABLE public.submission_delivery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_attempts admin all"
  ON public.submission_delivery_attempts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "delivery_attempts coach read"
  ON public.submission_delivery_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.submission_reviews r
      WHERE r.id = submission_delivery_attempts.review_id
        AND public.is_coach_or_admin(auth.uid())
        AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))
    )
  );

-- ---------- 7. submission_audit_events -----------------------------------
CREATE TABLE public.submission_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.submission_reviews(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid,
  actor_role text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX submission_audit_events_review_idx
  ON public.submission_audit_events (review_id, created_at DESC);

GRANT SELECT, INSERT ON public.submission_audit_events TO authenticated;
GRANT ALL ON public.submission_audit_events TO service_role;

ALTER TABLE public.submission_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events admin all"
  ON public.submission_audit_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "audit_events coach read"
  ON public.submission_audit_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.submission_reviews r
      WHERE r.id = submission_audit_events.review_id
        AND public.is_coach_or_admin(auth.uid())
        AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))
    )
  );

CREATE POLICY "audit_events coach insert"
  ON public.submission_audit_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.submission_reviews r
      WHERE r.id = submission_audit_events.review_id
        AND public.is_coach_or_admin(auth.uid())
        AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))
    )
  );
