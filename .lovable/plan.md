# Simplify the New Product workflow

Rebuild the New Product dialog in `src/routes/_authenticated/admin/payment-links.tsx` as a focused modal that reads like a selling workflow rather than a Stripe configuration form. Existing product records, Stripe sync, payment links, purchases, tax logic, and the Edit flow are all preserved — the redesign is a UI + validation + defaults pass on top of the same data source.

## Scope

- Rebuild the **create** path only (button labeled "New Product"). The **edit** path keeps the current fuller form for now so existing Stripe-linked products remain fully editable without regressions. Advanced Options in the new create modal exposes the same technical fields on demand.
- Do not delete existing columns, server functions, Stripe records, or route paths.
- All writes go through the same `upsertCoachingProduct` / Stripe sync path that Products & Offers, Payments, Transactions, client profiles, and My Purchases already read from.

## New create-modal structure

Single dialog (desktop: centered, max-w ~1000px, sticky header + footer, internal scroll; mobile: full-screen sheet with safe-area padding, sticky title + primary action).

Sections, in order:

1. **Product basics** — Category dropdown (Online Coaching / In-Person Training / Hybrid Coaching / Membership / Program / Session Package / Consultation / Digital Product / Other), Product name, single Description (with an "Add more details" disclosure that reveals the long-form field only when needed), optional Product image.
2. **Pricing** — Segmented control: One-time / Recurring / Payment plan / Free. Price + currency (default CAD). Recurring reveals billing frequency + subscription duration (Renews until cancelled / Fixed number of payments / Fixed end date). Payment plan reveals total, optional deposit, instalments, frequency. Free hides price entirely and skips Stripe price creation. A one-line plain-English summary (`$499 CAD every month for 12 payments`) renders directly under the controls.
3. **Product duration & start rules** — Only rendered when the category actually implies timed access. Access duration (Ongoing / days / weeks / months / fixed end date) and Starts (Immediately / After current product ends / Next Monday / Fixed date / Manual). "Billing duration" and "Service duration" are labeled and stored separately.
4. **What's included** — Repeatable list rows (Add / Remove / drag reorder) instead of a large textarea. Pasting multi-line text auto-splits into rows. Persisted as an array on the product so it can render on checkout, product detail, admin purchase record, and My Purchases.
5. **Sessions & access** — Only rendered for Session Package, In-Person Training, or Consultation categories: sessions included, session length, expiry, booking eligibility. App access uses labeled presets (No app access / Basic member / Full membership / Online coaching client / In-person coaching client / Custom) that map to the existing numeric `access_level`. The raw 0–5 dropdown moves to Advanced Options.
6. **Agreement** — Single toggle "Require agreement before access is activated". When on, reveal template picker + send-automatically + block-until-signed + admin-override. All hidden when off.
7. **Selling controls** — Toggles: self-purchase, promotion codes, self-cancellation, new-customers-only, visible on sales page (last one only when self-purchase is on).
8. **Live summary panel** — Sticky right-column on desktop, collapsible card on mobile. Reflects name, plain-language price, service duration, start rule, included items, checkout mode, tax notice, promo-codes state. Updates on every keystroke.
9. **Advanced Options** — Collapsed by default. Contains Stripe Product ID, Stripe Price ID, Stripe Payment Link ID, raw checkout mode, raw access level, Stripe metadata, internal notes, custom tax behaviour, legacy sync toggles, Status (Draft / Active). Auto-generated values are read-only with an explicit "Unlink & replace" confirm dialog before edits.

Header: "Add Product" + optional subtitle. Footer: Cancel + primary action (`Create Product` normally, `Create Product & Checkout Link` when self-purchase is on). No separate Back button.

## Field consolidation

Removed from the default view (moved to Advanced Options or inferred):

- Product type (old free-form) — replaced by Category dropdown.
- Status — moved to Advanced Options footer; defaults to Draft, flips to Active on successful Stripe sync unless the current flow needs immediate activation.
- Payment structure — merged into Payment type (single source of truth).
- Stripe payment type — inferred from Payment type.
- Checkout Mode — inferred: One-time → payment, Recurring → subscription, Payment plan → subscription schedule, Free → no Stripe.
- Stripe Price ID — read-only in Advanced Options; auto-created on save.
- Term length + Term unit — merged into the recurring / duration blocks with explicit "Billing duration" vs "Service duration" labeling.
- Short description — merged into the single Description; long-form available via "Add more details".
- Internal notes — Advanced Options.
- Access level 0–5 — replaced by labeled presets; raw value stays in Advanced Options.

Consolidated: Payment structure + Stripe payment type → Payment type. Short description + Full details → Description (+ disclosure). What's included textarea → repeatable list.

Inferred automatically: Stripe checkout mode, Stripe Price creation, Payment Link creation, promotion-codes flag, billing-address requirement (when tax needs it), metadata linking back to the JF Effect product.

## Product workspace scoping

New field: **Product workspace** = Coaching / Membership / Both. Default derives from where the modal was opened (Coaching Admin vs Membership Admin). Written to the same product record; existing filters in Products & Offers, Payments, and Membership Payments continue to key off the existing scope columns.

## Validation

All validated inline (not on submit):

- One-time cannot use subscription checkout mode.
- Recurring requires billing frequency.
- Fixed-payments requires a payment count ≥ 1.
- Price cannot be negative; zero only for Free.
- Free cannot create paid checkout.
- Product / service duration cannot be zero.
- Session packages require at least one session.
- Agreement enforcement requires a template.

Submit is disabled while any inline error is unresolved. Duplicate submissions blocked with an in-flight flag.

## Stripe automation

Save flow (all through the existing `upsertCoachingProduct` + Stripe sync path — no new sync system):

1. Persist the JF Effect product (Draft).
2. If paid: create/reuse Stripe Product, create Stripe Price with correct interval/type, create Payment Link with `allow_promotion_codes` from the toggle, attach metadata `{ jf_product_id }`.
3. Save Stripe IDs back to the product.
4. Flip status to Active (or keep Draft if the workflow requires manual activation).
5. Return to the product list with a toast + inline card offering Copy Link / Open Checkout / Assign to Client / View in Stripe.

If any Stripe step fails: preserve the form, show the exact failed step, allow retry, and surface whether the app product was already saved. No hidden duplicate Stripe records — the sync function already dedupes by `jf_product_id` metadata; the new flow reuses that guarantee.

## Tax

Existing Canadian GST/HST logic and Stripe Tax config are untouched. The bold red "STRIPE CHECKOUT SESSION" block is replaced by a compact one-line notice next to the price: "Taxes are calculated automatically from the customer's billing address and added at checkout." Red is reserved for actual errors.

## Modal shell + list state

- Modal renders over the Products page; the list stays mounted, so filters / search / sort / scroll are preserved on close.
- Content is code-split (`React.lazy`) so the modal only loads when opened.
- Route stays on `/admin/payment-links`; no navigation on open or close.
- Mobile PWA: full-screen sheet, sticky primary action pinned above the safe-area inset, large tap targets, no horizontal scroll.

## Files touched

- `src/routes/_authenticated/admin/payment-links.tsx` — swap the current New Product dialog trigger to open the new modal component (edit flow unchanged).
- `src/components/products/new-product-modal.tsx` (new) — the redesigned modal shell + form.
- `src/components/products/sections/*.tsx` (new) — one file per section (basics, pricing, duration, included, sessions-access, agreement, selling, advanced) so nothing balloons past ~250 lines.
- `src/components/products/live-summary.tsx` (new) — the plain-language summary panel.
- `src/lib/product-form/` (new) — Zod schema, category → duration/session/access-preset mapping, access-preset ↔ numeric level mapping, plain-language price formatter, submit orchestrator that calls the existing `upsertCoachingProduct` + Stripe sync server fns.
- No changes to `src/lib/coaching-products.functions.ts`, `src/lib/payments.functions.ts`, `src/lib/stripe-checkout.functions.ts`, `src/routes/api/public/stripe-webhook.ts`, or the DB schema.

## Explicitly out of scope for this pass

- Editing existing products keeps the current fuller form (a follow-up pass can port it onto the new shell once the create flow is proven).
- Membership plan creation (`/admin/member-plans/new`) is a separate form and is not touched here.
- No new columns, no migrations, no changes to Stripe sync internals or tax config.
- No changes to the coaching / membership sidebar wiring shipped in the previous turn.

## Verification

- `bunx tsgo --noEmit` passes.
- Playwright smoke: open modal from `/admin/payment-links`, create a Recurring $499 CAD / monthly / 12-payments / 12-month-access product, confirm summary text, submit, verify Stripe Product + Price + Payment Link are created (single set), verify the new row appears in the list with filters preserved.
- Manual pass on desktop, tablet (`iPad`), and installed PWA widths.

Please approve and I'll implement in one pass.
