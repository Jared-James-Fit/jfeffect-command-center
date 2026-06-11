
# Media Manager Role — v1 (Foundation + Approval Workflow)

Scope locked from your answers:
- Foundation + Approval workflow (broadcasts, announcements, sales pages, events)
- Media file gate uses **both** a new visibility tag AND existing media_type exclusions

Out of scope for v1 (tracked as follow-ups): standalone content-planning table, campaign manager, testimonials library, custom shoot/script tools.

---

## 1. Database (one migration)

**Roles**
- Add `'media_manager'` to `app_role` enum.
- Helper: `is_media_manager(_uid)` security-definer fn.

**Approval workflow columns** (add to existing tables; default existing rows to `'approved'` so nothing breaks):
- `broadcasts.review_status` — `draft | needs_review | approved | published | archived`
- `broadcasts.submitted_by`, `submitted_at`, `reviewed_by`, `reviewed_at`, `review_notes`
- Same five columns on: announcements source (re-using `broadcasts` if announcements are already broadcasts; otherwise the announcements table), `events`, and `sales_pages`.

**Media visibility**
- New enum `media_visibility` = `private | marketing | public`.
- Add `marketing_visibility media_visibility DEFAULT 'private'` to `media_items` and `media_archives`.
- Backfill: existing rows stay `private`. Lift videos, check-in videos, progress photos stay private regardless of tag.

**RLS additions** (Media Manager can):
- `SELECT/INSERT/UPDATE` on `broadcasts`, `events`, `sales_pages` when `review_status IN ('draft','needs_review')` and they are the submitter — cannot flip to `approved/published`.
- `SELECT` on `media_items`/`media_archives` where `marketing_visibility IN ('marketing','public')` AND media_type NOT IN private types.
- No access to: `clients`, `messages`, `pl_*` (workouts), `nutrition_*`, `lift_videos`, `agreements`, `purchase_records`, `app_members` billing fields, `sms_*`, `user_roles` writes, `app_settings`, `coaches`.

**Account creation**
- Reuse existing `coach_invites` pattern OR extend `app_members` with `role_override`. Cleanest: a new `staff_invites` table (email, role, setup_token, expires_at, status) keyed to `user_roles` on redemption.

## 2. Server functions (`src/lib/media-manager.functions.ts`)

- `createMediaManager({ first_name, last_name, email, phone? })` — admin only; creates auth user (admin API), inserts `user_roles`, generates setup link, sends invite via existing email infra.
- `listMediaManagers()`, `deactivateMediaManager(id)`, `resendSetup(id)`, `resetPassword(id)`.
- `submitForReview({ kind, id })` / `approve({ kind, id })` / `reject({ kind, id, notes })` / `publish({ kind, id })` — kind = broadcast | announcement | event | sales_page.
- `mediaDashboardSummary()` — counts: drafts mine, needs_review (admin), recent uploads, upcoming events.

## 3. Routes & UI

**New top-level route tree** `src/routes/_authenticated/media/`:
- `route.tsx` — gate: `role === 'media_manager' || admin`. Renders `MediaShell` (simplified sidebar).
- `dashboard.tsx` — Today's priorities, quick links, recent uploads, drafts mine, items awaiting admin (read-only for MM).
- `action-items.tsx` — reuses tasks table filtered to `assignee_role='media_manager'`.
- `calendar.tsx` — existing content/events calendar, filtered to public/promo.
- `campaigns.tsx` — promo planning list (uses sales_pages + events drafts).
- `events.tsx` — list/edit events with review_status flow.
- `inbox.tsx` — wraps existing Media Inbox, filtered to allowed visibility.
- `archives.tsx` — wraps Media Archives, filtered.
- `uploads.tsx` — upload screen restricted to marketing/public bucket tagging.
- `testimonials.tsx` — filtered media_items where `tags @> ['testimonial']`.
- `sales/membership.tsx` — preview + draft editor (writes to `sales_pages` as draft).
- `sales/coaching.tsx` — same.
- `promo-links.tsx` — reuses `ShareToolbar` for /join and /coaching.
- `broadcasts.tsx` — list mine; create/edit drafts; submit for review.
- `announcements.tsx` — same.
- `account.tsx`.

**Admin side** (`src/routes/_authenticated/admin/`):
- `staff.tsx` — new page: list staff (admins/coaches/media managers), invite Media Manager form, manage status.
- `approvals.tsx` — queue of items `review_status='needs_review'` across broadcasts/announcements/events/sales pages with approve/reject buttons.
- Existing broadcast/announcement/event/sales-page editors get a "Review" tab when item is `needs_review`.

**Sidebar** (`src/components/media-sidebar.tsx`): the simplified menu you specified.

**Auth routing** (`src/lib/auth.tsx`): extend `AppRole` with `'media_manager'`; landing redirect after sign-in goes to `/media/dashboard` for media managers (admins/coaches/clients unchanged).

## 4. Security guardrails

- All `_authenticated/media/*` routes check role in `beforeLoad`; non-media/non-admin users get redirected.
- `_authenticated/admin/*` route gate rejects `media_manager` (except the specific allowed pages above, which we move under `/media/`).
- Every Media Manager server fn re-checks role server-side (`requireSupabaseAuth` + role lookup) — never trust client.
- Publish endpoints reject `media_manager` callers regardless of UI state.
- `supabaseAdmin` never reachable from MM-callable code paths (admin operations stay in admin-only server fns).

## 5. Testing checklist

After build I'll verify:
- Migration applies clean; existing broadcasts/events show as `approved` (no regression for current admin flow).
- Sign in as MM → lands on /media/dashboard; sidebar shows only allowed items.
- MM can create broadcast draft → submit for review → cannot approve/publish.
- Admin sees item in /admin/approvals → approves → status flips → MM sees published state.
- MM cannot reach /admin/clients, /admin/messages, /admin/payments (redirect).
- MM can preview /join, /coaching, copy promo links.
- MM viewing Media Inbox sees only marketing/public items; lift videos / progress photos hidden.

---

## Technical notes

- Sales pages currently store one row per slug; "draft suggestion" = new row with `status='draft'` + `parent_id`, admin merges on approve. Simpler alternative: `draft_payload jsonb` column on `sales_pages` that admin promotes to live fields — recommend this.
- Approval columns added with `DEFAULT 'approved'` so the trigger that fires broadcasts on `status='Active'` keeps working unchanged for admin-created items.
- Account creation reuses your existing `redeemSetupToken` flow pattern from `members.functions.ts`.

This is one migration + ~15 new route files + sidebar/auth tweaks. Roughly 2-3 hours of focused build. Approve and I'll start with the migration.
