
# Forgot Password / Account Recovery — Implementation Plan

## Scope

A single recovery system that works for clients, members, coaches, and admin — all of whom already authenticate through Supabase Auth. We will **not** create a parallel auth system. Email recovery uses Supabase's native reset token (which is already wired through the Lovable email queue and the existing branded `RecoveryEmail` template). SMS recovery uses our own short-lived, hashed token stored in a new `password_recovery_tokens` table, redeeming to the same `/reset-password` page.

## What gets built

### 1. Login page CTA
- Add a "Forgot password or can't access your account?" link under the password field in `src/routes/auth.tsx`, routing to `/recover`.

### 2. Recovery screen — `src/routes/recover.tsx` (public)
- One input, auto-detects email vs phone (E.164 normalisation for phone).
- "Send Recovery Instructions" button calls a new public server fn `requestAccountRecovery`.
- Always renders the same neutral confirmation, regardless of whether the account exists.

### 3. Recovery server function — `src/lib/account-recovery.functions.ts`
- Public `createServerFn` (no auth middleware) that:
  - Rate-limits per identifier (1/60s, 5/h) and per IP (10/h) using a new `recovery_rate_limits` table.
  - Looks up the user via `supabaseAdmin.auth.admin` + `app_members` / `clients` / `coaches` for verified phone.
  - Determines verified email and verified phone for the account.
  - **Email path**: `supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: PROD_URL + '/reset-password' })`. This flows through the existing `/lovable/email/auth/webhook` → `RecoveryEmail` template → email queue. Subject already configurable; we'll set it to "Reset Your JF Effect Password".
  - **SMS path**: mint a 32-byte random token, store SHA-256 hash + `user_id` + `expires_at = now()+30m` + `attempts_remaining = 5` + `consumed_at = null` in `password_recovery_tokens`, send branded SMS via existing Twilio helper with link `https://jfeffect.com/reset-password?rt=<token>`.
  - Per spec §5: if email entered → email + SMS-if-verified-phone; if phone entered → SMS + email-if-verified-email; never to unverified methods; independent try/catch per channel.
  - All link URLs hard-coded to the production custom domain (`https://jfeffect.com`) — never preview/localhost.
  - Honors existing Dry Run / notification allowlist gate already used by `sms_log`/`jf_notification_attempts`.

### 4. Reset password page updates — `src/routes/reset-password.tsx`
- Detect `?rt=<token>` query param (SMS path) in addition to the existing Supabase recovery hash flow.
- For `rt` path: call new `validateRecoveryToken({ token })` server fn (returns `{ valid, expired, consumed }`). On submit, call `consumeRecoveryToken({ token, newPassword })` which:
  - Re-hashes and looks up token, atomically marks `consumed_at`, decrements `attempts_remaining`.
  - Uses `supabaseAdmin.auth.admin.updateUserById(user_id, { password })`.
  - Calls `supabaseAdmin.auth.admin.signOut(user_id, 'global')` to revoke other sessions.
  - Sends "password changed" confirmation to both verified channels.
- Real-time password rule checklist (≥10, upper, lower, digit, special), show/hide toggle, "Update Password" disabled until valid+matching.
- Expired/invalid token state shows the spec's message with a "Send a New Recovery Link" button → `/recover`.

### 5. Admin-initiated reset
- Reusable `<SendPasswordResetDialog>` component added to client/member/coach/admin profile screens.
- Shows masked destinations (`j***@example.com`, `***-***-1234`), radio for Email / SMS / Both.
- Calls new `adminSendPasswordReset` server fn (requires `requireSupabaseAuth` + admin role check) that performs the same dispatch as the public flow but bypasses rate limits, attaches `initiated_by_admin_id` to the audit record.
- Renders delivery status badges (Email Sent / SMS Sent / Partially Delivered / Delivery Failed / Rate Limited) sourced from a new `password_reset_events` table.

### 6. Audit logging
- New `password_reset_events` table records every request, attempt, success, failure with: actor (self / admin id), target user id, channel, masked destination, outcome, timestamp, IP. Never stores tokens or passwords. Surfaces in admin UI and in `admin_audit_log` via trigger.

### 7. Account Settings — "Login & Security"
- New section component under the existing member/client account settings tree:
  - Change Password (supabase updateUser w/ current password reauth).
  - Recovery Email / Recovery Mobile with verified badge + "Send verification" actions (use existing email + Twilio verify flows).
  - Last password change timestamp (from `password_reset_events`).
  - "Sign Out of All Devices" → `supabase.auth.signOut({ scope: 'global' })`.

## Database changes (single migration)

```text
public.password_recovery_tokens
  id uuid pk, user_id uuid (auth.users), token_hash text, channel text,
  expires_at timestamptz, consumed_at timestamptz, attempts_remaining int,
  created_ip inet, created_at timestamptz
  index (token_hash), index (user_id, created_at)
  RLS: deny all to anon/authenticated; service_role only.

public.recovery_rate_limits
  identifier text (lowercased email/phone/ip), kind text, window_start timestamptz, count int
  unique (identifier, kind, window_start)
  RLS: service_role only.

public.password_reset_events
  id uuid pk, target_user_id uuid, initiated_by uuid null, actor_kind text,
  channel text, destination_masked text, outcome text, error_code text null,
  ip inet, user_agent text, created_at timestamptz
  RLS: admin read via has_role('admin'); insert service_role only.
```

All three tables get the standard `GRANT` block + RLS + policies per platform rules.

## Security guarantees

- Tokens: 32 random bytes (`crypto.randomBytes`), only SHA-256 hash stored, single-use, 30-min TTL, max 5 redemption attempts.
- Neutral response on the recovery endpoint regardless of account existence.
- Reset link domain is always the production custom domain; constant in `src/lib/account-recovery.constants.ts`.
- Server-side validation only; no token state in the URL beyond the opaque random string.
- Admin endpoint requires `has_role(auth.uid(), 'admin')`; admins never see tokens, current passwords, or temp passwords.
- All writes via `supabaseAdmin` inside server fn handlers (loaded with `await import`), respecting RLS on app tables.

## File map

```text
supabase/migrations/<ts>_password_recovery.sql          (new)
src/lib/account-recovery.constants.ts                   (new)
src/lib/account-recovery.functions.ts                   (new — public + admin server fns)
src/lib/account-recovery.server.ts                      (new — hashing, masking, rate-limit helpers)
src/routes/recover.tsx                                   (new public route)
src/routes/reset-password.tsx                            (extend for ?rt= token path)
src/routes/auth.tsx                                      (add forgot-password link)
src/components/account/send-password-reset-dialog.tsx    (new)
src/components/account/login-security-section.tsx        (new)
src/lib/email-templates/recovery.tsx                     (subject update only)
src/lib/email-templates/password-changed.tsx             (new confirmation template)
src/routes/_authenticated/admin/clients.$id.tsx          (mount admin reset dialog)
src/routes/_authenticated/admin/coaches.$id.tsx          (mount admin reset dialog)
src/routes/_authenticated/admin/members.$id.tsx          (mount admin reset dialog)
src/routes/_authenticated/m/account.tsx                  (mount Login & Security section)
```

## Out of scope / explicit non-goals

- No new identity provider, no parallel password store.
- No changes to existing OAuth (Google) flows.
- No bulk recovery tooling.
- No SMS opt-in UX changes — we reuse the existing verified-phone state.

## Verification before marking complete

1. Migration applied; new tables visible with correct RLS + GRANTs.
2. `/recover` accepts email and phone, always returns the neutral confirmation, rate limits trigger correctly.
3. Email reset arrives in queue with production link; SMS reset arrives with `?rt=` link; both land on `/reset-password` and successfully change the password.
4. Used / expired / over-attempted tokens show the invalid-link UI.
5. Other sessions are revoked after success; confirmation email + SMS dispatched.
6. Admin dialog dispatches correctly, shows delivery status, writes audit row, never exposes token.
7. Account Settings → Login & Security renders for member/client and respects verification state.
8. Dry Run / allowlist gate suppresses real sends in non-prod (verified via existing notification gate test pattern).
