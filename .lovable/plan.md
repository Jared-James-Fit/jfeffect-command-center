
# Payments, Offers, Stripe Links & Purchase Records — Full Overhaul

Big build. Doing it in one pass per your call, with Stripe set up now (Lovable's built-in Stripe Payments — no API key needed; covers automatic checkout, webhooks, payment confirmation).

## 1. Enable Stripe (built-in)
- Run `enable_stripe_payments` so Stripe is connected with managed webhooks. This handles `checkout.session.completed`, `payment_intent.succeeded/failed`, `customer.subscription.*`, `invoice.payment_*`, `charge.refunded` automatically and routes them to a webhook route I'll add.
- Manual mode still works for offers/links not created through Stripe (you paste a link, mark paid manually).

## 2. Database (one migration)
Extend existing tables, do not rewrite:

**offers** — add: `offer_type` enum-style text (full list), `image_url`, `short_description`, `full_description`, `currency`, `price`, `full_payable_amount`, `amount_due_today`, `deposit_amount`, `payment_structure`, `payment_frequency`, `number_of_payments`, `payment_amount`, `billing_day`, `payment_start_date`, `final_payment_date`, `minimum_commitment_length`, `term_duration`, `term_duration_unit`, `is_recurring`, `access_length`, `session_count`, `session_length_minutes`, `location`, `cancellation_policy`, `rescheduling_policy`, `no_show_policy`, `late_policy`, `transferability_policy`, `gym_access_note`, `included_features text[]`, `excluded_features text[]`, `requires_agreement`, `required_agreement_template_id`, `agreement_before_service`, `stripe_product_id`, `stripe_price_id`, `stripe_payment_link_id`, `stripe_payment_link_url`, `admin_notes`, `client_notes`, `status`, `archived`, `version`, `last_edited_at` (most exist; only add the missing ones).

**stripe_payment_links** (new) — `id, offer_id?, title, url, stripe_product_id, stripe_price_id, stripe_payment_link_id, currency, price_cents, full_payable_amount, payment_structure, mode (auto|manual), active, archived, notes, created_*`.

**purchase_records** — add any missing: `service_status`, `amount_paid`, `remaining_balance`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_subscription_id`, `stripe_customer_id`, `stripe_receipt_url`, `sessions_used`, `sessions_remaining`, `package_expiry_date`, `confirmation_email_sent_at`, snapshot fields (`included_features`, `excluded_features`, `cancellation_policy`, `refund_policy`, `term_duration_text`, `location`, `purchase_disclaimer`) — preserve existing.

**RLS**: admin full, coach read-only on assigned client purchases (no $$ widgets), client read own.

## 3. Stripe webhook route
`/api/public/stripe-webhook` — verifies signature, updates `purchase_records` payment_status, stores Stripe IDs, sets service_status, decrements `sessions_remaining` only on admin action (not on payment), sends confirmation email if email infra configured (gracefully skip if not).

## 4. Server functions (`createServerFn`)
- `createStripeProductAndLink(offerId)` — admin only, uses STRIPE_SECRET_KEY (already in secrets) to create Product, Price, Payment Link; writes IDs back to offer.
- `assignOfferToClient({offerId, clientId, sendEmail})` — snapshots offer → creates `purchase_records` row (Pending Payment), returns payment link.
- `markPurchasePaidManually(id)` / `markOverdue(id)` / `updateServiceDates(...)`.
- `sendPaymentLinkEmail(purchaseId)` — uses existing email sender if configured, else returns "manual send" notice.

## 5. Admin UI
**Sales & Payments sidebar group** (already exists): Offers & Products, Stripe Payment Links, Payments, Purchase Records.

- **Offers & Products** (`/admin/offers`): keep existing list; expand the offer form to cover all new fields, grouped tabs (Basics, Pricing & Schedule, Term & Sessions, Includes/Excludes, Agreement, Stripe, Notes). "Create Stripe link" button if STRIPE_SECRET_KEY present.
- **Stripe Payment Links** (`/admin/payment-links`): list, create (auto or manual), copy, archive, open, connect to offer.
- **Payments** (new `/admin/payments`): table of all purchase_records joined to clients with filters (status, date, offer type, agreement). Quick actions: mark paid, view, send link, copy link. CSV export.
- **Purchase Records** (`/admin/purchases`): keep existing list, expand filters + bulk archive/export.
- **Client profile → Purchases panel**: replace existing `PurchaseRecordsPanel` with richer cards showing payment status + service status + agreement state + quick actions (Assign Offer, Send Link, Copy, Open Stripe, Mark Paid, Edit Service Term, Archive). Add a "Sessions" mini-tracker for session-package purchases.
- **Admin dashboard widgets**: Payments Needing Attention, Recent Purchases, Active Services, Session Packages Low.

## 6. Client portal
- New `/portal/purchases` (already exists) — keep but enhance with status chips, agreement banner, session counter.
- Existing `/portal/purchases/$id` — keep, surface "Complete Payment" button using snapshot payment link.

## 7. Notifications
Use existing notification bell. Insert into existing notification table on: payment_received, payment_failed, overdue, purchase_created, agreement_missing, service_ending, session_low.

## 8. Bulk + safety
- Reuse `useBulkSelection` + `DoubleConfirmDeleteDialog` (require typing DELETE for purchase records).
- Coaches see service type only; payment $$ hidden by RLS.

## 9. Out of scope (will note in UI)
- Per-line subscription invoice reconciliation beyond webhook events.
- Refund initiation from inside app (refunds visible, but processed in Stripe).
- Marketing emails.

Acknowledge: this is ~15–25 files of change. After approval I'll execute the migration + Stripe enable first, then code.
