-- member_payment_ledger
CREATE TABLE IF NOT EXISTS public.member_payment_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_cents INT,
  currency TEXT NOT NULL DEFAULT 'usd',
  service_product TEXT,
  payment_method TEXT,
  stripe_payment_id TEXT,
  stripe_invoice_id TEXT,
  manual_note TEXT,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  access_granted BOOLEAN NOT NULL DEFAULT FALSE,
  access_start_date TIMESTAMPTZ,
  access_end_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid','failed','refunded','comped','manual','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_payment_ledger TO authenticated;
GRANT ALL ON public.member_payment_ledger TO service_role;
CREATE INDEX IF NOT EXISTS idx_member_payment_ledger_member_id ON public.member_payment_ledger(member_id);
CREATE INDEX IF NOT EXISTS idx_member_payment_ledger_payment_date ON public.member_payment_ledger(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_member_payment_ledger_stripe_payment_id ON public.member_payment_ledger(stripe_payment_id) WHERE stripe_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_member_payment_ledger_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_member_payment_ledger_updated_at ON public.member_payment_ledger;
CREATE TRIGGER trg_member_payment_ledger_updated_at BEFORE UPDATE ON public.member_payment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_member_payment_ledger_updated_at();

ALTER TABLE public.member_payment_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role));

DROP POLICY IF EXISTS "member_read_own_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "member_read_own_payment_ledger" ON public.member_payment_ledger FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_members WHERE app_members.id = member_payment_ledger.member_id AND app_members.user_id = auth.uid()));

-- discount_codes citext fix
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.validate_discount_codes(
  _codes TEXT[], _customer_id UUID DEFAULT NULL, _product_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  applied JSONB := '[]'::jsonb; rejected JSONB := '[]'::jsonb;
  seen TEXT[] := '{}'; promo_count INT := 0; referral_count INT := 0;
  code_text TEXT; rec public.discount_codes%ROWTYPE; cat_referral BOOLEAN;
BEGIN
  IF _codes IS NULL OR array_length(_codes,1) IS NULL THEN
    RETURN jsonb_build_object('ok',true,'applied',applied,'rejected',rejected);
  END IF;
  IF array_length(_codes,1) > 2 THEN
    RETURN jsonb_build_object('ok',false,'applied',applied,
      'rejected', jsonb_build_array(jsonb_build_object('code',NULL,'reason','Maximum two codes per checkout')));
  END IF;
  FOREACH code_text IN ARRAY _codes LOOP
    IF code_text IS NULL OR length(trim(code_text)) = 0 THEN CONTINUE; END IF;
    IF upper(code_text) = ANY(SELECT upper(x) FROM unnest(seen) x) THEN
      rejected := rejected || jsonb_build_object('code',code_text,'reason','Duplicate code'); CONTINUE;
    END IF;
    seen := array_append(seen, code_text);
    SELECT * INTO rec FROM public.discount_codes WHERE lower(public_code::text) = lower(code_text) LIMIT 1;
    IF NOT FOUND THEN rejected := rejected || jsonb_build_object('code',code_text,'reason','Code not found. Check spelling or try another code.'); CONTINUE; END IF;
    IF rec.status <> 'active' THEN rejected := rejected || jsonb_build_object('code',code_text,'reason','This code is not currently active.'); CONTINUE; END IF;
    IF rec.expires_at IS NOT NULL AND rec.expires_at < now() THEN rejected := rejected || jsonb_build_object('code',code_text,'reason','This code has expired.'); CONTINUE; END IF;
    IF rec.start_at IS NOT NULL AND rec.start_at > now() THEN rejected := rejected || jsonb_build_object('code',code_text,'reason','This code is not yet active.'); CONTINUE; END IF;
    IF _product_id IS NOT NULL AND NOT rec.applies_to_all_products AND NOT (_product_id = ANY(rec.eligible_product_ids)) THEN
      rejected := rejected || jsonb_build_object('code',code_text,'reason','This code cannot be combined with the current offer.'); CONTINUE;
    END IF;
    cat_referral := rec.category IN ('ambassador','client_referral');
    IF rec.category = 'promotion' THEN promo_count := promo_count + 1; END IF;
    IF cat_referral THEN referral_count := referral_count + 1; END IF;
    IF promo_count > 1 THEN rejected := rejected || jsonb_build_object('code',code_text,'reason','Only one promotion code allowed.'); CONTINUE; END IF;
    IF referral_count > 1 THEN rejected := rejected || jsonb_build_object('code',code_text,'reason','Only one referral code allowed.'); CONTINUE; END IF;
    IF NOT rec.pairing_allowed AND (promo_count + referral_count > 1) THEN
      rejected := rejected || jsonb_build_object('code',code_text,'reason','This code cannot be combined with others.'); CONTINUE;
    END IF;
    applied := applied || jsonb_build_object('id',rec.id,'code',code_text,'category',rec.category,
      'discount_type',rec.discount_type,'discount_value',rec.discount_value,
      'subscription_duration',rec.subscription_duration,'duration_months',rec.duration_months,'description',rec.description);
  END LOOP;
  RETURN jsonb_build_object('ok', jsonb_array_length(rejected) = 0, 'applied', applied, 'rejected', rejected);
END; $$;

REVOKE EXECUTE ON FUNCTION public.validate_discount_codes(TEXT[], UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_discount_codes(TEXT[], UUID, UUID) TO authenticated, service_role;

-- weekly_checkin_threads + messages
CREATE TABLE IF NOT EXISTS public.weekly_checkin_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES public.nf_submissions(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  member_id UUID REFERENCES public.app_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_archived_at TIMESTAMPTZ,
  auto_archive_at TIMESTAMPTZ,
  admin_archived_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_checkin_threads TO authenticated;
GRANT ALL ON public.weekly_checkin_threads TO service_role;
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_threads_client_id ON public.weekly_checkin_threads(client_id);
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_threads_submission_id ON public.weekly_checkin_threads(submission_id);
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_threads_member_id ON public.weekly_checkin_threads(member_id) WHERE member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.weekly_checkin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.weekly_checkin_threads(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('client','coach','admin')),
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_deleted_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_checkin_messages TO authenticated;
GRANT ALL ON public.weekly_checkin_messages TO service_role;
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_messages_thread_id ON public.weekly_checkin_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_weekly_checkin_messages_sender_user_id ON public.weekly_checkin_messages(sender_user_id);

CREATE OR REPLACE FUNCTION public.update_weekly_checkin_thread_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_weekly_checkin_threads_updated_at ON public.weekly_checkin_threads;
CREATE TRIGGER trg_weekly_checkin_threads_updated_at BEFORE UPDATE ON public.weekly_checkin_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_weekly_checkin_thread_updated_at();

CREATE OR REPLACE FUNCTION public.bump_thread_on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN UPDATE public.weekly_checkin_threads SET updated_at = NOW() WHERE id = NEW.thread_id; RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_bump_thread_on_message ON public.weekly_checkin_messages;
CREATE TRIGGER trg_bump_thread_on_message AFTER INSERT ON public.weekly_checkin_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_thread_on_new_message();

ALTER TABLE public.weekly_checkin_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_checkin_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_coach_threads_full" ON public.weekly_checkin_threads;
CREATE POLICY "admin_coach_threads_full" ON public.weekly_checkin_threads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role));

DROP POLICY IF EXISTS "client_own_threads" ON public.weekly_checkin_threads;
CREATE POLICY "client_own_threads" ON public.weekly_checkin_threads FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()) AND admin_archived_at IS NULL)
  WITH CHECK (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "member_own_threads" ON public.weekly_checkin_threads;
CREATE POLICY "member_own_threads" ON public.weekly_checkin_threads FOR ALL TO authenticated
  USING (member_id IN (SELECT id FROM public.app_members WHERE user_id = auth.uid()) AND admin_archived_at IS NULL)
  WITH CHECK (member_id IN (SELECT id FROM public.app_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "admin_coach_messages_full" ON public.weekly_checkin_messages;
CREATE POLICY "admin_coach_messages_full" ON public.weekly_checkin_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role));

DROP POLICY IF EXISTS "client_own_messages" ON public.weekly_checkin_messages;
CREATE POLICY "client_own_messages" ON public.weekly_checkin_messages FOR ALL TO authenticated
  USING (thread_id IN (
      SELECT t.id FROM public.weekly_checkin_threads t
      LEFT JOIN public.clients c ON c.id = t.client_id
      LEFT JOIN public.app_members m ON m.id = t.member_id
      WHERE c.user_id = auth.uid() OR m.user_id = auth.uid()
    ) AND client_deleted_at IS NULL)
  WITH CHECK (thread_id IN (
      SELECT t.id FROM public.weekly_checkin_threads t
      LEFT JOIN public.clients c ON c.id = t.client_id
      LEFT JOIN public.app_members m ON m.id = t.member_id
      WHERE c.user_id = auth.uid() OR m.user_id = auth.uid()
    ));

-- nutrition setup fields
ALTER TABLE public.client_goals_setup
  ADD COLUMN IF NOT EXISTS cooking_skill TEXT,
  ADD COLUMN IF NOT EXISTS food_dislikes TEXT[];
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cooking_skill TEXT,
  ADD COLUMN IF NOT EXISTS food_dislikes TEXT[];
UPDATE public.client_goals_setup SET food_dislikes = '{}' WHERE food_dislikes IS NULL;
UPDATE public.clients SET food_dislikes = '{}' WHERE food_dislikes IS NULL;

-- cardio_completions (idempotent — table already present)
CREATE TABLE IF NOT EXISTS public.cardio_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cardio_target_id UUID REFERENCES public.cardio_targets(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completed BOOLEAN NOT NULL DEFAULT TRUE,
  duration_minutes INTEGER,
  cardio_type TEXT,
  rpe NUMERIC(3,1),
  notes TEXT,
  day_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_completions TO authenticated;
GRANT ALL ON public.cardio_completions TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cardio_completions_target_date
  ON public.cardio_completions(client_id, cardio_target_id, completed_date) WHERE cardio_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cardio_completions_client_date ON public.cardio_completions(client_id, completed_date DESC);
CREATE INDEX IF NOT EXISTS idx_cardio_completions_target_id ON public.cardio_completions(cardio_target_id) WHERE cardio_target_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_cardio_completions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_cardio_completions_updated_at ON public.cardio_completions;
CREATE TRIGGER trg_cardio_completions_updated_at BEFORE UPDATE ON public.cardio_completions
  FOR EACH ROW EXECUTE FUNCTION public.update_cardio_completions_updated_at();

ALTER TABLE public.cardio_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_coach_cardio_completions" ON public.cardio_completions;
CREATE POLICY "admin_coach_cardio_completions" ON public.cardio_completions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role));

DROP POLICY IF EXISTS "client_own_cardio_completions" ON public.cardio_completions;
CREATE POLICY "client_own_cardio_completions" ON public.cardio_completions FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()))
  WITH CHECK (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));