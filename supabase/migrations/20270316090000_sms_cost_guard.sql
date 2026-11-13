-- SMS cost guard (Nov 13 2026).
--
-- Every text the app sends now goes through one server-side sender
-- (src/lib/sms-gateway.server.ts), and that sender asks this database first:
-- public.sms_claim() decides, under one lock, whether the text may go out
-- (master switch, the separate account-security switch, opt-out, +1 numbers
-- only, idempotency key, retry limit, per-client daily cap, monthly budget and
-- hard cap) and writes the sms_log row before Twilio is called. Two workers can
-- never send the same text twice, and two can never both squeeze past the
-- budget.
--
-- Why: the app had ~10 copies of its own Twilio sender, each with its own (or
-- no) limits. Staff alerts logged under kind 'admin_alert', which the kind check
-- below refused, so those texts went out unlogged and their dedupe never held;
-- the "client couldn't load their workout" alert texted the coach on every
-- report; nothing capped monthly spend; nothing recorded segments, cost or
-- whether Twilio delivered a text.
--
-- Money: Twilio bills in USD per segment (Canada long code ~$0.0079 + carrier
-- surcharge ~$0.0067-0.0087 = ~$0.0161) plus the phone number (~$1.15/month).
-- The budget is in CAD; usd_to_cad converts. Months are UTC calendar months,
-- the same months Twilio's own usage records use.

-- ── sms_log: lifecycle, idempotency and cost ────────────────────────────────
ALTER TABLE public.sms_log DROP CONSTRAINT IF EXISTS sms_log_kind_check;
ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_kind_check
  CHECK (kind = ANY (ARRAY['manual','reminder','automation','bulk','session','admin_alert','security','test']));

ALTER TABLE public.sms_log
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS idempotency_base text,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS segments integer,
  ADD COLUMN IF NOT EXISTS est_cost_usd numeric(10,5),
  ADD COLUMN IF NOT EXISTS price_usd numeric(10,5),
  ADD COLUMN IF NOT EXISTS price_unit text,
  ADD COLUMN IF NOT EXISTS twilio_status text,
  ADD COLUMN IF NOT EXISTS error_code integer,
  ADD COLUMN IF NOT EXISTS status_checks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

COMMENT ON COLUMN public.sms_log.idempotency_key IS
  'Unique while the text is queued, sent or settled (blocked). A failed send frees it (set to NULL) so a retry can claim it; idempotency_base keeps the key for counting attempts.';
COMMENT ON COLUMN public.sms_log.est_cost_usd IS
  'Estimated Twilio cost (segments x sms_settings.price_per_segment_usd). 0 when Twilio refused the API call (not billed).';
COMMENT ON COLUMN public.sms_log.price_usd IS
  'What Twilio says it billed for the message (positive), read back after sending.';

CREATE UNIQUE INDEX IF NOT EXISTS sms_log_idempotency_key_uniq
  ON public.sms_log (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_log_idempotency_base_idx
  ON public.sms_log (idempotency_base) WHERE idempotency_base IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_log_created_at_idx ON public.sms_log (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_log_client_recent_idx ON public.sms_log (client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_log_status_poll_idx
  ON public.sms_log (created_at) WHERE twilio_sid IS NOT NULL AND price_usd IS NULL;

-- Rough segment count (GSM-7: 160 / 153 a part; anything else: 70 / 67).
CREATE OR REPLACE FUNCTION public.sms_segment_count(_body text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce(_body, '') = '' THEN 0
    WHEN _body ~ '^[\n\r -~]*$' THEN CASE WHEN length(_body) <= 160 THEN 1 ELSE ceil(length(_body) / 153.0)::int END
    ELSE CASE WHEN length(_body) <= 70 THEN 1 ELSE ceil(length(_body) / 67.0)::int END
  END
$$;

-- History: name every old row's category and estimate what it cost, so the
-- dashboard's first month isn't empty.
UPDATE public.sms_log SET category = CASE
    WHEN kind = 'session' THEN 'session'
    WHEN kind = 'reminder' THEN 'reminder'
    WHEN kind = 'bulk' THEN 'bulk'
    WHEN kind = 'automation' AND automation_trigger = 'payment_setup_reminder' THEN 'payment'
    WHEN kind = 'automation' THEN 'automation'
    WHEN body LIKE '[password reset%' THEN 'security'
    ELSE 'manual'
  END
WHERE category IS NULL;

UPDATE public.sms_log SET segments = greatest(public.sms_segment_count(body), 1)
WHERE segments IS NULL AND twilio_sid IS NOT NULL;

UPDATE public.sms_log SET est_cost_usd = segments * 0.0161, sent_at = created_at, twilio_status = coalesce(twilio_status, 'accepted')
WHERE est_cost_usd IS NULL AND twilio_sid IS NOT NULL;

-- ── sms_settings: budget and policy ─────────────────────────────────────────
ALTER TABLE public.sms_settings
  ADD COLUMN IF NOT EXISTS monthly_budget_cad numeric(10,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS price_per_segment_usd numeric(10,5) NOT NULL DEFAULT 0.0161,
  ADD COLUMN IF NOT EXISTS number_fee_usd numeric(10,2) NOT NULL DEFAULT 1.15,
  ADD COLUMN IF NOT EXISTS usd_to_cad numeric(6,4) NOT NULL DEFAULT 1.38,
  ADD COLUMN IF NOT EXISTS client_daily_cap integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS security_texts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_prefixes text[] NOT NULL DEFAULT ARRAY['+1'],
  ADD COLUMN IF NOT EXISTS budget_alerts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS twilio_usage jsonb;

ALTER TABLE public.sms_settings DROP CONSTRAINT IF EXISTS sms_settings_budget_check;
ALTER TABLE public.sms_settings ADD CONSTRAINT sms_settings_budget_check
  CHECK (monthly_budget_cad >= 1 AND monthly_budget_cad <= 10000
         AND price_per_segment_usd > 0 AND price_per_segment_usd < 1
         AND usd_to_cad > 0.5 AND usd_to_cad < 3
         AND number_fee_usd >= 0 AND client_daily_cap BETWEEN 1 AND 20);

-- The "still waiting for you to read my message" second text: of the 20 sent in
-- the 60 days to Nov 13 2026, 4 were read within 2 hours (average 11-95 hours
-- later), and 11 of the 20 went to people with push. It stays one tap away in
-- Settings → SMS.
UPDATE public.sms_settings s
SET reminder_steps = (
  SELECT jsonb_agg(CASE WHEN t.ord > 1 THEN t.elem || '{"enabled": false}'::jsonb ELSE t.elem END ORDER BY t.ord)
  FROM jsonb_array_elements(s.reminder_steps) WITH ORDINALITY AS t(elem, ord)
)
WHERE jsonb_typeof(s.reminder_steps) = 'array' AND jsonb_array_length(s.reminder_steps) > 1;

-- ── The month (UTC, like Twilio's usage records) ────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_month_start(_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$ SELECT date_trunc('month', _at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' $$;

-- What this month has cost so far, in USD: every text Twilio accepted (or that
-- is being sent right now), at the higher of Twilio's price and the estimate,
-- plus the phone number, and never less than Twilio's own month total once
-- it's been read.
CREATE OR REPLACE FUNCTION public.sms_month_spend_usd()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.sms_settings%ROWTYPE;
  v_ledger numeric;
  v_mkey text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  SELECT * INTO s FROM public.sms_settings WHERE singleton = true LIMIT 1;
  SELECT coalesce(sum(greatest(coalesce(price_usd, 0), coalesce(est_cost_usd, 0))), 0)
    INTO v_ledger
    FROM public.sms_log
   WHERE created_at >= public.sms_month_start(now())
     AND (twilio_sid IS NOT NULL OR status = 'queued');
  v_ledger := v_ledger + coalesce(s.number_fee_usd, 0);
  IF s.twilio_usage IS NOT NULL AND s.twilio_usage->>'month' = v_mkey
     AND (s.twilio_usage->>'total_usd') ~ '^[0-9.]+$' THEN
    v_ledger := greatest(v_ledger, (s.twilio_usage->>'total_usd')::numeric);
  END IF;
  RETURN v_ledger;
END;
$$;

-- ── sms_claim: may this text go out? ────────────────────────────────────────
-- Categories: security (account access: recovery, setup / sign-in links,
-- invites) has its own switch and is never stopped by the budget; session
-- (PT reminders and last-minute changes), manual (a coach's own text) and test
-- are essential: they stop only at the hard cap (2x the budget). Everything
-- else (reminder, payment, automation, staff_alert, bulk) stops at the budget.
-- reminder / payment / automation / bulk / session also count toward the
-- per-client daily cap.
CREATE OR REPLACE FUNCTION public.sms_claim(
  _category text,
  _kind text,
  _to text,
  _body text,
  _segments integer,
  _key text DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _member_id uuid DEFAULT NULL,
  _message_id uuid DEFAULT NULL,
  _pt_session_id uuid DEFAULT NULL,
  _automation_id uuid DEFAULT NULL,
  _automation_trigger text DEFAULT NULL,
  _sender_user_id uuid DEFAULT NULL,
  _reminder_step integer DEFAULT NULL,
  _max_attempts integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.sms_settings%ROWTYPE;
  v_essential boolean := _category IN ('security', 'session', 'manual', 'test');
  v_capped boolean := _category IN ('reminder', 'payment', 'automation', 'bulk', 'session');
  v_mkey text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_segments integer := greatest(coalesce(_segments, 1), 1);
  v_cost numeric;
  v_spent numeric;
  v_budget numeric;
  v_reason text;
  v_id uuid;
  v_n integer;
  v_alerted jsonb;
  v_crossed integer;
  v_t integer;
BEGIN
  IF _category NOT IN ('security','session','manual','test','reminder','payment','automation','staff_alert','bulk') THEN
    RAISE EXCEPTION 'Unknown SMS category %', _category;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('public.sms_claim'));
  SELECT * INTO s FROM public.sms_settings WHERE singleton = true LIMIT 1;
  v_cost := v_segments * coalesce(s.price_per_segment_usd, 0.0161);
  v_spent := public.sms_month_spend_usd();
  v_budget := coalesce(s.monthly_budget_cad, 10) / nullif(coalesce(s.usd_to_cad, 1.38), 0);

  IF s.id IS NULL THEN
    v_reason := 'not_configured';
  ELSIF s.from_phone IS NULL OR btrim(s.from_phone) = '' THEN
    v_reason := 'no_from_phone';
  ELSIF _category = 'security' AND NOT s.security_texts_enabled THEN
    v_reason := 'security_texts_off';
  ELSIF _category NOT IN ('security', 'test') AND NOT s.enabled THEN
    v_reason := 'sms_disabled';
  ELSIF _to IS NULL OR _to !~ '^\+[0-9]{8,15}$' THEN
    v_reason := 'no_phone';
  ELSIF NOT EXISTS (SELECT 1 FROM unnest(s.allowed_prefixes) p WHERE left(_to, length(p)) = p) THEN
    v_reason := 'country_not_allowed';
  ELSIF _category <> 'security' AND _client_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.sms_opt_out) THEN
    v_reason := 'opted_out';
  ELSIF _category <> 'security' AND _member_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.app_members m WHERE m.id = _member_id AND m.sms_opt_out) THEN
    v_reason := 'opted_out';
  END IF;

  -- Idempotency: the same text (same key) goes out once, ever.
  IF v_reason IS NULL AND _key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.sms_log WHERE idempotency_key = _key) THEN
      INSERT INTO public.sms_log (client_id, app_member_id, message_id, pt_session_id, automation_id, automation_trigger,
        sender_user_id, reminder_step, to_phone, body, kind, category, status, error, blocked_reason,
        idempotency_base, segments)
      VALUES (_client_id, _member_id, _message_id, _pt_session_id, _automation_id, _automation_trigger,
        _sender_user_id, _reminder_step, coalesce(_to, ''), '', _kind, _category, 'skipped', 'duplicate', 'duplicate',
        _key, v_segments);
      RETURN jsonb_build_object('decision', 'blocked', 'reason', 'duplicate');
    END IF;
    SELECT count(*) INTO v_n FROM public.sms_log WHERE idempotency_base = _key AND status = 'failed';
    IF v_n >= greatest(coalesce(_max_attempts, 3), 1) THEN v_reason := 'retry_limit'; END IF;
  END IF;

  -- Account-security texts: at most 5 to one number a day (no SMS pumping).
  IF v_reason IS NULL AND _category = 'security' THEN
    SELECT count(*) INTO v_n FROM public.sms_log
     WHERE to_phone = _to AND category = 'security' AND created_at > now() - interval '24 hours'
       AND (twilio_sid IS NOT NULL OR status = 'queued');
    IF v_n >= 5 THEN v_reason := 'security_daily_cap'; END IF;
  END IF;

  -- Automatic texts: at most client_daily_cap a person a day.
  IF v_reason IS NULL AND v_capped AND (_client_id IS NOT NULL OR _member_id IS NOT NULL) THEN
    SELECT count(*) INTO v_n FROM public.sms_log
     WHERE ((_client_id IS NOT NULL AND client_id = _client_id) OR (_member_id IS NOT NULL AND app_member_id = _member_id))
       AND category IN ('reminder', 'payment', 'automation', 'bulk', 'session')
       AND created_at > now() - interval '24 hours'
       AND (twilio_sid IS NOT NULL OR status = 'queued');
    IF v_n >= coalesce(s.client_daily_cap, 3) THEN v_reason := 'client_daily_cap'; END IF;
  END IF;

  -- Budget: nonessential texts stop at 100%; everything but security at 2x.
  IF v_reason IS NULL AND _category <> 'security' THEN
    IF v_spent + v_cost > v_budget * 2 THEN
      v_reason := 'hard_cap';
    ELSIF NOT v_essential AND v_spent + v_cost > v_budget THEN
      v_reason := 'budget';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- Settled: a blocked text keeps its key, so the same text isn't tried again.
    INSERT INTO public.sms_log (client_id, app_member_id, message_id, pt_session_id, automation_id, automation_trigger,
      sender_user_id, reminder_step, to_phone, body, kind, category, status, error, blocked_reason,
      idempotency_key, idempotency_base, segments)
    VALUES (_client_id, _member_id, _message_id, _pt_session_id, _automation_id, _automation_trigger,
      _sender_user_id, _reminder_step, coalesce(_to, ''), coalesce(_body, ''), _kind, _category, 'skipped', v_reason, v_reason,
      _key, _key, v_segments)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('decision', 'blocked', 'reason', v_reason, 'id', v_id);
  END IF;

  INSERT INTO public.sms_log (client_id, app_member_id, message_id, pt_session_id, automation_id, automation_trigger,
    sender_user_id, reminder_step, to_phone, body, kind, category, status,
    idempotency_key, idempotency_base, segments, est_cost_usd)
  VALUES (_client_id, _member_id, _message_id, _pt_session_id, _automation_id, _automation_trigger,
    _sender_user_id, _reminder_step, _to, coalesce(_body, ''), _kind, _category, 'queued',
    _key, _key, v_segments, v_cost)
  RETURNING id INTO v_id;

  -- 50 / 80 / 100 % of the budget, each once a month.
  v_alerted := coalesce(s.budget_alerts -> v_mkey, '[]'::jsonb);
  FOREACH v_t IN ARRAY ARRAY[50, 80, 100] LOOP
    IF v_spent + v_cost >= v_budget * v_t / 100.0 AND NOT (v_alerted @> to_jsonb(v_t)) THEN
      v_alerted := v_alerted || to_jsonb(v_t);
      v_crossed := v_t;
    END IF;
  END LOOP;
  IF v_crossed IS NOT NULL THEN
    UPDATE public.sms_settings SET budget_alerts = jsonb_build_object(v_mkey, v_alerted) WHERE id = s.id;
  END IF;

  RETURN jsonb_build_object(
    'decision', 'send',
    'id', v_id,
    'from', s.from_phone,
    'crossed', v_crossed,
    'spent_usd', round(v_spent + v_cost, 4),
    'budget_usd', round(v_budget, 4)
  );
END;
$$;

-- The sender reports back: Twilio took it (sid) or refused it (not billed).
CREATE OR REPLACE FUNCTION public.sms_finish(_id uuid, _sid text, _error text DEFAULT NULL, _error_code integer DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.sms_log
     SET status = CASE WHEN _sid IS NOT NULL THEN 'sent' ELSE 'failed' END,
         twilio_sid = _sid,
         twilio_status = CASE WHEN _sid IS NOT NULL THEN 'accepted' END,
         sent_at = CASE WHEN _sid IS NOT NULL THEN now() END,
         error = left(_error, 500),
         error_code = _error_code,
         est_cost_usd = CASE WHEN _sid IS NOT NULL THEN est_cost_usd ELSE 0 END,
         idempotency_key = CASE WHEN _sid IS NOT NULL THEN idempotency_key END
   WHERE id = _id AND status = 'queued'
$$;

REVOKE ALL ON FUNCTION public.sms_claim(text, text, text, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sms_finish(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sms_month_spend_usd() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_claim(text, text, text, text, integer, text, uuid, uuid, uuid, uuid, uuid, text, uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sms_finish(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sms_month_spend_usd() TO service_role;

-- ── The admin's cost dashboard (Settings → SMS) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_cost_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.sms_settings%ROWTYPE;
  v_from timestamptz := public.sms_month_start(now());
  v_result jsonb;
BEGIN
  IF NOT (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  SELECT * INTO s FROM public.sms_settings WHERE singleton = true LIMIT 1;

  WITH m AS (
    SELECT l.*,
           (l.twilio_sid IS NOT NULL OR l.status = 'queued') AS billed,
           greatest(coalesce(l.price_usd, 0), coalesce(l.est_cost_usd, 0)) AS cost
      FROM public.sms_log l
     WHERE l.created_at >= v_from
  )
  SELECT jsonb_build_object(
    'month', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
    'spent_usd', public.sms_month_spend_usd(),
    'totals', (SELECT jsonb_build_object(
        'texts', count(*) FILTER (WHERE billed),
        'segments', coalesce(sum(segments) FILTER (WHERE billed), 0),
        'messages_usd', round(coalesce(sum(cost) FILTER (WHERE billed), 0), 4),
        'priced', count(*) FILTER (WHERE price_usd IS NOT NULL),
        'priced_usd', round(coalesce(sum(price_usd), 0), 4),
        'delivered', count(*) FILTER (WHERE twilio_status = 'delivered'),
        'undelivered', count(*) FILTER (WHERE twilio_status IN ('undelivered', 'failed')),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'duplicates', count(*) FILTER (WHERE blocked_reason = 'duplicate'),
        'budget_blocked', count(*) FILTER (WHERE blocked_reason IN ('budget', 'hard_cap')),
        'capped', count(*) FILTER (WHERE blocked_reason IN ('client_daily_cap', 'security_daily_cap', 'retry_limit', 'country_not_allowed')),
        'by_push', count(*) FILTER (WHERE blocked_reason = 'push_delivered')
      ) FROM m),
    'by_category', (SELECT coalesce(jsonb_agg(x ORDER BY x.cost DESC, x.texts DESC), '[]'::jsonb) FROM (
        SELECT coalesce(category, kind) AS category,
               count(*) FILTER (WHERE billed) AS texts,
               coalesce(sum(segments) FILTER (WHERE billed), 0) AS segments,
               round(coalesce(sum(cost) FILTER (WHERE billed), 0), 4) AS cost,
               count(*) FILTER (WHERE blocked_reason IS NOT NULL) AS prevented
          FROM m GROUP BY 1) x),
    'by_person', (SELECT coalesce(jsonb_agg(x ORDER BY x.cost DESC), '[]'::jsonb) FROM (
        SELECT m.client_id, m.app_member_id,
               coalesce(c.full_name, am.full_name, 'Staff / other') AS name,
               count(*) AS texts,
               coalesce(sum(m.segments), 0) AS segments,
               round(sum(m.cost), 4) AS cost
          FROM m
          LEFT JOIN public.clients c ON c.id = m.client_id
          LEFT JOIN public.app_members am ON am.id = m.app_member_id
         WHERE m.billed
         GROUP BY 1, 2, 3
         ORDER BY round(sum(m.cost), 4) DESC
         LIMIT 10) x),
    'history', (SELECT coalesce(jsonb_agg(x ORDER BY x.month), '[]'::jsonb) FROM (
        SELECT to_char(date_trunc('month', l.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
               count(*) AS texts,
               coalesce(sum(l.segments), 0) AS segments,
               round(coalesce(sum(greatest(coalesce(l.price_usd, 0), coalesce(l.est_cost_usd, 0))), 0), 4) AS cost
          FROM public.sms_log l
         WHERE l.created_at >= public.sms_month_start(now()) - interval '5 months'
           AND l.twilio_sid IS NOT NULL
         GROUP BY 1) x)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.sms_cost_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sms_cost_summary() TO authenticated, service_role;
