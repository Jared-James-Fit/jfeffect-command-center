# JF Effect — Stripe Integration TODO

## What already exists (do NOT rebuild)
- `src/routes/api/public/stripe-webhook.ts` — webhook handler with signature verification, handles: checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.deleted, charge.refunded
- `src/lib/payments.functions.ts` — createStripeLinkForOffer (creates Stripe Payment Link, not Checkout Session)
- `src/lib/coaching-products.functions.ts` — CRUD for coaching_products table, creates Stripe products/prices
- `src/routes/_authenticated/admin/payment-links.tsx` — admin UI for coaching_products (currently uses Stripe Payment Links, not Checkout Sessions)
- `src/routes/_authenticated/portal/index.tsx` — BillingCard component, shows payment_status, stripe_payment_link
- `src/routes/_authenticated/portal/purchases.tsx` — client purchase history list
- `src/routes/_authenticated/portal/account.tsx` — client account settings
- `purchase_records` table — has stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_checkout_session_id, payment_status, service_status

## What needs to be ADDED (not rebuilt)

### 1. New server functions (src/lib/stripe-checkout.functions.ts)
- [ ] createCheckoutSession — server fn: takes coaching_product id + client_id, creates Stripe Checkout Session (subscription or payment mode based on product.payment_structure), returns {url}
- [ ] createCustomerPortalSession — server fn: takes stripe_customer_id, creates Stripe Customer Portal session, returns {url}

### 2. Webhook enhancements (src/routes/api/public/stripe-webhook.ts)
- [ ] Add customer.subscription.created handler — update purchase_record payment_status to "Active Subscription", save stripe_subscription_id + stripe_customer_id
- [ ] Add customer.subscription.updated handler — sync payment_status (active→"Active Subscription", past_due→"Overdue", canceled→"Cancelled", unpaid→"Overdue")
- [ ] On checkout.session.completed — also save stripe_customer_id to clients table (clients.stripe_customer_id column — needs migration)

### 3. Supabase migration
- [ ] ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id text
- [ ] ALTER TABLE coaching_products ADD COLUMN IF NOT EXISTS checkout_mode text DEFAULT 'payment' (values: 'payment' | 'subscription')
- [ ] ALTER TABLE coaching_products ADD COLUMN IF NOT EXISTS stripe_price_id text (already exists in schema type — verify it's in DB)

### 4. Admin: payment-links page (src/routes/_authenticated/admin/payment-links.tsx)
- [ ] Add "Checkout Mode" field to product form: dropdown "One-time payment" | "Subscription" (maps to checkout_mode column)
- [ ] Add "Stripe Price ID" field to product form (for Checkout Sessions — separate from payment_link_url)
- [ ] Add "Generate Checkout Link" button that calls createCheckoutSession server fn for a test client (or just stores the price_id for client-side use)
- [ ] Show checkout_mode badge on product cards

### 5. Client portal: purchases page (src/routes/_authenticated/portal/purchases.tsx)
- [ ] Add "Available Plans" section above purchase history showing active coaching_products
- [ ] Each product card has a "Buy Now" button that calls createCheckoutSession → redirects to Stripe Checkout
- [ ] After return from Stripe (success_url = /portal/purchases?checkout=success), show success toast

### 6. Client portal: BillingCard in portal home (src/routes/_authenticated/portal/index.tsx)
- [ ] Replace "Message Coach" payment link button with "Manage Billing" button when stripe_customer_id exists on the purchase_record
- [ ] "Manage Billing" calls createCustomerPortalSession → opens Stripe Customer Portal in new tab

### 7. Client portal: account page (src/routes/_authenticated/portal/account.tsx)
- [ ] Add "Billing & Subscription" section at bottom of account page
- [ ] Show current plan name, payment_status, next billing date (term_end_date)
- [ ] Show "Manage Billing" button → createCustomerPortalSession

### 8. Admin: payments page (src/routes/_authenticated/admin/payments.tsx)
- [ ] Add stripe_customer_id and stripe_subscription_id columns to the payments table view
- [ ] Add "Overdue" filter badge count to header stats
