# Payment links and reminders

## Links never expire on their own
A client's payment link is `https://jfeffect.com/pay/<token>`. Behind it sits a Stripe Checkout
Session, which Stripe expires after 24 hours at most. When the client taps the link:

1. sale already paid or cancelled: "already settled" page
2. explicit expiry date passed (`purchase_records.payment_link_expires_at`): "expired on <date>" page
3. stored session still open: redirect to it
4. otherwise: mint a fresh unpaid session for the same sale (keeping any discount) and redirect
   (`src/lib/payment-link-regenerate.server.ts`). One request mints at a time; a checkout the
   client already completed is never duplicated.

`payment_link_expires_at` is NULL by default = never expires. Set it per sale from the sale's
menu ("Set link expiry") only when the offer has a real deadline.

## Automatic reminders (database + one hook)
Only for sales that were sent a payment link in the chat and are still unpaid.

| When | What | Where |
|---|---|---|
| day 1 | chat reminder 1 | `run_payment_setup_reminders()` (cron `payment-setup-reminders`, :07/:37) |
| day 3 | one SMS "check your messages" | `payment_sms_due()` + hook `payment-reminder-sms` (cron, :12/:42) |
| day 6 | chat reminder 2 | same as day 1 |
| day 12 | chat reminder 3 (last) | same as day 1 |

Rules: only 11:30am-1:30pm or 5:30pm-7:30pm in the client's timezone (America/Winnipeg when
unknown); nothing within 24h of the client writing; waits are measured from the last payment-link
message, so a manual resend restarts the clock; sales whose link was sent more than 21 days ago are
ignored; the SMS is skipped for opted-out clients and never contains the pay link. Chat reminders
get a push notification from the same hook run.

Per sale: `payment_reminders_paused` (menu: Pause/Resume payment reminders),
`payment_reminder_count`, `last_payment_reminder_at`, `payment_sms_sent_at`, `payment_sms_attempts`.

## Operating it
- Dry run (sends nothing): `select public.run_payment_setup_reminders(true);` and
  `select * from public.payment_sms_due();`
- Hook auth: `x-reminder-secret`, a random secret in Vault (`payment_reminder_hook_secret`),
  independent of `SCHEDULED_WORKER_SECRET`.
- After adding or changing a database function the app calls over the API, run
  `notify pgrst, 'reload schema';`.
