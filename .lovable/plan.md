## Dual Billing Source & Legacy Client Migration Foundation

A large, multi-area feature. Before writing any code I want your sign-off on scope, sequencing, and a few key decisions, because some answers materially change the schema.

### Goal

Let existing **JF Effect Trainerize** coaching clients use the new JF Effect app **without** touching their existing Stripe subscription. Keep the new JF Effect Stripe account as the sole billing system for new coaching, memberships, website purchases, promos, ambassador/referral codes. Never merge, never double-charge.

### Architecture summary

**Two independent concepts, enforced everywhere:**

1. `billing_source` — *who collects the money* (`trainerize_legacy`, `jfeffect_stripe`, `manual_external`, `complimentary`, `none`)
2. `app_access` — *what the client can do in the app* (source, tier, status, dates), independent of any Stripe subscription in the new account

A client can be `app_access = active` with `billing_source = trainerize_legacy` and zero rows in the new Stripe account. That is the central invariant the rest of the work protects.

### Database changes (new migration)

Reuse existing tables where possible (`clients`, `app_members`, `member_access`, `purchase_records`, `payment_ledger`). Add only what's missing:

- **Enums:** `billing_source_type`, `access_source_type`, `access_status_type`, `legacy_billing_status`, `migration_review_status`.
- **`clients.billing_source`** (enum, NOT NULL, default `none`) + `billing_source_locked_at`, `billing_source_set_by`, `billing_source_notes`.
- **`legacy_billing_records`** — one row per client with `trainerize_customer_ref`, `trainerize_subscription_ref`, `plan_name`, `amount_cents`, `currency`, `interval`, `next_billing_at`, `status`, `last_verified_at`, `notes`. No card data, no secrets.
- **`client_access_entitlements`** — `access_source`, `access_tier`, `status`, `effective_start`, `effective_end`, `billing_source`, `granted_by`, `last_verified_at`, `notes`. Authoritative for "can this client open the app today?"
- **`billing_migration_reviews`** — review-only checklist rows; no execution.
- **`billing_audit_log`** — every billing-source / access change, with admin, client, before/after, reason. Never logs payment credentials.
- **RLS:** read/write restricted to `admin` (and `coach` where appropriate) via `has_role`. Clients see only their own non-sensitive billing label. Service role for webhooks.
- **GRANTs** on every new public table.

### Server functions (`src/lib/billing/*.functions.ts`)

All protected via `requireSupabaseAuth` + `has_role('admin')`:

- `setClientBillingSourceFn`, `upsertLegacyBillingRecordFn`, `verifyLegacyBillingFn`
- `grantAppAccessFn`, `pauseAppAccessFn`, `restoreAppAccessFn`, `endAppAccessFn`
- `inviteLegacyClientFn` (creates app account + access, **never** a Stripe customer/subscription)
- `listClientsWithBillingFn` (filters + bulk), `bulkMarkTrainerizeLegacyFn`, `bulkSendInvitationsFn`
- `openMigrationReviewFn`, `updateMigrationChecklistFn` (review-only; no Stripe calls)
- `getBillingDashboardFn` (revenue split by source, clearly labelled)

### Webhook hardening (Stripe webhook for new JF Effect Stripe account)

- Match on `stripe_customer_id` only — never on email alone.
- If the matched client has `billing_source = trainerize_legacy` and no authorized `billing_migration_reviews` row in `completed` state: **log conflict, do not mutate** billing source / access / entitlements.
- Never deactivate a legacy client because they're absent from the new account.

### Checkout / promo safeguards

- `/membership` and any new-subscription server fn: if target client is `trainerize_legacy`, return a blocking error surface (admin override required). No silent fallback.
- Promo / ambassador / referral validation: scoped to `jfeffect_stripe` purchases only.
- Invitation accept flow: pure app onboarding — no checkout redirect, no trial start.

### Admin UI

- **Clients list:** new `Billing` column with badge, filters (billing source + access status), bulk actions with confirmation modal.
- **Client profile → Billing & Access panel:** status, source badge, legacy details, actions (`Edit Legacy Billing`, `Verify`, `Pause`, `Restore`, `End`, `Prepare Future Migration`).
- **New page `/admin/legacy-migration`:** import progress board with statuses (Not Started → Access Active / Needs Attention), per-client step-through flow.
- **New admin action "Add Existing Legacy Client":** wizard with billing source defaulted to `trainerize_legacy` and the explanatory copy verbatim.
- **Dashboard:** revenue split — *Verified through JF Effect Stripe* vs *Legacy external billing* vs *Manually entered* vs *Not yet verified*.

### Out of scope (explicitly)

- No live Trainerize Stripe API connection.
- No "Migrate All" button. `Prepare Future Billing Migration` only creates a review row.
- No card / payment credential storage anywhere.

### Sequencing

1. Migration (schema + enums + RLS + GRANTs + audit) — needs your approval first.
2. Server functions + webhook guard.
3. Admin UI (clients list, profile panel, legacy migration page, dashboard split).
4. Promo/checkout guard rails.
5. Build fix pass + security scan + publish to jfeffect.com.
6. Handoff report.

### Questions before I start

1. **Coach role access:** should `coach` users see the Billing & Access panel read-only, or is this admin-only?
2. **Default for clients already in `clients` with no Stripe customer:** mark them `none` and let you classify, or auto-default existing rows with active coaching to `trainerize_legacy` (safer default given your context)?
3. **Invitation channel:** reuse the existing app invitation/email flow you already have, or do you want a dedicated "legacy invite" template with the explanatory copy baked in?
4. **Existing `app_members` / `member_access` tables:** I'll extend rather than duplicate. Confirm OK to add columns there instead of a parallel `client_access_entitlements` table if the existing shape fits — I'll decide during exploration unless you have a preference.

Reply with answers (or "you decide") and I'll proceed with the migration as step 1.
