# JF Effect — Completion Audit

_Generated: 2026-06-14. Evidence-based, no code changes performed._

_Re-verified: 2026-06-14 (same day). Confirmed against live DB: storage policies B6 still bound to `{-}` (catch-all), legal doc state unchanged (5/12 published, enforcement off across all 12), notification mode has progressed `dry_run` → `allowlist` (1 phone + 1 email allowlisted) — B2 partially cleared; remaining P0/P1 items below all still apply._

---

## A. EXECUTIVE SUMMARY

| Metric | Value |
|---|---|
| **Overall completion** | **~85%** of feature surface; ~70% production-ready |
| **Launch-ready** | **NO** |
| **Critical (P0) blockers** | **11** |
| **High-priority (P1) items** | **18** |
| **Medium-priority (P2) items** | **22** |
| **Low-priority (P3) polish** | **30+** |

The product is structurally complete: 172/172 tables have RLS on, the membership signup → Stripe → webhook → lifecycle chain is wired end-to-end, all 19 audited feature workflows have admin + DB + client persistence. What's blocking launch is configuration, two security gaps with real exfiltration risk, and a handful of "coming soon" stubs visible to paying users.

---

## B. CRITICAL LAUNCH BLOCKERS (P0)

### B1. Kill switch is OFF
- **Implemented:** `public_checkout_enabled` field in `jf_membership_settings`, launch gate honors it.
- **Broken:** Current DB value is `false`. `/join` shows "Signups Temporarily Paused".
- **Files/tables:** `jf_membership_settings`, `src/lib/membership-launch-gate.functions.ts`.
- **Work:** Toggle in `/admin/membership/checkout-settings` once everything else clears.

### B2. Notification mode is `dry_run`
- **Implemented:** New UI card on `/admin/membership/notifications` (just shipped) writes to `app_settings.jf_membership_notifications`.
- **Broken:** Value is still `dry_run`. Every membership lifecycle SMS (purchase, trial_end, payment_failed, recovered, canceled, frozen, etc.) silently no-ops and is logged as `dry_run` in `jf_notification_attempts`.
- **Files:** `src/lib/sms-trigger.server.ts`, `src/lib/launch-readiness.functions.ts:215`.
- **Work:** Run QA in `allowlist` mode first, then flip to `live`.

### B3. Production secrets missing from runtime env
`.env` only has 7 publishable keys. The following are referenced in source and **must** be present at runtime or the app silently breaks:
- `STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_TEST` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET_TEST`
- `SUPABASE_SERVICE_ROLE_KEY` (every server fn that uses `supabaseAdmin`)
- `TWILIO_API_KEY` (SMS triggers)
- `RESEND_API_KEY` (auth + transactional email)
- `SCHEDULED_WORKER_SECRET` (every cron worker returns 401 without it)
- `SIGNNOW_*` (agreement signing pipeline)
- `FILLOUT_API_KEY` / `FILLOUT_WEBHOOK_SECRET`
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (calendar sync)
- `LOVABLE_API_KEY` (AI form review)

**Note:** Lovable Cloud does not surface `SUPABASE_SERVICE_ROLE_KEY` or the DB password; on Lovable infra it's injected automatically — confirm the published runtime sees it. The others must be added via project secrets.

### B4. Legal documents — 7 of 12 have no published version
- **Published v2:** terms-of-service, privacy-policy, membership-agreement, recurring-billing-disclosure, cancellation-and-refund-policy. All `public_read_allowed=true`. ✅
- **No version yet:** ai-assisted-coaching-disclosure, coaching-disclaimer, communication-consent, media-and-testimonial-release, medical-injury-disclaimer, nutrition-disclaimer, upload-and-progress-photo-consent.
- **`enforcement_enabled = false` on ALL 12** — even the 5 published ones are notice-only, not gating sign-up or in-app access.
- **Files:** `legal_documents`, `legal_document_versions`, `src/routes/_authenticated/admin/legal.tsx`.
- **Work:** Decide enforcement posture per doc; publish or mark non-applicable the remaining 7; flip `enforcement_enabled` on ToS + Membership Agreement at minimum.

### B5. Sales-page key mismatch
- `/join` queries `sales_pages.page_key="join"`. Launch Readiness panel checks `page_key="membership"`. Result: panel can read "ready" while the wrong row is published.
- **Files:** `src/routes/join.tsx:72`, `src/lib/launch-readiness.functions.ts:303`.
- **Work:** Standardize on one key (recommend `"join"`), update the readiness check.

### B6. `client-action-files` storage policies bound to `{public}` role
- 3 policies (Admin manage, Clients read own, Coaches manage) use `role={public}` instead of `{authenticated}`. RLS QUAL still references `auth.uid()`, so live exposure is unlikely — but defense-in-depth fails if `auth.uid()` ever evaluates null.
- **Work:** Migration: `ALTER POLICY ... TO authenticated`.

### B7. Cross-coach support-message leak
- `member_support_messages.msm_coach_select` uses `is_coach_or_admin(auth.uid())` with no assigned-client scope. Any active coach can read every member's support thread.
- **Files:** `member_support_messages` RLS policy.
- **Work:** Scope by `is_assigned_coach(member's client)`.

### B8. `client_action_requests` writes have no server-side authorization
- `src/lib/client-action-requests.ts:35,~80,~95` — `createClientActionRequest`, `deleteClientActionRequest`, `resendClientActionRequest` are direct client-side Supabase calls. Any authenticated user who guesses a `clientId` can insert/delete. Sole protection is RLS — verify policies enforce `is_assigned_coach` or admin on INSERT.
- **Work:** Convert to server fns with `requireSupabaseAuth` + role check, or add `WITH CHECK` constraints.

### B9. `portal/agreements.index.tsx` reads agreements without client filter
- Line ~30: `supabase.from("agreements").select("*")` — no `.eq("client_id", …)` filter. Security is 100% RLS-dependent. Confirm RLS scopes by `clients.user_id = auth.uid()`.
- **Work:** Add explicit `.eq("client_id", client.id)` defense-in-depth filter.

### B10. `jf_pending_signups` cleanup cron not scheduled
- HTTP handler exists (`src/routes/api/public/hooks/cleanup-pending-signups.ts`). Auth guard is anon-key only (any visitor who knows the publishable key can trigger). `pg_cron` job `jf-cleanup-pending-signups-hourly` reports `exists_=false` per `get_membership_cleanup_job_status`.
- **Work:** Schedule the cron via pg_cron migration; tighten the handler to require `SCHEDULED_WORKER_SECRET`.

### B11. Cron/webhook handler signature verification — ✅ RESOLVED 2026-06-14
- `appointment-reminders.ts`, `sms-reminders.ts`, `media-archive.ts`, `cleanup-pending-signups.ts`, `lift-archive-tick.ts` — all now require `SCHEDULED_WORKER_SECRET` via `x-worker-secret` header or `?secret=` query param with constant-time compare; return 401 otherwise. Old `apikey`/publishable-key acceptance removed.
- `fillout.ts` — `x-fillout-secret` check upgraded to constant-time compare against `FILLOUT_WEBHOOK_SECRET`.
- **Follow-up:** ensure `SCHEDULED_WORKER_SECRET` is set in runtime env (tracked in B3) and any pg_cron job rows for these endpoints are updated to send the new header.

---

## C. PARTIALLY COMPLETED FEATURES

| Feature | Works | Broken / Missing | Files |
|---|---|---|---|
| **Workout builder — multi-block templates** | single-block assignment, client view | Slice 3 documented gap: multi-block assignment is Preview-only, not visible to client | `src/lib/pl-programs.functions.ts:59-66` |
| **Workout feedback submit** | UI + DB write + admin "mark reviewed" | Direct client-side Supabase write, no server fn auth gate | `src/components/workout-feedback-sheet.tsx` |
| **Portal resources route** | `m/resources` (member route) works | `portal/resources.tsx` is a `<ComingSoon phase=Phase 2 />` stub — coaching clients see nothing | `src/routes/_authenticated/portal/resources.tsx` |
| **Promotions** | Stripe-side redemption captured; admin sees in promo-tools | No in-app promo code entry UI for clients | `src/lib/promo-redemptions.functions.ts`, no portal route |
| **Refunds** | Cancel / pause / freeze / hold / reactivate all wired | **No refund server fn** — must use Stripe Dashboard manually | `src/lib/jf-billing.functions.ts` |
| **AI form analysis** | Generate / draft / approve / schedule / send | `scheduled-send-worker` is cron-only — no status surfacing if worker dies | `src/routes/api/public/hooks/scheduled-send-worker.ts` |
| **Marketing consent** | `sms_consent` saved | `marketing_consent` checkbox conflated with `sms_consent`; no separate email-marketing opt-in | `src/routes/join.tsx:138` |
| **Email notifications** | SMS triggers complete (11 events) | No email lifecycle channel — only SMS | `src/lib/sms-trigger.server.ts` |
| **Important dates / Google calendar / event_assignments** | Schema exists | Zero route/function references — tables unused | `important_dates`, `google_calendar_connections`, `event_assignments` |
| **Bulk Stripe resync** | Button rendered | `onClick={() => toast.message("coming soon")}` | `src/routes/_authenticated/admin/membership.stripe-sync.tsx:20` |
| **CRM ↔ client action requests** | Both work independently | CRM tasks can't auto-generate client action requests | n/a |
| **Sitemap** | `/sitemap` exists | It's an internal nav page, not an XML sitemap. Search engines have nothing to crawl | `src/routes/sitemap.tsx` |
| **OG images** | Title / desc / twitter card on `/`, `/join`, `/coaching` | **Zero `og:image` tags** anywhere; social shares get no preview | `src/routes/__root.tsx`, `join.tsx`, `coaching.tsx` |

---

## D. APPEARS COMPLETE, REQUIRES MANUAL VERIFICATION

1. **Stripe Customer Portal** — `openBillingPortal` returns a portal session URL; needs one live test from `/m/billing` against the live key.
2. **SignNow webhook** — signature verified correctly; no `processed_events` table — confirm `pullSignedDocumentForAgreement` is idempotent against duplicate webhook deliveries.
3. **Stripe webhook idempotency** — uses `processed_stripe_events` unique constraint. Confirm the migration is applied in prod.
4. **Lift video Drive archive** — `archiveLiftVideoToDrive` requires Google Drive creds + `lift-archive-tick` cron; verify the loop works end-to-end with current secrets.
5. **Group chats permission_mode enforcement** — `addGroupMembers` is a server fn but member visibility within a group also depends on `chat_group_members` RLS — confirm no cross-group leakage.
6. **Native form `nf_submissions` AI review queue** — depends on `scheduled_send_worker` cron firing on time. No dashboard alert if it stalls.
7. **Recipes / nutrition target days** — present in types and routes, no end-to-end gap surfaced; needs one full assign-and-view test.
8. **Coaching application intake** — `coaching_applications` allows anonymous INSERT with `WITH CHECK (true)`; intentional for public intake form, but spam-vulnerable.
9. **Membership cleanup cron handler** — handler works, but live-fire test needed once pg_cron schedule is in place.
10. **Trial-end + grace-period lifecycle SMS** — wired but never fires in `dry_run`; must observe in allowlist mode before live.

---

## E. PLACEHOLDERS, TODOs, TECHNICAL DEBT

### "Coming Soon" pages visible to users
- `src/routes/_authenticated/admin/sops.tsx`, `automations.tsx`, `content-ideas.tsx`, `programs.tsx`, `testimonials.tsx` — all `<ComingSoon phase="Phase 2/3" />`
- `src/routes/_authenticated/m/resources.tsx`, `m/tools.tsx` — entire body is "coming soon"
- `src/routes/_authenticated/portal/resources.tsx` — coaching-client resources stub
- `src/routes/_authenticated/media/content.tsx:133` — inline "upload tools coming soon"
- `src/components/admin/membership-leaf.tsx:17` — `<div>Coming soon</div>`
- `src/routes/_authenticated/admin/membership.stripe-sync.tsx:20` — toast stub
- `src/components/connect-health-device-card.tsx:31` — disabled "Coming soon" button
- `src/components/payment-request-card.tsx:44` — disabled "Link unavailable"
- `src/routes/_authenticated/portal/agreements.index.tsx:84` — disabled "Waiting on signing link"
- `src/routes/_authenticated/m/plans.tsx:82` — disabled "Locked" button with no handler
- "Video coming soon." inline strings at `portal/exercises.tsx:112`, `portal/workouts.$dayId.tsx:1295`

### Hardcoded JF Effect domain literals (12 occurrences)
- `src/components/appointments/send-booking-link-dialog.tsx:13` — `https://jfeffect.com` fallback
- `src/components/sales/share-toolbar.tsx:6,19` — hardcoded
- `src/lib/appointments-ics.ts:19` — `jfeffect.com` default
- `src/lib/events.ts:151` — ICS UID `@jfeffect.events`
- `src/routes/__root.tsx:221-222` — OG/Twitter image URLs hardcoded
- `src/routes/coaching.tsx:45,50` — canonical
- `src/routes/join.tsx:50` — og:url
- `src/routes/lovable/email/auth/preview.ts:21-22,29`
- `src/routes/lovable/email/auth/webhook.ts:34-37`
- `src/lib/launch-readiness.functions.ts:298` — `support@jfeffect.com` example
- `src/routes/_authenticated/admin/settings.tsx:557` — SignNow callback URI placeholder

### Other debt (counts)
- **70+ `console.log/warn/error`** across stripe-webhook, signnow-webhook, fillout webhook, scheduled-send-worker, billing fns, lifecycle fns, voice transcribe, drive integration, chat audio analyser, etc. (Acceptable in webhook/cron handlers; should be removed from UI components.)
- **~50 `: any` / `as any` casts** in `.functions.ts` files (agreements, appointments, booking-links, coaches, coaching-products, etc.)
- **~35 `eslint-disable` suppressions** — mostly `react-hooks/exhaustive-deps`
- **~25 commented-out blocks > 5 lines** — most are file-header docs, but a few are legacy logic (e.g. `pl-bulk.functions.ts:258-264`, `agreements.functions.ts:216-225`)
- **8 redirect-tombstone routes** under `/admin/*` — intentional, can be deleted next cleanup pass
- **`src/lib/api/example.functions.ts`** — scaffold never used; delete

### Orphan routes (no nav link, not a redirect tombstone)
- `admin/sops.tsx`, `automations.tsx`, `content-ideas.tsx`, `programs.tsx`, `testimonials.tsx` (linked only from `business-systems.tsx` tile, which itself redirects)
- `admin/training-phases.tsx` (linked only from a dashboard "View All")

---

## F. DATABASE AND SECURITY AUDIT

### Strengths
- RLS enabled on **172/172** public tables.
- All **77** `SECURITY DEFINER` functions have `search_path` pinned.
- **0** public storage buckets.
- No views or RLS expose `auth.users` PII.

### Findings (ranked)

| # | Severity | Finding |
|---|---|---|
| 1 | 🔴 High | `storage.objects.client-action-files` × 3 policies bound to `{public}` instead of `{authenticated}` |
| 2 | 🔴 High | `member_support_messages.msm_coach_select` — any coach reads all members' threads |
| 3 | 🟠 Med-High | `jf_pending_signups` — RLS on, zero policies, holds PII; no documented access path |
| 4 | 🟠 Med-High | `coaching_applications` — anonymous INSERT `WITH CHECK (true)`, no rate limit |
| 5 | 🟡 Med | `product_access_grants` SELECT `USING (true)` for `authenticated` — exposes full permission map |
| 6 | 🟡 Med | `avatars` bucket SELECT scope is bucket-wide, not owner-scoped |
| 7 | 🟡 Med | `jf_membership_settings` SELECT `USING (true)` to `{public}` — pricing/config visible to anon |
| 8 | 🟡 Med | `agreements` bucket — templates readable by every authenticated user |
| 9 | 🟡 Med | `sms_log` admin INSERT policy has no `WITH CHECK` binding — admin can spoof rows |
| 10 | 🟢 Low-Med | `coaching_products` / `offers` have no client-read policy — relies on SECURITY DEFINER fns only |

No missing GRANTs detected — project uses schema-level grants combined with RLS.

---

## G. LAUNCH CONFIGURATION AUDIT

| Item | Status | Notes |
|---|---|---|
| Production env vars | ⚠️ Partial | See B3 — many production secrets not visible to runtime |
| Domain routing | ✅ | `jfeffect.com` + `www.jfeffect.com` connected |
| Supabase prod | ✅ | RLS in place, project mode confirmed |
| Stripe prod | ⚠️ | Mode = `live`; secrets must be confirmed; **`public_checkout_enabled = false`** |
| Webhooks — Stripe | ✅ | HMAC verified, idempotency via `processed_stripe_events`, signing tolerates 5min |
| Webhooks — SignNow | ✅ | HMAC verified |
| Webhooks — Fillout | ⚠️ | Bearer-string equality (not timing-safe) |
| Cron workers | ⚠️ | Cleanup pending-signups not scheduled; appointment-reminders no auth guard |
| Emails | ⚠️ | No transactional/lifecycle email channel — only SMS |
| SMS | ⚠️ | Templates depend on `sms_automations` DB rows; `dry_run` mode; Twilio key not in env |
| Storage policies | ⚠️ | `client-action-files` × 3 policies bound to `{public}` |
| Legal publication | ⚠️ | 5 of 12 published; enforcement off across the board |
| Analytics | ❓ | No analytics instrumentation found in source — confirm if intentional |
| Error monitoring | ❓ | Only `console.error`; no Sentry/equivalent SDK detected |
| Backups | n/a | Supabase-managed |
| Rate limiting | ❌ | No CAPTCHA on `/join`, `/coaching/apply`, `coaching_applications` insert |
| Sitemap.xml | ❌ | `/sitemap` is internal nav, not crawlable XML |
| OG images | ❌ | No `og:image` on any public route |

---

## H. PRIORITIZED MASTER CHECKLIST

### P0 — MUST clear before launch

1. [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to runtime secrets (verify on published runtime)
2. [ ] Add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` to runtime secrets (live mode)
3. [ ] Add `TWILIO_API_KEY` (and any other Twilio creds the chosen client expects) to runtime secrets
4. [ ] Add `RESEND_API_KEY` to runtime secrets
5. [ ] Add `SCHEDULED_WORKER_SECRET` to runtime secrets
6. [ ] Add `SIGNNOW_CLIENT_ID`, `SIGNNOW_CLIENT_SECRET`, `SIGNNOW_WEBHOOK_SECRET` to runtime secrets
7. [ ] Fix sales-page key mismatch — make `/join` and Launch Readiness agree on one `page_key` ("join")
8. [ ] Publish the membership sales page row at `/admin/sales/membership` and confirm `/join` renders the live copy (not the hardcoded fallback)
9. [ ] Migration: `ALTER POLICY` for all 3 `client-action-files` storage policies → role `authenticated`
10. [ ] Migration: scope `member_support_messages.msm_coach_select` to assigned clients only
11. [ ] Migration: add admin-only RLS policies on `jf_pending_signups` (and document SECURITY DEFINER-only writes)
12. [ ] Convert `createClientActionRequest`/`deleteClientActionRequest`/`resendClientActionRequest` to server fns with `requireSupabaseAuth` + `is_assigned_coach` / admin check
13. [ ] Add explicit `.eq("client_id", client.id)` filter in `src/routes/_authenticated/portal/agreements.index.tsx:30`
14. [ ] Add `SCHEDULED_WORKER_SECRET` header check (timing-safe) to: `appointment-reminders.ts`, `sms-reminders.ts`, `media-archive.ts`, `cleanup-pending-signups.ts`, `lift-archive-tick.ts`
15. [ ] Replace plain string equality in `hooks/fillout.ts` with `timingSafeEqual`
16. [ ] Create pg_cron schedule for `jf-cleanup-pending-signups-hourly` calling the cleanup endpoint
17. [ ] Verify Stripe Customer Portal flow from `/m/billing` against the live key, end-to-end
18. [ ] Publish current draft for ToS and Membership Agreement OR mark notice-only intentionally, then flip `enforcement_enabled=true` on at least those two
19. [ ] Verify `sms_automations` rows exist for each of the 11 wired membership triggers; activate `notification_mode=allowlist`, send a test, then flip to `live`
20. [ ] Flip `jf_membership_settings.public_checkout_enabled = true`

### P1 — Immediately after P0

21. [ ] Stripe refund server function with admin gate + audit log row + `payment_records.refund_status`
22. [ ] Replace `m/resources.tsx` and `m/tools.tsx` `ComingSoon` stubs with empty-state cards that mention "no items yet" (don't expose phase numbers)
23. [ ] Replace `portal/resources.tsx` ComingSoon with the existing `member-resources` listing scoped to coaching clients (reuse `memberListResources` logic)
24. [ ] Add `og:image` (1200×630) on `/`, `/join`, `/coaching` route `head()` blocks
25. [ ] Create real `/sitemap.xml` server route emitting indexable public URLs
26. [ ] Decide and publish remaining 7 legal documents OR mark them archived/non-applicable
27. [ ] Tighten `jf_membership_settings` SELECT policy — strip non-public columns from the public-readable surface (move pricing display values to a public view)
28. [ ] Add owner-scope to `avatars` storage SELECT policy (or accept "semi-public" intentionally)
29. [ ] Restrict `agreements` bucket `templates/` folder reads to admin/coach roles
30. [ ] Scope `product_access_grants` SELECT to admin/coach
31. [ ] Add `WITH CHECK` clause to `sms_log` admin INSERT policy
32. [ ] Rate-limit or CAPTCHA-protect `coaching_applications` INSERT (Edge function wrapper or trigger)
33. [ ] Email lifecycle channel for membership events — at minimum: welcome, trial-ending, payment-failed (transactional via Resend)
34. [ ] Wire `important_dates`, `event_assignments`, `google_calendar_connections` into Calendar UI OR drop them from types
35. [ ] Multi-block template assignment slice 4+5 (`pl-programs.functions.ts:59`)
36. [ ] Move `client_action_requests` writes from `client-action-requests.ts:35,~80,~95` to server fns (overlaps P0 #12)
37. [ ] Convert `WorkoutFeedbackSheet` write to a server fn with explicit auth
38. [ ] Replace `marketing_consent` → `sms_consent` conflation with two distinct fields (SMS opt-in vs email marketing opt-in)

### P2 — Operational improvements

39. [ ] Centralize JF domain literals into one `src/lib/site-config.ts` constant; replace 12 hardcoded references
40. [ ] Delete `src/lib/api/example.functions.ts`
41. [ ] Delete or finish 5 admin "Coming Soon" pages (`sops`, `automations`, `content-ideas`, `programs`, `testimonials`)
42. [ ] Surface scheduled-worker stalls in admin (last-run timestamp + failure count on launch-readiness panel)
43. [ ] Add a Stripe-resync admin action (currently just a "coming soon" toast)
44. [ ] Add error monitoring SDK (Sentry or equivalent) so server errors aren't only in `console.error`
45. [ ] Add minimal analytics (page-view + signup-funnel events) — even just to PostHog free tier
46. [ ] Strip `console.*` calls from UI components (acceptable to keep in webhooks/cron)
47. [ ] Replace `: any` / `as any` casts in the 12 most-trafficked `.functions.ts` files
48. [ ] Audit `eslint-disable react-hooks/exhaustive-deps` suppressions — every one is a potential stale-closure bug
49. [ ] Promo code entry in-app (client-facing, not just Stripe Checkout)
50. [ ] Auto-create `client_action_requests` from CRM tasks where applicable
51. [ ] Add idempotency table for SignNow webhook (`processed_signnow_events`)
52. [ ] Replace `<details>` collapsed PT cards on portal calendar with proper accordion if mobile QA flags
53. [ ] Add a "test webhook" button on Launch Readiness to verify Stripe round-trip
54. [ ] Delete 8 redirect-tombstone routes after confirming no external links rely on them
55. [ ] Add a banner on `/admin/sales/membership` if the published `sales_pages` row diverges from the latest draft
56. [ ] Add a `jf_test_mode` indicator chip in admin nav when `STRIPE_SECRET_KEY` is a test key
57. [ ] Sweep `appointment_reminders` cron — confirm reminders actually fire end-to-end once `SCHEDULED_WORKER_SECRET` is in place
58. [ ] Verify lift-video Drive archive loop end-to-end with `archiveLiftVideoToDrive`
59. [ ] Document SECURITY DEFINER-only access path for `jf_pending_signups` in a SQL comment
60. [ ] Verify `processed_stripe_events` table exists in production migration history

### P3 — Polish

61. [ ] Delete commented-out logic blocks (`pl-bulk.functions.ts:258`, `agreements.functions.ts:216,367`, etc.)
62. [ ] Standardize file-header docblocks (currently 11 files have 6-15 line headers)
63. [ ] Replace disabled "Locked" / "Coming soon" / "Waiting on signing link" buttons with proper empty-states or hidden CTAs
64. [ ] Add `<noscript>` fallback on public routes
65. [ ] Audit nav: training-phases page is orphan (no nav link)
66. [ ] Mobile QA pass on all admin route panels at 375px
67. [ ] Mobile QA on `/m/billing`, `/m/welcome`, `/portal/calendar`, `/portal/workouts/$dayId`
68. [ ] Verify `home-screen-setup-card` PWA install flow on iOS Safari
69. [ ] Verify offline workout-set queue replays correctly after a long offline window
70. [ ] Add a tiny "what's new" changelog on `/admin/index`

---

## I. RECOMMENDED EXECUTION BATCHES

### Batch 1 — "Lock the doors" (P0 security + RLS)
- **Tasks:** P0 #9, #10, #11, #12, #13, #15
- **Files:** new migration; `src/lib/client-action-requests.ts`; `src/routes/_authenticated/portal/agreements.index.tsx`; `src/routes/api/public/hooks/fillout.ts`
- **DB changes:** 1 migration with policy alters + new admin-only policies on `jf_pending_signups` + role swap on `client-action-files` storage policies
- **Risk:** Cross-coach admin role check could fail if `is_assigned_coach` semantics differ — add a unit test against a fixture coach
- **Tests:** RLS smoke tests confirming (a) coach A cannot read coach B's client's support thread, (b) anon cannot insert `client_action_requests`, (c) anon cannot read `jf_pending_signups`
- **DoD:** Migrations applied, smoke tests pass, `manage_security_finding` cleared for the 3 high findings

### Batch 2 — "Plug in the secrets" (P0 env + cron)
- **Tasks:** P0 #1–6, #14, #16
- **Files:** runtime secrets only; pg_cron migration
- **DB changes:** 1 migration scheduling `jf-cleanup-pending-signups-hourly`
- **Risk:** Wrong env key spelling — cron silently 401s
- **Tests:** Hit each cron endpoint with valid + invalid secret; confirm `jf_billing_events` increments on a test Stripe ping
- **DoD:** Launch-readiness panel turns green for env + cron rows

### Batch 3 — "Make the storefront real" (P0 sales/legal)
- **Tasks:** P0 #7, #8, #18, #19
- **Files:** `src/routes/join.tsx`, `src/lib/launch-readiness.functions.ts`, `sales_pages` row, `legal_documents` rows, `app_settings.jf_membership_notifications`, `sms_automations` rows
- **DB changes:** Data-only (no schema)
- **Risk:** SMS templates with broken variables — fire on a single allowlisted test number first
- **Tests:** End-to-end signup with a test card; confirm welcome SMS + trial-end SMS schedule correctly; legal acceptances persist with v2 IDs
- **DoD:** /join works on prod URL with a real test purchase, confirmation SMS arrives, member redirected to `/m`, can open Stripe portal

### Batch 4 — "Final gate" (P0 launch flip)
- **Tasks:** P0 #17, #20
- **Files:** `jf_membership_settings.public_checkout_enabled = true` after verifying everything above
- **DB changes:** 1 row update
- **Risk:** Last opportunity to back out — keep the kill switch documented
- **Tests:** First real customer purchase observed end-to-end before announcing
- **DoD:** Real customer purchase completes; second customer purchase processed within 10 min; no notification failures in `jf_notification_attempts`

### Batch 5 — "Refund + visible coming-soon cleanup" (P1)
- **Tasks:** P1 #21, #22, #23
- **Files:** new server fn `refundJfPayment`; replace 3 ComingSoon routes
- **DB changes:** Possibly `payment_records.refund_status` column
- **Risk:** Refund must be admin-only and idempotent
- **Tests:** Refund a test charge; confirm webhook update lands; verify `m/billing` reflects status
- **DoD:** Admin can issue refund without leaving the app; refunded customers see correct status

### Batch 6 — "Public marketing surface" (P1)
- **Tasks:** P1 #24, #25
- **Files:** route `head()` blocks; new `src/routes/sitemap.xml.ts`
- **DB changes:** none
- **Risk:** none
- **Tests:** Validate OG tags with debug.lovable; submit sitemap to Search Console
- **DoD:** /sitemap.xml returns valid XML; LinkedIn / X share previews render the OG image

---

## J. FINAL VERDICT

**What prevents launch right now:**
1. Production secrets not visible to runtime (Stripe, Twilio, Resend, SignNow, scheduled-worker secret).
2. Three RLS / authorization gaps with real exfiltration risk (`client-action-files` role, cross-coach support reads, unguarded `client_action_requests` writes).
3. The kill switch is off, notifications are in `dry_run`, and `sms_automations` template rows haven't been confirmed.
4. Sales-page key mismatch + several legal documents lack a published version.
5. No pg_cron schedule for pending-signup cleanup; multiple cron handlers lack proper auth.

**What can safely launch:**
- Auth, onboarding, profiles
- Workout builder (single-block templates), workout logger, set logging, completion, feedback (UI works; tighten auth in P1)
- Lift video upload + review + Drive archive (pending credentials)
- Native forms / check-ins / AI form review (admin side; queue depends on scheduled-send-worker)
- Messaging, group chats, broadcasts, support inbox
- Calendar Phase 1 (just shipped)
- Agreements + SignNow (pending creds)
- Member portal, billing portal redirect, lifecycle states

**What must stay disabled until P0 closes:**
- Public `/join` checkout (it is — keep it that way until everything in Batch 1–3 is green)
- Public `/coaching/apply` (no rate limiting yet — at minimum throttle)
- Any client-facing promo entry UI (none exists, which is fine)
- Multi-block template assignment for live clients

**Exact first batch to execute next:** Batch 1 — "Lock the doors." That clears the three high-severity security findings, removes the unguarded `client_action_requests` writes, adds defense-in-depth on the portal agreements query, and tightens the Fillout webhook signature — all without changing any user-visible flow.

---

_Report path: `docs/JF_EFFECT_COMPLETION_AUDIT.md`_

_Generated from 5 parallel evidence-gathering passes covering: placeholder/TODO/orphan scan, membership+Stripe end-to-end, RLS + storage + SECURITY DEFINER, 19 feature workflows, launch configuration._