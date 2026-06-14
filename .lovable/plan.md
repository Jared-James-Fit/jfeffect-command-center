
# Billing, Payments, Packages & PT Session Tracking — Phased Build

This is a very large system (18 logical sections, 13+ new tables, multi-currency money handling, Stripe webhook reconciliation, PT entitlement ledger, plan-conversion engine, Google Sheets backup, admin + client UIs, RLS, reports, statements, receipts, migration of existing data).

I cannot ship all of it in a single turn without producing something shallow — which is exactly what you told me not to do. So I'm going to **build it in sequential phases, one phase per turn**, and start Phase 1 immediately after you confirm scope. Each phase ends with a real, working slice you can use.

Before I start, I need 2 quick scope decisions (below). Everything else I'll decide from the existing codebase audit.

---

## Audit summary (existing systems I will reuse, not duplicate)

- **Products / Offers**: `offers`, `coaching_products` (already has Stripe product/price/payment_link, payment_structure, mode auto/manual). Extend, don't replace.
- **Purchases**: `purchase_records` (72 cols, already has stripe fields, payment_status, term dates). Extend, don't replace.
- **Payments**: today payment state lives **on** `purchase_records` (amount_paid, payment_status). There is **no append-only ledger** → I will add one.
- **PT Sessions**: `pt_sessions` (23 cols, scheduled/completed/cancelled/no-show). No entitlement ledger today → I will add one.
- **Stripe**: `processed_stripe_events` exists (idempotency table). `stripe-checkout.functions.ts` + `payments.functions.ts` handle checkout + manual payment updates. I will add webhook reconciliation into the ledger without touching live checkout.
- **Memberships**: `app_members`, `member_plan_enrollments`, JF billing events — separate flow; I will **not** rewrite. Membership subscriptions will continue to flow through their existing path and only mirror summary rows into the new ledger.
- **Google Drive**: `client_drive_folders` + `drive.functions.ts` exist. I will reuse for the per-client billing workbook.
- **Google Sheets**: no current integration → new `google_sheets` connector + sync queue.
- **Admin client profile**: exists under `/admin/clients/...` — I will add a "Billing & Services" section as new tabs, not a parallel page.

Nothing in the existing checkout, Stripe Price IDs, legal acceptance, or notification settings will be modified.

---

## Phase plan

### Phase 1 — Financial foundation (DB + money + ledger)
- Migrations:
  - `products_v2` extension columns on `offers` (product_type enum, session config, release cadence, expiration rules, cancellation policy, client-facing terms, internal/client descriptions split).
  - `client_purchases` view/alias over `purchase_records` + new columns: `offer_snapshot jsonb` (immutable), `amount_outstanding_cents`, `amount_credited_cents`, `amount_refunded_cents`, `contract_value_cents`, `purchase_status enum`, `service_status enum`.
  - **New**: `payment_ledger` (append-only, integer minor units, txn_type enum, method enum, reversal_of FK, stripe_event_id unique, allocated_to_purchase_id, created_by, audit fields).
  - **New**: `payment_allocations` (one payment → many purchases).
  - **New**: `client_account_credits` (issued, applied, balance derived).
  - **New**: `financial_audit_events` (before/after JSON, actor, reason).
  - GRANTs + RLS (admin full, coach read-only on assigned clients, client read-only on own).
- Server fns: `recordPayment`, `voidPayment`, `refundPayment`, `applyCredit`, `getPurchaseSummary` (derives status from ledger — admins cannot type a fake status).
- Backfill: replay every existing `purchase_records.amount_paid > 0` as a single historical `payment_ledger` row with `method='legacy_backfill'`, source-tagged so it can't be voided.

### Phase 2 — PT entitlement ledger + calendar wiring
- Migrations: `session_ledger_events` (event_type enum, qty signed int, pt_session_id FK nullable, purchase_id FK, reversal_of FK), `service_entitlements` materialized summary per purchase.
- Triggers / server fns:
  - On `pt_sessions.status → Completed` → write `Session Completed` ledger event against the oldest eligible active purchase (admin can pre-select a different purchase). Idempotent per `pt_session_id`.
  - On reversal of completed → reversal event.
  - Late cancel / no-show only deducts when the purchase snapshot's policy says so.
- New admin UI: PT Sessions tab on client profile with the 10 counters (purchased / released / available / used / scheduled / contract-remaining / not-yet-released / expired / transferred / adjusted).
- Override flow with mandatory reason.

### Phase 3 — Admin Billing & Services UI (client profile)
- Add 8-tab section (Overview, Services & Purchases, Payments, PT Sessions, Plan Changes, Documents, Google Sync, Audit History) to `/admin/clients/$clientId`.
- Top summary cards (9 metrics).
- Action sheets with before/after preview ("Recording this $3,000 payment will change …").
- Confirmation gates on refunds, reversals, deductions, cancellations.

### Phase 4 — Plan Change / Service Conversion engine
- Migrations: `service_change_events` (original_purchase_id, new_purchase_id, sessions_transferred, value_method enum, credit_created_cents, credit_applied_cents, refund_cents, reason).
- One transactional server fn `convertClientService` — either fully commits all six possible side effects (cancel future entitlements, create credit ledger row, apply credit allocation, create new purchase, refund row, audit) or rolls back.
- Preview endpoint returns the calculation before commit.
- Nicolas Galli scenario becomes an automated integration test.

### Phase 5 — Client portal billing view + statements/receipts
- Read-only `/portal/billing` page (active services, payments, PT counters, upcoming sessions, receipts).
- Statement generator (PDF + CSV) using existing PDF infra.
- Sequential receipt numbers per Stripe-or-manual payment.

### Phase 6 — Stripe webhook reconciliation
- Extend the existing webhook entry point (or add `/api/public/hooks/stripe`) to write into `payment_ledger` for `payment_intent.succeeded`, `invoice.paid`, `charge.refunded`, `customer.subscription.*`, `checkout.session.completed`. Idempotent via `processed_stripe_events` + `stripe_event_id` unique constraint on ledger.
- Unmatched-transaction queue UI for admin.
- **Live checkout behavior, Price IDs, settings — untouched.**

### Phase 7 — Google Drive + Sheets backup (one-way mirror)
- Connector connection (workspace-level `google_sheets`).
- Master workbook + per-client workbook (saved IDs on `client_drive_folders`).
- Queue + worker (`google_sync_jobs`), cron via `pg_cron` → `/api/public/hooks/sheets-sync-tick`.
- Safe-disconnected state: if creds missing, UI shows "Not connected" + checklist; billing keeps working.

### Phase 8 — Reports, migration review, QA
- Admin billing dashboard with per-currency totals.
- "Migration Review" page for ambiguous backfilled rows.
- Vitest coverage for: ledger math, Nicolas Galli conversion, idempotent webhook, oldest-eligible session selection, no double-deduction, RLS.

---

## Two scope questions before I start Phase 1

I will not pause between subsequent phases — only this one decision matters for the foundation.

1. **Money storage** — I want to store **all** money as integer minor units (cents) on the new ledger tables, and keep the legacy decimal columns on `purchase_records` for read-back. Existing `purchase_records.amount_paid` (numeric dollars) stays untouched; the new `payment_ledger.amount_minor` is the source of truth going forward. Confirm OK?

2. **Memberships scope** — JF Memberships already have their own subscription pipeline (`jf_billing_events`, Stripe subscription via `app_members`). For this build I will **mirror** membership invoices into the new `payment_ledger` for unified reporting, but **not** route membership lifecycle through the new system. Confirm OK?

Reply "go" (with any tweaks) and I'll ship Phase 1 in the next turn — full migration, RLS, server fns, backfill, and the first usable Payments tab on the admin client profile.
