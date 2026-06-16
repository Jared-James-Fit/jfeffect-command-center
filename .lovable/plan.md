# Discount / Promo / Ambassador / Referral Code Foundation

## Scope guardrails (from your brief)
- **No live Stripe activation** in this step. `FIRSTMONTHFREE` stays in Draft/Test until expiry + Stripe verification.
- **No duplicate systems.** Extend the existing `promo-codes` admin page, `membership.promo-tools`, `join.tsx`, and stripe-webhook route rather than building parallel ones.
- **No customer charges, no public messaging, no changes to existing subscriptions.**
- Server-side validation is the source of truth; client UI is for UX only.

## Phase 0 — Inventory (read-only, before any edit)
Inspect and document the current state of:
- `src/routes/_authenticated/admin/promo-codes.tsx` and `membership.promo-tools.tsx`
- `src/routes/_authenticated/admin/sales.index.tsx` (nav surface for Sales → Promotions)
- `src/routes/join.tsx` (URL code capture)
- `src/routes/api/public/stripe-webhook.ts` (attribution hooks)
- Existing DB tables for codes/redemptions/ambassador fields (`promo_code_redemptions` already exists per schema; check `clients`, `coaches`, `app_members` for any referral-code columns)
- Existing membership checkout component(s)

I'll produce a short "what exists / what's missing" note at the top of the handoff report so the next agent doesn't rediscover it.

## Phase 1 — Database foundation (single migration, awaits your approval)
New / extended tables in `public`:

1. **`discount_codes`** — master code record
   - internal_name, public_code (citext unique), category (enum: promotion|ambassador|client_referral|retention|manual), description
   - discount_type (percentage|fixed), discount_value, subscription_duration (once|forever|repeating), duration_months
   - eligible_product_ids (uuid[]), new_customers_only, existing_customers_only, min_purchase_cents
   - start_at, expires_at, time_zone (default `America/Winnipeg`)
   - status (draft|scheduled|active|paused|expired)
   - total_usage_limit, per_customer_limit
   - pairing_allowed, pairable_category, max_promo_codes (default 1), max_referral_codes (default 1), max_total_codes (default 2), excluded_code_ids
   - linked_ambassador_id, linked_client_id (nullable FKs)
   - stripe_coupon_id, stripe_promotion_code_id, stripe_test_mode_synced, stripe_live_mode_synced
   - created_by, updated_by, timestamps
2. **`discount_code_redemptions`** — extends/replaces use of existing `promo_code_redemptions` if compatible; otherwise new table with: customer_id, email, promo_code_id, referral_code_id, referring_user_id, product_id, checkout_id, subscription_id, original_cents, promo_discount_cents, referral_discount_cents, final_cents, subscription_status, stripe_sync_status, mode (test|live), redeemed_at
3. **`discount_code_audit_log`** — actor, action (created/edited/activated/paused/expired/applied/rejected/invalid_pair/redemption_completed/attribution_recorded/admin_override), code_id, metadata jsonb, timestamp. **Never** logs card / secret / token data.
4. **`referral_attribution`** — separates promo attribution from ambassador attribution so `FIRSTMONTHFREE` never displaces the referring ambassador.

Indexes on public_code (unique citext), status, expires_at, linked_ambassador_id, linked_client_id.

RLS: all tables enabled. Admin-only write via `has_role(auth.uid(),'admin')`. Authenticated SELECT scoped per table (e.g. customers see only their own redemptions). Service role full access for webhook + server fns. Explicit `GRANT`s per public-schema rules.

Server-side validation function `public.validate_code_combination(codes text[], customer_id uuid, product_id uuid)` (SECURITY DEFINER) returns structured `{ ok, applied[], rejected[], reason }` enforcing all pairing rules.

## Phase 2 — Server functions
In `src/lib/discount-codes.functions.ts` (client-safe path):
- `listDiscountCodes` (admin, paginated, filterable)
- `getDiscountCode`, `upsertDiscountCode` (admin, audit-logged)
- `setCodeStatus` (activate/pause/expire/reactivate)
- `validateCodesForCheckout` — public, calls the RPC above, returns sanitized messages
- `recordRedemption` — called by stripe-webhook on `invoice.payment_succeeded` / `checkout.session.completed`
- `listRedemptions`, `getReferralStatsForUser`

All admin fns use `requireSupabaseAuth` + role check. Public validation fn is rate-limited and never returns raw DB/Stripe errors.

## Phase 3 — Admin UI (extend existing pages)
- **Sales → Promotions** tabs: Discount Codes (primary), Ambassador & Referral Codes, Redemption History, Promotion Analytics
- Extend `promo-codes.tsx` into the full table view (filters: All / Active / Draft / Scheduled / Paused / Expired / Promotions / Ambassadors / Client Referrals / Expiring Soon; search by code/name/email)
- **Create/Edit form** with the exact sections you listed (Basic / Discount / Eligibility / Pairing). No "all products" default — admin must pick.
- **Expiration controls**: date + time + tz picker (default 11:59 PM America/Winnipeg), Extend / Shorten / Pause / Reactivate / Expire Immediately with confirmation dialogs.
- **Per-profile panel** "Referral & Discount Code" on ambassador/client admin profiles, with copy code / copy link / paired link / view customers / view redemptions.

Mobile-responsive, paginated, no full-Stripe-load on initial render.

## Phase 4 — Seed records (data-only, via insert tool, all in test/draft)
- `FIRSTMONTHFREE` — Promotion, 100%, repeating 1 month, Membership product, new-customer-only, pairable with referral, **status=draft** until expiry chosen.
- Ambassador/referral codes for existing ambassadors/clients (e.g. `COLBY`, `CEDRIC`) — 5% off membership, repeating, pairable with promotion only. Skip any that already exist; resolve first-name collisions with last-initial suffix.

No live Stripe coupon created.

## Phase 5 — Checkout interface (extend existing membership checkout)
- "Promo or Ambassador Code" section with Apply → applied chips → "Add another eligible code" (max 2, enforced server-side).
- Friendly messages exactly as you specified for promo-applied / referral-applied / both / invalid second referral / invalid second promo.
- Calls `validateCodesForCheckout` — UI never claims a Stripe discount was applied unless the server confirms (during this phase, server returns `mode: 'test'` for `FIRSTMONTHFREE` and the UI shows a "Test mode — not yet live" badge in admin preview).

## Phase 6 — Shareable links + attribution
- `join.tsx` accepts `?code=`, `?promo=`, `?ref=`; persists to sessionStorage; preserves across signup / verify / login / checkout / refresh.
- URL manipulation cannot bypass pairing rules — validation runs server-side at checkout.
- Stripe webhook handler writes `referral_attribution` separately from promo attribution.

## Phase 7 — Build, fix, publish
- Run typecheck, fix errors, smoke-test admin nav + mobile + checkout-without-codes + checkout-with-codes.
- Publish to https://jfeffect.com.

## Phase 8 — Handoff report
Concise markdown report covering every item in your section 19, plus the explicit list of files needing Stripe live-mode verification.

## What I will NOT do without further confirmation
- Touch live Stripe (no coupon/promotion_code creation in live mode).
- Send any customer email or in-app announcement.
- Modify existing active subscriptions or existing working discount logic.
- Overwrite ambassador/client codes that already exist.

## Open questions (please answer before I start — keeps the migration right the first time)
1. **Reuse vs replace existing `promo_code_redemptions` table?** It has 27 columns and 1 policy already. If it's already wired into a working flow I'll extend it; otherwise I'll add `discount_code_redemptions` and migrate. Do you know which it is, or should I treat it as existing-and-extend?
2. **Ambassador/client code list beyond COLBY and CEDRIC** — should I auto-generate codes from `clients` / `coaches` rows that have an "ambassador" flag, or only seed the two you named and leave the rest to a separate bulk step?
3. **`FIRSTMONTHFREE` expiry date** — you said it can't go live without one. Pick a date now (e.g. 2026-12-31 23:59 America/Winnipeg) or leave it null and force the admin to set one in the UI before status can become `active`?
4. **Membership product ID** — there are `coaching_products`, `member_plans`, and `offers` tables. Which one represents "JF Effect Membership" for `eligible_product_ids`? (I'll inspect and pick if you don't know, but a quick pointer saves a round trip.)
