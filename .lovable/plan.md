# JF Effect Membership — Launch Readiness Implementation Plan

This is a fix-and-harden pass on the existing membership stack. No rebuilds. No destructive migrations. Every change is additive or surgical, and the default posture is "do nothing real" (dry-run notifications, draft legal docs, test-mode QA only).

## Guiding Safety Rules (apply to every phase)

- Never charge a real card, never touch live Stripe products/prices, never cancel a live subscription, never clear Stripe IDs, never revoke an existing member's access.
- Notifications default to `dry_run` — no real SMS/email goes out during this work or QA.
- Legal documents stay in `draft` until you explicitly publish them.
- The cross-account member flagged in the audit is never auto-modified.
- All time math uses server timestamps (`now()` in SQL, server-fn `Date.now()`), never browser timers.

## Phase 0 — Read-only reconnaissance (no code yet)

Before writing, I read the actual current shape of:

- `src/routes/api/public/stripe-webhook.ts` — to find the `invoice.payment_*` handlers and the `stripeFetch` / `resolveStripeKey` helpers.
- `src/lib/stripe.server.ts`, `src/lib/stripe-checkout.functions.ts`, `src/lib/jf-billing.functions.ts`, `src/lib/member-checkout.functions.ts`.
- `src/routes/join.tsx`, `src/routes/_authenticated/m/billing.tsx`, `src/routes/_authenticated/m/upgrade.tsx`, `src/routes/_authenticated/admin/` membership pages.
- `src/lib/legal.functions.ts`, `src/lib/agreements.functions.ts`, `src/routes/legal.$slug.tsx`, `src/routes/terms.tsx`, `src/routes/privacy.tsx`.
- Tables: `app_members`, `member_access`, `jf_membership_settings`, `jf_billing_events`, `jf_pending_signups`, `legal_documents`, `legal_document_versions`, `legal_acceptances`, `app_settings`.

Goal: confirm exact column names, helper signatures, and existing patterns so every new piece reuses what's already there.

## Phase 1 — Stripe webhook key-mode bug (Section 1)

Single, narrow fix to `stripe-webhook.ts`:

- In the `invoice.payment_succeeded` and `invoice.payment_failed` handlers, derive `mode = event.livemode ? 'live' : 'test'` and pass the matching key (via the existing `resolveStripeKey`) to the subscription fetch.
- Add three server logs per event: `event.mode`, `selected.key.mode`, and a structured `subscription.lookup.failed` on error. Never log key material.
- Preserve signature verification, `processed_stripe_events` idempotency, `jf_billing_events` writes, and entitlement updates.

## Phase 2 — Notification safety mode (Sections 2 + 3)

Schema (one migration):

- Insert default row in `app_settings` with key `jf_membership_notifications`, JSON `{ mode: "dry_run", allowed_emails: [], allowed_phones: [], updated_at, updated_by }`.
- New table `jf_notification_attempts` (id, definition_key, recipient_user_id, channel, recipient_address, rendered_subject, rendered_body, dedupe_key, mode, status: `dry_run|sent|suppressed_allowlist|suppressed_legal|error`, suppression_reason, stripe_event_id nullable, created_at). RLS: admin-only read; grants for `authenticated` SELECT to own rows; `service_role` ALL.
- Seed inactive lifecycle definition rows (in `sms_automations` if that's the canonical store, otherwise a new `jf_lifecycle_notifications` table — Phase 0 decides which) for: `subscription_trial_ending`, `subscription_payment_succeeded`, `subscription_payment_failed`, `subscription_cancelled`, `subscription_ended`, `subscription_frozen`, `subscription_hold_plan`, `subscription_reactivated`. All `active = false`.

Code:

- `src/lib/jf-notify.server.ts` — single `sendMembershipNotification({ definitionKey, userId, payload, dedupeKey })` that: loads the definition, renders, checks safety mode, records attempt, and only calls the real SMS/email provider in `live` mode (and only for allowlist matches in `allowlist` mode).
- Admin UI: Membership Settings → "Notification Safety" panel with mode selector, allowlist editors, dry-run attempt log, and a red banner when mode = `live`. Switching to `live` requires a typed confirmation.
- Wire the existing active purchase notification through this gate before changing anything else.

## Phase 3 — Subscription lifecycle handlers (Sections 4 + 6 + 7)

- `customer.subscription.deleted` handler: on verified delete, set member `subscription_status = 'canceled'`, revoke paid `member_access` rows tagged `source = 'paid'`, write `jf_billing_events` row, fire inactive `subscription_ended` through the safety gate. Idempotent via `processed_stripe_events`.
- Failed-payment grace: add `payment_grace_period_days` (default 5) and `first_payment_failure_at` to settings/member. On `invoice.payment_failed`: set `subscription_status = 'past_due'`, stamp `first_payment_failure_at = now()` if null, KEEP access. On `invoice.payment_succeeded`: clear failure stamp, return to `active`. A new server fn `enforceGracePeriodExpiries` (called from `/api/public/hooks/scheduled-send-worker.ts` cron path that already runs) revokes paid access for any member whose `first_payment_failure_at + grace_days < now()` and status is still `past_due`.
- Keep vs Restart: `keepMembership` server fn calls `stripe.subscriptions.update(id, { cancel_at_period_end: false })` — only if subscription still exists. `restartMembership` server fn does a fresh Stripe Checkout reusing the existing `app_members` row and Stripe customer when valid; never creates duplicate user/member rows; rejects if any active/trialing/cancel_at_period_end subscription already exists.

## Phase 4 — Legal launch gate (Sections 8 + 9 + 10)

- Migration: ensure `legal_documents` has rows for `terms_of_service`, `privacy_policy`, `membership_agreement` with at least one `draft` version each (titled "Draft — pending professional review"). No publish.
- New `legal_acceptances` writes happen server-side inside the checkout server fn. The fn rejects when: any required doc has no published current version, or the submitted version IDs don't match the current published ones, or the user didn't tick the boxes.
- `/terms`, `/privacy`, `/membership-agreement` routes load via a public server fn that reads only `status='published'` versions. When none exist: render a controlled "This document is being finalized — checkout is disabled" page. Drafts are never publicly accessible.
- A `legalLaunchGate()` helper returns `{ ready: boolean, blockers: string[] }` and is consulted by checkout creation AND by the Launch Readiness panel.

## Phase 5 — Restart / Billing UI (Sections 5 + 6 + 16)

- `/m/billing` becomes a state-machine: Trialing, Active, Past Due (within grace), Past Due (expired), Canceling, Canceled, Expired, Hold, Paused, Complimentary. Each state renders the correct CTA set:
  - Canceling → "Keep Membership" + "Manage Billing"
  - Canceled/Expired → "Restart Membership"
  - Past Due (in grace) → banner with grace end date + "Update Payment Method"
  - Past Due (expired) → restricted view + "Update Payment Method" / "Restart Membership"
  - Complimentary → no billing CTAs, "Contact Support" only
- `/join`: minimal edits only — wire legal checkboxes to server-validated acceptance, gate the Subscribe button on `legalLaunchGate().ready`, replace any fake support address with the configured one or hide. Preserve all hero/sales copy, features, testimonials, FAQ, monthly pricing, 3-day trial. Annual stays hidden.

## Phase 6 — Settings + Admin readiness (Sections 11 + 12 + 13 + 14 + 15 + 17)

- Migration adds to `jf_membership_settings`: `support_email text`, `payment_grace_period_days int default 5`, `monthly_price_id text`, `stripe_mode text`. Required-field validation on admin save.
- `member_access.source` column: enum-like text default `'unknown'` with allowed values `paid|complimentary|legacy|admin|unknown`. Backfill ONLY where source is unambiguous (existing complimentary grants → `complimentary`; rows tied to a verified Stripe subscription → `paid`). Everything else stays `unknown` for manual review.
- Cleanup cron in `/api/public/hooks/scheduled-send-worker.ts`: delete `jf_pending_signups` where `expires_at < now()` AND no checkout completed. Log counts to a new `jf_cleanup_runs` table (or reuse `worker_runs`). Never log passwords.
- Stripe sync safety: when `stripeFetch` returns "No such customer/subscription" for a member with non-null Stripe refs, set `member.sync_warning_at = now()` and `sync_warning_reason`, surface in Admin "Manual Review" without overwriting any IDs or revoking access.
- Admin Membership → "Launch Readiness" tab with live checks listed in spec Section 11. Final status = `Not ready to sell` | `Ready for test-mode QA` | `Ready for live launch`. `Ready for live launch` is impossible while any required legal doc is unpublished.
- Admin Membership additional panels: recent billing events, failed-payment members, in-grace, grace-expired, webhook status, sync warnings, dry-run notification log, legal blockers, complimentary members, expired-eligible-to-restart.

## Phase 7 — QA (Sections 19 + 20)

- Manual test-mode QA against a clearly-marked test customer using Stripe test keys via the existing test-key path. Live settings untouched.
- Responsive QA at the 5 viewports for /join, legal acceptance, /m/billing, cancellation, Keep/Restart, failed-payment banner, Admin Launch Readiness.

## Technical Notes

- One migration per phase to keep approvals reviewable; never combine schema changes with destructive data ops.
- All new server fns use `requireSupabaseAuth` and check `has_role(_user_id, 'admin')` for admin-only operations.
- All new tables get GRANT statements in the same migration (per project rules).
- `supabaseAdmin` is loaded inside handlers only.
- Notification provider calls are wrapped in the safety gate — there is no direct provider call path that bypasses it.

## What I Need From You Before I Start

1. **Confirm the phasing**: ship Phase 1 (webhook bug) first as its own change so it's reviewable in isolation, then proceed phase by phase? Or batch Phases 1–3 as the "billing safety" PR and 4–6 as the "launch gate" PR?
2. **Lifecycle notification storage**: existing `sms_automations` table appears to handle automations. Reuse it (add new keys, default inactive) or create a dedicated `jf_lifecycle_notifications` table? I'll default to **reuse `sms_automations`** unless you say otherwise.
3. **`/membership-agreement` route slug**: confirm `/membership-agreement` is fine, or do you prefer `/legal/membership-agreement` to sit alongside `/legal/$slug`?
4. **Support email at launch**: I'll leave the field blank and surface it as a Launch Readiness blocker. You enter it in Admin → Membership Settings when you've decided. Confirm.

Once you confirm (or just say "go with your defaults"), I'll start Phase 0 reconnaissance and ship Phase 1 immediately.
