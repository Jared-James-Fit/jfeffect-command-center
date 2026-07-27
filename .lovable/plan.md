# Payments Section Cleanup

Goal: Collapse the Payments sidebar to exactly **Overview · Transactions · Products · Discount Codes · Settings**, and make every remaining page open cleanly by consolidating routes we already have. No new payment logic — everything reuses existing Stripe/DB reads.

## Phase 1 — Navigation (this pass)

Rewrite the `Payments` group in `src/lib/internal-nav.ts` (the source used by AppShell) to only:

| Label | Route | Reused page |
|---|---|---|
| 🏠 Overview | `/admin/payments` | Existing `payments.tsx` (rename tab: "Overview") |
| 💳 Transactions | `/admin/transactions` | Existing `transactions.tsx` |
| 📦 Products | `/admin/payment-links` | Existing `payment-links.tsx` (label → "Products") |
| 🎟 Discount Codes | `/admin/discount-codes` | Existing `discount-codes.tsx` |
| ⚙️ Settings | `/admin/billing-sources` | Existing `billing-sources.tsx` (label → "Settings") |

Remove from Payments group: Sales, Product Sales, Products/Offers (renamed above), Invoices, Coaching Sales Page, Membership Sales Page, Stripe Discount Codes (dedupe with above), Stripe Webhook Events.

Move the same block in `src/lib/admin-nav.ts` (legacy source) to match, so both nav sources stay in sync.

Add lightweight redirects (small route stubs like the existing `offers.tsx → payment-links`) for the removed URLs so no dead links exist:

- `/admin/sales` → `/admin/payments` (Overview)
- `/admin/products-history` → `/admin/transactions`
- `/admin/purchases` → `/admin/transactions`
- `/admin/promo-codes` → `/admin/discount-codes`
- `/admin/sales/coaching` → `/admin/payment-links`
- `/admin/sales/membership` → `/admin/payment-links`
- `/admin/membership/billing-events` → `/admin/billing-sources?tab=developer`

The Sales Page editors themselves stay live under **/admin/sales** (Sales Pages tab) since the sales workspace already houses them — we only remove the nav items pointing at them from Payments.

## Phase 2 — Overview dashboard (follow-up)

Turn `/admin/payments` into the Overview dashboard: MRR / Gross / Net / Refunds / Failed / Outstanding / Active clients KPI grid + Revenue chart (30/90/365) + Revenue Sources donut + Recent 10 transactions + Quick actions (Create Product, Create Discount Code, Open Stripe). Reuses `admin_transactions_v1` view and existing membership queries — no new webhook / Stripe endpoints.

## Phase 3 — Transactions inline expand (follow-up)

Add inline expand row on `transactions.tsx` (Stripe IDs, timeline, coupons, taxes, receipt, refund history, notes + Open Stripe / Copy Receipt / Refund buttons). Removes the current navigate-away drawer.

## Phase 4 — Products & Discount Codes merge (follow-up)

Add Category tabs (Memberships / Coaching / Programs / Digital / Merchandise) to `payment-links.tsx`; ensure card shows Price · Active subs · Revenue · Status with Edit/Duplicate/Archive/Copy Link/Open Checkout. Merge the two discount code lists into one on `discount-codes.tsx` and hide `promo-codes.tsx` behind a redirect.

## Phase 5 — Settings tabs (follow-up)

Wrap `/admin/billing-sources` with tabs: Stripe · Business · Taxes · Branding · Notifications · Advanced (Developer → webhook logs, admin-only).

## Delivery

I'll ship Phase 1 in this response (nav + redirects — the visible cleanup), then do Phases 2–5 in follow-ups so each stays reviewable. This lets us take the win of a clean sidebar immediately without a giant hard-to-audit patch.
