# Taxes & Books and Summer Ledger

Admin only. Sales hub > Taxes & Books (`/admin/sales?tab=taxes`).

## Where the numbers come from

| What | Source |
|---|---|
| Sales and GST/HST collected | `payment_ledger` (payments, deposits, refunds; voided, test-mode, credit and reversal rows are skipped) plus paid rows in `member_payment_ledger` |
| Expenses and ITCs | `business_expenses` (receipts, manual entries, monthly Stripe fees) |
| Tax already paid | `business_tax_payments` |
| Province, GST number, filing frequency, other income | `business_tax_settings` (one row) |

Revenue is counted when received. All figures run through one pure engine,
`src/lib/business-tax.ts`, so the dashboard, the PDFs and Summer agree.

## Rules baked in

- T2125 line per category: `src/lib/business-expense-categories.ts`.
- Meals: 50% deductible and 50% ITC. Personal: kept, never deducted.
- Capital items: first-year CCA at the class rate (8: 20%, 50: 55%), no
  half-year rule for property available for use 2024-2027.
- GST/HST tax on an expense means GST/HST only. PST/RST is part of the cost.
  Stripe's own fees carry GST + Manitoba RST (12%); only 5/12 is claimed.
- Income tax and CPP: 2026 federal + Manitoba brackets and credits, CPP and
  CPP2 for the self-employed, stacked on any other income from settings.
  Corporation: 9% small business rate, no CPP.
- Projection: year to date plus the last 90 days' pace (or since the first
  sale if newer), without repeating payments over 5x the median payment.

Add next year's rates to `TAX_TABLES` in `business-tax.ts` each January;
until then the estimate uses the latest year loaded and says so.

## Receipts

The browser shrinks photos to 2000px JPEG and uploads to the private
`business-receipts` bucket. `scanReceipt` sends the file to the Lovable AI
Gateway, validates the JSON it gets back, and always creates the expense; if
the read fails or confidence is under 0.8 it is flagged "needs review".

## Stripe fees

`syncStripeFees` reads balance transactions (read-only) and keeps one expense
per month and currency (`external_key = stripe-fees:YYYY-MM:cur`). The page
syncs automatically when the last sync is older than 12 hours. Re-syncing
updates amounts and keeps any category change.

## Summer Ledger

`askSummer` builds a plain-text copy of the books for the selected year
(`src/lib/summer-context.ts`) and sends it with the last 16 messages. Summer
reads; it cannot write. Messages are saved per admin in `summer_messages`
only after a reply comes back.
