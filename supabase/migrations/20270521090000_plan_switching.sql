-- Plan switching (Nov 23 2026): everyone moves between Free, a paid
-- membership and the coaching packages from Account → Your plan, on one
-- account, keeping every record they have.
--
--   * coaching_packages.kind gains 'membership' (a paid self-serve plan). None
--     exists yet; one can be sold only once it's active, linked to a Stripe
--     monthly price whose amount matches (the app checks, plan-engine.ts).
--   * plan_changes: every plan change, past and scheduled, one row each:
--     a checkout waiting to be paid, an upgrade waiting on its charge, a
--     downgrade or cancel scheduled for the end of the paid month, what was
--     applied and when, what was undone, what failed and why, and the requests
--     a client on a custom arrangement sent their coach. At most one change in
--     flight per client (a unique index). Written only by the server; a client
--     reads their own rows, staff their clients'.
--   * plan_apply_tier(): the one place a plan change moves someone between
--     coaching and self-serve. It never deletes anything: workouts, logs, PRs,
--     bodyweight, nutrition, photos, messages and programs stay; coaching-only
--     screens and jobs follow service_tier (COACHING_ONLY, every coaching job
--     filters service_tier = 'coaching'), and a member's app access follows
--     app_members (member_can_consume). Never for an archived, deactivated or
--     deleted account.
--   * pg_cron 'plan-changes-tick' wakes the plan-changes-tick hook every 10
--     minutes, only while a change is due or waiting.

SET lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- A paid membership is a package kind
-- ---------------------------------------------------------------------------
ALTER TABLE public.coaching_packages DROP CONSTRAINT IF EXISTS coaching_packages_kind_check;
ALTER TABLE public.coaching_packages
  ADD CONSTRAINT coaching_packages_kind_check CHECK (kind IN ('free', 'membership', 'subscription', 'one_time'));

-- ---------------------------------------------------------------------------
-- The record of every plan change
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('start', 'upgrade', 'downgrade', 'cancel', 'reactivate', 'request', 'end')),
  status text NOT NULL CHECK (status IN ('checkout', 'processing', 'awaiting_payment', 'scheduled', 'applied', 'cancelled', 'failed', 'requested')),
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'admin', 'stripe', 'system')),
  from_package_id uuid REFERENCES public.coaching_packages(id) ON DELETE SET NULL,
  to_package_id uuid REFERENCES public.coaching_packages(id) ON DELETE SET NULL,
  from_family text CHECK (from_family IS NULL OR from_family IN ('free', 'membership', 'coaching', 'custom')),
  to_family text CHECK (to_family IS NULL OR to_family IN ('free', 'membership', 'coaching')),
  from_label text CHECK (from_label IS NULL OR char_length(from_label) <= 120),
  to_label text CHECK (to_label IS NULL OR char_length(to_label) <= 120),
  from_price_cents integer,
  to_price_cents integer,
  -- when it takes effect (a scheduled change) or took effect
  effective_at timestamptz,
  sale_id uuid REFERENCES public.purchase_records(id) ON DELETE SET NULL,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  stripe_invoice_id text,
  stripe_from_price_id text,
  stripe_to_price_id text,
  -- the proration date the client's preview used (an upgrade is charged what they were shown)
  proration_date bigint,
  amount_due_now_cents integer,
  next_amount_cents integer,
  -- the coach they had, so coming back to coaching goes to the same coach
  previous_coach_id uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
  warnings text[] NOT NULL DEFAULT '{}',
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  requested_by uuid,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  cancelled_at timestamptz
);

-- One change in flight per client: never two checkouts, never a downgrade and an upgrade at once.
CREATE UNIQUE INDEX IF NOT EXISTS plan_changes_one_open
  ON public.plan_changes (client_id) WHERE status IN ('checkout', 'processing', 'awaiting_payment', 'scheduled');
CREATE INDEX IF NOT EXISTS plan_changes_client_idx ON public.plan_changes (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plan_changes_due_idx ON public.plan_changes (status, effective_at)
  WHERE status IN ('checkout', 'processing', 'awaiting_payment', 'scheduled');
CREATE INDEX IF NOT EXISTS plan_changes_sub_idx ON public.plan_changes (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS plan_changes_session_idx ON public.plan_changes (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_plan_changes_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'applied' AND NEW.applied_at IS NULL THEN NEW.applied_at := now(); END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at := now(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS plan_changes_touch ON public.plan_changes;
CREATE TRIGGER plan_changes_touch BEFORE INSERT OR UPDATE ON public.plan_changes
  FOR EACH ROW EXECUTE FUNCTION public.tg_plan_changes_touch();

ALTER TABLE public.plan_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read their own plan changes" ON public.plan_changes;
CREATE POLICY "Clients read their own plan changes" ON public.plan_changes
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff read plan changes" ON public.plan_changes;
CREATE POLICY "Staff read plan changes" ON public.plan_changes
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

-- No insert / update / delete policies: only the server writes the record.
REVOKE INSERT, UPDATE, DELETE ON public.plan_changes FROM anon, authenticated;
GRANT SELECT ON public.plan_changes TO authenticated;

-- ---------------------------------------------------------------------------
-- Moving someone between coaching and self-serve, keeping everything
-- ---------------------------------------------------------------------------
-- _family: 'coaching' | 'membership' | 'free'. _coach_id: the coach a client
-- coming (back) to coaching gets (null keeps who they had). Returns what it
-- did. Raises (rolling everything back) when a member's access can't be set,
-- so nobody is left between the two.
CREATE OR REPLACE FUNCTION public.plan_apply_tier(_client_id uuid, _family text, _coach_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.clients%ROWTYPE;
  m_id uuid;
  v_sub text;
  v_was_coached boolean;
BEGIN
  IF _family NOT IN ('coaching', 'membership', 'free') THEN
    RAISE EXCEPTION 'plan_apply_tier: unknown family %', _family USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = _client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'no_client');
  END IF;
  -- a deactivated, archived or deleted account keeps its hold (account_lifecycle owns it)
  IF coalesce(c.archived, false) OR coalesce(c.status, '') IN ('Deactivated', 'Deleted', 'Archived') THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'inactive');
  END IF;

  IF _family = 'coaching' THEN
    -- someone who's been coached before comes back as Active, a first-timer as New Client
    v_was_coached := EXISTS (
      SELECT 1 FROM public.coaching_package_enrollments e
        JOIN public.coaching_packages p ON p.id = e.package_id
       WHERE e.client_id = _client_id AND p.kind = 'subscription' AND e.status = 'ended'
    ) OR coalesce(c.status, '') NOT IN ('Member', 'Lead', '');
    UPDATE public.clients
       SET service_tier = 'coaching',
           status = CASE WHEN c.service_tier = 'coaching' THEN c.status
                         WHEN v_was_coached THEN 'Active' ELSE 'New Client' END,
           assigned_coach_id = coalesce(_coach_id, c.assigned_coach_id)
     WHERE id = _client_id;
    RETURN jsonb_build_object('ok', true, 'tier', 'coaching', 'coach', coalesce(_coach_id, c.assigned_coach_id));
  END IF;

  -- free or membership: self-serve, no coach, member access on
  UPDATE public.clients
     SET service_tier = 'self_serve',
         status = 'Member',
         assigned_coach_id = NULL,
         -- the "Coaching package" text follows their package (a membership's enrollment writes its name)
         coaching_package = CASE WHEN _family = 'free' THEN NULL ELSE c.coaching_package END
   WHERE id = _client_id;

  IF c.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tier', 'self_serve', 'member', 'no_login');
  END IF;
  v_sub := CASE WHEN _family = 'membership' THEN 'Active' ELSE 'Free' END;

  SELECT id INTO m_id FROM public.app_members WHERE user_id = c.user_id FOR UPDATE;
  IF m_id IS NULL AND c.email IS NOT NULL THEN
    SELECT id INTO m_id FROM public.app_members
     WHERE lower(email) = lower(c.email) AND user_id IS NULL
     FOR UPDATE;
  END IF;
  IF m_id IS NOT NULL THEN
    UPDATE public.app_members
       SET user_id = c.user_id,
           account_type = 'jf_member',
           status = 'Active',
           subscription_status = v_sub
     WHERE id = m_id;
  ELSE
    INSERT INTO public.app_members (user_id, email, full_name, account_type, status, subscription_status)
    VALUES (c.user_id, c.email, coalesce(nullif(btrim(c.full_name), ''), c.email, 'Member'), 'jf_member', 'Active', v_sub)
    RETURNING id INTO m_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'tier', 'self_serve', 'member', m_id, 'subscription_status', v_sub);
END;
$$;
REVOKE ALL ON FUNCTION public.plan_apply_tier(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_apply_tier(uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The tick: applies scheduled changes on their day, settles upgrades waiting
-- on a payment, expires checkouts nobody finished. Only while something waits.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('plan-changes-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'plan-changes-tick');
  PERFORM cron.schedule('plan-changes-tick', '*/10 * * * *', $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/plan-changes-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
    WHERE EXISTS (
      SELECT 1 FROM public.plan_changes
       WHERE status IN ('checkout', 'processing', 'awaiting_payment')
          OR (status = 'scheduled' AND effective_at <= now() + interval '10 minutes')
    );
  $cmd$);
END $$;
