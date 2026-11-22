# Stripe Connect for independent coaches: decision record

Status: **decided in principle, not built** (Nov 22 2026). Building waits for
the founding-coach pilot to confirm demand, for counsel's review of the coach
agreements, and for the Phase 3 isolation gate (docs/COACHING_PLATFORM.md).

## The decision

- **Who charges whom.** JF Effect's own clients (and JF Effect team coaches'
  clients) stay on JF Effect's Stripe account, exactly as today. An
  independent coach's clients are charged by the coach's own business.
- **Account type: Standard connected accounts.** The coach owns the Stripe
  account, signs Stripe's agreement directly, sees their own dashboard,
  handles their own payouts, refunds, disputes and tax registration. JF
  Effect never holds their funds.
- **Charge type: direct charges** on the connected account (`Stripe-Account`
  header). The coach is the merchant of record: their name on the statement,
  their Stripe Tax settings, their liability for disputes.
- **Platform fee: 0%** (processor charges aside). The code leaves room for a
  disclosed `application_fee_amount` later, defaulting to none.
- **JF Effect's subscription to coaches** (founding price CAD $79/month) is a
  normal subscription on JF Effect's own account, separate from anything a
  coach's clients pay.

## Why not the alternatives

| Option | Why not (now) |
| --- | --- |
| Express / Custom accounts | JF Effect would carry the coach's onboarding, support and much of the dispute and compliance burden, for a pilot of a few coaches |
| Destination charges / separate charges and transfers | JF Effect becomes merchant of record for another business's coaching, with refund and dispute liability and its own name on the statement |
| Charging on JF Effect's account and paying coaches out | Mixes another business's revenue into JF Effect's books and GST/HST |

## What the build needs (Phase 5)

1. Connect enabled on JF Effect's Stripe account, with the platform profile
   approved by Stripe.
2. One account context in code: `stripeFetch(path, { stripeAccount })` sends
   `Stripe-Account`. The 7 files that call Stripe without the shared helper
   move onto it first (listed in docs/COACHING_PLATFORM.md).
3. `coach_stripe_accounts` (organization, account id, onboarding state,
   charges / payouts enabled), Stripe-hosted onboarding links, the account's
   own Stripe Tax set up before any checkout.
4. A nullable `stripe_account_id` on sales, payments, products and auto-pay
   changes (null = JF Effect). Customers kept per account.
5. A separate Connect webhook endpoint with its own signing secret, routed by
   `event.account`, matching sales only within that account, with the
   Stripe-Version pinned and the same dedupe-release rule as the main webhook.
6. JF Effect's books, GST/HST and reports read `stripe_account_id IS NULL`
   only, so a coach's sales never reach the owner's numbers.
7. Test-mode end to end before anything live: onboarding, a product,
   checkout, subscription, refund, dispute, failed payment, webhook retry,
   with the owner's books unchanged.

## Risks to keep in view

- A coach's chargebacks and refunds are theirs, but a pattern of abuse can
  still put JF Effect's platform profile at risk: the platform agreement must
  let JF Effect suspend a coach.
- Each coach must register for GST/HST when their revenue requires it; the
  app shows their tax settings, it doesn't decide them.
- No coach's client data or payments may be visible to another organization:
  Connect only ships after the isolation gate passes.
