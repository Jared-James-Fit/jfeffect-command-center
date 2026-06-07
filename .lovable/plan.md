## Goal
Ship onboarding/access controls so every active client has a clear, verifiable: signed agreement, payment, account setup, and password-reset path — and admin can always copy a manual fallback link when email fails.

## Scope (one pass, four systems)

### 1. Coaching Agreement — status + copy-link + signing flow
- New `AgreementCard` in `clients.$id.tsx` showing: status badge (Signed & Active / Sent — Awaiting Signature / Not Signed / Expired / Needs Re-Sign), agreement name, version, sent date, signed date, "View Signed", "Send Agreement", **Copy Signing Link**, "Re-Send", "Request Re-Sign".
- Status derives from existing `agreements` rows (latest per client). Signing stays on SignNow; "Copy Signing Link" copies the SignNow signing URL stored on the agreement row.
- Add a missing-agreement banner on `/portal/index.tsx` and a "Sign now" CTA linking to `/portal/agreements`.
- Add a `getClientAgreementStatus` server fn and surface "Agreement Missing" badge on `/admin/clients` list + a "Clients needing agreement" count on `/admin/index.tsx`.

### 2. Stripe payment link sharing
- In `/admin/offers.tsx` and `/admin/payment-links.tsx`, add per-offer: status badge (Active — Checkout Ready / Missing Payment Link / Inactive), **Copy Payment Link**, **Open Payment Link**, **Assign to Client**.
- New server fn `getOrCreateOfferCheckoutUrl({ offerId, clientId? })` that returns a generic Stripe Payment Link (cached on offer) OR a client-prefilled Checkout Session URL when `clientId` is set. Webhook already creates `purchase_records`; we pass `client_id` in metadata so client-specific links auto-link.
- Inside a client profile, add "Send Payment Link" picker that lists offers and emits a client-specific copy-able URL.

### 3. Client setup link sharing
- New "Account & Access" section on `clients.$id.tsx` with: account status, last sign-in, setup status (derived from `clients.account_status` / `last_signed_in_at`), **Copy Setup Link**, **Send Setup Link**, **Generate New Setup Link**.
- Server fn `generateClientSetupLink(clientId)` → `supabaseAdmin.auth.admin.generateLink({ type: 'invite' | 'magiclink', email, redirectTo: '/portal' })` (Supabase magic link). Logs to `client_activity_log` and updates `clients.setup_link_last_sent_at`.

### 4. Password reset link sharing
- Same Account & Access section: **Copy Password Reset Link**, **Send Password Reset Email**, **Generate New Reset Link**.
- Server fn `generateClientPasswordResetLink(clientId)` → `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, redirectTo: '/reset-password' })`. Shows the link + expiry from Supabase response. Logs to activity log.

### 5. Dashboard + client list surfacing
- `/admin/clients` row badges: Agreement Missing · Setup Pending · No Login Yet.
- `/admin/index.tsx`: a small "Onboarding action needed" card listing counts (Missing Agreement, Setup Pending, No Login).

## Database (one migration)
- `clients`: add `setup_link_last_sent_at timestamptz`, `setup_link_last_copied_at timestamptz`, `password_reset_last_sent_at timestamptz`, `password_reset_last_link_at timestamptz`.
- `offers`: add `stripe_payment_link_url text`, `stripe_payment_link_id text` (cache generic Payment Link).
- No new tables; reuse `agreements`, `agreement_templates`, `clients`, `offers`, `purchase_records`, `client_activity_log`.

## Server functions (new files in `src/lib/`)
- `client-access.functions.ts` — `generateClientSetupLink`, `generateClientPasswordResetLink`, `getClientAccessStatus`.
- Extend `agreements.functions.ts` — `getClientAgreementSummary`, `requestAgreementResign`, `copySigningLink` reads existing `agreements.signing_url`.
- Extend `payments.functions.ts` / `stripe-checkout.functions.ts` — `getOrCreateOfferPaymentLink`, `createClientCheckoutUrl({ offerId, clientId })`.
- All use `requireSupabaseAuth` + `has_role('admin')` check; setup/reset generation uses `supabaseAdmin` inside the handler.

## UI files touched
- `src/routes/_authenticated/admin/clients.$id.tsx` — add Agreement card + Account & Access card + Send Payment Link picker.
- `src/routes/_authenticated/admin/clients.index.tsx` — onboarding badges.
- `src/routes/_authenticated/admin/index.tsx` — onboarding action card.
- `src/routes/_authenticated/admin/offers.tsx` + `payment-links.tsx` — copy/open/send link buttons + status badge.
- `src/routes/_authenticated/portal/index.tsx` — "Sign your agreement" banner when missing.

## Security
- Admin-only server fns gated by `has_role(auth.uid(),'admin')`; coach gated by `is_assigned_coach(client_id)`.
- Reset/setup links generated server-side via `supabaseAdmin` — never exposed in client bundle.
- Activity log row written on every generate/copy/send action.

## Out of scope (call out, do not build)
- Native in-app signature pad (you chose to keep SignNow).
- Custom token table for setup/reset (you chose Supabase magic links).
- Notifications (Section 8) — small follow-up; only an activity log entry today.

## Order of implementation
1. Migration (clients + offers columns).
2. Server fns (`client-access`, agreement summary, payment link helpers).
3. Client profile UI (Agreement card + Account & Access card + Send Payment Link).
4. Offers / Payment Links page actions.
5. Client list badges + admin dashboard onboarding card.
6. Portal "sign your agreement" banner.
7. Manual test pass on desktop + mobile viewport for each "copy link" button.