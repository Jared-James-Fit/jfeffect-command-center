# JF Membership — Self-Serve Signup, Billing & Access Protection

This is a large build. Below is the scoped plan. I'll implement it after approval.

## 0. What's already there (won't rebuild)

- `app_members`, `member_access`, `member_access_defaults`, `access_levels`, `apply_default_member_access()`, `member_has_access()` — done last turn.
- `jf_member` account type + JF default access checklist + access summary + subscription-restricted banner + upgrade-to-coaching prompt — done last turn.
- `src/routes/api/public/stripe-webhook.ts` — verifies signature, handles checkout/invoice/subscription events for coaching purchases.
- `src/lib/member-checkout.functions.ts` — creates Checkout Sessions for member-facing coaching products.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` secrets present.

I'll extend these, not replace them.

## 1. Database (one migration)

New columns on `app_members`:
- `stripe_customer_id text`, `stripe_subscription_id text`, `stripe_price_id text`
- `subscription_status text` (Trialing / Active / Past Due / Payment Failed / Paused / Hold Plan / Cancelled / Expired / Deactivated)
- `trial_end_at`, `current_period_end`, `cancel_at`, `cancelled_at`, `paused_until`, `hold_plan_started_at`
- `last_invoice_status`, `last_billing_event_at`
- `signup_ip inet`, `signup_user_agent text` (audit)

New table `jf_membership_settings` (single row, admin-editable):
- `monthly_price_id`, `monthly_price_display` (default "$29/month")
- `hold_price_id`, `hold_price_display` (default "$9/month")
- `trial_days int default 3`
- `upgrade_coaching_url text`, `support_email text`

New table `jf_billing_events` (audit log of every webhook applied):
- `stripe_event_id` (unique), `type`, `customer_id`, `subscription_id`, `member_id`, `payload jsonb`, `processed_at`.

New table `jf_trial_emails` (trial-abuse guard):
- `email_lc text unique`, `first_trial_at timestamptz` — set on first trial; blocks a second trial for the same email.

New SQL helpers (SECURITY DEFINER):
- `jf_member_has_full_access(_user_id uuid) returns boolean` — returns true only when account_type='jf_member' AND subscription_status IN ('Trialing','Active') AND not expired/deactivated.
- `tg_member_subscription_audit()` trigger — blocks client-side updates to `subscription_status`/`account_type`/`stripe_*` (only `service_role` or admins can write these fields; members can't self-promote).

RLS:
- `app_members`: members can SELECT their own row; UPDATE only allows non-billing fields (full_name, phone, prefs). Billing/status fields are service-role only.
- `member_access`: already locked; defaults are seeded by `apply_default_member_access()`.

## 2. Stripe wiring

`src/lib/jf-billing.functions.ts` (new) — server fns, all use `stripeFetch()` helper extracted into `src/lib/stripe.server.ts`:

- `getJfSettings()` — returns price IDs / display.
- `createJfSignupCheckout({ email, fullName, phone, password })` — public (no auth middleware): creates Stripe customer with email, opens Checkout Session in `subscription` mode with `trial_period_days=3`, `success_url=/m/welcome?session_id={CHECKOUT_SESSION_ID}`, `cancel_url=/signup/jf?cancelled=1`, stores pending signup in a short-lived `jf_pending_signups` row keyed by session_id with hashed password.
- `completeJfSignup({ sessionId })` — called from /m/welcome loader: retrieves session from Stripe, verifies `payment_status='paid' || status='complete'` or `subscription.status='trialing'`, creates auth user via `supabaseAdmin.auth.admin.createUser`, inserts `app_members` row with stripe ids + trialing status, calls `apply_default_member_access()`, deletes pending signup, signs the user in.
- `cancelJfMembership({ reason, details })` — sets `cancel_at_period_end=true` on subscription.
- `freezeJfMembership()` — uses Stripe `pause_collection.behavior='void'` with `resumes_at=now+30d`, sets `subscription_status='Paused'`, `paused_until=resumes_at`.
- `switchToHoldPlan()` — Stripe subscription update: swap price item to `hold_price_id`, `proration_behavior='none'`, mark `Hold Plan`.
- `reactivateFullMembership()` — swap price item back to `monthly_price_id`, clear pause_collection / cancel_at_period_end, mark `Active`.
- `openBillingPortal()` — Stripe Billing Portal session for the member.
- `syncStripeStatus({ memberId? })` — admin/self: re-fetches subscription, recomputes status, updates row.

`src/routes/api/public/stripe-webhook.ts` — extend to handle JF events (`mode='subscription'` checkout sessions with `metadata.kind='jf_membership'`):
- `checkout.session.completed` → trial start: ensure member row exists (called by completeJfSignup, but webhook is idempotent backstop).
- `customer.subscription.created/updated` → derive status: trialing/active/past_due/paused/canceled/hold-plan (price id == hold) → write to `app_members`.
- `customer.subscription.deleted` → `Cancelled`/`Expired` (after period end).
- `invoice.payment_succeeded` → `Active`, clear past_due.
- `invoice.payment_failed` → `Past Due` then `Payment Failed`.
- `customer.subscription.trial_will_end` → fire member notification.

Every webhook write goes through `jf_billing_events` (dedupe on `stripe_event_id`).

## 3. Public signup page

`src/routes/signup.jf.tsx` (public, SSR, with `head()` SEO):
- Hero, "$29/month — 3-day free trial", what's included / what's not, refund policy.
- Form: first/last name, email, phone (optional), password+confirm, terms checkbox, SMS consent (only if phone).
- Zod validation client+server.
- On submit: POST to `createJfSignupCheckout` → `window.location = url`.

Trial-abuse guard: before creating session, check `jf_trial_emails` table; if email already used a trial, force `trial_period_days=0` (must pay immediately) and tell the user.

## 4. Welcome / onboarding

`src/routes/_authenticated/m/welcome.tsx`:
- Loader calls `completeJfSignup({ sessionId })`.
- Shows: account created, status, trial end date, login email, access list, onboarding checklist (Complete profile / Choose plan / Browse exercises / Recipes / Notifications / Start first workout), support + refund link.

## 5. Member billing page

`src/routes/_authenticated/m/billing.tsx`:
- Shows current status / plan / price / trial end / next billing / payment status.
- Buttons: Cancel, Switch to Hold Plan, Freeze 30 Days, Reactivate (when paused/hold/cancelled).
- Open Stripe Billing Portal link.

## 6. Cancellation flow

`src/components/billing/cancel-flow.tsx` — 4-step dialog:
1. "Before you cancel" — what they'll lose; buttons Keep / Show options / Continue.
2. Retention options — Keep / Freeze 30 days / Switch to Hold Plan / Continue to cancel.
3. Optional reason (radio + text).
4. Final confirm — explains period-end behavior, Keep / Confirm.

Posts to the appropriate server fn per choice.

## 7. Server-side access protection

- `requireJfActive` middleware (new) — wraps any member-facing server fn. Calls `jf_member_has_full_access(auth.uid())`. If false → 403.
- Apply to: `listMemberPlans`, `listMemberResources`, `listMyEnrollments`, recipe/exercise/event/announcement member fetchers, group-chat read fns, progress-metrics writers.
- For loaders under `_authenticated/m/`: `useMemberAccess()` already gates UI; we add a server-side check in each loader-called server fn so URL-stuffing returns nothing.
- Public Stripe-products / signup page does NOT use the gate.

`src/routes/_authenticated/m/route.tsx` — already shows `SubscriptionRestrictedBanner`; extend to redirect away from protected child routes when `!hasAccess('app_membership')` (leave billing + welcome reachable).

## 8. Admin

`src/routes/_authenticated/admin/members.$memberId.tsx` — extend Access Summary card with:
- Billing block: status, plan (full vs Hold), trial end, next billing, cancel-at, paused-until, Stripe customer/subscription deep links.
- Actions: Sync Stripe Status, Switch to Hold, Freeze 30d, Reactivate, Cancel, Comp Access (manual grant), Resend setup email.

`src/routes/_authenticated/admin/members.index.tsx` — add JF Members tab columns: subscription_status, trial_end, next_billing, signup_date.

`src/routes/_authenticated/admin/settings.tsx` — JF Membership settings card (price IDs, trial days, display, upgrade URL).

## 9. Notifications

Reuse existing `email_sender_settings` queue. Templates added to `src/lib/email-templates/`:
- jf-welcome, jf-trial-ending, jf-payment-succeeded, jf-payment-failed, jf-cancelled, jf-frozen, jf-hold-plan, jf-resuming, jf-reactivated.

Admin notifications: insert a row into existing `admin_audit_log` + (if configured) send admin a digest email — non-blocking.

## 10. Upgrade-to-coaching

Existing `UpgradeToCoachingPrompt` component — wire its "Upgrade" button to the admin-configured `upgrade_coaching_url`, falling back to `/m/upgrade`.

## 11. Files to add / edit

```
supabase/migrations/<ts>_jf_billing.sql          NEW
src/lib/stripe.server.ts                          NEW (shared helpers)
src/lib/jf-billing.functions.ts                   NEW
src/lib/jf-settings.ts                            NEW (admin settings hook)
src/routes/signup.jf.tsx                          NEW (public)
src/routes/_authenticated/m/welcome.tsx           NEW
src/routes/_authenticated/m/billing.tsx           NEW
src/components/billing/cancel-flow.tsx            NEW
src/components/billing/billing-status-card.tsx    NEW
src/components/billing/jf-admin-billing-card.tsx  NEW
src/routes/api/public/stripe-webhook.ts           EDIT (JF event handlers)
src/routes/_authenticated/admin/members.$memberId.tsx EDIT (admin actions)
src/routes/_authenticated/admin/members.index.tsx EDIT (JF columns)
src/routes/_authenticated/admin/settings.tsx      EDIT (JF settings card)
src/routes/_authenticated/m/route.tsx             EDIT (redirect when no full access)
src/lib/member-plans.functions.ts                 EDIT (add requireJfActive)
src/lib/member-resources.functions.ts             EDIT (add requireJfActive)
src/lib/events.functions.ts                       EDIT (add requireJfActive on member fetchers)
src/lib/email-templates/jf-*.tsx                  NEW (×9)
```

## 12. Acceptance (matches your test checklist)

I'll verify each item in PART 25 manually after build via `invoke-server-function` and a test Stripe customer in `sandbox` mode. The four highest-risk items I will double-check before signing off:
1. URL-stuffing `/m/plans` while Cancelled → 403 from server fn, not just hidden.
2. Trial-end via webhook → status flips to `Past Due` → access revoked on next request.
3. `subscription_status` cannot be self-promoted (trigger blocks it; non-admin UPDATE rejected).
4. Hold Plan price swap leaves history intact + revokes premium libraries.

## 13. Out of scope

- Habit-tracking / challenges (no tables yet — just left in defaults so they auto-grant when shipped).
- Migration of existing JF members to new status enum (none in prod yet — confirm before run).
- Replacing the coaching-checkout flow (`coaching_products`) — untouched.

## 14. Open questions (please confirm before I build)

1. **Stripe price IDs**: Do you already have JF $29 + Hold $9 prices in Stripe sandbox, or should I have the admin paste them into the settings card (no auto-create)?
2. **Trial gating on existing emails**: Block second trial entirely, or allow but skip trial (charge immediately)? Default in plan: skip trial, charge immediately.
3. **Freeze approach**: OK to use Stripe `pause_collection` (recommended, simplest)? If not supported in your Stripe mode, fallback is `trial_end` extension by 30d — slight cosmetic difference in invoices.
4. **Existing webhook**: OK to extend the same `/api/public/stripe-webhook.ts` endpoint, or do you want a separate `/api/public/jf-webhook.ts`? Default: extend (single Stripe webhook endpoint in dashboard).

Approve and answer the 4 questions and I'll build it in one go.
