-- Session packages on auto-pay: one Stripe subscription pays the client's
-- packages in order, oldest owed first, and stops only when nothing is owed.
--
-- Marc pays $160 + tax every 2 weeks on the subscription he signed up with for
-- his package 2. His packages 3 and 4 are renewals added "pay later" (no Stripe
-- payment of their own). Every subscription payment used to land on package 2
-- whatever it owed, and the webhook ended the subscription after its 4th
-- payment, so nothing in Stripe would ever have paid packages 3 and 4.
--
-- session_plan_payment_target(sale) answers "which package does this payment
-- go to": the subscription's own package and the same client's later
-- pay-later packages (no Stripe checkout, link, payment or subscription of
-- their own, not sold with a booking), the oldest that still owes anything
-- before tax. NULL when nothing is owed: then the subscription may end.

CREATE OR REPLACE FUNCTION public.session_plan_payment_target(_purchase_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT id, client_id, COALESCE(term_start_date, purchased_at::date, created_at::date) AS starts
      FROM public.purchase_records
     WHERE id = _purchase_id
       AND COALESCE(sessions_purchased, 0) > 0
       -- The server (webhook, sync) or an admin (Sync / Reconcile with Stripe).
       AND ((SELECT auth.uid()) IS NULL OR (SELECT public.has_role((SELECT auth.uid()), 'admin')))
  )
  SELECT p.id
    FROM public.purchase_records p
    JOIN base b ON b.client_id = p.client_id
   WHERE COALESCE(p.sessions_purchased, 0) > 0
     AND p.archived_at IS NULL
     AND COALESCE(p.payment_status, '') NOT IN ('Voided', 'Cancelled', 'Refunded', 'Complimentary')
     AND COALESCE(p.amount_outstanding_cents, 0) > 0
     AND (
       p.id = b.id
       OR (
         p.stripe_subscription_id IS NULL
         AND p.stripe_checkout_session_id IS NULL
         AND p.stripe_payment_link IS NULL
         AND p.stripe_payment_intent_id IS NULL
         AND COALESCE(p.offer_snapshot ->> 'source', '') <> 'booking'
         AND COALESCE(p.term_start_date, p.purchased_at::date, p.created_at::date) >= b.starts
       )
     )
   ORDER BY COALESCE(p.term_start_date, p.purchased_at::date, p.created_at::date), p.purchased_at, p.created_at
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.session_plan_payment_target(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_plan_payment_target(uuid) TO authenticated, service_role;

-- A daily check of every client on Stripe against the app (the stripe-sync
-- hook): a payment a webhook missed is recorded on the package it pays, and
-- each subscription's status and next charge date are refreshed.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'stripe-sync-daily';
  PERFORM cron.schedule(
    'stripe-sync-daily',
    '41 9 * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/stripe-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{"all": true}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
    $cmd$
  );
END $$;
