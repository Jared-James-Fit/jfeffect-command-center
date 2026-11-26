-- Competition Handling & Event Preparation (Nov 26 2026).
--
-- One source of truth per meet, built on Competition Intelligence:
--  * competitions             the event and everything the athlete told us about
--                             it: timezone, session and flight details, the
--                             estimated timeline's confirmed times and meet-day
--                             progress (`schedule`), the preparation checklist's
--                             states (`checklist`), and the athlete's own meet
--                             information (`athlete_info`, onboarding's answers),
--                             with the meaningful changes the coach hasn't seen
--                             (`athlete_info_changes`).
--  * competition_handling     the Competition Handling service on a permanent
--                             account: one per competition, its status, who
--                             handles it, who referred it (a meeting), the
--                             athlete's own coach and whether they may be told
--                             anything, the price and the one-time sale, the
--                             terms, the temporary access window and the
--                             personalized invite (only its hash).
--  * competition_gameplans    the gameplan, versioned: Cleo's draft, the coach's
--                             approved versions, the athlete's suggestions; a new
--                             version never overwrites an approved one.
--
-- Accounts, memberships and services stay separate: handling never changes a
-- client's tier, plan, coach or package, and ending it takes nothing away.
-- Staff read their own clients' rows (admins all; a handler coach only during
-- the handling's access window, through coached_client_ids()); every write goes
-- through the server after a staff check. Athletes read through the server.

SET lock_timeout = '5s';

-- ── 1. The event and the athlete's meet information ───────────────────────
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'powerlifting',
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS session_label text,
  ADD COLUMN IF NOT EXISTS flights_in_session integer,
  ADD COLUMN IF NOT EXISTS lifters_per_flight integer,
  ADD COLUMN IF NOT EXISTS platforms integer,
  ADD COLUMN IF NOT EXISTS lot_number integer,
  ADD COLUMN IF NOT EXISTS schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS athlete_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS athlete_info_at timestamptz,
  ADD COLUMN IF NOT EXISTS athlete_info_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prep_reminders boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  ALTER TABLE public.competitions ADD CONSTRAINT competitions_sport_check
    CHECK (sport IN ('powerlifting', 'weightlifting', 'strongman', 'bodybuilding', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.competitions ADD CONSTRAINT competitions_handling_fields_check CHECK (
    (timezone IS NULL OR char_length(timezone) BETWEEN 3 AND 64)
    AND (session_label IS NULL OR char_length(session_label) <= 40)
    AND (flights_in_session IS NULL OR flights_in_session BETWEEN 1 AND 20)
    AND (lifters_per_flight IS NULL OR lifters_per_flight BETWEEN 1 AND 40)
    AND (platforms IS NULL OR platforms BETWEEN 1 AND 6)
    AND (lot_number IS NULL OR lot_number BETWEEN 1 AND 999)
    AND jsonb_typeof(schedule) = 'object'
    AND jsonb_typeof(checklist) = 'object'
    AND jsonb_typeof(athlete_info) = 'object'
    AND jsonb_typeof(athlete_info_changes) = 'array'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. The handling service ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_handling (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'onboarding', 'preparing', 'ready', 'completed', 'cancelled')),
  -- the staff member handling them on the day (their access is temporary)
  handler_user_id uuid,
  -- who it came from: the client who asked (a meeting), the meeting itself
  referrer_client_id uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  source_session_id uuid REFERENCES public.coaching_sessions (id) ON DELETE SET NULL,
  source_note text CHECK (source_note IS NULL OR char_length(source_note) <= 600),
  -- the athlete's own coach: { name, clientId?, contact?, confirmed }
  existing_coach jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(existing_coach) = 'object'),
  -- may anything be shared with that coach: the athlete's answer, never assumed
  share_with_coach text NOT NULL DEFAULT 'ask' CHECK (share_with_coach IN ('ask', 'yes', 'no')),
  share_decided_at timestamptz,
  -- the service's price (before tax) and how it's paid
  price_cents integer CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 1000000),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  payment text NOT NULL DEFAULT 'not_set' CHECK (payment IN ('not_set', 'waived', 'link', 'paid', 'refunded')),
  sale_id uuid REFERENCES public.purchase_records (id) ON DELETE SET NULL,
  -- the handling terms the athlete accepted (the exact words kept)
  terms_version text CHECK (terms_version IS NULL OR char_length(terms_version) <= 20),
  terms_text text CHECK (terms_text IS NULL OR char_length(terms_text) <= 4000),
  terms_accepted_at timestamptz,
  terms_accepted_by uuid,
  -- the handler's temporary access, by day (inclusive)
  access_starts_on date,
  access_ends_on date,
  -- the personalized invite: only its hash is kept
  invite_token_hash text UNIQUE CHECK (invite_token_hash IS NULL OR invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  invite_revoked_at timestamptz,
  invite_opened_at timestamptz,
  invite_sent_at timestamptz,
  invite_name text CHECK (invite_name IS NULL OR char_length(invite_name) <= 120),
  onboarded_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 600),
  -- the post-meet recap and the follow-up offered (nothing enrolls anyone)
  recap jsonb,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id),
  CHECK (access_ends_on IS NULL OR access_starts_on IS NULL OR access_ends_on >= access_starts_on)
);
CREATE INDEX IF NOT EXISTS competition_handling_client_idx ON public.competition_handling (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS competition_handling_status_idx ON public.competition_handling (status);
CREATE INDEX IF NOT EXISTS competition_handling_handler_idx ON public.competition_handling (handler_user_id) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX IF NOT EXISTS competition_handling_session_idx ON public.competition_handling (source_session_id) WHERE source_session_id IS NOT NULL;

-- ── 3. The gameplan, versioned ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competition_gameplans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  source text NOT NULL CHECK (source IN ('cleo', 'coach', 'athlete')),
  -- draft: Cleo's or the coach's, not shown to the athlete; approved: the plan;
  -- suggested: the athlete's change, waiting on the coach; accepted / declined: decided;
  -- superseded: an approved version a newer approved one replaced
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'suggested', 'accepted', 'declined', 'superseded')),
  based_on uuid REFERENCES public.competition_gameplans (id) ON DELETE SET NULL,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 600),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid,
  athlete_confirmed_at timestamptz,
  athlete_confirmed_by uuid,
  decided_at timestamptz,
  decided_by uuid,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 600),
  UNIQUE (competition_id, version)
);
CREATE INDEX IF NOT EXISTS competition_gameplans_comp_idx ON public.competition_gameplans (competition_id, version DESC);
-- one approved plan at a time
CREATE UNIQUE INDEX IF NOT EXISTS competition_gameplans_one_approved ON public.competition_gameplans (competition_id) WHERE status = 'approved';

-- an approved or decided version keeps its plan: a change is a new version
CREATE OR REPLACE FUNCTION public.tg_competition_gameplan_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'superseded', 'accepted', 'declined')
     AND NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'An approved gameplan version never changes: save a new version';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS competition_gameplan_keep ON public.competition_gameplans;
CREATE TRIGGER competition_gameplan_keep BEFORE UPDATE ON public.competition_gameplans
  FOR EACH ROW EXECUTE FUNCTION public.tg_competition_gameplan_keep();

-- ── 4. Touch updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_competition_handling_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS competition_handling_touch ON public.competition_handling;
CREATE TRIGGER competition_handling_touch BEFORE UPDATE ON public.competition_handling
  FOR EACH ROW EXECUTE FUNCTION public.tg_competition_handling_touch();

-- ── 5. Access: staff read their own clients'; the server writes ───────────
ALTER TABLE public.competition_handling ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_gameplans ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['competition_handling', 'competition_gameplans'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Staff read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Staff read %1$s" ON public.%1$I FOR SELECT TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()), ''admin''::app_role)) OR client_id IN (SELECT public.coached_client_ids()))',
      t
    );
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.competition_handling FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.competition_gameplans FROM anon, authenticated;
GRANT SELECT ON public.competition_handling TO authenticated;
GRANT SELECT ON public.competition_gameplans TO authenticated;

-- ── 6. Temporary handling access ───────────────────────────────────────────
-- A coach handling someone they don't coach reaches that athlete only from
-- the handling's first day to its last (meet day plus the follow-up), never
-- once it's cancelled. The admin reaches everyone already.
CREATE OR REPLACE FUNCTION public.coached_client_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
    FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE co.user_id = auth.uid()
     AND co.archived = false
     AND co.status = 'Active'
  UNION
  SELECT h.client_id
    FROM public.competition_handling h
    JOIN public.coaches co ON co.user_id = h.handler_user_id
   WHERE h.handler_user_id = auth.uid()
     AND co.archived = false
     AND co.status = 'Active'
     AND h.status <> 'cancelled'
     AND (h.access_starts_on IS NULL OR h.access_starts_on <= (now() AT TIME ZONE 'UTC')::date + 1)
     AND (h.access_ends_on IS NULL OR h.access_ends_on >= (now() AT TIME ZONE 'UTC')::date - 1)
$$;
GRANT EXECUTE ON FUNCTION public.coached_client_ids() TO anon, authenticated;

-- ── 7. The handling's one-time sale ────────────────────────────────────────
-- A payment request, never a charge: an unpaid one-time sale for the handling
-- at its price, reused while nothing has been paid on it. Stripe's checkout and
-- the /pay link are made by the server afterwards (the sale's own checkout).
CREATE OR REPLACE FUNCTION public.competition_handling_sale(
  _handling_id uuid,
  _price_cents integer,
  _currency text,
  _stripe_product_id text,
  _stripe_price_id text,
  _actor uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  h record;
  v_comp record;
  v_sale record;
  v_id uuid;
BEGIN
  IF _price_cents IS NULL OR _price_cents < 50 OR _price_cents > 1000000 THEN
    RAISE EXCEPTION 'The price has to be between $0.50 and $10,000';
  END IF;
  SELECT * INTO h FROM public.competition_handling WHERE id = _handling_id FOR UPDATE;
  IF h.id IS NULL THEN RAISE EXCEPTION 'Handling not found'; END IF;
  IF h.status = 'cancelled' THEN RAISE EXCEPTION 'This handling was cancelled'; END IF;
  SELECT name, meet_date, timezone INTO v_comp FROM public.competitions WHERE id = h.competition_id;

  IF h.sale_id IS NOT NULL THEN
    SELECT id, coalesce(amount_paid_cents, 0) AS paid, archived_at INTO v_sale
      FROM public.purchase_records WHERE id = h.sale_id;
    IF v_sale.id IS NOT NULL AND v_sale.paid > 0 THEN
      RETURN v_sale.id; -- money is on it: never replaced
    END IF;
    IF v_sale.id IS NOT NULL AND v_sale.archived_at IS NULL THEN
      UPDATE public.purchase_records SET
        full_payable_amount = _price_cents / 100.0,
        amount_due_today = _price_cents / 100.0,
        contract_value_cents = _price_cents,
        amount_outstanding_cents = _price_cents,
        currency = upper(coalesce(nullif(_currency, ''), 'CAD')),
        stripe_product_id = nullif(_stripe_product_id, ''),
        stripe_price_id = nullif(_stripe_price_id, ''),
        stripe_checkout_session_id = NULL,
        last_payment_update_source = 'competition_handling',
        last_payment_update_at = now()
      WHERE id = v_sale.id;
      UPDATE public.competition_handling SET price_cents = _price_cents, currency = upper(coalesce(nullif(_currency, ''), 'CAD')), payment = 'link' WHERE id = h.id;
      RETURN v_sale.id;
    END IF;
  END IF;

  INSERT INTO public.purchase_records (
    client_id, offer_id, offer_name, offer_type, short_description, currency,
    full_payable_amount, amount_due_today, contract_value_cents, payment_structure, payment_frequency,
    number_of_payments, is_recurring, sessions_purchased, package_tracking_enabled,
    timezone, term_start_date,
    payment_status, status, amount_paid, amount_paid_cents, amount_tax_paid_cents,
    amount_refunded_cents, amount_credited_cents, amount_outstanding_cents,
    stripe_product_id, stripe_price_id, purchased_at, assigned_by, assigned_at,
    offer_snapshot, admin_notes, last_payment_update_source, last_payment_update_at
  ) VALUES (
    h.client_id, NULL, 'Competition Handling · ' || coalesce(v_comp.name, 'Competition'), 'Competition Handling',
    'Handling at ' || coalesce(v_comp.name, 'the competition') || ' on ' || to_char(v_comp.meet_date, 'Mon FMDD, YYYY') || '.',
    upper(coalesce(nullif(_currency, ''), 'CAD')),
    _price_cents / 100.0, _price_cents / 100.0, _price_cents, 'One-time payment', 'One-time',
    1, false, 0, false,
    v_comp.timezone, v_comp.meet_date,
    'Unpaid', 'Active', 0, 0, 0,
    0, 0, _price_cents,
    nullif(_stripe_product_id, ''), nullif(_stripe_price_id, ''), now(), _actor, now(),
    jsonb_build_object('source', 'competition_handling', 'handling_id', h.id, 'competition_id', h.competition_id),
    'Competition handling for ' || coalesce(v_comp.name, 'a competition') || '.',
    'competition_handling', now()
  ) RETURNING id INTO v_id;
  UPDATE public.competition_handling
     SET sale_id = v_id, price_cents = _price_cents, currency = upper(coalesce(nullif(_currency, ''), 'CAD')), payment = 'link'
   WHERE id = h.id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.competition_handling_sale(uuid, integer, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_handling_sale(uuid, integer, text, text, text, uuid) TO service_role;

-- ── 8. Preparation reminders: when could one be due ───────────────────────
-- Every five minutes while a meet is today or tomorrow (meet-day timings), and
-- once an hour (the first run of the hour) while one is within 60 days.
CREATE OR REPLACE FUNCTION public.competition_prep_due()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions c
     WHERE c.status = 'upcoming'
       AND c.prep_reminders
       AND c.internal_test = false
       AND c.meet_date BETWEEN (now() AT TIME ZONE 'America/Winnipeg')::date - 1
                           AND (now() AT TIME ZONE 'America/Winnipeg')::date + 60
       AND (c.meet_date <= (now() AT TIME ZONE 'America/Winnipeg')::date + 1
            OR extract(minute FROM now()) < 5)
  );
$$;
REVOKE ALL ON FUNCTION public.competition_prep_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_prep_due() TO service_role, postgres;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'competition-prep-reminders';
  PERFORM cron.schedule(
    'competition-prep-reminders',
    '3-59/5 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/competition-intel-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{"scan":"prep"}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE public.competition_prep_due();
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END $$;

SELECT public.rls_evaluate_once('competition_handling');
SELECT public.rls_evaluate_once('competition_gameplans');
