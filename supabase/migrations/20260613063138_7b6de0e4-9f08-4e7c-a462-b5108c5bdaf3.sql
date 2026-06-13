-- Phase 3: failed-payment grace period, subscription-ended lifecycle,
-- payment recovery, cross-account Stripe safety, and access-transition audit.
-- All additive: no existing column is dropped, renamed, or retyped; no
-- existing data, billing history, or member_access rows are rewritten.

-- 1. Grace-period + lifecycle timestamps on app_members
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS payment_failed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_grace_warning_at  timestamptz,
  ADD COLUMN IF NOT EXISTS payment_recovered_at   timestamptz,
  ADD COLUMN IF NOT EXISTS access_restricted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_ended_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_restart_attempt_at timestamptz,
  -- Cross-account Stripe safety guard. When Stripe returns "No such
  -- customer/subscription" for an ID we have on file, we set sync_warning_*
  -- and DO NOT mutate stripe_*_id, status, or member_access. cross_account_locked
  -- is an admin-set flag that hard-blocks Restart Membership and any further
  -- automated sync writes for known cross-account references.
  ADD COLUMN IF NOT EXISTS sync_warning_at        timestamptz,
  ADD COLUMN IF NOT EXISTS sync_warning_reason    text,
  ADD COLUMN IF NOT EXISTS cross_account_locked   boolean NOT NULL DEFAULT false;

-- 2. Configurable grace-period length (default 5 days)
ALTER TABLE public.jf_membership_settings
  ADD COLUMN IF NOT EXISTS grace_period_days integer NOT NULL DEFAULT 5;

-- 3. Member access-transition audit log (append-only). Records every
-- access flip we drive from billing (grace start, grace expiry, recovery,
-- subscription ended, restart granted, cross-account warning) so the
-- timeline is reconstructable without scanning Stripe.
CREATE TABLE IF NOT EXISTS public.member_access_transitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  event_kind   text NOT NULL CHECK (event_kind IN (
    'past_due_grace_started',
    'grace_warning_shown',
    'grace_expired_access_restricted',
    'payment_recovered',
    'subscription_ended',
    'membership_kept',
    'membership_restarted',
    'cross_account_warning',
    'sync_warning',
    'duplicate_subscription_blocked',
    'idempotent_replay'
  )),
  from_status  text,
  to_status    text,
  stripe_event_id text,
  stripe_subscription_id text,
  reason       text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.member_access_transitions TO authenticated;
GRANT ALL ON public.member_access_transitions TO service_role;

ALTER TABLE public.member_access_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read access transitions"
  ON public.member_access_transitions FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Member read own access transitions"
  ON public.member_access_transitions FOR SELECT
  TO authenticated
  USING (member_id IN (SELECT id FROM public.app_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS member_access_transitions_member_idx
  ON public.member_access_transitions (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS member_access_transitions_event_kind_idx
  ON public.member_access_transitions (event_kind, created_at DESC);

-- 4. Helpful index for "find members whose grace just expired"
CREATE INDEX IF NOT EXISTS app_members_grace_ends_idx
  ON public.app_members (grace_period_ends_at)
  WHERE grace_period_ends_at IS NOT NULL;
