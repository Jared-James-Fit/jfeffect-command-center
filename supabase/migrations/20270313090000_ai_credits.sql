-- AI credits (Nov 13 2026).
--
-- The coach wants control over how often members and clients can use the AI
-- features that cost him money, with more for sale through Stripe at a fair
-- profit. One wallet per login:
--
--   allowance  free credits each month (Winnipeg calendar month), by who
--              they are: a JF member (self-serve), a coaching client, or
--              staff (admins, coaches, their linked athlete logins and the
--              account coach posts go out as: never metered). The numbers
--              live in app_settings 'ai_credits' and the admin sets them.
--   extra      credits bought (or given by an admin): never expire, used
--              only once the month's allowance is gone.
--
-- A feature's cost is decided here (ai_credit_cost), never by the caller.
-- Spending is server only: ai_credits_use (before the model is called) and
-- ai_credits_settle (after: a failed call gives back exactly what it took,
-- once). A person can't refund their own use, so they can't get AI for free
-- by calling these themselves. Purchases are recorded once per Stripe
-- Checkout Session (ai_credits_record_purchase, from the webhook or the
-- return page, whichever comes first) and a Stripe refund takes back the
-- credits it paid for that are still unused (ai_credits_record_refund).
-- Purchases are their own sale records (ai_credit_purchases), never a
-- payment on a coaching sale, and the books read them as revenue with their
-- GST. Every table is closed to clients; the RPCs are the only way in.

CREATE TABLE IF NOT EXISTS public.ai_credit_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_used integer NOT NULL DEFAULT 0 CHECK (period_used >= 0),
  extra integer NOT NULL DEFAULT 0 CHECK (extra >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_credit_wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_wallets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_wallets TO service_role;

-- Every change to a wallet, and every AI use (staff's too, at 0 credits, so
-- the coach sees what the AI costs). No foreign key on purpose: it's history.
CREATE TABLE IF NOT EXISTS public.ai_credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('use', 'refund', 'purchase', 'grant', 'reversal')),
  feature text,
  -- signed: what this did to the person's credits (a use is negative)
  credits integer NOT NULL DEFAULT 0,
  -- the parts of it: the month's allowance and the extra bucket (signed)
  allowance_delta integer NOT NULL DEFAULT 0,
  extra_delta integer NOT NULL DEFAULT 0,
  period_start date,
  status text CHECK (status IS NULL OR status IN ('pending', 'done', 'refunded')),
  use_id uuid,
  ref text,
  note text,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_credit_events_user_idx ON public.ai_credit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_credit_events_created_idx ON public.ai_credit_events (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_events_one_refund ON public.ai_credit_events (use_id) WHERE kind = 'refund';
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_events_ref_once ON public.ai_credit_events (kind, ref) WHERE kind IN ('purchase', 'reversal') AND ref IS NOT NULL;
ALTER TABLE public.ai_credit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_events TO service_role;

-- A credit pack sold through Stripe. Its own sale record (never a payment on
-- a coaching sale): amounts in minor units, before tax + tax = total.
CREATE TABLE IF NOT EXISTS public.ai_credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid,
  pack text NOT NULL,
  credits integer NOT NULL CHECK (credits > 0),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  tax_minor integer NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor integer NOT NULL CHECK (total_minor >= 0),
  currency text NOT NULL DEFAULT 'CAD',
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'partially_refunded', 'refunded')),
  refunded_minor integer NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  credits_reversed integer NOT NULL DEFAULT 0 CHECK (credits_reversed >= 0),
  refunded_at timestamptz,
  stripe_checkout_session_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  stripe_mode text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_credit_purchases_user_idx ON public.ai_credit_purchases (user_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ai_credit_purchases_pi_idx ON public.ai_credit_purchases (stripe_payment_intent_id);
ALTER TABLE public.ai_credit_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_purchases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credit_purchases TO service_role;
-- The books (Taxes & Books) read sales with the owner's own session.
GRANT SELECT ON public.ai_credit_purchases TO authenticated;
DROP POLICY IF EXISTS "Business owners read AI credit sales" ON public.ai_credit_purchases;
CREATE POLICY "Business owners read AI credit sales" ON public.ai_credit_purchases
  FOR SELECT TO authenticated USING ((SELECT public.is_business_owner((SELECT auth.uid()))));

-- Defaults: a JF member gets 30 a month (about one AI food log a day), a
-- coaching client 300 (more than anyone logs; it only stops runaway use).
INSERT INTO public.app_settings (key, value)
VALUES ('ai_credits', '{"allowances":{"member":30,"coaching":300}}')
ON CONFLICT (key) DO NOTHING;

/** What one use of a feature costs, in credits. NULL = not a metered feature (refused). Mirrors FEATURE_COSTS in src/lib/ai-credits/packs.ts. */
CREATE OR REPLACE FUNCTION public.ai_credit_cost(_feature text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _feature
    WHEN 'meal_estimate' THEN 1
    ELSE NULL
  END
$$;

/** The first day of this month on the coach's clock (Winnipeg), when every allowance starts over. */
CREATE OR REPLACE FUNCTION public.ai_credit_period_start()
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT date_trunc('month', public.instant_to_local(now(), 'America/Winnipeg'))::date
$$;

/** (internal) The admin's settings, with the defaults filled in. */
CREATE OR REPLACE FUNCTION public.ai_credit_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  raw text;
  j jsonb := '{}'::jsonb;
BEGIN
  SELECT value INTO raw FROM public.app_settings WHERE key = 'ai_credits';
  BEGIN
    j := coalesce(raw::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    j := '{}'::jsonb;
  END;
  RETURN jsonb_build_object('allowances', jsonb_build_object(
    'member', greatest(0, coalesce((j #>> '{allowances,member}')::int, 30)),
    'coaching', greatest(0, coalesce((j #>> '{allowances,coaching}')::int, 300))
  ));
END $$;

/** (internal) Who a login is for credits: 'staff' (never metered), 'coaching' or 'member'. */
CREATE OR REPLACE FUNCTION public.ai_credit_tier(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _user IN (SELECT public.community_staff_people()) THEN 'staff'
    WHEN EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.user_id = _user AND c.service_tier = 'coaching'
         AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
    ) THEN 'coaching'
    ELSE 'member'
  END
$$;

/** (internal) This month's free credits for a login; NULL = unlimited (staff). */
CREATE OR REPLACE FUNCTION public.ai_credit_allowance(_user uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t text := public.ai_credit_tier(_user);
  s jsonb := public.ai_credit_settings();
BEGIN
  IF t = 'staff' THEN RETURN NULL; END IF;
  RETURN (s #>> ARRAY['allowances', t])::int;
END $$;

/** (internal) The wallet, locked, rolled over to this month. */
CREATE OR REPLACE FUNCTION public.ai_credit_wallet_lock(_user uuid)
RETURNS public.ai_credit_wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  w public.ai_credit_wallets;
  p date := public.ai_credit_period_start();
BEGIN
  INSERT INTO public.ai_credit_wallets (user_id, period_start) VALUES (_user, p) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.ai_credit_wallets WHERE user_id = _user FOR UPDATE;
  IF w.period_start <> p THEN
    UPDATE public.ai_credit_wallets SET period_start = p, period_used = 0, updated_at = now()
     WHERE user_id = _user RETURNING * INTO w;
  END IF;
  RETURN w;
END $$;

/** (internal) Where a login's credits stand, never writing: what the app shows. */
CREATE OR REPLACE FUNCTION public.ai_credit_state(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t text := public.ai_credit_tier(_user);
  allowance int := public.ai_credit_allowance(_user);
  p date := public.ai_credit_period_start();
  w public.ai_credit_wallets;
  used int := 0;
  extra int := 0;
  free_left int;
BEGIN
  SELECT * INTO w FROM public.ai_credit_wallets WHERE user_id = _user;
  IF FOUND THEN
    extra := w.extra;
    IF w.period_start = p THEN used := w.period_used; END IF;
  END IF;
  free_left := CASE WHEN allowance IS NULL THEN NULL ELSE greatest(allowance - used, 0) END;
  RETURN jsonb_build_object(
    'tier', t,
    'unlimited', allowance IS NULL,
    'allowance', allowance,
    'used', used,
    'allowance_left', free_left,
    'extra', extra,
    'left', CASE WHEN allowance IS NULL THEN NULL ELSE free_left + extra END,
    'period_start', p,
    'resets_on', (p + interval '1 month')::date,
    'costs', jsonb_build_object('meal_estimate', public.ai_credit_cost('meal_estimate'))
  );
END $$;

/**
 * (internal) The state plus what this month's credits went on (uses counted
 * per feature, never one row each) and the credits that came in or went out
 * (bought, given, refunded), for the person's own screen.
 */
CREATE OR REPLACE FUNCTION public.ai_credit_detail(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.ai_credit_state(_user) || jsonb_build_object(
    'uses_this_month', coalesce((
      SELECT jsonb_object_agg(f.feature, f.n) FROM (
        SELECT e.feature, count(*) AS n FROM public.ai_credit_events e
         WHERE e.user_id = _user AND e.kind = 'use' AND coalesce(e.status, '') <> 'refunded'
           AND e.created_at >= public.local_to_instant(public.ai_credit_period_start()::timestamp, 'America/Winnipeg')
         GROUP BY e.feature
      ) f
    ), '{}'::jsonb),
    'history', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'credits', e.credits, 'note', e.note, 'at', e.created_at) ORDER BY e.created_at DESC)
        FROM (
          SELECT * FROM public.ai_credit_events
           WHERE user_id = _user AND kind IN ('purchase', 'grant', 'reversal') AND credits <> 0
           ORDER BY created_at DESC LIMIT 10
        ) e
    ), '[]'::jsonb),
    'purchases', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'pack', p.pack, 'credits', p.credits, 'amount_minor', p.amount_minor, 'tax_minor', p.tax_minor, 'total_minor', p.total_minor, 'currency', p.currency, 'status', p.status, 'at', p.paid_at) ORDER BY p.paid_at DESC)
        FROM (SELECT * FROM public.ai_credit_purchases WHERE user_id = _user ORDER BY paid_at DESC LIMIT 10) p
    ), '[]'::jsonb)
  )
$$;

/** The signed-in person's own credits. */
CREATE OR REPLACE FUNCTION public.ai_credits_mine()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  RETURN public.ai_credit_detail(me);
END $$;

/** A client's credits, for an admin or that client's own coach (View as client, the client's profile). */
CREATE OR REPLACE FUNCTION public.ai_credits_for_user(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_role(me, 'admin') OR _user IN (SELECT public.coached_client_user_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public.ai_credit_detail(_user);
END $$;

/**
 * Server only: take a feature's cost before its model is called. The month's
 * allowance goes first, then extra. Out of credits: {ok:false, reason:'out_of_credits', state}.
 * Staff are never charged; their use is still logged (0 credits) so the cost shows.
 */
CREATE OR REPLACE FUNCTION public.ai_credits_use(_user uuid, _feature text, _ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  cost int := public.ai_credit_cost(_feature);
  allowance int;
  w public.ai_credit_wallets;
  free_left int;
  from_allowance int;
  from_extra int;
  use_id uuid;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'No user'; END IF;
  IF cost IS NULL THEN RAISE EXCEPTION 'Unknown AI feature: %', _feature; END IF;
  allowance := public.ai_credit_allowance(_user);
  IF allowance IS NULL THEN
    INSERT INTO public.ai_credit_events (user_id, kind, feature, credits, status, ref, note)
    VALUES (_user, 'use', _feature, 0, 'pending', _ref, 'unmetered')
    RETURNING id INTO use_id;
    RETURN jsonb_build_object('ok', true, 'use_id', use_id, 'state', public.ai_credit_state(_user));
  END IF;
  w := public.ai_credit_wallet_lock(_user);
  free_left := greatest(allowance - w.period_used, 0);
  from_allowance := least(free_left, cost);
  from_extra := cost - from_allowance;
  IF from_extra > w.extra THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'out_of_credits', 'state', public.ai_credit_state(_user));
  END IF;
  UPDATE public.ai_credit_wallets
     SET period_used = period_used + from_allowance, extra = extra - from_extra, updated_at = now()
   WHERE user_id = _user;
  INSERT INTO public.ai_credit_events (user_id, kind, feature, credits, allowance_delta, extra_delta, period_start, status, ref)
  VALUES (_user, 'use', _feature, -cost, -from_allowance, -from_extra, w.period_start, 'pending', _ref)
  RETURNING id INTO use_id;
  RETURN jsonb_build_object('ok', true, 'use_id', use_id, 'state', public.ai_credit_state(_user));
END $$;

/**
 * Server only: after the model answered (or didn't). A use that failed gives
 * back exactly what it took, once (the month's part only within that month).
 * The model, tokens and estimated cost are kept on the use either way.
 */
CREATE OR REPLACE FUNCTION public.ai_credits_settle(
  _use_id uuid, _ok boolean, _model text DEFAULT NULL, _input_tokens integer DEFAULT NULL,
  _output_tokens integer DEFAULT NULL, _cost_usd numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  u public.ai_credit_events;
  w public.ai_credit_wallets;
  back_allowance int := 0;
BEGIN
  SELECT * INTO u FROM public.ai_credit_events WHERE id = _use_id AND kind = 'use' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.ai_credit_events
     SET model = coalesce(_model, model), input_tokens = coalesce(_input_tokens, input_tokens),
         output_tokens = coalesce(_output_tokens, output_tokens), cost_usd = coalesce(_cost_usd, cost_usd)
   WHERE id = _use_id;
  IF _ok THEN
    IF u.status = 'pending' THEN UPDATE public.ai_credit_events SET status = 'done' WHERE id = _use_id; END IF;
    RETURN public.ai_credit_state(u.user_id);
  END IF;
  IF u.status = 'refunded' THEN RETURN public.ai_credit_state(u.user_id); END IF;
  IF u.allowance_delta <> 0 OR u.extra_delta <> 0 THEN
    w := public.ai_credit_wallet_lock(u.user_id);
    IF u.period_start = w.period_start THEN back_allowance := -u.allowance_delta; END IF;
    UPDATE public.ai_credit_wallets
       SET period_used = greatest(period_used - back_allowance, 0), extra = extra - u.extra_delta, updated_at = now()
     WHERE user_id = u.user_id;
  END IF;
  INSERT INTO public.ai_credit_events (user_id, kind, feature, credits, allowance_delta, extra_delta, period_start, use_id, note)
  VALUES (u.user_id, 'refund', u.feature, back_allowance - u.extra_delta, back_allowance, -u.extra_delta, u.period_start, u.id, 'The AI didn''t answer')
  ON CONFLICT DO NOTHING;
  UPDATE public.ai_credit_events SET status = 'refunded' WHERE id = _use_id;
  RETURN public.ai_credit_state(u.user_id);
END $$;

/**
 * Server only: a paid credit pack, once per Stripe Checkout Session (the
 * webhook and the return page can both call it). Adds the credits to extra.
 */
CREATE OR REPLACE FUNCTION public.ai_credits_record_purchase(
  _user uuid, _pack text, _credits integer, _amount_minor integer, _tax_minor integer, _total_minor integer,
  _currency text, _session text, _payment_intent text, _customer text, _mode text, _paid_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  pid uuid;
  cid uuid;
BEGIN
  IF _user IS NULL OR _session IS NULL OR coalesce(_credits, 0) <= 0 THEN RAISE EXCEPTION 'Bad purchase'; END IF;
  SELECT c.id INTO cid FROM public.clients c WHERE c.user_id = _user ORDER BY (c.service_tier = 'coaching') DESC, c.created_at DESC LIMIT 1;
  INSERT INTO public.ai_credit_purchases (
    user_id, client_id, pack, credits, amount_minor, tax_minor, total_minor, currency,
    stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_mode, paid_at
  ) VALUES (
    _user, cid, _pack, _credits, greatest(coalesce(_amount_minor, 0), 0), greatest(coalesce(_tax_minor, 0), 0),
    greatest(coalesce(_total_minor, 0), 0), upper(coalesce(_currency, 'CAD')),
    _session, _payment_intent, _customer, _mode, coalesce(_paid_at, now())
  )
  ON CONFLICT (stripe_checkout_session_id) DO NOTHING
  RETURNING id INTO pid;
  IF pid IS NULL THEN
    UPDATE public.ai_credit_purchases SET stripe_payment_intent_id = coalesce(stripe_payment_intent_id, _payment_intent)
     WHERE stripe_checkout_session_id = _session;
    RETURN jsonb_build_object('ok', true, 'added', 0, 'duplicate', true, 'state', public.ai_credit_state(_user));
  END IF;
  PERFORM public.ai_credit_wallet_lock(_user);
  UPDATE public.ai_credit_wallets SET extra = extra + _credits, updated_at = now() WHERE user_id = _user;
  INSERT INTO public.ai_credit_events (user_id, kind, credits, extra_delta, ref, note)
  VALUES (_user, 'purchase', _credits, _credits, _session, _credits || ' credits bought');
  RETURN jsonb_build_object('ok', true, 'added', _credits, 'purchase_id', pid, 'state', public.ai_credit_state(_user));
END $$;

/**
 * Server only: a Stripe refund on a credit pack's payment. _refunded_minor is
 * the charge's whole refunded amount so far (Stripe's amount_refunded); the
 * credits it paid for come back off, proportionally, as far as they're still
 * unused (what was used stays used). Returns NULL when the payment isn't a
 * credit pack.
 */
CREATE OR REPLACE FUNCTION public.ai_credits_record_refund(_payment_intent text, _refunded_minor integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  p public.ai_credit_purchases;
  refunded int;
  target int;
  delta int;
  w public.ai_credit_wallets;
  take int := 0;
BEGIN
  IF _payment_intent IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.ai_credit_purchases WHERE stripe_payment_intent_id = _payment_intent FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  refunded := least(greatest(coalesce(_refunded_minor, 0), p.refunded_minor), greatest(p.total_minor, 0));
  target := CASE WHEN p.total_minor > 0 THEN floor(p.credits::numeric * refunded / p.total_minor)::int ELSE p.credits END;
  delta := greatest(target - p.credits_reversed, 0);
  IF delta > 0 THEN
    w := public.ai_credit_wallet_lock(p.user_id);
    take := least(delta, w.extra);
    UPDATE public.ai_credit_wallets SET extra = extra - take, updated_at = now() WHERE user_id = p.user_id;
    INSERT INTO public.ai_credit_events (user_id, kind, credits, extra_delta, ref, note)
    VALUES (p.user_id, 'reversal', -take, -take, 'refund:' || _payment_intent || ':' || refunded, 'Refunded')
    ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.ai_credit_purchases
     SET refunded_minor = refunded,
         credits_reversed = credits_reversed + delta,
         refunded_at = CASE WHEN refunded > p.refunded_minor THEN now() ELSE refunded_at END,
         status = CASE WHEN refunded <= 0 THEN 'paid' WHEN refunded >= p.total_minor THEN 'refunded' ELSE 'partially_refunded' END
   WHERE id = p.id;
  RETURN jsonb_build_object('ok', true, 'taken', take, 'state', public.ai_credit_state(p.user_id));
END $$;

/** Admin only: give (or take back) credits. They go to extra and never expire. */
CREATE OR REPLACE FUNCTION public.ai_credits_admin_grant(_user uuid, _credits integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
  w public.ai_credit_wallets;
  n int;
BEGIN
  IF me IS NULL OR NOT public.has_role(me, 'admin') THEN RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501'; END IF;
  IF _user IS NULL OR coalesce(_credits, 0) = 0 OR abs(_credits) > 100000 THEN RAISE EXCEPTION 'Pick a number of credits'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user) THEN RAISE EXCEPTION 'That person has no login yet'; END IF;
  w := public.ai_credit_wallet_lock(_user);
  n := greatest(_credits, -w.extra);
  UPDATE public.ai_credit_wallets SET extra = extra + n, updated_at = now() WHERE user_id = _user;
  INSERT INTO public.ai_credit_events (user_id, kind, credits, extra_delta, note, created_by)
  VALUES (_user, 'grant', n, n, coalesce(nullif(trim(_note), ''), CASE WHEN n > 0 THEN 'Given by your coach' ELSE 'Taken back' END), me);
  RETURN public.ai_credit_state(_user);
END $$;

/** Admin only: the monthly free credits for members and coaching clients. */
CREATE OR REPLACE FUNCTION public.ai_credits_set_allowances(_member integer, _coaching integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.has_role(me, 'admin') THEN RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501'; END IF;
  IF _member IS NULL OR _coaching IS NULL OR _member < 0 OR _coaching < 0 OR _member > 100000 OR _coaching > 100000 THEN
    RAISE EXCEPTION 'Allowances are 0 to 100,000 a month';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('ai_credits', jsonb_build_object('allowances', jsonb_build_object('member', _member, 'coaching', _coaching))::text, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  RETURN public.ai_credit_settings();
END $$;

/** Admin only: how the credits are going: use, AI cost, sales, who uses the most. */
CREATE OR REPLACE FUNCTION public.ai_credits_overview(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  me uuid := auth.uid();
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 366)));
BEGIN
  IF me IS NULL OR NOT public.has_role(me, 'admin') THEN RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.ai_credit_settings(),
    'days', greatest(1, least(coalesce(_days, 30), 366)),
    'uses', (
      SELECT jsonb_build_object(
        'count', count(*) FILTER (WHERE coalesce(status, '') <> 'refunded'),
        'failed', count(*) FILTER (WHERE status = 'refunded'),
        'credits', coalesce(-sum(credits) FILTER (WHERE coalesce(status, '') <> 'refunded'), 0),
        'people', count(DISTINCT user_id),
        'cost_usd', coalesce(sum(cost_usd), 0),
        'priced', count(*) FILTER (WHERE cost_usd IS NOT NULL)
      ) FROM public.ai_credit_events WHERE kind = 'use' AND created_at >= since
    ),
    'sales', (
      SELECT jsonb_build_object(
        'count', count(*),
        'credits', coalesce(sum(credits), 0),
        'amount_minor', coalesce(sum(amount_minor), 0),
        'tax_minor', coalesce(sum(tax_minor), 0),
        'refunded_minor', coalesce(sum(refunded_minor), 0)
      ) FROM public.ai_credit_purchases WHERE paid_at >= since AND coalesce(stripe_mode, 'live') <> 'test'
    ),
    'people', coalesce((
      SELECT jsonb_agg(x ORDER BY x.uses DESC, x.extra DESC) FROM (
        SELECT u.user_id,
               (SELECT c.full_name FROM public.clients c WHERE c.user_id = u.user_id ORDER BY c.created_at DESC LIMIT 1) AS name,
               public.ai_credit_tier(u.user_id) AS tier,
               u.uses, u.cost_usd,
               coalesce((SELECT w.extra FROM public.ai_credit_wallets w WHERE w.user_id = u.user_id), 0) AS extra,
               (public.ai_credit_state(u.user_id) ->> 'left')::int AS "left"
          FROM (
            SELECT user_id, count(*) FILTER (WHERE coalesce(status, '') <> 'refunded') AS uses, coalesce(sum(cost_usd), 0) AS cost_usd
              FROM public.ai_credit_events WHERE kind = 'use' AND created_at >= since
             GROUP BY user_id
            UNION
            SELECT w.user_id, 0, 0 FROM public.ai_credit_wallets w
             WHERE w.extra > 0 AND NOT EXISTS (SELECT 1 FROM public.ai_credit_events e WHERE e.user_id = w.user_id AND e.kind = 'use' AND e.created_at >= since)
          ) u
         ORDER BY u.uses DESC LIMIT 25
      ) x
    ), '[]'::jsonb),
    'purchases', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'user_id', p.user_id,
        'name', (SELECT c.full_name FROM public.clients c WHERE c.user_id = p.user_id ORDER BY c.created_at DESC LIMIT 1),
        'pack', p.pack, 'credits', p.credits, 'amount_minor', p.amount_minor, 'tax_minor', p.tax_minor,
        'total_minor', p.total_minor, 'currency', p.currency, 'status', p.status, 'mode', p.stripe_mode, 'at', p.paid_at
      ) ORDER BY p.paid_at DESC)
        FROM (SELECT * FROM public.ai_credit_purchases ORDER BY paid_at DESC LIMIT 15) p
    ), '[]'::jsonb)
  );
END $$;

-- Internal helpers: nobody calls these from the app.
REVOKE ALL ON FUNCTION public.ai_credit_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credit_tier(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credit_allowance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credit_wallet_lock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credit_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credit_detail(uuid) FROM PUBLIC, anon, authenticated;
-- Server only: spending, refunds and purchases.
REVOKE ALL ON FUNCTION public.ai_credits_use(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credits_settle(uuid, boolean, text, integer, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credits_record_purchase(uuid, text, integer, integer, integer, integer, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_credits_record_refund(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credit_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_tier(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_allowance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_wallet_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_detail(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_use(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_settle(uuid, boolean, text, integer, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_record_purchase(uuid, text, integer, integer, integer, integer, text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_record_refund(text, integer) TO service_role;
-- Signed in: each checks who's asking.
REVOKE ALL ON FUNCTION public.ai_credits_mine() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_credits_for_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_credits_admin_grant(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_credits_set_allowances(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_credits_overview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_credits_mine() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_for_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_credits_admin_grant(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credits_set_allowances(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_credits_overview(integer) TO authenticated;
